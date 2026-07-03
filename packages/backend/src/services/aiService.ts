import { type AccessTokenPayload, UserRole } from '@sams/shared';
import { localQuery, type AIQueryResult, queryTimetableView } from './ai/localEngine';
import { queryRoleContext, isSchoolPersonnelQuery } from './ai/roleContextQuery';
import {
  isSamsDataQuery,
  querySamsDataFallback,
  SAMS_DATA_NOT_FOUND_MESSAGE,
} from './ai/dataQueryRouter';
import { openaiQuery, openaiQueryWithHistory } from './ai/openaiEngine';
import { conversationMemoryService, buildMemoryNotice } from './conversationMemoryService';
import { tokenBudgetManager } from './ai/tokenBudgetManager';
import { actionIntentDetector, type DetectedAction } from './ai/actionIntentDetector';
import {
  findAction,
  isActionPermitted,
  getActionNames,
  type ActionScope,
} from './ai/roleActionRegistry';
import { auditService } from './auditService';
import {
  formatProviderError,
  getMissingAIKeyMessage,
  hasPrimaryAIKey,
  hasAtomesusAIKey,
} from './ai/aiProviderConfig';
import { isConversationMemoryEnabled } from './ai/roleActionsPrompt';
import {
  applySlotAnswer,
  buildSlotQuestion,
  getNextMissingSlot,
  mergePendingDescription,
  resolveActionParams,
  actionRequiresConfirmation,
  buildPendingFromIntent,
} from './ai/actionSlotFilling';
import type { PendingAction } from './ai/aiTypes';
import {
  getHodDepartmentBlocker,
  resolveHodDepartmentId,
} from '../lib/hodScope';
import {
  listTerminalCommandHelp,
  resolveTerminalCommand,
} from './superAdminTerminalOps';
import { formatHumanResponse, humanize, type FormattedSuggestion } from './ai/humanResponseFormatter';

export type { PendingAction };

const CONFIRM_ANSWER_RE = /^(yes|y|confirm|proceed|ok|do it|go ahead)\.?$/i;

