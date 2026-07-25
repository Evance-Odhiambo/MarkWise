/**
 * sessionCrypto.js — Core cryptographic module for MarkWise attendance security.
 *
 * Security model:
 *   • The server derives a unique session_key per session from its master secret.
 *   • session_key is returned to the LECTURER device only (via authenticated API).
 *   • It is stored in the hardware-backed Keychain (see sessionKeyStore.js).
 *   • STUDENT devices never receive session_key — they submit the raw received
 *     tokens to the backend for cryptographic verification at sync time.
 *   • All three attendance methods (QR, PIN, BLE) derive from one canonical
 *     session payload, so the security guarantee is identical across methods.
 *
 * Token security per method:
 *   QR   — "MWQR0x01:" + Base64(payload|counter|HMAC), rotates every 3 s
 *   PIN  — 6 digits from HMAC, rotates every 30 s
 *   BLE  — 10-byte beacon [nonce16|counter16|unitId16|roomId16|lessonType8|0x01]
 *
 * Upgrade path to Ed25519 (when tweetnacl is available):
 *   Replace computeToken() with nacl.sign.detached(messageBytes, serverPrivateKey)
 *   and export verifyToken() using nacl.sign.detached.verify(msg, sig, serverPublicKey).
 *   Students can then verify offline without any change to the rest of the system.
 *
 * Dependencies (both already in package.json):
 *   crypto-js                   — HMAC-SHA256
 *   react-native-get-random-values — polyfills crypto.getRandomValues in Hermes
 */

import 'react-native-get-random-values';
import CryptoJS from 'crypto-js';
import { Buffer } from 'buffer';
import { QR_ROTATION_MS, MANUAL_TOKEN_ROTATION_MS } from './constants';

// Safe base64 helpers — prefer Hermes globals (RN 0.71+), fall back to Buffer (always available).
// Without this, encodeQR/decodeQR silently return null on older Hermes where btoa/atob are undefined.
const _btoa = typeof btoa === 'function'
  ? btoa
  : (str) => Buffer.from(str, 'binary').toString('base64');
const _atob = typeof atob === 'function'
  ? atob
  : (b64) => Buffer.from(b64, 'base64').toString('binary');

// ─── Versioning ───────────────────────────────────────────────────────────────

const PAYLOAD_VERSION = 1;
const BEACON_VERSION  = 0x01; // 0x01 = MarkWise v1 secure format

// ─── Public constants ─────────────────────────────────────────────────────────

export const QR_WINDOW_SECONDS  = QR_ROTATION_MS / 1000;           // 3 s
export const PIN_WINDOW_SECONDS = MANUAL_TOKEN_ROTATION_MS / 1000; // 30 s
export const BLE_BEACON_LENGTH  = 10;   // bytes — unchanged from existing native module
export const TOKEN_HEX_LENGTH   = 64;   // HMAC-SHA256 hex output
export const PIN_LENGTH         = 6;

// ─── Payload encoding ─────────────────────────────────────────────────────────

/**
 * Encodes session fields into a canonical, deterministic ASCII string.
 * Every token (QR, PIN, BLE verification) is derived from this string.
 *
 * Fields:
 *   unitId          — backend numeric unit ID  (uint16, range 0–7999)
 *   roomId          — backend numeric room ID  (uint16, range 8000–9999)
 *   sessionStart    — Unix epoch SECONDS of session start (uint32)
 *   sessionDuration — session length in seconds (uint16)
 *   sessionNonce    — random uint32 generated at session creation (see generateSessionNonce)
 *
 * @returns ASCII string: "mwv1|<unitId>|<roomId>|<sessionStart>|<sessionDuration>|<sessionNonce>"
 */
export function encodePayload({ unitId, roomId, sessionStart, sessionDuration, sessionNonce }) {
  return [
    `mwv${PAYLOAD_VERSION}`,
    unitId          >>> 0,
    roomId          >>> 0,
    sessionStart    >>> 0,
    sessionDuration >>> 0,
    sessionNonce    >>> 0,
  ].join('|');
}

/**
 * Parses a canonical payload string back to its numeric fields.
 * Returns null if the format is invalid or the version is unsupported.
 *
 * @param encoded — output of encodePayload()
 * @returns { version, unitId, roomId, sessionStart, sessionDuration, sessionNonce } | null
 */
