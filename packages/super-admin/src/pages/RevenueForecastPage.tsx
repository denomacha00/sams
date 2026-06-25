import React, { useEffect, useState } from 'react';
import apiClient from '../services/apiClient';
import { getSuperAdminApiError } from '../utils/apiError';

interface ForecastMonth {
  month: string;
  projectedRevenue: number;
  activeSchools: number;
  churnedSchools: number;
}

interface ForecastData {
  currentMRR: number;
  projectedMRR: number;
  mrrGrowth: number;
  churnRisk: number;
  assumptions?: {
    source: string;
    churnAssumptionPercent: number;
    planPricesKes: Record<string, number>;
  };
  trend: 'up' | 'down' | 'stable';
  monthlyBreakdown: ForecastMonth[];
}

const RevenueForecastPage: React.FC = () => {
  const [data, setData] = useState<ForecastData | null>(null);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await apiClient.get('/super/revenue/forecast');
        setData(res.data);
        setApiError(null);
      } catch (err: unknown) {
        setApiError(getSuperAdminApiError(err, 'Failed to load revenue forecast.'));
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
          Loading revenue forecast…
        </div>
      </div>
    );
  }

  const mrrTrendUp = data ? data.mrrGrowth >= 0 : true;
  const maxForecast = Math.max(1, ...(data?.monthlyBreakdown ?? []).map((f) => f.projectedRevenue));

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-gray-700/80 bg-gradient-to-br from-gray-800 via-gray-800 to-indigo-950/40 p-7 shadow-xl shadow-black/20">
        <h1 className="text-3xl font-bold tracking-tight text-white">Revenue Forecast Estimate</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-400">
          Estimated MRR and renewal risk from active licenses, plan tiers, and expiry dates.
          Use the Revenue page for actual successful payment totals.
        </p>
      </div>

      {apiError && (
        <div className="rounded-2xl border border-red-500/40 bg-red-950/50 px-4 py-3 text-sm text-red-200">
          {apiError}
        </div>
      )}

      <div className="rounded-2xl border border-gray-700/80 bg-gray-800/80 p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Estimated Monthly Recurring Revenue</p>
            <p className="mt-2 text-4xl font-bold text-white">
              KES {data?.currentMRR.toLocaleString() ?? '—'}
            </p>
            <p className="mt-2 text-xs text-gray-500">
              Not collected cash. Based on license plan prices and active schools.
            </p>
          </div>
          <div className={`flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium ${
            mrrTrendUp
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : 'border-red-500/30 bg-red-500/10 text-red-300'
          }`}>
            <span className={`h-2.5 w-2.5 rounded-full ${mrrTrendUp ? 'bg-emerald-400' : 'bg-red-400'}`} />
            {mrrTrendUp ? 'Up' : 'Down'} ({data?.mrrGrowth.toFixed(1) ?? 0}%)
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section className="rounded-2xl border border-gray-700/80 bg-gray-800/80 p-6 shadow-lg">
          <div className="mb-4 border-b border-gray-700/80 pb-3">
            <h2 className="text-lg font-semibold text-white">Estimated Revenue Forecast</h2>
            <p className="text-sm text-gray-400">Projected monthly license value, not confirmed payments</p>
          </div>
          <div className="space-y-4">
            {(data?.monthlyBreakdown ?? []).length === 0 && (
              <p className="py-6 text-center text-sm text-gray-500">No forecast data available</p>
            )}
            {(data?.monthlyBreakdown ?? []).map((f) => {
              const width = `${Math.max(4, Math.round((f.projectedRevenue / maxForecast) * 100))}%`;
              return (
                <div key={f.month} className="rounded-xl border border-gray-700 bg-gray-900/45 p-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-200 font-medium">{f.month}</span>
                    <span className="text-blue-300 font-semibold">KES {f.projectedRevenue.toLocaleString()}</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-700/70">
                    <div className="h-full rounded-full bg-blue-500" style={{ width }} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-gray-700/80 bg-gray-800/80 p-6 shadow-lg">
          <div className="mb-4 border-b border-gray-700/80 pb-3">
            <h2 className="text-lg font-semibold text-white">Renewal Risk Estimate</h2>
            <p className="text-sm text-gray-400">Schools nearing license expiry based on the forecast assumptions</p>
          </div>
          <div className="space-y-3">
            {data && data.churnRisk > 0 ? (
              <div className="rounded-xl border border-gray-700 bg-gray-900/45 p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-400">Churn rate</span>
                  <span className={`text-lg font-bold ${data.churnRisk > 20 ? 'text-red-400' : data.churnRisk > 10 ? 'text-amber-400' : 'text-emerald-400'}`}>
                    {data.churnRisk}%
                  </span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-gray-700/70">
                  <div className={`h-full rounded-full ${data.churnRisk > 20 ? 'bg-red-500' : data.churnRisk > 10 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                    style={{ width: `${Math.min(100, data.churnRisk)}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  Estimated projected MRR: KES {data.projectedMRR.toLocaleString()}
                </p>
              </div>
            ) : (
              <p className="py-6 text-center text-sm text-gray-500">No churn risk detected</p>
            )}
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-gray-700/80 bg-gray-800/80 p-6 shadow-lg">
        <div className="mb-4 border-b border-gray-700/80 pb-3">
          <h2 className="text-lg font-semibold text-white">Monthly Estimate Detail</h2>
          {data?.assumptions && (
            <p className="mt-1 text-xs leading-5 text-gray-500">
              Assumption: {data.assumptions.churnAssumptionPercent}% of schools expiring in a month may not renew.
            </p>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700/80">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">Month</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-400">Projected Revenue</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-400">Active Schools</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-400">Churned Schools</th>
              </tr>
            </thead>
            <tbody>
              {(data?.monthlyBreakdown ?? []).length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-500">No forecast data</td>
                </tr>
              )}
              {(data?.monthlyBreakdown ?? []).map((f) => (
                <tr key={f.month} className="border-b border-gray-700/30 last:border-0 hover:bg-gray-700/30">
                  <td className="px-4 py-3 text-gray-200">{f.month}</td>
                  <td className="px-4 py-3 text-right font-semibold text-blue-300">KES {f.projectedRevenue.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-gray-400">{f.activeSchools}</td>
                  <td className="px-4 py-3 text-right text-red-400">{f.churnedSchools}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

export default RevenueForecastPage;
