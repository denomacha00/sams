import { UserRole } from '@sams/shared';
import type { ActionDefinition, ActionHandler } from '../roleActionRegistry';
import { TIMETABLE_MANAGE_PATTERNS } from '../timetableQuery';

function extractTimetableGenerationParams(message: string): Record<string, unknown> {
  const remake = /\b(remake|regenerate|redo|rebuild|reset|fresh|delete\s+and\s+(?:re)?create)\b/i.test(message);
  const allClasses = /\b(all|whole|entire)\b.*\b(classes|department|dept)\b/i.test(message);
  const classMatch = message.match(/\b(?:for|class)\s+["']?([^"',.]+?)["']?(?:\s+(?:class|now|please|with|using)|$)/i);
  const durationMatch = message.match(/\b(\d{2,3})\s*(?:min|mins|minutes)\b/i);
  const hourMatch = message.match(/\b(?:start(?:ing)?\s+(?:at\s+)?)?([6-9]|10)\s*(?:am)?\b/i);

  return {
    remake,
    allClasses,
    className: classMatch?.[1]?.trim(),
    periodDuration: durationMatch ? Number(durationMatch[1]) : undefined,
    startHour: hourMatch ? Number(hourMatch[1]) : undefined,
  };
}

async function resolveClassId(
  schoolId: string,
  departmentId: string | undefined,
  className: string | undefined,
): Promise<{ id: string; name: string } | null> {
  if (!className) return null;
  const { prisma } = await import('../../../lib/prisma');
  return prisma.class.findFirst({
    where: {
      schoolId,
      ...(departmentId ? { departmentId } : {}),
      name: { contains: className, mode: 'insensitive' },
    },
    select: { id: true, name: true },
  });
}

export const generateTimetableHandler: ActionHandler = async (params, scope) => {
  if (scope.role !== UserRole.HOD) {
    return {
      answer:
        'Timetable generation is only available to HODs in SAMS. School Admins can view and follow the timetable, but HODs own department planning.',
    };
  }

  if (!scope.departmentId) {
    return {
      answer:
        'Your HOD account is not linked to a department, so I cannot generate a timetable. Ask the School Admin to assign your department first.',
    };
  }

  const { timetableGeneratorService } = await import('../../timetableGeneratorService');
  const allClasses = params.allClasses === true;
  const className = typeof params.className === 'string' ? params.className : undefined;

  // Determine which classes to generate for:
  // - If specific class named → that class only
  // - If "all classes" or no class specified → all department classes
  let resolvedClassIds: string[] | undefined;
  if (className && !allClasses) {
    const resolved = await resolveClassId(scope.schoolId, scope.departmentId, className);
    if (!resolved) {
      return {
        answer:
          'Which class should I generate the timetable for? Reply with the class name, or say **all classes** for your department.',
      };
    }
    resolvedClassIds = [resolved.id];
  }
  // undefined = all classes in the department (this is the default)

  try {
    const result = await timetableGeneratorService.generate({
      schoolId: scope.schoolId,
      departmentId: scope.departmentId,
      classIds: resolvedClassIds,
      remake: params.remake === true,
      periodDuration: typeof params.periodDuration === 'number' ? params.periodDuration : 40,
      startHour: typeof params.startHour === 'number' ? params.startHour : 8,
    });

    const scopeLabel = resolvedClassIds ? className || 'selected class' : 'all classes in your department';
    const breakdown = Object.entries(result.stats)
      .slice(0, 12)
      .map(([name, count]) => `• ${name}: ${count} lesson(s)`)
      .join('\n');

    return {
      answer:
        `Done. I generated the timetable for **${scopeLabel}**.\n\n` +
        `Created **${result.entriesCreated}** lesson(s) across **${result.classesProcessed}** class(es), using **${result.teachersUsed}** teacher(s). ` +
        `Skipped **${result.skippedSlots}** slot(s).\n\n` +
        `${breakdown || 'No class breakdown returned.'}\n\n` +
        'Open **Timetable Management** to review or edit the saved slots.',
      data: {
        entriesCreated: result.entriesCreated,
        classesProcessed: result.classesProcessed,
        teachersUsed: result.teachersUsed,
        skippedSlots: result.skippedSlots,
        classNames: result.classNames,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to generate timetable';
    return {
      answer:
        `${message}\n\nI did not save a fake result. HODs and teachers fill their skilled subjects during registration in **Teacher Subjects** page - the generator uses those assignments. Check that teachers have subjects assigned, or say **remake timetable for all classes**.`,
    };
  }
};

export const generateTimetableActionDef: ActionDefinition = {
  action: 'generate_timetable',
  description: 'Generate or remake a department timetable using each teacher\'s skilled subjects from registration',
  destructive: true,
  patterns: TIMETABLE_MANAGE_PATTERNS,
  extractParams: extractTimetableGenerationParams,
  descriptionTemplate: (params) => {
    const target = params.allClasses
      ? 'all classes in your department'
      : params.className
        ? `class "${params.className}"`
        : 'all classes in your department (auto)';
    return `${params.remake ? 'Remake' : 'Generate'} timetable for ${target}.`;
  },
  handler: generateTimetableHandler,
};
