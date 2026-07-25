/**
 * sessionKeyStore.js — Hardware-backed session key storage for MarkWise.
 *
 * LECTURER DEVICE ONLY.
 * Student devices never store session keys — they submit received tokens
 * to the backend for cryptographic verification at sync time.
 *
 * Each attendance session has a unique key derived by the server at session
 * creation and returned in the API response. That key is stored here.
 *
 * Storage:
 *   Android — Android Keystore (TEE / StrongBox hardware enclave when available)
 *   iOS     — Secure Enclave via Keychain, accessible only when device is unlocked
 *
 * Threat model:
 *   • Even if an APK is fully decompiled, no key material is recoverable from code.
 *   • Past session keys cannot be used to forge future sessions (each is unique).
 *   • Keys are cleared when the session ends and on lecturer sign-out.
 */

import * as Keychain from 'react-native-keychain';

const SERVICE_PREFIX = 'markwise.sk.'; // sk = session key

const KEYCHAIN_OPTIONS = {
  accessible:    Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  securityLevel: Keychain.SECURITY_LEVEL.SECURE_HARDWARE,
};

// ─── Store ────────────────────────────────────────────────────────────────────

/**
 * Persists a session key in the platform hardware-backed Keychain.
 * Call immediately after the backend returns the session key at session creation.
 *
 * @param sessionId — unique string session identifier (from backend response)
 * @param key       — hex session key string returned by the backend
 * @throws          — rethrows Keychain errors; caller should surface to the lecturer
 */
export async function storeSessionKey(sessionId, key) {
  await Keychain.setGenericPassword(
    sessionId,
    key,
    { service: `${SERVICE_PREFIX}${sessionId}`, ...KEYCHAIN_OPTIONS },
  );
}

// ─── Retrieve ─────────────────────────────────────────────────────────────────

/**
 * Retrieves a session key from Keychain.
 * Returns null if the key has never been stored or has already been cleared.
 *
 * @param sessionId — the session ID used when storing
 * @returns hex key string | null
 */
export async function getSessionKey(sessionId) {
  try {
    const creds = await Keychain.getGenericPassword({
      service: `${SERVICE_PREFIX}${sessionId}`,
    });
    return creds ? creds.password : null;
  } catch {
    return null;
  }
}

// ─── Clear ────────────────────────────────────────────────────────────────────

/**
 * Removes a single session key from Keychain after the session ends.
 * Minimises the exposure window: a compromised key is useless once cleared.
 *
 * @param sessionId — session ID to remove
 */
export async function clearSessionKey(sessionId) {
  try {
    await Keychain.resetGenericPassword({
      service: `${SERVICE_PREFIX}${sessionId}`,
    });
  } catch {
    // Ignore — key may already be absent
  }
}

/**
 * Removes session keys for a list of session IDs in parallel.
 * Call on lecturer sign-out, passing all session IDs from SQLite conducted_sessions.
 *
 * @param sessionIds — array of session ID strings
 */
export async function clearSessionKeys(sessionIds = []) {
  if (!sessionIds.length) return;
  await Promise.allSettled(sessionIds.map(id => clearSessionKey(id)));
}
