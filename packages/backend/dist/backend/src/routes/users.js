"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registrationLinksRouter = exports.usersRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const multer_1 = __importDefault(require("multer"));
const sharp_1 = __importDefault(require("sharp"));
const shared_1 = require("@sams/shared");
const rbac_1 = require("../middleware/rbac");
const userService_1 = require("../services/userService");
const registrationLinkService_1 = require("../services/registrationLinkService");
const index_1 = require("../index");
const errors_1 = require("../middleware/errors");
// ─── Avatar Upload Config ─────────────────────────────────────────────────────
const UPLOADS_DIR = path_1.default.resolve(process.env.UPLOADS_DIR || '/var/www/sams/uploads/avatars');
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
    fileFilter: (_req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        }
        else {
            cb(new Error('Only image files are allowed'));
        }
    },
});
// ─── Validation Schemas ───────────────────────────────────────────────────────
const createUserSchema = zod_1.z.object({
    role: zod_1.z.nativeEnum(shared_1.UserRole),
    fullName: zod_1.z.string().min(1).max(200),
    email: zod_1.z.string().email().optional(),
    phone: zod_1.z.string().min(9).max(15).optional(),
    admissionNumber: zod_1.z.string().optional(),
    password: zod_1.z.string().min(8),
    departmentId: zod_1.z.string().optional(),
    classId: zod_1.z.string().optional(),
});
const updateUserSchema = zod_1.z.object({
    fullName: zod_1.z.string().min(1).max(200).optional(),
    email: zod_1.z.string().email().optional(),
    phone: zod_1.z.string().min(9).max(15).optional(),
    departmentId: zod_1.z.string().optional(),
    classId: zod_1.z.string().optional(),
    isLocked: zod_1.z.boolean().optional(),
});
const generateLinkSchema = zod_1.z.object({
    classId: zod_1.z.string().optional(),
    departmentId: zod_1.z.string().optional(),
    expiryDays: zod_1.z.number().int().min(7).max(365).optional(),
    maxUses: zod_1.z.number().int().min(1).optional(),
    targetRole: zod_1.z.enum(['TEACHER', 'STUDENT', 'HOD']).optional(),
});
const registerViaLinkSchema = zod_1.z.object({
    fullName: zod_1.z.string().min(1).max(200),
    username: zod_1.z.string().min(3).max(50),
    phone: zod_1.z.string().min(9).max(15).optional(),
    password: zod_1.z.string().min(8),
    admissionNumber: zod_1.z.string().min(1).max(50).optional(),
});
const updateMeSchema = zod_1.z.object({
    username: zod_1.z.string().min(3).max(50).optional(),
    fullName: zod_1.z.string().min(1).max(200).optional(),
    email: zod_1.z.string().email().optional(),
    phone: zod_1.z.string().min(9).max(15).optional(),
});
// ─── Router ───────────────────────────────────────────────────────────────────
exports.usersRouter = (0, express_1.Router)();
/**
 * PATCH /api/v1/users/me
 * Update the authenticated user's own profile.
 */
exports.usersRouter.patch('/me', async (req, res) => {
    const parsed = updateMeSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({
            error: 'Validation failed',
            code: 'VALIDATION_ERROR',
            details: parsed.error.flatten().fieldErrors,
        });
        return;
    }
    try {
        // If username is being changed, check uniqueness
        if (parsed.data.username) {
            const existing = await index_1.prisma.user.findUnique({
                where: { username: parsed.data.username },
            });
            if (existing && existing.id !== req.user.sub) {
                throw new errors_1.AppError(400, 'USERNAME_TAKEN', 'This username is already taken');
            }
        }
        // Students cannot change their fullName (only admins/teachers can)
        const isStudent = req.user.role === 'STUDENT';
        const updated = await index_1.prisma.user.update({
            where: { id: req.user.sub },
            data: {
                ...(parsed.data.username && { username: parsed.data.username }),
                ...(!isStudent && parsed.data.fullName && { fullName: parsed.data.fullName }),
                ...(parsed.data.email && { email: parsed.data.email }),
                ...(parsed.data.phone && { phone: parsed.data.phone }),
            },
            select: {
                id: true,
                username: true,
                fullName: true,
                email: true,
                phone: true,
                role: true,
                avatarUrl: true,
            },
        });
        res.status(200).json(updated);
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            throw err;
        throw new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to update profile');
    }
});
/**
 * POST /api/v1/users/me/password
 * Change the authenticated user's password.
 */
