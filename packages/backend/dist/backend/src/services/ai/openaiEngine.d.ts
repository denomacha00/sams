import { type AccessTokenPayload } from '@sams/shared';
export interface OpenAIQueryResult {
    answer: string;
    intent: string;
    data?: unknown;
}
/**
 * OpenAI-powered query engine using function calling.
 * Gated behind LicenseService.checkFeatureAccess('ai') — Pro/Enterprise only.
 *
 * Requirements: 14.5, 14.6
 */
export declare function openaiQuery(user: AccessTokenPayload, question: string): Promise<OpenAIQueryResult>;
/**
 * OpenAI-powered query with conversation history injection.
 * Injects prior conversation messages between system prompt and current question.
 */
export declare function openaiQueryWithHistory(user: AccessTokenPayload, question: string, history: Array<{
    role: 'user' | 'assistant';
    content: string;
}>): Promise<OpenAIQueryResult>;
//# sourceMappingURL=openaiEngine.d.ts.map