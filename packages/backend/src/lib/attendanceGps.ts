export interface GpsCoords {
  lat: number;
  lng: number;
}

export interface SessionGpsAnchor {
  locationLat: number | null;
  locationLng: number | null;
}

export function hasSessionGpsAnchor(session: SessionGpsAnchor): boolean {
  return session.locationLat != null && session.locationLng != null;
}

export function hasSubmittedGps(gpsCoords: GpsCoords): boolean {
  return gpsCoords.lat !== 0 || gpsCoords.lng !== 0;
}

/**
 * Whether a student QR/link scan should enforce haversine distance to the session anchor.
 * Missing GPS is handled separately as GPS_REQUIRED so students cannot bypass required
 * location verification by denying browser/device location access.
 */
export function shouldEnforceSessionGps(
  session: SessionGpsAnchor,
  gpsCoords: GpsCoords,
  studentGpsExempt: boolean,
): boolean {
  if (studentGpsExempt) return false;
  return hasSessionGpsAnchor(session) && hasSubmittedGps(gpsCoords);
}
