export interface ClassificationResult {
    action: string;
    params?: Record<string, unknown>;
    confidence: number;
}
/**
 * Classify a user message against a list of candidate actions using an LLM.
 * Returns the classified action and extracted parameters, or null on error/timeout.
 *
 * - 5-second timeout for LLM calls
 * - Confidence threshold of 0.7
 * - Graceful degradation: returns null if no API key or on any error
 */
export declare function classifyIntent(message: string, candidates: Array<{
    action: string;
    description: string;
}>): Promise<ClassificationResult | null>;
//# sourceMappingURL=llmActionClassifier.d.ts.map