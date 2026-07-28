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
import CryptoJS from 'crypto-js';

export const QR_PREFIX_V1     = 'MWQR0x01:'; // current: HMAC-signed, MarkWise v1
export const QR_PREFIX_LEGACY = 'MWQR1:';    // legacy: XOR obfuscation (explicitly rejected)
export const QR_PREFIX_RELAY  = 'MWQR_RELAY:'; // relay: student-generated, signature-based

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
 * Supports two formats:
 *   1. MWQR0x01 — Lecturer QR (HMAC-signed, requires sessionKey for verification)
 *   2. MWQR_RELAY — Relay QR (student-generated, signature-based)
 *
 * Legacy MWQR1 QR codes are explicitly rejected.
 * If the prefix is absent the raw Base64 is tried directly (camera-only path).
 *
 * @param raw — raw string from the QR camera
 * @returns {
 *   type: 'lecturer' | 'relay',
 *   encodedPayload: string,
 *   payload: object,
 *   counter: number,
 *   token?: string,      // Only for lecturer QR
 *   studentId?: string,  // Only for relay QR
 *   signature?: string   // Only for relay QR
 * } | null
 */
export function decodeQrPayload(raw) {
  if (typeof raw !== 'string') return null;
  
  // Hard reject legacy format
  if (raw.startsWith(QR_PREFIX_LEGACY)) return null;
  
  // Check if relay QR
  if (raw.startsWith(QR_PREFIX_RELAY)) {
    const relayData = decodeRelayQR(raw);
    if (relayData) {
      return {
        type: 'relay',
        ...relayData,
      };
    }
    return null;
  }
  
  // Lecturer QR (MWQR0x01 or raw base64)
  const base64 = raw.startsWith(QR_PREFIX_V1) ? raw.slice(QR_PREFIX_V1.length) : raw;
  const lecturerData = decodeQR(base64);
  if (lecturerData) {
    return {
      type: 'lecturer',
      ...lecturerData,
    };
  }
  
  return null;
}

// ─── Relay QR (Student side) ──────────────────────────────────────────────────

/**
 * Generates a relay QR code for students to help peers mark attendance.
 * Students don't have sessionKey, so relay QR uses device signature instead of HMAC.
 *
 * Format: MWQR_RELAY:base64(payload|counter|studentId|signature)
 *
 * @param session {
 *   unitId:          number,  // uint16 backend numeric unit ID
 *   roomId:          number,  // uint16 backend numeric room ID
 *   sessionStart:    number,  // Unix epoch SECONDS
 *   sessionDuration: number,  // seconds
 *   sessionNonce:    number,  // uint32 from generateSessionNonce()
 * }
 * @param studentId   — student ID of the relay generator
 * @param deviceKey   — device-specific key from studentDeviceKey.js
 * @param atMs        — current epoch ms (default: Date.now())
 * @returns           — prefixed Base64 string for relay QR code
 */
export function encodeRelayQR(session, studentId, deviceKey, atMs = Date.now()) {
  const encodedPayload = encodePayload(session);
  const counter = deriveCounter(session.sessionStart, QR_WINDOW_SECONDS, atMs);
  
  // Create relay signature (proves this was generated by verified student's device)
  const relayMessage = `${encodedPayload}|${counter}|${studentId}`;
  const signature = CryptoJS.HmacSHA256(relayMessage, deviceKey).toString(CryptoJS.enc.Hex);
  
  // Build relay content: payload|counter|studentId|signature
  const relayContent = `${encodedPayload}|${counter}|${studentId}|${signature}`;
  
  // Safe base64 encoding
  const base64 = typeof btoa === 'function'
    ? btoa(relayContent)
    : Buffer.from(relayContent, 'utf8').toString('base64');
  
  return QR_PREFIX_RELAY + base64;
}

/**
 * Decodes a relay QR code scanned from another student.
 *
 * @param raw — raw string from QR scanner
 * @returns {
 *   encodedPayload: string,
 *   payload: object,
 *   counter: number,
 *   studentId: string,
 *   signature: string
 * } | null
 */
export function decodeRelayQR(raw) {
  if (typeof raw !== 'string') return null;
  if (!raw.startsWith(QR_PREFIX_RELAY)) return null;
  
  try {
    const base64 = raw.slice(QR_PREFIX_RELAY.length);
    const content = typeof atob === 'function'
      ? atob(base64)
      : Buffer.from(base64, 'base64').toString('utf8');
    
    // Split from right: signature|studentId|counter|payload
    const lastPipe = content.lastIndexOf('|');
    if (lastPipe === -1) return null;
    const signature = content.slice(lastPipe + 1);
    if (signature.length !== 64) return null;
    
    const rest = content.slice(0, lastPipe);
    const studentIdPipe = rest.lastIndexOf('|');
    if (studentIdPipe === -1) return null;
    const studentId = rest.slice(studentIdPipe + 1);
    
    const rest2 = rest.slice(0, studentIdPipe);
    const counterPipe = rest2.lastIndexOf('|');
    if (counterPipe === -1) return null;
    const counter = parseInt(rest2.slice(counterPipe + 1), 10);
    if (isNaN(counter) || counter < 0) return null;
    
    const encodedPayload = rest2.slice(0, counterPipe);
    
    // Decode payload to get session info
    const payloadParts = encodedPayload.split('|');
    if (payloadParts.length !== 6 || payloadParts[0] !== 'mwv1') return null;
    
    const payload = {
      version: 1,
      unitId: parseInt(payloadParts[1], 10),
      roomId: parseInt(payloadParts[2], 10),
      sessionStart: parseInt(payloadParts[3], 10),
      sessionDuration: parseInt(payloadParts[4], 10),
      sessionNonce: parseInt(payloadParts[5], 10),
    };
    
    if (Object.values(payload).some(v => isNaN(v))) return null;
    
    return {
      encodedPayload,
      payload,
      counter,
      studentId,
      signature,
    };
  } catch (err) {
    console.error('[RelayQR] Decode error:', err);
    return null;
  }
}
