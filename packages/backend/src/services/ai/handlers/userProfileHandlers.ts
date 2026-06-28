import type { ActionDefinition, ActionHandler } from '../roleActionRegistry';

// ─── Handlers ─────────────────────────────────────────────────────────────────

const viewProfileHandler: ActionHandler = async (_params, scope) => {
  const { prisma } = await import('../../../lib/prisma');

  const user = await prisma.user.findUnique({
    where: { id: scope.userId },
    select: {
      fullName: true,
      email: true,
      phone: true,
      role: true,
      username: true,
      admissionNumber: true,
      isClassRep: true,
      createdAt: true,
      class: { select: { name: true } },
      department: { select: { name: true } },
      school: { select: { name: true } },
    },
  });

  if (!user) return { answer: 'Could not find your profile.' };

  const lines: string[] = [
    `👤 **${user.fullName}**`,
    '',
    `• **Role:** ${user.role}`,
    `• **Email:** ${user.email || 'N/A'}`,
    `• **Phone:** ${user.phone || 'N/A'}`,
    `• **Username:** ${user.username || 'N/A'}`,
    `• **School:** ${user.school?.name || 'N/A'}`,
  ];

  if (user.admissionNumber) lines.push(`• **Admission No:** ${user.admissionNumber}`);
  if (user.class?.name) lines.push(`• **Class:** ${user.class.name}`);
  if (user.department?.name) lines.push(`• **Department:** ${user.department.name}`);
  if (user.isClassRep) lines.push(`• **Class Rep:** Yes`);
  lines.push(`• **Account created:** ${user.createdAt.toLocaleDateString()}`);

  return {
    answer: lines.join('\n'),
    data: user,
  };
};

const updatePhoneHandler: ActionHandler = async (params, scope) => {
  const { prisma } = await import('../../../lib/prisma');

  const phone = (params.phone as string)?.trim();
  if (!phone) return { answer: 'What phone number should I set?' };

  // Basic phone validation
  const cleanPhone = phone.replace(/[^0-9+]/g, '');
  if (cleanPhone.length < 8) {
    return { answer: 'Please provide a valid phone number (at least 8 digits).' };
  }

  await prisma.user.update({
    where: { id: scope.userId },
    data: { phone: cleanPhone },
  });

  return {
    answer: `✅ Phone number updated to **${cleanPhone}**.`,
    data: { phone: cleanPhone },
  };
};

const changePasswordHandler: ActionHandler = async (_params, _scope) => {
  return {
    answer: `I cannot change your password directly. Here is what you can do:

• **Logged in and remember current password?** Go to **Settings** → **Change Password** in the app.
• **Forgot your password?** Use the **"Forgot Password"** link on the login page — an OTP will be sent to your email/phone.
• **Can't log in?** Ask your **School Admin** or **HOD** to reset your password. They can say **"reset password for [username]"** to me.`,
  };
};

// ─── Action Definitions ───────────────────────────────────────────────────────

export const profileActions: ActionDefinition[] = [
  {
    action: 'view_profile',
    description: 'View your own profile information (name, email, phone, role, class, department)',
    destructive: false,
    patterns: [
      /(?:my\s+)?(?:profile|account|info|details)/i,
      /who\s+am\s+i/i,
      /what('|i)s\s+my\s+(?:name|email|phone|role)/i,
    ],
    extractParams: () => ({}),
    descriptionTemplate: () => 'View your profile information.',
    handler: viewProfileHandler,
  },
  {
    action: 'update_phone',
    description: 'Update your own phone number',
    destructive: false,
    patterns: [
      /(?:update|change|set)\s+(?:my\s+)?phone\s+(?:number\s+)?(?:to\s+)?(.+)/i,
      /change\s+(?:my\s+)?(?:mobile|phone)\s+(?:number\s+)?(?:to\s+)?(.+)/i,
    ],
    extractParams: (_message: string, match: RegExpMatchArray | null) => ({
      phone: match?.[1]?.trim() || '',
    }),
    descriptionTemplate: (params) =>
      `Update your phone number to "${params.phone}".`,
    handler: updatePhoneHandler,
  },
  {
    action: 'change_password',
    description: 'Get instructions on how to change your password',
    destructive: false,
    patterns: [
      /(?:change|update|reset)\s+(?:my\s+)?password/i,
      /forgot\s+(?:my\s+)?password/i,
    ],
    extractParams: () => ({}),
    descriptionTemplate: () => 'Get instructions on how to change/reset your password.',
    handler: changePasswordHandler,
  },
];
