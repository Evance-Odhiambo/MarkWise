/**
 * qrSigning.js — HMAC-signed QR payload encoding for MarkWise attendance.
 *
 * Replaces the previous XOR+base64 obfuscation (MWQR1: legacy prefix, hard-rejected).
 *
 * Legacy security model (MWQR1 — rejected):
 *   XOR with hardcoded 16-byte key → extractable from APK → trivial to forge QR codes
 *
 * Current security model (MWQR0x01 — production):
 *   HMAC-SHA256 with a per-session key stored in hardware Keychain (lecturer only).
 *   The "0x01" in the prefix mirrors the BLE beacon version byte, making the version
 *   marker consistent across all MarkWise wireless attendance methods (v1 of the app).
 *   Students cannot generate valid QR content — only the lecturer device can.
 *   Backend verifies the HMAC at sync time.
 *
 * Security properties:
 *   ✓ Time-bound       — counter changes every QR_WINDOW_SECONDS (3 s)
 *   ✓ Session-bound    — payload contains sessionNonce, unitId, roomId
 *   ✓ Unforgeable      — HMAC requires sessionKey, which is never on student devices
 *   ✓ Replay-resistant — counter + session window check rejects stale tokens
 *   ✓ Foreign-scanner safe — decoded to opaque Base64, meaningless and unusable
 */

import {
  encodePayload,
  encodeQR,
  decodeQR,
  deriveCounter,
  QR_WINDOW_SECONDS,
} from './sessionCrypto';

export const QR_PREFIX_V1     = 'MWQR0x01:'; // current: HMAC-signed, MarkWise v1
export const QR_PREFIX_LEGACY = 'MWQR1:';    // legacy: XOR obfuscation (explicitly rejected)

// ─── Lecturer side ────────────────────────────────────────────────────────────

/**
 * Generates the QR string for the current rotation window (lecturer device only).
 * Call this every QR_ROTATION_MS (3 s) to update the displayed QR code.
 *
 * @param session {
 *   unitId:          number,  // uint16 backend numeric unit ID
 *   roomId:          number,  // uint16 backend numeric room ID
 *   sessionStart:    number,  // Unix epoch SECONDS
 *   sessionDuration: number,  // seconds
 *   sessionNonce:    number,  // uint32 from generateSessionNonce()
 * }
 * @param sessionKey  — hex key string from sessionKeyStore.getSessionKey(sessionId)
 * @param atMs        — current epoch ms (default: Date.now())
 * @returns           — prefixed Base64 string to pass to the QR generator component
 */
export function encodeQrPayload(session, sessionKey, atMs = Date.now()) {
  const encoded = encodePayload(session);
  const counter = deriveCounter(session.sessionStart, QR_WINDOW_SECONDS, atMs);
  return QR_PREFIX_V1 + encodeQR(encoded, sessionKey, counter);
}

// ─── Student side ─────────────────────────────────────────────────────────────

/**
 * Decodes a scanned QR string into its constituent parts (student device).
 *
 * Accepts only the MWQR0x01 format. Legacy MWQR1 QR codes are explicitly rejected
 * so that old-format codes from before the security upgrade cannot be scanned.
 * If the prefix is absent the raw Base64 is tried directly (camera-only path).
 *
 * @param raw — raw string from the QR camera
 * @returns   { encodedPayload, payload, counter, token } | null
 *
 * The returned `token` (64-char hex HMAC) is stored in the attendance record's
 * raw_payload field and forwarded to the backend at sync for HMAC verification.
 */
export function decodeQrPayload(raw) {
  if (typeof raw !== 'string') return null;
  if (raw.startsWith(QR_PREFIX_LEGACY)) return null; // hard reject — old insecure format
  const base64 = raw.startsWith(QR_PREFIX_V1) ? raw.slice(QR_PREFIX_V1.length) : raw;
  return decodeQR(base64);
}
