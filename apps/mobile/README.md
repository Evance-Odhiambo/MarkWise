# MarkWise

MarkWise is a mobile attendance and academic management platform for universities and colleges. It is built with React Native and runs on both Android and iOS. Lecturers use it to start attendance sessions and manage their courses. Students use it to mark their own attendance, view their timetable, submit assignments, and track their progress.

The system is designed to work entirely offline — a student in a building with no internet connection can still mark their attendance and it will sync automatically when connectivity is restored.

---

## Table of Contents

1. [The Core Problem MarkWise Solves](#1-the-core-problem-markwise-solves)
2. [System Architecture Overview](#2-system-architecture-overview)
3. [Authentication and Session Management](#3-authentication-and-session-management)
4. [Attendance: How It Works End to End](#4-attendance-how-it-works-end-to-end)
   - [Offline Attendance via Bluetooth (BLE)](#41-offline-attendance-via-bluetooth-ble)
   - [Offline Attendance via QR Code](#42-offline-attendance-via-qr-code)
   - [Online Attendance via Deep Link](#43-online-attendance-via-deep-link)
   - [Manual Fallback PIN](#44-manual-fallback-pin)
5. [Attendance Security In Depth](#5-attendance-security-in-depth)
   - [Physical Presence: BLE Proximity](#51-physical-presence-ble-proximity)
   - [Tamper-Proof QR Codes](#52-tamper-proof-qr-codes)
   - [Motion Detection](#53-motion-detection)
   - [Rotating Manual PIN Cryptography](#54-rotating-manual-pin-cryptography)
   - [Online Attendance Controls](#55-online-attendance-controls)
   - [Deduplication and the Local Safety Net](#56-deduplication-and-the-local-safety-net)
6. [Offline-First Architecture and Sync](#6-offline-first-architecture-and-sync)
7. [Course Management Features](#7-course-management-features)
8. [Notifications and Firebase](#8-notifications-and-firebase)
9. [Navigation Structure](#9-navigation-structure)
10. [Native Modules (Android and iOS)](#10-native-modules-android-and-ios)
11. [Data Storage](#11-data-storage)
12. [Tech Stack and Dependencies](#12-tech-stack-and-dependencies)
13. [Project Structure](#13-project-structure)
14. [Backend API](#14-backend-api)

---

## 1. The Core Problem MarkWise Solves

Traditional digital attendance has one fundamental flaw: any credential that can be shared can be abused. A static QR code photographed and forwarded, a link texted to a friend, a PIN read aloud over a call — all of these let someone mark attendance without being in the room.

MarkWise addresses this by combining multiple independent verification methods that must all pass simultaneously. Breaking one method is not enough. A realistic attack requires defeating physical proximity detection, cryptographic time-binding, device identity verification, and physical movement detection all at once and within a window of a few seconds. That is not a practical attack for a student trying to skip a lecture.

The design principle is: verify presence, not just knowledge of a credential.

---

## 2. System Architecture Overview

MarkWise is a React Native application that communicates with a backend hosted on Vercel at `https://markwise-gilt.vercel.app`. The app does not depend on the backend being available at the moment of attendance — all critical attendance operations are performed locally and synced later.

```
┌─────────────────────────────────────────────────────────────┐
│                       React Native App                      │
│                                                             │
│  ┌─────────────────┐         ┌──────────────────────────┐  │
│  │  Lecturer Side  │         │      Student Side         │  │
│  │                 │         │                           │  │
│  │  OfflineTaker   │ ──BLE── │  OfflineMarker (scanner) │  │
│  │  OnlineTaker    │ ──QR─── │  OnlineMarker (deep link)│  │
│  │  Manual PIN     │         │  LeadSessionScreen (GD)  │  │
│  └─────────────────┘         └──────────────────────────┘  │
│           │                              │                  │
│           └──────────── SQLite ──────────┘                  │
│                            │                                │
│                    Background Sync                          │
└────────────────────────────┼────────────────────────────────┘
                             │ HTTPS (when online)
                    ┌────────▼────────┐
                    │  Vercel Backend  │
                    │  /api/attendance │
                    │  /api/units      │
                    │  /api/auth       │
                    │  /api/sessions   │
                    └─────────────────┘
```

The app has two completely separate user experiences — one for lecturers and one for students — governed by the role they selected when they created their account.

---

## 3. Authentication and Session Management

### Sign In and Sign Up

Both lecturers and students start at a role selection screen where they choose their identity. They are then taken to separate sign-in and sign-up flows. Credentials are sent to the backend, which returns a JWT token. This token is stored securely in the device's Keychain (iOS) or Keystore-backed secure storage (Android) using `react-native-keychain`. It is never stored in plain AsyncStorage.

### Session Persistence

On subsequent app launches, MarkWise reads the stored session from Keychain without hitting the network. If the token is still valid, the user is taken directly to their home screen. If it has expired, they are redirected to sign in again.

All API requests are handled through a shared Axios client (`apiClient.js`) that automatically reads the stored token and injects it as a `Bearer` header. If the server returns a 401 (Unauthorized), the cached token is cleared and the user is prompted to re-authenticate.

### Role Separation

Lecturers and students have entirely different navigation structures, screens, and capabilities. A lecturer cannot access student attendance screens and vice versa. The role is set at account creation and cannot be changed in-app.

---

## 4. Attendance: How It Works End to End

MarkWise has four attendance methods. They are not alternatives to each other — in a physical classroom, BLE and QR work together simultaneously to create overlapping layers of verification.

---

### 4.1 Offline Attendance via Bluetooth (BLE)

**What happens on the lecturer's side:**

When the lecturer opens the Offline Attendance screen and selects a unit and room, the app begins broadcasting a Bluetooth Low Energy advertisement immediately. This broadcast is invisible to the human eye — it is a silent radio signal that any nearby Bluetooth device can detect passively without pairing.

The broadcast carries a 10-byte binary packet:

```
Byte 0–1:  Unit ID (2-byte numeric ID mapped to the course code)
Byte 2–3:  Room ID (2-byte numeric ID mapped to the room code)
Byte 4–7:  Session start time (Unix timestamp, seconds)
Byte 8:    Group ID (for group discussion sessions; 0 for regular lectures)
Byte 9:    Session counter (increments on each session update)
```

This is intentionally binary and compact. A Bluetooth packet analyser would see raw bytes — not a course name, not a lecturer name, nothing human-readable without the institution's ID mapping database.

**What happens on the student's side:**

The student opens the MarkWise attendance screen. In the background, the app starts scanning for BLE advertisements carrying MarkWise's service UUID (`00001101-0000-1000-8000-00805F9B34FB`). When it detects a packet matching this UUID, it decodes the 10 bytes, looks up the unit and room IDs in the locally cached mapping, and checks enrollment.

If the student is enrolled in the decoded unit, and the session is within its 10-minute window, and the phone has been physically moved in the last 8 seconds, attendance is saved locally and eventually synced to the backend.

**Cross-platform compatibility:**

Android and iOS advertise differently due to platform restrictions. Android embeds the payload as manufacturer-specific data under company ID `0x1234`. iOS cannot embed raw manufacturer data in background advertisements, so it encodes the payload as base64 and broadcasts it as the device's local advertisement name with a `MW:` prefix. The scanner on both platforms checks all three possible locations in the packet — manufacturer data, service data, and local name — so every combination of lecturer/student platforms works transparently.

**Relay system for large rooms:**

BLE range is typically 10–15 metres indoors. In a 300-seat lecture hall, students at the back might be out of reliable range. To address this, MarkWise uses a probabilistic relay system.

When a student's phone successfully receives the lecturer's broadcast, it measures the signal strength (RSSI). Students with a stronger signal are physically closer to the lecturer and are better relay candidates. The app calculates an election probability proportional to signal strength and rolls a random number. If elected, the phone starts re-broadcasting the same payload after a random stagger delay of up to 150 milliseconds. The stagger prevents all elected relays from transmitting simultaneously, which would cause interference.

Students at the back of the room receive the relayed packet from the elected relay nodes, which are all inside the room. The coverage extends across the room without extending outside it — because the relays are themselves inside the building.

---

### 4.2 Offline Attendance via QR Code

**What happens on the lecturer's side:**

Alongside the BLE broadcast, the lecturer's screen displays a QR code. This QR code is not a fixed image — it regenerates completely every 3 seconds. Each code encodes:

- The unit code and room code (XOR-encrypted with a secret key, then base64-encoded)
- An epoch timestamp aligned to the current 3-second window
- The session start time

The payload is always prefixed with `MWQR1:` so the student's scanner can immediately identify it as a MarkWise code and reject anything else.

**The visual inversion layer:**

After generating the QR mathematically, MarkWise applies an additional layer of protection: it flips approximately half the data modules in the QR grid using a checkerboard pattern. Any module where the sum of its row and column number is even gets inverted — dark becomes light, light becomes dark. The structural zones (finder patterns, timing strips, format information) are left completely untouched.

This means any standard QR scanner — WhatsApp, Google Lens, Apple Camera, any third-party app — will find and orient the code correctly (because the finder patterns are intact) but will fail to decode it (because the data modules are systematically flipped). The resulting bits produce a checksum error or garbage. The code is physically unreadable by any scanner except MarkWise.

The MarkWise scanner knows to reverse this operation before decoding. It extracts the bit grid, flips the same checkerboard positions back, and then decodes the restored data normally.

**What happens on the student's side:**

The student points their phone at the QR on the lecturer's screen. The MarkWise camera component — built on ZXing, not the system camera — detects the QR using the intact finder patterns, extracts the bit grid, applies the inverse mask, XOR-decrypts the content, and validates the unit code, room, and timestamps. If everything checks out, scan 1 of 2 is registered.

**Why two scans:**

A single scan does not mark attendance. The student must scan twice. Between scan 1 and scan 2, the phone must detect meaningful physical movement via the accelerometer. The student cannot simply tap twice — they have to lower the phone, move, and re-present it to the QR. The QR may rotate between the two scans; that is fine. What is verified is that the same enrolled student, on a moving device, saw a valid session code twice.

---

### 4.3 Online Attendance via Deep Link

**What happens on the lecturer's side:**

For remote sessions (Zoom, Teams, Google Meet), the lecturer opens the Online Attendance screen, selects a unit, and starts a session. The backend creates a session record and returns a shareable link in the format:

```
https://markwise-gilt.vercel.app/attend?session=<sessionId>
```

The lecturer pastes this link into the meeting chat. The link contains only an opaque session ID — no unit code, no lecturer name, nothing meaningful to a person who does not have a MarkWise account.

**What happens on the student's side:**

When the student taps the link, the web page at that URL immediately fires a deep link: `markwise://attend?session=<sessionId>`. This redirects the student into the MarkWise app. The web redirect layer exists because deep links cannot be fired directly from in-app browsers inside Zoom or Teams — the web page handles the platform-specific routing.

The MarkWise app opens the Online Marker screen, which immediately and automatically reads the student's JWT token from Keychain, fetches the session details from the server, and submits attendance in a single flow. The student does not fill in any form. The submission includes:

- The JWT Bearer token (cryptographically identifies which student is submitting)
- The session ID
- The device's hardware fingerprint (`DeviceInfo.getUniqueId()`)

After 1.2 seconds of confirmation, the app minimises on Android, returning the student directly to their meeting.

---

### 4.4 Manual Fallback PIN

For students without smartphones, the lecturer's screen displays a 6-digit rotating PIN below the QR code. This PIN changes every 30 seconds. It is derived from the unit code, room code, session start time, and the current 30-second time window using HMAC-SHA256 — the same algorithm used in banking APIs.

The PIN can be read aloud or written down. The lecturer manually enters it into the roster. Despite being human-readable, it has time-based expiry, session-context binding, and server-side cryptographic verification, which are described in detail in the security section.

---

## 5. Attendance Security In Depth

### 5.1 Physical Presence: BLE Proximity

Bluetooth Low Energy advertising at normal transmit power reaches reliably between 5 and 15 metres indoors. It does not travel well through multiple walls and does not propagate down corridors in a useful way. A student in a corridor outside the room or in a different part of the building will not receive the signal.

This physical boundary is the foundation of the BLE security model. The signal cannot be forwarded the way a link or PIN can — receiving and retransmitting it from a remote location in real time would require custom hardware running continuously, not just a smartphone. The moment a student's phone detects the signal, it is effectively confirmed to be within roughly 15 metres of the lecturer's device.

The relay system does not weaken this — relay nodes are themselves inside the room, having passed the same proximity check.

### 5.2 Tamper-Proof QR Codes

The QR code has three independent layers of protection:

**Layer 1 — 3-second expiry.** Each code encodes a timestamp aligned to a 3-second clock boundary shared between the lecturer and scanner. The scanner checks whether the code belongs to the current or immediately adjacent window. A photographed code shared over a chat app expires before it arrives.

**Layer 2 — XOR encryption.** The payload is XOR-encrypted with a secret key embedded in the app before being encoded as a QR. Even if someone reads the raw bytes of the QR, they recover encrypted binary data, not a readable unit code or timestamp.

**Layer 3 — Visual inversion.** The data modules of the QR are systematically flipped using a checkerboard pattern before the image is displayed. Every standard QR scanner in existence reads the finder patterns correctly, crops and orients the code correctly, reads all the module values correctly, and then fails to decode the data because the bits are wrong. Only MarkWise's scanner knows to reverse the flip before decoding.

These three layers mean that: the code cannot be shared (expires in 3 seconds), the content cannot be read by a human or standard app (encryption + visual inversion), and even if both were reversed, the session window provides a final time gate.

### 5.3 Motion Detection

Both BLE and QR attendance require the phone to have moved in the 8 seconds before the mark is saved. The accelerometer threshold is 0.45 m/s² — enough to detect natural hand movement but not triggered by vibration or a phone sitting in a pocket.

This defeats the most technically sophisticated attack: someone with custom hardware captures the BLE packet or QR code from inside the room and retransmits it to a stationary phone elsewhere. The remote phone is sitting on a table. It has not moved. The motion check fires, the attendance is not saved.

A student genuinely holding their phone in a lecture will always be moving slightly from breathing, weight shifting, or adjusting their grip.

### 5.4 Rotating Manual PIN Cryptography

The 6-digit PIN is not a random number. It is computed as:

```
HMAC-SHA256(secret_key, "MW2|unitCode|roomCode|sessionStart|rotationWindow")
```

where `rotationWindow = floor(currentTimeMs / 30000)` — a number that advances by 1 every 30 seconds globally.

The HMAC output (a 256-bit hash) is folded into a 6-digit number using a multiplicative mixing function based on the golden ratio constant (Knuth's hashing). The result is a PIN that:

- Changes every 30 seconds (rotation window advances)
- Is unique to this specific unit and room (context is in the hash input)
- Is unique to this session (session start time is in the hash input)
- Cannot be reversed to discover any of the above inputs
- Cannot be predicted without the secret key
- Can be verified offline by any system that knows the formula and the key

The validator checks the current window and the previous window (30-second grace for clock skew) and iterates across all valid session-start anchors within the session duration. This means an early or slightly out-of-sync submission still validates correctly.

### 5.5 Online Attendance Controls

Online attendance cannot fully enforce physical presence — the student is not in a physical room. The controls it applies are:

- **Identity verification.** The JWT token is cryptographically signed by the server. The student cannot claim to be someone else.
- **Enrollment check.** The server verifies the student is enrolled in the unit before saving the record.
- **Device binding.** The device fingerprint is submitted with every mark. The same device cannot mark two different student accounts in the same session.
- **10-minute session window.** The session is closed server-side after 10 minutes. A forwarded link has at most this long to be used.
- **Deduplication.** The server blocks duplicate submissions from the same account for the same session regardless of how many times the link is tapped.

### 5.6 Deduplication and the Local Safety Net

Every attendance record is stored locally in SQLite the moment it is created, indexed by unit code, room code, and session start time. Before saving any new record, the app checks this local index. Any attempt to mark the same session twice — from any method, from any screen — is silently blocked before it reaches the network.

When the record eventually syncs to the backend, the server runs its own deduplication check on admission number and session ID. The device does not have to be the same device to trigger the dedup — the student's account ID is the unique key at the server level.

---

## 6. Offline-First Architecture and Sync

MarkWise is designed under the assumption that the student's phone may have no internet connection at the time of marking, and that the network connection may disappear and return unpredictably.

When a student marks attendance and no internet is available, the record is saved to SQLite with a `synced = 0` flag. When internet connectivity is restored — detected via `@react-native-community/netinfo` — the app automatically reads all unsynced records and submits them to the backend in the background.

The same pattern applies to the lecturer side. When a conducted session is persisted locally, a background sync call is attempted. If it fails, it is retried the next time the app detects connectivity.

For manual marks made by the lecturer in the roster, a separate queue (`syncPendingManualMarks`) drains itself whenever internet is restored.

This means a lecturer can run a full hour-long session in a basement with no signal and every attendance record will sync automatically once the phone returns to coverage, without the lecturer or students doing anything.

---

## 7. Course Management Features

MarkWise is not only an attendance tool. It includes a full academic management layer for both roles.

**For students:**
- **Timetable** — Personal class schedule synced from the backend, with lesson type colour coding (lecture, lab, tutorial, etc.).
- **Unit enrollment** — Students enroll in units, which determines which BLE and QR signals they accept and which assignments they see.
- **Assignments** — View assigned work, check deadlines, and submit files directly in-app via the document picker.
- **Materials** — Download course materials shared by lecturers.
- **Groups** — View and manage study group membership. Group membership is used in Group Discussion (GD) sessions to restrict which BLE signal a student can use to mark attendance.
- **Progress and insights** — Attendance percentage, achievement badges, and performance trends across enrolled units.
- **Achievements** — Milestone-based badges awarded for consistent attendance or academic engagement.

**For lecturers:**
- **Teaching Hub** — Unified management area for a course.
- **Assignments** — Create assignments with deadlines, view submissions, provide feedback.
- **Materials** — Upload files that become available to enrolled students.
- **Groups** — Create and manage student study groups for Group Discussion sessions.
- **Analytics** — Attendance trends, participation rates, and engagement metrics across sessions.
- **Reports** — Export attendance data to Excel or PDF for administrative submission.
- **Timetable** — View the lecturer's assigned units and scheduled sessions, including which rooms and time slots are assigned.

---

## 8. Notifications and Firebase

MarkWise uses Firebase Cloud Messaging (FCM) for push notifications. The `@react-native-firebase/messaging` library handles token registration, foreground message handling, and background message routing via a headless task registered in `index.js`.

Notifications are split into three channels:
- **Lesson channel** — Class reminders, meeting invites, timetable changes.
- **Reminder channel** — Attendance goal warnings, deadline reminders.
- **General channel** — System messages and administrative alerts.

Each channel has its own sound and priority settings configurable per institution. Notifications are also stored locally in the `push_notifications` SQLite table so students can read them in the Alerts screen even if they missed the live push.

When a student's JWT token changes (re-authentication, token refresh), the app re-registers the FCM token with the backend automatically so push delivery is never interrupted.

---

## 9. Navigation Structure

### Student Navigation

```
RoleSelectionScreen
    └── MainTabs (Bottom Tab Navigator)
            ├── Home (Top Tabs: Overview / Progress / Insights / Achievements)
            ├── Alerts
            ├── Timetable (Top Tabs: My Timetable / Enrollment)
            ├── Course Center (Assignments / Materials / Groups)
            └── Settings

(Modal) OfflineMarker — QR + BLE scanner
(Modal) OnlineMarker  — Deep-link attendance submission
(Stack) LeadSessionScreen — Group Discussion session leader
```

### Lecturer Navigation

```
RoleSelectionScreen
    └── LecturerDrawer (Drawer Navigator)
            ├── Overview
            ├── Timetable
            ├── Attendance (Stack)
            │       ├── AttendanceTaker (mode selector)
            │       ├── OnlineTaker (web link sessions)
            │       └── OfflineTaker (BLE + QR broadcaster)
            ├── Teaching Hub (Stack)
            │       ├── TeachingHub
            │       ├── Assignments
            │       ├── Materials
            │       └── Groups
            ├── Notifications
            ├── Analytics
            ├── Reports
            └── Settings
```

### Deep Linking

The URL scheme `markwise://` is registered for both platforms. Tapping an attendance link in a meeting chat fires:

```
markwise://attend?session=<sessionId>
```

The root navigator intercepts this and routes directly to the `OnlineMarker` screen with the session ID as a parameter, even if the app was closed.

---

## 10. Native Modules (Android and iOS)

MarkWise requires capabilities that React Native's JavaScript layer cannot provide directly. These are implemented as custom native modules in Kotlin (Android) and Swift (iOS).

### BLE Advertiser

Wraps the platform's Bluetooth peripheral manager to broadcast attendance packets.

- Android: Uses `BluetoothLeAdvertiser` with manufacturer-specific data under ID `0x1234`.
- iOS: Uses `CBPeripheralManager` with a local name field (`MW:<base64payload>`) because Apple restricts raw manufacturer data in background advertisements.

The advertiser checks whether the hardware supports peripheral mode before starting, retrying up to 4 times with 500ms delays to handle race conditions during Bluetooth initialisation.

### BLE Scanner

Wraps the platform's Bluetooth central manager to scan for attendance broadcasts.

- Android: Uses `BluetoothLeScanner` in `SCAN_MODE_LOW_LATENCY` with `REPORT_DELAY = 0` so packets are delivered immediately. Can filter by service UUID or scan without filter.
- iOS: Uses `CBCentralManager` with service UUID filtering.

Both platforms extract the payload from whichever field it appears in (manufacturer data, service data, or local name) and emit an `onDeviceFound` event to JavaScript with the raw base64 payload, device RSSI, and MAC address.

### Camera and QR Scanner

A custom camera view built on ZXing (not ML Kit, despite the module name inherited from the original implementation). The camera feed is analysed frame by frame.

For each frame:
1. The luminance (Y) plane of the YUV camera image is extracted.
2. The image is cropped to the central 75% square, reducing pixel work by ~44%.
3. A fast binarizer (`GlobalHistogramBinarizer`) is tried first — 3–5× faster than the standard `HybridBinarizer`.
4. If detection fails, `HybridBinarizer` is tried as a fallback (handles difficult lighting).
5. The QR finder patterns are used to locate and extract the bit grid.
6. The MarkWise inverse mask is applied (checkerboard flip, cached as a flat boolean array per QR size).
7. The ZXing decoder attempts to decode the restored bits.
8. If decoding fails, the mask is reapplied (XOR is self-inverse) and a plain decode is attempted (for backward compatibility with unmasked codes).

Events are throttled at 100ms per emission to prevent flooding the JavaScript bridge with 30fps scan results.

### QR Code Generator

Generates the attendance QR on the lecturer's device.

- Android: Uses `QRCodeWriter` from ZXing with `MARGIN=0` and size 1 to obtain a module-level `BitMatrix`. Draws each module as a filled rectangle on a `Canvas`. Applies the checkerboard inversion. Compresses to PNG and returns as base64.
- iOS: Uses `CIFilter.qrCodeGenerator` to render at 1px/module, reads the pixel buffer to get module values, applies the checkerboard inversion, and redraws at 512×512 via `UIGraphicsImageRenderer`. Returns as base64 PNG.

The React Native component (`QRCodeGenerator.js`) maintains two `Image` elements stacked at the same absolute position. When a new QR is ready, it is rendered below the current one. When `onLoad` fires (confirming the new image is decoded and ready), the old image is atomically replaced. This eliminates the white flash that occurs when swapping `source` on a single `Image` component.

---

## 11. Data Storage

### SQLite (react-native-sqlite-storage)

The primary local store. Used for all data that must survive offline periods.

| Table | Purpose |
|---|---|
| `attendance_records` | Student attendance marks (BLE and QR scans) with sync status |
| `conducted_sessions` | Sessions the lecturer has run, for backend reporting |
| `enrolled_units` | Student unit enrollment cache |
| `unit_attendance_goals` | Per-unit attendance targets and reminder settings |
| `shared_materials` | Course material metadata |
| `push_notifications` | FCM notification history for the Alerts screen |
| `enrollment_state` | Cached enrollment data for quick access |
| `cached_students` | Lecturer's roster cache for manual attendance |

### Keychain (react-native-keychain)

JWT tokens and session credentials. Encrypted at rest by the OS. Never stored in AsyncStorage.

### AsyncStorage (@react-native-async-storage)

Non-sensitive persistent state: group membership cache, adaptive config, timetable cache, and other data that does not need hardware-level encryption.

---

## 12. Tech Stack and Dependencies

| Category | Library | Version |
|---|---|---|
| Framework | React Native | 0.84.0 |
| Language | React | 19.2.3 |
| Navigation | @react-navigation/native | 7.x |
| Navigation | @react-navigation/drawer | 7.x |
| Navigation | @react-navigation/bottom-tabs | 7.x |
| Navigation | @react-navigation/material-top-tabs | 7.x |
| Bluetooth | Custom native modules (Kotlin/Swift) | — |
| Camera/QR | Custom native modules + ZXing | — |
| Local DB | react-native-sqlite-storage | 6.0.1 |
| Secure store | react-native-keychain | 10.0.0 |
| Key-value store | @react-native-async-storage | 2.x |
| HTTP client | axios | 1.13.x |
| Push notifications | @react-native-firebase/messaging | 23.x |
| Sensors | react-native-sensors | 7.3.6 |
| Device info | react-native-device-info | 15.0.2 |
| Connectivity | @react-native-community/netinfo | 12.x |
| Gradients | react-native-linear-gradient | 2.8.x |
| Icons | react-native-vector-icons | 10.x |
| Charts | react-native-chart-kit | 6.x |
| PDF | react-native-html-to-pdf | 1.x |
| Excel export | xlsx | 0.18.x |
| File sharing | react-native-share | 12.x |
| Encoding | base64-js | 1.5.x |
| Date handling | date-fns + date-fns-tz | 4.x / 3.x |

---

## 13. Project Structure

```
MarkWise/
│
├── android/
│   └── app/src/main/java/com/markwise/
│       ├── bleadvertiser/      BLEAdvertiserModule.kt — BLE peripheral broadcast
│       ├── blescanner/         BLEScannerModule.kt — BLE central scan
│       ├── mlkit/              MLKitCameraView.kt — Camera + ZXing QR decoder
│       └── qrcodegenerator/    QRCodeGeneratorModule.kt — QR image generator
│
├── ios/MarkWise/
│   ├── BLEAdvertiserModule.swift   BLE peripheral (CBPeripheralManager)
│   ├── BLEScannerModule.swift      BLE central (CBCentralManager)
│   ├── MLKitCameraView.swift       Camera + ZXingObjC QR decoder
│   ├── QRCodeGeneratorModule.swift CIQRCodeGenerator + inversion
│   └── AppDelegate.swift           App lifecycle + Firebase init
│
├── src/
│   ├── components/             Shared UI components (QRCodeGenerator, MLKitCamera, etc.)
│   ├── context/                AuthContext, EnrollmentContext
│   ├── hooks/                  useInternetStatus, useResponsive, usePermissions, etc.
│   ├── navigation/             RootNavigator, MainTabs, LecturerDrawer, stacks
│   ├── screens/
│   │   ├── auth/               RoleSelection, SignIn, SignUp (student + lecturer)
│   │   ├── student/
│   │   │   ├── home/           Overview, Progress, Insights, Achievements
│   │   │   ├── AttendanceMarker/ OfflineMarker, OnlineMarker, LeadSessionScreen
│   │   │   ├── CourseWorkspace/  Assignments, Materials, Groups
│   │   │   └── common/         CourseCenter, Settings, Alerts
│   │   ├── lecturer/
│   │   │   ├── AttendanceTracker/ OfflineTaker, OnlineTaker, AttendanceTaker
│   │   │   ├── ClassManager/     Assignments, Materials, Groups
│   │   │   └── (drawer screens)  Overview, Analytics, Reports, Settings, etc.
│   │   └── timetable/          Student and lecturer timetable screens
│   ├── storage/                sqliteStorage.js — all SQLite operations
│   ├── theme/                  colors.js — centralised dark-theme palette
│   └── utils/
│       ├── constants.js        Timing constants, lesson types, API_BASE_URL
│       ├── qrSigning.js        XOR+base64 QR payload encode/decode
│       ├── manualAttendanceToken.js  HMAC-SHA256 rotating PIN generation/validation
│       ├── adaptiveAttendanceConfig.js  Institution BLE/QR ID mappings
│       ├── sessionManager.js   Session lifecycle (start, stop, time remaining)
│       ├── bleManager.js       BLE module singleton wrapper
│       ├── authSession.js      Keychain session read/write
│       ├── apiClient.js        Axios instance with auto-auth headers
│       └── [API modules]       One file per backend domain (units, enrollment, etc.)
│
├── App.js                      Root component, Firebase setup, AuthContext provider
├── index.js                    Entry point, background FCM handler registration
└── package.json
```

---

## 14. Backend API

The backend is hosted at `https://markwise-gilt.vercel.app` and is accessed over HTTPS. All endpoints require a `Bearer <jwt>` header unless stated otherwise.

| Domain | Base path | Purpose |
|---|---|---|
| Authentication | `/api/auth` | Sign in, sign up, token validation |
| Units | `/api/units` | Fetch available units, enrollment management |
| Attendance | `/api/attendance` | Submit and fetch attendance records |
| Sessions | `/api/attendance/sessions` | Online session lifecycle (create, submit, list attendees, end) |
| Timetable | `/api/timetable` | Student and lecturer timetable entries |
| Assignments | `/api/assignments` | Create, submit, and grade assignments |
| Materials | `/api/materials` | Upload and download course materials |
| Groups | `/api/groups` | Study group management |
| Notifications | `/api/notifications` | FCM token registration, push notification history |
| Analytics | `/api/analytics` | Session statistics and engagement metrics |
| Reports | `/api/reports` | Exportable attendance summaries |

The client synchronises with the backend opportunistically — it never blocks a user action waiting for the network. Local SQLite state is the source of truth during offline periods, and sync is triggered automatically when connectivity is restored.
