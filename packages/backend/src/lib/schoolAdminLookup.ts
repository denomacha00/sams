import type { ActionHandler } from '../services/ai/roleActionRegistry';

export interface SchoolAdminInfo {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
}

export function formatSchoolAdminAnswer(admins: SchoolAdminInfo[]): string {
  if (admins.length === 0) {
    return 'No school administrator is assigned in SAMS for your school yet. Contact your school office or platform support.';
  }

  const lines = admins.map((a) => {
    const contact: string[] = [];
    if (a.email) contact.push(a.email);
    if (a.phone) contact.push(a.phone);
    const suffix = contact.length > 0 ? ` (${contact.join(' · ')})` : '';
    return `• **${a.fullName}**${suffix}`;
  });

  const heading =
    admins.length === 1
      ? '🏫 **School administrator**'
      : '🏫 **School administrators**';

  return `${heading}\n\n${lines.join('\n')}\n\nContact them for account issues, class assignments, and HOD assignments.`;
}

export const listSchoolAdminHandler: ActionHandler = async (_params, scope) => {
  const { prisma } = await import('./prisma');

  const rows = await prisma.user.findMany({
    where: { schoolId: scope.schoolId, role: 'SCHOOL_ADMIN' },
    select: { id: true, fullName: true, email: true, phone: true },
    orderBy: { fullName: 'asc' },
  });

  const admins: SchoolAdminInfo[] = rows.map((r) => ({
    id: r.id,
    fullName: r.fullName,
    email: r.email,
    phone: r.phone,
  }));

  return {
    answer: formatSchoolAdminAnswer(admins),
    data: { schoolId: scope.schoolId, admins },
  };
};
