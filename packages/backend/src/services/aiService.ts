import { type AccessTokenPayload, UserRole } from '@sams/shared';
import { localQuery, type AIQueryResult } from './ai/localEngine';
import { openaiQuery, openaiQueryWithHistory } from './ai/openaiEngine';
import { conversationMemoryService } from './conversationMemoryService';
import { tokenBudgetManager } from './ai/tokenBudgetManager';
import { actionIntentDetector, type DetectedAction } from './ai/actionIntentDetector';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AIServiceResponse {
  answer: string;
  intent: string;
  engine: 'local' | 'openai';
  data?: unknown;
  threadId?: string;
  pendingAction?: PendingAction;
  requiresConfirmation?: boolean;
}

export interface PendingAction {
  action: string;
  params: Record<string, unknown>;
  description: string;
}

// ─── AI Service ───────────────────────────────────────────────────────────────

/**
 * AIService routes queries to the appropriate engine:
 * - Local engine first for all plans (regex-based, no external API)
 * - Falls back to OpenAI engine for Pro/Enterprise plans when local engine
 *   cannot resolve the query (returns 'unknown' intent)
 * - Integrates conversation memory for contextual follow-up discussions
 * - Detects and executes Super Admin action intents
 *
 * Requirements: 1.1, 1.2, 1.6, 5.1, 5.2, 5.3, 5.5, 5.6, 6.1, 6.4, 6.5, 6.6, 11.1, 11.2, 11.3, 11.4, 11.5, 11.8, 11.9, 14.1, 14.7
 */
