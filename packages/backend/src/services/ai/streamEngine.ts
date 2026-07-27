import type OpenAI from 'openai';
import { type AccessTokenPayload } from '@sams/shared';
import type { AIServiceResponse } from '../aiService';
import {
  getOpenAIClient,
  getFallbackClient,
  getAtomesusClient,
  resolveChatModel,
  resolveFallbackChatModel,
  resolveAtomesusChatModel,
  formatProviderError,
  extractProviderErrorText,
  isModelProviderMismatch,
  hasPrimaryAIKey,
  hasFallbackAIKey,
  hasAtomesusAIKey,
  getMissingAIKeyMessage,
} from './aiProviderConfig';
import { buildSystemPrompt, getRoleScopedTools, dispatchFunctionCall, shouldUseTools, sanitizeLlmOutput, cleanLeakedToolSyntax, extractTextEmbeddedToolCall } from './openaiEngine';

export interface StreamChunk {
  text: string;
}

// Max think→act→observe rounds for the streaming agent. Kept tight so the whole
// streamed turn stays responsive; each round is a fresh completion call.
const MAX_STREAM_AGENT_STEPS = Number.parseInt(process.env.AI_MAX_AGENT_STEPS ?? '', 10) || 3;

/**
 * Stream a chat completion from the primary AI provider.
 * Tries primary → fallback → Atomesus if configured.
 * Calls onDelta for each text token, then resolves with the full AIServiceResponse.
 *
 * CRITICAL: All output is sanitized to prevent identity drift (claiming to be
 * Atomesus/Cipher/from India instead of SAMS).
 */
export async function streamFromProvider(
  user: AccessTokenPayload,
  question: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  onDelta: (chunk: StreamChunk) => void,
): Promise<Pick<AIServiceResponse, 'answer' | 'intent' | 'engine' | 'data'>> {
  if (!hasPrimaryAIKey() && !hasFallbackAIKey() && !hasAtomesusAIKey()) {
    return { answer: getMissingAIKeyMessage(), intent: 'ai_not_configured', engine: 'local', data: undefined };
  }

  if (isModelProviderMismatch()) {
    return {
      answer: `OPENAI_MODEL=${process.env.OPENAI_MODEL} does not work with Groq. Set OPENAI_MODEL=llama-3.3-70b-versatile (or point OPENAI_BASE_URL to OpenRouter/OpenAI), then restart the API.`,
      intent: 'ai_error',
      engine: 'local',
      data: undefined,
    };
  }

  const systemPrompt = await buildSystemPrompt(user);
  const messages = buildStreamMessages(systemPrompt, question, history);
  const useTools = shouldUseTools(user);

  // Try providers in order: primary → fallback → atomesus
  const errors: string[] = [];

  // Primary
  if (hasPrimaryAIKey()) {
    try {
      const client = getOpenAIClient();
      const result = await doStreamCompletion(client, resolveChatModel(), messages, useTools, onDelta, user);
      if (result) return result;
    } catch (err) {
      errors.push(`primary: ${extractProviderErrorText(err)}`);
    }
  }

  // Fallback (OpenRouter)
  const fallback = getFallbackClient();
  if (fallback) {
    try {
      const result = await doStreamCompletion(fallback, resolveFallbackChatModel(), messages, useTools, onDelta, user);
      if (result) return result;
    } catch (err) {
      errors.push(`fallback: ${extractProviderErrorText(err)}`);
    }
  }

  // Atomesus
  const atomesus = getAtomesusClient();
  if (atomesus) {
    try {
      const result = await doStreamCompletion(atomesus, resolveAtomesusChatModel(), messages, useTools, onDelta, user);
      if (result) return result;
    } catch (err) {
      errors.push(`atomesus: ${extractProviderErrorText(err)}`);
    }
  }

  const combined = errors.join('; ');
  const answer = combined
    ? formatProviderError(...(errors.length > 0 ? [errors.join('; ')] : []))
    : getMissingAIKeyMessage();

  return { answer, intent: 'ai_error', engine: 'local', data: undefined };
}

function buildStreamMessages(
  systemPrompt: string,
  question: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  return [
    { role: 'system', content: systemPrompt },
    ...(history.length > 0
      ? [{ role: 'system' as const, content: 'Conversation memory follows. Treat these prior turns as authoritative context for this same chat.' }]
      : []),
    ...history,
    { role: 'user', content: question },
  ];
}

interface StreamToolCall {
  id: string;
  name: string;
  arguments: string;
}

