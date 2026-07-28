/**
 * manualAttendanceToken.js — Session-key-derived PIN for manual attendance.
 *
 * Previous security model:
 *   PIN = HMAC(hardcoded_secret, unitCode|room|sessionAnchor|rotationWindow)
 *   The hardcoded secret 'MARKWISE_MANUAL_ATTENDANCE_V1' was embedded in the APK.
 *   Any attacker who decompiled the APK could generate valid PINs for any session
 *   at any time, past or future, without ever being in the room.
 *
 * New security model:
 *   PIN = computePIN(encodedPayload, sessionKey, counter)
 *   where sessionKey is unique per session, lives only in the lecturer's Keychain,
 *   and is never shipped in the app binary or stored on student devices.
 *
 * Implications:
 *   Lecturer side — generateManualAttendanceToken() requires the session object
 *                   (numeric IDs) and the sessionKey from Keychain.
 *   Student side  — validateManualAttendanceToken() performs format + active-session
 *                   checks only. The PIN value itself is verified by the backend at
 *                   sync time using the pinCounter forwarded in the record.
 *
 * Exported names are preserved to minimise call-site changes.
 * Parameters for generateManualAttendanceToken have changed — callers must supply
 * { session, sessionKey } instead of { unitCode, lectureRoom, sessionStart }.
 */

import {
  encodePayload,
  computePIN,
  deriveCounter,
  deriveAbsoluteCounter,
  PIN_WINDOW_SECONDS,
  PIN_LENGTH,
} from './sessionCrypto';

// ─── Input normalisation (unchanged — used by UI components) ──────────────────

/**
 * Strips all non-digit characters from a raw PIN input string.
 * Used by UI text inputs to clean user-typed values before validation.
 *
 * @param tokenValue — raw string from the keyboard
 * @returns          — digit-only string (may be shorter than PIN_LENGTH)
 */
export const normalizeManualAttendanceTokenInput = (tokenValue) =>
  String(tokenValue ?? '').trim().replace(/\D/g, '');

// ─── Lecturer side — generation ───────────────────────────────────────────────

/**
 * Generates the 6-digit PIN for the current 30-second window.
 * Must only be called on the lecturer device where sessionKey is available.
 *
 * Example:
 *   const key = await getSessionKey(sessionId);
 *   const pin = generateManualAttendanceToken({ session, sessionKey: key });
 *
 * @param session {
 *   unitId:          number,  // uint16 numeric unit ID from backend
 *   roomId:          number,  // uint16 numeric room ID from backend
 *   sessionStart:    number,  // Unix epoch SECONDS
 *   sessionDuration: number,  // seconds
 *   sessionNonce:    number,  // uint32 from generateSessionNonce()
 * }
 * @param sessionKey — hex key string from sessionKeyStore.getSessionKey(sessionId)
 * @param atMs       — current epoch ms (default: Date.now())
 * @returns          — 6-digit string e.g. "047291", or '' if any param is missing
 */
export const generateManualAttendanceToken = ({ session, sessionKey, atMs = Date.now() }) => {
  if (!session || !sessionKey) return '';
  const { unitId, roomId, sessionStart, sessionDuration, sessionNonce } = session;
  if (
    unitId == null || roomId == null ||
    sessionStart == null || sessionDuration == null || sessionNonce == null
  ) return '';
  const encoded = encodePayload({ unitId, roomId, sessionStart, sessionDuration, sessionNonce });
  const counter = deriveAbsoluteCounter(sessionStart, PIN_WINDOW_SECONDS, atMs);
  return computePIN(encoded, sessionKey, counter);
};

// ─── Student side — validation (format + session check only) ──────────────────

/**
 * Validates a manually entered PIN on the student device.
 *
 * Students hold no session key, so only these checks can be done locally:
 *   1. Format — exactly 6 digits
 *   2. Session presence — a cached session exists for this unit/room
 *   3. Time window — the session is currently within its active period
 *
 * The actual PIN value (is it correct?) is verified by the backend at sync time.
 * The pinCounter is included in the record so the backend can reconstruct the
 * expected PIN for that exact 30-second window.
 *
 * @param token         — raw string from the student's keyboard
 * @param cachedSession — session object from SQLite {
 *                          sessionStart: number (epoch SECONDS),
 *                          sessionDuration: number (seconds),
 *                          sessionNonce: number,
 *                       }
 * @param atMs          — current epoch ms (default: Date.now())
 * @returns {
 *   isValid:              boolean,
 *   reason?:              string,   // 'format' | 'no_session' | 'expired'
 *   normalizedToken?:     string,   // 6-digit string stored for backend verification
 *   pinCounter?:          number,   // time window index forwarded to backend
 *   pendingVerification?: boolean,  // always true when isValid === true
 * }
 */
export const validateManualAttendanceToken = ({
  token,
  cachedSession,
  atMs = Date.now(),
}) => {
  const normalized = normalizeManualAttendanceTokenInput(token);

  if (normalized.length !== PIN_LENGTH) {
    return { isValid: false, reason: 'format' };
  }

  if (!cachedSession) {
    return { isValid: false, reason: 'no_session' };
  }

  const SKEW_S = 15;
  const nowS   = Math.floor(atMs / 1000);
  const start  = Math.floor(cachedSession.sessionStart);
  const end    = start + Math.max(0, Math.floor(cachedSession.sessionDuration));

  if (nowS < start - SKEW_S || nowS > end + SKEW_S) {
    return { isValid: false, reason: 'expired' };
  }

  const pinCounter = deriveAbsoluteCounter(cachedSession.sessionStart, PIN_WINDOW_SECONDS, atMs);

  return {
    isValid:             true,
    normalizedToken:     normalized,
    pinCounter,
    pendingVerification: true,
  };
};

export default {
  generateManualAttendanceToken,
  validateManualAttendanceToken,
  normalizeManualAttendanceTokenInput,
};
