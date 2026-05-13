import React, { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { io, Socket } from 'socket.io-client';
import apiClient from '../services/apiClient';
import { useAuthStore } from '../store/authStore';
import { AttendanceStatus } from '@sams/shared';

interface TimetableEntry {
  id: string;
  subject: string;
  className: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  room?: string;
}

interface AttendanceRecord {
  id: string;
  studentName: string;
  status: AttendanceStatus;
  method: string;
  scannedAt: string;
}

interface ActiveSession {
  id: string;
  subject: string;
  className: string;
  qrToken: string;
  startedAt: string;
  records: AttendanceRecord[];
}

const SessionPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const [timetableEntries, setTimetableEntries] = useState<TimetableEntry[]>([]);
  const [selectedEntry, setSelectedEntry] = useState('');
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

  // Fetch timetable entries
  useEffect(() => {
    const fetchEntries = async () => {
      try {
        const { data } = await apiClient.get('/timetable');
        setTimetableEntries(data);
      } catch {
        // ignore
      }
    };
    fetchEntries();
  }, []);

  // Generate QR code image from token
  useEffect(() => {
    if (activeSession?.qrToken) {
      QRCode.toDataURL(activeSession.qrToken, { width: 300, margin: 2 })
        .then(setQrDataUrl)
        .catch(console.error);
    }
  }, [activeSession?.qrToken]);

  // Socket.io connection for real-time updates
  useEffect(() => {
    if (!activeSession) return;

    const socket = io(import.meta.env.VITE_WS_URL || window.location.origin, {
      auth: { token: useAuthStore.getState().accessToken },
    });
    socketRef.current = socket;

    socket.emit('join:session', { sessionId: activeSession.id });

    socket.on('qr:refresh', (data: { sessionId: string; qrToken: string }) => {
      if (data.sessionId === activeSession.id) {
        setActiveSession((prev) =>
          prev ? { ...prev, qrToken: data.qrToken } : null
        );
      }
    });

    socket.on('attendance:update', (record: AttendanceRecord) => {
      setActiveSession((prev) => {
        if (!prev) return null;
        const exists = prev.records.find((r) => r.id === record.id);
        if (exists) return prev;
        return { ...prev, records: [...prev.records, record] };
      });
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [activeSession?.id]);

  const startSession = async () => {
    if (!selectedEntry) return;
    setLoading(true);
    setError(null);

    try {
      // Capture GPS
      let location: { lat: number; lng: number } | undefined;
      if (navigator.geolocation) {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 })
        );
        location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      }

      const { data } = await apiClient.post('/sessions', {
        timetableEntryId: selectedEntry,
        location,
      });

      setActiveSession({
        id: data.id,
        subject: data.subject,
        className: data.className,
        qrToken: data.qrToken,
        startedAt: data.startedAt,
        records: [],
      });
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to start session');
    } finally {
      setLoading(false);
    }
  };

  const endSession = async () => {
    if (!activeSession) return;
    setLoading(true);
    try {
      await apiClient.post(`/sessions/${activeSession.id}/end`);
      setActiveSession(null);
      setQrDataUrl('');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to end session');
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: AttendanceStatus) => {
    switch (status) {
      case AttendanceStatus.PRESENT:
        return 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30';
      case AttendanceStatus.LATE:
        return 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30';
      default:
        return 'bg-red-500/20 text-red-300 border border-red-500/30';
    }
  };

  // If no active session, show start form
  if (!activeSession) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6">
        <div className="max-w-lg mx-auto">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-white">Start Attendance Session</h1>
            <p className="text-gray-400 text-sm mt-1">Select a class to begin taking attendance</p>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-500/20 border border-red-400/30 rounded-xl backdrop-blur-sm">
              <p className="text-sm text-red-200">{error}</p>
            </div>
          )}

          <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-6 space-y-5">
            <div>
              <label htmlFor="timetableEntry" className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2">
                Select Class / Subject
              </label>
              <select
                id="timetableEntry"
                value={selectedEntry}
                onChange={(e) => setSelectedEntry(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all duration-200 appearance-none"
              >
                <option value="" className="bg-slate-800">-- Select --</option>
                {timetableEntries.map((entry) => (
                  <option key={entry.id} value={entry.id} className="bg-slate-800">
                    {entry.subject} — {entry.className} ({entry.startTime}–{entry.endTime})
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={startSession}
              disabled={!selectedEntry || loading}
              className="w-full bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold py-3.5 px-4 rounded-xl shadow-lg shadow-purple-500/25 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Starting...
                </span>
              ) : (
                'Start Session'
              )}
            </button>
          </div>

          {/* Footer */}
          <p className="text-center text-xs text-gray-500 mt-8">
            © 2025 SAMS · Developed by Denis Macharia
          </p>
        </div>
      </div>
    );
  }

  // Active session view
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6">
      <div className="max-w-2xl mx-auto">
        {/* Session header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">{activeSession.subject}</h1>
            <p className="text-gray-400">{activeSession.className}</p>
          </div>
          <button
            onClick={endSession}
            disabled={loading}
            className="bg-white/10 border border-red-500/30 text-red-300 py-2 px-4 rounded-xl hover:bg-red-500/20 hover:border-red-400/50 disabled:opacity-50 transition-all duration-200"
          >
            End Session
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-500/20 border border-red-400/30 rounded-xl backdrop-blur-sm">
            <p className="text-sm text-red-200">{error}</p>
          </div>
        )}

        {/* QR Code Display */}
        <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-6 mb-6 text-center">
          <h2 className="text-lg font-semibold text-white mb-4">Scan QR Code</h2>
          {qrDataUrl ? (
            <div className="inline-block p-4 bg-white rounded-2xl shadow-2xl shadow-purple-500/20">
              <img src={qrDataUrl} alt="Attendance QR Code" className="w-64 h-64" />
            </div>
          ) : (
            <div className="flex items-center justify-center h-64">
              <div className="flex space-x-2">
                <div className="w-3 h-3 bg-purple-400 rounded-full animate-bounce" />
                <div className="w-3 h-3 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                <div className="w-3 h-3 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
              </div>
            </div>
          )}
          <p className="text-xs text-gray-500 mt-4">QR refreshes automatically every 30 seconds</p>
        </div>

        {/* Real-time attendance list */}
        <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">Live Attendance</h2>
            <span className="px-3 py-1 bg-purple-500/20 border border-purple-500/30 rounded-full text-xs font-semibold text-purple-300">
              {activeSession.records.length} scanned
            </span>
          </div>

          {activeSession.records.length === 0 ? (
            <div className="text-center py-8">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-white/5 mb-3">
                <svg className="w-6 h-6 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="text-gray-500 text-sm">Waiting for students to scan...</p>
            </div>
          ) : (
            <div className="space-y-2">
              {activeSession.records.map((record) => (
                <div
                  key={record.id}
                  className="flex items-center justify-between p-3 bg-white/5 border border-white/5 rounded-xl"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-xs font-bold text-white">
                      {record.studentName.charAt(0)}
                    </div>
                    <div>
                      <p className="font-medium text-white text-sm">{record.studentName}</p>
                      <p className="text-xs text-gray-500">
                        {record.method} • {new Date(record.scannedAt).toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                  <span className={`px-2.5 py-1 text-xs font-semibold rounded-full ${getStatusBadge(record.status)}`}>
                    {record.status}
                  </span>
                </div>
              ))}
            </div>
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

export default SessionPage;
