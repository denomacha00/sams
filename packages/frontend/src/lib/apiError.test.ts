import { describe, expect, it } from 'vitest';
import { getApiErrorMessage } from './apiError';

describe('getApiErrorMessage', () => {
  it('returns API error message when present', () => {
    const err = {
      response: {
        data: {
          error: 'Session can only be started during the scheduled time',
          code: 'OUTSIDE_SCHEDULED_TIME',
        },
      },
    };
    expect(getApiErrorMessage(err, 'failed')).toBe(
      'Session can only be started during the scheduled time',
    );
  });

  it('falls back when no response body', () => {
    expect(getApiErrorMessage(new Error('network'), 'failed')).toBe('network');
  });
});
