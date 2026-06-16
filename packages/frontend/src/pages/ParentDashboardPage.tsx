import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { UserRole } from '@sams/shared';
import apiClient from '../services/apiClient';

// ─── Types ───────────────────────────────────────────────────────────────────

interface WardInfo {
  id: string;
  student: {
    id: string;
    fullName: string;
    admissionNumber: string | null;
    class: { id: string; name: string } | null;
  };
  relation: string | null;
}

interface AttendanceSummary {
  totalExpected: number;
  totalPresent: number;
  totalLate: number;
  totalExcused: number;
  totalAbsent: number;
  attendancePercentage: number;
}

interface ReportCardSubject {
  subject: string;
  catAverage: number | null;
  endTermScore: number | null;
  finalScore: number;
  grade: string | null;
  points: number;
}

interface ReportCard {
  subjects: ReportCardSubject[];
  totalPoints: number;
  subjectCount: number;
  meanGrade: string | null;
}

// ─── Icons ───────────────────────────────────────────────────────────────────

const ICONS = {
  users: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z',
  check: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
  chart: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
  warning: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z',
  book: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253',
  calendar: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
  bell: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9',
  qr: 'M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z',
  fire: 'M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z',
  profile: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
  settings: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z',
  academic: 'M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(): string {
  return new Date().toLocaleDateString('en-KE', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

function formatTime(): string {
  return new Date().toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });
}

// ─── Ward Card ───────────────────────────────────────────────────────────────

