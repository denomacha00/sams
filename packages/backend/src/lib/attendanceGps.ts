export interface GpsCoords {
  lat: number;
  lng: number;
}

export interface SessionGpsAnchor {
  locationLat: number | null;
  locationLng: number | null;
}

/**
 * Whether a student QR/link scan should enforce haversine distance to the session anchor.
 */
export function shouldEnforceSessionGps(
  session: SessionGpsAnchor,
  gpsCoords: GpsCoords,
  studentGpsExempt: boolean,
): boolean {
  if (studentGpsExempt) return false;
  const hasCoords = gpsCoords.lat !== 0 || gpsCoords.lng !== 0;
  if (!hasCoords) return false;
  return session.locationLat != null && session.locationLng != null;
}
