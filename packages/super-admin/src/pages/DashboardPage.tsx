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

const DashboardPage: React.FC = () => {
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [revenue, setRevenue] = useState<{ totalRevenue: number; byPlanTier: RevenueByTier[] }>({
    totalRevenue: 0,
    byPlanTier: [],
  });
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [analyticsRes, revenueRes] = await Promise.all([
          apiClient.get('/super/analytics'),
          apiClient.get('/super/revenue'),
        ]);
        setAnalytics(analyticsRes.data);
        setRevenue(revenueRes.data);
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
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400 text-lg">Loading dashboard...</div>
      </div>
    );
  }

  const activeSchools = analytics
    ? analytics.totalSchools - analytics.suspendedSchools
    : 0;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-white">Dashboard</h1>

      {apiError && (
        <div className="bg-red-900/50 border border-red-500 text-red-200 px-4 py-3 rounded-lg text-sm">
          {apiError}
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <p className="text-gray-400 text-sm">Total Schools</p>
          <p className="text-3xl font-bold text-white mt-1">{analytics?.totalSchools ?? 0}</p>
          <p className="text-xs text-gray-500 mt-1">
            {activeSchools} active · {analytics?.suspendedSchools ?? 0} suspended
          </p>
        </div>
        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <p className="text-gray-400 text-sm">Total Users</p>
          <p className="text-3xl font-bold text-white mt-1">{analytics?.totalUsers ?? 0}</p>
          <p className="text-xs text-gray-500 mt-1">
            {analytics?.totalStudents ?? 0} students · {analytics?.totalTeachers ?? 0} teachers
          </p>
        </div>
        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <p className="text-gray-400 text-sm">License Status</p>
          <p className="text-3xl font-bold text-yellow-400 mt-1">{analytics?.expiredSchools ?? 0}</p>
          <p className="text-xs text-gray-500 mt-1">schools with expired licenses</p>
        </div>
        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <p className="text-gray-400 text-sm">Total Revenue</p>
          <p className="text-3xl font-bold text-blue-400 mt-1">
            KES {revenue.totalRevenue.toLocaleString()}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            {analytics?.activeSessions ?? 0} active attendance sessions
          </p>
        </div>
      </div>

      {/* Plan Distribution */}
      <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <h2 className="text-lg font-semibold text-white mb-4">Plan Distribution</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {(analytics?.schoolsByPlan ?? []).map(({ planTier, count }) => (
            <div key={planTier} className="text-center">
              <p className="text-2xl font-bold text-white">{count}</p>
              <p className="text-sm text-gray-400">{planTier}</p>
            </div>
          ))}
          {(analytics?.schoolsByPlan ?? []).length === 0 && (
            <p className="text-gray-500 col-span-4 text-center">No schools yet</p>
          )}
        </div>
      </div>

      {/* Revenue by Plan Tier */}
      <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <h2 className="text-lg font-semibold text-white mb-4">Revenue by Plan</h2>
        <div className="space-y-3">
          {revenue.byPlanTier.map((r) => (
            <div key={r.planTier} className="flex items-center justify-between">
              <span className="text-gray-300">{r.planTier}</span>
              <div className="text-right">
                <span className="text-white font-medium">
                  KES {r.totalAmount.toLocaleString()}
                </span>
                <span className="text-gray-500 text-sm ml-2">({r.paymentCount} payments)</span>
              </div>
            </div>
          ))}
          {revenue.byPlanTier.length === 0 && (
            <p className="text-gray-500 text-center">No payments recorded yet</p>
          )}
        </div>
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Link
          to="/licenses"
          className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg p-4 text-center transition-colors"
        >
          Generate License Key
        </Link>
        <Link
          to="/schools"
          className="bg-gray-700 hover:bg-gray-600 text-white rounded-lg p-4 text-center transition-colors"
        >
          Manage Schools
        </Link>
        <Link
          to="/audit-logs"
          className="bg-gray-700 hover:bg-gray-600 text-white rounded-lg p-4 text-center transition-colors"
        >
          View Audit Logs
        </Link>
        <Link
          to="/settings"
          className="bg-gray-700 hover:bg-gray-600 text-white rounded-lg p-4 text-center transition-colors"
        >
          Settings & Status
        </Link>
      </div>
    </div>
  );
};

export default DashboardPage;