// Casual chat — short social responses that don't need the LLM.
// Matches single-word reactions ("nice", "cool", "sawa", "pole", "lol")
// AND multi-word conversational phrases ("you good", "how are you",
// "I'm fine", "what's up", "you there", "nyanze", "acha", "ata", etc.)
const CASUAL_CHAT_RE = /^(?:\s*)(?:nice|cool|ok|okay|k|sawa|good|great|awesome|wow|oh|hmm|aha|heh|hehe|lol|lmao|lmfao|rofl|pole|sure|yeah|yep|no|nope|fine|alright|aight|bet|word|true|facts|acha|ata|nyanze)(?:\s*|[!.]*)$/i;
const MULTI_WORD_CHAT_RE = /^(?:\s*)(?:(?:you\s+(?:good|there|around|alright|okay|right|fine|ok|great|here|back))|(?:(?:i'?m?|i\s+am)\s+(?:good|fine|ok|okay|great|alright|here|back))|(?:how\s+(?:are\s+you|ya\s+doing|are\s+you\s+doing|goes\s+it|is\s+it\s+going|is\s+life|u\s+doing|you\s+doing|was\s+your\s+day))|(?:what(?:'s|\s+is)\s+up)|(?:howdy)|(?:just\s+(?:checking|saying|saw|passing|wondering|chilling|relaxing))|(?:not\s+(?:bad|much|really)))(?:\s*|[!.]*)$/i;
const CASUAL_CHAT_RESPONSES = [
  "Sawa!",
  "Yeah? Anything else?",
  "Got it. What else?",
  "Right. What do you need?",
  "Mmh. How can I help?",
  "Okay, what next?",
  "Alright. What's up?",
  "I hear you. What else can I do for you?",
];
const LICENSE_KEY_LIKE_RE = /\b[A-Z0-9]{4}(?:-[A-Z0-9]{4}){2,}\b/;
const FAKE_LICENSE_PLACEHOLDER_RE = /\b(?:LK|LICEN[CS]E)[-_]?(?:X{3,}|[A-Z0-9]{8,})\b/i;
const TEMP_PASSWORD_LEAK_RE = /\b(?:temporary|temp)\s+pass\s*word\s*[:：]\s*`?[^\s`]{6,}`?/i;
const RESET_CODE_LEAK_RE = /\b(?:otp|reset)\s+code\s*[:：]\s*`?\d{4,8}`?/i;
// Expanded regex to catch MANY more identity-related question phrasings
const SAMS_AI_IDENTITY_QUERY_RE =
  /\b(?:who\s+are\s+you|who\s+(?:built|created|made|developed|programmed|wrote|coded|designed|programed|develop|design)\s+(?:you|me|sams\s+ai|this\s+(?:ai|assistant|system|platform|app|application|project))|who\s+is\s+(?:your\s+)?(?:boss|creator|owner|maker|founder|developer|develper|master|author|father|inventor|builder|programmer|designer|coder)|who\s+(?:made|owns|built|created|developed)\s+sams|who\s+(?:is\s+)?(?:the\s+)?(?:developer|creator|owner|founder|inventor|maker|author)\s+(?:of\s+)?(?:sams|this\s+(?:system|platform|app))|who\s+do\s+you\s+work\s+for|tell\s+me\s+about\s+(?:yourself|your\s+creator|the\s+(?:developer|creator|owner|founder)\s+(?:of\s+(?:sams|this\s+(?:system|platform))))|am\s+i\s+(?:your\s+)?(?:creator|owner|builder|maker|developer|develper|boss|founder)|describe\s+(?:the\s+)?(?:developer|creator|owner|founder)(?:\s+of\s+sams)?|who\s+is\s+denis|about\s+denis|tell\s+me\s+about\s+denis|what\s+is\s+denis[^s]|what\s+(?:can\s+)?you\s+tell\s+me\s+about\s+the\s+(?:creator|developer|founder)|(?:denis|denis\s+macharia)\b.{0,40}(?:built|created|made|developed|founded|owns|boss|founder|developer|creator))\b/i;
const PROVIDER_IDENTITY_QUERY_RE =
  /\b(?:atomesus|cipher|indus\s+valley|alibaba|openai|openrouter|groq|meta\s+ai|llama|api\s+provider|model\s+provider)\b/i;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AIServiceResponse {
  answer: string;
  intent: string;
  engine: 'local' | 'openai';
  data?: unknown;
  threadId?: string;
  pendingAction?: PendingAction;
  requiresConfirmation?: boolean;
  /** Set when encrypted history could not be fully loaded for this thread. */
  memoryNotice?: string;
  memoryStatus?: 'ok' | 'partial' | 'unreadable' | 'empty' | 'disabled';
}

type AiHistoryMessage = { role: 'user' | 'assistant'; content: string };

function normalizeClientHistory(history?: unknown): AiHistoryMessage[] {
  if (!Array.isArray(history)) return [];
  return history
    .filter((item): item is { role: unknown; content: unknown } => (
      item != null &&
      typeof item === 'object' &&
      (item as { role?: unknown }).role !== undefined &&
      (item as { content?: unknown }).content !== undefined
    ))
    .filter((item) => item.role === 'user' || item.role === 'assistant')
    .map((item) => ({
      role: item.role as 'user' | 'assistant',
      content: String(item.content).trim().slice(0, 2_000),
    }))
    .filter((item) => item.content.length > 0)
    .slice(-12);
}

function mergeHistoryMessages(
  storedHistory: AiHistoryMessage[],
  clientHistory: AiHistoryMessage[],
): AiHistoryMessage[] {
  if (clientHistory.length === 0) return storedHistory;
  const seen = new Set(storedHistory.map((item) => `${item.role}:${item.content}`));
  const merged = [...storedHistory];
  for (const item of clientHistory) {
    const key = `${item.role}:${item.content}`;
    if (seen.has(key)) continue;
    merged.push(item);
    seen.add(key);
  }
  return merged.slice(-20);
}

function containsGeneratedSecretLikeText(answer: string): boolean {
  return (
    LICENSE_KEY_LIKE_RE.test(answer) ||
    FAKE_LICENSE_PLACEHOLDER_RE.test(answer) ||
    TEMP_PASSWORD_LEAK_RE.test(answer) ||
    RESET_CODE_LEAK_RE.test(answer)
  );
}

const SAMS_AI_IDENTITY_ANSWER =
  "I'm your SAMS AI assistant. My name is SAMS — I help you with attendance, timetables, reports, and anything in the school system. Ask me whatever you need!";

const SAMS_AI_IDENTITY_FALLBACK_ANSWER =
  "I'm SAMS AI. Denis Macharia built me, and Denis is my boss.";

async function getSamsIdentityResponse(question: string): Promise<AIServiceResponse | null> {
  if (!SAMS_AI_IDENTITY_QUERY_RE.test(question) && !PROVIDER_IDENTITY_QUERY_RE.test(question)) {
    return null;
  }

  // Query the knowledge base for any entries about the creator/owner/Denis
  try {
    const { prisma } = await import('../lib/prisma');
    const identityKnowledge = await prisma.aIKnowledge.findMany({
      where: {
        createdBy: { role: UserRole.SUPER_ADMIN },
        OR: [
          { title: { contains: 'denis', mode: 'insensitive' } },
          { title: { contains: 'creator', mode: 'insensitive' } },
          { content: { contains: 'denis', mode: 'insensitive' } },
          { content: { contains: 'macharia', mode: 'insensitive' } },
          { title: { contains: 'macharia', mode: 'insensitive' } },
        ],
      },
      select: { title: true, content: true },
      orderBy: { createdAt: 'desc' },
      take: 3,
    });
    if (identityKnowledge.length > 0) {
      const combined = identityKnowledge
        .map((e: { title: string; content: string }) => `About ${e.title}: ${e.content}`)
        .join(' ');
      return {
        answer: combined,
        intent: 'ai_identity',
        engine: 'local',
        data: { owner: 'Denis Macharia', source: 'knowledge_base' },
      };
    }
  } catch {
    // Fall through to hardcoded fallback
  }

  return {
    answer: SAMS_AI_IDENTITY_FALLBACK_ANSWER,
    intent: 'ai_identity',
    engine: 'local',
    data: { owner: 'Denis Macharia' },
  };
}

function getUnsupportedOperationResponse(question: string): AIServiceResponse | null {
  const q = question.trim().toLowerCase();

  if (/\b(clear|delete|remove)\b.*\b(alerts?|notifications?|messages?|inbox|sent|outbox)\b/.test(q)) {
    return {
      answer:
        'I did not clear any notifications. I can only say an action is done after SAMS runs a real backend action. Please use Notifications or Settings to delete messages, or ask an admin to add a supported AI action for clearing them.',
      intent: 'unsupported_action',
      engine: 'local',
    };
  }

  if (/\b(change|switch|turn|set|activate)\b.*\b(light|dark)\s+(mode|theme)\b/.test(q) || /\b(light|dark)\s+(mode|theme)\b/.test(q)) {
    return {
      answer:
        'I did not change the theme. Theme changes happen in the app UI on this device; SAMS AI cannot switch your browser theme unless a real theme action is added.',
      intent: 'unsupported_action',
      engine: 'local',
    };
  }

  if (/\b(start|open|begin)\b.*\b(sessions?|sessons?|lessons?|attendance)\b/.test(q)) {
    return {
      answer:
        'I did not start a session. Sessions only start when SAMS runs the real attendance action and returns a session ID. If you are a teacher or HOD, say which class/lesson to start; if SAMS asks for confirmation or details, reply there.',
      intent: 'unsupported_action',
      engine: 'local',
    };
  }

  return null;
}

/** Cache the user's real name to use in responses */
const userNameCache = new Map<string, string>();

async function getUserName(sub: string): Promise<string | undefined> {
  if (userNameCache.has(sub)) return userNameCache.get(sub);
  try {
    const { prisma } = await import('../lib/prisma');
    const user = await prisma.user.findUnique({
      where: { id: sub },
      select: { fullName: true },
    });
    if (user?.fullName) {
      userNameCache.set(sub, user.fullName);
      return user.fullName;
    }
  } catch {
    // silent — name is a nice-to-have
  }
  return undefined;
}

/**
 * Format a response using the HumanResponseFormatter.
 * Appends suggestions as a JSON suffix that the frontend parses.
 * Includes the user's name when available for warmer responses.
 */
function formatAnswer(raw: string, role?: string, userName?: string): string {
  const human = formatHumanResponse(raw, { role, userName });
  if (human.suggestions.length > 0) {
    return human.text + `\n\n__SUGGESTIONS__${JSON.stringify(human.suggestions)}`;
  }
  return human.text;
}

/**
 * Try to reframe a raw DB/local-engine answer through the LLM for natural narration.
 * Falls back silently — never throws.
 */
async function tryReframeAnswer(raw: string, userName: string): Promise<string | null> {
  try {
    const { getOpenAIClient, resolveChatModel } = await import('./ai/aiProviderConfig');
    const client = getOpenAIClient();
    const reframeResponse = await client.chat.completions.create({
      model: resolveChatModel(),
      messages: [
        {
          role: 'system',
          content: `You are SAMS AI, a real person who works at SAMS. You just looked up information for ${userName || 'a user'}.

