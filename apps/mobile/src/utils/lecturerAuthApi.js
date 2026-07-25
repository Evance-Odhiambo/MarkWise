// Error message resolver for API responses
const resolveErrorMessage = (payload, fallback) => {
  if (typeof payload?.message === 'string' && payload.message.trim()) {
    return payload.message;
  }
  if (typeof payload?.error === 'string' && payload.error.trim()) {
    return payload.error;
  }
  return fallback;
};
// Fetch institutions for lecturer sign up
import { resolveApiBaseUrl } from './unitsApi';
import { getLecturerSession } from './authSession';



export async function fetchInstitutions() {
  const baseUrl = resolveApiBaseUrl();
  const response = await fetch(`${baseUrl}/api/institutions`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(resolveErrorMessage(payload, `Failed to fetch institutions: ${response.status}`));
  }
  if (!payload || !Array.isArray(payload.data)) {
    throw new Error('Institutions response is not a valid array in data property');
  }
  return payload.data;
}


export async function registerLecturerPushToken() {
  const { NativeModules } = require('react-native');
  if (!NativeModules.RNFBAppModule) return;
  try {
    const {
      getMessaging,
      requestPermission,
      getToken,
      AuthorizationStatus,
    } = require('@react-native-firebase/messaging');
    const m = getMessaging();
    const status = await requestPermission(m);
    if (status !== AuthorizationStatus.AUTHORIZED && status !== AuthorizationStatus.PROVISIONAL) return;
    const fcmToken = await getToken(m);
    if (!fcmToken) return;
    const session = await getLecturerSession();
    if (!session?.token) return;
    const baseUrl = resolveApiBaseUrl();
    await fetch(`${baseUrl}/api/lecturer/push-token`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fcmToken }),
    });
  } catch (_) {}
}

export const signUpLecturerAccount = async ({ fullName, email, phoneNumber, institutionId, campusId, password }) => {
  const baseUrl = resolveApiBaseUrl();
  const body = {
    fullName: String(fullName || '').trim(),
    email: String(email || '').trim().toLowerCase(),
    phoneNumber: String(phoneNumber || '').trim(),
    institutionId: String(institutionId || '').trim(),
    campusId: String(campusId || '').trim(),
    password,
  };

  const response = await fetch(`${baseUrl}/api/auth/lecturer/signup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(resolveErrorMessage(payload, `Lecturer sign up failed: ${response.status}`));
  }
  return payload;
};

export const signInLecturerAccount = async ({ emailOrPhoneNumber, password }) => {
  const baseUrl = resolveApiBaseUrl();
  const requestBody = JSON.stringify({
    emailOrPhoneNumber: String(emailOrPhoneNumber || '').trim(),
    password,
  });

  const response = await fetch(`${baseUrl}/api/auth/lecturer/signin`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: requestBody,
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(resolveErrorMessage(payload, `Lecturer sign in failed: ${response.status}`));
  }
  return payload;
};