export class AIService {
  /**
   * Process a text query through the AI pipeline.
   * Routes to local engine first; falls back to OpenAI for Pro/Enterprise.
   * Integrates conversation memory and Super Admin action detection.
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
    // Step 1: Try local engine first — wrapped in try-catch so it never throws
    let localResult: AIQueryResult;
    try {
      localResult = await localQuery(user, question);
    } catch (err) {
      console.error('[AIService] Local engine error:', err);
      // Return a helpful fallback instead of throwing
      return {
        answer: `I can help you with:\n• Attendance rates and percentages\n• Absent students today\n• Risk scores and at-risk students\n• Top students by attendance\n• Class attendance comparison\n• Timetable viewing and generation\n• Student counts\n• Active session status\n\nTry asking: "What is the attendance rate?" or "Show my timetable"`,
        intent: 'error_fallback',
        engine: 'local',
      };
    }

    // If local engine resolved the query, persist to memory and return
    if (localResult.intent !== 'unknown') {
      // Persist to memory for non-guest users (non-blocking)
      if (user.sub !== 'guest') {
        const threadId = await this.safelyPersist(user, question, localResult.answer, options?.threadId);
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

    // Step 2: Check for Super Admin action intent
    if (user.role === UserRole.SUPER_ADMIN) {
      // If user confirmed a pending action — execute it
      if (options?.confirmAction && options?.pendingAction) {
        const result = await this.executeSuperAdminAction(user, options.pendingAction);
        const threadId = await this.safelyPersist(user, question, result.answer, options?.threadId);
        return { ...result, threadId };
      }

      // Detect action intent from the question
      const actionIntent = actionIntentDetector.detect(question, user.role);
      if (actionIntent.isAction) {
        if (actionIntent.requiresConfirmation) {
          // Return confirmation prompt with pendingAction
          return {
            answer: `⚠️ **Confirm Action**: ${actionIntent.description}\n\nDo you want to proceed?`,
            intent: 'action_confirmation',
            engine: 'openai',
            pendingAction: {
              action: actionIntent.action!,
              params: actionIntent.params!,
              description: actionIntent.description!,
            },
            requiresConfirmation: true,
          };
        }
        // Non-destructive action — execute immediately
        const result = await this.executeSuperAdminAction(user, {
          action: actionIntent.action!,
          params: actionIntent.params!,
          description: actionIntent.description!,
        });
        const threadId = await this.safelyPersist(user, question, result.answer, options?.threadId);
        return { ...result, threadId };
      }
    }

    // Step 3: Resolve thread and retrieve conversation history (skip for guest users)
    let threadId: string | undefined;
    let historyMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    if (user.sub !== 'guest') {
      try {
        threadId = await conversationMemoryService.resolveThread(
          user.sub,
          user.schoolId,
          options?.threadId,
        );
        const contextWindow = await conversationMemoryService.getContextWindow(
          user.sub,
          user.schoolId,
          threadId,
          20,
        );
        historyMessages = tokenBudgetManager.formatAsMessages(
          tokenBudgetManager.trimToFitBudget(contextWindow, 2048),
        );
      } catch (err) {
        console.error('[AIService] Memory retrieval failed, proceeding without history:', err);
        // Graceful degradation — continue without history
      }
    }

    // Local engine couldn't resolve — try OpenAI/Groq
    const hasAPIKey = !!process.env.OPENAI_API_KEY;

    if (!hasAPIKey) {
      // No API key configured — return help text
      return {
        answer: localResult.answer,
        intent: 'unknown',
        engine: 'local',
        threadId,
      };
    }

    // Step 4: Call OpenAI/Groq with conversation history
    try {
      const openaiResult = await openaiQueryWithHistory(user, question, historyMessages);

      // If OpenAI also couldn't resolve (feature gated or error), return scope message
      if (openaiResult.intent === 'feature_gated') {
        return {
          answer: localResult.answer,
          intent: 'unknown',
          engine: 'local',
          threadId,
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
      };
    } catch (err) {
      console.error('[AIService] OpenAI fallback failed:', err);
      // If OpenAI fails, return the local engine's help message
      return {
        answer: localResult.answer,
        intent: 'unknown',
        engine: 'local',
        threadId,
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
   * Safely persist a conversation record. Never throws — errors are logged.
   * Returns the resolved threadId (or the original if persistence fails).
   */
  private async safelyPersist(
    user: AccessTokenPayload,
    message: string,
    response: string,
    threadId?: string,
  ): Promise<string | undefined> {
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
      console.error('[AIService] Failed to persist conversation record:', err);
      return threadId;
    }
  }

  /**
   * Execute a Super Admin action directly using Prisma and service calls.
   * Handles: suspend_school, unsuspend_school, extend_license, generate_license,
   * get_school_info, get_system_stats.
   */
  private async executeSuperAdminAction(
    user: AccessTokenPayload,
    pendingAction: PendingAction,
  ): Promise<AIServiceResponse> {
    const { action, params } = pendingAction;

    // Dynamic imports to avoid circular dependencies
    const { prisma } = await import('../index');
    const { licenseService } = await import('./licenseService');
    const { auditService } = await import('./auditService');

    try {
      switch (action) {
        case 'suspend_school': {
          const schoolName = params.schoolName as string;
          if (!schoolName)
            return { answer: 'School name is required.', intent: 'action_error', engine: 'openai' };
          const school = await prisma.school.findFirst({
            where: { name: { contains: schoolName, mode: 'insensitive' } },
          });
          if (!school)
            return {
              answer: `School "${schoolName}" not found.`,
              intent: 'action_error',
              engine: 'openai',
            };
          if (school.isSuspended)
            return {
              answer: `⚠️ School "${school.name}" is already suspended.`,
              intent: 'action_executed',
              engine: 'openai',
            };
          await licenseService.suspendSchool(school.id);
          await auditService.log({
            eventType: 'SCHOOL_SUSPENDED',
            actorId: user.sub,
            actorRole: user.role,
            schoolId: school.id,
            resourceSnapshot: {
              action: 'SCHOOL_SUSPENDED_VIA_AI',
              schoolName: school.name,
            },
          });
          return {
            answer: `✅ School "${school.name}" has been suspended.\n\n• All active sessions revoked\n• Users cannot log in\n• Audit log entry created`,
            intent: 'action_executed',
            engine: 'openai',
            data: { schoolId: school.id, schoolName: school.name },
          };
        }

        case 'unsuspend_school': {
          const schoolName = params.schoolName as string;
          if (!schoolName)
            return { answer: 'School name is required.', intent: 'action_error', engine: 'openai' };
          const school = await prisma.school.findFirst({
            where: { name: { contains: schoolName, mode: 'insensitive' } },
          });
          if (!school)
            return {
              answer: `School "${schoolName}" not found.`,
              intent: 'action_error',
              engine: 'openai',
            };
          if (!school.isSuspended)
            return {
              answer: `ℹ️ School "${school.name}" is not currently suspended.`,
              intent: 'action_executed',
              engine: 'openai',
            };
          await prisma.school.update({
            where: { id: school.id },
            data: { isSuspended: false },
          });
          await auditService.log({
            eventType: 'SCHOOL_SUSPENDED',
            actorId: user.sub,
            actorRole: user.role,
            schoolId: school.id,
            resourceSnapshot: {
              action: 'SCHOOL_UNSUSPENDED_VIA_AI',
              schoolName: school.name,
            },
          });
          return {
            answer: `✅ School "${school.name}" has been unsuspended.\n\n• Users can now log in\n• Full access restored`,
            intent: 'action_executed',
            engine: 'openai',
            data: { schoolId: school.id, schoolName: school.name },
          };
        }

        case 'extend_license': {
          const schoolName = params.schoolName as string;
          const daysToAdd = (params.daysToAdd as number) || 30;
          if (!schoolName)
            return { answer: 'School name is required.', intent: 'action_error', engine: 'openai' };
          const school = await prisma.school.findFirst({
            where: { name: { contains: schoolName, mode: 'insensitive' } },
          });
          if (!school)
            return {
              answer: `School "${schoolName}" not found.`,
              intent: 'action_error',
              engine: 'openai',
            };
          const baseDate =
            school.licenseExpiresAt > new Date() ? school.licenseExpiresAt : new Date();
          const newExpiry = new Date(baseDate);
          newExpiry.setDate(newExpiry.getDate() + daysToAdd);
          await licenseService.extendLicense(school.id, newExpiry);
          return {
            answer: `✅ License extended for "${school.name}".\n\n• Previous expiry: ${school.licenseExpiresAt.toLocaleDateString()}\n• New expiry: ${newExpiry.toLocaleDateString()}\n• Days added: ${daysToAdd}`,
            intent: 'action_executed',
            engine: 'openai',
            data: { schoolId: school.id, newExpiry: newExpiry.toISOString() },
          };
        }

        case 'generate_license': {
          const schoolName = (params.schoolName as string) || 'Unnamed School';
          const planTier = (params.planTier as string) || 'BASIC';
          const daysValid = (params.daysValid as number) || 365;
          const expiresAt = new Date();
          expiresAt.setDate(expiresAt.getDate() + daysValid);

          const { createHash } = await import('crypto');
          const { encodeLicenseKey } = await import('@sams/shared');

          const secret =
            process.env.LICENSE_SECRET || process.env.JWT_SECRET || 'default-license-secret';
          const rawKey = encodeLicenseKey(
            { schoolName, planTier: planTier as any, expiresAt },
            secret,
          );
          const keyHash = createHash('sha256').update(rawKey).digest('hex');

          await prisma.licenseKey.create({
            data: {
              keyHash,
              planTier: planTier as any,
              schoolName,
              expiresAt,
            },
          });

          await auditService.log({
            eventType: 'LICENSE_ACTIVATION',
            actorId: user.sub,
            actorRole: user.role,
            resourceSnapshot: {
              action: 'LICENSE_GENERATED_VIA_AI',
              schoolName,
              planTier,
            },
          });

          return {
            answer: `✅ License generated!\n\n**Key:** \`${rawKey}\`\n\n• School: ${schoolName}\n• Plan: ${planTier}\n• Expires: ${expiresAt.toLocaleDateString()}\n\n⚠️ Store this key securely.`,
            intent: 'action_executed',
            engine: 'openai',
            data: { licenseKey: rawKey, schoolName, planTier },
          };
        }

        case 'get_school_info': {
          const schoolName = params.schoolName as string;
          if (!schoolName)
            return { answer: 'School name is required.', intent: 'action_error', engine: 'openai' };
          const school = await prisma.school.findFirst({
            where: { name: { contains: schoolName, mode: 'insensitive' } },
            include: {
              _count: { select: { users: true, sessions: true, payments: true } },
            },
          });
          if (!school)
            return {
              answer: `School "${schoolName}" not found.`,
              intent: 'action_error',
              engine: 'openai',
            };
          return {
            answer: `📋 **${school.name}**\n\n• Code: ${school.schoolCode}\n• Plan: ${school.planTier}\n• Expires: ${school.licenseExpiresAt.toLocaleDateString()}\n• Suspended: ${school.isSuspended ? 'Yes ⚠️' : 'No ✅'}\n• Users: ${(school as any)._count.users}\n• Sessions: ${(school as any)._count.sessions}\n• Payments: ${(school as any)._count.payments}`,
            intent: 'action_executed',
            engine: 'openai',
            data: school,
          };
        }

        case 'get_system_stats': {
          const [totalSchools, totalStudents, totalTeachers, activeSessions, suspendedSchools] =
            await Promise.all([
              prisma.school.count(),
              prisma.user.count({ where: { role: 'STUDENT' } }),
              prisma.user.count({ where: { role: 'TEACHER' } }),
              prisma.attendanceSession.count({ where: { isActive: true } }),
              prisma.school.count({ where: { isSuspended: true } }),
            ]);
          const revenue = await prisma.payment.aggregate({
            where: { status: 'SUCCESS' },
            _sum: { amount: true },
          });
          return {
            answer: `📊 **System Stats**\n\n• Schools: ${totalSchools}\n• Students: ${totalStudents}\n• Teachers: ${totalTeachers}\n• Active Sessions: ${activeSessions}\n• Suspended: ${suspendedSchools}\n• Revenue: KES ${(revenue._sum.amount || 0).toLocaleString()}`,
            intent: 'action_executed',
            engine: 'openai',
            data: {
              totalSchools,
              totalStudents,
              totalTeachers,
              activeSessions,
              suspendedSchools,
            },
          };
        }

        default:
          return {
            answer: `Unknown action: ${action}`,
            intent: 'action_error',
            engine: 'openai',
          };
      }
    } catch (err) {
      return {
        answer: `Failed to execute action: ${err instanceof Error ? err.message : 'Unknown error'}`,
        intent: 'action_error',
        engine: 'openai',
      };
    }
  }
}

// ─── Singleton Export ─────────────────────────────────────────────────────────

export const aiService = new AIService();
