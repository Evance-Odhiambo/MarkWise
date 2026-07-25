import { NextResponse, type NextRequest } from 'next/server';
import { verifyLecturerAccessToken } from '@/lib/lecturerAuthJwt';
import { prisma } from '@/lib/prisma';
import { buildPayloadForLecturer, buildPayloadsForStudentsWithNotifId, sendPushNotification } from '@/lib/pushNotification';
import { writeUserNotificationForUser, writeUserNotificationsForStudents } from '@/lib/userNotification';

export const runtime = 'nodejs';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

const VALID_TYPES = [
  'announcement', 'reminder', 'urgent', 'schedule', 'assignment',
  'LESSON_CONFIRMED', 'LESSON_CANCELLED', 'LESSON_RESCHEDULED', 'LESSON_ONLINE',
  'MERGED_LESSON', 'UNMERGED_LESSON', 'EXTRA_SESSION', 'timetable',
  'meeting_invite',
] as const;

export async function POST(req: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ?? '';
  let lecturer: ReturnType<typeof verifyLecturerAccessToken>;
  try {
    lecturer = verifyLecturerAccessToken(token);
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
  }
  const lecturerId = lecturer.lecturerId ?? (lecturer as any).id as string;
  if (!lecturerId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
  }

  // ── Parse & validate body ──────────────────────────────────────────────────
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400, headers: corsHeaders });
  }

  const { type, title, message, recipients, data: meta } = body;

  if (!type || !VALID_TYPES.includes(type)) {
    return NextResponse.json(
      { error: `type must be one of: ${VALID_TYPES.join(', ')}` },
      { status: 400, headers: corsHeaders },
    );
  }
  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    return NextResponse.json({ error: 'title is required' }, { status: 400, headers: corsHeaders });
  }
  if (title.length > 120) {
    return NextResponse.json({ error: 'title must be 120 characters or fewer' }, { status: 400, headers: corsHeaders });
  }
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return NextResponse.json({ error: 'message is required' }, { status: 400, headers: corsHeaders });
  }
  if (message.length > 1000) {
    return NextResponse.json({ error: 'message must be 1000 characters or fewer' }, { status: 400, headers: corsHeaders });
  }
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return NextResponse.json({ error: 'recipients must be a non-empty array of unit codes' }, { status: 400, headers: corsHeaders });
  }

  const category: string = meta?.category ?? 'notification';
  const severity: string = meta?.severity ?? 'info';
  const sentBy: string = meta?.sentBy ?? lecturerId;

  try {
    // ── 1. Resolve unit codes → student IDs ───────────────────────────────────
    // Look up students enrolled in ANY of the requested units, across ALL courses
    // and departments. This is intentional for MERGED_LESSON where the audience
    // spans multiple programmes.
    const normalised = (recipients as string[]).map(r => r.replace(/\s+/g, '').toUpperCase());

    const units = await prisma.unit.findMany({
      where: {
        OR: [
          { code: { in: recipients, mode: 'insensitive' } },
          { code: { in: normalised, mode: 'insensitive' } },
        ],
      },
      select: { id: true },
    });

    const unitIds = units.map(u => u.id);

    let studentIds: string[] = [];
    if (unitIds.length > 0) {
      // Enrollment has no course filter — returns students from all courses.
      const enrollments = await prisma.enrollment.findMany({
        where: { unitId: { in: unitIds } },
        select: { studentId: true },
        distinct: ['studentId'],
      });
      studentIds = enrollments.map(e => e.studentId);
    }

    studentIds = [...new Set(studentIds)];

    if (studentIds.length === 0) {
      return NextResponse.json(
        { error: 'No enrolled students found for the given units' },
        { status: 400, headers: corsHeaders },
      );
    }

    // ── 2. Send FCM push notifications ────────────────────────────────────────
    // FCM requires every value in the data block to be a string.
    // Coerce nulls/numbers from meta before spreading so the message is never rejected.
    const metaStrings: Record<string, string> = {};
    if (meta && typeof meta === 'object') {
      for (const [k, v] of Object.entries(meta as Record<string, unknown>)) {
        metaStrings[k] = v == null ? '' : String(v);
      }
    }

    const sharedData: Record<string, string> = {
      ...metaStrings,
      type,
      category,
      severity,
      sentBy,
      sentAt: new Date().toISOString(),
    };

    // ── Write inbox rows first so we have notificationIds for FCM payloads ────
    const inboxInput = {
      type,
      title: title.trim(),
      body: message.trim(),
      data: sharedData as unknown as Record<string, unknown>,
    };
    const [notifIds, lecturerNotifId] = await Promise.all([
      writeUserNotificationsForStudents(studentIds, inboxInput),
      writeUserNotificationForUser(lecturerId, inboxInput),
    ]);

    const studentPayloads = await buildPayloadsForStudentsWithNotifId(studentIds, {
      title: title.trim(),
      body: message.trim(),
      data: sharedData,
    }, notifIds);

    // Also push to the lecturer who sent the notification (they may be on another device)
    const lecturerPayload = await buildPayloadForLecturer(lecturerId, {
      title: title.trim(),
      body: message.trim(),
      data: { ...sharedData, notificationId: lecturerNotifId ?? '' },
    });

    const payloads = lecturerPayload ? [...studentPayloads, lecturerPayload] : studentPayloads;

    // channelId is auto-resolved from data.type inside sendPushNotification
    const sendPromises = payloads.map((p) => sendPushNotification(p));

    const results = await Promise.allSettled(sendPromises);
    const successCount = results.filter(
      (r) => r.status === 'fulfilled' && r.value === true,
    ).length;
    const failureCount = results.length - successCount;

    // ── 3. Create in-app Notification records for each student ────────────────
    if (studentIds.length > 0) {
      await prisma.notification.createMany({
        data: studentIds.map((studentId) => ({
          userId:   studentId,
          userType: 'student' as const,
          type,
          title:    title.trim(),
          message:  message.trim(),
          data:     meta ?? undefined,
          read:     false,
        })),
        skipDuplicates: true,
      });
    }

    // ── 4. Persist to LecturerNotification log ────────────────────────────────
    await prisma.lecturerNotification.create({
      data: {
        lecturerId,
        type,
        title: title.trim(),
        message: message.trim(),
        recipients: recipients as string[],
        category,
        severity,
        sentBy,
        sentCount: successCount,
      },
    });

    return NextResponse.json({ sent: successCount, failed: failureCount, successCount, failureCount }, { headers: corsHeaders });
  } catch (err) {
    console.error('[notifications/send] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: corsHeaders });
  }
}