export function decodePayload(encoded) {
  if (typeof encoded !== 'string') return null;
  const parts = encoded.split('|');
  if (parts.length !== 6) return null;
  if (!parts[0].startsWith('mwv')) return null;

  const version = parseInt(parts[0].slice(3), 10);
  if (version !== PAYLOAD_VERSION) return null;

  const [unitId, roomId, sessionStart, sessionDuration, sessionNonce] =
    parts.slice(1).map(p => parseInt(p, 10));

  if ([unitId, roomId, sessionStart, sessionDuration, sessionNonce].some(v => isNaN(v))) {
    return null;
  }
  return { version, unitId, roomId, sessionStart, sessionDuration, sessionNonce };
}

// ─── Counter ─────────────────────────────────────────────────────────────────

/**
 * Derives a monotonically increasing time-window counter.
 * Increments by 1 every windowSeconds. Identical across all devices
 * with reasonably synchronised clocks.
 *
 * Used to make tokens time-bound without re-signing on every rotation.
 *
 * @param sessionStart  — epoch SECONDS (matches payload.sessionStart)
 * @param windowSeconds — QR_WINDOW_SECONDS (3) or PIN_WINDOW_SECONDS (30)
 * @param atMs          — current epoch ms (default: Date.now())
 * @returns             — non-negative integer
 */
export function deriveCounter(sessionStart, windowSeconds, atMs = Date.now()) {
  const elapsedSeconds = Math.floor(atMs / 1000) - Math.floor(sessionStart);
  return Math.max(0, Math.floor(elapsedSeconds / windowSeconds));
}

// ─── Token (lecturer only — requires sessionKey) ──────────────────────────────

/**
 * Computes an HMAC-SHA256 token binding the payload to the current time window.
 * The session_key is unique per session, stored in Keychain on the lecturer device.
 * Student devices never receive or store session_key.
 *
 * @param encodedPayload — output of encodePayload()
 * @param sessionKey     — hex or UTF-8 key string from sessionKeyStore.getSessionKey()
 * @param counter        — output of deriveCounter()
 * @returns              — 64-char lowercase hex string
 */
export function computeToken(encodedPayload, sessionKey, counter) {
  const message = `${encodedPayload}|${counter}`;
  return CryptoJS.HmacSHA256(message, sessionKey).toString(CryptoJS.enc.Hex);
}

// ─── PIN ─────────────────────────────────────────────────────────────────────

/**
 * Derives a 6-digit PIN from an HMAC token.
 * Rotates every PIN_WINDOW_SECONDS (30 s). Unpredictable without sessionKey.
 *
 * Algorithm: take first 4 bytes of HMAC as uint32, modulo 10^6, zero-pad to 6 digits.
 * Collision probability per window: ~1 in 1,000,000 (acceptable for human entry).
 *
 * @param encodedPayload — output of encodePayload()
 * @param sessionKey     — session-specific key from Keychain (lecturer device only)
 * @param counter        — deriveCounter(sessionStart, PIN_WINDOW_SECONDS)
 * @returns              — 6-character digit string, e.g. "047291"
 */
export function computePIN(encodedPayload, sessionKey, counter) {
  const token = computeToken(encodedPayload, sessionKey, counter);
  const n = parseInt(token.substring(0, 8), 16) >>> 0;
  return String(n % (10 ** PIN_LENGTH)).padStart(PIN_LENGTH, '0');
}

// ─── QR code ─────────────────────────────────────────────────────────────────

/**
 * Encodes a QR payload for the current rotation window (lecturer side).
 *
 * Content structure (before Base64):
 *   "<encodedPayload>|<counter>|<hmacToken>"
 * Example:
 *   "mwv1|101|8201|1746432000|3600|987654321|14|abcdef...64chars"
 *
 * Foreign scanners decode to a readable but meaningless string.
 * Attackers who decode it still cannot forge a valid token without sessionKey.
 *
 * @param encodedPayload — output of encodePayload()
 * @param sessionKey     — session-specific HMAC key (Keychain)
 * @param counter        — deriveCounter(sessionStart, QR_WINDOW_SECONDS)
 * @returns              — Base64 string safe for QR generation
 */
export function encodeQR(encodedPayload, sessionKey, counter) {
  const token = computeToken(encodedPayload, sessionKey, counter);
  return _btoa(`${encodedPayload}|${counter}|${token}`);
}

