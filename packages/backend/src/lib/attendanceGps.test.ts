import { describe, it, expect } from 'vitest';
import { hasSessionGpsAnchor, hasSubmittedGps, shouldEnforceSessionGps } from './attendanceGps';

describe('shouldEnforceSessionGps', () => {
  const anchor = { locationLat: -1.2921, locationLng: 36.8219 };

  it('skips when student has GPS exemption permission', () => {
    expect(
      shouldEnforceSessionGps(anchor, { lat: 10, lng: 10 }, true),
    ).toBe(false);
  });

  it('detects missing submitted GPS (0,0)', () => {
    expect(hasSubmittedGps({ lat: 0, lng: 0 })).toBe(false);
    expect(
      shouldEnforceSessionGps(anchor, { lat: 0, lng: 0 }, false),
    ).toBe(false);
  });

  it('skips when session has no anchor (teacher disabled GPS)', () => {
    const noAnchor = { locationLat: null, locationLng: null };
    expect(hasSessionGpsAnchor(noAnchor)).toBe(false);
    expect(
      shouldEnforceSessionGps(
        noAnchor,
        { lat: -1.29, lng: 36.82 },
        false,
      ),
    ).toBe(false);
  });

  it('enforces when anchor, coords, and no exemption', () => {
    expect(
      shouldEnforceSessionGps(anchor, { lat: -1.2922, lng: 36.822 }, false),
    ).toBe(true);
  });
});
