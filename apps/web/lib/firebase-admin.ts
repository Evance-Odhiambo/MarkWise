/**
 * lib/firebase-admin.ts
 *
 * Lazy singleton initialization of the Firebase Admin SDK.
 * Returns null (and logs a warning) when FIREBASE_SERVICE_ACCOUNT is not set,
 * so all callers can skip push silently in non-prod environments.
 */
import admin from 'firebase-admin';
import type { App } from 'firebase-admin/app';

let _app: App | null = null;

export function getFirebaseAdminApp(): App | null {
  if (_app) return _app;

  // Already initialized by another module (e.g. Next.js hot reload)
  if (admin.apps.length > 0) {
    _app = admin.apps[0]!;
    return _app;
  }

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    console.warn('[firebase-admin] FIREBASE_SERVICE_ACCOUNT not set — push notifications disabled');
    return null;
  }

  try {
    const serviceAccount = JSON.parse(raw);
    _app = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    return _app;
  } catch (err) {
    console.error('[firebase-admin] Failed to initialize:', err);
    return null;
  }
}
