/**
 * attendanceValidator.js — Unified student-side attendance validation pipeline.
 *
 * Runs on the student device. Performs three classes of checks:
 *
 *   1. Structural   — correct format, parseable payload, known version byte
 *   2. Session      — beacon/QR sessionNonce matches the pre-cached enrolled session
 *   3. Behavioural  — session time window is active, motion is detected
 *
 * What is NOT checked here (deferred to backend at sync time):
 *   • HMAC correctness — students hold no session key
 *
 * Records that pass here are stored in SQLite with pendingVerification: true.
 * The backend marks them as verified (or rejects them) when the device syncs.
 *
 * cachedSession shape (populated during pre-class online sync, stored in SQLite):
 * {
 *   unitId:          number,  // numeric unit ID  (uint16)
 *   roomId:          number,  // numeric room ID  (uint16)
 *   sessionStart:    number,  // Unix epoch SECONDS
 *   sessionDuration: number,  // seconds
 *   sessionNonce:    number,  // uint32 — links beacon / QR / PIN to this session
 *   unitCode:        string,  // display only  e.g. "SCH2170"
 *   lectureRoom:     string,  // display only  e.g. "LH3"
 *   lessonType:      string,  // display only  e.g. "LEC"
 * }
 */

import {
  decodeBLEBeacon,
  decodeQR,
  deriveCounter,
  QR_WINDOW_SECONDS,
  PIN_WINDOW_SECONDS,
  PIN_LENGTH,
} from './sessionCrypto';

// ─── Tuning constants ─────────────────────────────────────────────────────────

const CLOCK_SKEW_TOLERANCE_S = 15; // accept marks ±15 s outside the nominal session window
const MAX_COUNTER_DRIFT      = 3;  // tolerate up to 3 rotation windows of clock skew

// ─── Internal helpers ─────────────────────────────────────────────────────────

function fail(reason) {
  return { valid: false, reason };
}

function isSessionActive(cachedSession, atMs) {
  const nowS  = Math.floor(atMs / 1000);
  const start = Math.floor(cachedSession.sessionStart);
  const end   = start + Math.max(0, Math.floor(cachedSession.sessionDuration));
  return nowS >= start - CLOCK_SKEW_TOLERANCE_S && nowS <= end + CLOCK_SKEW_TOLERANCE_S;
}

// ─── BLE ─────────────────────────────────────────────────────────────────────

/**
 * Validates a raw BLE beacon received from the lecturer's device.
 *
 * The beacon proves the lecturer's device is physically present and the session
 * is actively running. Cryptographic trust is established via the pre-cached
 * signed session (sessionNonce match) — no key required on the student side.
 *
 * @param rawBytes      — Uint8Array or number[] from BLEScanner native module
 * @param cachedSession — session object from SQLite (synced before class)
 * @param motionActive  — boolean from the accelerometer / motion detector
 * @param atMs          — current epoch ms (default: Date.now())
 *
 * @returns {
 *   valid:         boolean,
 *   reason?:       string,   // present when valid === false
 *   beaconCounter?:number,   // present when valid === true
 *   lessonTypeId?: number,   // present when valid === true
 * }
 */
export function validateBLEBeacon({ rawBytes, cachedSession, motionActive, atMs = Date.now() }) {
  const decoded = decodeBLEBeacon(rawBytes);
  if (!decoded)       return fail('invalid_beacon');   // bad length or wrong version byte
  if (!cachedSession) return fail('no_cached_session');

  // sessionNonce in the beacon is truncated to 16 bits — compare lower 16 bits only
  if ((decoded.sessionNonce & 0xFFFF) !== (cachedSession.sessionNonce & 0xFFFF)) return fail('nonce_mismatch');
  if (decoded.unitId !== cachedSession.unitId) return fail('unit_mismatch');
  if (decoded.roomId !== cachedSession.roomId) return fail('room_mismatch');
  if (!isSessionActive(cachedSession, atMs))   return fail('session_expired');

  // Counter drift check — ensures the beacon is live, not a captured replay
  const expectedCounter = deriveCounter(cachedSession.sessionStart, QR_WINDOW_SECONDS, atMs);
  if (Math.abs(decoded.counter - expectedCounter) > MAX_COUNTER_DRIFT) return fail('counter_drift');

  if (!motionActive) return fail('no_motion');

  return {
    valid:         true,
    beaconCounter: decoded.counter,
    lessonTypeId:  decoded.lessonTypeId,
  };
}

// ─── QR code ─────────────────────────────────────────────────────────────────

/**
 * Validates a scanned QR Base64 string against the student's cached session.
 *
 * The received HMAC token is forwarded to the backend at sync time for
 * cryptographic verification — the student app cannot check it locally.
 *
 * @param base64String  — raw string from the QR camera scanner
 * @param cachedSession — session object from SQLite
 * @param motionActive  — boolean from motion detector
 * @param atMs          — current epoch ms (default: Date.now())
 *
 * @returns {
 *   valid:              boolean,
 *   reason?:            string,
 *   receivedToken?:     string,  // 64-char hex — forwarded to backend at sync
 *   counter?:           number,
 *   pendingVerification?:boolean,
 * }
 */
export function validateQRScan({ base64String, cachedSession, motionActive, atMs = Date.now() }) {
  const decoded = decodeQR(base64String);
  if (!decoded)       return fail('invalid_qr');
  if (!cachedSession) return fail('no_cached_session');

  const { payload, counter, token } = decoded;

  if (payload.sessionNonce !== cachedSession.sessionNonce) return fail('nonce_mismatch');
  if (payload.unitId       !== cachedSession.unitId)       return fail('unit_mismatch');
  if (!isSessionActive(cachedSession, atMs))               return fail('session_expired');

  const expectedCounter = deriveCounter(cachedSession.sessionStart, QR_WINDOW_SECONDS, atMs);
  if (Math.abs(counter - expectedCounter) > MAX_COUNTER_DRIFT) return fail('counter_drift');

  if (!motionActive) return fail('no_motion');

  return {
    valid:               true,
    receivedToken:       token,   // stored in raw_payload, verified by backend on sync
    counter,
    pendingVerification: true,
  };
}

// ─── Manual PIN ──────────────────────────────────────────────────────────────

/**
 * Validates a manually entered PIN on the student device.
 *
 * Without the session key, only format and session-active checks are possible.
 * The actual PIN value is verified by the backend at sync time using the
 * pinCounter forwarded in the attendance record.
 *
 * @param pin           — raw string input from the student's keyboard
 * @param cachedSession — session object from SQLite
 * @param atMs          — current epoch ms (default: Date.now())
 *
 * @returns {
 *   valid:               boolean,
 *   reason?:             string,
 *   normalizedPIN?:      string,  // 6-digit string stored for backend verification
 *   pinCounter?:         number,  // time window counter — lets backend reconstruct expected PIN
 *   pendingVerification?:boolean,
 * }
 */
export function validatePINEntry({ pin, cachedSession, atMs = Date.now() }) {
  const normalized = String(pin ?? '').replace(/\D/g, '');
  if (normalized.length !== PIN_LENGTH) return fail('invalid_format');
  if (!cachedSession)                   return fail('no_cached_session');
  if (!isSessionActive(cachedSession, atMs)) return fail('session_expired');

  const pinCounter = deriveCounter(cachedSession.sessionStart, PIN_WINDOW_SECONDS, atMs);

  return {
    valid:               true,
    normalizedPIN:       normalized,
    pinCounter,
    pendingVerification: true,
  };
}
