import { prisma } from '../lib/prisma';
import type { UserRole } from '@sams/shared';

export type SchemeStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';
export type LessonStatus = 'DRAFT' | 'COMPLETED' | 'SKIPPED';

interface SchemeWithWeeks {
  id: string;
  schoolId: string;
  subject: string;
  classId: string;
  termId: string;
  title: string;
  description: string | null;
  status: SchemeStatus;
  createdById: string;
  approvedById: string | null;
  approvedAt: Date | null;
  rejectionReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  class: { id: string; name: string };
  term: { id: string; name: string };
  creator: { id: string; fullName: string };
  weeks: Array<{
    id: string;
    weekNumber: number;
    topic: string;
    objectives: string | null;
    teachingMethods: string | null;
    resources: string | null;
    assessment: string | null;
    lessonPlans: Array<{
      id: string;
      dayOfWeek: number;
      topic: string;
      status: LessonStatus;
    }>;
  }>;
}

export const schemeOfWorkService = {
  /** List schemes visible to a user (teacher: own, HOD: department, admin: school) */
  async list(scope: { schoolId: string; userId: string; role: UserRole; departmentId?: string }) {
    const where: any = { schoolId: scope.schoolId };

    if (scope.role === 'TEACHER') {
      where.createdById = scope.userId;
    } else if (scope.role === 'HOD' && scope.departmentId) {
      // HOD sees schemes from their department's teachers and their own
      const deptTeacherIds = await prisma.user.findMany({
        where: { schoolId: scope.schoolId, departmentId: scope.departmentId },
        select: { id: true },
      });
      where.createdById = { in: [...deptTeacherIds.map((u) => u.id), scope.userId] };
    }

    return prisma.schemeOfWork.findMany({
      where,
      include: {
        class: { select: { id: true, name: true } },
        term: { select: { id: true, name: true } },
        creator: { select: { id: true, fullName: true } },
        weeks: {
          orderBy: { weekNumber: 'asc' },
          include: {
            lessonPlans: {
              select: { id: true, dayOfWeek: true, topic: true, status: true },
              orderBy: { dayOfWeek: 'asc' },
            },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
  },

  /** Get one scheme with full details */
  async getById(id: string, schoolId: string) {
    return prisma.schemeOfWork.findFirst({
      where: { id, schoolId },
      include: {
        class: { select: { id: true, name: true } },
        term: { select: { id: true, name: true } },
        creator: { select: { id: true, fullName: true } },
        approver: { select: { id: true, fullName: true } },
        weeks: {
          orderBy: { weekNumber: 'asc' },
          include: {
            lessonPlans: {
              orderBy: { dayOfWeek: 'asc' },
            },
          },
        },
      },
    });
  },

  /** Create a new scheme of work */
  async create(data: {
    schoolId: string;
    subject: string;
    classId: string;
    termId: string;
    title: string;
    description?: string;
    createdById: string;
  }) {
    return prisma.schemeOfWork.create({
      data: {
        schoolId: data.schoolId,
        subject: data.subject,
        classId: data.classId,
        termId: data.termId,
        title: data.title,
        description: data.description || null,
        createdById: data.createdById,
        status: 'DRAFT',
      },
    });
  },

  /** AI-generate weeks + lesson plans for a scheme */
  async generateWeeksForScheme(
    schemeId: string,
    schoolId: string,
    weeks: Array<{
      weekNumber: number;
      topic: string;
      objectives?: string;
      teachingMethods?: string;
      resources?: string;
      assessment?: string;
    }>,
  ) {
    return prisma.$transaction(async (tx) => {
      // Delete existing weeks for this scheme
      await tx.lessonPlan.deleteMany({
        where: { schemeWeek: { schemeId } },
      });
      await tx.schemeWeek.deleteMany({ where: { schemeId } });

      // Create weeks
      for (const week of weeks) {
        const created = await tx.schemeWeek.create({
          data: {
            schemeId,
            weekNumber: week.weekNumber,
            topic: week.topic,
            objectives: week.objectives || null,
            teachingMethods: week.teachingMethods || null,
            resources: week.resources || null,
            assessment: week.assessment || null,
          },
        });

        // Generate 5 lesson plans (Mon-Fri) by default
        const days = [
          { day: 0, topicSuffix: 'Introduction' },
          { day: 1, topicSuffix: 'Development' },
          { day: 2, topicSuffix: 'Practice' },
          { day: 3, topicSuffix: 'Application' },
          { day: 4, topicSuffix: 'Assessment & Review' },
        ];

        for (const d of days) {
          await tx.lessonPlan.create({
            data: {
              schemeWeekId: created.id,
              dayOfWeek: d.day,
              topic: `${week.topic} — ${d.topicSuffix}`,
              objectives: week.objectives || null,
              status: 'DRAFT',
            },
          });
        }
      }
    });
  },

  /** Update scheme metadata */
  async updateMeta(id: string, schoolId: string, data: { title?: string; description?: string; subject?: string }) {
    return prisma.schemeOfWork.updateMany({
      where: { id, schoolId },
      data,
    });
  },

  /** Submit for HOD approval */
  async submitForApproval(id: string, schoolId: string) {
    return prisma.schemeOfWork.updateMany({
      where: { id, schoolId, status: 'DRAFT' },
      data: { status: 'PENDING_APPROVAL' },
    });
  },

  /** Approve a scheme */
  async approve(id: string, schoolId: string, approvedById: string) {
    return prisma.schemeOfWork.updateMany({
      where: { id, schoolId, status: 'PENDING_APPROVAL' },
      data: { status: 'APPROVED', approvedById, approvedAt: new Date() },
    });
  },

  /** Reject a scheme */
  async reject(id: string, schoolId: string, rejectionReason: string) {
    return prisma.schemeOfWork.updateMany({
      where: { id, schoolId, status: 'PENDING_APPROVAL' },
      data: { status: 'REJECTED', rejectionReason: rejectionReason.slice(0, 500) },
    });
  },

  /** Delete a scheme (and cascade weeks + lesson plans) */
  async delete(id: string, schoolId: string) {
    const scheme = await prisma.schemeOfWork.findFirst({ where: { id, schoolId } });
    if (!scheme) throw new Error('Scheme not found');
    if (scheme.status === 'APPROVED') throw new Error('Cannot delete an approved scheme');
    await prisma.schemeOfWork.delete({ where: { id } });
  },

  /** Update a lesson plan */
  async updateLessonPlan(
    id: string,
    data: {
      topic?: string;
      objectives?: string;
      introduction?: string;
      mainActivity?: string;
      conclusion?: string;
      materials?: string;
      homework?: string;
      status?: LessonStatus;
    },
  ) {
    return prisma.lessonPlan.update({
      where: { id },
      data: {
        ...data,
        completedAt: data.status === 'COMPLETED' ? new Date() : undefined,
      },
    });
  },

  /** Update a scheme week */
  async updateWeek(
    id: string,
    data: {
      topic?: string;
      objectives?: string;
      teachingMethods?: string;
      resources?: string;
      assessment?: string;
    },
  ) {
    return prisma.schemeWeek.update({ where: { id }, data });
  },
};
