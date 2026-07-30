# Offline Attendance Remediation

## Issues Addressed

### 1. False "No Internet" Errors
**Root cause**: `updateLecturerTimetableEntryStatus()` used `hasInternetConnection()` as a precheck, which probes unrelated URLs and can fail even when the API is reachable.

**Fix**: Removed the precheck. The actual API call is now the source of truth. Added a 15-second timeout wrapper (`fetchWithTimeout`) to both primary and fallback endpoints.

### 2. Missing Device ID in Offline Records
**Root cause**: `attendance_records` table lacked a `device_id` column, preventing per-device deduplication.

**Fix**: Added `device_id` column via migration in `ensureAttendanceSchema()`. Created `getOrCreateAttendanceDeviceId()` that generates a persistent `MWD-{timestamp}-{randomhex}` identifier.

### 3. Sync Race Conditions
**Root cause**: Multiple sync triggers could run concurrently, causing duplicate API calls and database contention.

**Fix**: Added module-level mutex (`_isSyncing`) in `offlineAttendanceApi.js` with a queued re-run flag (`_syncQueued`).

### 4. Lecturer Status Updates Blocked by Connectivity Checks
**Root cause**: Same false-negative connectivity issue affecting timetable status changes.

**Fix**: Removed `hasInternetConnection()` precheck from `updateLecturerTimetableEntryStatus()` in `lecturerTimetableApi.js`.

## Files Changed

- `apps/mobile/src/utils/lecturerTimetableApi.js`
- `apps/mobile/src/storage/sqliteStorage.js`
- `apps/mobile/src/utils/offlineAttendanceApi.js`
- `apps/mobile/src/screens/lecturer/OverviewScreen.js`
- `apps/web/app/api/attendance/offline/submit/route.ts`
- `apps/web/app/api/timetable/[id]/route.ts`
- `apps/web/app/api/timetable/entries/[entryId]/status/route.ts`

## Testing

- Verified offline record insertion with `device_id`
- Confirmed sync drain processes records correctly
- Tested connectivity restoration triggers background sync
- Validated deduplication prevents duplicate marks
