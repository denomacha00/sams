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

export type { PendingAction };

const CONFIRM_ANSWER_RE = /^(yes|y|confirm|proceed|ok|do it|go ahead)\.?$/i;

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

// ─── AI Service ───────────────────────────────────────────────────────────────

/**
 * AIService routes queries to the appropriate engine:
 * - Local engine first for all plans (regex-based, no external API)
 * - Falls back to OpenAI engine for Pro/Enterprise plans when local engine
 *   cannot resolve the query (returns 'unknown' intent)
 * - Integrates conversation memory for contextual follow-up discussions
 * - Detects and executes role-specific action intents for all authenticated users
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
    },
  ): Promise<AIServiceResponse> {
    let threadId = await this.resolveThreadForUser(user, options?.threadId);

    let actionIntent: DetectedAction | null = null;

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
    }

    // School admin / HOD / student self-context — DB before local engine (avoids LLM hallucination).
    if (user.sub !== 'guest' && isSchoolPersonnelQuery(question)) {
      try {
        const personnelResult = await queryRoleContext(user, question);
        if (personnelResult) {
          threadId = await this.safelyPersist(user, question, personnelResult.answer, threadId);
          return {
            answer: personnelResult.answer,
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
          answer: localResult.answer,
          intent: localResult.intent,
          engine: 'local',
          data: localResult.data,
          threadId,
        };
      }
      return {
        answer: localResult.answer,
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
          answer: timetableResult.answer,
          intent: timetableResult.intent,
          engine: 'local',
          data: timetableResult.data,
          threadId,
        };
      }
      return {
        answer: timetableResult.answer,
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
          answer: studentContextResult.answer,
          intent: studentContextResult.intent,
          engine: 'local',
          data: studentContextResult.data,
          threadId,
        };
      }
      return {
        answer: studentContextResult.answer,
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
          answer: dataFallback.answer,
          intent: dataFallback.intent,
          engine: 'local',
          data: dataFallback.data,
          threadId,
        };
      }
      return {
        answer: dataFallback.answer,
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

    // Local engine couldn't resolve — try the OpenAI-compatible provider chain
    if (!hasPrimaryAIKey()) {
      return {
        answer: getMissingAIKeyMessage(),
        intent: 'ai_not_configured',
        engine: 'local',
        threadId,
      };
    }

    // Step 4: Call the OpenAI-compatible provider chain with conversation history
    try {
      const openaiResult = await openaiQueryWithHistory(user, question, historyMessages);

      if (openaiResult.intent === 'ai_error' || openaiResult.intent === 'ai_not_configured') {
        return {
          answer: openaiResult.answer,
          intent: openaiResult.intent,
          engine: 'openai',
          threadId,
          memoryNotice,
          memoryStatus,
        };
      }

      // If OpenAI also couldn't resolve (feature gated or error), return scope message
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

      // Step 5: Persist the new record (non-blocking, errors logged not thrown)
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
      return {
        answer: formatProviderError(err),
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
   *
   * Requirements: 14.6
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
    // Voice queries are processed the same as text queries
    // The client handles speech-to-text conversion
    return this.query(user, transcription, options);
  }

  // ─── Private Helpers ──────────────────────────────────────────────────

  /**
   * Multi-turn slot filling: merge user reply, ask next slot, confirm, or execute.
   */
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

  /**
   * Resolve slots → ask one question → confirm destructive → execute.
   */
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

    const needsConfirm = actionRequiresConfirmation(scopedUser.role, action);
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

  /** Merge HOD departmentId from DB when JWT is stale. */
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

  /**
   * Safely persist a conversation record. Never throws — errors are logged.
   * Returns the resolved threadId (or the original if persistence fails).
   */
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

  /**
   * Unified action executor. Replaces the old executeSuperAdminAction.
   * 1. Validates permission via registry lookup
   * 2. Extracts scope from JWT
   * 3. Dispatches to the action handler
   * 4. Logs audit entry
   * 5. Returns structured response
   */
  private async executeAction(
    user: AccessTokenPayload,
    pendingAction: PendingAction,
  ): Promise<AIServiceResponse> {
    const { action, params } = pendingAction;

    // Authorization check via registry
    const actionDef = findAction(user.role, action);
    if (!actionDef) {
      await this.logDeniedAction(user, action);
      return this.buildDenialResponse(user.role, action);
    }

    const scopedUser = await this.enrichUserScope(user);

    // Build scope from JWT claims (HOD departmentId may come from DB)
    const scope: ActionScope = {
      userId: scopedUser.sub,
      role: scopedUser.role,
      schoolId: scopedUser.schoolId,
      departmentId: scopedUser.departmentId,
      classId: scopedUser.classId,
    };

    try {
      // Dispatch to handler
      const result = await actionDef.handler(params, scope);

      // Audit log
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
      return {
        answer: 'The action could not be completed. Please try again or contact support.',
        intent: 'action_error',
        engine: 'openai',
      };
    }
  }

  /**
   * Build a denial response with role-appropriate suggestions.
   */
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

  /**
   * Log a denied action attempt for audit purposes.
   */
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
