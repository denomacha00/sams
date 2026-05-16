import { type AccessTokenPayload } from '@sams/shared';
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
export declare class AIService {
    /**
     * Process a text query through the AI pipeline.
     * Routes to local engine first; falls back to OpenAI for Pro/Enterprise.
     * Integrates conversation memory and role-aware action detection.
     */
    query(user: AccessTokenPayload, question: string, options?: {
        threadId?: string;
        confirmAction?: boolean;
        pendingAction?: PendingAction;
    }): Promise<AIServiceResponse>;
    /**
     * Process a voice query (text from client-side speech-to-text).
     * The client performs speech-to-text conversion using Web Speech API,
     * then sends the transcribed text here for processing.
     *
     * Requirements: 14.6
     */
    voiceQuery(user: AccessTokenPayload, transcription: string, options?: {
        threadId?: string;
        confirmAction?: boolean;
        pendingAction?: PendingAction;
    }): Promise<AIServiceResponse>;
    /**
     * Safely persist a conversation record. Never throws — errors are logged.
     * Returns the resolved threadId (or the original if persistence fails).
     */
    private safelyPersist;
    /**
     * Unified action executor. Replaces the old executeSuperAdminAction.
     * 1. Validates permission via registry lookup
     * 2. Extracts scope from JWT
     * 3. Dispatches to the action handler
     * 4. Logs audit entry
     * 5. Returns structured response
     */
    private executeAction;
    /**
     * Build a denial response with role-appropriate suggestions.
     */
    private buildDenialResponse;
    /**
     * Log a denied action attempt for audit purposes.
     */
    private logDeniedAction;
}
export declare const aiService: AIService;
//# sourceMappingURL=aiService.d.ts.map