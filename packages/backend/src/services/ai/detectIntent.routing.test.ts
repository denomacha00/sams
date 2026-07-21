import { describe, expect, it } from 'vitest';
import { detectIntent } from './localEngine';

describe('detectIntent routing (greedy knowledge patterns must not hijack data questions)', () => {
  it('routes real data questions to their DB intent, not custom_knowledge', () => {
    // Regression: "tell me about X" / "what do you know about X" used to sit
    // above the data intents and matched first, so these were answered from the
    // knowledge base (or help text) instead of the database.
    expect(detectIntent('tell me about absent students today')).toBe('absent_students');
    expect(detectIntent('tell me about the attendance rate')).toBe('attendance_percentage');
    expect(detectIntent('tell me about students at risk')).toBe('risk_scores');
    expect(detectIntent('what do you know about the top students')).toBe('top_students');
    expect(detectIntent('tell me about active sessions')).toBe('session_status');
  });

  it('still routes genuine knowledge questions to custom_knowledge', () => {
    expect(detectIntent('who is denis')).toBe('custom_knowledge');
    expect(detectIntent('tell me about the developer')).toBe('custom_knowledge');
    // Open-ended free-text still falls to the knowledge catch-all (last resort).
    expect(detectIntent('tell me about the history of Rome')).toBe('custom_knowledge');
  });

  it('keeps existing specific intents intact', () => {
    expect(detectIntent('what is SAMS')).toBe('about_sams');
    expect(detectIntent('generate timetable')).toBe('generate_timetable');
    expect(detectIntent('remake timetable')).toBe('remake_timetable');
    expect(detectIntent('how many students')).toBe('student_count');
    expect(detectIntent('who is absent')).toBe('absent_students');
  });
});
