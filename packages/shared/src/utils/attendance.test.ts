import { describe, it, expect } from 'vitest';
import { classifyAttendanceStatus } from './attendance';
import { AttendanceStatus } from '../types/index';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns a Date that is `offsetMin` minutes after `base`. */
function addMinutes(base: Date, offsetMin: number): Date {
  return new Date(base.getTime() + offsetMin * 60_000);
}

const SESSION_START = new Date('2024-06-01T08:00:00.000Z');
const THRESHOLD = 15; // minutes

// ─── classifyAttendanceStatus ─────────────────────────────────────────────────

describe('classifyAttendanceStatus', () => {
  // ── PRESENT branch ──────────────────────────────────────────────────────────

  it('returns PRESENT when scan is exactly at session start (delta = 0)', () => {
    const result = classifyAttendanceStatus(SESSION_START, SESSION_START, THRESHOLD);
    expect(result).toBe(AttendanceStatus.PRESENT);
  });

  it('returns PRESENT when scan is before session start (negative delta)', () => {
    // Student scanned 5 minutes early
    const scanTime = addMinutes(SESSION_START, -5);
    const result = classifyAttendanceStatus(scanTime, SESSION_START, THRESHOLD);
    expect(result).toBe(AttendanceStatus.PRESENT);
  });

  it('returns PRESENT when scan is well within the late threshold', () => {
    const scanTime = addMinutes(SESSION_START, 10);
    const result = classifyAttendanceStatus(scanTime, SESSION_START, THRESHOLD);
    expect(result).toBe(AttendanceStatus.PRESENT);
  });

  it('returns PRESENT when scan is exactly at the late threshold (boundary)', () => {
    // delta == lateThresholdMin → PRESENT (inclusive boundary)
    const scanTime = addMinutes(SESSION_START, THRESHOLD);
    const result = classifyAttendanceStatus(scanTime, SESSION_START, THRESHOLD);
    expect(result).toBe(AttendanceStatus.PRESENT);
  });

  // ── LATE branch ─────────────────────────────────────────────────────────────

  it('returns LATE when scan is just past the late threshold', () => {
    // delta = threshold + 1 minute
    const scanTime = addMinutes(SESSION_START, THRESHOLD + 1);
    const result = classifyAttendanceStatus(scanTime, SESSION_START, THRESHOLD);
    expect(result).toBe(AttendanceStatus.LATE);
  });

  it('returns LATE when scan is midway between threshold and 2x threshold', () => {
    const scanTime = addMinutes(SESSION_START, Math.floor(1.5 * THRESHOLD));
    const result = classifyAttendanceStatus(scanTime, SESSION_START, THRESHOLD);
    expect(result).toBe(AttendanceStatus.LATE);
  });

  it('returns LATE when scan is exactly at 2x the late threshold (boundary)', () => {
    // delta == 2 * lateThresholdMin → LATE (inclusive boundary)
    const scanTime = addMinutes(SESSION_START, 2 * THRESHOLD);
    const result = classifyAttendanceStatus(scanTime, SESSION_START, THRESHOLD);
    expect(result).toBe(AttendanceStatus.LATE);
  });

  // ── ABSENT branch ────────────────────────────────────────────────────────────

  it('returns ABSENT when scan is just past 2x the late threshold', () => {
    // delta = 2 * threshold + 1 minute
    const scanTime = addMinutes(SESSION_START, 2 * THRESHOLD + 1);
    const result = classifyAttendanceStatus(scanTime, SESSION_START, THRESHOLD);
    expect(result).toBe(AttendanceStatus.ABSENT);
  });

  it('returns ABSENT when scan is far beyond 2x the late threshold', () => {
    const scanTime = addMinutes(SESSION_START, 120);
    const result = classifyAttendanceStatus(scanTime, SESSION_START, THRESHOLD);
    expect(result).toBe(AttendanceStatus.ABSENT);
  });

  // ── Different threshold values ───────────────────────────────────────────────

  it('works correctly with a threshold of 0 (any positive delta → LATE or ABSENT)', () => {
    // delta = 0 → PRESENT (0 <= 0)
    expect(classifyAttendanceStatus(SESSION_START, SESSION_START, 0)).toBe(AttendanceStatus.PRESENT);
    // delta = 0 (exactly 2*0) → LATE (0 <= 0)
    // delta = 1 → ABSENT (1 > 2*0 = 0)
    const oneMinLate = addMinutes(SESSION_START, 1);
    expect(classifyAttendanceStatus(oneMinLate, SESSION_START, 0)).toBe(AttendanceStatus.ABSENT);
  });

  it('works correctly with a large threshold (e.g. 60 minutes)', () => {
    const bigThreshold = 60;
    // 30 min → PRESENT
    expect(classifyAttendanceStatus(addMinutes(SESSION_START, 30), SESSION_START, bigThreshold))
      .toBe(AttendanceStatus.PRESENT);
    // 90 min → LATE (60 < 90 <= 120)
    expect(classifyAttendanceStatus(addMinutes(SESSION_START, 90), SESSION_START, bigThreshold))
      .toBe(AttendanceStatus.LATE);
    // 121 min → ABSENT
    expect(classifyAttendanceStatus(addMinutes(SESSION_START, 121), SESSION_START, bigThreshold))
      .toBe(AttendanceStatus.ABSENT);
  });

  // ── Sub-minute precision ─────────────────────────────────────────────────────

  it('handles sub-minute precision correctly (just under threshold in ms)', () => {
    // 14 minutes and 59 seconds → still PRESENT
    const scanTime = new Date(SESSION_START.getTime() + (THRESHOLD * 60 - 1) * 1000);
    expect(classifyAttendanceStatus(scanTime, SESSION_START, THRESHOLD)).toBe(AttendanceStatus.PRESENT);
  });

  it('handles sub-minute precision correctly (just over threshold in ms)', () => {
    // 15 minutes and 1 second → LATE
    const scanTime = new Date(SESSION_START.getTime() + (THRESHOLD * 60 + 1) * 1000);
    expect(classifyAttendanceStatus(scanTime, SESSION_START, THRESHOLD)).toBe(AttendanceStatus.LATE);
  });
});
