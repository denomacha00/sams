import { describe, expect, it } from 'vitest';
import { detectIntent } from './localEngine';
import {
  detectDataIntent,
  isSamsDataQuery,
  SAMS_DATA_NOT_FOUND_MESSAGE,
} from './dataQueryRouter';
import { isStudentContextQuery } from './studentContextQuery';

describe('dataQueryRouter', () => {
  describe('extended attendance / absent phrasing', () => {
    it('maps student "my attendance" to attendance_percentage', () => {
      expect(detectIntent('what is my attendance')).toBe('attendance_percentage');
      expect(detectDataIntent('my attendance this term')).toBe('attendance_percentage');
    });

    it('maps "am i absent today" to absent_students', () => {
      expect(detectIntent('am i absent today')).toBe('absent_students');
      expect(detectDataIntent('was i absent today')).toBe('absent_students');
    });

    it('maps teacher absent list phrasing', () => {
      expect(detectIntent('who is absent')).toBe('absent_students');
      expect(detectIntent('anyone absent today')).toBe('absent_students');
    });
  });

  describe('isSamsDataQuery', () => {
    it('flags SAMS data questions', () => {
      expect(isSamsDataQuery('my attendance')).toBe(true);
      expect(isSamsDataQuery('show my timetable')).toBe(true);
      expect(isStudentContextQuery('my hod')).toBe(true);
      expect(isSamsDataQuery('my hod')).toBe(true);
      expect(isSamsDataQuery('my teachers')).toBe(true);
      expect(isSamsDataQuery('who is absent today')).toBe(true);
      expect(isSamsDataQuery('risk score for my class')).toBe(true);
    });

    it('does not flag general knowledge', () => {
      expect(isSamsDataQuery('what is photosynthesis')).toBe(false);
      expect(isSamsDataQuery('explain gravity')).toBe(false);
    });

    it('does not flag SAMS product overview', () => {
      expect(isSamsDataQuery('what is SAMS')).toBe(false);
      expect(isSamsDataQuery('what can you do')).toBe(false);
    });

    it('flags keyword-only data questions when intent unknown', () => {
      expect(isSamsDataQuery('give me attendance breakdown by week')).toBe(true);
    });
  });

  it('exposes honest not-found copy', () => {
    expect(SAMS_DATA_NOT_FOUND_MESSAGE).toMatch(/couldn't find/i);
    expect(SAMS_DATA_NOT_FOUND_MESSAGE).not.toMatch(/sample|example schedule/i);
  });
});

describe('anti-hallucination intent coverage by role phrasing', () => {
  it('student: my attendance', () => {
    expect(detectIntent('my attendance')).toBe('attendance_percentage');
  });

  it('student: am i absent today', () => {
    expect(detectIntent('am i absent today')).toBe('absent_students');
  });

  it('teacher: who is absent', () => {
    expect(detectIntent('who is absent in my class')).toBe('absent_students');
  });

  it('hod: risk scores', () => {
    expect(detectIntent('students at risk in my department')).toBe('risk_scores');
  });
});
