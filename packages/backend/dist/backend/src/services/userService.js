"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.userService = exports.UserService = void 0;
const bcrypt_1 = __importDefault(require("bcrypt"));
const shared_1 = require("@sams/shared");
const index_1 = require("../index");
const licenseService_1 = require("./licenseService");
const errors_1 = require("../middleware/errors");
// ─── Constants ────────────────────────────────────────────────────────────────
const BCRYPT_ROUNDS = 12;
// ─── Helper ───────────────────────────────────────────────────────────────────
/**
 * Strips the passwordHash field from a user record before returning to callers.
 */
function excludePasswordHash(user) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passwordHash, ...rest } = user;
    return rest;
}
// ─── User Service ─────────────────────────────────────────────────────────────
class UserService {
    /**
     * Create a new user within a school.
     * If the role is STUDENT, checks the school's plan student limit first.
     * Hashes the password with bcrypt cost 12.
     * Returns the created user without the passwordHash field.
     *
     * Requirements: 4.1, 12.1, 12.6
     */
    async createUser(schoolId, data) {
        // If creating a student, check the plan limit
        if (data.role === shared_1.UserRole.STUDENT) {
            await licenseService_1.licenseService.checkStudentLimit(schoolId);
        }
        // Hash the password
        const passwordHash = await bcrypt_1.default.hash(data.password, BCRYPT_ROUNDS);
        const user = await index_1.prisma.user.create({
            data: {
                schoolId,
                role: data.role,
                fullName: data.fullName,
                email: data.email ?? null,
                phone: data.phone ?? null,
                admissionNumber: data.admissionNumber ?? null,
                passwordHash,
                departmentId: data.departmentId || null,
                classId: data.classId || null,
            },
        });
        return excludePasswordHash(user);
    }
    /**
     * Update an existing user. Asserts school ownership before updating.
     * Returns the updated user without the passwordHash field.
     *
     * Requirements: 4.2
     */
    async updateUser(schoolId, userId, data) {
        const user = await index_1.prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
            throw new errors_1.AppError(404, 'USER_NOT_FOUND', 'User not found');
        }
        if (user.schoolId !== schoolId) {
            throw new errors_1.AppError(403, 'FORBIDDEN', 'Access to this resource is not allowed');
        }
        const updated = await index_1.prisma.user.update({
            where: { id: userId },
            data: {
                ...(data.fullName !== undefined && { fullName: data.fullName }),
                ...(data.email !== undefined && { email: data.email }),
                ...(data.phone !== undefined && { phone: data.phone }),
                ...(data.departmentId !== undefined && { departmentId: data.departmentId }),
                ...(data.classId !== undefined && { classId: data.classId }),
                ...(data.isLocked !== undefined && { isLocked: data.isLocked }),
            },
        });
        return excludePasswordHash(updated);
    }
    /**
     * Delete a user. Asserts school ownership before deleting.
     *
     * Requirements: 4.3
     */
    async deleteUser(schoolId, userId) {
        const user = await index_1.prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
            throw new errors_1.AppError(404, 'USER_NOT_FOUND', 'User not found');
        }
        if (user.schoolId !== schoolId) {
            throw new errors_1.AppError(403, 'FORBIDDEN', 'Access to this resource is not allowed');
        }
        await index_1.prisma.user.delete({ where: { id: userId } });
    }
    /**
     * List users scoped to a school with optional filters.
     * Excludes passwordHash from all returned records.
     *
     * Requirements: 4.4
     */
    async listUsers(schoolId, filters) {
        const where = { schoolId };
        if (filters?.role) {
            where.role = filters.role;
        }
        if (filters?.departmentId) {
            where.departmentId = filters.departmentId;
        }
        if (filters?.classId) {
            where.classId = filters.classId;
        }
        const users = await index_1.prisma.user.findMany({ where });
        return users.map(excludePasswordHash);
    }
    /**
     * Get a single user by ID. Asserts school ownership.
     * Returns the user without the passwordHash field.
     *
     * Requirements: 4.5
     */
    async getUser(schoolId, userId) {
        const user = await index_1.prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
            throw new errors_1.AppError(404, 'USER_NOT_FOUND', 'User not found');
        }
        if (user.schoolId !== schoolId) {
            throw new errors_1.AppError(403, 'FORBIDDEN', 'Access to this resource is not allowed');
        }
        return excludePasswordHash(user);
    }
}
exports.UserService = UserService;
// ─── Singleton Export ─────────────────────────────────────────────────────────
exports.userService = new UserService();
//# sourceMappingURL=userService.js.map