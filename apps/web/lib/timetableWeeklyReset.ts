/**
 * lib/timetableWeeklyReset.ts
 *
 * Timetable status resets are no longer needed: the Timetable model was
 * redesigned and no longer carries per-entry status, reschedule, or
 * time-override fields. Scheduling state lives in SharedSession.
 *
 * This module keeps its public API so import sites compile without change,
 * but the cron is not registered and the reset function is a no-op.
 */

export async function resetWeeklyStatuses(): Promise<void> {
  // no-op — Timetable no longer has status/reschedule fields
}

export function startWeeklyResetCron(): void {
  // no-op — not applicable in new schema
}
