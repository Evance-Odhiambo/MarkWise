/**
 * lib/timetableBookingSync.ts
 *
 * Academic timetable no longer uses the Booking model.
 * Room allocation is handled by SharedSession on the Timetable.
 *
 * This module is kept as a no-op shim so callers compile without changes.
 * All functions are safe to call and return immediately.
 */

export interface TimetableEntryData {
  id: string;
  roomId: string;
  lecturerId: string;
  unitId?: string;
  unitCode?: string | null;
  day?: string;
  startTime?: string;
  endTime?: string;
}

/** No-op: room allocation is handled by SharedSession. */
export async function createTimetableBookings(_entry: TimetableEntryData): Promise<number> {
  return 0;
}

/** No-op: room allocation is handled by SharedSession. */
export async function createNextOccurrenceBooking(_entry: TimetableEntryData): Promise<number> {
  return 0;
}

/** No-op: room de-allocation is handled by deleting/updating SharedSession. */
export async function cancelTimetableBookings(_entryId: string): Promise<void> {
  // no-op
}

/** No-op: reschedule is handled by updating SharedSession. */
export async function rescheduleTimetableBookings(_entry: TimetableEntryData): Promise<void> {
  // no-op
}
