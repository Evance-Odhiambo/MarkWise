# Offline Attendance Architecture

## Overview

The offline attendance system enables students and lecturers to mark attendance without an active internet connection. Records are persisted locally in SQLite and synced to the backend when connectivity is restored.

## Components

### Mobile Client
- **SQLite Storage**: `apps/mobile/src/storage/sqliteStorage.js`
  - `attendance_records` table with `device_id`, `synced`, `sync_attempts`
  - Unique indexes for deduplication
- **Offline Queue**: `pending_manual_marks`, `pending_proxy_marks`, `pending_session_ends`
- **Sync Engine**: `apps/mobile/src/utils/offlineAttendanceApi.js`
  - Mutex-guarded background drain
  - Jittered retry to prevent thundering herd

### Device Identity
- **Attendance Device ID**: `getOrCreateAttendanceDeviceId()` in `sqliteStorage.js`
  - Format: `MWD-{timestamp}-{randomhex}`
  - Stored in `app_settings` table
- **Device Key**: `apps/mobile/src/utils/studentDeviceKey.js`
  - 256-bit CSPRNG key in hardware-backed Keychain
  - Registered with backend at `/api/student/register-device`

### Backend Endpoints
- `POST /api/attendance/offline/submit` — accepts offline attendance records
- `POST /api/student/register-device` — registers device key
- `GET /api/attendance/offline/records` — retrieves offline records for sync

## Data Flow

1. Student marks attendance via BLE/QR/PIN
2. Record saved to SQLite with `synced=0`
3. Background sync attempts when internet detected
4. On success, `synced` flipped to `1`
5. Device key registered after first successful sync

## Deduplication

Unique constraint: `(student_key, unit_code, lecture_room, session_start, device_id)`

Prevents duplicate marks from the same device in the same session.