exports.usersRouter.post('/me/password', async (req, res) => {
    const schema = zod_1.z.object({
        currentPassword: zod_1.z.string().min(1),
        newPassword: zod_1.z.string().min(8),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({
            error: 'Validation failed',
            code: 'VALIDATION_ERROR',
            details: parsed.error.flatten().fieldErrors,
        });
        return;
    }
    try {
        const bcrypt = await Promise.resolve().then(() => __importStar(require('bcrypt')));
        const user = await index_1.prisma.user.findUnique({ where: { id: req.user.sub } });
        if (!user) {
            throw new errors_1.AppError(404, 'USER_NOT_FOUND', 'User not found');
        }
        const valid = await bcrypt.compare(parsed.data.currentPassword, user.passwordHash);
        if (!valid) {
            throw new errors_1.AppError(400, 'INVALID_PASSWORD', 'Current password is incorrect');
        }
        const newHash = await bcrypt.hash(parsed.data.newPassword, 12);
        await index_1.prisma.user.update({
            where: { id: req.user.sub },
            data: { passwordHash: newHash },
        });
        res.status(200).json({ message: 'Password changed successfully' });
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            throw err;
        throw new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to change password');
    }
});
/**
 * POST /api/v1/users/me/avatar
 * Upload and resize profile picture (200x200 JPEG).
 */
exports.usersRouter.post('/me/avatar', upload.single('avatar'), async (req, res) => {
    try {
        if (!req.file) {
            throw new errors_1.AppError(400, 'NO_FILE', 'No image file provided');
        }
        // Ensure uploads directory exists
        if (!fs_1.default.existsSync(UPLOADS_DIR)) {
            fs_1.default.mkdirSync(UPLOADS_DIR, { recursive: true });
        }
        // Resize to 200x200 and convert to JPEG
        const filename = `${req.user.sub}.jpg`;
        const filepath = path_1.default.join(UPLOADS_DIR, filename);
        await (0, sharp_1.default)(req.file.buffer)
            .resize(200, 200, { fit: 'cover', position: 'center' })
            .jpeg({ quality: 85 })
            .toFile(filepath);
        // Save URL to database
        const avatarUrl = `/uploads/avatars/${filename}`;
        await index_1.prisma.user.update({
            where: { id: req.user.sub },
            data: { avatarUrl },
        });
        res.status(200).json({ avatarUrl });
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            throw err;
        throw new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to upload avatar');
    }
});
/**
 * GET /api/v1/users
 * List users scoped to the authenticated user's school.
 */
exports.usersRouter.get('/', (0, rbac_1.requirePermission)('manage:users'), async (req, res) => {
    try {
        const filters = {
            role: req.query.role,
            departmentId: req.query.departmentId,
            classId: req.query.classId,
        };
        const users = await userService_1.userService.listUsers(req.schoolId, filters);
        res.status(200).json(users);
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            throw err;
        throw new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to list users');
    }
});
/**
 * POST /api/v1/users
 * Create a new user within the school.
 */
exports.usersRouter.post('/', (0, rbac_1.requirePermission)('manage:users'), async (req, res) => {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({
            error: 'Validation failed',
            code: 'VALIDATION_ERROR',
            details: parsed.error.flatten().fieldErrors,
        });
        return;
    }
    try {
        const user = await userService_1.userService.createUser(req.schoolId, parsed.data);
        res.status(201).json(user);
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            throw err;
        throw new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to create user');
    }
});
/**
 * GET /api/v1/users/:id
 * Get a single user by ID.
 */
exports.usersRouter.get('/:id', async (req, res) => {
    try {
        const user = await userService_1.userService.getUser(req.schoolId, req.params.id);
        res.status(200).json(user);
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            throw err;
        throw new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to get user');
    }
});
/**
 * PUT /api/v1/users/:id
 * Update a user.
 */
exports.usersRouter.put('/:id', (0, rbac_1.requirePermission)('manage:users'), async (req, res) => {
    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({
            error: 'Validation failed',
            code: 'VALIDATION_ERROR',
            details: parsed.error.flatten().fieldErrors,
        });
        return;
    }
    try {
        const user = await userService_1.userService.updateUser(req.schoolId, req.params.id, parsed.data);
        res.status(200).json(user);
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            throw err;
        throw new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to update user');
    }
});
/**
 * DELETE /api/v1/users/:id
 * Delete a user.
 */
