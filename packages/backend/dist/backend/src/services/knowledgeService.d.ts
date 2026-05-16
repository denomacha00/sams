import { type AccessTokenPayload, UserRole } from '@sams/shared';
export interface CreateKnowledgeInput {
    title: string;
    content: string;
    category?: string;
}
export interface KnowledgeEntryResponse {
    id: string;
    title: string;
    content: string;
    category: string;
    schoolId: string;
    departmentId: string | null;
    classId: string | null;
    createdById: string;
    creatorName: string;
    creatorRole: UserRole;
    scopeLevel: 'school' | 'department' | 'class';
    createdAt: Date;
    updatedAt: Date;
}
export interface PaginatedKnowledgeResponse {
    entries: KnowledgeEntryResponse[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
}
export declare class KnowledgeService {
    /**
     * Determine scope level from field presence.
     * classId set → 'class', departmentId set → 'department', else → 'school'
     */
    getScopeLevel(entry: {
        departmentId: string | null;
        classId: string | null;
    }): 'school' | 'department' | 'class';
    /**
     * Validate knowledge input fields.
     * Throws AppError 400 on invalid input.
     */
    private validateInput;
    /**
     * Map a raw DB entry (with createdBy include) to the response shape.
     */
    private toResponse;
    /**
     * Create a knowledge entry with role-based scope assignment.
     * - SCHOOL_ADMIN: schoolId=user.schoolId, departmentId=null, classId=null
     * - HOD: schoolId=user.schoolId, departmentId=user.departmentId, classId=null
     * - TEACHER: schoolId=user.schoolId, departmentId=user.departmentId, classId=user.classId
     * - STUDENT: throws 403
     */
    create(user: AccessTokenPayload, input: CreateKnowledgeInput): Promise<KnowledgeEntryResponse>;
    /**
     * Update a knowledge entry.
     * Allowed if user is the creator OR SCHOOL_ADMIN in the same school.
     * Cross-school access returns 404 to avoid leaking existence.
     */
    update(user: AccessTokenPayload, entryId: string, input: Partial<CreateKnowledgeInput>): Promise<KnowledgeEntryResponse>;
    /**
     * Delete a knowledge entry.
     * Allowed if user is the creator OR SCHOOL_ADMIN in the same school.
     * Cross-school access returns 404 to avoid leaking existence.
     */
    delete(user: AccessTokenPayload, entryId: string): Promise<void>;
    /**
     * List knowledge entries scoped to user's role with pagination.
     * - SCHOOL_ADMIN: all entries in their school
     * - HOD: school-wide + department entries
     * - TEACHER: school-wide + department + class entries
     * Includes creator name and role.
     */
    list(user: AccessTokenPayload, page: number, pageSize: number): Promise<PaginatedKnowledgeResponse>;
    /**
     * Get a single knowledge entry by ID (school-scoped).
     * Returns 404 if not found or belongs to a different school.
     */
    getById(user: AccessTokenPayload, entryId: string): Promise<KnowledgeEntryResponse>;
    /**
     * Retrieve all applicable knowledge entries for AI context injection.
     * - SCHOOL_ADMIN: all entries in school
     * - HOD: school-wide + department entries
     * - TEACHER/STUDENT: school-wide + department + class entries
     * Returns only { title, content, category } for prompt injection.
     */
    getForAIContext(user: AccessTokenPayload): Promise<Array<{
        title: string;
        content: string;
        category: string;
    }>>;
    /**
     * Build Prisma where clause for list operations based on user role.
     */
    private buildScopeFilter;
    /**
     * Build Prisma where clause for AI context retrieval based on user role.
     */
    private buildAIScopeFilter;
}
export declare const knowledgeService: KnowledgeService;
//# sourceMappingURL=knowledgeService.d.ts.map