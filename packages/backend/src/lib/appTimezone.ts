/** IANA timezone for school-day calculations (cron, daily schedule). */
export function getAppTimezone(): string {
  return process.env.APP_TIMEZONE?.trim() || 'Africa/Nairobi';
}

/** Calendar date YYYY-MM-DD in the given IANA timezone. */
export function getTodayYmdInTimezone(date: Date = new Date(), timeZone: string = getAppTimezone()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(date);
}

/** SAMS schema day (0 = Monday … 6 = Sunday) for a calendar instant in the app timezone. */
export function schemaDayOfWeekInTimezone(
  date: Date = new Date(),
  timeZone: string = getAppTimezone(),
): number {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(date);
  const map: Record<string, number> = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6,
  };
  return map[weekday] ?? 0;
}

/**
 * UTC instant for local midnight at the start of `ymd` (YYYY-MM-DD) in `timeZone`.
 * Uses Intl shortOffset (Node 20+).
 */
export function zonedMidnightUtc(ymd: string, timeZone: string = getAppTimezone()): Date {
  const probe = new Date(`${ymd}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'shortOffset',
  }).formatToParts(probe);
  const tzName = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const match = tzName.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  let offset = '+00:00';
  if (match) {
    const sign = match[1];
    const hh = match[2].padStart(2, '0');
    const mm = (match[3] ?? '00').padStart(2, '0');
    offset = `${sign}${hh}:${mm}`;
  }
  return new Date(`${ymd}T00:00:00${offset}`);
}
