import { describe, expect, it } from 'vitest';
import { isCasualChat, casualChatReply } from '../aiService';

describe('casual chat detection (route short-circuit)', () => {
  it('matches multi-word social chatter that starts with a question word', () => {
    // Regression: "how are you" starts with "how" and previously matched the
    // general-knowledge LLM branch in the route, hanging to a timeout. It must
    // be recognised as casual chat so the route answers instantly.
    expect(isCasualChat('how are you')).toBe(true);
    expect(isCasualChat('how are you doing')).toBe(true);
    expect(isCasualChat("what's up")).toBe(true);
    expect(isCasualChat('you good')).toBe(true);
    expect(isCasualChat("i'm good")).toBe(true);
    expect(isCasualChat('how are you?')).toBe(true);
    // Regression: "are you fine" has no leading "you X" — needs the "are you X" branch.
    expect(isCasualChat('are you fine')).toBe(true);
    expect(isCasualChat('are you okay')).toBe(true);
    expect(isCasualChat('are you doing well')).toBe(true);
    expect(isCasualChat('r u good')).toBe(true);
    expect(isCasualChat('you okay?')).toBe(true);
    expect(isCasualChat('how far')).toBe(true);
    expect(isCasualChat('wassup')).toBe(true);
    expect(isCasualChat('sup')).toBe(true);
    expect(isCasualChat('am good')).toBe(true);
  });

  it('matches single-word greetings and acknowledgements', () => {
    expect(isCasualChat('sawa')).toBe(true);
    expect(isCasualChat('cool')).toBe(true);
    expect(isCasualChat('okay')).toBe(true);
    expect(isCasualChat('pole')).toBe(true);
  });

  it('does NOT treat real questions as casual chat', () => {
    expect(isCasualChat('how many students are absent today')).toBe(false);
    expect(isCasualChat('what is photosynthesis')).toBe(false);
    expect(isCasualChat('who is the school admin')).toBe(false);
    expect(isCasualChat('how do I generate a timetable')).toBe(false);
  });

  it('always returns a non-empty instant reply', () => {
    expect(casualChatReply().length).toBeGreaterThan(0);
  });
});
