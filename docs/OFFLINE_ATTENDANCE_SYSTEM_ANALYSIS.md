# MarkWise Offline Attendance System — End-to-End Technical Analysis

> **Status:** Published  
> **Scope:** lecturer capture, relay mechanisms, offline queuing, backend verification, reporting  
> **Audience:** engineers, security reviewers, QA

---

## Table of contents

1. [Executive summary](#1-executive-summary)
2. [System architecture](#2-system-architecture)
3. [Data flow overview](#3-data-flow-overview)
4. [Core components](#4-core-components)
5. [Operational flows](#5-operational-flows)
6. [Cryptographic model](#6-cryptographic-model)
7. [Offline-first design](#7-offline-first-design)
8. [BLE relay system](#8-ble-relay-system)
9. [QR code system](#9-qr-code-system)
10. [Manual PIN system](#10-manual-pin-system)
11. [Manual lecturer mark](#11-manual-lecturer-mark)
12. [Online attendance](#12-online-attendance)
13. [Sync mechanisms](#13-sync-mechanisms)
14. [Edge cases and failure modes](#14-edge-cases-and-failure-modes)
15. [System dependencies](#15-system-dependencies)
16. [Data model summary](#16-data-model-summary)
17. [Implementation notes](#17-implementation-notes)

---

## 1. Executive summary

MarkWise supports marking attendance through multiple capture methods—QR scan, BLE beacon, manual PIN, lecturer manual mark, online click, and student BLE/QR relay—while allowing all participants to operate without a live network connection. The system prioritises offline capture, queues records locally, and reconciles them with the backend when connectivity returns. Cryptographic verification happens in two stages: lightweight local checks on the student device, and full server-side HMAC verification once the lecturer’s session key is available.

Design goals:
- attendance capture must work without internet;
- QR/BLE/PIN tokens must be time-bound and session-bound;
- students must never receive the lecturer’s session key;
- relay must work without exposing the session key;
- duplicate marks must be impossible regardless of network state;
- reporting must unify online, offline, BLE, manual, and delegate session records.

---

## 2. System architecture

            ┌──────────────────────────────────────────────────────┐
            │                    Web (Next.js API)                  │
            │  ┌─────────────┐  ┌──────────────┐  ┌────────────┐  │
            │  │ offline/    │  │conducted-   │  │attendance  │  │
            │  │ submit      │  │sessions/sync│  │summary     │  │
            │  └──────┬──────┘  └──────┬──────┘  └─────┬──────┘  │
            │         │                │                │         │
            │  ┌──────▼────────────────▼────────────▼──────┐     │
            │  │              PostgreSQL / Prisma           │     │
            │  │  ConductedSession • OfflineAttendanceRecord│     │
            │  │  OnlineAttendanceSession • Delegation      │     │
            │  └────────────────────────────────────────────┘     │
            │  ┌─────────────┐  ┌──────────────┐  ┌────────────┐  │
            │  │ Vercel Blob │  │ Firebase     │  │ Admin web  │  │
            │  │ uploads     │  │ push/notify  │  │ dashboards │  │
            │  └─────────────┘  └──────────────┘  └────────────┘  │
            └──────────────────────────▲──────────────────────────┘
                                       │ HTTPS / JWT auth
          ┌────────────────────────────┴──────────────────────────┐
          │                   Mobile (React Native)                 │
          │  ┌──────────────┐  ┌───────────────┐  ┌─────────────┐ │
          │  │  Lecturer    │  │  Student      │  │  Services   │ │
          │  │  OfflineTaker│  │  OfflineMarker│  │  & utils    │ │
          │  └──────┬───────┘  └──────┬────────┘  └──────┬──────┘ │
          │         │                 │                   │        │
          │  ┌──────▼──────┐  ┌──────▼────────┐  ┌──────▼──────┐ │
          │  │ SQLite      │  │ SQLite        │  │ Keychain    │ │
          │  │ + memory    │  │ + memory     │  │ AsyncStorage│ │
          │  │ fallback    │  │ fallback     │  │ device key  │ │
          │  └─────────────┘  └──────────────┘  └─────────────┘ │
          │  ┌──────────────────────────────────────────────────┐ │
          │  │ Native bridge: BLE Advertiser + BLE Scanner      │ │
          │  │ Camera: ML Kit QR                              │ │
          │  └──────────────────────────────────────────────────┘ │
          └───────────────────────────────────────────────────────┘

---

## 3. Data flow overview

### 3.1 Attendance capture flows

QR / BLE / PIN capture (student):
  student camera/scanner -> parse payload -> local validation -> SQLite queue -> background sync -> server verifies HMAC -> marks attendance

Manual lecturer mark:
  lecturer UI -> SQLite queue (offline) OR direct POST /api/attendance/manual-mark/submit -> backend -> OfflineAttendanceRecord with manual_lecturer

Peer relay:
  student A scans lecturer QR/BLE/PIN -> save record -> generate relay QR/PIN/BLE -> student B scans relay -> locally validate -> save record -> background sync -> server verifies relay HMAC with device key

### 3.2 Session material flow

 Lecturer opens session
      |
      v
 generate sessionNonce (CSPRNG), sessionStart, unitId/roomId
      |
      v
 save to local SQLite + hardware Keychain
      |
      v
 POST /api/attendance/conducted-sessions/sync
      |
      v
 backend upserts ConductedSession (sessionKey, sessionNonce, bleUnitId, bleRoomId)
      |
      v
 students can submit against this session (online or offline queue)

### 3.3 Sync flow

 app foreground / connectivity restored / manual pull-to-refresh
      |
      v
 syncPendingAttendance()
      |
      +-> submitOfflineAttendance() for each unsynced record
      |       |
      |       v
      |   POST /api/attendance/offline/submit
      |       |  -> server finds ConductedSession by unit+room+time
      |       |  -> dedup by (studentId, unitCode, lectureRoom, sessionStart)
      |       |  -> if sessionKey exists, verifyRawPayload() immediately
      |       |     else status = pending
      |       |  -> returns attendanceId
      |       |
      |       v
      |   markAttendanceSynced(id)
      |
      +-> syncPendingManualMarks() for lecturer offline marks
      +-> sync proxy marks / session ends for GD delegations
      |
      v
 optional device key registration after first successful sync

---

## 4. Core components

### 4.1 Web API layer (`apps/web/app/api`)

| Route | Purpose |
|-------|---------|
| `attendance/offline/submit` | Ingest a student offline attendance record; verify if session key is available |
| `attendance/conducted-sessions/sync` | Register/update a conducted session and its sessionKey/nonce |
| `attendance/sessions/[id]/submit` | Online attendance for a session UUID |
| `attendance/manual-mark/submit` | Lecturer manual mark by admission number |
| `attendance/delegations/[id]/proxy-mark` | Group leader proxies mark for a member |
| `student/attendance/summary` | Per-unit attended/conducted counts + session detail |
| `admin/attendance-analytics` | Institution/department analytics with risk levels |

### 4.2 Mobile pages and utilities

| File | Role |
|------|------|
| `Lecturer/AttendanceTracker/OfflineTaker.js` | Generates rotating QR, BLE payload, and manual PIN; starts BLE advertising; handles manual roster marks; syncs conducted session |
| `student/AttendanceMarker/OfflineMarker.js` | Scans QR/BLE/PIN; validates locally; saves to SQLite; manages relay generation and peer nonce capture; background sync |
| `utils/sessionCrypto.js` | Core crypto: `encodePayload`, `computeToken`, `computePIN`, `computeRelayPin`, `encodeQR`, `encodeBLEBeacon`, `deriveCounter`, `deriveAbsoluteCounter`, `decodeQR`, `decodeBLEBeacon` |
| `utils/qrSigning.js` | Lecturer QR (`MWQR0x01:`) and relay QR (`MWQR_RELAY:`) encoding/decoding |
| `utils/manualAttendanceToken.js` | 6-digit manual PIN generation/validation using session key (lecturer) or absolute counter (student) |
| `utils/studentDeviceKey.js` | Per-device key generation and backend registration for relay signatures |
| `utils/offlineAttendanceApi.js` | `syncPendingAttendance`, `submitOfflineAttendance`, `syncConductedSession`, summary fetch helpers |
| `utils/manualMarkApi.js` | Roster caching, admission lookup, lecturer manual mark queue |
| `services/backgroundBLEService.js` | Background task rotating BLE advertising every 3 s |
| `storage/sqliteStorage.js` | Local persistence for queued records, rosters, session info, attendance summary cache |

---

## 5. Operational flows

### 5.1 Lecturer session start

1. Lecturer selects unit + room in `OfflineTaker`.
2. App generates:
   - `sessionStart` = current epoch ms rounded to seconds;
   - `sessionNonce` = CSPRNG `uint32`;
   - `sessionKey` = 32 random bytes -> 64-char hex;
   - `sessionCounter` increments per session.
3. Crypto material is stored:
   - `sessionNonceRef`, `sessionKeyRef` in-memory;
   - hardware Keychain entry keyed by `${unitCode}|${roomCode}|${sessionStart}`.
4. Local SQLite inserts a `ConductedSession` stub.
5. `syncConductedSession()` POSTs `{ unitCode, lectureRoom, sessionStart, sessionKey, sessionNonce }` to backend.
6. Backend upserts `ConductedSession`; if `sessionKey` is stored for the first time, triggers deferred verification on any pending `OfflineAttendanceRecord` rows.

### 5.2 QR rotation (lecturer)

- `generateQrData()` runs every `QR_ROTATION_MS` (3 s).
- Derives `counter = deriveCounter(sessionStart, QR_WINDOW_SECONDS, now)`.
- `encoded = encodePayload({ unitId, roomId, sessionStart, sessionDuration, sessionNonce })`.
- `token = HMAC-SHA256(encoded|counter, sessionKey)`.
- QR content = `Base64(encoded|counter|token)` prefixed `MWQR0x01:`.
- Countdown UI updates via `Date.now() % QR_ROTATION_MS`.

### 5.3 BLE advertising (lecturer)

- `startAdvertising()` builds the 10-byte beacon:
  - `[nonce16|counter16|unitId16|roomId16|lessonType8|0x01]`.
- Advertises via native `BLEAdvertiserModule`.
- Background task (`lecturerBackgroundTask`) re-advertises every 3 s to survive app backgrounding.

### 5.4 Manual PIN (lecturer)

- `generateManualAttendanceToken({ session, sessionKey })`:
  - `counter = deriveAbsoluteCounter(sessionStart, 30, now)`;
  - `token = HMAC-SHA256(encoded|counter, sessionKey)`;
  - `PIN = first 4 bytes of token as uint32 mod 1_000_000`, zero-padded to 6 digits.
- Countdown timer mirrors the absolute 30-second window using `Date.now() % MANUAL_TOKEN_ROTATION_MS`.

### 5.5 Student QR scan

1. Camera returns Base64 string.
2. `decodeQrPayload()` rejects legacy `MWQR1:`, accepts `MWQR0x01:` or raw Base64.
3. Structural parse: split right-to-right to recover `encodedPayload|counter|token`.
4. Local checks (`attendanceValidator.validateQRScan`):
   - cached session exists and is active (±15 s);
   - `sessionNonce`, `unitId`, `roomId` match cached session;
   - counter drift within `MAX_COUNTER_DRIFT` (3 windows of 3 s).
5. Save to SQLite as `OfflineAttendanceRecord` with `method = qr`, `verificationStatus = pending`.
6. Fire `syncPendingAttendance()` to push to backend.
7. Backend, if `sessionKey` exists, runs full HMAC verification and updates status.

### 5.6 Student BLE scan

1. Native BLE scanner emits `onDeviceFound` with advertisement bytes.
2. `parseBinaryPayload()` decodes the 10-byte beacon (version must be `0x01`).
3. Local checks (`validateBLEBeacon`):
   - nonce/unit/room match cached session;
   - session window active;
   - counter drift within `MAX_COUNTER_DRIFT`;
   - motion detected via accelerometer.
4. Save to SQLite with `method = ble`.
5. Sync path identical to QR.

### 5.7 Student manual PIN entry

1. Student types 6-digit PIN.
2. `validatePINEntry()` checks format, cached session active state.
3. Computes `pinCounter = deriveAbsoluteCounter(sessionStart, 30, now)`.
4. Stores `MANUAL:${normalizedPin}:${absolutePinCounter}` in `rawPayload`.
5. Backend reconstructs expected PIN using same absolute-epoch formula then `HMAC -> tokenToPin`.

### 5.8 Peer relay (student)

Trigger: a student who already marked attendance re-broadcasts so peers in poor signal can capture the lecturer’s token.

QR relay:
- after first mark, student generates `MWQR_RELAY:` QR:
  - content = `encodedPayload|counter|studentId|HMAC(deviceKey, content)`;
  - counter uses `deriveCounter(sessionStart, QR_WINDOW_SECONDS, now)`.

BLE relay:
- on BLE scan, selected devices advertise the original beacon payload;
- probabilistic selection scales by RSSI so strong-signal devices self-select;
- relay advertises for `QR_ROTATION_MS * 3` then stops, allowing re-election.

PIN relay:
- relay student generates a 6-digit PIN bound to their device key (`computeRelayPin(deviceKey, encodedPayload, pinCounter, studentId)`);
- peer enters the relay PIN in the manual entry field;
- local validator re-derives expected PIN and compares instantly;
- save path identical to manual entry, `method = manual`.

Manual-PIN-marked students capture a peer nonce from BLE scan before generating relay tokens. This closes a race where nonce arrives after the initial `scannedDataRef` is set.

### 5.9 Lecturer manual mark (`manual_lecturer`)

1. Lecturer opens roster modal, searches by admission number.
2. Roster is cached locally (SQLite, 24 h TTL).
3. `submitManualMark()`:
   - online -> POST `/api/attendance/manual-mark/submit`;
   - offline -> SQLite `pending_manual_marks` queue.
4. Backend creates an `OfflineAttendanceRecord` with:
   - `method = manual_lecturer`;
   - `markedByLecturerId`, `admissionNumber`;
   - auto-creates `ConductedSession` if missing.

### 5.10 Online attendance

1. Lecturer creates a nonce-UUID session via `/api/attendance/sessions`.
2. Student clicks link or scans online QR.
3. POST `/api/attendance/sessions/[id]/submit` with `deviceId`.
4. Backend checks expiry, enrollment, duplicates by student and by device, rate limits, creates `OnlineAttendanceRecord`, and also upserts into `OfflineAttendanceRecord` with `lectureRoom = 'ONLINE'` so unified summary queries can count both online and offline records together.

### 5.11 Reporting

- `GET /api/student/attendance/summary`:
  - CTE unions distinct `sessionStart`s attended vs conducted across offline, online, and enrolled units;
  - returns per-unit `attended`, `conducted`, and an optional per-session detail array.
- `GET /api/admin/attendance-analytics`:
  - institution/department scoped;
  - looks back 7–365 days;
  - supports risk-level categorisation.

---

## 6. Cryptographic model

### 6.1 Session-key derivation

| Artifact | Owner | Storage |
|----------|-------|---------|
| `sessionNonce` | lecturer device, generated once per session | backend `ConductedSession.sessionNonce`, local Keychain |
| `sessionKey` (64 hex chars) | lecturer device | backend `ConductedSession.sessionKey`, local Keychain |
| `deviceKey` (64 hex chars) | student device, generated once | device `AsyncStorage`, backend `StudentDevice` after first sync |

Session key flow:
1. Lecturer generates `sessionKey` locally.
2. POST `/api/attendance/conducted-sessions/sync` forwards the key.
3. Backend stores the key in `ConductedSession`.
4. Students **never** receive `sessionKey`.

### 6.2 Canonical payload

`mwv1|<unitId>|<roomId>|<sessionStart>|<sessionDuration>|<sessionNonce>`

All numeric fields are `uint32` (`>>> 0`).

### 6.3 QR / BLE / relay PIN counter semantics

| Method | Counter formula | Why |
|--------|----------------|-----|
| QR | `deriveCounter(sessionStart, 3, now)` | backend checks elapsed windows |
| BLE | same as QR | same rotation clock |
| Manual PIN (lecturer) | `deriveAbsoluteCounter(sessionStart, 30, now)` | backend expects absolute epoch-based counter |
| Manual PIN (student relay) | `deriveAbsoluteCounter(sessionStart, 30, now)` | matches backend manual verification |
| Relay QR | `deriveCounter(sessionStart, 3, now)` | same as lecturer QR |

Note: `deriveAbsoluteCounter(a, b, t) = floor(t/1000 / b) - floor(a / b)`.  
      `deriveCounter(a, b, t) = floor((t/1000 - a) / b)`.

These two diverge whenever `a` is not a multiple of `b`, which is why manual PIN uses the absolute form.

### 6.4 PIN derivation

1. `encodedPayload|counter` -> HMAC-SHA256 with key -> 64-char hex token.
2. `tokenToPin(token)` = `parseInt(token[0:8], 16) >>> 0` mod `1_000_000`, padded to 6 digits.

### 6.5 Relay signature

`signature = HMAC-SHA256(encodedPayload|counter|studentId, deviceKey)`

Backend verifies with the stored `StudentDevice.deviceKey`.

### 6.6 Security properties

- tokens are time-windowed;
- tokens are session-bound via `sessionNonce`;
- replay is resisted by counter drift checks and monotonicity;
- foreign scanners see only opaque Base64;
- relay signatures prove device authenticity without the session key;
- device key registration is deferred until after first successful attendance, avoiding a bootstrapping dependency.

---

## 7. Offline-first design

### 7.1 Local persistence

SQLite (via `react-native-sqlite-storage`) is the source of truth when the network is unavailable. Tables include:
- queued `attendance_records`;
- queued `pending_manual_marks`;
- queued `proxy_marks`;
- queued `session_ends`;
- cached `unit_roster` (24 h TTL);
- cached `attendance_summary` and `conducted_counts`;
- in-memory memory fallback when SQLite throws.

### 7.2 Offline triggers for sync

- `useFocusEffect` on dashboards;
- internet restoration listener;
- explicit manual pull-to-refresh;
- lecturer session creation (`syncConductedSession` fire-and-forget).

### 7.3 Idempotency and dedup

Primary uniqueness constraint on `OfflineAttendanceRecord`:
`(studentId, unitCode, lectureRoom, sessionStart)`

Unique constraints used everywhere:
- `OnlineAttendanceRecord`: `(sessionId, studentId)` and `(sessionId, deviceId)`;
- `OnlineAttendanceSession` attendance: uid-based session id prevents guessing.

Duplicate submissions return HTTP 409 and are treated as success by the mobile layer.

### 7.4 Memory fallback

When SQLite throws (e.g., corruption, platform quirk), the app:
- catches the error;
- switches to a module-level in-memory store;
- persists a `MEMORY_FALLBACK` flag;
- on next successful SQLite write, restores the database path.

---

## 8. BLE relay system

### 8.1 Beacon format

`10 bytes`:
- `[0..1]` `sessionNonce & 0xFFFF` big-endian;
- `[2..3]` `counter & 0xFFFF` big-endian;
- `[4..5]` `unitId & 0xFFFF`;
- `[6..7]` `roomId & 0xFFFF`;
- `[8]`   `lessonTypeId`;
- `[9]`   `0x01` (MarkWise v1 beacon marker).

Version byte `0x01` filters out all non-MarkWise packets automatically.

### 8.2 Probabilistic relay selection

When a student already marked attendance is scanning for peers, every device-found event triggers an election:
```
rssiNorm = clamp((rssi - MIN) / (MAX - MIN), 0, 1);
electionP = rssiNorm * (RELAY_TARGET_COUNT / 500);
if (random() < electionP) startRelay()
```
- stronger RSSI devices self-select;
- relay advertises the freshest payload for `3 * QR_ROTATION_MS` then stops;
- next scan event can re-elect a different relay, reducing collision probability;
- no UI/state update required;
- Android-only because iOS restricts foreground BLE advertising.

### 8.3 Relay verification (backend)

Backend `verifyRawPayload()` has a `verifyRelayQr()` branch:
- expects `MWQR_RELAY:` prefix;
- parses `payload|counter|studentId|signature`;
- signature verification uses `StudentDevice.deviceKey`;
- counter drift tolerates ±5 QR windows (15 s).

---

## 9. QR code system

### 9.1 Current format (`MWQR0x01:`)

`Base64( mwv1|<unitId>|<roomId>|<sessionStart>|<duration>|<nonce> | <counter> | <64-char HMAC> )`

### 9.2 Legacy rejection

Any string starting with `MWQR1:` is silently rejected by `decodeQrPayload()`. The old XOR obfuscation used a hardcoded 16-byte key embedded in the APK; that scheme is insecure and no longer accepted.

### 9.3 Rotation

- QR rotates every 3 s using a `setTimeout` aligned to `Date.now()`.
- Rotation is based on `sessionStart`, not wall-clock drift, to ensure cross-device counter alignment.

### 9.4 Foreign scanner behaviour

A generic QR scanner reads only a meaningless alphanumeric Base64 string. Even if the scanner re-encodes the QR, the HMAC, `sessionNonce`, and counter mean nothing without the session key.

---

## 10. Manual PIN system

### 10.1 Lecturer display

- 6-digit PIN;
- counter is absolute epoch windows: `floor(now / 30000) - floor(sessionStart / 30000)`;
- derived from HMAC over `encoded|counter` using `sessionKey`;
- shown with a 30-second expiry countdown.

### 10.2 Student entry

- `validatePINEntry()` ensures PIN is 6 digits, session is active, and computes the absolute `pinCounter`.
- `persistAttendance()` stores `MANUAL:${pin}:${absolutePinCounter}` in `rawPayload`.
- Backend reconstructs expected PIN with the same absolute counter formula and compares.

### 10.3 Clock-skew tolerance

Student-side expiry allows ±15 s. Server-side counter comparison accepts the exact window plus ±1 adjacent window (60 s total window).

---

## 11. Manual lecturer mark

### 11.1 Roster precache

- When the lecturer selects a unit online, `fetchAndCacheUnitRoster()` writes up to thousands of student rows into SQLite.
- Cache TTL = 24 h.

### 11.2 Offline queue

If the mark happens offline:
- `submitManualMark()` writes to SQLite `pending_manual_marks`.
- `syncPendingManualMarks()` drains the queue and re-syncs the `ConductedSession` key from Keychain when possible.

### 11.3 Backend

`POST /api/attendance/manual-mark/submit`:
- creates/upserts `ConductedSession` if missing;
- creates `OfflineAttendanceRecord` with `method = manual_lecturer`, `markedByLecturerId`, `admissionNumber`;
- duplicate guard per `(studentId, unitCode, lectureRoom, sessionStart)`.

---

## 12. Online attendance

`POST /api/attendance/sessions/[id]/submit`:
- checks session expiry;
- enrollment check;
- duplicate check by student and by device;
- rate limit: 3 attempts per (device, session) in 10 minutes;
- creates `OnlineAttendanceRecord`;
- upserts into `OfflineAttendanceRecord` with `lectureRoom = 'ONLINE'` so unified reporting counts them alongside offline records.

---

## 13. Sync mechanisms

### 13.1 Mutex and batching

`syncPendingAttendance` uses a module-level `_isSyncing` flag. If a sync is already running, subsequent calls set `_syncQueued` and trigger a single rerun when the in-flight sync finishes.

### 13.2 Parallelism

Records are submitted in `Promise.allSettled(...)` so one slow/failed record does not block others.

### 13.3 Retry policy

- failed records have their `sync_attempts` incremented;
- the queue is drained on every sync trigger;
- there is no exponential back-off or dead-letter queue—records are retried indefinitely.

### 13.4 Device key registration

After the first successful attendance sync, the app registers the device key with the backend via `/api/student/register-device`. The backend stores it in `StudentDevice(studentId, deviceKey)` so it can verify relay signatures later.

---

## 14. Edge cases and failure modes

| Edge case | Handling |
|-----------|----------|
| lecturer starts session fully offline | `sessionKey` stored as `null` in backend; attendance records are created with `verificationStatus = pending`; deferred verification runs automatically when the key later arrives |
| student scans during session transition | local `MAX_COUNTER_DRIFT` tolerance (3 windows = 9 s) accepts adjacent counters; server checks `scannedAt - sessionStart` within 2 h |
| clock skew | ±15 s local expiry; server accepts ±1 manual window and ±5 QR/BLE windows |
| duplicate scan | `OfflineAttendanceRecord` unique index rejects duplicates; API returns 409; mobile layer treats 409 as success |
| SQLite corruption | catches error, falls back to in-memory store, flags `MEMORY_FALLBACK` |
| relay collision | probabilistic election with RSSI weighting + 3×QR-window timeout + re-election on next scan |
| relay nonce race | post-mark scanner keeps scanning until both `scannedData` and `receivedSessionNonce` are populated; enables PIN-marked students to still generate relay tokens |
| legacy QR codes | hard-rejected at `decodeQrPayload()` before any parsing |
| session key never synced | backend stays in `pending` state; no HMAC verification possible; records remain auditable but never reach `verified` |
| manual mark offline for unknown student | throws; lecturer sees `No internet connection and offline roster unavailable` |
| online attendance forwarded without unitCode | server resolves unit from `OnlineAttendanceSession.unitCode` and inserts `OFFlineAttendanceRecord` with `lectureRoom = 'ONLINE'` |
| iOS BLE relay limitation | relay advertising is Android-only gated behind `Platform.OS === 'android'` |

---

## 15. System dependencies

### 15.1 Mobile

| Dependency | Purpose |
|------------|---------|
| `react-native-ble-plx` | BLE scan manager |
| `react-native-sqlite-storage` | local persistence |
| `react-native-sensors` | accelerometer for motion presence |
| `crypto-js` | HMAC-SHA256, Base64 helpers |
| `@react-native-documents/picker` | file selection for assignments |
| `react-native-blob-util` | multipart upload / file download |
| `base64-js` | safe Base64 encode/decode |
| `react-native-linear-gradient` | UI styling |

### 15.2 Web

| Dependency | Purpose |
|------------|---------|
| `next` | API routes, server components |
| `@prisma/client` | ORM |
| `jsonwebtoken` / `@types/jsonwebtoken` | JWT auth |
| `@vercel/blob` | presigned direct uploads |
| `pdfkit` | PDF report generation |
| `xlsx` | Excel export |
| `nodemailer` | email notifications (report delivery) |
| `firebase-admin` | FCM push notifications |
| `pg` / `@prisma/adapter-pg` | database driver |

### 15.3 Infrastructure

| Service | Role |
|----------|------|
| PostgreSQL | primary data store |
| Vercel Blob | file/attachment storage |
| Firebase Cloud Messaging | push notifications for new reports/materials |
| Native BLE advertiser/scanner | lecturer broadcast + student scan |
| ML Kit Camera | QR capture |

---

## 16. Data model summary

```
Student
  └── Enrollment -> Unit
  └── OfflineAttendanceRecord (method: qr | ble | manual | manual_lecturer)
  └── OnlineAttendanceRecord -> OnlineAttendanceSession
  └── StudentDevice (deviceKey for relay)
  └── GroupMember -> Group -> Delegation -> OfflineAttendanceRecord

Lecturer
  └── ConductedSession (sessionKey, sessionNonce, bleUnitId, bleRoomId)
  └── OnlineAttendanceSession
  └── Timetable / SharedSession

Attendance aggregation
  OfflineAttendanceRecord.conductedSessionId -> ConductedSession
  OfflineAttendanceRecord.delegationId    -> Delegation (group sessions)
```

Key constraints:
- `OfflineAttendanceRecord` unique key: `(studentId, unitCode, lectureRoom, sessionStart)`;
- `ConductedSession` unique key: `(unitCode, lectureRoom, sessionStart)`;
- `OnlineAttendanceRecord` unique keys: `(sessionId, studentId)` and `(sessionId, deviceId)`.

---

## 17. Implementation notes

### 17.1 Why two `deriveCounter` variants

QR and BLE are verified by the backend against an elapsed-time counter:
`expected = floor((scannedAtSec - sessionStart) / window)`

Manual PIN is verified against an absolute-epoch counter:
`expected = floor(scannedAtSec / window) - floor(sessionStart / window)`

These differ whenever `sessionStart` is not a multiple of the window. Previous code used only the elapsed-time variant, causing PIN rotation to drift by ±1 between lecturer and server as soon as the session start second was not window-aligned.

### 17.2 Memory fallback

Both `syncPendingAttendance` and `getUnsyncedAttendanceRecords` support reading from a memory store when SQLite is unavailable. Records always carry both `snake_case` and `camelCase` field aliases so they can be normalised after SQLite is restored.

### 17.3 Deferred verification

The backend only runs full HMAC verification when `sessionKey` is present in `ConductedSession`. If the lecturer was offline when the session was created, `sessionKey` is initially `null`. All `OfflineAttendanceRecord`s are stored with `verificationStatus = pending`. Once the key later arrives via `conducted-sessions/sync`, `runDeferredVerification()` re-processes every pending record for that session.

### 17.4 Relay collision control

Without explicit collision avoidance, multiple nearby peers would all advertise on the same BLE channel, overlapping counters and confusing receivers. The current heuristic uses:
- RSSI-normalised election probability;
- randomised jitter (`RELAY_STAGER_MS`) before advertising;
- bounded relay lifetime (`3 * QR_ROTATION_MS`);
- re-election on every new scan event with a fresher beacon.

This is a practical probabilistic relay selection mechanism, not a TDMA schedule. It is sufficient for typical classroom densities (20–60 devices) with one or two peers re-broadcasting.

### 17.5 Absolute PIN counter back-compat

The server-side `verifyPin()` implementation rejects only `manually_entered` counters that are out of the accepted window. The client-side absolute counter is stored in the `rawPayload` string; the server parses `relativerCounter = absoluteCounter - floor(sessionStart / 30)` and checks `relativeCounter`, `relativeCounter - 1`, and `relativeCounter + 1`.

### 17.6 Reporting consistency

`lectureRoom = 'ONLINE'` is excluded from offline conducted counts and offline attendance counts in the summary CTEs. Online sessions are counted in separate `online_conducted` / `online_attended` CTEs. The final attendance percentage is therefore `(offline_attended + online_attended) / (offline_conducted + online_conducted)`.

### 17.7 Key rotation and cleanup

- `TokenBlocklist` TTL is the original JWT expiry; a scheduled job can prune expired rows.
- `StudentDevice` rows are append-only; a future migration could expire unused device keys.
- `BLESyncLog` tracks mapping sync outcomes for facilities staff.

---

## Further reading

- `docs/STUDENT_RELAY_SOLUTION.md`
- `docs/TWO_TIER_RELAY_IMPLEMENTATION.md`
- `docs/CHECK_1_ATTENDANCE_RELAY_VALIDATION.md`
- `apps/web/lib/attendanceCrypto.ts`
- `apps/mobile/src/utils/sessionCrypto.js`
- `apps/web/app/api/attendance/offline/submit/route.ts`
- `apps/web/app/api/attendance/conducted-sessions/sync/route.ts`
