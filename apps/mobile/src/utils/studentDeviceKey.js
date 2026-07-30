/* global crypto */

/**
 * studentDeviceKey.js — Device-specific key generation for student relay signatures.
 *
 * Security model:
 *   • Device key is generated locally using 256-bit CSPRNG and stored in Keychain
 *   • Device key is registered with backend after first successful attendance
 *   • Backend stores device keys to verify relay signatures
 *   • Students never get sessionKey, but can still relay using device signatures
 *
 * Storage:
 *   Android — Android Keystore (TEE / StrongBox hardware enclave when available)
 *   iOS     — Secure Enclave via Keychain, accessible only when device is unlocked
 *
 * Strengthened design:
 *   • 256-bit key (64 hex chars) instead of legacy 64-bit dual-nonce concat
 *   • Explicit format validation on read/write
 *   • Key integrity verified on load; regenerated if corrupted
 *   • Registration failure is retried on next successful sync
 *   • Stored in hardware-backed Keychain, not AsyncStorage
 */

import * as Keychain from 'react-native-keychain';

const DEVICE_KEY_SERVICE = 'markwise.student.device_key';
const DEVICE_KEY_REGISTERED_SERVICE = 'markwise.student.device_key_registered';
const DEVICE_KEY_VERSION = 2; // bump when changing key format or length

const HEX_RE = /^[0-9a-f]+$/;
const EXPECTED_KEY_LENGTH = 64; // 256-bit key = 64 hex chars

const KEYCHAIN_OPTIONS = {
  accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  securityLevel: Keychain.SECURITY_LEVEL.SECURE_HARDWARE,
};

function isValidHexKey(value) {
  return typeof value === 'string' && value.length === EXPECTED_KEY_LENGTH && HEX_RE.test(value);
}

function generateDeviceKeyBytes() {
  const buf = new Uint8Array(32); // 256 bits
  crypto.getRandomValues(buf);
  return buf;
}

function bytesToHex(buf) {
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Generates or retrieves a device-specific key for relay signatures.
 * This key is unique per device and stored in hardware-backed Keychain.
 * Used to sign relay tokens so backend can verify authenticity.
 *
 * @returns {Promise<string>} - 64-character hex string (256-bit device key)
 */
export async function getOrCreateDeviceKey() {
  try {
    const creds = await Keychain.getGenericPassword({ service: DEVICE_KEY_SERVICE });
    if (creds?.password && isValidHexKey(creds.password)) {
      console.log('[DeviceKey] Reusing existing key from Keychain');
      return creds.password;
    }
  } catch (err) {
    console.warn('[DeviceKey] Keychain read failed:', err.message);
  }

  const bytes = generateDeviceKeyBytes();
  const deviceKey = bytesToHex(bytes);

  try {
    await Keychain.setGenericPassword('device_key', deviceKey, {
      service: DEVICE_KEY_SERVICE,
      ...KEYCHAIN_OPTIONS,
    });
    console.log('[DeviceKey] Generated and stored new 256-bit device key in Keychain');
  } catch (err) {
    console.error('[DeviceKey] Failed to store in Keychain:', err);
    throw new Error('Device key storage failed');
  }

  return deviceKey;
}

/**
 * Registers device key with backend after first successful attendance.
 * Retries registration on subsequent calls if a prior attempt failed.
 *
 * @param {string} deviceKey - The device key to register
 * @param {string} studentId - Student ID
 * @param {string} sessionToken - Authentication token
 * @param {string} apiBaseUrl - API base URL
 * @returns {Promise<boolean>} - true if registered successfully
 */
export async function registerDeviceKeyWithBackend(deviceKey, studentId, sessionToken, apiBaseUrl) {
  try {
    if (!isValidHexKey(deviceKey)) {
      console.warn('[DeviceKey] Refusing to register invalid device key');
      return false;
    }

    const response = await fetch(`${apiBaseUrl}/api/student/register-device`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({
        deviceKey,
        studentId,
        keyVersion: DEVICE_KEY_VERSION,
      }),
    });

    if (response.ok) {
      await Keychain.setGenericPassword('registered', 'true', {
        service: DEVICE_KEY_REGISTERED_SERVICE,
        ...KEYCHAIN_OPTIONS,
      }).catch(() => {});
      console.log('[DeviceKey] Registered with backend');
      return true;
    }

    const text = await response.text().catch(() => '');
    console.warn('[DeviceKey] Backend registration failed:', response.status, text);
    return false;
  } catch (err) {
    console.warn('[DeviceKey] Could not register with backend (offline?):', err.message);
    return false;
  }
}

/**
 * Returns whether this device has been registered with the backend.
 */
export async function isDeviceKeyRegistered() {
  try {
    const creds = await Keychain.getGenericPassword({ service: DEVICE_KEY_REGISTERED_SERVICE });
    return creds?.password === 'true';
  } catch {
    return false;
  }
}

/**
 * Resets the device key registration status.
 * Useful for testing or when switching accounts.
 */
export async function resetDeviceKeyRegistration() {
  try {
    await Keychain.resetGenericPassword({ service: DEVICE_KEY_REGISTERED_SERVICE });
    console.log('[DeviceKey] Registration status reset');
  } catch (err) {
    console.error('[DeviceKey] Failed to reset registration:', err);
  }
}

/**
 * Clears the device key from Keychain.
 * Call this on sign-out / account switch so the next student
 * gets a fresh key rather than inheriting the previous account's identity.
 */
export async function clearDeviceKey() {
  try {
    await Keychain.resetGenericPassword({ service: DEVICE_KEY_SERVICE });
    await Keychain.resetGenericPassword({ service: DEVICE_KEY_REGISTERED_SERVICE });
    console.log('[DeviceKey] Device key cleared');
  } catch (err) {
    console.error('[DeviceKey] Failed to clear device key:', err);
  }
}

/**
 * Gets the device key if it exists and is valid, returns null otherwise.
 * Does not create a new key.
 *
 * @returns {Promise<string|null>} - Device key or null
 */
export async function getDeviceKeyIfExists() {
  try {
    const creds = await Keychain.getGenericPassword({ service: DEVICE_KEY_SERVICE });
    return isValidHexKey(creds?.password) ? creds.password : null;
  } catch (err) {
    console.error('[DeviceKey] Failed to get device key:', err);
    return null;
  }
}
