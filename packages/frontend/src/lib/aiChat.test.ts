import { describe, expect, it } from 'vitest';
import { getAiErrorMessage, isAiVisionFailureIntent } from './aiChat';

describe('aiChat', () => {
  it('prefers server answer from error responses', () => {
    const msg = getAiErrorMessage(
      { response: { status: 500, data: { answer: 'Vision model unavailable' } } },
      'fallback',
    );
    expect(msg).toBe('Vision model unavailable');
  });

  it('maps 413 to a short upload message', () => {
    const msg = getAiErrorMessage({ response: { status: 413, data: {} } }, 'fallback');
    expect(msg).toContain('photo');
    expect(msg).not.toContain('5 MB');
  });

  it('maps session expired responses', () => {
    const msg = getAiErrorMessage(
      { response: { status: 401, data: { intent: 'session_expired' } } },
      'fallback',
    );
    expect(msg).toContain('session');
  });

  it('detects vision failure intents', () => {
    expect(isAiVisionFailureIntent('image_analysis_error')).toBe(true);
    expect(isAiVisionFailureIntent('image_analysis')).toBe(false);
  });
});
