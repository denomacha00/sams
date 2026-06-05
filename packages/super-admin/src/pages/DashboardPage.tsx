import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../services/apiClient';
import { getSuperAdminApiError } from '../utils/apiError';

interface Analytics {
  totalSchools: number;
  totalStudents: number;
  totalTeachers: number;
  totalUsers: number;
  activeSessions: number;
  suspendedSchools: number;
  expiredSchools: number;
  schoolsByPlan: { planTier: string; count: number }[];
}

interface RevenueByTier {
  planTier: string;
  totalAmount: number;
  paymentCount: number;
}

interface SystemStatus {
  status: 'ok' | 'degraded';
  checks: { database: boolean; redis: boolean };
}

interface StatCardProps {
  label: string;
  value: React.ReactNode;
  detail: string;
  tone?: 'indigo' | 'blue' | 'orange';
}

const toneStyles = {
  indigo: {
    border: 'border-l-indigo-500',
    icon: 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300',
    value: 'text-white',
  },
  blue: {
    border: 'border-l-blue-500',
    icon: 'bg-blue-500/10 border-blue-500/30 text-blue-300',
    value: 'text-blue-300',
  },
  orange: {
    border: 'border-l-amber-500',
    icon: 'bg-amber-500/10 border-amber-500/30 text-amber-300',
    value: 'text-amber-300',
  },
};

