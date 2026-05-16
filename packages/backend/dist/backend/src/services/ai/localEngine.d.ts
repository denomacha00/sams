import { type AccessTokenPayload } from '@sams/shared';
export interface AIQueryResult {
    answer: string;
    intent: string;
    data?: unknown;
}
export type DetectedIntent = 'attendance_percentage' | 'absent_students' | 'risk_scores' | 'top_students' | 'class_comparison' | 'generate_timetable' | 'remake_timetable' | 'view_timetable' | 'student_count' | 'session_status' | 'about_sams' | 'super_admin_help' | 'system_stats' | 'custom_knowledge' | 'unknown';
/**
 * Detect the user's intent from a natural language question using regex patterns.
 */
export declare function detectIntent(question: string): DetectedIntent;
/**
 * Local query engine that uses regex-based intent detection and scoped DB queries.
 * Does not require any external AI provider.
 * NEVER throws — always returns a result.
 */
export declare function localQuery(user: AccessTokenPayload, question: string): Promise<AIQueryResult>;
//# sourceMappingURL=localEngine.d.ts.map