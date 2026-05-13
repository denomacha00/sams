import React, { useState, useEffect } from 'react';
import apiClient from '../services/apiClient';
import { RiskLevel } from '@sams/shared';

interface RiskScoreEntry {
  studentId: string;
  studentName: string;
  admissionNumber?: string;
  score: number;
  riskLevel: RiskLevel;
  attendanceWeight: number;
  gradeWeight: number;
  patternWeight: number;
  computedAt: string;
}

const RISK_COLORS: Record<RiskLevel, { bar: string; badge: string; text: string; glow: string }> = {
  [RiskLevel.LOW]: { bar: 'bg-emerald-500', badge: 'bg-emerald-500/20 border-emerald-500/30', text: 'text-emerald-300', glow: 'shadow-emerald-500/20' },
  [RiskLevel.MEDIUM]: { bar: 'bg-yellow-500', badge: 'bg-yellow-500/20 border-yellow-500/30', text: 'text-yellow-300', glow: 'shadow-yellow-500/20' },
  [RiskLevel.HIGH]: { bar: 'bg-orange-500', badge: 'bg-orange-500/20 border-orange-500/30', text: 'text-orange-300', glow: 'shadow-orange-500/20' },
  [RiskLevel.CRITICAL]: { bar: 'bg-red-500', badge: 'bg-red-500/20 border-red-500/30', text: 'text-red-300', glow: 'shadow-red-500/20' },
};

const RiskScorePage: React.FC = () => {
  const [scores, setScores] = useState<RiskScoreEntry[]>([]);
  const [filteredScores, setFilteredScores] = useState<RiskScoreEntry[]>([]);
  const [filterLevel, setFilterLevel] = useState<RiskLevel | 'ALL'>('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchScores = async () => {
      try {
        const { data } = await apiClient.get('/risk-scores');
        setScores(data);
        setFilteredScores(data);
      } catch (err: any) {
        setError(err.response?.data?.error || 'Failed to load risk scores');
      } finally {
        setLoading(false);
      }
    };
    fetchScores();
  }, []);

  useEffect(() => {
    if (filterLevel === 'ALL') {
      setFilteredScores(scores);
    } else {
      setFilteredScores(scores.filter((s) => s.riskLevel === filterLevel));
    }
  }, [filterLevel, scores]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center">
        <div className="flex items-center gap-3">
          <svg className="animate-spin h-5 w-5 text-purple-400" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <p className="text-gray-400">Loading risk scores...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Student Risk Scores</h1>
          <p className="text-gray-400 text-sm mt-1">Monitor students at risk of poor attendance</p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-500/20 border border-red-400/30 rounded-xl backdrop-blur-sm">
            <p className="text-sm text-red-200 text-center">{error}</p>
          </div>
        )}

        {/* Filter chips */}
        <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-4 mb-6">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setFilterLevel('ALL')}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${
                filterLevel === 'ALL'
                  ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg shadow-purple-500/25'
                  : 'bg-white/10 text-gray-300 border border-white/10 hover:bg-white/20'
              }`}
            >
              All ({scores.length})
            </button>
            {Object.values(RiskLevel).map((level) => {
              const count = scores.filter((s) => s.riskLevel === level).length;
              const colors = RISK_COLORS[level];
              return (
                <button
                  key={level}
                  onClick={() => setFilterLevel(level)}
                  className={`px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${
                    filterLevel === level
                      ? `${colors.badge} ${colors.text} border ring-1 ring-offset-0`
                      : `bg-white/5 ${colors.text} border border-white/10 hover:bg-white/10`
                  }`}
                >
                  {level} ({count})
                </button>
              );
            })}
          </div>
        </div>

        {/* Risk score cards */}
        <div className="space-y-3">
          {filteredScores.length === 0 ? (
            <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-8 text-center">
              <p className="text-gray-500">No students found for this filter.</p>
            </div>
          ) : (
            filteredScores.map((entry) => {
              const colors = RISK_COLORS[entry.riskLevel];
              const width = Math.min(entry.score, 100);
              return (
                <div
                  key={entry.studentId}
                  className={`backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-5 hover:bg-white/[0.07] transition-all duration-200 ${colors.glow}`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-sm font-bold text-white">
                        {entry.studentName.charAt(0)}
                      </div>
                      <div>
                        <p className="font-medium text-white">{entry.studentName}</p>
                        {entry.admissionNumber && (
                          <p className="text-xs text-gray-500">{entry.admissionNumber}</p>
                        )}
                      </div>
                    </div>
                    <span className={`px-3 py-1 text-xs font-bold rounded-full border ${colors.badge} ${colors.text}`}>
                      {entry.riskLevel}
                    </span>
                  </div>

                  {/* Progress bar */}
                  <div className="w-full bg-white/10 rounded-full h-2.5 mb-3">
                    <div
                      className={`${colors.bar} h-2.5 rounded-full transition-all duration-500`}
                      style={{ width: `${width}%` }}
                    />
                  </div>

                  <div className="flex justify-between text-xs text-gray-500">
                    <span>Score: <span className={`font-semibold ${colors.text}`}>{entry.score.toFixed(1)}</span>/100</span>
                    <span className="flex gap-3">
                      <span>Attendance: {entry.attendanceWeight.toFixed(0)}</span>
                      <span>Grade: {entry.gradeWeight.toFixed(0)}</span>
                      <span>Pattern: {entry.patternWeight.toFixed(0)}</span>
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-gray-500 mt-8">
          © 2025 SAMS · Developed by Denis Macharia
        </p>
      </div>
    </div>
  );
};

export default RiskScorePage;