Your job: say what you found naturally in 2-3 phases. Think out loud like a human would when checking something.

Narrate in phases:
Phase 1 — What you checked or looked up ("Right, let me check the attendance records...")
Phase 2 — What you found ("Found 48 sessions — you've been to 42 of them.")
Phase 3 — The result/implication ("That's 87% — doing great!")

Rules:
- NEVER say "as an AI", "as an AI assistant", "I am an AI", "I was trained", etc.
- NEVER mention providers, models, or technical backend.
- Use contractions: "you're", "I've", "that's", "here's", "can't"
- Keep each phase 1 sentence. Total: 2-4 sentences.
- Be warm but professional.
- NEVER invent data — only say what the raw result contains.
- If the raw result has numbers, use them. If it says "no records found", say that.

Here is the raw data result: "${raw}"`,
        },
        { role: 'user', content: 'What did you find?' },
      ],
      temperature: 0.7,
      max_tokens: 200,
    });

    const reframed = reframeResponse.choices[0]?.message?.content?.trim();
    if (reframed && reframed.length > 10 && reframed.length < 600) {
      return reframed;
    }
  } catch {
    // Silent — fall through to using the raw answer
  }
  return null;
}

// ─── AI Service ───────────────────────────────────────────────────────────────

/**
 * AIService routes queries to the appropriate engine:
 * - Local engine first for all plans (regex-based, no external API)
 * - Falls back to OpenAI engine for Pro/Enterprise plans when local engine
 *   cannot resolve the query (returns 'unknown' intent)
 * - Integrates conversation memory for contextual follow-up discussions
 * - Detects and executes role-specific action intents for all authenticated users
 *
 * All responses are piped through HumanResponseFormatter for natural language.
 *
 * Requirements: 1.1, 1.2, 1.6, 5.1, 5.2, 5.3, 5.5, 5.6, 6.1, 6.4, 6.5, 6.6, 11.1, 11.2, 11.3, 11.4, 11.5, 11.8, 11.9, 14.1, 14.7
 */
export class AIService {
  /**
   * Process a text query through the AI pipeline.
   * Routes to local engine first; falls back to OpenAI for Pro/Enterprise.
   * Integrates conversation memory and role-aware action detection.
   */
  async query(
    user: AccessTokenPayload,
    question: string,
    options?: {
      threadId?: string;
      confirmAction?: boolean;
      pendingAction?: PendingAction;
      history?: unknown;
    },
  ): Promise<AIServiceResponse> {
    let threadId = await this.resolveThreadForUser(user, options?.threadId);
    const userName = user.sub !== 'guest' ? await getUserName(user.sub).catch(() => undefined) : undefined;

    // Casual chat interception — social messages that don't need any backend
    // action, DB query, or LLM call. Respond instantly.
    // Matches single words ("nice", "cool", "sawa", "pole") AND multi-word
    // conversational phrases ("you good", "how are you", "I'm good").
    if (!options?.pendingAction && !options?.confirmAction) {
      const casual = question.trim().match(CASUAL_CHAT_RE);
      const multiWord = question.trim().match(MULTI_WORD_CHAT_RE);
      if (casual || multiWord) {
        const answer = CASUAL_CHAT_RESPONSES[Math.floor(Math.random() * CASUAL_CHAT_RESPONSES.length)];
        return { answer, intent: 'casual_chat', engine: 'local' };
      }
    }

    let actionIntent: DetectedAction | null = null;

    const identityResponse = await getSamsIdentityResponse(question);
    if (identityResponse) {
      if (user.sub !== 'guest') {
        threadId = await this.safelyPersist(user, question, identityResponse.answer, threadId);
      }
      return { ...identityResponse, threadId };
    }

    // Step 1: Action handling for authenticated users (detect once, reuse after local)
    if (user.sub !== 'guest') {
      if (options?.confirmAction && options?.pendingAction) {
        if (!isActionPermitted(user.role, options.pendingAction.action)) {
          const denial = this.buildDenialResponse(user.role, options.pendingAction.action);
          threadId = await this.safelyPersist(user, question, denial.answer, threadId);
          return { ...denial, threadId };
        }
        const result = await this.executeAction(user, options.pendingAction);
        threadId = await this.safelyPersist(user, question, result.answer, threadId);
        return { ...result, threadId };
      }

      if (options?.pendingAction && !options?.confirmAction) {
        const pending = options.pendingAction;
        if (
          !pending.awaitingSlot &&
          CONFIRM_ANSWER_RE.test(question.trim()) &&
          isActionPermitted(user.role, pending.action)
        ) {
          const result = await this.executeAction(user, pending);
          threadId = await this.safelyPersist(user, question, result.answer, threadId);
          return { ...result, threadId };
        }
        const continued = await this.continueSlotFilling(user, question, pending);
        threadId = await this.safelyPersist(user, question, continued.answer, threadId);
        return { ...continued, threadId };
      }

      actionIntent = await actionIntentDetector.detect(question, user.role);

      if (actionIntent.isAction) {
        if (!isActionPermitted(user.role, actionIntent.action!)) {
          const denial = this.buildDenialResponse(user.role, actionIntent.action!);
          threadId = await this.safelyPersist(user, question, denial.answer, threadId);
          return { ...denial, threadId };
        }

        const actionResult = await this.processDetectedAction(user, {
          action: actionIntent.action!,
          params: actionIntent.params ?? {},
          description: actionIntent.description ?? actionIntent.action!,
        });
        threadId = await this.safelyPersist(user, question, actionResult.answer, threadId);
        return { ...actionResult, threadId };
      }

      const unsupportedOperation = getUnsupportedOperationResponse(question);
      if (unsupportedOperation) {
        threadId = await this.safelyPersist(user, question, unsupportedOperation.answer, threadId);
        return { ...unsupportedOperation, threadId };
      }
    }

    // School admin / HOD / student self-context — DB before local engine (avoids LLM hallucination).
    if (user.sub !== 'guest' && isSchoolPersonnelQuery(question)) {
      try {
        const personnelResult = await queryRoleContext(user, question);
        if (personnelResult) {
          threadId = await this.safelyPersist(user, question, personnelResult.answer, threadId);
          return {
            answer: formatAnswer(personnelResult.answer, user.role),
            intent: personnelResult.intent,
            engine: 'local',
            data: personnelResult.data,
            threadId,
          };
        }
      } catch (err) {
        console.error('[AIService] Role context query failed:', err);
        return {
          answer:
            'I could not load that from SAMS right now. Please try again in a moment or rephrase your question.',
          intent: 'data_query_error',
          engine: 'local',
          threadId,
        };
      }
    }

    // Step 2: Try local engine — wrapped in try-catch so it never throws
    let localResult: AIQueryResult;
    try {
      localResult = await localQuery(user, question);
    } catch (err) {
      console.error('[AIService] Local engine error:', err);
      return {
        answer: `I can help you with:\n• Attendance rates and percentages\n• Absent students today\n• Risk scores and at-risk students\n• Top students by attendance\n• Class attendance comparison\n• Timetable viewing and generation\n• Student counts\n• Active session status\n\nTry asking: "What is the attendance rate?" or "Show my timetable"`,
        intent: 'error_fallback',
        engine: 'local',
      };
    }

    if (localResult.intent !== 'unknown') {
      if (user.sub !== 'guest') {
        threadId = await this.safelyPersist(user, question, localResult.answer, threadId);
        return {
          answer: formatAnswer(localResult.answer, user.role),
          intent: localResult.intent,
          engine: 'local',
          data: localResult.data,
          threadId,
        };
      }
      return {
        answer: formatAnswer(localResult.answer),
        intent: localResult.intent,
        engine: 'local',
        data: localResult.data,
      };
    }

    // Timetable view queries must never fall through to the LLM (avoids hallucinated schedules).
    const timetableResult = await queryTimetableView(user, question);
    if (timetableResult) {
      if (user.sub !== 'guest') {
        threadId = await this.safelyPersist(user, question, timetableResult.answer, threadId);
        return {
          answer: formatAnswer(timetableResult.answer),
          intent: timetableResult.intent,
          engine: 'local',
          data: timetableResult.data,
          threadId,
        };
      }
      return {
        answer: formatAnswer(timetableResult.answer),
        intent: timetableResult.intent,
        engine: 'local',
        data: timetableResult.data,
      };
    }

    // Student HOD, teachers, class, department, class rep — DB-backed answers only.
    const studentContextResult = await queryRoleContext(user, question).catch((err) => {
      console.error('[AIService] Role context query failed:', err);
      return null;
    });
    if (studentContextResult) {
      if (user.sub !== 'guest') {
        threadId = await this.safelyPersist(user, question, studentContextResult.answer, threadId);
        return {
          answer: formatAnswer(studentContextResult.answer),
          intent: studentContextResult.intent,
          engine: 'local',
          data: studentContextResult.data,
          threadId,
        };
      }
      return {
        answer: formatAnswer(studentContextResult.answer),
        intent: studentContextResult.intent,
        engine: 'local',
        data: studentContextResult.data,
      };
    }

    // Attendance, absent lists, risk scores, etc. — never pass to pure LLM (avoids invented numbers).
    const dataFallback = await querySamsDataFallback(user, question);
    if (dataFallback) {
      if (user.sub !== 'guest') {
        threadId = await this.safelyPersist(user, question, dataFallback.answer, threadId);
        return {
          answer: formatAnswer(dataFallback.answer, user.role),
          intent: dataFallback.intent,
          engine: 'local',
          data: dataFallback.data,
          threadId,
        };
      }
      return {
        answer: formatAnswer(dataFallback.answer),
        intent: dataFallback.intent,
        engine: 'local',
        data: dataFallback.data,
      };
    }

    if (isSamsDataQuery(question)) {
      const blocked: AIServiceResponse = {
        answer: SAMS_DATA_NOT_FOUND_MESSAGE,
        intent: 'data_not_found',
        engine: 'local',
        threadId,
      };
      if (user.sub !== 'guest') {
        threadId = await this.safelyPersist(user, question, blocked.answer, threadId);
        blocked.threadId = threadId;
      }
      return blocked;
    }

    // Step 3: Load encrypted conversation history for LLM context
    let historyMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    const clientHistory = normalizeClientHistory(options?.history);
    let memoryNotice: string | undefined;
    let memoryStatus: AIServiceResponse['memoryStatus'];

    if (user.sub !== 'guest' && threadId) {
      try {
        const contextResult = await conversationMemoryService.getContextWindow(
          user.sub,
          user.schoolId,
          threadId,
          20,
        );
        historyMessages = tokenBudgetManager.formatAsMessages(
          tokenBudgetManager.trimToFitBudget(contextResult.records, 2048),
        );
        memoryStatus = contextResult.status;
        memoryNotice = buildMemoryNotice(contextResult.status, contextResult.skippedCount);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          '[AIService] Memory retrieval failed, proceeding without conversation history:',
          msg,
        );
        historyMessages = [];
      }
    } else if (user.sub !== 'guest' && !isConversationMemoryEnabled()) {
      memoryStatus = 'disabled';
    }

    historyMessages = mergeHistoryMessages(historyMessages, clientHistory);

    // Local engine couldn't resolve — try the OpenAI-compatible provider chain.
    if (!hasPrimaryAIKey() && !hasAtomesusAIKey()) {
      const answer = getMissingAIKeyMessage();
      if (user.sub !== 'guest') {
        threadId = await this.safelyPersist(user, question, answer, threadId);
      }
      return {
        answer,
        intent: 'ai_not_configured',
        engine: 'local',
        threadId,
      };
    }

    // Step 4: Call the OpenAI-compatible provider chain with conversation history.
    try {
      const llmActionIntent = user.sub !== 'guest'
        ? await actionIntentDetector.detect(question, user.role)
        : null;

      if (llmActionIntent && llmActionIntent.isAction && !actionIntent?.isAction) {
        const llmAction = llmActionIntent.action!;
        if (isActionPermitted(user.role, llmAction)) {
          const actionResult = await this.processDetectedAction(user, {
            action: llmAction,
            params: llmActionIntent.params ?? {},
            description: llmActionIntent.description ?? llmAction,
          });
          if (user.sub !== 'guest') {
            threadId = await this.safelyPersist(user, question, actionResult.answer, threadId);
          }
          return { ...actionResult, threadId, memoryNotice, memoryStatus };
        }
      }

      const openaiResult = await openaiQueryWithHistory(user, question, historyMessages);

      if (openaiResult.intent === 'ai_error' || openaiResult.intent === 'ai_not_configured') {
        if (user.sub !== 'guest') {
          threadId = await this.safelyPersist(user, question, openaiResult.answer, threadId);
        }
        return {
          answer: openaiResult.answer,
          intent: openaiResult.intent,
          engine: 'openai',
          threadId,
          memoryNotice,
          memoryStatus,
        };
      }

      if (openaiResult.intent === 'feature_gated') {
        return {
          answer: localResult.answer,
          intent: 'unknown',
          engine: 'local',
          threadId,
          memoryNotice,
          memoryStatus,
        };
      }

      if (containsGeneratedSecretLikeText(openaiResult.answer)) {
        const answer =
          'I will not guess license keys, passwords, or reset codes. Those must come from a real SAMS action.';
        if (user.sub !== 'guest') {
          threadId = await this.safelyPersist(user, question, answer, threadId);
        }
        return {
          answer,
          intent: 'guarded_secret',
          engine: 'local',
          threadId,
          memoryNotice,
          memoryStatus,
        };
      }

      if (user.sub !== 'guest') {
        threadId = await this.safelyPersist(user, question, openaiResult.answer, threadId);
      }

      return {
        answer: openaiResult.answer,
        intent: openaiResult.intent,
        engine: 'openai',
        data: openaiResult.data,
        threadId,
        memoryNotice,
        memoryStatus,
      };
    } catch (err) {
      console.error('[AIService] OpenAI fallback failed:', err);
      const answer = formatProviderError(err);
      if (user.sub !== 'guest') {
        threadId = await this.safelyPersist(user, question, answer, threadId);
      }
      return {
        answer,
        intent: 'ai_error',
        engine: 'openai',
        threadId,
        memoryNotice,
        memoryStatus,
      };
    }
  }

  /**
   * Process a voice query (text from client-side speech-to-text).
   * The client performs speech-to-text conversion using Web Speech API,
   * then sends the transcribed text here for processing.
   */
  async voiceQuery(
    user: AccessTokenPayload,
    transcription: string,
    options?: {
      threadId?: string;
      confirmAction?: boolean;
      pendingAction?: PendingAction;
    },
  ): Promise<AIServiceResponse> {
    return this.query(user, transcription, options);
  }

  // ─── Private Helpers ──────────────────────────────────────────────────

  private async continueSlotFilling(
    user: AccessTokenPayload,
    answer: string,
    pending: PendingAction,
  ): Promise<AIServiceResponse> {
    const slot = pending.awaitingSlot;
    if (!slot) {
      return this.processDetectedAction(user, pending);
    }

    const { action, params } = applySlotAnswer(
      pending.action,
      slot as Parameters<typeof applySlotAnswer>[1],
      answer,
      pending.params,
      user.role,
    );

    return this.processDetectedAction(user, {
      action,
      params,
      description: mergePendingDescription(user.role, action, params),
    });
  }

  private async processDetectedAction(
    user: AccessTokenPayload,
    intent: { action: string; params: Record<string, unknown>; description: string },
  ): Promise<AIServiceResponse> {
    let { action, params } = intent;
    const scopedUser = await this.enrichUserScope(user);
    params = await resolveActionParams(scopedUser, action, params);

    const hodBlock = getHodDepartmentBlocker(
      scopedUser,
      action,
      params.departmentId as string | undefined,
    );
    if (hodBlock) {
      return { answer: hodBlock, intent: 'action_denied', engine: 'openai' };
    }

    if (action === 'run_terminal_command') {
      const requestedCommand = String(params.command ?? '').trim();
      if (!requestedCommand.startsWith('@') || !resolveTerminalCommand(requestedCommand)) {
        return {
          answer: `That terminal command is not allowed.\n\n${listTerminalCommandHelp()}`,
          intent: 'action_denied',
          engine: 'local',
        };
      }
    }

    const missingSlot = await getNextMissingSlot(scopedUser, action, params);
    if (missingSlot) {
      const question = await buildSlotQuestion(scopedUser, action, missingSlot, params);
      const pending = buildPendingFromIntent(
        action,
        params,
        mergePendingDescription(scopedUser.role, action, params),
        missingSlot,
      );
      return {
        answer: question,
        intent: 'action_slot_fill',
        engine: 'openai',
        pendingAction: pending,
        requiresConfirmation: false,
      };
    }

    const needsConfirm =
      scopedUser.role === UserRole.SUPER_ADMIN ||
      actionRequiresConfirmation(scopedUser.role, action);
    if (needsConfirm) {
      const description = mergePendingDescription(scopedUser.role, action, params);
      const confirmAnswer = `⚠️ **Confirm Action**: ${description}\n\nReply **yes** to proceed.`;
      return {
        answer: confirmAnswer,
        intent: 'action_confirmation',
        engine: 'openai',
        pendingAction: { action, params, description },
        requiresConfirmation: true,
      };
    }

    return this.executeAction(scopedUser, {
      action,
      params,
      description: intent.description,
    });
  }

  private async enrichUserScope(user: AccessTokenPayload): Promise<AccessTokenPayload> {
    const departmentId = await resolveHodDepartmentId(user);
    if (departmentId && departmentId !== user.departmentId) {
      return { ...user, departmentId };
    }
    return user;
  }

  private async resolveThreadForUser(
    user: AccessTokenPayload,
    threadId?: string,
  ): Promise<string | undefined> {
    if (user.sub === 'guest' || !isConversationMemoryEnabled()) return undefined;
    try {
      return await conversationMemoryService.resolveThread(user.sub, user.schoolId, threadId);
    } catch (err) {
      console.error('[AIService] Thread resolution failed:', err);
      return threadId;
    }
  }

  private async safelyPersist(
    user: AccessTokenPayload,
    message: string,
    response: string,
    threadId?: string,
  ): Promise<string | undefined> {
    if (user.sub === 'guest' || !isConversationMemoryEnabled()) {
      return threadId;
    }
    try {
      const resolvedThreadId =
        threadId || (await conversationMemoryService.resolveThread(user.sub, user.schoolId));
      await conversationMemoryService.persistRecord(
        user.sub,
        user.schoolId,
        resolvedThreadId,
        message.slice(0, 2000),
        response.slice(0, 10000),
      );
      return resolvedThreadId;
    } catch (err) {
      if (!isConversationMemoryEnabled()) {
        console.error(
          '[AIService] Conversation memory disabled — set CONVERSATION_MASTER_KEY (32+ chars) in .env',
        );
      } else {
        console.error('[AIService] Failed to persist conversation record:', err);
      }
      return threadId;
    }
  }

  private async executeAction(
    user: AccessTokenPayload,
    pendingAction: PendingAction,
  ): Promise<AIServiceResponse> {
    const { action, params } = pendingAction;

    const actionDef = findAction(user.role, action);
    if (!actionDef) {
      await this.logDeniedAction(user, action);
      return this.buildDenialResponse(user.role, action);
    }

    const scopedUser = await this.enrichUserScope(user);

    const scope: ActionScope = {
      userId: scopedUser.sub,
      role: scopedUser.role,
      schoolId: scopedUser.schoolId,
      departmentId: scopedUser.departmentId,
      classId: scopedUser.classId,
    };

    try {
      const result = await actionDef.handler(params, scope);

      await auditService.log({
        eventType: 'AI_ACTION_EXECUTED',
        actorId: user.sub,
        actorRole: user.role,
        schoolId: user.schoolId,
        resourceSnapshot: {
          action,
          params,
          result: 'success',
        },
      });

      return {
        answer: result.answer,
        intent: 'action_executed',
        engine: 'local',
        data: result.data,
      };

      // Format the response with HumanResponseFormatter + optional LLM reframe
      try {
        const { getOpenAIClient, resolveChatModel } = await import('./ai/aiProviderConfig');
        const client = getOpenAIClient();
        const reframeResponse = await client.chat.completions.create({
          model: resolveChatModel(),
          messages: [
            {
              role: 'system',
              content: `You are a real person. Your name is SAMS. You just did something for the user — an action in the system.

