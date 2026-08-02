# Online Attendance — Architecture Overview

> **Purpose:** This document explains the high-level design of the online attendance subsystem. It covers the participants, data model, security boundary, and how online sessions fit into the broader MarkWise attendance system.
> **Audience:** backend engineers, mobile engineers, QA, security reviewers
> **See also:** `ONLINE_ATTENDANCE_DEEP_DIVE.md`

---

## 1. Scope

Online attendance is the lecturer-initiated, link-based attendance path for use during virtual lectures (Zoom, Teams, Meet). It is one of four attendance capture paths:
1. **Online** — lecturer shares a link; students tap to mark from their own device
2. **Offline BLE/QR** — lecturer broadcasts a BLE beacon; students scan a QR or detect BLE
3. **Manual PIN** — lecturer speaks a rotating PIN; students type it in
4. **Group-delegation (proxy)** — group leader marks absent members

## 2. What online attendance is NOT

Online attendance does **not** involve:
- A per-session `sessionKey` or cryptographic materials on the student path
- BLE beacons, QR codes, or PIN tokens
- HMAC signature verification (`attendanceCrypto.ts` is not invoked)
- Any exchange from the lecturer device to the backend beyond an HTTP session record

The `sessionKey` material, BLE advertising, and QR signing belong exclusively to the offline path. Online sessions rely on standard JWT identity, enrollment verification, and device binding.

## 3. System participants

| Participant | Device | Role |
|-------------|--------|------|
| **Lecturer** | Mobile app (`OnlineTaker.js`) | Creates the online session, polls attendees, may end the session |
| **Student** | Mobile app (`OnlineMarker.js`) | Taps a link, auto-submits via JWT |
| **Backend** | Next.js on Vercel | Stores sessions, authenticates JWTs, enforces enrollment, prevents duplicates |
| **Deep link redirect** | Next.js route `/attend` | Serves a lightweight HTML page that bridges browser chat → MarkWise app |

## 4. Two independent data models

The online path writes to **two separate tables** that are not foreign-key linked.

### 4.1 `OnlineAttendanceSession` / `OnlineAttendanceRecord`

The **authoritative** tables for the online path.

```
OnlineAttendanceSession
  id            UUID PK
  lecturerId    FK → User
  unitCode      String (normalized)
  type          String DEFAULT "online"
  status        String DEFAULT "active"  | "expired" | "ended"
  expiresAt     DateTime
  endedAt       DateTime?
  createdAt     DateTime DEFAULT now()

  records       → OnlineAttendanceRecord[]

  @@unique_index(sessionId, studentId)    prevents duplicate submit
  @@unique_index(sessionId, deviceId)     prevents device-sharing
```

```
OnlineAttendanceRecord
  id              UUID PK
  sessionId       FK → OnlineAttendanceSession
  studentId       FK → Student
  admissionNumber String (uppercased on write)
  unitCode        String
  deviceId        String?            from stable device identity
  markedAt        DateTime DEFAULT now()

  @@unique(sessionId, studentId)
  @@unique(sessionId, deviceId)
```

### 4.2 `ConductedSession` (analytics mirror)

For the online path, `ConductedSession` is a **derived, analytics-only** record. It is populated by the mobile app firing `syncConductedSession()` after the online session is created.

```
ConductedSession (offline path normally owns this; online mirrors into it)
  id
  unitCode
  lectureRoom       = "ONLINE"           ← hardcoded for online
  sessionStart
  sessionEnd?
  lecturerId
  sessionKey        = null                ← online sessions have no key
  sessionNonce      = 0                   ← not used
  sessionDuration   DEFAULT 3600
  bleUnitId?
  bleRoomId?
```

**Important:** `OnlineAttendanceSession` has `ON DELETE CASCADE` to its records. There is no FK from `OnlineAttendanceRecord` → `ConductedSession`. The two records are independently created and independently returned from analytics endpoints.

### 4.3 `OfflineAttendanceRecord` (unified student view)

Students see a combined attendance history across online and offline sessions. On every successful online submission the backend also upserts an `OfflineAttendanceRecord` with:
- `lectureRoom = "ONLINE"`
- `method = "online"`
- `unitCode` normalized to match offline records

