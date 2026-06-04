import { describe, it, expect, vi, afterEach } from 'vitest';
import { getTeacherLocation } from './geolocation';

describe('getTeacherLocation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects when geolocation is unavailable', async () => {
    vi.stubGlobal('navigator', { geolocation: undefined });
    await expect(getTeacherLocation(100)).rejects.toThrow('NO_GEOLOCATION');
  });

  it('resolves coordinates from getCurrentPosition', async () => {
    vi.stubGlobal('navigator', {
      geolocation: {
        getCurrentPosition: (
          success: PositionCallback,
        ) => success({ coords: { latitude: -1.28, longitude: 36.82 } } as GeolocationPosition),
      },
    });

    await expect(getTeacherLocation(5000)).resolves.toEqual({ lat: -1.28, lng: 36.82 });
  });
});
