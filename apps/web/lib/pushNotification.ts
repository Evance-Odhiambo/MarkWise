/**
 * lib/pushNotification.ts
 *
 * Sends FCM push notifications via the FCM v1 HTTP API.
 * Authenticates with a Google service account from FIREBASE_SERVICE_ACCOUNT env var.
 * If not set, push calls are silently skipped (logged at info level).
 *
 * Android channel routing is automatic: pass `data.type` and the correct
 * channelId is resolved from the CHANNEL_MAP below. Callers may override
 * with an explicit `channelId` in the payload.
 *
 * Stale / unregistered tokens are automatically cleaned up:
 *   - StudentPushToken rows are deleted
 *   - Lecturer.fcmToken is set to null
 */
import { prisma } from '@/lib/prisma';

const FCM_URL = 'https://fcm.googleapis.com/v1/projects/markwise-b4197/messages:send';
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

// Cached OAuth2 access token
let _accessToken: string | null = null;
let _tokenExpiry = 0;

async function getAccessToken(): Promise<string | null> {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;

  if (_accessToken && Date.now() < _tokenExpiry - 60_000) return _accessToken;

  try {
    const { GoogleAuth } = require('google-auth-library') as typeof import('google-auth-library');
    const serviceAccount = JSON.parse(raw);
    const auth = new GoogleAuth({ credentials: serviceAccount, scopes: [FCM_SCOPE] });
    const client = await auth.getClient();
    const tokenResponse = await (client as any).getAccessToken();
    _accessToken = tokenResponse.token as string;
    _tokenExpiry = Date.now() + 3_500_000;
    return _accessToken;
  } catch (err) {
    console.error('[pushNotification] Failed to obtain OAuth2 token:', err);
    return null;
  }
}

// ── Android channel routing ───────────────────────────────────────────────────

const LESSON_TYPES = new Set([
  'LESSON_CONFIRMED', 'LESSON_CANCELLED', 'LESSON_RESCHEDULED', 'LESSON_ONLINE',
  'MERGED_LESSON', 'UNMERGED_LESSON', 'meeting_invite', 'timetable', 'EXTRA_SESSION',
]);
const REMINDER_TYPES = new Set(['status_reminder', 'reminder']);

/** Resolve the Android notification channel for a given notification type. */
export function resolveAndroidChannel(type: string): string {
  if (LESSON_TYPES.has(type)) return 'markwise_lesson';
  if (REMINDER_TYPES.has(type)) return 'markwise_reminder';
  return 'markwise_general';
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PushPayload {
  token: string;
  title: string;
  body: string;
  /** All data values must be strings */
  data?: Record<string, string>;
  /** Override the Android channelId. If omitted, resolved from data.type. */
  channelId?: string;
}

// ── Stale token cleanup ───────────────────────────────────────────────────────

async function purgeStaleFcmToken(token: string): Promise<void> {
  console.warn('[pushNotification] Stale token, purging:', token.slice(-12));
  await Promise.allSettled([
    prisma.studentPushToken.deleteMany({ where: { fcmToken: token } }),
    prisma.lecturer.updateMany({ where: { fcmToken: token }, data: { fcmToken: null } }),
  ]);
}

// ── Core send ─────────────────────────────────────────────────────────────────

/**
 * Send a single FCM v1 push notification.
 * Returns true on success. On 404/UNREGISTERED the token is purged and false is returned.
 */
export async function sendPushNotification(payload: PushPayload): Promise<boolean> {
  const accessToken = await getAccessToken();
  if (!accessToken) {
    console.info('[pushNotification] Firebase not configured — skipping push:', payload.title);
    return false;
  }

  const channelId = payload.channelId ?? resolveAndroidChannel(payload.data?.type ?? '');

  try {
    const res = await fetch(FCM_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          token: payload.token,
          notification: {
            title: payload.title,
            body: payload.body,
          },
          data: payload.data ?? {},
          android: {
            priority: 'high',
            notification: {
              channel_id: channelId,
              sound: 'default',
            },
          },
          apns: {
            headers: { 'apns-priority': '10' },
            payload: { aps: { sound: 'default' } },
          },
        },
      }),
    });

    if (res.ok) return true;

    const errorBody = await res.json().catch(() => ({})) as any;
    const status = errorBody?.error?.status as string | undefined;

    if (res.status === 404 || status === 'UNREGISTERED' || status === 'NOT_FOUND') {
      await purgeStaleFcmToken(payload.token);
    } else {
      console.error('[pushNotification] FCM error', res.status, JSON.stringify(errorBody));
    }
    return false;
  } catch (err: any) {
    console.error('[pushNotification] Fetch failed:', err?.message ?? err);
    return false;
  }
}

/**
 * Send push notifications to multiple tokens concurrently.
 * All results are settled; individual failures are logged but do not throw.
 */
export async function sendPushNotificationBatch(payloads: PushPayload[]): Promise<void> {
  if (payloads.length === 0) return;
  await Promise.allSettled(payloads.map(sendPushNotification));
}

// ── Payload builders ──────────────────────────────────────────────────────────

/**
 * Look up all FCM tokens for a set of studentIds and build PushPayload objects.
 */
export async function buildPayloadsForStudents(
  studentIds: string[],
  message: Omit<PushPayload, 'token'>,
): Promise<PushPayload[]> {
  if (studentIds.length === 0) return [];
  const rows = await prisma.studentPushToken.findMany({
    where: { studentId: { in: studentIds } },
    select: { fcmToken: true },
  });
  return rows.map((r) => ({ token: r.fcmToken, ...message }));
}

/**
 * Like buildPayloadsForStudents but injects a per-student `notificationId`
 * (from the user_notifications table) into each payload's data block.
 * The mobile app uses this as its local SQLite dedup key so that an FCM-
 * delivered notification and the same row fetched from GET /notifications/inbox
 * are recognised as the same entry and not duplicated on-screen.
 */
export async function buildPayloadsForStudentsWithNotifId(
  studentIds: string[],
  message: Omit<PushPayload, 'token'>,
  notifIds: Map<string, string>,
): Promise<PushPayload[]> {
  if (studentIds.length === 0) return [];
  const rows = await prisma.studentPushToken.findMany({
    where: { studentId: { in: studentIds } },
    select: { fcmToken: true, studentId: true },
  });
  return rows.map((r) => ({
    token: r.fcmToken,
    ...message,
    data: {
      ...message.data,
      notificationId: notifIds.get(r.studentId) ?? '',
    },
  }));
}

/**
 * Look up the FCM token for a single lecturer and build a PushPayload.
 * Returns null if the lecturer has no token registered.
 */
export async function buildPayloadForLecturer(
  lecturerId: string,
  message: Omit<PushPayload, 'token'>,
): Promise<PushPayload | null> {
  const row = await prisma.lecturer.findUnique({
    where: { id: lecturerId },
    select: { fcmToken: true },
  });
  if (!row?.fcmToken) return null;
  return { token: row.fcmToken, ...message };
}