const WardCard: React.FC<{
  ward: WardInfo;
  attendance: AttendanceSummary | null;
  reportCard: ReportCard | null;
  activeTermName: string | null;
}> = ({ ward, attendance, reportCard, activeTermName }) => {
  const { student } = ward;
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="surface-panel rounded-2xl p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-full bg-brand/20 flex items-center justify-center text-brand font-bold text-lg shrink-0">
              {student.fullName.charAt(0).toUpperCase()}
            </div>
            <div>
              <h3 className="font-bold text-ink text-lg">{student.fullName}</h3>
              <p className="text-sm text-ink-muted">
                {student.class?.name ?? 'No class'} · {student.admissionNumber ?? '—'}
                {ward.relation && ` · ${ward.relation}`}
              </p>
            </div>
          </div>

          {attendance && (
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-surface-muted rounded-xl p-3 text-center">
                <p className="text-xs text-ink-muted">Attendance</p>
                <p className={`text-lg font-bold ${attendance.attendancePercentage >= 75 ? 'text-green-400' : 'text-accent-orange'}`}>
                  {Math.round(attendance.attendancePercentage)}%
                </p>
              </div>
              <div className="bg-surface-muted rounded-xl p-3 text-center">
                <p className="text-xs text-ink-muted">Present</p>
                <p className="text-lg font-bold text-green-400">{attendance.totalPresent}</p>
              </div>
              <div className="bg-surface-muted rounded-xl p-3 text-center">
                <p className="text-xs text-ink-muted">Absent</p>
                <p className="text-lg font-bold text-red-400">{attendance.totalAbsent}</p>
              </div>
              <div className="bg-surface-muted rounded-xl p-3 text-center">
                <p className="text-xs text-ink-muted">Late</p>
                <p className="text-lg font-bold text-amber-400">{attendance.totalLate}</p>
              </div>
            </div>
          )}

          {reportCard && reportCard.subjects.length > 0 && (
            <div className="mt-4">
              <button
                onClick={() => setExpanded(!expanded)}
                className="flex items-center gap-2 text-sm text-brand hover:text-brand-hover font-medium"
              >
                {expanded ? 'Hide' : 'View'} report card
                <svg className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {expanded && (
                <div className="mt-3 space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-ink-muted">Mean Grade:</span>
                    <span className="font-bold text-ink">{reportCard.meanGrade ?? '—'}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-ink-muted">Total Points:</span>
                    <span className="font-bold text-ink">{reportCard.totalPoints}</span>
                  </div>
                  <div className="overflow-x-auto mt-3">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-line">
                          <th className="text-left py-1.5 pr-2 text-ink-muted font-medium">Subject</th>
                          <th className="text-right py-1.5 px-2 text-ink-muted font-medium">CAT Avg</th>
                          <th className="text-right py-1.5 px-2 text-ink-muted font-medium">End Term</th>
                          <th className="text-right py-1.5 px-2 text-ink-muted font-medium">Final</th>
                          <th className="text-right py-1.5 pl-2 text-ink-muted font-medium">Grade</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reportCard.subjects.map((s) => (
                          <tr key={s.subject} className="border-b border-line/30">
                            <td className="py-1.5 pr-2 text-ink font-medium">{s.subject}</td>
                            <td className="py-1.5 px-2 text-right text-ink-muted">{s.catAverage?.toFixed(1) ?? '—'}</td>
                            <td className="py-1.5 px-2 text-right text-ink-muted">{s.endTermScore?.toFixed(1) ?? '—'}</td>
                            <td className="py-1.5 px-2 text-right text-ink font-semibold">{s.finalScore.toFixed(1)}</td>
                            <td className="py-1.5 pl-2 text-right font-bold">{s.grade ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {!attendance && (
            <p className="mt-4 text-sm text-ink-subtle">No attendance data yet for this term.</p>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Main ParentDashboardPage ────────────────────────────────────────────────

const ParentDashboardPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();

  const [wards, setWards] = useState<WardInfo[]>([]);
  const [attendanceMap, setAttendanceMap] = useState<Record<string, AttendanceSummary>>({});
  const [reportCardMap, setReportCardMap] = useState<Record<string, ReportCard>>({});
  const [activeTermId, setActiveTermId] = useState<string | null>(null);
  const [activeTermName, setActiveTermName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(formatTime());

  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(formatTime()), 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      setLoading(true);
      try {
        // 1. Get wards
        const wardsRes = await apiClient.get('/guardians/wards');
        const wardList: WardInfo[] = Array.isArray(wardsRes.data) ? wardsRes.data : [];
        if (cancelled) return;
        setWards(wardList);

        // 2. Get active term
        const termsRes = await apiClient.get('/exams/terms');
        const terms = Array.isArray(termsRes.data) ? termsRes.data : [];
        const active = terms.find((t: any) => t.isActive);
        if (active) {
          setActiveTermId(active.id);
          setActiveTermName(active.name);
        }

        // 3. Load attendance & report card for each ward in parallel
        const attPromises = wardList.map((ward) =>
          apiClient.get(`/reports/student/${ward.student.id}`)
            .then((res) => ({ studentId: ward.student.id, data: res.data as AttendanceSummary }))
            .catch(() => ({ studentId: ward.student.id, data: null })),
        );

        const attResults = await Promise.all(attPromises);
        if (cancelled) return;

        const attMap: Record<string, AttendanceSummary> = {};
        for (const r of attResults) {
          if (r.data) attMap[r.studentId] = r.data;
        }
        setAttendanceMap(attMap);

        // 4. Load report cards if we have a term
        if (active) {
          const rcPromises = wardList.map((ward) =>
            apiClient.get(`/exams/report-card/${ward.student.id}/${active.id}`)
              .then((res) => ({ studentId: ward.student.id, data: res.data as ReportCard }))
              .catch(() => ({ studentId: ward.student.id, data: null })),
          );
          const rcResults = await Promise.all(rcPromises);
          if (cancelled) return;

          const rcMap: Record<string, ReportCard> = {};
          for (const r of rcResults) {
            if (r.data) rcMap[r.studentId] = r.data;
          }
          setReportCardMap(rcMap);
        }
      } catch {
        // Non-fatal
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadData();
    return () => { cancelled = true; };
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="page-shell">
      <style>{`
        @keyframes fadeInUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>

      {/* Header */}
      <header className="app-header">
        <div className="max-w-7xl mx-auto px-6 lg:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-brand flex items-center justify-center shadow-sm">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-bold text-ink tracking-tight">Parent Portal</h1>
              <p className="text-xs text-ink-muted font-medium">Monitor your children's attendance & grades</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden md:flex flex-col items-end mr-2">
              <span className="text-sm text-ink font-medium">{currentTime}</span>
              <span className="text-xs text-ink-muted">{formatDate()}</span>
            </div>

            <Link to="/notifications" className="nav-icon-btn" title="Notifications">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={ICONS.bell} />
              </svg>
            </Link>

            <Link to="/profile" className="nav-icon-btn" title="Profile">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={ICONS.profile} />
              </svg>
            </Link>

            <Link to="/settings" className="nav-icon-btn" title="Settings">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={ICONS.settings} />
              </svg>
            </Link>

            <button onClick={handleLogout} className="text-sm text-ink-muted hover:text-red-600 px-3 py-1.5 rounded-lg hover:bg-red-500/15 border border-transparent hover:border-red-200 transition-all duration-300">
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 lg:px-8 py-10">
        {/* Welcome */}
        <div className="surface-card p-8 mb-8" style={{ animation: 'fadeInUp 0.5s ease-out forwards' }}>
          <h2 className="text-3xl font-bold text-ink tracking-tight mb-2">
            Welcome, {user?.fullName?.split(' ')[0] || 'Parent'}
          </h2>
          <p className="text-ink-muted text-base max-w-lg">
            Here's an overview of your children's academic progress.
            {activeTermName && <span> Active term: <strong className="text-brand">{activeTermName}</strong></span>}
          </p>
        </div>

        {/* Wards */}
        {loading ? (
          <div className="space-y-4">
            {[1, 2].map((i) => (
              <div key={i} className="animate-pulse surface-panel rounded-2xl p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-full bg-surface-elevated" />
                  <div className="space-y-2 flex-1">
                    <div className="h-5 w-44 bg-surface-elevated rounded" />
                    <div className="h-3 w-28 bg-surface-elevated rounded" />
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-3">
                  {[1, 2, 3, 4].map((j) => <div key={j} className="h-16 bg-surface-elevated rounded-xl" />)}
                </div>
              </div>
            ))}
          </div>
        ) : wards.length === 0 ? (
          <div className="surface-panel rounded-2xl p-10 text-center">
            <svg className="w-16 h-16 mx-auto text-ink-subtle mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={ICONS.users} />
            </svg>
            <h3 className="text-lg font-bold text-ink mb-2">No linked students</h3>
            <p className="text-ink-muted text-sm max-w-md mx-auto">
              You haven't been linked to any students yet. Contact your school's administration to link you as a parent/guardian.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {wards.map((ward) => (
              <WardCard
                key={ward.id}
                ward={ward}
                attendance={attendanceMap[ward.student.id] ?? null}
                reportCard={reportCardMap[ward.student.id] ?? null}
                activeTermName={activeTermName}
              />
            ))}
          </div>
        )}
      </main>

      <footer className="border-t border-line mt-16 py-8">
        <div className="max-w-7xl mx-auto px-6 lg:px-8 text-center">
          <p className="text-xs text-ink-subtle">&copy; 2025 SAMS — Parent Portal</p>
        </div>
      </footer>
    </div>
  );
};

export default ParentDashboardPage;
