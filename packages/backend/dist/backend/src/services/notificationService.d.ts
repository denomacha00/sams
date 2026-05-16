export interface InAppNotification {
    title: string;
    message: string;
    type: string;
}
export declare class NotificationService {
    private atClient;
    private transporter;
    constructor();
    /**
     * Send an SMS via Africa's Talking.
     * Retries up to 3 times with a 60-second delay on delivery failure.
     * Each retry attempt is logged as SMS_RETRY in the AuditLog.
     *
     * Requirements: 18.4, 18.6
     */
    sendSMS(phone: string, message: string, retryCount?: number): Promise<void>;
    /**
     * Send an email via Nodemailer using SMTP credentials from environment variables.
     * From address is always "SAMS" <noreply@sams.ke>.
     *
     * Requirements: 18.2, 18.3, 18.5
     */
    sendEmail(to: string, subject: string, html: string): Promise<void>;
    /**
     * Send an in-app notification to a specific user via Socket.io.
     * Emits the `notification:new` event to the user's personal room `user:{userId}`.
     *
     * Requirements: 18.1
     */
    sendInApp(userId: string, notification: InAppNotification): Promise<void>;
}
export declare const notificationService: NotificationService;
//# sourceMappingURL=notificationService.d.ts.map