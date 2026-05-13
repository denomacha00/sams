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

  // If no active session, show start form
  if (!activeSession) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-lg mx-auto">
          <h1 className="text-2xl font-bold text-gray-900 mb-6">Start Attendance Session</h1>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <div className="bg-white rounded-lg shadow-md p-6 space-y-4">
            <div>
              <label htmlFor="timetableEntry" className="block text-sm font-medium text-gray-700">
                Select Class / Subject
              </label>
              <select
                id="timetableEntry"
                value={selectedEntry}
                onChange={(e) => setSelectedEntry(e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">-- Select --</option>
                {timetableEntries.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.subject} — {entry.className} ({entry.startTime}–{entry.endTime})
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={startSession}
              disabled={!selectedEntry || loading}
              className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Starting...' : 'Start Session'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Active session view
  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{activeSession.subject}</h1>
            <p className="text-gray-600">{activeSession.className}</p>
          </div>
          <button
            onClick={endSession}
            disabled={loading}
            className="bg-red-600 text-white py-2 px-4 rounded-md hover:bg-red-700 disabled:opacity-50"
          >
            End Session
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* QR Code Display */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6 text-center">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">Scan QR Code</h2>
          {qrDataUrl ? (
            <img src={qrDataUrl} alt="Attendance QR Code" className="mx-auto" />
          ) : (
            <p className="text-gray-500">Generating QR code...</p>
          )}
          <p className="text-xs text-gray-400 mt-2">QR refreshes automatically every 30 seconds</p>
        </div>

        {/* Real-time attendance list */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">
            Attendance ({activeSession.records.length})
          </h2>
          {activeSession.records.length === 0 ? (
            <p className="text-gray-500 text-center py-4">Waiting for students to scan...</p>
          ) : (
            <div className="space-y-2">
              {activeSession.records.map((record) => (
                <div
                  key={record.id}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-md"
                >
                  <div>
                    <p className="font-medium text-gray-900">{record.studentName}</p>
                    <p className="text-xs text-gray-500">
                      {record.method} • {new Date(record.scannedAt).toLocaleTimeString()}
                    </p>
                  </div>
                  <span
                    className={`px-2 py-1 text-xs font-medium rounded-full ${
                      record.status === AttendanceStatus.PRESENT
                        ? 'bg-green-100 text-green-800'
                        : record.status === AttendanceStatus.LATE
                        ? 'bg-yellow-100 text-yellow-800'
                        : 'bg-gray-100 text-gray-800'
                    }`}
                  >
                    {record.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SessionPage;
