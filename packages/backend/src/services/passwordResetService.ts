import bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import type { User, School } from '@prisma/client';
import { identifierMatchConditions } from '../utils/userIdentifier';
import {
  createOtp,
  deliverOtp,
  isOtpPasswordResetEnabled,
  assertOtpResendAllowed,
} from './otpService';
import { isEmailConfigured } from '../config/email';
import { isSmsConfigured } from '../config/africasTalking';

const BCRYPT_ROUNDS = 12;

export type PasswordResetMode = 'temp_password' | 'trigger_reset';

export type UserWithSchool = User & { school: School };

export function generateTemporaryPassword(length = 12): string {
  return randomBytes(12).toString('base64url').slice(0, length);
}

export type SchoolScope = { schoolCode?: string; schoolId?: string };

export async function findUserForPasswordReset(
  identifier: string,
  schoolScope?: SchoolScope,
): Promise<
  | { ok: true; user: UserWithSchool }
  | { ok: false; code: 'NOT_FOUND' | 'SCHOOL_NOT_FOUND' | 'AMBIGUOUS'; message: string; matches?: UserWithSchool[] }
> {
  const { prisma } = await import('../index');
  const trimmed = identifier.trim();
  if (!trimmed) {
    return { ok: false, code: 'NOT_FOUND', message: 'User identifier is required.' };
  }

  const baseWhere = { OR: identifierMatchConditions(trimmed) };

  let school: School | null = null;
  if (schoolScope?.schoolId) {
    school = await prisma.school.findUnique({ where: { id: schoolScope.schoolId } });
    if (!school) {
      return {
        ok: false,
        code: 'SCHOOL_NOT_FOUND',
        message: `No school found with id "${schoolScope.schoolId}".`,
      };
    }
  } else if (schoolScope?.schoolCode) {
    school = await prisma.school.findUnique({ where: { schoolCode: schoolScope.schoolCode } });
    if (!school) {
      return {
        ok: false,
        code: 'SCHOOL_NOT_FOUND',
        message: `No school found with code "${schoolScope.schoolCode}".`,
      };
    }
  }

  if (school) {
    const user = await prisma.user.findFirst({
      where: { ...baseWhere, schoolId: school.id },
      include: { school: true },
    });
    if (!user) {
      return {
        ok: false,
        code: 'NOT_FOUND',
        message: `No user "${trimmed}" found in school ${school.name} (${school.schoolCode}).`,
      };
    }
    return { ok: true, user };
  }

  const matches = await prisma.user.findMany({
    where: baseWhere,
    include: { school: true },
    take: 6,
  });

  if (matches.length === 0) {
    return {
      ok: false,
      code: 'NOT_FOUND',
      message: `No user found matching "${trimmed}". Provide schoolCode or schoolId if needed.`,
    };
  }

  if (matches.length > 1) {
    return {
      ok: false,
      code: 'AMBIGUOUS',
      message: `Multiple users match "${trimmed}". Specify schoolCode or schoolId.`,
      matches: matches.slice(0, 5),
    };
  }

  return { ok: true, user: matches[0]! };
}

export async function setTemporaryPasswordForUser(userId: string): Promise<string> {
  const { prisma } = await import('../index');
  const tempPassword = generateTemporaryPassword();
  const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);

  await prisma.$transaction([
    prisma.refreshToken.deleteMany({ where: { userId } }),
    prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        passwordResetToken: null,
        passwordResetExpires: null,
        failedLoginCount: 0,
        failedLoginWindowStart: null,
        isLocked: false,
      },
    }),
  ]);

  return tempPassword;
}

export async function triggerPasswordResetDelivery(user: User): Promise<{
  ok: boolean;
  message: string;
  sentVia?: { email?: boolean; sms?: boolean };
  smsError?: string;
  emailError?: string;
}> {
  if (!isOtpPasswordResetEnabled()) {
    return {
      ok: false,
      message:
        'OTP password reset is disabled on the server. Use temp_password mode or enable OTP_PASSWORD_RESET_ENABLED.',
    };
  }

  if (!user.phone && !user.email) {
    return {
      ok: false,
      message: 'User has no phone or email on file. Use temp_password mode instead.',
    };
  }

  if (!isEmailConfigured() && !isSmsConfigured()) {
    return {
      ok: false,
      message: 'SMS and email are not configured. Use temp_password mode instead.',
    };
  }

  try {
    await assertOtpResendAllowed(user.id, 'password_reset');
  } catch (cooldownErr) {
    const retryAfter = (cooldownErr as Error & { retryAfterSeconds?: number }).retryAfterSeconds ?? 60;
    return {
      ok: false,
      message: `Please wait ${retryAfter} seconds before sending another reset code.`,
    };
  }

  const code = await createOtp(user.id, 'password_reset');
  const delivery = await deliverOtp(user, code, 'password_reset');

  if (!delivery.email && !delivery.sms) {
    const parts = [
      delivery.smsError ? `SMS: ${delivery.smsError}` : null,
      delivery.emailError ? `Email: ${delivery.emailError}` : null,
    ].filter(Boolean);
    return {
      ok: false,
      message: parts.join(' ') || 'Failed to deliver reset code.',
      smsError: delivery.smsError,
      emailError: delivery.emailError,
    };
  }

  const channels: string[] = [];
  if (delivery.email) channels.push('email');
  if (delivery.sms) channels.push('SMS');

  return {
    ok: true,
    message: `Password reset code sent via ${channels.join(' and ')}.`,
    sentVia: { email: delivery.email, sms: delivery.sms },
    smsError: delivery.smsError,
    emailError: delivery.emailError,
  };
}

export type PasswordResetActorScope =
  | { kind: 'platform' }
  | { kind: 'school'; schoolId: string };

