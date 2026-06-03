import { describe, expect, it } from 'vitest';
import { detectIntent } from './localEngine';
import { isTimetableManageQuery, isTimetableViewQuery } from './timetableQuery';

describe('timetableQuery', () => {
  it('detects informal student timetable phrasing', () => {
    expect(isTimetableViewQuery('MY TIME TABLE')).toBe(true);
    expect(isTimetableViewQuery('i want timetable come on')).toBe(true);
    expect(isTimetableViewQuery('show my timetable')).toBe(true);
    expect(isTimetableViewQuery('what is my schedule')).toBe(true);
  });

  it('does not treat generate/remake as view requests', () => {
    expect(isTimetableManageQuery('generate timetable for Form 1A')).toBe(true);
    expect(isTimetableViewQuery('generate timetable for Form 1A')).toBe(false);
    expect(isTimetableViewQuery('remake timetable')).toBe(false);
  });

  it('maps Betty-style messages to view_timetable intent', () => {
    expect(detectIntent('MY TIME TABLE')).toBe('view_timetable');
    expect(detectIntent('i want timetable come on')).toBe('view_timetable');
  });
});
