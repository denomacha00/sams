import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../services/apiClient';

interface SchoolSummary {
  id: string;
  name: string;
  planTier: string;
  isSuspended: boolean;
}

interface RevenueByTier {
  planTier: string;
  totalAmount: number;
  paymentCount: number;
}

const DashboardPage: React.FC = () => {
  const [schools, setSchools] = useState<SchoolSummary[]>([]);
  const [revenue, setRevenue] = useState<{ totalRevenue: number; byPlanTier: RevenueByTier[] }>({
    totalRevenue: 0,
    byPlanTier: [],
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [schoolsRes, revenueRes] = await Promise.all([
          apiClient.get('/super/schools'),
          apiClient.get('/super/revenue'),
        ]);
        setSchools(schoolsRes.data.schools);
        setRevenue(revenueRes.data);
      } catch (err) {
        console.error('Failed to fetch dashboard data:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const activeSchools = schools.filter((s) => !s.isSuspended).length;
  const suspendedSchools = schools.filter((s) => s.isSuspended).length;

  const planDistribution = schools.reduce<Record<string, number>>((acc, s) => {
    acc[s.planTier] = (acc[s.planTier] || 0) + 1;
    return acc;
  }, {});

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400 text-lg">Loading dashboard...</div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-white">Dashboard</h1>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <p className="text-gray-400 text-sm">Total Schools</p>
          <p className="text-3xl font-bold text-white mt-1">{schools.length}</p>
        </div>
        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <p className="text-gray-400 text-sm">Active Schools</p>
          <p className="text-3xl font-bold text-green-400 mt-1">{activeSchools}</p>
        </div>
        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <p className="text-gray-400 text-sm">Suspended Schools</p>
          <p className="text-3xl font-bold text-red-400 mt-1">{suspendedSchools}</p>
        </div>
        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <p className="text-gray-400 text-sm">Total Revenue</p>
          <p className="text-3xl font-bold text-blue-400 mt-1">
            KES {revenue.totalRevenue.toLocaleString()}
          </p>
        </div>
      </div>

      {/* Plan Distribution */}
      <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <h2 className="text-lg font-semibold text-white mb-4">Plan Distribution</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Object.entries(planDistribution).map(([tier, count]) => (
            <div key={tier} className="text-center">
              <p className="text-2xl font-bold text-white">{count}</p>
              <p className="text-sm text-gray-400">{tier}</p>
            </div>
          ))}
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
        </div>
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
      </div>
    </div>
  );
};

export default DashboardPage;