async function assertSchoolScopedResetAllowed(
  actorScope: Extract<PasswordResetActorScope, { kind: 'school' }>,
  options: { schoolId?: string; schoolCode?: string },
): Promise<{ ok: true } | { ok: false; answer: string }> {
  if (options.schoolId && options.schoolId !== actorScope.schoolId) {
    return {
      ok: false,
      answer: 'You can only reset passwords for users in your own school.',
    };
  }

  if (options.schoolCode) {
    const { prisma } = await import('../index');
    const school = await prisma.school.findUnique({ where: { schoolCode: options.schoolCode } });
    if (school && school.id !== actorScope.schoolId) {
      return {
        ok: false,
        answer: 'You can only reset passwords for users in your own school.',
      };
    }
  }

  return { ok: true };
}

export async function resetUserPasswordByAdmin(options: {
  identifier: string;
  schoolCode?: string;
  schoolId?: string;
  mode?: PasswordResetMode;
  actorId?: string;
  actorRole?: string;
  actorScope: PasswordResetActorScope;
}): Promise<{
  ok: boolean;
  answer: string;
  data?: Record<string, unknown>;
}> {
  const { auditService } = await import('./auditService');
  const mode = options.mode ?? 'temp_password';

  if (options.actorScope.kind === 'school') {
    const scopeCheck = await assertSchoolScopedResetAllowed(options.actorScope, {
      schoolId: options.schoolId,
      schoolCode: options.schoolCode,
    });
    if (!scopeCheck.ok) {
      return scopeCheck;
    }
  }

  const lookupScope =
    options.actorScope.kind === 'school'
      ? { schoolId: options.actorScope.schoolId }
      : { schoolCode: options.schoolCode, schoolId: options.schoolId };

  const lookup = await findUserForPasswordReset(options.identifier, lookupScope);

  if (!lookup.ok) {
    if (lookup.code === 'AMBIGUOUS' && lookup.matches) {
      const list = lookup.matches
        .map((u) => `• ${u.username ?? u.email ?? u.id} — ${u.school.name} (${u.school.schoolCode})`)
        .join('\n');
      return {
        ok: false,
        answer: `${lookup.message}\n\nMatches:\n${list}`,
      };
    }
    return { ok: false, answer: lookup.message };
  }

  const user = lookup.user;
  const displayName = user.username ?? user.email ?? user.admissionNumber ?? user.id;

  if (user.role === 'SUPER_ADMIN') {
    return {
      ok: false,
      answer: 'Cannot reset passwords for Super Admin accounts. Use the platform admin tools instead.',
    };
  }

  if (options.actorScope.kind === 'school' && user.role === 'SCHOOL_ADMIN') {
    return {
      ok: false,
      answer:
        'School admins cannot reset another school admin password via AI. Contact the platform super admin.',
    };
  }

  if (options.actorScope.kind === 'school' && user.schoolId !== options.actorScope.schoolId) {
    return {
      ok: false,
      answer: 'That user is not in your school. You can only reset passwords for users at your school.',
    };
  }

  if (mode === 'trigger_reset') {
    const delivery = await triggerPasswordResetDelivery(user);
    await auditService.log({
      eventType: 'AI_ACTION_EXECUTED',
      actorId: options.actorId,
      actorRole: options.actorRole,
      schoolId: user.schoolId,
      resourceSnapshot: {
        action: 'USER_PASSWORD_RESET_TRIGGERED',
        targetUserId: user.id,
        targetUsername: user.username,
        mode: 'trigger_reset',
        deliveryOk: delivery.ok,
      },
    });

    if (!delivery.ok) {
      return {
        ok: false,
        answer: `Could not send reset code for **${displayName}** (${user.school.name}): ${delivery.message}\n\nTry **temp password** reset instead.`,
        data: { userId: user.id, schoolCode: user.school.schoolCode },
      };
    }

    return {
      ok: true,
      answer: `✅ Reset code sent for **${displayName}** at **${user.school.name}** (${user.school.schoolCode}).\n\n${delivery.message}\n\n⚠️ Passwords cannot be read — only reset.`,
      data: {
        userId: user.id,
        schoolCode: user.school.schoolCode,
        sentVia: delivery.sentVia,
      },
    };
  }

  const tempPassword = await setTemporaryPasswordForUser(user.id);

  await auditService.log({
    eventType: 'AI_ACTION_EXECUTED',
    actorId: options.actorId,
    actorRole: options.actorRole,
    schoolId: user.schoolId,
    resourceSnapshot: {
      action: 'USER_PASSWORD_RESET_BY_ADMIN',
      targetUserId: user.id,
      targetUsername: user.username,
      mode: 'temp_password',
    },
  });

  return {
    ok: true,
    answer: `✅ Temporary password set for **${displayName}** (${user.role}) at **${user.school.name}** (${user.school.schoolCode}).\n\n**Temporary password:** \`${tempPassword}\`\n\n• Account unlocked\n• Ask the user to sign in and change their password immediately\n\n⚠️ Shown once — store securely. Passwords cannot be retrieved, only reset.`,
    data: {
      userId: user.id,
      schoolCode: user.school.schoolCode,
      username: user.username,
      role: user.role,
    },
  };
}

/** Super Admin: cross-school password reset with optional school disambiguation. */
export async function resetUserPasswordBySuperAdmin(options: {
  identifier: string;
  schoolCode?: string;
  schoolId?: string;
  mode?: PasswordResetMode;
  actorId?: string;
  actorRole?: string;
}): Promise<{
  ok: boolean;
  answer: string;
  data?: Record<string, unknown>;
}> {
  return resetUserPasswordByAdmin({
    ...options,
    actorScope: { kind: 'platform' },
  });
}
