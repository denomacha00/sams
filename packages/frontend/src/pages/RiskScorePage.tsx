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

const RISK_COLORS: Record<RiskLevel, { bg: string; text: string; badge: string }> = {
  [RiskLevel.LOW]: { bg: 'bg-green-50', text: 'text-green-800', badge: 'bg-green-100' },
  [RiskLevel.MEDIUM]: { bg: 'bg-yellow-50', text: 'text-yellow-800', badge: 'bg-yellow-100' },
  [RiskLevel.HIGH]: { bg: 'bg-orange-50', text: 'text-orange-800', badge: 'bg-orange-100' },
  [RiskLevel.CRITICAL]: { bg: 'bg-red-50', text: 'text-red-800', badge: 'bg-red-100' },
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

  const getScoreBar = (score: number) => {
    const width = Math.min(score, 100);
    let color = 'bg-green-500';
    if (score >= 75) color = 'bg-red-500';
    else if (score >= 50) color = 'bg-orange-500';
    else if (score >= 25) color = 'bg-yellow-500';
    return { width: `${width}%`, color };
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-600">Loading risk scores...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Student Risk Scores</h1>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Filter */}
        <div className="bg-white rounded-lg shadow-md p-4 mb-6">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setFilterLevel('ALL')}
              className={`px-3 py-1 rounded-full text-sm font-medium ${
                filterLevel === 'ALL'
                  ? 'bg-gray-900 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
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
                  className={`px-3 py-1 rounded-full text-sm font-medium ${
                    filterLevel === level
                      ? `${colors.badge} ${colors.text} ring-2 ring-offset-1`
                      : `${colors.badge} ${colors.text} hover:opacity-80`
                  }`}
                >
                  {level} ({count})
                </button>
              );
            })}
          </div>
        </div>

        {/* Risk score list */}
        <div className="space-y-3">
          {filteredScores.length === 0 ? (
            <div className="bg-white rounded-lg shadow-md p-6 text-center">
              <p className="text-gray-500">No students found for this filter.</p>
            </div>
          ) : (
            filteredScores.map((entry) => {
              const colors = RISK_COLORS[entry.riskLevel];
              const bar = getScoreBar(entry.score);
              return (
                <div
                  key={entry.studentId}
                  className={`${colors.bg} rounded-lg shadow-md p-4 border border-opacity-20`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="font-medium text-gray-900">{entry.studentName}</p>
                      {entry.admissionNumber && (
                        <p className="text-xs text-gray-500">{entry.admissionNumber}</p>
                      )}
                    </div>
                    <span
                      className={`px-2 py-1 text-xs font-bold rounded-full ${colors.badge} ${colors.text}`}
                    >
                      {entry.riskLevel}
                    </span>
                  </div>

                  {/* Score bar */}
                  <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
                    <div
                      className={`${bar.color} h-2 rounded-full transition-all`}
                      style={{ width: bar.width }}
                    />
                  </div>

                  <div className="flex justify-between text-xs text-gray-600">
                    <span>Score: {entry.score.toFixed(1)}/100</span>
                    <span>
                      Attendance: {entry.attendanceWeight.toFixed(0)} | Grade: {entry.gradeWeight.toFixed(0)} | Pattern: {entry.patternWeight.toFixed(0)}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export default RiskScorePage;