This ensures student summary / progress screens count online sessions without extra joins.

## 5. Security boundary

Online attendance security is layered:

1. **Lecturer identity** — JWT or admin cookie at session creation; backend derives `lecturerId` from token, never from the request body
2. **Student identity** — Bearer JWT on submit; `verifyStudentAccessToken()` extracts `studentId` and `admissionNumber`
3. **Enrollment** — `Enrollment` table is consulted before accepting any mark
4. **Device binding** — `deviceId` tracked per session; unique constraint plus per-device rate limit (3 attempts per 10 minutes)
5. **Rate limiting** — per-student global limit (5 attempts per minute) + per-device+session limit
6. **Session expiry** — `expiresAt` checked on every read and write; database field `status` is moved to `"expired"` by sweep queries
7. **No cryptographic tokens** — no session key, no rawPayload, no HMAC anywhere on the online path; students cannot forge marks without a valid student JWT that is enrolled in the unit

## 6. Sequence diagram (happy path)

```
Lecturer (mobile)                    Backend (Next.js)                  Student (mobile)
     |                                    |                                  |
     | -- POST /api/attendance/sessions -->|
     |    Authorization: Bearer <lecturer>|                                  |
     |    { lecturerId, unitCode,        |                                  |
     |      durationMs: 600000 }         |                                  |
     |                                    | -- create OnlineAttendanceSession |
     |                                    | -- return { sessionId, link } -->|
     | -- start polling interval --------|                                  |
     | -- fire-and-forget sync --------->|                                  |
     |   syncConductedSession()          | -- upsert ConductedSession ----->|
     |                                    |                                  |
     |                                    |   <share link with students>      |
     |                                    |                                  |
     |                                    | <-- GET /api/attendance/sessions/:id/submit ---|
     |                                    |     Authorization: Bearer <student>         |
     |                                    |     { deviceId }                             |
     |                                    |     check: active, enrolled, not duplicate   |
     |                                    |     create OnlineAttendanceRecord            |
     |                                    |     upsert OfflineAttendanceRecord           |
     |                                    | -- return { attendanceId } -------------->|
     |                                    |                                  | -- show success
     | -- GET attendees (poll 5s) ----->|                                  |
     |    Authorization: Bearer <lecturer>|                                  |
     | <-- [{ studentName, admission, ts}]|                                  |
```

## 7. Key invariants

| Invariant | Enforcement |
|-----------|-------------|
| One mark per student per online session | `@@unique(sessionId, studentId)` |
| One device per student per session | `@@unique(sessionId, deviceId)` |
| Student must be enrolled in the unit | `Enrollment.findFirst` before any write |
| Session has finite lifetime | `expiresAt` checked on every read; max 10 minutes default |
| Lecturer owns their session | JWT `scope.userId === session.lecturerId` |
| Deep-link session parameter is opaque | UUID, sanitized to `^[a-zA-Z0-9_-]+$` on `/attend` |
| Link disclosure alone is insufficient | Student still needs valid enrolled JWT + deviceId |

## 8. Architecture boundaries

```
┌───────────────────────────────────────────────────────────┐
│ Online path                                               │
│  • Tables:       OnlineAttendanceSession/Record           │
│  • Auth:         JWT (student/lecturer/admin)              │
│  • Verification: enrollment + device binding + rate limit  │
│  • No crypto:    no sessionKey, no HMAC, no rawPayload     │
│  • Primary read: GET /api/attendance/sessions/:id          │
│  • Primary write: POST /api/attendance/sessions/:id/submit │
└───────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────┐
│ Offline path (crypto-heavy)                               │
│  • Tables:       ConductedSession + OfflineAttendanceRecord│
│  • Auth:         JWT + lecturer device hardware keychain   │
│  • Verification: HMAC-SHA256 QR, BLE nonce, relay proof   │
│  • sessionKey:   stored only on lecturer device + backend  │
│  • attendedPath: rawPayload + deviceKey + motion check    │
└───────────────────────────────────────────────────────────┘

        ┌────────────────────┐  syncConductedSession()  ┌──────────────────┐
        │ OnlineAttendanceSession │ ---------------------> │ ConductedSession  │
        │ (authoritative)         │    analytics mirror     │ (offline-owned)   │
        └────────────────────────┘    lectureRoom="ONLINE" └──────────────────┘
```

