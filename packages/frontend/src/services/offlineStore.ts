import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { OfflineAttendanceRecord, CachedTemplate, CachedSession, CachedStudent } from '@sams/shared';

interface SAMSDatabase extends DBSchema {
  pendingAttendance: {
    key: string;
    value: OfflineAttendanceRecord;
    indexes: { 'by-session': string; 'by-synced': string };
  };
  biometricTemplates: {
    key: string;
    value: CachedTemplate;
    indexes: { 'by-class': string };
  };
  sessionCache: {
    key: string;
    value: CachedSession;
  };
  studentCache: {
    key: string;
    value: CachedStudent;
    indexes: { 'by-class': string };
  };
}

const DB_NAME = 'sams-offline';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<SAMSDatabase>> | null = null;

function getDB(): Promise<IDBPDatabase<SAMSDatabase>> {
  if (!dbPromise) {
    dbPromise = openDB<SAMSDatabase>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // Pending attendance store
        const attendanceStore = db.createObjectStore('pendingAttendance', { keyPath: 'id' });
        attendanceStore.createIndex('by-session', 'sessionId');
        attendanceStore.createIndex('by-synced', 'synced');

        // Biometric templates store
        const bioStore = db.createObjectStore('biometricTemplates', { keyPath: 'studentId' });
        bioStore.createIndex('by-class', 'classId');

        // Session cache store
        db.createObjectStore('sessionCache', { keyPath: 'sessionId' });

        // Student cache store
        const studentStore = db.createObjectStore('studentCache', { keyPath: 'studentId' });
        studentStore.createIndex('by-class', 'classId');
      },
    });
  }
  return dbPromise;
}

// ─── Attendance Records ──────────────────────────────────────────────────────

export async function saveAttendanceRecord(record: OfflineAttendanceRecord): Promise<void> {
  const db = await getDB();
  await db.put('pendingAttendance', record);
}

export async function getPendingRecords(): Promise<OfflineAttendanceRecord[]> {
  const db = await getDB();
  const all = await db.getAll('pendingAttendance');
  return all.filter((r) => !r.synced);
}

export async function markSynced(recordId: string): Promise<void> {
  const db = await getDB();
  const record = await db.get('pendingAttendance', recordId);
  if (record) {
    record.synced = true;
    await db.put('pendingAttendance', record);
  }
}

// ─── Biometric Templates ─────────────────────────────────────────────────────

export async function saveBiometricTemplate(template: CachedTemplate): Promise<void> {
  const db = await getDB();
  await db.put('biometricTemplates', template);
}

export async function getTemplatesForClass(classId: string): Promise<CachedTemplate[]> {
  const db = await getDB();
  return db.getAllFromIndex('biometricTemplates', 'by-class', classId);
}

// ─── Session Cache ───────────────────────────────────────────────────────────

export async function saveSession(session: CachedSession): Promise<void> {
  const db = await getDB();
  await db.put('sessionCache', session);
}

export async function getSession(sessionId: string): Promise<CachedSession | undefined> {
  const db = await getDB();
  return db.get('sessionCache', sessionId);
}

// ─── Student Cache ───────────────────────────────────────────────────────────

export async function saveStudent(student: CachedStudent): Promise<void> {
  const db = await getDB();
  await db.put('studentCache', student);
}

export async function getStudentsForClass(classId: string): Promise<CachedStudent[]> {
  const db = await getDB();
  return db.getAllFromIndex('studentCache', 'by-class', classId);
}
