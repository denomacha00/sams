import nodemailer from 'nodemailer';
import AfricasTalking from 'africastalking';
import { io } from '../index';
import { auditService } from './auditService';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface InAppNotification {
  title: string;
  message: string;
  type: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Notification Service ─────────────────────────────────────────────────────

export class NotificationService {
  private atClient: ReturnType<typeof AfricasTalking>;
  private transporter: nodemailer.Transporter;

  constructor() {
    // Africa's Talking SDK initialisation
    this.atClient = AfricasTalking({
      apiKey: process.env.AT_API_KEY ?? '',
      username: process.env.AT_USERNAME ?? '',
    });

    // Nodemailer SMTP transporter
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

  /**
   * Send an SMS via Africa's Talking.
   * Retries up to 3 times with a 60-second delay on delivery failure.
   * Each retry attempt is logged as SMS_RETRY in the AuditLog.
   *
   * Requirements: 18.4, 18.6
   */
  async sendSMS(phone: string, message: string, retryCount = 0): Promise<void> {
    const senderId = process.env.AT_SENDER_ID ?? 'SAMS';

    try {
      await this.atClient.SMS.send({
        to: [phone],
        message,
        from: senderId,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      if (retryCount < 3) {
        // Log the retry attempt
        await auditService.log({
          eventType: 'SMS_RETRY',
          resourceSnapshot: {
            phone,
            retryCount: retryCount + 1,
            error: errorMessage,
            note: `SMS delivery failed. Retry attempt ${retryCount + 1} of 3.`,
          },
        });

        // Wait 60 seconds before retrying
        await sleep(60_000);
        return this.sendSMS(phone, message, retryCount + 1);
      }

      // Max retries exceeded — log final failure and stop
      await auditService.log({
        eventType: 'SMS_RETRY',
        resourceSnapshot: {
          phone,
          retryCount,
          error: errorMessage,
          note: 'SMS delivery failed. Max retries (3) exceeded. No further attempts will be made.',
        },
      });
    }
  }

  /**
   * Send an email via Nodemailer using SMTP credentials from environment variables.
   * From address is always "SAMS" <noreply@sams.ke>.
   *
   * Requirements: 18.2, 18.3, 18.5
   */
  async sendEmail(to: string, subject: string, html: string): Promise<void> {
    await this.transporter.sendMail({
      from: '"SAMS" <noreply@sams.ke>',
      to,
      subject,
      html,
    });
  }

  /**
   * Send an in-app notification to a specific user via Socket.io.
   * Emits the `notification:new` event to the user's personal room `user:{userId}`.
   *
   * Requirements: 18.1
   */
  async sendInApp(
    userId: string,
    notification: InAppNotification,
  ): Promise<void> {
    io.to(`user:${userId}`).emit('notification:new', {
      ...notification,
      timestamp: new Date().toISOString(),
    });
  }
}

// ─── Singleton Export ─────────────────────────────────────────────────────────

export const notificationService = new NotificationService();
