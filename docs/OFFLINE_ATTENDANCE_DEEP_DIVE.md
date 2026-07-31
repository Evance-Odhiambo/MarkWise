# Offline Attendance — Implementation Deep Dive

> **Purpose:** This document is the single source of truth for understanding, modifying, and troubleshooting the offline attendance subsystem. It focuses on concrete file paths, data structures, code entry points, and step-by-step operational behavior, complementing the higher-level architecture doc.  
> **Audience:** mobile engineers, backend engineers, QA, security reviewers

---

## Table of contents

1. [Scope and goals](#1-scope-and-goals)
2. [Terminology](#2-terminology)
3. [Mobile implementation map](#3-mobile-implementation-map)
4. [SQLite schema and migrations](#4-sqlite-schema-and-migrations)
5. [Student offline capture — step by step](#5-student-offline-capture--step-by-step)
6. [Lecturer offline session — step by step](#6-lecturer-offline-session--step-by-step)
7. [Background sync engine](#7-background-sync-engine)
8. [Backend endpoints and verification](#8-backend-endpoints-and-verification)
9. [Device identity model](#9-device-identity-model)
10. [Cryptographic flows](#10-cryptographic-flows)
11. [Deduplication strategy](#11-deduplication-strategy)
12. [Error handling and recovery](#12-error-handling-and-recovery)
13. [Testing checklist](#13-testing-checklist)
14. [Common pitfalls](#14-common-pitfalls)

---

## 1. Scope and goals

Offline attendance must satisfy:
- Capture attendance without any network connectivity
- Prevent duplicate marks within the same session
- Survive app restarts and device reboots
- Reconcile queued records with the backend when connectivity returns
- Never expose the lecturer session key to students or the network
- Support relay marking (student A marks and forwards to nearby student B)

Non-goals:
- Offline analytics must be eventually consistent, not real-time
- Offline records are best-effort until server-side verification completes

---

## 2. Terminology

| Term | Meaning |
|------|---------|
| `sessionStart` | Epoch milliseconds (rounded to seconds) when the lecturer started a session |
| `sessionNonce` | CSPRNG `uint32` generated per session; embedded in QR/BLE/PIN tokens |
| `sessionKey` | 32-byte random key; HMAC-SHA256 signing key for QR/BLE/PIN tokens |
| `sessionCounter` | Monotonically increasing counter per session; used for QR rotation and absolute PIN derivation |
| `deviceId` | App-scoped persistent identifier: `MWD-{timestamp}-{randomhex}` |
| `deviceKey` | 256-bit hardware-backed key used to sign relay tokens |
| `synced` | SQLite flag: `0` = pending upload, `1` = confirmed by backend |
| `sync_attempts` | Counter to bound retry attempts before marking record as abandoned |

---

## 3. Mobile implementation map

### Key files

| File | Responsibility |
|------|----------------|
| `apps/mobile/src/screens/student/AttendanceMarker/OfflineMarker.js` | Student capture entry point: QR scan, BLE detection, manual PIN, relay generation, `persistAttendance()` |
| `apps/mobile/src/screens/lecturer/AttendanceTracker/OfflineTaker.js` | Lecturer session start, QR/BLE advertising, manual roster marks, conducted session sync |
| `apps/mobile/src/utils/sessionCrypto.js` | Core crypto: `encodePayload`, `computeToken`, `computePIN`, `encodeBLEBeacon`, `decodeBLEBeacon`, `deriveCounter` |
| `apps/mobile/src/utils/qrSigning.js` | QR prefix encoding (`MWQR0x01:`) and relay QR (`MWQR_RELAY:`) |
| `apps/mobile/src/utils/manualAttendanceToken.js` | 6-digit manual PIN generation/validation |
| `apps/mobile/src/utils/studentDeviceKey.js` | Device key generation (Keychain), backend registration |
| `apps/mobile/src/utils/offlineAttendanceApi.js` | `syncPendingAttendance()`, `submitOfflineAttendance()`, `syncConductedSession()` |
| `apps/mobile/src/utils/onlineAttendanceApi.js` | Online attendance with `DeviceInfo.getUniqueId()` binding |
| `apps/mobile/src/storage/sqliteStorage.js` | SQLite schema, `addAttendanceRecord()`, `hasAttendanceForSession()`, `getOrCreateAttendanceDeviceId()` |

---

## 4. SQLite schema and migrations

### 4.1 Core tables

```sql
-- attendance_records: student marks
CREATE TABLE IF NOT EXISTS attendance_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_key TEXT NOT NULL,
    unit_code TEXT NOT NULL,
    lecture_room TEXT NOT NULL,
    session_start INTEGER NOT NULL,
    scanned_at INTEGER NOT NULL,
    raw_payload TEXT,
    lesson_type TEXT,
    device_id TEXT,               -- added via migration
    synced INTEGER NOT NULL DEFAULT 0,          -- added via migration
    sync_attempts INTEGER NOT NULL DEFAULT 0    -- added via migration
);

-- Unique indexes for deduplication
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_device_session
    ON attendance_records (student_key, unit_code, lecture_room, session_start, device_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_session_dedup
    ON attendance_records (student_key, unit_code, lecture_room, session_start);
```

### 4.2 Lecturer offline queues

```sql
-- pending_manual_marks: lecturer marks made offline
CREATE TABLE IF NOT EXISTS pending_manual_marks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admission_number TEXT NOT NULL,
    student_id TEXT NOT NULL,
    unit_code TEXT NOT NULL,
    lecture_room TEXT NOT NULL,
    session_start INTEGER NOT NULL,
    lecturer_id TEXT NOT NULL,
    marked_at INTEGER NOT NULL,
    synced INTEGER NOT NULL DEFAULT 0,
    sync_attempts INTEGER NOT NULL DEFAULT 0
);

-- pending_proxy_marks: group-leader proxy marks
CREATE TABLE IF NOT EXISTS pending_proxy_marks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    delegation_id TEXT NOT NULL,
    unit_code TEXT NOT NULL,
    lecture_room TEXT NOT NULL,
    session_start INTEGER NOT NULL,
    target_student_id TEXT NOT NULL,
    marked_by TEXT NOT NULL,
    marked_at INTEGER NOT NULL,
    synced INTEGER NOT NULL DEFAULT 0,
    sync_attempts INTEGER NOT NULL DEFAULT 0
);

-- pending_session_ends: delegated session-end calls
CREATE TABLE IF NOT EXISTS pending_session_ends (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    delegation_id TEXT NOT NULL,
    unit_code TEXT NOT NULL,
    lecture_room TEXT NOT NULL,
    session_start INTEGER NOT NULL,
    ended_by TEXT NOT NULL,
    ended_at INTEGER NOT NULL,
    synced INTEGER NOT NULL DEFAULT 0,
    sync_attempts INTEGER NOT NULL DEFAULT 0
);
```

### 4.3 Device identity storage

```sql
-- app_settings: generic key-value store
CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT
);
```

`attendance_device_id` is stored here with key `attendance_device_id`.

---

## 5. Student offline capture — step by step

### 5.1 QR scan flow

1. `OfflineMarker.js` camera handler captures QR frame
2. `decodeQR(raw)` in `qrSigning.js` strips `MWQR0x01:` prefix and Base64-decodes
3. `decodePayload(buffer)` in `sessionCrypto.js` extracts:
   - `unitId`, `roomId`, `sessionStart`, `sessionDuration`, `sessionNonce`
4. Local validation:
   - `sessionNonce` matches cached active session
   - `unitId` and `roomId` match cached session
   - `Date.now()` within session window (`sessionStart` to `sessionStart + sessionDuration`)
   - Token HMAC verified via `computeToken(payload, counter, sessionKey)`
5. `persistAttendance()` writes to SQLite:
   ```javascript
   {
     unitCode,
     lectureRoom,
     sessionStart,
     scannedAt: Date.now(),
     rawPayload: parsed.rawPayload ?? JSON.stringify(parsed),
     deviceId: attendanceDeviceId,
     synced: groupId !== 0 ? 1 : 0,  // GD sessions mark as synced immediately
     lessonType: groupId !== 0 ? 'GRD' : null
   }
   ```
6. `setTimeout(() => syncPendingAttendance().catch(() => {}), Math.random() * SYNC_JITTER_MS)` fires background sync

### 5.2 BLE detection flow

1. `handleBLEDetection(parsed)` in `OfflineMarker.js` receives parsed beacon
2. Checks group restriction for GD sessions
3. Validates enrollment and session active state
4. Motion verification via `attendanceValidator.validateBLEBeacon()`
5. Requires `attendanceDeviceId` — if missing, returns error
6. Calls `persistAttendance()` with `deviceId: attendanceDeviceId`

### 5.3 Manual PIN flow

1. Student enters 6-digit PIN
2. `computeAbsoluteCounter(sessionStart, pin, sessionKey)` derives counter from PIN
3. Reconstructs payload and validates token
4. Same `persistAttendance()` path as QR/BLE

### 5.4 Relay flow

1. Student A marks attendance via QR/BLE/PIN
2. After successful `persistAttendance()`, generates relay token:
   - `deviceKey = getOrCreateDeviceKey()` from Keychain
   - `relayPin = computeRelayPin(deviceKey, sessionNonce, counter)`
   - `relayQR = encodeRelayQR(session, studentId, deviceKey, now)`
3. Student B scans relay QR
4. Student B device validates relay signature locally
5. Student B saves attendance record with their own `deviceId`
6. Both records sync to backend; backend verifies relay HMAC with registered `deviceKey`

---

## 6. Lecturer offline session — step by step

### 6.1 Session start

1. Lecturer selects unit, room, and session type in `OfflineTaker.js`
2. App generates:
   - `sessionStart = Date.now()` rounded to seconds
   - `sessionNonce = crypto.getRandomValues(new Uint32Array(1))[0]`
   - `sessionKey = 64-char hex string`
   - `sessionCounter = 0`
3. Crypto material persisted:
   - In-memory refs: `sessionNonceRef`, `sessionKeyRef`, `sessionCounterRef`
   - Keychain entry: `markwise.lecturer.session_key` keyed by `${unitCode}|${roomCode}|${sessionStart}`
4. Local SQLite inserts `ConductedSession` stub
5. `syncConductedSession()` POSTs to backend:
   ```javascript
   {
     unitCode,
     lectureRoom,
     sessionStart,
     sessionKey,
     sessionNonce
   }
   ```
6. Backend upserts `ConductedSession`; if new, triggers deferred verification on pending `OfflineAttendanceRecord` rows

### 6.2 QR rotation

- `generateQrData()` runs every `QR_ROTATION_MS` (3 seconds)
- `counter = deriveCounter(sessionStart, QR_WINDOW_SECONDS, now)`
- `encoded = encodePayload({ unitId, roomId, sessionStart, sessionDuration, sessionNonce })`
- `token = HMAC-SHA256(encoded|counter, sessionKey)`
- QR content = `Base64(encoded|counter|token)` prefixed `MWQR0x01:`

### 6.3 BLE advertising

- Background BLE service advertises `encodeBLEBeacon({ sessionNonce, counter, unitId, roomId, lessonTypeId })`
- Counter updated every `QR_ROTATION_MS`
- Service restarted when session ends

### 6.4 Manual roster marks

1. Lecturer searches student by admission number or name
2. `manualMarkApi.submitManualMark()` called
3. If online: direct POST to `/api/attendance/manual-mark/submit`
4. If offline: insert into `pending_manual_marks` table
5. Background sync drains `pending_manual_marks` via `syncPendingManualMarks()`

---

## 7. Background sync engine

### 7.1 Trigger conditions

- App foreground (`useFocusEffect` in relevant screens)
- Connectivity restoration (`NetInfo` listener)
- Manual pull-to-refresh
- Periodic timer (some screens poll every 30s)

### 7.2 Mutex and queue

```javascript
// offlineAttendanceApi.js
let _isSyncing = false;
let _syncQueued = false;

export const syncPendingAttendance = async () => {
  if (_isSyncing) {
    _syncQueued = true;
    return;
  }
  _isSyncing = true;
  try {
    // ... drain queues ...
  } finally {
    _isSyncing = false;
    if (_syncQueued) {
      _syncQueued = false;
      syncPendingAttendance();
    }
  }
};
```

### 7.3 Drain order

1. Fetch unsynced `attendance_records` (limit 50, `sync_attempts < 10`)
2. Fetch unsynced `pending_proxy_marks` and `pending_session_ends`
3. Submit each record to `/api/attendance/offline/submit`
4. After successful attendance sync, trigger device key registration
5. Drain `pending_manual_marks` via `syncPendingManualMarks()`
6. Submit proxy marks to `/api/attendance/delegations/{id}/proxy-mark`
7. Submit session ends to `/api/attendance/delegations/{id}/end`

### 7.4 Jitter

`setTimeout(() => syncPendingAttendance().catch(() => {}), Math.random() * SYNC_JITTER_MS)`  
where `SYNC_JITTER_MS = 30000` (30 seconds). Spreads sync calls to prevent thundering herd.

---

## 8. Backend endpoints and verification

### 8.1 Offline submit

`POST /api/attendance/offline/submit`

Request body:
```json
{
  "unitCode": "SCH2170",
  "lectureRoom": "R101",
  "sessionStart": 1690000000,
  "scannedAt": 1690000060,
  "deviceId": "MWD-...",
  "rawPayload": "1Bb2c...="
}
```

Backend logic:
1. Find `ConductedSession` by `(unitCode, lectureRoom, sessionStart)`
2. If `sessionKey` exists, call `verifyRawPayload()` immediately
3. If `sessionKey` does not exist yet, mark record as `pending`
4. Deduplicate by `(studentId, unitCode, lectureRoom, sessionStart)`
5. Return `attendanceId` on success

### 8.2 Conducted session sync

`POST /api/attendance/conducted-sessions/sync`

Request body:
```json
{
  "unitCode": "SCH2170",
  "lectureRoom": "R101",
  "sessionStart": 1690000000,
  "sessionKey": "64-char-hex",
  "sessionNonce": 12345
}
```

Backend upserts `ConductedSession`. If `sessionKey` is new, triggers deferred verification on pending `OfflineAttendanceRecord` rows.

### 8.3 Device key registration

`POST /api/student/register-device`

Request body:
```json
{
  "deviceKey": "64-char-hex",
  "studentId": "STU123",
  "keyVersion": 2
}
```

Backend stores device key for relay signature verification.

---

## 9. Device identity model

### 9.1 Attendance Device ID (`device_id`)

- Generated by `getOrCreateAttendanceDeviceId()` in `sqliteStorage.js`
- Format: `MWD-{timestamp}-{randomhex}` (56 chars)
- Stored in SQLite `app_settings` table
- Cached in-memory as fallback if SQLite unavailable
- Used for:
  - Deduplication index in `attendance_records`
  - Included in offline submission payload
  - Included in online attendance request body

### 9.2 Device Key (`studentDeviceKey.js`)

- Generated by `getOrCreateDeviceKey()` using `crypto.getRandomValues()`
- 256-bit (64 hex chars)
- Stored in `react-native-keychain` with `SECURE_HARDWARE` level
- Registered with backend at `/api/student/register-device`
- Used for:
  - Signing relay PINs (`computeRelayPin`)
  - Signing relay QR codes (`encodeRelayQR`)
  - Backend verifies relay signatures using stored public key material

### 9.3 Why two identifiers?

| Identifier | Purpose | Security level | Persistence |
|-----------|---------|---------------|-------------|
| `deviceId` | Deduplication, offline record tracking | Not secret | SQLite, survives reinstall |
| `deviceKey` | Relay signature verification | Hardware-backed Keychain | Cleared on sign-out |

---

## 10. Cryptographic flows

### 10.1 QR token generation (lecturer)

```
payload = encodePayload({
  unitId,
  roomId,
  sessionStart,
  sessionDuration,
  sessionNonce
})
counter = deriveCounter(sessionStart, QR_WINDOW_SECONDS, now)
token = HMAC-SHA256(payload | counter, sessionKey)
qr = Base64(payload | counter | token)
```

### 10.2 QR token validation (student)

```
decoded = Base64.decode(qr)
payload = decoded[0:N]
counter = decoded[N:N+4]
token = decoded[N+4:]
expected = HMAC-SHA256(payload | counter, sessionKey)
if (expected !== token) reject
if (counter drift > MAX_COUNTER_DRIFT) reject
if (Date.now() outside session window) reject
```

### 10.3 BLE beacon

```
beacon = encodeBLEBeacon({
  sessionNonce,
  counter,
  unitId,
  roomId,
  lessonTypeId
})
// 10 bytes: uint16 nonce, uint16 counter, uint16 unitId, uint16 roomId, uint8 lessonType, uint8 version
```

### 10.4 Relay PIN

```
relayPin = computeRelayPin(deviceKey, sessionNonce, counter)
// HMAC-based derivation, not the session PIN
```

---

## 11. Deduplication strategy

### 11.1 Client-side

```javascript
const alreadyMarked = await sqliteStorage.hasAttendanceForSession({
  unitCode,
  lectureRoom,
  sessionStart
});
if (alreadyMarked) return { saved: false, duplicate: true };
```

`hasAttendanceForSession()` checks `attendance_records` for existing record with same `student_key`, `unit_code`, `lecture_room`, `session_start`.

### 11.2 Server-side

Backend deduplicates by `(studentId, unitCode, lectureRoom, sessionStart)`. Unique constraint prevents duplicate marks regardless of which device submitted.

### 11.3 Device-aware deduplication

Unique index on `(student_key, unit_code, lecture_room, session_start, device_id)` allows:
- Same student to mark from multiple devices
- Prevents rapid double-tap from same device in same session

---

## 12. Error handling and recovery

### 12.1 Offline record retry

```javascript
// syncPendingAttendance fetches records with sync_attempts < 10
const records = await getAllAsync(
  'SELECT * FROM attendance_records WHERE synced = 0 AND sync_attempts < 10'
);
```

After 10 failed attempts, record is abandoned (not retried).

### 12.2 Connectivity restoration

`useSyncOnReconnect` hook triggers `syncPendingAttendance()` when NetInfo reports `isConnected = true`.

### 12.3 App foreground

`useFocusEffect` in `OfflineMarker.js` triggers sync when app comes to foreground.

### 12.4 Manual retry

Pull-to-refresh in `AttendanceMarker` calls `syncPendingAttendance()` directly.

---

## 13. Testing checklist

### 13.1 Offline capture

- [ ] Enable airplane mode
- [ ] Student scans lecturer QR → record saved to SQLite
- [ ] Student receives BLE beacon → record saved
- [ ] Student enters manual PIN → record saved
- [ ] Verify `synced = 0` in SQLite
- [ ] Verify `device_id` populated

### 13.2 Duplicate prevention

- [ ] Scan same QR twice → second attempt rejected
- [ ] Two different devices scan same session → both records saved
- [ ] Same device scans twice → second attempt rejected

### 13.3 Sync

- [ ] Disable airplane mode
- [ ] App foreground triggers sync
- [ ] Verify records uploaded to `/api/attendance/offline/submit`
- [ ] Verify `synced = 1` in SQLite after success
- [ ] Verify `sync_attempts` increments on failure

### 13.4 Relay

- [ ] Student A marks attendance
- [ ] Student A generates relay QR/PIN
- [ ] Student B scans relay
- [ ] Student B record saved with their `deviceId`
- [ ] Both records sync successfully
- [ ] Backend verifies relay signature with registered `deviceKey`

### 13.5 Lecturer offline marks

- [ ] Lecturer marks student offline
- [ ] Record inserted into `pending_manual_marks`
- [ ] Sync drains queue when online
- [ ] Backend confirms mark

---

## 14. Common pitfalls

### 14.1 Missing `device_id`

Symptom: Deduplication index fails, duplicate marks allowed.

Fix: Ensure `getOrCreateAttendanceDeviceId()` is called before `persistAttendance()`. Check `attendance_device_id` exists in `app_settings`.

### 14.2 Sync not triggering

Symptom: Records stay in SQLite with `synced = 0` even after connectivity restored.

Fix: Check:
- `NetInfo` listener is active
- `syncPendingAttendance()` is called (check console for `[Sync]` logs)
- Mutex `_isSyncing` is not stuck (rare; app restart clears it)
- Backend endpoint is reachable

### 14.3 BLE counter drift

Symptom: Student BLE mark rejected with counter drift error.

Fix: Ensure student device time is reasonably synchronized. `MAX_COUNTER_DRIFT` tolerance is built into `attendanceValidator.js`.

### 14.4 Session key not synced

Symptom: Student offline record remains in `pending` state after sync.

Fix: Lecturer must call `syncConductedSession()` to register `sessionKey` with backend before students sync their records.

### 14.5 Device key registration failure

Symptom: Relay marks fail validation on backend.

Fix: Check:
- Student is online during first successful attendance
- `/api/student/register-device` is reachable
- Keychain has valid 64-char hex key
- Backend logs show registration success

---

## Appendix A: Key constants

| Constant | Value | Location |
|----------|-------|----------|
| `QR_ROTATION_MS` | 3000 | `constants.js` |
| `SESSION_DURATION_MS` | 600000 | `constants.js` |
| `GD_SESSION_DURATION_MS` | 600000 | `constants.js` |
| `SYNC_JITTER_MS` | 30000 | `constants.js` |
| `PROBE_TIMEOUT_MS` | 4500 | `connectivity.js` |
| `API_TIMEOUT_MS` | 15000 | `lecturerTimetableApi.js` |
| `MAX_COUNTER_DRIFT` | varies | `attendanceValidator.js` |
| `DEVICE_KEY_VERSION` | 2 | `studentDeviceKey.js` |

## Appendix B: Useful queries

```sql
-- Count pending offline records
SELECT COUNT(*) FROM attendance_records WHERE synced = 0;

-- Count records by sync attempt
SELECT sync_attempts, COUNT(*) FROM attendance_records GROUP BY sync_attempts;

-- Find records stuck in retry loop
SELECT * FROM attendance_records WHERE synced = 0 AND sync_attempts >= 5;

-- Check device ID exists
SELECT value FROM app_settings WHERE key = 'attendance_device_id';

-- List pending manual marks
SELECT * FROM pending_manual_marks WHERE synced = 0;
```
