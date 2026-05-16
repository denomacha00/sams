export interface DetectedAction {
    isAction: boolean;
    action?: string;
    params?: Record<string, unknown>;
    requiresConfirmation: boolean;
    description?: string;
}
/**
 * Classifies user messages as informational queries or action requests.
 * Uses a hybrid approach:
 *   1. Regex patterns from the Role-Action Registry (fast path)
 *   2. LLM fallback classification with role-scoped candidates (slow path)
 *
 * Supports all roles — no longer restricted to SUPER_ADMIN.
 */
declare class ActionIntentDetector {
    /**
     * Detect whether a message is an action request for the given role.
     * Step 1: Try regex patterns from the registry for this role.
     * Step 2: If no regex match, invoke LLM fallback with role-scoped candidates.
     */
    detect(message: string, userRole: string): Promise<DetectedAction>;
    /**
     * Regex-based detection. Iterates patterns for the user's role only.
     */
    private detectByRegex;
    /**
     * LLM fallback detection. Sends the message and role-permitted action
     * list to the LLM for classification.
     */
    private detectByLLM;
}
export declare const actionIntentDetector: ActionIntentDetector;
export {};
//# sourceMappingURL=actionIntentDetector.d.ts.map