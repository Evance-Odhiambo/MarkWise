/**
 * lib/userNotification.ts
 *
 * Helpers for writing to the user_notifications inbox table.
 *
 * Every helper returns the generated UUID(s) so callers can inject them into
 * FCM payloads as `notificationId`.  This lets the mobile app use one stable
 * dedup key for both the push-received row and the inbox-fetched row.
 *
 * All errors are caught and logged; helpers never throw so they are safe to
 * use inside fire-and-forget async blocks.
 */
import { randomUUID } from 'crypto';
import { prisma } from './prisma';

export interface UserNotificationInput {
  type: string;
  title: string;
  body?: string;
  /** Must be JSON-serialisable. Values will be coerced to strings for FCM. */
  data?: Record<string, unknown>;
  /** Non-null → unique constraint on (userId, dedupeKey). Use for achievement badges. */
  dedupeKey?: string;
}

/**
 * Write one user_notifications row per student.
 * Returns Map<studentId, notificationId> so each student's row UUID can be
 * injected into their individual FCM payload.
 */
export async function writeUserNotificationsForStudents(
  studentIds: string[],
  input: UserNotificationInput,
): Promise<Map<string, string>> {
  if (studentIds.length === 0) return new Map();

  const rows = studentIds.map((userId) => ({
    id: randomUUID(),
    userId,
    type: input.type,
    title: input.title,
    body: input.body ?? null,
    data: (input.data ?? undefined) as any,
    dedupeKey: input.dedupeKey ?? null,
  }));

  try {
    await prisma.userNotification.createMany({ data: rows, skipDuplicates: true });
  } catch (err) {
    console.error('[userNotification] batch write error:', err);
    return new Map();
  }

  return new Map(rows.map((r) => [r.userId, r.id]));
}

/**
 * Write a single user_notifications row for a lecturer (or any single user).
 * Returns the generated notificationId, or null on failure.
 */
export async function writeUserNotificationForUser(
  userId: string,
  input: UserNotificationInput,
): Promise<string | null> {
  const id = randomUUID();
  try {
    await prisma.userNotification.create({
      data: {
        id,
        userId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        data: (input.data ?? undefined) as any,
        dedupeKey: input.dedupeKey ?? null,
      },
    });
    return id;
  } catch (err) {
    // Silently ignore unique-constraint violations (dedup) — re-throw others for logging
    if ((err as any)?.code !== 'P2002') {
      console.error('[userNotification] single write error:', err);
    }
    return null;
  }
}
