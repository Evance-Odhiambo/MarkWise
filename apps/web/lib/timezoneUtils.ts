import { DateTime } from 'luxon';

export function parseToUtc(dateString: string, timezone: string): Date {
  // Handles ISO 8601 with offset or naive local time with explicit timezone
  return DateTime.fromISO(dateString, { zone: timezone }).toUTC().toJSDate();
}
