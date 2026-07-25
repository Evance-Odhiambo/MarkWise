/**
 * lib/fcm.ts
 *
 * Firebase Admin SDK FCM dispatch helper.
 *
 * Usage:
 *   sendFcmToTokens(tokens, 'LESSON_CANCELLED', 'Title', 'Body', { unitCode: 'CS101' })
 *     .catch(err => console.error('[FCM]', err));  // always fire-and-forget
 *
 * Channel routing is automatic from the type string.
 * Invalid/unregistered tokens are purged from the DB automatically.
 */
import { getMessaging } from 'firebase-admin/messaging';
import { getFirebaseAdminApp } from './firebase-admin';
import { prisma } from './prisma';

// ── Android channel routing ───────────────────────────────────────────────────

const LESSON_TYPES = new Set([
  'LESSON_CANCELLED', 'LESSON_RESCHEDULED', 'LESSON_ONLINE',
  'MERGED_LESSON', 'UNMERGED_LESSON', 'timetable', 'EXTRA_SESSION',
]);
const REMINDER_TYPES = new Set(['reminder', 'assignment', 'deadline']);

export function getChannelForType(type: string): string {
  if (LESSON_TYPES.has(type)) return 'markwise_lesson';
  if (REMINDER_TYPES.has(type)) return 'markwise_reminder';
  return 'markwise_general';
}

// ── Stale token cleanup ───────────────────────────────────────────────────────

async function purgeStaleTokens(tokens: string[]): Promise<void> {
  if (tokens.length === 0) return;
  await Promise.allSettled([
    prisma.studentPushToken.deleteMany({ where: { fcmToken: { in: tokens } } }),
    prisma.lecturer.updateMany({
      where: { fcmToken: { in: tokens } },
      data: { fcmToken: null },
    }),
  ]);
}

// ── Core multicast sender ─────────────────────────────────────────────────────

const MULTICAST_CHUNK = 500; // FCM hard limit per sendEachForMulticast call

/**
 * Send an FCM multicast to all provided tokens.
 *
 * @param tokens   FCM registration tokens (deduplication handled here)
 * @param type     Notification type string — drives channel selection and app routing
 * @param title    Notification title (also written to data block for notifee display)
 * @param body     Notification body (also written to data block for notifee display)
 * @param extra    Additional string key/value pairs included in the FCM data block
 * @param options  { dataOnly: true } — omit the notification field so the app
 *                 handles display via notifee instead of the system tray
 */
export async function sendFcmToTokens(
  tokens: string[],
  type: string,
  title: string,
  body: string,
  extra: Record<string, string> = {},
  options: { dataOnly?: boolean } = {},
): Promise<void> {
  const app = getFirebaseAdminApp();
  if (!app) return; // Firebase not configured

  const unique = [...new Set(tokens.filter(Boolean))];
  if (unique.length === 0) return;

  const channelId = getChannelForType(type);
  const dataBlock: Record<string, string> = {
    type,
    title,
    body,
    ...extra,
  };

  for (let i = 0; i < unique.length; i += MULTICAST_CHUNK) {
    const chunk = unique.slice(i, i + MULTICAST_CHUNK);

    const message = options.dataOnly
      ? {
          tokens: chunk,
          data: dataBlock,
          android: { priority: 'high' as const },
          apns: { payload: { aps: { contentAvailable: true } } },
        }
      : {
          tokens: chunk,
          notification: { title, body },
          data: dataBlock,
          android: { priority: 'high' as const, notification: { channelId } },
          apns: { payload: { aps: { sound: 'default', contentAvailable: true } } },
        };

    try {
      const result = await getMessaging().sendEachForMulticast(message);

      const stale: string[] = [];
      result.responses.forEach((r, idx) => {
        if (!r.success) {
          const code = r.error?.code ?? '';
          if (
            code === 'messaging/registration-token-not-registered' ||
            code === 'messaging/invalid-registration-token'
          ) {
            stale.push(chunk[idx]);
          } else if (!r.success) {
            console.warn('[fcm] delivery failure for token:', chunk[idx].slice(-8), r.error?.code);
          }
        }
      });

      if (stale.length > 0) {
        purgeStaleTokens(stale).catch((err) =>
          console.error('[fcm] stale token cleanup failed:', err),
        );
      }
    } catch (err) {
      console.error('[fcm] sendEachForMulticast error:', err);
    }
  }
}

// ── Convenience lookup helpers ────────────────────────────────────────────────

/**
 * Collect all FCM tokens for a set of enrolled students.
 */
export async function getStudentTokensForUnit(unitId: string): Promise<string[]> {
  const enrollments = await prisma.enrollment.findMany({
    where: { unitId },
    select: { studentId: true },
  });
  const studentIds = [...new Set(enrollments.map((e) => e.studentId))];
  if (studentIds.length === 0) return [];

  const rows = await prisma.studentPushToken.findMany({
    where: { studentId: { in: studentIds } },
    select: { fcmToken: true },
  });
  return rows.map((r) => r.fcmToken);
}

/**
 * Get the FCM token for a single lecturer (returns empty array if none).
 */
export async function getLecturerTokens(lecturerId: string): Promise<string[]> {
  const row = await prisma.lecturer.findUnique({
    where: { id: lecturerId },
    select: { fcmToken: true },
  });
  return row?.fcmToken ? [row.fcmToken] : [];
}
