import { prisma } from '../lib/prisma';
import { notificationService } from './notificationService';
import { superAdminFeaturesService } from './superAdminFeaturesService';

const DEFAULT_RECIPIENT = 'denomacha000000@gmail.com';

export async function sendPlatformSummaryEmail(recipient?: string): Promise<{
  ok: boolean;
  message: string;
  sentTo: string;
}> {
  const to = recipient?.trim() || DEFAULT_RECIPIENT;
  const now = new Date();

  // Gather stats
  const [
    totalSchools,
    suspendedSchools,
    expiredLicenses,
    activeSessions,
    totalStudents,
    totalTeachers,
    totalUsers,
    totalRevenue,
    recentAlerts,
    systemHealth,
  ] = await Promise.all([
    prisma.school.count(),
    prisma.school.count({ where: { isSuspended: true } }),
    prisma.school.count({ where: { licenseExpiresAt: { lt: now } } }),
    prisma.attendanceSession.count({ where: { isActive: true } }),
    prisma.user.count({ where: { role: 'STUDENT' } }),
    prisma.user.count({ where: { role: 'TEACHER' } }),
    prisma.user.count(),
    prisma.payment.aggregate({ _sum: { amount: true }, where: { status: 'SUCCESS' } }),
    prisma.securityEvent.count({ where: { createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } } }),
    superAdminFeaturesService.getSystemHealth(),
  ]);

  // Attendance records today
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayAttendance = await prisma.attendanceRecord.count({
    where: { scannedAt: { gte: todayStart } },
  });

  const activeSchools = totalSchools - suspendedSchools;
  const totalRev = Number(totalRevenue._sum.amount ?? 0);

  const healthStatus = systemHealth.status === 'healthy' ? '✅ Healthy' :
    systemHealth.status === 'degraded' ? '⚠️ Degraded' : '🔴 Unhealthy';

  const html = [
    `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f101a; color: #ececf5; padding: 24px; }
      .card { background: #181923; border: 1px solid #262841; border-radius: 12px; padding: 20px; margin-bottom: 16px; }
      h1 { font-size: 20px; margin: 0 0 4px; color: #fff; }
      .subtitle { color: #989bb3; font-size: 13px; margin-bottom: 20px; }
      .stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px; }
      .stat { background: #1e1f4a; border-radius: 8px; padding: 12px; }
      .stat-label { font-size: 11px; color: #989bb3; text-transform: uppercase; letter-spacing: 0.05em; }
      .stat-value { font-size: 22px; font-weight: 700; color: #6366f1; margin-top: 4px; }
      .stat-value.green { color: #22c55e; }
      .stat-value.red { color: #ef4444; }
      .stat-value.amber { color: #f59e0b; }
      .section-title { font-size: 14px; font-weight: 600; color: #fff; margin: 20px 0 12px; }
      .footer { margin-top: 24px; padding-top: 16px; border-top: 1px solid #262841; font-size: 11px; color: #76799b; }
    </style></head><body>
    <h1>📊 SAMS Platform Summary</h1>
    <p class="subtitle">${now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>

    <div class="card">
      <div class="stat-grid">
        <div class="stat">
          <div class="stat-label">Schools</div>
          <div class="stat-value">${totalSchools}</div>
          <div style="font-size:11px;color:#76799b;margin-top:4px">${activeSchools} active · ${suspendedSchools} suspended</div>
        </div>
        <div class="stat">
          <div class="stat-label">Users</div>
          <div class="stat-value">${totalUsers}</div>
          <div style="font-size:11px;color:#76799b;margin-top:4px">${totalStudents} students · ${totalTeachers} teachers</div>
        </div>
        <div class="stat">
          <div class="stat-label">Attendance Today</div>
          <div class="stat-value green">${todayAttendance}</div>
          <div style="font-size:11px;color:#76799b;margin-top:4px">${activeSessions} active sessions</div>
        </div>
        <div class="stat">
          <div class="stat-label">Revenue</div>
          <div class="stat-value">KES ${totalRev.toLocaleString()}</div>
          <div style="font-size:11px;color:#76799b;margin-top:4px">All-time successful payments</div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="section-title" style="margin-top:0">⚠️ Risk Indicators</div>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <tr>
          <td style="padding:8px 0;color:#989bb3">Expired Licenses</td>
          <td style="padding:8px 0;text-align:right;font-weight:600;${expiredLicenses > 0 ? 'color:#ef4444' : 'color:#22c55e'}">${expiredLicenses}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;border-top:1px solid #262841;color:#989bb3">Suspended Schools</td>
          <td style="padding:8px 0;border-top:1px solid #262841;text-align:right;font-weight:600;${suspendedSchools > 0 ? 'color:#ef4444' : 'color:#22c55e'}">${suspendedSchools}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;border-top:1px solid #262841;color:#989bb3">Security Events (24h)</td>
          <td style="padding:8px 0;border-top:1px solid #262841;text-align:right;font-weight:600;${recentAlerts > 10 ? 'color:#f59e0b' : 'color:#22c55e'}">${recentAlerts}</td>
        </tr>
      </table>
    </div>

    <div class="card">
      <div class="section-title" style="margin-top:0">🔧 System Health</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        <span style="background:#1e1f4a;padding:8px 14px;border-radius:6px;font-size:12px;color:#989bb3">
          Status: <strong style="color:#fff">${healthStatus}</strong>
        </span>
        <span style="background:#1e1f4a;padding:8px 14px;border-radius:6px;font-size:12px;color:#989bb3">
          DB: <strong style="color:#fff">${systemHealth.database.connected ? '✅' : '❌'}</strong>
        </span>
        <span style="background:#1e1f4a;padding:8px 14px;border-radius:6px;font-size:12px;color:#989bb3">
          API Error Rate: <strong style="color:#fff">${systemHealth.api.recentErrorRate}%</strong>
        </span>
      </div>
    </div>

    <div class="footer">
      This is an automated SAMS platform summary. Generated at ${now.toISOString()}.
    </div>
    </body></html>`,
  ].join('\n');

  const result = await notificationService.sendEmail(to, `SAMS Platform Summary — ${now.toLocaleDateString()}`, html);

  return {
    ok: result.ok,
    message: result.ok
      ? `✅ Platform summary sent to ${to}`
      : `❌ Failed to send email: ${result.error || 'unknown error'}`,
    sentTo: to,
  };
}
