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
import { buildSystemPrompt, getRoleScopedTools, dispatchFunctionCall, shouldUseTools } from './openaiEngine';

export interface StreamChunk {
  text: string;
}

/**
 * Stream a chat completion from the primary AI provider.
 * Tries primary → fallback → Atomesus if configured.
 * Calls onDelta for each text token, then resolves with the full AIServiceResponse.
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

interface AccumulatedToolCall {
  id: string;
  name: string;
  arguments: string;
}

/**
 * Perform a streaming chat completion with optional tool support.
 * When tools are used, the function accumulates tool calls from the stream,
 * executes them, then makes a follow-up streaming call to get the final answer.
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

  let accumulatedAnswer = '';
  const toolCalls: Map<number, AccumulatedToolCall> = new Map();
  let hasToolCalls = false;

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    const finishReason = chunk.choices[0]?.finish_reason;

    // Text content
    if (delta?.content) {
      accumulatedAnswer += delta.content;
      onDelta({ text: delta.content });
    }

    // Tool calls
    if (delta?.tool_calls) {
      hasToolCalls = true;
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        const existing = toolCalls.get(idx) ?? { id: '', name: '', arguments: '' };
        if (tc.id) existing.id = tc.id;
        if (tc.function?.name) existing.name = tc.function.name;
        if (tc.function?.arguments) existing.arguments += tc.function.arguments;
        toolCalls.set(idx, existing);
      }
    }

    // Tool calls triggered — break out to execute
    if (hasToolCalls && finishReason === 'tool_calls') {
      // Execute tool calls
      const toolResultsMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        ...messages,
        {
          role: 'assistant',
          content: null,
          tool_calls: Array.from(toolCalls.values()).map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: tc.arguments },
          })),
        },
      ];

      for (const [, tc] of toolCalls) {
        try {
          const result = await dispatchFunctionCall(tc.name, tc.arguments, user, { restrictSqlToSuperAdmin: true });
          toolResultsMessages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: result,
          });
        } catch (err) {
          toolResultsMessages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
          });
        }
      }

      // Make follow-up streaming call with tool results
      const followUpStream = await client.chat.completions.create({
        model,
        messages: toolResultsMessages,
        temperature: 0.85,
        max_tokens: 800,
        stream: true,
      });

      for await (const fChunk of followUpStream) {
        const fDelta = fChunk.choices[0]?.delta;
        if (fDelta?.content) {
          accumulatedAnswer += fDelta.content;
          onDelta({ text: fDelta.content });
        }
      }

      break;
    }
  }

  if (!accumulatedAnswer.trim()) {
    return null; // caller will try next provider
  }

  return {
    answer: accumulatedAnswer,
    intent: 'openai_response',
    engine: 'openai',
    data: undefined,
  };
}
