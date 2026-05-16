export interface DecryptedConversationRecord {
    id: string;
    message: string;
    response: string;
    createdAt: Date;
}
/**
 * Manages the 2,048-token budget for conversation history injection.
 * Trims oldest records first to fit within the budget and formats
 * records as alternating user/assistant message pairs for the chat API.
 */
declare class TokenBudgetManager {
    /**
     * Estimate token count for a string using the chars/4 heuristic.
     * This is a conservative approximation — actual tokenization varies by model.
     */
    estimateTokens(text: string): number;
    /**
     * Trim records to fit within the token budget, removing oldest first.
     * Records are expected in chronological order (oldest first).
     * Processes from newest to oldest, prepending to result to maintain order.
     */
    trimToFitBudget(records: DecryptedConversationRecord[], maxTokens: number): DecryptedConversationRecord[];
    /**
     * Format records as alternating user/assistant message pairs for the chat API.
     */
    formatAsMessages(records: DecryptedConversationRecord[]): Array<{
        role: 'user' | 'assistant';
        content: string;
    }>;
}
export declare const tokenBudgetManager: TokenBudgetManager;
export {};
//# sourceMappingURL=tokenBudgetManager.d.ts.map