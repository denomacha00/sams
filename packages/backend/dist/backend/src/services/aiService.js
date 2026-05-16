"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.aiService = exports.AIService = void 0;
const localEngine_1 = require("./ai/localEngine");
const openaiEngine_1 = require("./ai/openaiEngine");
const conversationMemoryService_1 = require("./conversationMemoryService");
const tokenBudgetManager_1 = require("./ai/tokenBudgetManager");
const actionIntentDetector_1 = require("./ai/actionIntentDetector");
const roleActionRegistry_1 = require("./ai/roleActionRegistry");
const auditService_1 = require("./auditService");
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
class AIService {
    /**
     * Process a text query through the AI pipeline.
     * Routes to local engine first; falls back to OpenAI for Pro/Enterprise.
     * Integrates conversation memory and role-aware action detection.
     */
    async query(user, question, options) {
        // Step 1: Try local engine first — wrapped in try-catch so it never throws
        let localResult;
        try {
            localResult = await (0, localEngine_1.localQuery)(user, question);
        }
        catch (err) {
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
        // Step 2: Action intent detection for ALL authenticated users (not just SUPER_ADMIN)
        if (user.sub !== 'guest') {
            // If user confirmed a pending action — execute it
            if (options?.confirmAction && options?.pendingAction) {
                const result = await this.executeAction(user, options.pendingAction);
                const threadId = await this.safelyPersist(user, question, result.answer, options?.threadId);
                return { ...result, threadId };
            }
            // Detect action intent using the registry for the user's role
            const actionIntent = await actionIntentDetector_1.actionIntentDetector.detect(question, user.role);
            if (actionIntent.isAction) {
                // Defense in depth: verify action is permitted for this role
                if (!(0, roleActionRegistry_1.isActionPermitted)(user.role, actionIntent.action)) {
                    return this.buildDenialResponse(user.role, actionIntent.action);
                }
                if (actionIntent.requiresConfirmation) {
                    // Return confirmation prompt with pendingAction
                    return {
                        answer: `⚠️ **Confirm Action**: ${actionIntent.description}\n\nDo you want to proceed?`,
                        intent: 'action_confirmation',
                        engine: 'openai',
                        pendingAction: {
                            action: actionIntent.action,
                            params: actionIntent.params,
                            description: actionIntent.description,
                        },
                        requiresConfirmation: true,
                    };
                }
                // Non-destructive action — execute immediately
                const result = await this.executeAction(user, {
                    action: actionIntent.action,
                    params: actionIntent.params,
                    description: actionIntent.description,
                });
                const threadId = await this.safelyPersist(user, question, result.answer, options?.threadId);
                return { ...result, threadId };
            }
        }
        // Step 3: Resolve thread and retrieve conversation history (skip for guest users)
        let threadId;
        let historyMessages = [];
        if (user.sub !== 'guest') {
            try {
                threadId = await conversationMemoryService_1.conversationMemoryService.resolveThread(user.sub, user.schoolId, options?.threadId);
                const contextWindow = await conversationMemoryService_1.conversationMemoryService.getContextWindow(user.sub, user.schoolId, threadId, 20);
                historyMessages = tokenBudgetManager_1.tokenBudgetManager.formatAsMessages(tokenBudgetManager_1.tokenBudgetManager.trimToFitBudget(contextWindow, 2048));
            }
            catch (err) {
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
            const openaiResult = await (0, openaiEngine_1.openaiQueryWithHistory)(user, question, historyMessages);
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
        }
        catch (err) {
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
    async voiceQuery(user, transcription, options) {
        // Voice queries are processed the same as text queries
        // The client handles speech-to-text conversion
        return this.query(user, transcription, options);
    }
    // ─── Private Helpers ──────────────────────────────────────────────────
    /**
     * Safely persist a conversation record. Never throws — errors are logged.
     * Returns the resolved threadId (or the original if persistence fails).
     */
    async safelyPersist(user, message, response, threadId) {
        try {
            const resolvedThreadId = threadId || (await conversationMemoryService_1.conversationMemoryService.resolveThread(user.sub, user.schoolId));
            await conversationMemoryService_1.conversationMemoryService.persistRecord(user.sub, user.schoolId, resolvedThreadId, message.slice(0, 2000), response.slice(0, 10000));
            return resolvedThreadId;
        }
        catch (err) {
            console.error('[AIService] Failed to persist conversation record:', err);
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
    async executeAction(user, pendingAction) {
        const { action, params } = pendingAction;
        // Authorization check via registry
        const actionDef = (0, roleActionRegistry_1.findAction)(user.role, action);
        if (!actionDef) {
            await this.logDeniedAction(user, action);
            return this.buildDenialResponse(user.role, action);
        }
        // Build scope from JWT claims
        const scope = {
            userId: user.sub,
            role: user.role,
            schoolId: user.schoolId,
            departmentId: user.departmentId,
            classId: user.classId,
        };
        try {
            // Dispatch to handler
            const result = await actionDef.handler(params, scope);
            // Audit log
            await auditService_1.auditService.log({
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
        }
        catch (err) {
            console.error('[AIService] Action execution failed:', err);
            // Safe error response — no internal details exposed
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
    buildDenialResponse(role, requestedAction) {
        const permitted = (0, roleActionRegistry_1.getActionNames)(role);
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
    async logDeniedAction(user, action) {
        try {
            await auditService_1.auditService.log({
                eventType: 'AI_ACTION_DENIED',
                actorId: user.sub,
                actorRole: user.role,
                schoolId: user.schoolId,
                resourceSnapshot: { action, reason: 'not_permitted_for_role' },
            });
        }
        catch (err) {
            console.error('[AIService] Failed to log denied action:', err);
        }
    }
}
exports.AIService = AIService;
// ─── Singleton Export ─────────────────────────────────────────────────────────
exports.aiService = new AIService();
//# sourceMappingURL=aiService.js.map