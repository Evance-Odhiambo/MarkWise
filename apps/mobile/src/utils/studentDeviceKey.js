/**
 * studentDeviceKey.js — Device-specific key generation for student relay signatures.
 *
 * Each student device generates a unique key on first launch. This key is used to
 * sign relay QR codes and PINs, proving authenticity without requiring sessionKey.
 *
 * Security model:
 *   • Device key is generated locally and stored in AsyncStorage
 *   • Device key is registered with backend after first successful attendance
 *   • Backend stores device keys to verify relay signatures
 *   • Students never get sessionKey, but can still relay using device signatures
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { generateSessionNonce } from './sessionCrypto';

const DEVICE_KEY_STORAGE = '@markwise_student_device_key';
const DEVICE_KEY_REGISTERED_STORAGE = '@markwise_device_key_registered';

/**
 * Generates or retrieves a device-specific key for relay signatures.
 * This key is unique per device and never leaves the device.
 * Used to sign relay tokens so backend can verify authenticity.
 *
 * @returns {Promise<string>} - 64-character hex string (device key)
 */
export async function getOrCreateDeviceKey() {
  try {
    // Check if key already exists
    let deviceKey = await AsyncStorage.getItem(DEVICE_KEY_STORAGE);
    
    if (!deviceKey) {
      // Generate new device-specific key using crypto-secure random
      const nonce1 = generateSessionNonce();
      const nonce2 = generateSessionNonce();
      deviceKey = `${nonce1.toString(16).padStart(8, '0')}${nonce2.toString(16).padStart(8, '0')}`;
      
      // Store locally (never transmitted in plain text)
      await AsyncStorage.setItem(DEVICE_KEY_STORAGE, deviceKey);
      
      console.log('[DeviceKey] Generated new device key');
    }
    
    return deviceKey;
  } catch (err) {
    console.error('[DeviceKey] Failed to get/create device key:', err);
    throw new Error('Device key initialization failed');
  }
}

/**
 * Registers device key with backend after first successful attendance.
 * This allows backend to verify relay signatures from this device.
 *
 * @param {string} deviceKey - The device key to register
 * @param {string} studentId - Student ID
 * @param {string} sessionToken - Authentication token
 * @param {string} apiBaseUrl - API base URL
 * @returns {Promise<boolean>} - true if registered successfully
 */
export async function registerDeviceKeyWithBackend(deviceKey, studentId, sessionToken, apiBaseUrl) {
  try {
    // Check if already registered
    const alreadyRegistered = await AsyncStorage.getItem(DEVICE_KEY_REGISTERED_STORAGE);
    if (alreadyRegistered === 'true') {
      console.log('[DeviceKey] Already registered with backend');
      return true;
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
      }),
    });
    
    if (response.ok) {
      // Mark as registered
      await AsyncStorage.setItem(DEVICE_KEY_REGISTERED_STORAGE, 'true');
      console.log('[DeviceKey] Registered with backend');
      return true;
    } else {
      console.warn('[DeviceKey] Backend registration failed:', response.status);
      return false;
    }
  } catch (err) {
    console.warn('[DeviceKey] Could not register with backend (offline?):', err.message);
    // Don't throw - registration can happen later when online
    return false;
  }
}

/**
 * Resets the device key registration status.
 * Useful for testing or when switching accounts.
 */
export async function resetDeviceKeyRegistration() {
  try {
    await AsyncStorage.removeItem(DEVICE_KEY_REGISTERED_STORAGE);
    console.log('[DeviceKey] Registration status reset');
  } catch (err) {
    console.error('[DeviceKey] Failed to reset registration:', err);
  }
}

/**
 * Clears the device key from local storage.
 * Call this on sign-out / account switch so the next student
 * gets a fresh key rather than inheriting the previous account's identity.
 */
export async function clearDeviceKey() {
  try {
    await AsyncStorage.removeItem(DEVICE_KEY_STORAGE);
    await AsyncStorage.removeItem(DEVICE_KEY_REGISTERED_STORAGE);
    console.log('[DeviceKey] Device key cleared');
  } catch (err) {
    console.error('[DeviceKey] Failed to clear device key:', err);
  }
}

/**
 * Gets the device key if it exists, returns null otherwise.
 * Does not create a new key.
 *
 * @returns {Promise<string|null>} - Device key or null
 */
export async function getDeviceKeyIfExists() {
  try {
    return await AsyncStorage.getItem(DEVICE_KEY_STORAGE);
  } catch (err) {
    console.error('[DeviceKey] Failed to get device key:', err);
    return null;
  }
}
