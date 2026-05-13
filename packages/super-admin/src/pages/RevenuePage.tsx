import React, { useEffect, useState } from 'react';
import apiClient from '../services/apiClient';

interface RevenueByTier {
  planTier: string;
  totalAmount: number;
  paymentCount: number;
}

interface RevenueData {
  totalRevenue: number;
  byPlanTier: RevenueByTier[];
}

const TIER_COLORS: Record<string, string> = {
  TRIAL: 'bg-gray-600',
  BASIC: 'bg-blue-600',
  PROFESSIONAL: 'bg-purple-600',
  ENTERPRISE: 'bg-amber-600',
};

const RevenuePage: React.FC = () => {
  const [revenue, setRevenue] = useState<RevenueData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchRevenue = async () => {
      try {
        const { data } = await apiClient.get('/super/revenue');
        setRevenue(data);
      } catch (err) {
        console.error('Failed to fetch revenue:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchRevenue();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400 text-lg">Loading revenue data...</div>
      </div>
    );
  }

  if (!revenue) {
    return (
      <div className="text-center text-gray-400 py-12">Failed to load revenue data.</div>
    );
  }

  const maxAmount = Math.max(...revenue.byPlanTier.map((r) => r.totalAmount), 1);

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-white">Revenue</h1>

      {/* Total Revenue Card */}
      <div className="bg-gray-800 rounded-lg p-8 border border-gray-700 text-center">
        <p className="text-gray-400 text-sm">Total Revenue</p>
        <p className="text-4xl font-bold text-green-400 mt-2">
          KES {revenue.totalRevenue.toLocaleString()}
        </p>
        <p className="text-gray-500 text-sm mt-1">
          From {revenue.byPlanTier.reduce((sum, r) => sum + r.paymentCount, 0)} successful payments
        </p>
      </div>

      {/* Revenue by Plan Tier */}
      <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <h2 className="text-lg font-semibold text-white mb-6">Revenue by Plan Tier</h2>
        <div className="space-y-6">
          {revenue.byPlanTier.map((tier) => (
            <div key={tier.planTier} className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-gray-300 font-medium">{tier.planTier}</span>
                <div className="text-right">
                  <span className="text-white font-semibold">
                    KES {tier.totalAmount.toLocaleString()}
                  </span>
                  <span className="text-gray-500 text-sm ml-2">
                    ({tier.paymentCount} payments)
                  </span>
                </div>
              </div>
              {/* Progress bar */}
              <div className="w-full bg-gray-700 rounded-full h-3">
                <div
                  className={`h-3 rounded-full ${TIER_COLORS[tier.planTier] || 'bg-blue-600'}`}
                  style={{ width: `${(tier.totalAmount / maxAmount) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Summary Table */}
      <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <h2 className="text-lg font-semibold text-white mb-4">Summary</h2>
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-gray-700">
              <th className="px-4 py-3 text-sm font-medium text-gray-400">Plan Tier</th>
              <th className="px-4 py-3 text-sm font-medium text-gray-400">Total Amount</th>
              <th className="px-4 py-3 text-sm font-medium text-gray-400">Payments</th>
              <th className="px-4 py-3 text-sm font-medium text-gray-400">Avg per Payment</th>
            </tr>
          </thead>
          <tbody>
            {revenue.byPlanTier.map((tier) => (
              <tr key={tier.planTier} className="border-b border-gray-800">
                <td className="px-4 py-3 text-white">{tier.planTier}</td>
                <td className="px-4 py-3 text-green-400">
                  KES {tier.totalAmount.toLocaleString()}
                </td>
                <td className="px-4 py-3 text-gray-300">{tier.paymentCount}</td>
                <td className="px-4 py-3 text-gray-300">
                  KES {tier.paymentCount > 0 ? Math.round(tier.totalAmount / tier.paymentCount).toLocaleString() : 0}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default RevenuePage;