const StatCard: React.FC<StatCardProps> = ({ label, value, detail, tone = 'indigo' }) => {
  const styles = toneStyles[tone];
  return (
    <div className={`rounded-2xl border border-gray-700/80 border-l-4 ${styles.border} bg-gray-800/80 p-5 shadow-lg shadow-black/10 transition-all hover:-translate-y-0.5 hover:border-indigo-500/40`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">{label}</p>
          <p className={`mt-3 text-3xl font-bold tabular-nums ${styles.value}`}>{value}</p>
        </div>
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${styles.icon}`}>
          <span className="h-2.5 w-2.5 rounded-full bg-current" />
        </div>
      </div>
      <p className="mt-3 text-sm text-gray-500">{detail}</p>
    </div>
  );
};

const SectionCard: React.FC<{ title: string; subtitle?: string; children: React.ReactNode }> = ({
  title,
  subtitle,
  children,
}) => (
  <section className="rounded-2xl border border-gray-700/80 bg-gray-800/80 p-6 shadow-lg shadow-black/10">
    <div className="mb-5 flex flex-col gap-1 border-b border-gray-700/80 pb-4">
      <h2 className="text-lg font-semibold tracking-tight text-white">{title}</h2>
      {subtitle && <p className="text-sm text-gray-400">{subtitle}</p>}
    </div>
    {children}
  </section>
);

const DashboardPage: React.FC = () => {
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [revenue, setRevenue] = useState<{ totalRevenue: number; byPlanTier: RevenueByTier[] }>({
    totalRevenue: 0,
    byPlanTier: [],
  });
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [analyticsRes, revenueRes, statusRes] = await Promise.all([
          apiClient.get('/super/analytics'),
          apiClient.get('/super/revenue'),
          apiClient.get('/super/system-status'),
        ]);
        setAnalytics(analyticsRes.data);
        setRevenue(revenueRes.data);
        setSystemStatus(statusRes.data);
        setApiError(null);
      } catch (err: unknown) {
        setApiError(getSuperAdminApiError(err, 'Failed to load dashboard. Check login and server logs.'));
        console.error('Failed to fetch dashboard data:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-[18rem] items-center justify-center">
        <div className="rounded-2xl border border-gray-700 bg-gray-800 px-5 py-4 text-sm text-gray-300 shadow-lg">
          Loading dashboard…
        </div>
      </div>
    );
  }

  const activeSchools = analytics ? analytics.totalSchools - analytics.suspendedSchools : 0;
  const totalSchools = analytics?.totalSchools ?? 0;
  const totalUsers = analytics?.totalUsers ?? 0;
  const expiredSchools = analytics?.expiredSchools ?? 0;
  const activeSessions = analytics?.activeSessions ?? 0;
  const maxPlanCount = Math.max(1, ...(analytics?.schoolsByPlan ?? []).map((plan) => plan.count));
  const maxRevenue = Math.max(1, ...revenue.byPlanTier.map((tier) => tier.totalAmount));

  return (
    <div className="space-y-8">
      <div className="rounded-3xl border border-gray-700/80 bg-gradient-to-br from-gray-800 via-gray-800 to-indigo-950/40 p-7 shadow-xl shadow-black/20">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-300">Super Admin</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-white">Platform dashboard</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-400">
              Monitor school health, license risk, revenue, and live system readiness from one control surface.
            </p>
          </div>

          {systemStatus && (
            <Link
              to="/settings"
              className={`inline-flex w-fit items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition-colors ${
                systemStatus.status === 'ok'
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/15'
                  : 'border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/15'
              }`}
            >
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  systemStatus.status === 'ok' ? 'bg-emerald-400' : 'bg-amber-400'
                }`}
              />
              {systemStatus.status === 'ok' ? 'Platform healthy' : 'Platform degraded'}
              <span className="text-xs opacity-75">
                DB {systemStatus.checks.database ? '✓' : '✗'} · Redis {systemStatus.checks.redis ? '✓' : '✗'}
              </span>
            </Link>
          )}
        </div>
      </div>

      {apiError && (
        <div className="rounded-2xl border border-red-500/40 bg-red-950/50 px-4 py-3 text-sm text-red-200">
          {apiError}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total schools"
          value={totalSchools.toLocaleString()}
          detail={`${activeSchools.toLocaleString()} active · ${(analytics?.suspendedSchools ?? 0).toLocaleString()} suspended`}
        />
        <StatCard
          label="Total users"
          value={totalUsers.toLocaleString()}
          detail={`${(analytics?.totalStudents ?? 0).toLocaleString()} students · ${(analytics?.totalTeachers ?? 0).toLocaleString()} teachers`}
        />
        <StatCard
          label="License risk"
          value={expiredSchools.toLocaleString()}
          detail="schools with expired licenses"
          tone={expiredSchools > 0 ? 'orange' : 'indigo'}
        />
        <StatCard
          label="Total revenue"
          value={`KES ${revenue.totalRevenue.toLocaleString()}`}
          detail={`${activeSessions.toLocaleString()} active attendance sessions`}
          tone="blue"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <SectionCard title="Plan distribution" subtitle="Current school count by subscription tier">
          <div className="space-y-4">
            {(analytics?.schoolsByPlan ?? []).map(({ planTier, count }) => {
              const width = `${Math.max(6, Math.round((count / maxPlanCount) * 100))}%`;
              return (
                <div key={planTier} className="rounded-xl border border-gray-700 bg-gray-900/45 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm font-medium text-gray-200">{planTier}</span>
                    <span className="text-lg font-bold tabular-nums text-white">{count.toLocaleString()}</span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-700/70">
                    <div className="h-full rounded-full bg-indigo-500" style={{ width }} />
                  </div>
                </div>
              );
            })}
            {(analytics?.schoolsByPlan ?? []).length === 0 && (
              <p className="rounded-xl border border-dashed border-gray-700 py-8 text-center text-sm text-gray-500">
                No schools yet
              </p>
            )}
          </div>
        </SectionCard>

        <SectionCard title="Revenue by plan" subtitle="Payment volume and value by license tier">
          <div className="space-y-4">
            {revenue.byPlanTier.map((tier) => {
              const width = `${Math.max(6, Math.round((tier.totalAmount / maxRevenue) * 100))}%`;
              return (
                <div key={tier.planTier} className="rounded-xl border border-gray-700 bg-gray-900/45 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-gray-200">{tier.planTier}</p>
                      <p className="mt-1 text-xs text-gray-500">{tier.paymentCount.toLocaleString()} payments</p>
                    </div>
                    <span className="text-right text-sm font-semibold text-blue-300">
                      KES {tier.totalAmount.toLocaleString()}
                    </span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-700/70">
                    <div className="h-full rounded-full bg-blue-500" style={{ width }} />
                  </div>
                </div>
              );
            })}
            {revenue.byPlanTier.length === 0 && (
              <p className="rounded-xl border border-dashed border-gray-700 py-8 text-center text-sm text-gray-500">
                No payments recorded yet
              </p>
            )}
          </div>
        </SectionCard>
      </div>
    </div>
  );
};

export default DashboardPage;