exports.usersRouter.delete('/:id', (0, rbac_1.requirePermission)('manage:users'), async (req, res) => {
    try {
        await userService_1.userService.deleteUser(req.schoolId, req.params.id);
        res.status(204).send();
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            throw err;
        throw new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to delete user');
    }
});
// ─── Registration Links ───────────────────────────────────────────────────────
exports.registrationLinksRouter = (0, express_1.Router)();
/**
 * GET /api/v1/registration-links
 * List registration links scoped by the user's role.
 * - SCHOOL_ADMIN sees all links for the school
 * - HOD sees only links they created
 * - Other roles get 403
 * - Unauthenticated requests get empty array (public access compatibility)
 */
exports.registrationLinksRouter.get('/', async (req, res) => {
    // This route is under PUBLIC_PATHS so req.user might not be set
    // If no user (public access), return empty
    if (!req.user || !req.schoolId) {
        res.json([]);
        return;
    }
    try {
        const links = await registrationLinkService_1.registrationLinkService.getLinksForUser(req.user.sub, req.user.role, req.schoolId);
        res.json(links);
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            throw err;
        res.json([]);
    }
});
/**
 * POST /api/v1/registration-links
 * Generate a registration link. Requires manage:users permission.
 */
exports.registrationLinksRouter.post('/', async (req, res) => {
    // Allow SCHOOL_ADMIN, HOD, and TEACHER to generate links
    const allowedRoles = ['SCHOOL_ADMIN', 'HOD', 'TEACHER'];
    if (!req.user || !allowedRoles.includes(req.user.role)) {
        res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
        return;
    }
    const parsed = generateLinkSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({
            error: 'Validation failed',
            code: 'VALIDATION_ERROR',
            details: parsed.error.flatten().fieldErrors,
        });
        return;
    }
    try {
        // Determine classId: use body classId, especially when targetRole is STUDENT
        const classId = parsed.data.classId || undefined;
        // Use body departmentId if provided (admin selecting dept for HOD), otherwise use creator's dept
        const departmentId = parsed.data.departmentId || req.user.departmentId;
        const link = await registrationLinkService_1.registrationLinkService.generateLink(req.user.sub, req.user.role, req.schoolId, departmentId, classId, {
            expiryDays: parsed.data.expiryDays,
            maxUses: parsed.data.maxUses,
            targetRole: parsed.data.targetRole,
        });
        res.status(201).json(link);
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            throw err;
        console.error('[RegistrationLinks] Error:', err);
        throw new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to generate registration link');
    }
});
/**
 * GET /api/v1/registration-links/:token
 * Resolve a registration link (public, no auth).
 */
exports.registrationLinksRouter.get('/:token', async (req, res) => {
    try {
        const link = await registrationLinkService_1.registrationLinkService.resolveLink(req.params.token);
        // Fetch school and class names for the frontend display
        const school = await index_1.prisma.school.findUnique({
            where: { id: link.schoolId },
            select: { name: true, schoolCode: true },
        });
        let className;
        let departmentName;
        if (link.classId) {
            const classRecord = await index_1.prisma.class.findUnique({
                where: { id: link.classId },
                select: { name: true, department: { select: { name: true } } },
            });
            className = classRecord?.name;
            departmentName = classRecord?.department?.name;
        }
        res.status(200).json({
            ...link,
            schoolName: school?.name,
            schoolCode: school?.schoolCode,
            className,
            departmentName,
        });
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            throw err;
        throw new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to resolve registration link');
    }
});
/**
 * DELETE /api/v1/registration-links/:id
 * Delete a registration link with ownership check.
 * - SCHOOL_ADMIN can delete any link in their school
 * - HOD can only delete links they created
 * - Returns 403 if ownership check fails, 404 if not found
 */
exports.registrationLinksRouter.delete('/:id', async (req, res) => {
    if (!req.user || !req.schoolId) {
        res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
        return;
    }
    try {
        await registrationLinkService_1.registrationLinkService.deleteLink(req.params.id, req.user.sub, req.user.role, req.schoolId);
        res.status(204).send();
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            throw err;
        throw new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to delete registration link');
    }
});
/**
 * POST /api/v1/registration-links/:token/register
 * Self-register via a registration link (public, no auth).
 */
exports.registrationLinksRouter.post('/:token/register', async (req, res) => {
    const parsed = registerViaLinkSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({
            error: 'Validation failed',
            code: 'VALIDATION_ERROR',
            details: parsed.error.flatten().fieldErrors,
        });
        return;
    }
    try {
        const user = await registrationLinkService_1.registrationLinkService.registerViaLink(req.params.token, parsed.data);
        res.status(201).json(user);
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            throw err;
        throw new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to register via link');
    }
});
//# sourceMappingURL=users.js.map