interface GatedStreamResult {
  /** Full raw accumulated text content (unsanitised). */
  rawContent: string;
  /** True if any sanitised text was actually forwarded to the client via onDelta. */
  streamed: boolean;
  /** True if content was withheld because it began as a tool-call blob. */
  gated: boolean;
  /** Structured tool calls collected from the tool_calls channel. */
  toolCalls: StreamToolCall[];
}

/**
 * Decide, once, whether the streamed content is a leaked tool-call blob that
 * must be withheld from the user. Groq/llama models sometimes emit a tool call
 * as raw JSON in `content` instead of the structured `tool_calls` channel; if we
 * stream that verbatim the user sees `{"name":"query_database",...}` as "the
 * answer". Real prose never *starts* with `{` or `<tool_call>`, so keying off the
 * leading non-whitespace char lets normal answers stream unaffected.
 */
function looksLikeLeakedToolBlob(content: string): boolean {
  const lead = content.trimStart();
  if (!lead) return false;
  return lead[0] === '{' || /^<tool_call/i.test(lead) || /^```(?:json|tool_code)\b/i.test(lead);
}

/**
 * Consume a streaming completion, forwarding sanitised prose token-by-token but
 * buffering (never forwarding) content that begins as a leaked tool-call blob.
 * Structured tool_calls are accumulated regardless. The caller inspects the
 * result to recover a real tool run or flush cleaned text.
 */
async function consumeGatedStream(
  stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>,
  onDelta: (chunk: StreamChunk) => void,
): Promise<GatedStreamResult> {
  let rawContent = '';
  let sentLen = 0;
  let gateDecided = false;
  let gated = false;
  let streamed = false;
  const calls: Map<number, StreamToolCall> = new Map();

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;

    if (delta?.content) {
      rawContent += delta.content;
      if (!gateDecided && rawContent.trimStart().length > 0) {
        gated = looksLikeLeakedToolBlob(rawContent);
        gateDecided = true;
      }
      if (!gated) {
        // Sanitize the full text so far, then diff against what was already sent
        // so we never forward tokens that sanitisation would later rewrite.
        const sanitizedSoFar = sanitizeLlmOutput(rawContent);
        const newChars = sanitizedSoFar.slice(sentLen);
        if (newChars) {
          onDelta({ text: newChars });
          sentLen = sanitizedSoFar.length;
          streamed = true;
        }
      }
    }

    if (delta?.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        const existing = calls.get(idx) ?? { id: '', name: '', arguments: '' };
        if (tc.id) existing.id = tc.id;
        if (tc.function?.name) existing.name = tc.function.name;
        if (tc.function?.arguments) existing.arguments += tc.function.arguments;
        calls.set(idx, existing);
      }
    }
  }

  return { rawContent, streamed, gated, toolCalls: Array.from(calls.values()) };
}

/**
 * Perform a streaming chat completion with optional tool support.
 * When tools are used, the function accumulates tool calls from the stream,
 * executes them, then makes a follow-up streaming call to get the final answer.
 *
 * CRITICAL: The final accumulated answer is sanitized through sanitizeLlmOutput()
 * before returning to prevent identity drift, and leaked tool-call JSON is never
 * streamed to the user — it is recovered into a real tool run instead.
 */
async function doStreamCompletion(
  client: OpenAI,
  model: string,
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  useTools: boolean,
  onDelta: (chunk: StreamChunk) => void,
  user: AccessTokenPayload,
): Promise<Pick<AIServiceResponse, 'answer' | 'intent' | 'engine' | 'data'> | null> {
  const stream = await client.chat.completions.create({
    model,
    messages,
    temperature: 0.85,
    max_tokens: 800,
    stream: true,
    ...(useTools ? { tools: getRoleScopedTools(user.role), tool_choice: 'auto' as const } : {}),
  });

  const { rawContent, streamed, gated, toolCalls } = await consumeGatedStream(stream, onDelta);

  // Structured tool calls → run the agent rounds so the real answer streams.
  if (toolCalls.length > 0) {
    const followUpText = await streamAgentRounds(client, model, messages, user, toolCalls, onDelta);
    const sanitized = sanitizeLlmOutput(cleanLeakedToolSyntax(followUpText));
    return sanitized.trim()
      ? { answer: sanitized, intent: 'openai_response', engine: 'openai', data: undefined }
      : null;
  }

  // Content was withheld because it looked like a leaked tool-call blob. Try to
  // recover a real tool call from it (the model meant to call a tool but emitted
  // JSON as text); if recoverable, run it so the user gets a real answer.
  if (gated) {
    const embedded = useTools ? extractTextEmbeddedToolCall(rawContent) : null;
    if (embedded) {
      const followUpText = await streamAgentRounds(
        client, model, messages, user,
        [{ id: 'text_call_0', name: embedded.name, arguments: embedded.arguments }],
        onDelta,
      );
      const sanitized = sanitizeLlmOutput(cleanLeakedToolSyntax(followUpText));
      if (sanitized.trim()) {
        return { answer: sanitized, intent: 'openai_response', engine: 'openai', data: undefined };
      }
    }
    // Not a recoverable tool call (or tools unavailable) — flush the cleaned text
    // now so a withheld-but-benign message still reaches the user.
    const cleaned = sanitizeLlmOutput(cleanLeakedToolSyntax(rawContent));
    if (cleaned.trim()) {
      onDelta({ text: cleaned });
      return { answer: cleaned, intent: 'openai_response', engine: 'openai', data: undefined };
    }
    return null;
  }

  if (!streamed || !rawContent.trim()) {
    return null;
  }

  // CRITICAL: Sanitize the output before returning.
  // The non-streaming path (openaiQuery/openaiQueryWithHistory) already does this,
  // but the streaming path was returning raw LLM output without sanitization,
  // allowing the model to identify as Atomesus/Cipher/from India.
  const sanitized = sanitizeLlmOutput(cleanLeakedToolSyntax(rawContent));

  return {
    answer: sanitized,
    intent: 'openai_response',
    engine: 'openai',
    data: undefined,
  };
}

/**
 * Run one-or-more streamed tool rounds (think → act → observe → repeat).
 *
 * The old code executed a single tool round and stopped, so the streaming agent
 * could never chain lookups. This loops: run the requested tools, ask the model
 * again with the results, and if it wants more tools, keep going — up to
 * MAX_STREAM_AGENT_STEPS. On the final allowed step tools are withheld so the
 * model is forced to produce a text answer. Returns the streamed final text.
 */
async function streamAgentRounds(
  client: OpenAI,
  model: string,
  baseMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  user: AccessTokenPayload,
  initialCalls: StreamToolCall[],
  onDelta: (chunk: StreamChunk) => void,
): Promise<string> {
  const messages = [...baseMessages];
  let pendingCalls = initialCalls;
  let finalText = '';

  for (let step = 0; step < MAX_STREAM_AGENT_STEPS; step++) {
    // Record the assistant's tool request, then execute every tool it asked for.
    messages.push({
      role: 'assistant',
      content: null,
      tool_calls: pendingCalls.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: tc.arguments },
      })),
    });
    for (const tc of pendingCalls) {
      try {
        const result = await dispatchFunctionCall(tc.name, tc.arguments, user, { restrictSqlToSuperAdmin: true });
        messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
      } catch (err) {
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
        });
      }
    }

    // Force a text answer on the last allowed step (withhold tools).
    const isLastStep = step === MAX_STREAM_AGENT_STEPS - 1;
    const stream = await client.chat.completions.create({
      model,
      messages,
      // Low temperature once we're reasoning over tool results — stay faithful to
      // the fetched data instead of improvising (mirrors the non-streaming loop).
      temperature: 0.2,
      max_tokens: 800,
      stream: true,
      ...(isLastStep ? {} : { tools: getRoleScopedTools(user.role), tool_choice: 'auto' as const }),
    });

    // Reuse the gated consumer: prose streams live, but a leaked tool-call blob
    // is withheld and recovered below rather than shown to the user.
    const { rawContent: roundText, gated, toolCalls: nextCalls } = await consumeGatedStream(stream, onDelta);

    // Structured tool calls → keep looping (chained lookups).
    if (nextCalls.length > 0) {
      pendingCalls = nextCalls;
      continue;
    }

    // Content withheld as a suspected tool blob: recover a real call and loop,
    // unless we're on the last step (tools withheld) — then flush cleaned text.
    if (gated) {
      const embedded = isLastStep ? null : extractTextEmbeddedToolCall(roundText);
      if (embedded) {
        pendingCalls = [{ id: `text_call_${step}`, name: embedded.name, arguments: embedded.arguments }];
        continue;
      }
      const cleaned = sanitizeLlmOutput(cleanLeakedToolSyntax(roundText));
      if (cleaned.trim()) {
        onDelta({ text: cleaned });
        finalText += cleaned;
      }
      break;
    }

    finalText += roundText;
    break;
  }

  return finalText;
}
