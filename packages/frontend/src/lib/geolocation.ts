/** Resolve teacher GPS with a hard cap so UI never waits indefinitely on getCurrentPosition. */
export async function getTeacherLocation(timeoutMs = 8_000): Promise<{ lat: number; lng: number }> {
  if (!navigator.geolocation) {
    throw new Error('NO_GEOLOCATION');
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('GPS_TIMEOUT')), timeoutMs);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
      { timeout: timeoutMs, maximumAge: 60_000, enableHighAccuracy: false },
    );
  });
}
