export interface GeoCoordinates {
  lat: number;
  lng: number;
  accuracy?: number | null;
}

function normalizeGpsError(error: unknown): Error {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? Number((error as { code?: number }).code)
    : undefined;

  if (code === 1) return new Error('GPS_PERMISSION_DENIED');
  if (code === 2) return new Error('GPS_POSITION_UNAVAILABLE');
  if (code === 3) return new Error('GPS_TIMEOUT');
  return error instanceof Error ? error : new Error('GPS_UNAVAILABLE');
}

function normalizePosition(pos: GeolocationPosition): GeoCoordinates {
  const lat = pos.coords.latitude;
  const lng = pos.coords.longitude;

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) {
    throw new Error('GPS_INVALID');
  }

  return {
    lat,
    lng,
    accuracy: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
  };
}

function readPositionOnce(
  options: PositionOptions,
  hardTimeoutMs: number,
): Promise<GeoCoordinates> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.reject(new Error('NO_GEOLOCATION'));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('GPS_TIMEOUT'));
    }, hardTimeoutMs);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        try {
          resolve(normalizePosition(pos));
        } catch (error) {
          reject(error);
        }
      },
      (error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        reject(normalizeGpsError(error));
      },
      options,
    );
  });
}

export function getGpsErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  switch (message) {
    case 'NO_GEOLOCATION':
      return 'Location is not available in this browser. Use HTTPS and allow GPS.';
    case 'GPS_PERMISSION_DENIED':
      return 'Location permission is blocked. Allow location for this site, then try again.';
    case 'GPS_TIMEOUT':
      return 'GPS is taking too long. Turn on phone location, move near a window, and try again.';
    case 'GPS_POSITION_UNAVAILABLE':
      return 'GPS position is unavailable right now. Check phone location settings and try again.';
    case 'GPS_INVALID':
      return 'GPS returned an invalid location. Refresh and try again.';
    default:
      return 'Could not get your location. Allow GPS access and try again.';
  }
}

async function getReliableLocation(timeoutMs = 20_000): Promise<GeoCoordinates> {
  const quickTimeout = Math.min(4_000, timeoutMs);
  const mainTimeout = Math.max(8_000, Math.min(18_000, timeoutMs));

  const attempts: Array<{ options: PositionOptions; timeoutMs: number }> = [
    {
      options: { enableHighAccuracy: false, maximumAge: 120_000, timeout: quickTimeout },
      timeoutMs: quickTimeout + 1_000,
    },
    {
      options: { enableHighAccuracy: true, maximumAge: 0, timeout: mainTimeout },
      timeoutMs: mainTimeout + 2_000,
    },
    {
      options: { enableHighAccuracy: false, maximumAge: 30_000, timeout: 10_000 },
      timeoutMs: 11_000,
    },
  ];

  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      return await readPositionOnce(attempt.options, attempt.timeoutMs);
    } catch (error) {
      lastError = error;
      if (error instanceof Error && error.message === 'GPS_PERMISSION_DENIED') {
        throw error;
      }
    }
  }

  throw normalizeGpsError(lastError);
}

/** Resolve teacher GPS without leaving the UI waiting indefinitely. */
export function getTeacherLocation(timeoutMs = 20_000): Promise<GeoCoordinates> {
  return getReliableLocation(timeoutMs);
}

/** Resolve student GPS for QR/link attendance, using the same reliable fallback flow. */
export function getAttendanceLocation(timeoutMs = 20_000): Promise<GeoCoordinates> {
  return getReliableLocation(timeoutMs);
}
