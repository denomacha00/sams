"use strict";
// ─── Types ────────────────────────────────────────────────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
exports.tokenBudgetManager = void 0;
// ─── Token Budget Manager ─────────────────────────────────────────────────────
/**
 * Manages the 2,048-token budget for conversation history injection.
 * Trims oldest records first to fit within the budget and formats
 * records as alternating user/assistant message pairs for the chat API.
 */
class TokenBudgetManager {
    /**
     * Estimate token count for a string using the chars/4 heuristic.
     * This is a conservative approximation — actual tokenization varies by model.
     */
    estimateTokens(text) {
        return Math.ceil(text.length / 4);
    }
    /**
     * Trim records to fit within the token budget, removing oldest first.
     * Records are expected in chronological order (oldest first).
     * Processes from newest to oldest, prepending to result to maintain order.
     */
    trimToFitBudget(records, maxTokens) {
        let totalTokens = 0;
        const result = [];
        // Process from newest to oldest
        for (let i = records.length - 1; i >= 0; i--) {
            const record = records[i];
            const recordTokens = this.estimateTokens(record.message) + this.estimateTokens(record.response);
            if (totalTokens + recordTokens > maxTokens) {
                break; // Budget exceeded — stop including older records
            }
            totalTokens += recordTokens;
            result.unshift(record); // Prepend to maintain chronological order
        }
        return result;
    }
    /**
     * Format records as alternating user/assistant message pairs for the chat API.
     */
    formatAsMessages(records) {
        const messages = [];
        for (const record of records) {
            messages.push({ role: 'user', content: record.message });
            messages.push({ role: 'assistant', content: record.response });
        }
        return messages;
    }
}
// ─── Singleton Export ─────────────────────────────────────────────────────────
exports.tokenBudgetManager = new TokenBudgetManager();
//# sourceMappingURL=tokenBudgetManager.js.map