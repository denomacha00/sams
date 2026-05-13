import { describe, it, expect } from 'vitest';
import { haversineDistance } from './gps';

// Acceptable tolerance for floating-point distance comparisons (±1 metre).
const TOLERANCE_M = 1;

describe('haversineDistance', () => {
  // ── Same point ──────────────────────────────────────────────────────────────

  it('returns 0 for the same point', () => {
    expect(haversineDistance(-1.2921, 36.8219, -1.2921, 36.8219)).toBe(0);
  });

  it('returns 0 for the origin (0, 0) to itself', () => {
    expect(haversineDistance(0, 0, 0, 0)).toBe(0);
  });

  // ── Known Nairobi distances ─────────────────────────────────────────────────

  it('returns ~770 m between Nairobi CBD and University of Nairobi', () => {
    // Nairobi CBD: -1.2864, 36.8172
    // University of Nairobi main campus: -1.2795, 36.8166
    const dist = haversineDistance(-1.2864, 36.8172, -1.2795, 36.8166);
    expect(dist).toBeGreaterThan(700);
    expect(dist).toBeLessThan(850);
  });

  it('returns ~12.8 km between JKIA and Nairobi CBD', () => {
    // JKIA: -1.3192, 36.9275
    // Nairobi CBD: -1.2864, 36.8172
    // Actual Haversine result: ~12,793 m
    const dist = haversineDistance(-1.3192, 36.9275, -1.2864, 36.8172);
    expect(dist).toBeGreaterThan(12_500);
    expect(dist).toBeLessThan(13_100);
  });

  // ── Symmetry ────────────────────────────────────────────────────────────────

  it('distance A to B equals distance B to A (symmetry)', () => {
    const lat1 = -1.2921, lng1 = 36.8219;
    const lat2 = -1.3000, lng2 = 36.8500;
    const ab = haversineDistance(lat1, lng1, lat2, lng2);
    const ba = haversineDistance(lat2, lng2, lat1, lng1);
    expect(Math.abs(ab - ba)).toBeLessThanOrEqual(TOLERANCE_M);
  });

  it('symmetry holds for antipodal-ish points', () => {
    const ab = haversineDistance(0, 0, 0, 180);
    const ba = haversineDistance(0, 180, 0, 0);
    expect(Math.abs(ab - ba)).toBeLessThanOrEqual(TOLERANCE_M);
  });

  // ── Large / cross-continental distances ────────────────────────────────────

  it('returns ~6,820 km between Nairobi and London', () => {
    // Nairobi: -1.2921, 36.8219
    // London:  51.5074, -0.1278
    const dist = haversineDistance(-1.2921, 36.8219, 51.5074, -0.1278);
    expect(dist).toBeGreaterThan(6_700_000);
    expect(dist).toBeLessThan(6_950_000);
  });

  it('returns ~12,150 km between Nairobi and Sydney', () => {
    // Nairobi: -1.2921, 36.8219
    // Sydney:  -33.8688, 151.2093
    // Actual Haversine result: ~12,151 km
    const dist = haversineDistance(-1.2921, 36.8219, -33.8688, 151.2093);
    expect(dist).toBeGreaterThan(12_000_000);
    expect(dist).toBeLessThan(12_300_000);
  });

  it('returns ~20,015 km for equatorial antipodal points (half Earth circumference)', () => {
    // (0, 0) and (0, 180): half circumference = pi * 6,371,000 ~ 20,015,087 m
    const dist = haversineDistance(0, 0, 0, 180);
    expect(dist).toBeGreaterThan(20_000_000);
    expect(dist).toBeLessThan(20_030_000);
  });

  // ── Return type ─────────────────────────────────────────────────────────────

  it('always returns a non-negative number', () => {
    const dist = haversineDistance(-1.2921, 36.8219, -1.3000, 36.8500);
    expect(typeof dist).toBe('number');
    expect(dist).toBeGreaterThanOrEqual(0);
  });
});