/**
 * Decodes a QR Base64 string (student side — no sessionKey required).
 * Performs structural validation only. Cryptographic verification (HMAC correct?)
 * is deferred to the backend at sync time.
 *
 * Parsing strategy:
 *   Content has the form "<6-part-payload>|<counter>|<64-char-token>".
 *   We split from the right: last segment is token, second-to-last is counter,
 *   everything before that is the encodedPayload (which itself contains pipes).
 *
 * @param base64String — raw Base64 string from QR scanner camera
 * @returns { encodedPayload, payload, counter, token } | null
 */
export function decodeQR(base64String) {
  if (typeof base64String !== 'string') return null;
  try {
    const content = _atob(base64String.trim());

    const lastPipe = content.lastIndexOf('|');
    if (lastPipe === -1) return null;
    const token = content.slice(lastPipe + 1);
    if (token.length !== TOKEN_HEX_LENGTH) return null;

    const rest = content.slice(0, lastPipe);
    const counterPipe = rest.lastIndexOf('|');
    if (counterPipe === -1) return null;
    const counter = parseInt(rest.slice(counterPipe + 1), 10);
    if (isNaN(counter) || counter < 0) return null;

    const encodedPayload = rest.slice(0, counterPipe);
    const payload = decodePayload(encodedPayload);
    if (!payload) return null;

    return { encodedPayload, payload, counter, token };
  } catch {
    return null;
  }
}

// ─── BLE beacon ──────────────────────────────────────────────────────────────

/**
 * Encodes a 10-byte BLE beacon (lecturer side).
 * Preserves the existing 10-byte packet size for native BLEAdvertiserModule
 * compatibility while upgrading the payload to carry roomId for backend verification.
 *
 * Byte layout:
 *   0–1   sessionNonce  uint16 big-endian — lower 16 bits of the session nonce
 *   2–3   counter       uint16 big-endian — time-window counter; proves beacon is live
 *   4–5   unitId        uint16 big-endian — fast session lookup on student side
 *   6–7   roomId        uint16 big-endian — room verification at sync time
 *   8     lessonTypeId  uint8             — 0–8, matches LESSON_TYPES in constants
 *   9     version       0x01              — MarkWise v1 secure beacon marker
 *
 * sessionNonce is truncated to 16 bits to fit within the 10-byte constraint.
 * The full 32-bit nonce is stored in the session record on the backend.
 * Counter rotates every QR_WINDOW_SECONDS (3 s) — same clock as QR/PIN.
 * Version byte 0x01 marks this as the MarkWise v1 secure beacon format.
 *
 * @returns Uint8Array of length 10
 */
export function encodeBLEBeacon({ sessionNonce, counter, unitId, roomId, lessonTypeId = 0 }) {
  const buf  = new Uint8Array(BLE_BEACON_LENGTH);
  const view = new DataView(buf.buffer);
  view.setUint16(0, sessionNonce & 0xFFFF, false);
  view.setUint16(2, counter      & 0xFFFF, false);
  view.setUint16(4, unitId       & 0xFFFF, false);
  view.setUint16(6, roomId       & 0xFFFF, false);
  view.setUint8(8,  lessonTypeId & 0xFF);
  view.setUint8(9,  BEACON_VERSION);
  return buf;
}

/**
 * Decodes a received BLE beacon (student side).
 * Returns null if the byte array is too short or the version byte is not 0x01
 * (which filters out all non-MarkWise-v1 packets automatically).
 *
 * @param bytes — Uint8Array or plain number[] of at least 10 elements
 * @returns { sessionNonce, counter, unitId, roomId, lessonTypeId } | null
 */
export function decodeBLEBeacon(bytes) {
  if (!bytes || bytes.length < BLE_BEACON_LENGTH) return null;
  const arr  = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const view = new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
  if (view.getUint8(9) !== BEACON_VERSION) return null;
  return {
    sessionNonce:  view.getUint16(0, false),
    counter:       view.getUint16(2, false),
    unitId:        view.getUint16(4, false),
    roomId:        view.getUint16(6, false),
    lessonTypeId:  view.getUint8(8),
  };
}

// ─── Nonce generation ─────────────────────────────────────────────────────────

/**
 * Generates a cryptographically secure random uint32 session nonce.
 * Called once at session creation on the lecturer device.
 * react-native-get-random-values polyfills crypto.getRandomValues in Hermes.
 *
 * @returns unsigned 32-bit integer in range [0, 4294967295]
 */
export function generateSessionNonce() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] >>> 0;
}