Your job: say what happened the way a real person would. 2-3 sentences. Think out loud. Keep it casual.

Narrate in phases like this:
Phase 1 — What you checked: "Sawa, I checked the class roster..."
Phase 2 — What happened: "Found 42 students in Form 2A. Sent your message to all of them."
Phase 3 — The result: "Done. They'll see it in their notifications."

Rules:
- You are a PERSON. Never say "as an AI" or "as an assistant."
- Use contractions: "I've", "you're", "that's", "here's"
- Casual but competent Kenyan English: "sawa", "pole", "lemme"
- Keep each phase 1 sentence. Short and real.
- Never mention batchId, endpoints, or any technical backend details.
- If something didn't work, say what happened in plain language: "Couldn't find that student in the system."

Here is the raw result: "${result.answer}"`,
            },
            { role: 'user', content: 'What happened?' },
          ],
          temperature: 0.85,
          max_tokens: 200,
        });

        const reframed = reframeResponse.choices[0]?.message?.content?.trim();
        if (reframed) {
          return {
            answer: formatAnswer(reframed ?? '', user.role),
            intent: 'action_executed',
            engine: 'openai',
            data: result.data,
          };
        }
      } catch {
        // Reframe failed — use formatter on raw handler answer
      }

      return {
        answer: formatAnswer(result.answer, user.role),
        intent: 'action_executed',
        engine: 'openai',
        data: result.data,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const errStack = err instanceof Error ? err.stack : undefined;
      console.error('[AIService] action_executed failed', {
        action,
        role: user.role,
        userId: user.sub,
        schoolId: user.schoolId,
        message: errMsg,
        stack: errStack,
      });
      if (action === 'run_terminal_command') {
        return {
          answer: [
            'The terminal command ran but did not finish successfully.',
            '',
            '```text',
            errMsg,
            '```',
          ].join('\n'),
          intent: 'action_error',
          engine: 'openai',
        };
      }
      return {
        answer: 'The action could not be completed. Please try again or contact support.',
        intent: 'action_error',
        engine: 'openai',
      };
    }
  }

  private buildDenialResponse(role: string, requestedAction: string): AIServiceResponse {
    const permitted = getActionNames(role);
    const suggestions = permitted.length > 0
      ? `You can: ${permitted.map((a) => `\n• ${a}`).join('')}`
      : 'You can ask me questions about your data.';

    return {
      answer: `❌ The action "${requestedAction}" is not available for your role.\n\n${suggestions}`,
      intent: 'action_denied',
      engine: 'openai',
    };
  }

  private async logDeniedAction(user: AccessTokenPayload, action: string): Promise<void> {
    try {
      await auditService.log({
        eventType: 'AI_ACTION_DENIED',
        actorId: user.sub,
        actorRole: user.role,
        schoolId: user.schoolId,
        resourceSnapshot: { action, reason: 'not_permitted_for_role' },
      });
    } catch (err) {
      console.error('[AIService] Failed to log denied action:', err);
    }
  }
}

// ─── Singleton Export ─────────────────────────────────────────────────────────

export const aiService = new AIService();
