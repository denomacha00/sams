import nodemailer from 'nodemailer';
import AfricasTalking from 'africastalking';
import { io, prisma } from '../index';
import { auditService } from './auditService';
import {
  getAfricasTalkingConfig,
  isSmsConfigured,
  normalizeSmsPhone,
  type AfricasTalkingConfig,
} from '../config/africasTalking';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface InAppNotification {
  title: string;
  message: string;
  type: string;
}

export interface SmsSendResult {
  ok: boolean;
  error?: string;
  recipients?: Array<{ number: string; status: string; statusCode?: number }>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseAtSmsResponse(data: unknown): SmsSendResult {
  const body = data as {
    SMSMessageData?: {
      Message?: string;
      Recipients?: Array<{ number: string; status: string; statusCode?: number }>;
    };
  };
  const recipients = body?.SMSMessageData?.Recipients ?? [];
  const failed = recipients.filter((r) => r.status !== 'Success');
  if (failed.length > 0) {
    return {
      ok: false,
      error: failed.map((r) => `${r.number}: ${r.status}`).join('; '),
      recipients,
    };
  }
  if (recipients.length === 0) {
    const msg = body?.SMSMessageData?.Message;
    return { ok: false, error: msg || 'No recipients in SMS response' };
  }
  return { ok: true, recipients };
}

// ─── Notification Service ─────────────────────────────────────────────────────

export class NotificationService {
  private atClient: ReturnType<typeof AfricasTalking> | null = null;
  private atConfig: AfricasTalkingConfig | null = null;
  private transporter: nodemailer.Transporter;

  constructor() {
    this.atConfig = getAfricasTalkingConfig();
    if (this.atConfig) {
      this.atClient = AfricasTalking({
        apiKey: this.atConfig.apiKey,
        username: this.atConfig.username,
      });
      console.log(
        `[SMS] Africa's Talking ready (username=${this.atConfig.username}, sender=${this.atConfig.senderId}, sandbox=${this.atConfig.sandbox})`,
      );
    } else {
      console.warn('[SMS] Africa\'s Talking not configured — set AT_API_KEY and AT_USERNAME in .env');
    }

    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST ?? 'smtp.gmail.com',
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: Number(process.env.SMTP_PORT ?? 587) === 465,
      auth: {
        user: process.env.SMTP_USER ?? '',
        pass: process.env.SMTP_PASS ?? '',
      },
    });
  }

  getSmsStatus(): {
    configured: boolean;
    sandbox: boolean;
    username: string | null;
    senderId: string | null;
  } {
    if (!this.atConfig) {
      return { configured: false, sandbox: false, username: null, senderId: null };
    }
    return {
      configured: true,
      sandbox: this.atConfig.sandbox,
      username: this.atConfig.username,
      senderId: this.atConfig.senderId,
    };
  }

  /** Single attempt — for admin test endpoint (no 60s retry loop). */
  async sendSMSTest(phone: string, message: string): Promise<SmsSendResult> {
    return this.sendSMSInternal(phone, message, 0, 0);
  }

  /**
   * Send an SMS via Africa's Talking.
   * Retries up to 3 times with a 60-second delay on delivery failure.
   */
  async sendSMS(phone: string, message: string, retryCount = 0): Promise<SmsSendResult> {
    return this.sendSMSInternal(phone, message, retryCount, 3);
  }

  private async sendSMSInternal(
    phone: string,
    message: string,
    retryCount: number,
    maxRetries: number,
  ): Promise<SmsSendResult> {
    if (!this.atClient || !this.atConfig) {
      console.warn('[SMS] Skipped — AT_API_KEY / AT_USERNAME not set');
      return { ok: false, error: 'SMS not configured' };
    }

    const to = normalizeSmsPhone(phone);
    const senderId = this.atConfig.senderId;

    try {
      const data = await this.atClient.SMS.send({
        to: [to],
        message,
        from: senderId,
      });
      const result = parseAtSmsResponse(data);
      if (!result.ok) {
        throw new Error(result.error || 'SMS delivery failed');
      }
      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      if (retryCount < maxRetries) {
        await auditService.log({
          eventType: 'SMS_RETRY',
          resourceSnapshot: {
            phone: to,
            retryCount: retryCount + 1,
            error: errorMessage,
            note: `SMS delivery failed. Retry attempt ${retryCount + 1} of ${maxRetries}.`,
          },
        });

        await sleep(60_000);
        return this.sendSMSInternal(phone, message, retryCount + 1, maxRetries);
      }

      await auditService.log({
        eventType: 'SMS_RETRY',
        resourceSnapshot: {
          phone: to,
          retryCount,
          error: errorMessage,
          note: 'SMS delivery failed. Max retries (3) exceeded.',
        },
      });

      return { ok: false, error: errorMessage };
    }
  }

  async sendEmail(to: string, subject: string, html: string): Promise<void> {
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      console.warn(`[Email] SMTP not configured — skipping email to ${to} (subject: ${subject})`);
      return;
    }

    try {
      const fromAddress = process.env.SMTP_USER ?? 'noreply@sams.ke';
      await this.transporter.sendMail({
        from: `"SAMS" <${fromAddress}>`,
        to,
        subject,
        html,
      });
    } catch (err) {
      console.error(`[Email] Failed to send email to ${to}:`, err instanceof Error ? err.message : err);
    }
  }

  async sendInApp(
    userId: string,
    notification: InAppNotification,
  ): Promise<void> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { schoolId: true },
      });

      if (user) {
        await prisma.notification.create({
          data: {
            schoolId: user.schoolId,
            userId,
            title: notification.title,
            message: notification.message,
            type: notification.type,
          },
        });
      }
    } catch (err) {
      console.error('[NotificationService] Failed to persist in-app notification:', err);
    }

    io.to(`user:${userId}`).emit('notification:new', {
      ...notification,
      timestamp: new Date().toISOString(),
    });
  }
}

export const notificationService = new NotificationService();
export { isSmsConfigured };
