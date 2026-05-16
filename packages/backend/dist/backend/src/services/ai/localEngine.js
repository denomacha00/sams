"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectIntent = detectIntent;
exports.localQuery = localQuery;
const index_1 = require("../../index");
const shared_1 = require("@sams/shared");
// ─── Intent Detection ─────────────────────────────────────────────────────────
const INTENT_PATTERNS = [
    {
        intent: 'about_sams',
        patterns: [
            /what\s*is\s*sams/i,
            /how\s*does\s*sams\s*work/i,
            /tell\s*me\s*about\s*sams/i,
            /what\s*can\s*you\s*do/i,
            /^help$/i,
            /what\s*are\s*(your|sams('s)?)\s*features/i,
            /about\s*sams/i,
            /explain\s*sams/i,
            /what\s*does\s*sams\s*do/i,
            /sams\s*features/i,
            /describe\s*sams/i,
        ],
    },
    {
        intent: 'super_admin_help',
        patterns: [
            /how\s*to\s*generate\s*(a\s*)?license/i,
            /how\s*to\s*suspend/i,
            /how\s*to\s*unsuspend/i,
            /how\s*to\s*extend/i,
            /how\s*to\s*fix/i,
            /how\s*to\s*delete\s*(a\s*)?school/i,
            /how\s*to\s*revoke/i,
            /troubleshoot/i,
            /common\s*problems/i,
            /system\s*architecture/i,
            /tech\s*stack/i,
            /how\s*does\s*the\s*backend\s*work/i,
            /how\s*does\s*the\s*system\s*work/i,
            /admin\s*guide/i,
            /help\s*me\s*with/i,
            /what\s*tech/i,
            /infrastructure/i,
            /why\s*is\s*(a\s*)?school\s*not\s*working/i,
            /school\s*not\s*working/i,
            /how\s*to\s*manage/i,
        ],
    },
    {
        intent: 'system_stats',
        patterns: [
            /system\s*stats/i,
            /how\s*many\s*schools/i,
            /total\s*revenue/i,
            /platform\s*stats/i,
            /platform\s*overview/i,
            /system\s*overview/i,
            /any\s*suspended\s*schools/i,
            /suspended\s*schools/i,
            /total\s*students/i,
            /total\s*teachers/i,
            /active\s*schools/i,
            /school\s*count/i,
            /how\s*many\s*users/i,
            /dashboard\s*stats/i,
        ],
    },
    {
        intent: 'custom_knowledge',
        patterns: [
            /who\s*is\s*denis/i,
            /tell\s*me\s*about\s*the\s*developer/i,
            /company\s*info/i,
            /who\s*(built|created|made|developed)\s*(this|sams)/i,
            /about\s*the\s*(developer|creator|founder)/i,
            /custom\s*knowledge/i,
            /knowledge\s*base/i,
            /what\s*do\s*you\s*know\s*about/i,
        ],
    },
    {
        // "remake" must come BEFORE "generate" so it matches first
        intent: 'remake_timetable',
        patterns: [
            /remake\s*(a\s*)?timetable/i,
            /regenerate\s*(a\s*)?timetable/i,
            /redo\s*(a\s*)?timetable/i,
            /re[\s-]*generate\s*(a\s*)?timetable/i,
            /re[\s-]*create\s*(a\s*)?timetable/i,
            /delete\s*and\s*(re)?create\s*(a\s*)?timetable/i,
            /reset\s*(a\s*)?timetable/i,
            /rebuild\s*(a\s*)?timetable/i,
            /fresh\s*timetable/i,
        ],
    },
    {
        intent: 'generate_timetable',
        patterns: [
            /generate\s*(a\s*)?timetable/i,
            /create\s*(a\s*)?timetable/i,
            /make\s*(a\s*)?timetable/i,
            /auto[\s-]*generate\s*(a\s*)?timetable/i,
            /build\s*(a\s*)?timetable/i,
            /new\s*timetable/i,
            /set\s*up\s*(a\s*)?timetable/i,
        ],
    },
    {
        intent: 'view_timetable',
        patterns: [
            /show\s*(me\s*)?(the\s*)?timetable/i,
            /view\s*(the\s*)?timetable/i,
            /my\s*timetable/i,
            /what('s| is)\s*(the\s*)?(class\s*)?schedule/i,
            /today('s)?\s*(schedule|timetable|classes)/i,
            /what\s*(classes|lessons)\s*(do\s*(i|we)\s*have|are\s*there)/i,
            /timetable\s*(for|of)/i,
            /display\s*(the\s*)?timetable/i,
        ],
    },
    {
        intent: 'student_count',
        patterns: [
            /how\s*many\s*students/i,
            /total\s*(number\s*(of\s*)?)?students/i,
            /student\s*count/i,
            /number\s*of\s*students/i,
            /count\s*(of\s*)?students/i,
        ],
    },
    {
        intent: 'session_status',
        patterns: [
            /active\s*sessions?/i,
            /ongoing\s*(classes|sessions|lessons)/i,
            /who\s*is\s*teaching\s*(now|right\s*now|currently)/i,
            /current\s*(sessions?|classes|lessons)/i,
            /what('s| is)\s*(happening|going\s*on)\s*(now|right\s*now|currently)/i,
            /live\s*sessions?/i,
            /classes?\s*(in\s*progress|happening\s*now|right\s*now)/i,
        ],
    },
    {
        intent: 'attendance_percentage',
        patterns: [
            /attendance\s*(rate|percentage|%)/i,
            /what\s*(is|are)\s*(the\s*)?(overall\s*)?attendance/i,
            /how\s*(is|are)\s*(the\s*)?attendance/i,
            /percentage\s*(of\s*)?(attendance|present)/i,
        ],
    },
    {
        intent: 'absent_students',
        patterns: [
            /who\s*(is|are)\s*(absent|missing)/i,
            /absent\s*students/i,
            /students?\s*(who\s*)?(are\s*)?absent/i,
            /missing\s*students/i,
            /not\s*(present|attending|here)/i,
        ],
    },
    {
        intent: 'risk_scores',
        patterns: [
            /risk\s*(score|level|rating)/i,
            /at\s*risk/i,
            /dropout\s*risk/i,
            /high\s*risk/i,
            /critical\s*risk/i,
            /students?\s*(at\s*)?risk/i,
        ],
    },
    {
        intent: 'top_students',
        patterns: [
            /top\s*students/i,
            /best\s*(attendance|performing|students)/i,
            /highest\s*attendance/i,
            /most\s*present/i,
            /perfect\s*attendance/i,
        ],
    },
    {
        intent: 'class_comparison',
        patterns: [
            /compare\s*(class|classes)/i,
            /class\s*comparison/i,
            /which\s*class\s*(has|is)/i,
            /best\s*class/i,
            /worst\s*class/i,
            /class\s*(ranking|performance)/i,
        ],
    },
];
/**
 * Detect the user's intent from a natural language question using regex patterns.
 */
function detectIntent(question) {
    const q = question.toLowerCase().trim();
    for (const { intent, patterns } of INTENT_PATTERNS) {
        for (const pattern of patterns) {
            if (pattern.test(q)) {
                return intent;
            }
        }
    }
    return 'unknown';
}
// ─── Class Name Extraction ────────────────────────────────────────────────────
/**
 * Extract a class name from the user's question for timetable generation.
 * Matches patterns like "Form 1A", "Class 2B", "Grade 3", etc.
 */
function extractClassName(question) {
    const patterns = [
        /(?:for|of)\s+(?:class\s+)?([A-Za-z]+\s*\d+\s*[A-Za-z]*)/i,
        /(?:form|class|grade)\s+(\d+\s*[A-Za-z]*)/i,
        /(?:for|of)\s+(form|class|grade)\s+(\d+\s*[A-Za-z]*)/i,
    ];
    for (const pattern of patterns) {
        const match = question.match(pattern);
        if (match) {
            const result = match[match.length - 1] ?? match[1];
            if (result)
                return result.trim();
        }
    }
    return null;
}
/**
 * Detect if the user wants to generate for the whole school (no specific class mentioned).
 */
function isWholeSchoolRequest(question) {
    const q = question.toLowerCase();
    // If they mention "whole school", "all classes", "entire school", or just "generate timetable" with no class
    if (/whole\s*school|all\s*classes|entire\s*school|every\s*class/i.test(q))
        return true;
    // If no specific class is mentioned, default to whole school
    const className = extractClassName(question);
    return className === null;
}
/**
 * Build a query scope based on the user's role.
 */
function buildScope(user) {
    const scope = { schoolId: user.schoolId };
    switch (user.role) {
        case shared_1.UserRole.TEACHER:
            if (user.classId) {
                scope.classId = user.classId;
            }
            break;
        case shared_1.UserRole.STUDENT:
            scope.studentId = user.sub;
            break;
        case shared_1.UserRole.HOD:
            if (user.departmentId) {
                scope.departmentId = user.departmentId;
            }
            break;
        default:
            break;
    }
    return scope;
}
// ─── School-Wide Timetable Generator ──────────────────────────────────────────
/**
 * Default Kenyan secondary school subjects.
 */
const DEFAULT_SUBJECTS = [
    'Mathematics',
    'English',
    'Kiswahili',
    'Biology',
    'Chemistry',
    'Physics',
    'History',
    'Geography',
    'CRE',
    'Business Studies',
];
/**
 * Professional school schedule: 8 periods per day, 40 minutes each.
 * Includes morning break and lunch break.
 */
const PERIODS = [
    { startTime: '08:00', endTime: '08:40' },
    { startTime: '08:40', endTime: '09:20' },
    { startTime: '09:20', endTime: '10:00' },
    // BREAK: 10:00–10:20
    { startTime: '10:20', endTime: '11:00' },
    { startTime: '11:00', endTime: '11:40' },
    { startTime: '11:40', endTime: '12:20' },
    // LUNCH: 12:20–13:00
    { startTime: '13:00', endTime: '13:40' },
    { startTime: '13:40', endTime: '14:20' },
];
const DAYS = [0, 1, 2, 3, 4]; // Monday to Friday
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const MAX_LESSONS_PER_TEACHER_PER_DAY = 6;
/**
 * Tracks teacher bookings to prevent conflicts.
 * Key format: `${teacherId}:${dayOfWeek}:${startTime}`
 */
class ScheduleTracker {
    // teacher -> day -> set of startTimes booked
    teacherBookings = new Map();
    // teacher -> day -> count of lessons
    teacherDailyLoad = new Map();
    // class -> day -> set of subjects already assigned
    classSubjectsPerDay = new Map();
    // class -> day -> set of startTimes booked
    classBookings = new Map();
    isTeacherAvailable(teacherId, day, startTime) {
        const dayMap = this.teacherBookings.get(teacherId);
        if (!dayMap)
            return true;
        const times = dayMap.get(day);
        if (!times)
            return true;
        return !times.has(startTime);
    }
    isTeacherUnderDailyLimit(teacherId, day) {
        const dayMap = this.teacherDailyLoad.get(teacherId);
        if (!dayMap)
            return true;
        const count = dayMap.get(day) ?? 0;
        return count < MAX_LESSONS_PER_TEACHER_PER_DAY;
    }
    isClassAvailable(classId, day, startTime) {
        const dayMap = this.classBookings.get(classId);
        if (!dayMap)
            return true;
        const times = dayMap.get(day);
        if (!times)
            return true;
        return !times.has(startTime);
    }
    hasSubjectToday(classId, day, subject) {
        const dayMap = this.classSubjectsPerDay.get(classId);
        if (!dayMap)
            return false;
        const subjects = dayMap.get(day);
        if (!subjects)
            return false;
        return subjects.has(subject);
    }
    book(teacherId, classId, day, startTime, subject) {
        // Teacher booking
        if (!this.teacherBookings.has(teacherId)) {
            this.teacherBookings.set(teacherId, new Map());
        }
        const teacherDayMap = this.teacherBookings.get(teacherId);
        if (!teacherDayMap.has(day)) {
            teacherDayMap.set(day, new Set());
        }
        teacherDayMap.get(day).add(startTime);
        // Teacher daily load
        if (!this.teacherDailyLoad.has(teacherId)) {
            this.teacherDailyLoad.set(teacherId, new Map());
        }
        const loadMap = this.teacherDailyLoad.get(teacherId);
        loadMap.set(day, (loadMap.get(day) ?? 0) + 1);
        // Class booking
        if (!this.classBookings.has(classId)) {
            this.classBookings.set(classId, new Map());
        }
        const classDayMap = this.classBookings.get(classId);
        if (!classDayMap.has(day)) {
            classDayMap.set(day, new Set());
        }
        classDayMap.get(day).add(startTime);
        // Class subject per day
        if (!this.classSubjectsPerDay.has(classId)) {
            this.classSubjectsPerDay.set(classId, new Map());
        }
        const subjectDayMap = this.classSubjectsPerDay.get(classId);
        if (!subjectDayMap.has(day)) {
            subjectDayMap.set(day, new Set());
        }
        subjectDayMap.get(day).add(subject);
    }
}
/**
 * Core timetable generation algorithm.
 * Generates a conflict-free timetable for the given classes using available teachers.
 *
 * Algorithm:
 * 1. For each class, determine subjects (round-robin from DEFAULT_SUBJECTS)
 * 2. For each day and period, pick the next subject (avoid repeats same day)
 * 3. Find an available teacher for that subject (same department preferred)
 * 4. If no teacher available, skip the slot
 * 5. Track all bookings to prevent conflicts
 */
function generateTimetableSlots(schoolId, classes, teachers) {
    const tracker = new ScheduleTracker();
    const slots = [];
    let skipped = 0;
    const stats = {};
    // Group teachers by department for efficient lookup
    const teachersByDept = new Map();
    const teachersNoDept = [];
    for (const teacher of teachers) {
        if (teacher.departmentId) {
            const list = teachersByDept.get(teacher.departmentId) ?? [];
            list.push(teacher);
            teachersByDept.set(teacher.departmentId, list);
        }
        else {
            teachersNoDept.push(teacher);
        }
    }
    // Process each class
    for (const cls of classes) {
        // Get teachers for this class's department, fallback to all teachers
        const deptTeachers = teachersByDept.get(cls.departmentId) ?? [];
        const availableTeachers = deptTeachers.length > 0
            ? [...deptTeachers, ...teachersNoDept]
            : teachers; // If no dept teachers, use all
        if (availableTeachers.length === 0) {
            skipped += DAYS.length * PERIODS.length;
            continue;
        }
        // Create a subject rotation for this class
        const subjects = [...DEFAULT_SUBJECTS];
        let subjectPointer = 0;
        for (const day of DAYS) {
            let periodsFilledToday = 0;
            for (const period of PERIODS) {
                // Check class availability (should always be true for fresh generation)
                if (!tracker.isClassAvailable(cls.id, day, period.startTime)) {
                    skipped++;
                    continue;
                }
                // Pick next subject, trying to avoid repeats on the same day
                let subject = null;
                let attempts = 0;
                while (attempts < subjects.length) {
                    const candidate = subjects[subjectPointer % subjects.length];
                    subjectPointer++;
                    attempts++;
                    // Prefer subjects not yet used today for this class
                    if (!tracker.hasSubjectToday(cls.id, day, candidate)) {
                        subject = candidate;
                        break;
                    }
                    // If all subjects used today, allow repeats
                    if (attempts === subjects.length) {
                        subject = candidate;
                    }
                }
                if (!subject) {
                    subject = subjects[subjectPointer % subjects.length];
                    subjectPointer++;
                }
                // Find an available teacher (round-robin through available teachers)
                let assignedTeacher = null;
                for (let i = 0; i < availableTeachers.length; i++) {
                    const teacher = availableTeachers[i];
                    if (tracker.isTeacherAvailable(teacher.id, day, period.startTime) &&
                        tracker.isTeacherUnderDailyLimit(teacher.id, day)) {
                        assignedTeacher = teacher;
                        // Rotate the array so next time we start from a different teacher
                        availableTeachers.push(availableTeachers.splice(i, 1)[0]);
                        break;
                    }
                }
                if (!assignedTeacher) {
                    // No teacher available for this slot
                    skipped++;
                    continue;
                }
                // Book the slot
                tracker.book(assignedTeacher.id, cls.id, day, period.startTime, subject);
                slots.push({
                    schoolId,
                    classId: cls.id,
                    teacherId: assignedTeacher.id,
                    subject,
                    dayOfWeek: day,
                    startTime: period.startTime,
                    endTime: period.endTime,
                });
                periodsFilledToday++;
            }
            stats[cls.name] = (stats[cls.name] ?? 0) + periodsFilledToday;
        }
    }
    return { slots, skipped, stats };
}
/**
 * Professional school-wide timetable generator.
 * Handles:
 * - "generate timetable" → whole school
 * - "generate timetable for Form 1A" → single class
 * - remake=true → delete existing entries first, then regenerate
 *
 * Conflict-free guarantees:
 * - A teacher cannot be in two classes at the same time
 * - A class cannot have two lessons at the same time
 * - Teachers are assigned within their department when possible
 * - Max 6 lessons per teacher per day
 * - Subjects distributed evenly (no repeats same day if possible)
 */
async function handleGenerateTimetable(scope, question, remake = false) {
    const schoolId = scope.schoolId;
    const startTime = Date.now();
    console.log(`[Timetable] Starting ${remake ? 'REMAKE' : 'generation'} for school ${schoolId}`);
    // Determine target: whole school or specific class
    const requestedClassName = extractClassName(question);
    const wholeSchool = isWholeSchoolRequest(question);
    // Get target classes
    let targetClasses = [];
    if (requestedClassName) {
        // Single class requested
        const found = await index_1.prisma.class.findFirst({
            where: {
                schoolId,
                name: { contains: requestedClassName, mode: 'insensitive' },
            },
            select: { id: true, name: true, departmentId: true },
        });
        if (!found) {
            const availableClasses = await index_1.prisma.class.findMany({
                where: { schoolId },
                select: { name: true },
                take: 15,
            });
            const classList = availableClasses.map((c) => c.name).join(', ');
            return {
                answer: `I couldn't find a class matching "${requestedClassName}". Available classes: ${classList || 'none found'}. Try: "Generate timetable for Form 1A"`,
                intent: 'generate_timetable',
            };
        }
        targetClasses = [found];
    }
    else if (wholeSchool) {
        // Whole school
        targetClasses = await index_1.prisma.class.findMany({
            where: { schoolId },
            select: { id: true, name: true, departmentId: true },
            orderBy: { name: 'asc' },
        });
    }
    else if (scope.classId) {
        // User's own class
        const found = await index_1.prisma.class.findFirst({
            where: { id: scope.classId, schoolId },
            select: { id: true, name: true, departmentId: true },
        });
        if (found)
            targetClasses = [found];
    }
    if (targetClasses.length === 0) {
        return {
            answer: 'No classes found in the school. Please create classes first before generating a timetable.',
            intent: 'generate_timetable',
        };
    }
    // Get all teachers in the school
    const teachers = await index_1.prisma.user.findMany({
        where: { schoolId, role: 'TEACHER' },
        select: { id: true, fullName: true, departmentId: true },
    });
    if (teachers.length === 0) {
        return {
            answer: 'Cannot generate a timetable: no teachers found in the school. Please add teachers first.',
            intent: 'generate_timetable',
        };
    }
    // If remake, delete existing entries first
    if (remake) {
        const deleteWhere = { schoolId };
        if (!wholeSchool) {
            deleteWhere.classId = { in: targetClasses.map((c) => c.id) };
        }
        const deleted = await index_1.prisma.timetableEntry.deleteMany({ where: deleteWhere });
        console.log(`[Timetable] Deleted ${deleted.count} existing entries (remake mode)`);
    }
    else {
        // Check if timetable already exists
        const existingCount = await index_1.prisma.timetableEntry.count({
            where: {
                schoolId,
                classId: { in: targetClasses.map((c) => c.id) },
            },
        });
        if (existingCount > 0) {
            const classNames = targetClasses.map((c) => c.name).join(', ');
            return {
                answer: `Timetable already exists with ${existingCount} entries for: ${classNames}.\n\nTo regenerate, say: "remake timetable" or "regenerate timetable"`,
                intent: 'generate_timetable',
                data: { existingEntries: existingCount },
            };
        }
    }
    // Generate the timetable
    console.log(`[Timetable] Generating for ${targetClasses.length} class(es) with ${teachers.length} teacher(s)`);
    const { slots, skipped, stats } = generateTimetableSlots(schoolId, targetClasses, teachers);
    if (slots.length === 0) {
        return {
            answer: 'Could not generate any timetable entries. This usually means there are not enough teachers available. Please add more teachers and try again.',
            intent: 'generate_timetable',
            data: { skipped },
        };
    }
    // Bulk insert all entries
    const result = await index_1.prisma.timetableEntry.createMany({ data: slots });
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Timetable] Created ${result.count} entries in ${elapsed}s (${skipped} slots skipped)`);
    // Build summary
    const scope_label = wholeSchool
        ? 'the whole school'
        : targetClasses.length === 1
            ? targetClasses[0].name
            : `${targetClasses.length} classes`;
    const classBreakdown = Object.entries(stats)
        .map(([name, count]) => `  • ${name}: ${count} lessons`)
        .join('\n');
    const summary = `✅ Timetable ${remake ? 'regenerated' : 'generated'} for ${scope_label}!\n\n` +
        `📊 Summary:\n` +
        `• ${result.count} lessons created across ${DAY_NAMES.join(', ')}\n` +
        `• ${targetClasses.length} class(es) scheduled\n` +
        `• ${teachers.length} teacher(s) assigned\n` +
        `• ${skipped} slot(s) skipped (teacher unavailable)\n` +
        `• Schedule: 08:00–14:20 (8 periods × 40 min)\n` +
        `• Breaks: 10:00–10:20 (tea), 12:20–13:00 (lunch)\n` +
        `• Generated in ${elapsed}s\n\n` +
        `📋 Per-class breakdown:\n${classBreakdown}`;
    return {
        answer: summary,
        intent: 'generate_timetable',
        data: {
            entriesCreated: result.count,
            classesProcessed: targetClasses.length,
            teachersUsed: teachers.length,
            skippedSlots: skipped,
            remake,
            elapsed: parseFloat(elapsed),
            stats,
        },
    };
}
// ─── Other Query Handlers ─────────────────────────────────────────────────────
async function handleAttendancePercentage(scope) {
    const where = { schoolId: scope.schoolId };
    if (scope.studentId) {
        where.studentId = scope.studentId;
    }
    else if (scope.classId) {
        const sessions = await index_1.prisma.attendanceSession.findMany({
            where: { schoolId: scope.schoolId, classId: scope.classId },
            select: { id: true },
        });
        where.sessionId = { in: sessions.map((s) => s.id) };
    }
    else if (scope.departmentId) {
        const classes = await index_1.prisma.class.findMany({
            where: { schoolId: scope.schoolId, departmentId: scope.departmentId },
            select: { id: true },
        });
        const sessions = await index_1.prisma.attendanceSession.findMany({
            where: { schoolId: scope.schoolId, classId: { in: classes.map((c) => c.id) } },
            select: { id: true },
        });
        where.sessionId = { in: sessions.map((s) => s.id) };
    }
    const totalRecords = await index_1.prisma.attendanceRecord.count({ where });
    const presentRecords = await index_1.prisma.attendanceRecord.count({
        where: { ...where, status: { in: ['PRESENT', 'LATE'] } },
    });
    if (totalRecords === 0) {
        return {
            answer: 'No attendance records found for your scope.',
            intent: 'attendance_percentage',
            data: { totalRecords: 0, presentRecords: 0, percentage: 0 },
        };
    }
    const percentage = ((presentRecords / totalRecords) * 100).toFixed(1);
    return {
        answer: `The attendance rate is ${percentage}% (${presentRecords} present/late out of ${totalRecords} total records).`,
        intent: 'attendance_percentage',
        data: { totalRecords, presentRecords, percentage: parseFloat(percentage) },
    };
}
async function handleAbsentStudents(scope) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const where = {
        schoolId: scope.schoolId,
        status: 'ABSENT',
        scannedAt: { gte: today },
    };
    if (scope.studentId) {
        where.studentId = scope.studentId;
    }
    else if (scope.classId) {
        const sessions = await index_1.prisma.attendanceSession.findMany({
            where: { schoolId: scope.schoolId, classId: scope.classId, startedAt: { gte: today } },
            select: { id: true },
        });
        where.sessionId = { in: sessions.map((s) => s.id) };
    }
    else if (scope.departmentId) {
        const classes = await index_1.prisma.class.findMany({
            where: { schoolId: scope.schoolId, departmentId: scope.departmentId },
            select: { id: true },
        });
        const sessions = await index_1.prisma.attendanceSession.findMany({
            where: { schoolId: scope.schoolId, classId: { in: classes.map((c) => c.id) }, startedAt: { gte: today } },
            select: { id: true },
        });
        where.sessionId = { in: sessions.map((s) => s.id) };
    }
    const absentRecords = await index_1.prisma.attendanceRecord.findMany({
        where,
        include: { student: { select: { fullName: true, admissionNumber: true } } },
        take: 20,
    });
    if (absentRecords.length === 0) {
        return {
            answer: 'No absent students recorded today within your scope.',
            intent: 'absent_students',
            data: { count: 0, students: [] },
        };
    }
    const students = absentRecords.map((r) => ({
        name: r.student.fullName,
        admissionNumber: r.student.admissionNumber,
    }));
    const names = students.map((s) => s.name).join(', ');
    return {
        answer: `${absentRecords.length} student(s) marked absent today: ${names}`,
        intent: 'absent_students',
        data: { count: absentRecords.length, students },
    };
}
async function handleRiskScores(scope) {
    const where = { schoolId: scope.schoolId };
    if (scope.studentId) {
        where.studentId = scope.studentId;
    }
    else if (scope.departmentId) {
        const students = await index_1.prisma.user.findMany({
            where: { schoolId: scope.schoolId, departmentId: scope.departmentId, role: 'STUDENT' },
            select: { id: true },
        });
        where.studentId = { in: students.map((s) => s.id) };
    }
    else if (scope.classId) {
        const students = await index_1.prisma.user.findMany({
            where: { schoolId: scope.schoolId, classId: scope.classId, role: 'STUDENT' },
            select: { id: true },
        });
        where.studentId = { in: students.map((s) => s.id) };
    }
    const riskScores = await index_1.prisma.riskScore.findMany({
        where,
        orderBy: { score: 'desc' },
        take: 10,
    });
    if (riskScores.length === 0) {
        return {
            answer: 'No risk scores computed yet for your scope.',
            intent: 'risk_scores',
            data: { count: 0, scores: [] },
        };
    }
    const studentIds = riskScores.map((r) => r.studentId);
    const students = await index_1.prisma.user.findMany({
        where: { id: { in: studentIds } },
        select: { id: true, fullName: true },
    });
    const studentMap = new Map(students.map((s) => [s.id, s.fullName]));
    const highRisk = riskScores.filter((r) => r.riskLevel === 'HIGH' || r.riskLevel === 'CRITICAL');
    const summary = riskScores.map((r) => `${studentMap.get(r.studentId) ?? 'Unknown'}: ${r.score.toFixed(1)} (${r.riskLevel})`);
    return {
        answer: `${highRisk.length} student(s) at high/critical risk. Top risk scores:\n${summary.join('\n')}`,
        intent: 'risk_scores',
        data: { count: riskScores.length, highRiskCount: highRisk.length, scores: riskScores },
    };
}
async function handleTopStudents(scope) {
    const where = { schoolId: scope.schoolId, role: 'STUDENT' };
    if (scope.studentId) {
        where.id = scope.studentId;
    }
    else if (scope.classId) {
        where.classId = scope.classId;
    }
    else if (scope.departmentId) {
        where.departmentId = scope.departmentId;
    }
    const students = await index_1.prisma.user.findMany({
        where,
        select: { id: true, fullName: true },
        take: 50,
    });
    if (students.length === 0) {
        return {
            answer: 'No students found in your scope.',
            intent: 'top_students',
            data: { students: [] },
        };
    }
    const studentAttendance = await Promise.all(students.map(async (student) => {
        const total = await index_1.prisma.attendanceRecord.count({
            where: { studentId: student.id, schoolId: scope.schoolId },
        });
        const present = await index_1.prisma.attendanceRecord.count({
            where: { studentId: student.id, schoolId: scope.schoolId, status: { in: ['PRESENT', 'LATE'] } },
        });
        const percentage = total > 0 ? (present / total) * 100 : 0;
        return { name: student.fullName, percentage, total, present };
    }));
    const topStudents = studentAttendance
        .sort((a, b) => b.percentage - a.percentage)
        .slice(0, 5);
    const summary = topStudents
        .map((s, i) => `${i + 1}. ${s.name}: ${s.percentage.toFixed(1)}%`)
        .join('\n');
    return {
        answer: `Top students by attendance:\n${summary}`,
        intent: 'top_students',
        data: { students: topStudents },
    };
}
async function handleClassComparison(scope) {
    const classWhere = { schoolId: scope.schoolId };
    if (scope.departmentId) {
        classWhere.departmentId = scope.departmentId;
    }
    const classes = await index_1.prisma.class.findMany({
        where: classWhere,
        select: { id: true, name: true },
    });
    if (classes.length === 0) {
        return {
            answer: 'No classes found in your scope for comparison.',
            intent: 'class_comparison',
            data: { classes: [] },
        };
    }
    const classStats = await Promise.all(classes.map(async (cls) => {
        const sessions = await index_1.prisma.attendanceSession.findMany({
            where: { schoolId: scope.schoolId, classId: cls.id },
            select: { id: true },
        });
        const sessionIds = sessions.map((s) => s.id);
        if (sessionIds.length === 0) {
            return { name: cls.name, percentage: 0, totalRecords: 0 };
        }
        const total = await index_1.prisma.attendanceRecord.count({
            where: { sessionId: { in: sessionIds }, schoolId: scope.schoolId },
        });
        const present = await index_1.prisma.attendanceRecord.count({
            where: { sessionId: { in: sessionIds }, schoolId: scope.schoolId, status: { in: ['PRESENT', 'LATE'] } },
        });
        const percentage = total > 0 ? (present / total) * 100 : 0;
        return { name: cls.name, percentage, totalRecords: total };
    }));
    const sorted = classStats.sort((a, b) => b.percentage - a.percentage);
    const summary = sorted
        .map((c, i) => `${i + 1}. ${c.name}: ${c.percentage.toFixed(1)}%`)
        .join('\n');
    return {
        answer: `Class attendance comparison:\n${summary}`,
        intent: 'class_comparison',
        data: { classes: sorted },
    };
}
async function handleViewTimetable(scope) {
    const schoolId = scope.schoolId;
    const filters = { schoolId };
    if (scope.classId) {
        filters.classId = scope.classId;
    }
    if (scope.studentId) {
        const student = await index_1.prisma.user.findUnique({
            where: { id: scope.studentId },
            select: { classId: true },
        });
        if (student?.classId) {
            filters.classId = student.classId;
        }
    }
    const entries = await index_1.prisma.timetableEntry.findMany({
        where: filters,
        orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
        include: {
            teacher: { select: { fullName: true } },
            class: { select: { name: true } },
        },
        take: 60,
    });
    if (entries.length === 0) {
        return {
            answer: 'No timetable entries found for your scope. Ask an admin to generate or create a timetable.',
            intent: 'view_timetable',
            data: { entries: [] },
        };
    }
    const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const byDay = new Map();
    for (const entry of entries) {
        const dayEntries = byDay.get(entry.dayOfWeek) ?? [];
        dayEntries.push(entry);
        byDay.set(entry.dayOfWeek, dayEntries);
    }
    let summary = '📅 Timetable:\n';
    for (const [day, dayEntries] of byDay) {
        summary += `\n${dayNames[day] ?? `Day ${day}`}:\n`;
        for (const e of dayEntries) {
            summary += `  ${e.startTime}–${e.endTime}: ${e.subject} (${e.teacher.fullName})\n`;
        }
    }
    return {
        answer: summary,
        intent: 'view_timetable',
        data: { entries: entries.map((e) => ({ ...e, teacher: e.teacher.fullName, class: e.class.name })) },
    };
}
async function handleStudentCount(scope) {
    const where = { schoolId: scope.schoolId, role: 'STUDENT' };
    if (scope.classId) {
        where.classId = scope.classId;
    }
    else if (scope.departmentId) {
        where.departmentId = scope.departmentId;
    }
    const count = await index_1.prisma.user.count({ where });
    let scopeLabel = 'in the school';
    if (scope.classId) {
        const cls = await index_1.prisma.class.findUnique({ where: { id: scope.classId }, select: { name: true } });
        scopeLabel = cls ? `in ${cls.name}` : 'in your class';
    }
    else if (scope.departmentId) {
        const dept = await index_1.prisma.department.findUnique({ where: { id: scope.departmentId }, select: { name: true } });
        scopeLabel = dept ? `in ${dept.name} department` : 'in your department';
    }
    return {
        answer: `There are ${count} student(s) ${scopeLabel}.`,
        intent: 'student_count',
        data: { count, scope: scopeLabel },
    };
}
async function handleSessionStatus(scope) {
    const where = { schoolId: scope.schoolId, isActive: true };
    if (scope.classId) {
        where.classId = scope.classId;
    }
    const activeSessions = await index_1.prisma.attendanceSession.findMany({
        where,
        include: {
            teacher: { select: { fullName: true } },
            class: { select: { name: true } },
        },
        orderBy: { startedAt: 'desc' },
        take: 20,
    });
    if (activeSessions.length === 0) {
        return {
            answer: 'No active sessions right now.',
            intent: 'session_status',
            data: { count: 0, sessions: [] },
        };
    }
    const sessionList = activeSessions.map((s) => `• ${s.subject} — ${s.class.name} (${s.teacher.fullName}, started ${s.startedAt.toLocaleTimeString()})`);
    return {
        answer: `${activeSessions.length} active session(s):\n${sessionList.join('\n')}`,
        intent: 'session_status',
        data: {
            count: activeSessions.length,
            sessions: activeSessions.map((s) => ({
                subject: s.subject,
                className: s.class.name,
                teacher: s.teacher.fullName,
                startedAt: s.startedAt,
            })),
        },
    };
}
// ─── About SAMS Handler ───────────────────────────────────────────────────────
function handleAboutSams() {
    const answer = `🎓 **SAMS — Smart Attendance Management System**

SAMS is a multi-school platform designed for Kenyan educational institutions to streamline attendance tracking and school management.

**Core Features:**
• **QR Code Attendance** — Teachers generate session QR codes; students scan to mark attendance instantly
• **GPS Verification** — Validates student location during attendance marking to prevent proxy attendance
• **Biometric (Face Recognition)** — Optional face-based attendance for enhanced security
• **Manual Marking** — Teachers can manually mark attendance when needed
• **Offline-First** — Works without internet; auto-syncs when connectivity is restored

**Smart Features:**
• **Real-Time WebSocket Updates** — Live attendance status across all connected devices
• **AI Assistant** — Ask questions about attendance data, trends, and insights (that's me!)
• **Risk Scoring** — Identifies students at risk of dropping out based on attendance patterns
• **Timetable Management** — Auto-generate and manage class timetables

**Reports & Integration:**
• **Reports** — Generate PDF and Excel reports for attendance, performance, and analytics
• **M-Pesa Payment Integration** — School license payments via M-Pesa
• **Notifications** — SMS and push notifications for parents and staff

**Role-Based Access:**
• Super Admin — Platform-wide management
• School Admin — Full school management
• HOD (Head of Department) — Department oversight
• Teacher — Session and attendance management
• Student — View own attendance and timetable

Developed by Denis Macharia for Kenyan schools. Ask me anything specific!`;
    return {
        answer,
        intent: 'about_sams',
    };
}
// ─── Super Admin Help Handler ─────────────────────────────────────────────────
function handleSuperAdminHelp(question) {
    const q = question.toLowerCase();
    if (/tech\s*stack|architecture|infrastructure|how\s*does\s*the\s*(backend|system)\s*work|what\s*tech/i.test(q)) {
        return {
            answer: `🏗️ **SAMS System Architecture**

**Frontend (Super Admin Panel):**
• React 18 + TypeScript + Vite
• Tailwind CSS for styling
• Zustand for state management
• Axios for API calls
• Hosted at super.sams.ke

**Frontend (School Panel):**
• React 18 + TypeScript + Vite
• Tailwind CSS + React Router
• PWA with offline support
• WebSocket for real-time updates

**Backend:**
• Node.js + Express + TypeScript
• Prisma ORM with PostgreSQL
• Redis for caching & session management
• Socket.io for real-time WebSocket
• JWT authentication with refresh tokens
• Role-based access control (RBAC)

**Infrastructure:**
• PM2 for process management
• Nginx reverse proxy
• PostgreSQL database
• Redis cache
• M-Pesa payment integration (Daraja API)

**Security:**
• Host-restricted Super Admin routes (super.sams.ke only)
• AES-256 biometric encryption
• Rate limiting on login
• Audit logging for all admin actions
• License key hashing (SHA-256)

**Shared Package (@sams/shared):**
• TypeScript types, enums, and utilities
• License key encoding/decoding
• Shared between frontend and backend`,
            intent: 'super_admin_help',
        };
    }
    if (/how\s*to\s*generate\s*(a\s*)?license/i.test(q)) {
        return {
            answer: `📋 **How to Generate a License Key**

1. Go to **License Generator** page in the sidebar
2. Fill in the form:
   • **School Name** — The name of the school this license is for
   • **Plan Tier** — TRIAL, BASIC, PROFESSIONAL, or ENTERPRISE
   • **Expiry Date** — When the license should expire
3. Click **Generate License Key**
4. ⚠️ **IMPORTANT**: Copy the license key immediately! It cannot be retrieved again (only the hash is stored)
5. Send the license key to the school administrator for activation

**Via AI (me):** You can say "generate a license for Basic plan" and I'll help you execute it.

**Plan Limits:**
• TRIAL: 50 students
• BASIC: 500 students
• PROFESSIONAL: 2,000 students
• ENTERPRISE: Unlimited`,
            intent: 'super_admin_help',
        };
    }
    if (/how\s*to\s*suspend/i.test(q)) {
        return {
            answer: `🚫 **How to Suspend a School**

1. Go to **Schools** page in the sidebar
2. Find the school you want to suspend
3. Click on the school to view details
4. Click **Suspend** button
5. Confirm the action

**What happens when a school is suspended:**
• All active attendance sessions are immediately revoked
• Users cannot log in or perform any actions
• The school is marked as suspended in the database
• An audit log entry is created

**Via AI (me):** You can say "suspend school [name]" and I'll execute it.

**To unsuspend:** Go to the school details and click "Unsuspend", or tell me "unsuspend school [name]".`,
            intent: 'super_admin_help',
        };
    }
    if (/how\s*to\s*extend/i.test(q)) {
        return {
            answer: `📅 **How to Extend a School's License**

1. Go to **Schools** page in the sidebar
2. Find the school whose license you want to extend
3. Click on the school to view details
4. Click **Extend License** button
5. Set the new expiry date
6. Confirm

**What happens:**
• The license expiry date is updated
• If the school was in read-only mode (expired), full access is restored
• An audit log entry is created

**Via AI (me):** You can say "extend license for [school name] by 30 days" and I'll execute it.

**Note:** If a school's license expires, it automatically enters read-only mode. Extending the license restores full access.`,
            intent: 'super_admin_help',
        };
    }
    if (/troubleshoot|common\s*problems|why\s*is.*not\s*working|how\s*to\s*fix/i.test(q)) {
        return {
            answer: `🔧 **Common Problems & Troubleshooting**

**1. School can't log in:**
• Check if the school is suspended → Unsuspend it
• Check if the license has expired → Extend the license
• Check if the school was activated properly

**2. License key not working:**
• License keys are one-time use — check if already used
• Check if the key has expired
• Verify the school name matches exactly

**3. Attendance not recording:**
• Check if there's an active session for the class
• Verify the student's GPS is within range
• Check if the school is in read-only mode (expired license)

**4. School in read-only mode:**
• This happens when the license expires
• Extend the license to restore full access

**5. Payment not reflecting:**
• Check M-Pesa callback status in audit logs
• Verify the payment reference number
• Check if the callback URL is correctly configured

**6. QR code not scanning:**
• QR codes refresh every 30 seconds for security
• Ensure the student's device camera has permission
• Check if the session is still active

**Need more help?** Ask me about specific issues!`,
            intent: 'super_admin_help',
        };
    }
    // Default admin guide
    return {
        answer: `📖 **Super Admin Guide**

Here's what you can do as a Super Admin:

**License Management:**
• Generate new license keys for schools
• Revoke unused license keys
• View all licenses and their status

**School Management:**
• View all registered schools
• Suspend/unsuspend schools
• Extend school licenses
• Delete schools (⚠️ irreversible)

**Monitoring:**
• View platform-wide analytics
• Check revenue by plan tier
• View audit logs for all actions
• Monitor active sessions across schools

**Quick Commands (tell me):**
• "how many schools" — Get platform stats
• "suspend school X" — Suspend a school
• "extend license for X" — Extend a license
• "generate a license for Basic plan" — Generate a key
• "system architecture" — View tech stack
• "common problems" — Troubleshooting guide

What would you like help with?`,
        intent: 'super_admin_help',
    };
}
// ─── System Stats Handler ─────────────────────────────────────────────────────
async function handleSystemStats() {
    const [totalSchools, totalStudents, totalTeachers, totalUsers, activeSessions, suspendedSchools, expiredSchools,] = await Promise.all([
        index_1.prisma.school.count(),
        index_1.prisma.user.count({ where: { role: 'STUDENT' } }),
        index_1.prisma.user.count({ where: { role: 'TEACHER' } }),
        index_1.prisma.user.count(),
        index_1.prisma.attendanceSession.count({ where: { isActive: true } }),
        index_1.prisma.school.count({ where: { isSuspended: true } }),
        index_1.prisma.school.count({ where: { licenseExpiresAt: { lt: new Date() } } }),
    ]);
    const revenue = await index_1.prisma.payment.aggregate({
        where: { status: 'SUCCESS' },
        _sum: { amount: true },
        _count: { id: true },
    });
    const totalRevenue = revenue._sum.amount || 0;
    const totalPayments = revenue._count.id || 0;
    const schoolsByPlan = await index_1.prisma.school.groupBy({
        by: ['planTier'],
        _count: { id: true },
    });
    const planBreakdown = schoolsByPlan
        .map((g) => `  • ${g.planTier}: ${g._count.id} school(s)`)
        .join('\n');
    const answer = `📊 **SAMS Platform Statistics**

**Schools:**
• Total Schools: ${totalSchools}
• Active Schools: ${totalSchools - suspendedSchools - expiredSchools}
• Suspended Schools: ${suspendedSchools}
• Expired Licenses: ${expiredSchools}

**Users:**
• Total Users: ${totalUsers}
• Students: ${totalStudents}
• Teachers: ${totalTeachers}

**Activity:**
• Active Sessions Right Now: ${activeSessions}

**Revenue:**
• Total Revenue: KES ${totalRevenue.toLocaleString()}
• Total Payments: ${totalPayments}

**Plan Distribution:**
${planBreakdown || '  • No schools registered yet'}`;
    return {
        answer,
        intent: 'system_stats',
        data: {
            totalSchools,
            totalStudents,
            totalTeachers,
            totalUsers,
            activeSessions,
            suspendedSchools,
            expiredSchools,
            totalRevenue,
            totalPayments,
            schoolsByPlan: schoolsByPlan.map((g) => ({ planTier: g.planTier, count: g._count.id })),
        },
    };
}
// ─── Custom Knowledge Handler ─────────────────────────────────────────────────
async function handleCustomKnowledge() {
    const entries = await index_1.prisma.aIKnowledge.findMany({
        orderBy: { createdAt: 'desc' },
    });
    if (entries.length === 0) {
        return {
            answer: 'No custom knowledge entries have been added yet. The Super Admin can add information via the Knowledge Base page.',
            intent: 'custom_knowledge',
            data: { count: 0, entries: [] },
        };
    }
    const formatted = entries
        .map((entry) => `**${entry.title}** (${entry.category}):\n${entry.content}`)
        .join('\n\n');
    return {
        answer: `📚 Here's what I know:\n\n${formatted}`,
        intent: 'custom_knowledge',
        data: { count: entries.length, entries },
    };
}
// ─── Local Engine ─────────────────────────────────────────────────────────────
/**
 * Local query engine that uses regex-based intent detection and scoped DB queries.
 * Does not require any external AI provider.
 * NEVER throws — always returns a result.
 */
async function localQuery(user, question) {
    const intent = detectIntent(question);
    const scope = buildScope(user);
    try {
        switch (intent) {
            case 'about_sams':
                return handleAboutSams();
            case 'super_admin_help':
                return handleSuperAdminHelp(question);
            case 'system_stats':
                return await handleSystemStats();
            case 'custom_knowledge':
                return await handleCustomKnowledge();
            case 'attendance_percentage':
                return await handleAttendancePercentage(scope);
            case 'absent_students':
                return await handleAbsentStudents(scope);
            case 'risk_scores':
                return await handleRiskScores(scope);
            case 'top_students':
                return await handleTopStudents(scope);
            case 'class_comparison':
                return await handleClassComparison(scope);
            case 'generate_timetable':
                return await handleGenerateTimetable(scope, question, false);
            case 'remake_timetable':
                return await handleGenerateTimetable(scope, question, true);
            case 'view_timetable':
                return await handleViewTimetable(scope);
            case 'student_count':
                return await handleStudentCount(scope);
            case 'session_status':
                return await handleSessionStatus(scope);
            case 'unknown':
            default:
                return {
                    answer: `I can help you with:\n• About SAMS ("what is SAMS", "what can you do")\n• Attendance rates and percentages\n• Absent students today\n• Risk scores and at-risk students\n• Top students by attendance\n• Class attendance comparison\n• Generate timetable ("generate timetable" for whole school, or "generate timetable for Form 1A")\n• Remake timetable ("remake timetable", "regenerate timetable")\n• View timetable ("show my timetable")\n• Student count ("how many students")\n• Active sessions ("who is teaching now")\n• System stats ("how many schools", "total revenue")\n• Admin guides ("how to generate a license", "how to suspend a school")\n\nTry asking: "What is SAMS?" or "Generate timetable for the whole school"`,
                    intent: 'unknown',
                };
        }
    }
    catch (err) {
        console.error('[AI/LocalEngine] Handler error:', err);
        return {
            answer: 'I had trouble retrieving that information. Please try again or rephrase your question.',
            intent: intent !== 'unknown' ? intent : 'error_fallback',
        };
    }
}
//# sourceMappingURL=localEngine.js.map