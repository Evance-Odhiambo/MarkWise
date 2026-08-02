# Online Attendance — Implementation Deep Dive

> **Purpose:** This document is the single source of truth for understanding, modifying, and troubleshooting the online attendance subsystem. It focuses on concrete file paths, data structures, code entry points, and step-by-step operational behavior.
> **Audience:** mobile engineers, backend engineers, QA, security reviewers
> **See also:** `ONLINE_ATTENDANCE_ARCHITECTURE.md`

---

## Table of contents

1. [Scope and goals](#1-scope-and-goals)
2. [Terminology](#2-terminology)
3. [Backend endpoint map](#3-backend-endpoint-map)
4. [Student online capture — step by step](#4-student-online-capture--step-by-step)
5. [Lecturer online session — step by step](#5-lecturer-online-session--step-by-step)
6. [Deep link redirect (`/attend`)](#6-deep-link-redirect-attend)
7. [Background retry queue](#7-background-retry-queue)
8. [Crypto / security model](#8-crypto--security-model)
9. [Device identity model](#9-device-identity-model)
10. [Deduplication strategy](#10-deduplication-strategy)
11. [Rate limiting](#11-rate-limiting)
12. [Testing checklist](#12-testing-checklist)
13. [Common pitfalls](#13-common-pitfalls)

---

## 1. Scope and goals

Online attendance must satisfy:
- Lecturer can create a session and share a link that opens MarkWise directly
- Student identity is verified via JWT, not via any self-reported field
- A student cannot mark attendance for a unit they are not enrolled in
- A device cannot be reused to mark multiple students in the same session
- Transient network failures do not silently lose attendance
- The UX returns the student to their meeting app immediately after marking

Non-goals:
- Online sessions do not use cryptographic tokens, QR codes, BLE, or PINs
- Online sessions do not stream location or use GPS
- Attendance detection is explicit; the student taps a link, the app auto-submits

---

## 2. Terminology

| Term | Meaning |
|------|---------|
| `OnlineAttendanceSession` | Server-side session row; short-lived (default 10 minutes) |
| `OnlineAttendanceRecord` | Per-student per-session mark; unique by `(sessionId, studentId)` |
| `sessionId` | UUIDv4 identifying an online session; passed in the share link |
| `deviceId` | Stable app-scoped identifier used to prevent device-sharing |
| `lectureRoom: "ONLINE"` | Convention used in `OfflineAttendanceRecord` for online captures |
| `drainQueue` | Client-side retry of previously failed submissions |
| `syncConductedSession` | Fire-and-forget create of `ConductedSession` row for analytics |

---

## 3. Backend endpoint map

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST` | `/api/attendance/sessions` | Lecturer/Admin | Create online session |
| `GET` | `/api/attendance/sessions/:id` | Student | Session info (status, unit, lecturer, expiresAt) |
| `POST` | `/api/attendance/sessions/:id/submit` | Student | Submit attendance (primary path) |
| `POST` | `/api/attendance/sessions/:id/end` | Lecturer/Admin | End session |
| `GET` | `/api/attendance/sessions/:id/attendees` | Lecturer/Admin | List attendees (polled) |
| `POST` | `/api/attendance/sessions/:id/mark` | **Public** | Legacy fallback — admission number only |
| `GET` | `/attend?session=<id>` | None | HTML redirect page with deep links |

### 3.1 Create session — `POST /api/attendance/sessions`
**File:** `apps/web/app/api/attendance/sessions/route.ts`

| Step | Lines | Logic |
|------|-------|-------|
| Auth | 42–45 | `resolveAdminOrLecturerScope(req)` — accepts lecturer JWT or admin cookie |
| Body | 47–52 | `{ lecturerId?, unitCode, durationMs, type? }` — `durationMs` must be a positive number |
| Identity | 64–68 | `lecturerId` is taken from JWT `scope.userId`; if body `lecturerId` differs and caller is a lecturer, returns 403 |
| Normalize | 70 | `normalizeUnitCode(unitCode)` |
| DB write | 73–75 | `prisma.onlineAttendanceSession.create({ lecturerId, unitCode, type, expiresAt: now + durationMs })` |
| Response | 77–82 | `{ sessionId, shareableLink }` with `shareableLink = {baseUrl}/attend?session={session.id}` |

### 3.2 Student session info — `GET /api/attendance/sessions/:id`
**File:** `apps/web/app/api/attendance/sessions/[id]/route.ts`

| Step | Lines | Logic |
|------|-------|-------|
| Auth | 23–32 | `verifyStudentAccessToken()` from `Authorization: Bearer <token>` |
| DB lookup | 36–47 | `findUnique({ id })` selecting id, lecturerId, unitCode, status, expiresAt, endedAt, createdAt |
| Effective status | 54–60 | If DB status is `active` but `expiresAt <= now`, overrides to `expired` |
| Enrichment | 63–73 | Parallel: `Unit.findFirst` for unitName; `Lecturer.findUnique` for fullName |
| Response | 75–86 | `{ sessionId, unitCode, unitName, lecturerName, status, expiresAt, sessionStart }` |

### 3.3 Submit attendance — `POST /api/attendance/sessions/:id/submit`
**File:** `apps/web/app/api/attendance/sessions/[id]/submit/route.ts`

| Step | Lines | Logic |
|------|-------|-------|
| Rate limiters | 13–14 | `submitLimiter`: 3 attempts per `(deviceId, sessionId)` per 10 minutes; `studentLimiter`: 5 attempts per `studentId` per 1 minute |
| CORS | 6–10 | Wildcard CORS: `POST, OPTIONS` |
| Auth | 28–39 | Extracts `Authorization: Bearer`, verifies via `verifyStudentAccessToken()`; on failure returns 401 with `{ message: "Unauthorized" }` or `{ message: "Invalid or expired token" }` |
| Body | 42–52 | Parses JSON `{ deviceId: string }`; trims, rejects empty |
| Sweep expired | 58–61 | `updateMany({ status: "active", expiresAt: { lte: now } }, { status: "expired" })` |
| Session check | 63–70 | `findUnique({ id })`; rejects null, non-active, or expired → **410 Gone** |
| Student rate limit | 73–79 | `studentLimiter("student:${studentId}")` → 429 |
| Enrollment | 84–104 | Resolves `Unit` by normalized code; checks `Enrollment.findFirst({ studentId, unitId })` → 403 if missing |
| Duplicate student | 107–113 | `findUnique({ sessionId_studentId })` → 409 if exists |
| Duplicate device | 116–125 | `findUnique({ sessionId_deviceId })` → 409 if device already used |
| Device rate limit | 128–134 | `submitLimiter("${deviceId}:${sessionId}")` → 429 |
| Write OnlineAttendanceRecord | 137–146 | `create({ sessionId, studentId, admissionNumber: toUpperCase(), unitCode: session.unitCode, deviceId })` |
| Write OfflineAttendanceRecord | 150–169 | `upsert({ where: { studentId_unitCode_lectureRoom_sessionStart: { studentId, unitCode: normalized, lectureRoom: "ONLINE", sessionStart: session.createdAt } }, create: { studentId, unitCode, lectureRoom: "ONLINE", sessionStart, scannedAt: now, method: "online" } })` — idempotent so re-submit does not create duplicates |
| Response | 171–174 | `{ message, attendanceId }` status 200 |

### 3.4 End session — `POST /api/attendance/sessions/:id/end`
**File:** `apps/web/app/api/attendance/sessions/[id]/end/route.ts`

| Step | Lines | Logic |
|------|-------|-------|
| Auth | 10–13 | `resolveAdminOrLecturerScope` |
| Ownership | 27–29 | Lecturer must own session; admin bypasses |
| Already ended | 31–33 | If already `ended` or `expired`, returns 200 |
| DB update | 35–38 | `update({ status: "ended", endedAt: now })` |
| Response | 40 | `{ message: "Session ended" }` |

### 3.5 Attendees poll — `GET /api/attendance/sessions/:id/attendees`
**File:** `apps/web/app/api/attendance/sessions/[id]/attendees/route.ts`

| Step | Lines | Logic |
|------|-------|-------|
| Auth | 10–13 | `resolveAdminOrLecturerScope` |
| Ownership | 27–29 | Lecturer owns session; admin bypasses |
| Query | 31–35 | `findMany({ where: { sessionId }, select: { studentId, admissionNumber, markedAt }, orderBy: { markedAt: "asc" } })` |
| Enrichment | 38–43 | Batch loads `Student` records to resolve names |
| Response | 45–51 | Array of `{ studentName, admissionNumber, submittedAt }` |

### 3.6 Legacy public mark — `POST /api/attendance/sessions/:id/mark`
**File:** `apps/web/app/api/attendance/sessions/[id]/mark/route.ts`

This endpoint is **not** the primary online attendance path. It is a legacy fallback.

| Step | Lines | Logic |
|------|-------|-------|
| Rate limits | 11–12 | IP: 10/5 min; session: 20/10 min |
| Auth | — | **None** |
| Body | 37–47 | `{ admissionNumber }` |
| Session check | 49–61 | Sweeps expired, looks up active session |
| Student lookup | 63–70 | `findFirst({ admissionNumber: mode: "insensitive" })` |
| Write | 72–91 | `create({ sessionId, studentId, admissionNumber: toUpperCase(), unitCode: "" })` — no enrollment check, no device binding |
| Errors | 60–91 | All failures return **400** (uniform) to prevent session/student enumeration |

**Known limitations of this endpoint:**
- No enrollment verification — any enrolled or non-enrolled student in the system can mark
- No device binding
- `unitCode` is written as empty string — analytics join requires extra guard
- Rate limits are IP+session based, not student-scoped

---

## 4. Student online capture — step by step

Entry point: `apps/mobile/src/screens/student/AttendanceMarker/OnlineMarker.js`

### 4.1 Mount and session resolution

| Step | Lines | Logic |
|------|-------|-------|
| Route param | 37 | `sessionId` from `route.params?.session ?? route.params?.sessionId` |
| Phase init | 40 | Phase: `loading` → `submitting` → `success`, `duplicate`, `expired`, `error` |
| Mount cleanup | 55–60 | `isMounted` ref + `dismissTimer` cleared on unmount |

### 4.2 `run()` — load session info and attempt submit

| Step | Lines | Logic |
|------|-------|-------|
| Parallel load | 110–113 | `Promise.all([ getStudentSession(), fetchOnlineSessionInfo(sessionId) ])` |
| Sign-in gate | 116–120 | If no JWT token → error phase |
| Expired gate | 126–131 | If `info.status` is `ended` or `expired` → expired phase |
| Transition | 132 | Enters `submitting` phase |
| Submit | 134 | `await submitOnlineAttendance(sessionId)` |
| Transient failure | 156–165 | Matches `/already|duplicate|submitted/i` → duplicate phase; `/closed|expired|ended|410/i` → expired phase; otherwise queues via `queueOnlineSubmission` and shows error |

### 4.3 `submitOnlineAttendance()` detail
**File:** `apps/mobile/src/utils/onlineAttendanceApi.js`

| Step | Lines | Logic |
|------|-------|-------|
| Resolve deviceId | 13–22 | `resolveDeviceId()`: tries `sqliteStorage.getOrCreateAttendanceDeviceId()` first; falls back to `DeviceInfo.getUniqueId()`; final fallback `'unknown'` |
| Load session | 42–45 | `Promise.all([ getStudentSession(), resolveDeviceId() ])` |
| POST | 51–78 | `POST ${SESS_BASE}/${sessionId}/submit` with `Authorization: Bearer <token>` and body `{ deviceId }` |
| Error handling | 64–66 | Throws with `data.message` or status text |

### 4.4 Local SQLite record on success

| Step | Lines | Logic |
|------|-------|-------|
| Get device | 138 | `await sqliteStorage.getOrCreateAttendanceDeviceId()` |
| Write | 139–150 | `addAttendanceRecord({ unitCode, lectureRoom: 'ONLINE', sessionStart: Date.now(), scannedAt: Date.now(), rawPayload: JSON.stringify({ type: 'online', sessionId }), deviceId, synced: 1 })` |
| Non-critical | 148 | Local save failure does not affect success flow (swallowed) |

### 4.5 Queue drain on success and reconnect

| Step | Lines | Logic |
|------|-------|-------|
| Drain on submit success | 152 | `drainQueue()` — retries previously failed submissions |
| Reconnect hook | 195 | `useSyncOnReconnect(drainQueue)` — NetInfo offline-to-online transition |
| AppState active | 196–202 | `AppState` listener drains queue 500 ms after foregrounding |
| Mount drain | 205 | `useEffect(() => { drainQueue(); }, [drainQueue])` recovers failed submissions from last session |

---

## 5. Lecturer online session — step by step

Entry point: `apps/mobile/src/screens/lecturer/AttendanceTracker/OnlineTaker.js`

### 5.1 Setup phase (pre-session)

| Step | Lines | Logic |
|------|-------|-------|
| Unit loading | 168–186 | `fetchMyLecturerTimetable(session.token)` → `mapAssignedUnits()` deduplicates by uppercased code/name |
| Manual fallback | 550–566 | If timetable fetch fails, `TextInput` allows manual unit code entry |

### 5.2 `handleStartSession()` — create

| Step | Lines | Logic |
|------|-------|-------|
| Validate | 250–254 | `setupUnitCode.trim().toUpperCase()` non-empty |
| Auth | 258 | `getLecturerSession()` → JWT token, lecturerId |
| POST session | 297–309 | `POST ${SESS_BASE}` with `{ lecturerId, unitCode, durationMs: SESSION_DURATION_MS, type: 'online' }` |
| Response | 314–323 | Extracts `sessionId`, builds `shareableLink` from response or fallback |
| State | 327–336 | Sets `sessionId`, `sessionUnitCode`, `shareableLink`, starts `fetchAttendees` polling, starts countdown |
| Analytics mirror | 340–347 | `syncConductedSession({ unitCode: code, lectureRoom: 'ONLINE', sessionStart: sessionCreatedAt, createdAt: sessionCreatedAt })` — **no `sessionKey` or `sessionNonce`** |

### 5.3 Polling attendees

| Step | Lines | Logic |
|------|-------|-------|
| `startPolling` | 215–219 | Clears any previous interval, fires initial `fetchAttendees(sid)`; **timer is now restarted by `fetchAttendees` itself** after each outcome |
| `fetchAttendees` | 196–248 | Calls lecturer attendees endpoint with auth header |
| Success (200) | 218–228 | Sets `attendees` state; resets `pollFailureCount` to 0 and `currentPollInterval` to base 5 s; restarts timer with base interval |
| 404 response | 219–222 | Session not yet visible — resets failure count; keeps base interval |
| Network/protocol error | 235–247 | Increments failure count; sets `currentPollInterval = min(base + failures * 5s, 30s)`; restarts timer |
| Backoff reset | 211–214 | After 60 s without failures, resets `pollFailureCount` back to 0 |

**Constants:**
- `POLL_INTERVAL_MS = 5000`
- `POLL_BACKOFF_STEP_MS = 5000`
- `POLL_BACKOFF_MAX_MS = 30000`
- `POLL_SUCCESS_RESET_AFTER_MS = 60000`

### 5.4 Countdown timer

| Step | Lines | Logic |
|------|-------|-------|
| Start | 270–273 | `sessionEndTime = Date.now() + SESSION_DURATION_MS` (10 minutes) |
| Tick | 274–282 | 500 ms interval; counts down `timeRemaining` |
| Expiry | 280–289 | Clears timers, sets `sessionActive = false`, alerts "Session Expired" |

### 5.5 End session

| Step | Lines | Logic |
|------|-------|-------|
| Confirmation | 370–412 | Alert dialog → `POST ${SESS_BASE}/${sessionId}/end` with JWT; `.catch(() => {})` so network failure does not block UI |
| Cleanup | 395–407 | Clears intervals, resets all state |

---

## 6. Deep link redirect (`/attend`)

**File:** `apps/web/app/attend/route.ts`

| Step | Lines | Logic |
|------|-------|-------|
| Input sanitization | 11–16 | Rejects outside `^[a-zA-Z0-9_-]+$` |
| Session lookup | 22–26 | `findUnique({ id })` selecting only `unitCode`; falls back to `session.substring(0, 8)` for display |
| HTML response | 28–493 | Returns a styled popup page |
| Android deep link | 460–463 | `intent://attend?session=<id>#Intent;scheme=markwise;package=com.markwise;...end` |
| iOS deep link | 465–466 | `markwise://attend?session=<id>` |
| Cache headers | 498–503 | `no-store, max-age=0, no-cache, Pragma: no-cache` |
| Referrer policy | Added during security hardening | `Referrer-Policy: no-referrer` to prevent URL leakage via `document.referrer` |

The redirect page performs **no auth check**; security is enforced at `/attend?session=...` submit endpoints because the UUID is unguessable and a student still needs a valid enrolled JWT.

---

## 7. Background retry queue

### 7.1 SQLite queue schema
**File:** `apps/mobile/src/storage/sqliteStorage.js`

```sql
CREATE TABLE IF NOT EXISTS pending_online_submissions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT    NOT NULL,
  created_at  INTEGER NOT NULL,
  synced      INTEGER NOT NULL DEFAULT 0,
  sync_attempts INTEGER NOT NULL DEFAULT 0,
  last_error  TEXT
);
```

### 7.2 Queue operations
**File:** `apps/mobile/src/storage/sqliteStorage.js`

| Operation | Lines | Behavior |
|-----------|-------|----------|
| `addPendingOnlineSubmission({ sessionId, error })` | Added in retry upgrade | INSERT with `synced=0, sync_attempts=0` |
| `getUnsyncedOnlineSubmissions()` | Added in retry upgrade | SELECT WHERE `synced=0 AND sync_attempts < 5 ORDER BY created_at ASC LIMIT 20` |
| `markOnlineSubmissionSynced(id)` | Added in retry upgrade | UPDATE `synced=1` |
| `incrementOnlineSubmissionSyncAttempts(id, error)` | Added in retry upgrade | UPDATE `sync_attempts = sync_attempts + 1, last_error = ?` |
| `clearSyncedOnlineSubmissions()` | Added in retry upgrade | DELETE `WHERE synced=1` |

### 7.3 Drain logic
**File:** `apps/mobile/src/utils/onlineAttendanceApi.js`

| Function | Lines | Behavior |
|----------|-------|----------|
| `syncPendingOnlineSubmissions()` | 95–119 | Loads up to 20 pending; for each, calls `submitOnlineAttendance(session_id)`; on success, marks synced; on failure, increments attempt count and stores error; clears synced rows at the end |
| `queueOnlineSubmission(sessionId, error)` | 85–89 | Thin wrapper over `sqliteStorage.addPendingOnlineSubmission` |
| `drainQueue()` (OnlineMarker) | 182–191 | Calls `syncPendingOnlineSubmissions`; clears submit error if any record synced |

### 7.4 Retry triggers

| Trigger | Hook/Locator | Logic |
|---------|--------------|-------|
| App returns to foreground | `AppState.addEventListener('change', ...)` OnlineMarker line 196–202 | After 500 ms, calls `drainQueue()` |
| Connectivity restored | `useSyncOnReconnect(drainQueue)` hook | Debounced 1.5 s by NetInfo listener |
| Component mount | `useEffect(() => { drainQueue(); }, [drainQueue])` | Catches any previous failures |

---

## 8. Crypto / security model

### 8.1 What the online path does NOT use

| Feature | Offline path | Online path |
|---------|-------------|-------------|
| `sessionKey` (64-char hex) | Generated via `crypto.getRandomValues()` on lecturer device; synced to backend | **Not created** |
| `sessionNonce` (uint32) | CSPRNG per session; embedded in QR/BLE/PIN payload | **Not used** |
| HMAC-SHA256 tokens | QR and relay QR are HMAC-signed | **Not used** |
| BLE beacons | 10-byte v0x01 advertisement with nonce+counter+roomId | **Not used** |
| Manual PIN | 6-digit from `first-4-bytes(HMAC) mod 1,000,000` | **Not used** |
| `rawPayload` | Entire payloads like `MWQR0x01:...` or `MWBLE:v1:...` | **Not used** |
| `motionVerified` / motion scoring | Accelerometer threshold + risk scoring | **Not used** |
| `attendanceCrypto.ts` | Verification engine for all offline payloads | **Not imported** |
| `sessionCrypto.js` | Token generation/parsing for offline flow | **Not imported** |

### 8.2 What the online path DOES use

| Layer | Mechanism | Location |
|--------|-----------|----------|
| Lecturer identity | `resolveAdminOrLecturerScope(req)` JWT or admin cookie | backend sessions routes |
| Student identity | `verifyStudentAccessToken()` on `Authorization: Bearer <token>` | `studentAuthJwt.ts` |
| Enrollment | `prisma.enrollment.findFirst({ studentId, unitId })` | `submit/route.ts:84-104` |
| Device binding | `deviceId` unique per session; `@@unique(sessionId, deviceId)` | `OnlineAttendanceRecord` + submit route |
| Rate limiting | In-memory sliding window per key | `lib/rateLimit.ts` |
| Session expiry | `expiresAt` sweep + active status check | `submit/route.ts:58-70` |

### 8.3 Why there is no sessionKey in online flow

In the offline path, the lecturer device is presumed untrusted relative to the backend, so students must verify the lecturer's token via HMAC. In the online path:
- The **backend itself** creates the session record
- The **backend itself** issues the link
- The **backend itself** validates the student JWT and enrollment
- There is no offline lecturer device in the trust chain

Therefore, the session link is an authenticated pointer into the backend, not a bearer token.

---

## 9. Device identity model

### 9.1 Stable identity resolution
**File:** `apps/mobile/src/utils/onlineAttendanceApi.js`

```
resolveDeviceId()
  1. Try: sqliteStorage.getOrCreateAttendanceDeviceId()
     → stored in app_settings table as ATTENDANCE_DEVICE_ID
     → generated once via generateDeviceId() (random UUID string)
     → survives app updates and most reinstalls
  2. Fallback: DeviceInfo.getUniqueId()
     → Android: stable hardware-backed ID
     → iOS: can change after reinstall
  3. Final fallback: 'unknown'
```

### 9.2 SQLite settings schema
**File:** `apps/mobile/src/storage/sqliteStorage.js`

| Setting key | Purpose | Survives reinstall? |
|-------------|---------|---------------------|
| `ATTENDANCE_DEVICE_ID` | Used for online `deviceId` + offline attendance dedup | Yes (SQLite lives in app sandbox) |
| `ATTENDANCE_DEVICE_KEY` (iOS) | For offline relay | Through Keychain syncing settings |

### 9.3 Where `deviceId` is used

| Consumer | File | Purpose |
|----------|------|---------|
| Online submit | `onlineAttendanceApi.js:59` | Body `{ deviceId }` in `POST /submit` |
| Online duplicate guard | `submit/route.ts:116-125` | `@@unique(sessionId, deviceId)` |
| Rate limit key | `submit/route.ts:128-134` | `submitLimiter` key includes deviceId |
| Local SQLite record | `OnlineMarker.js:139-150` | Stored in `attendance_records.device_id` |

---

## 10. Deduplication strategy

| Level | Mechanism | Scope |
|--------|-----------|-------|
| Database unique | `@@unique(sessionId, studentId)` on `OnlineAttendanceRecord` | Prevents same student from submitting twice |
| Database unique | `@@unique(sessionId, deviceId)` on `OnlineAttendanceRecord` | Prevents one device from marking multiple students |
| Database unique | `@@unique(studentId, unitCode, lectureRoom, sessionStart)` on `OfflineAttendanceRecord` | Unified view consistency |
| Client-side queue | `pending_online_submissions` table with `id` primary key | Prevents duplicate queue entries across crash/restart |
| Server rate limit | 3 attempts per `(deviceId, sessionId)` per 10 minutes | Throttles rapid retries |
| Server rate limit | 5 attempts per `studentId` per 1 minute | Throttles rapid retries regardless of device |

### Handling duplicate submissions

- **Online submit (`/submit`)**: Prisma `P2002` is not explicitly caught; the unique constraint raises an error that surfaces as a 409 only if the DB throws. The client handles this in the UI as text matching `/already|duplicate|submitted/i`.
- **Legacy `/mark`**: Prisma `P2002` is caught (error code check) and returns 400.

---

## 11. Rate limiting

**File:** `apps/web/lib/rateLimit.ts`

| Limiter | Key pattern | Window | Max | Used where |
|---------|-------------|--------|-----|-------------|
| `submitLimiter` | `${deviceId}:${sessionId}` | 10 minutes | 3 | `POST /sessions/:id/submit` |
| `studentLimiter` | `student:${studentId}` | 1 minute | 5 | `POST /sessions/:id/submit` |
| `perIpLimiter` | `mark:${clientIp}` | 5 minutes | 10 | `POST /sessions/:id/mark` |
| `perSessionLimiter` | `mark:${sessionId}` | 10 minutes | 20 | `POST /sessions/:id/mark` |

**Limitations:**
- In-memory `Map` evicted every 60 seconds and capped at 100k entries
- Multi-instance deployments (Vercel) do **not** share state — a student can rotate instances and reset limits slightly. The auth+enrollment checks are the stronger protection.

---

## 12. Testing checklist

### Backend

| Test | Command | Notes |
|------|---------|-------|
| Unit test — rate limiter | `jest lib/rateLimit.ts` | Verify window expiry, max, and eviction |
| Integration — create session | `POST /api/attendance/sessions` with lecturer JWT | Verify `expiresAt = now + durationMs`, `shareableLink` format |
| Integration — submit without JWT | `POST /sessions/:id/submit` no auth header | Expect 401 |
| Integration — submit with bad JWT | Expired or incorrect audience | Expect 401 |
| Integration — submit without enrollment | Student JWT for unit they are not enrolled in | Expect 403 |
| Integration — duplicate submit | Same student + same deviceId twice | Second call returns 409 |
| Integration — expired session | Wait for `expiresAt`, then submit | Expect 410 |
| Integration — concurrent duplicate race | Send two submits simultaneously; one wins | Verify single `OnlineAttendanceRecord` row |
| Integration — `/mark` uniform errors | Call with bad session ID, bad admission number, duplicate | All return 400 (no 404/409 leakage) |

### Mobile

| Test | Command | Notes |
|------|---------|-------|
| Unit — `resolveDeviceId()` | Jest mock sqliteStorage + DeviceInfo | Verify stable SQLite id wins, fallback chain works |
| Integration — OnlineTaker create | Mock lecturer JWT, POST sessions | Verify polling starts, `syncConductedSession` fires |
| Integration — OnlineTaker backoff | Simulate 3 failed poll requests | Verify interval grows to 20 s, resets after 60 s success |
| Integration — OnlineMarker success | Deep link to valid session, enrolled student | Verify `submitOnlineAttendance` called, local SQLite record written |
| Integration — OnlineMarker expired | Deep link to expired session | Verify `expired` phase; no submit attempted |
| Integration — OnlineMarker offline | Disable network before submit | Verify `queueOnlineSubmission` called; error phase shown |
| Integration — queue drain on reconnect | Queue item, then simulate NetInfo online | Verify `drainQueue` calls `syncPendingOnlineSubmissions`, queue cleared |
| Integration — AppState foreground drain | Queue item, background app, foreground | Verify `AppState` listener fires `drainQueue` after 500 ms |

---

## 13. Common pitfalls

| Pitfall | Impact | Mitigation |
|---------|--------|------------|
| `DeviceInfo.getUniqueId()` changes on iOS reinstall | New UUID bypasses `(sessionId, deviceId)` unique constraint silently | Use `sqliteStorage.getOrCreateAttendanceDeviceId()` first — stable across reinstalls in most cases |
| `syncConductedSession` failure leaves analytics blind | Online session invisible to grid/count endpoints | Logged via `console.warn('[OnlineTaker] conducted-session sync failed:', err)` since security hardening upgrade |
| Rate limit in-memory map is per-instance | Multi-instance deployment resets per-instance counters | Enrollment + JWT auth are the real guards; rate limit is a throttle, not authorization |
| `OfflineAttendanceRecord.upsert` key | Upsert uses `studentId_unitCode_lectureRoom_sessionStart` — if `session.createdAt` differs from `Date.now()` used in local record, client-side history may not match backend count | Client local save uses `Date.now()`; backend uses `session.createdAt` — keep these aligned in UI display logic |
| `/mark` endpoint lacks enrollment | A link forwarded to an non-enrolled visitor still marks attendance if they know an admission number | Low risk in practice because the link UUID is unguessable and the endpoint is not used by the primary mobile flow; consider removing or gating with lightweight enrollment check if usage grows |
| `useSyncOnReconnect` may drain stale queues | An old queued submission for an expired session will 410 on the server, removing it from the queue | Backend handles expired sessions safely; no harm in retrying |

---

## 14. Relation to offline attendance

Online and offline attendance share the `OfflineAttendanceRecord` table for unified student summaries but are otherwise disjoint:

| Aspect | Online | Offline |
|--------|--------|---------|
| Source of truth table | `OnlineAttendanceSession` / `OnlineAttendanceRecord` | `ConductedSession` / `OfflineAttendanceRecord` |
| Cryptographic tokens | None | HMAC + sessionKey + nonce |
| Lecturer device keychain | Not involved | Session key stored only in Keychain |
| Student verification | JWT + enrollment | rawPayload HMAC verification + motion (optional) |
| `lectureRoom` value | `"ONLINE"` | Actual room code |
| `method` value | `"online"` | `"qr"`, `"ble"`, `"manual"`, `"proxy_leader"` |
| Backend polling | 5 s base, exponential backoff (client-driven) | N/A — student-driven submit |
| Failure recovery | SQLite queue + NetInfo/AppState drain | SQLite queue + NetInfo/AppState drain |

Changes to one path should not alter the other's crypto model.
