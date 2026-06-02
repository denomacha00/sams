export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromName: string;
  fromEmail: string;
}

export function getSmtpConfig(): SmtpConfig | null {
  const user = process.env.SMTP_USER?.trim() ?? '';
  const pass = process.env.SMTP_PASS?.trim() ?? '';

  if (!user || !pass || user === 'your-email@gmail.com' || pass === 'your-smtp-app-password') {
    return null;
  }

  const port = Number(process.env.SMTP_PORT ?? 587);
  const fromEmail = process.env.SMTP_FROM_EMAIL?.trim() || user;

  return {
    host: process.env.SMTP_HOST?.trim() || 'smtp.gmail.com',
    port,
    secure: port === 465,
    user,
    pass,
    fromName: process.env.SMTP_FROM_NAME?.trim() || 'SAMS',
    fromEmail,
  };
}

export function isEmailConfigured(): boolean {
  return getSmtpConfig() !== null;
}