## 9. File map

### Backend

| File | Responsibility |
|------|----------------|
| `apps/web/app/api/attendance/sessions/route.ts` | Create session (`POST`), list conducted sessions (`GET`) |
| `apps/web/app/api/attendance/sessions/[id]/route.ts` | Student session info (`GET`) |
| `apps/web/app/api/attendance/sessions/[id]/submit/route.ts` | Student submits attendance (`POST`) |
| `apps/web/app/api/attendance/sessions/[id]/end/route.ts` | Lecturer ends session (`POST`) |
| `apps/web/app/api/attendance/sessions/[id]/attendees/route.ts` | Lecturer polls attendees (`GET`) |
| `apps/web/app/api/attendance/sessions/[id]/mark/route.ts` | Legacy public fallback (`POST`) — no enrollment, no crypto |
| `apps/web/app/attend/route.ts` | Deep-link HTML redirect page with `markwise://` / `intent://` |
| `apps/web/lib/studentAuthJwt.ts` | JWT sign/verify for student tokens |
| `apps/web/lib/adminLecturerAuth.ts` | `resolveAdminOrLecturerScope` for lecturer endpoints |
| `apps/web/lib/rateLimit.ts` | In-memory sliding-window rate limiter |
| `apps/web/lib/attendanceCrypto.ts` | **Not used by online path** — offline only |
| `apps/web/prisma/schema.prisma` | `OnlineAttendanceSession` (line 560), `OnlineAttendanceRecord` (line 577), `StudentDevice` (line 390), `OfflineAttendanceRecord` (line 700) |

### Mobile

| File | Responsibility |
|------|----------------|
| `apps/mobile/src/screens/lecturer/AttendanceTracker/OnlineTaker.js` | Lecturer UI: create, share, monitor, end online session; exponential backoff polling |
| `apps/mobile/src/screens/student/AttendanceMarker/OnlineMarker.js` | Student UI: deep-link entry, auto-submit, background retry queue, dismiss to meeting |
| `apps/mobile/src/utils/onlineAttendanceApi.js` | `fetchOnlineSessionInfo`, `submitOnlineAttendance`, `queueOnlineSubmission`, `syncPendingOnlineSubmissions` |
| `apps/mobile/src/utils/offlineAttendanceApi.js` | `syncConductedSession` — fire-and-forget analytics mirror |
| `apps/mobile/src/utils/sessionCrypto.js` | **Not used by online path** — offline QR/BLE/PIN only |
| `apps/mobile/src/utils/studentDeviceKey.js` | Hardware-backed device key — offline relay only |
| `apps/mobile/src/storage/sqliteStorage.js` | Stable device identity (`getOrCreateAttendanceDeviceId`), `pending_online_submissions` queue |
| `apps/mobile/src/utils/constants.js` | `ONLINE_SESSION_DURATION_MS`, `API_BASE_URL`, `normalizeUnitCode` |
| `apps/mobile/src/hooks/useSyncOnReconnect.js` | Debounced reconnect hook used by `OnlineMarker` for queue drain |

## 10. Notable design decisions

| Decision | Rationale |
|----------|-----------|
| Separate `OnlineAttendanceSession` table instead of reusing `ConductedSession` | Online sessions have no cryptographic material; mixing them would dirty the offline model |
| Dual-write to `OfflineAttendanceRecord` | Student progress screens are one unified table; avoids special-casing online |
| `sessionKey = null` for online `ConductedSession` | Signals analytics/UI code that no QR/BLE/PIN verification exists |
| Shareable link uses opaque UUID | `/attend?session=<uuid>` — UUIDv4 is unguessable; no short codes to enumerate |
| No `rawPayload` in online path | Removes an entire class of replay/generation attacks; no payload to forge |
| Public `/mark` endpoint preserved but hardened | Legacy fallback; now returns uniform 400, IP+session rate limited, no enumeration |
| Stable device identity in SQLite | `getOrCreateAttendanceDeviceId()` persists across app updates and most reinstalls before falling back to platform UID |
