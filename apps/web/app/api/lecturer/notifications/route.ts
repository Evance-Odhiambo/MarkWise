/**
 * POST /api/lecturer/notifications
 *
 * Sends an immediate push notification to students enrolled in the provided unit codes.
 * Persists a LecturerNotification record and returns it with analytics.
 *
 * Auth: Bearer lecturer JWT
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyLecturerAccessToken } from "@/lib/lecturerAuthJwt";
import { buildPayloadsForStudentsWithNotifId, sendPushNotification } from "@/lib/pushNotification";
import { writeUserNotificationsForStudents } from "@/lib/userNotification";

export const runtime = "nodejs";

const VALID_TYPES = ["announcement", "reminder", "deadline", "assignment", "event", "grade"] as const;
const VALID_PRIORITIES = ["urgent", "high", "normal", "low"] as const;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function POST(req: NextRequest) {
  const token = (req.headers.get("authorization") ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!token) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }
  let lecturerId: string;
  try {
    ({ lecturerId } = verifyLecturerAccessToken(token));
  } catch {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ message: "Invalid JSON body" }, { status: 400, headers: corsHeaders });
  }

  const { type, priority = "normal", title, body: msgBody, recipients, data: meta } = body as {
    type?: string;
    priority?: string;
    title?: string;
    body?: string;
    recipients?: unknown;
    data?: Record<string, string>;
  };

  // Validate
  if (!type || !VALID_TYPES.includes(type as typeof VALID_TYPES[number])) {
    return NextResponse.json(
      { message: `type must be one of: ${VALID_TYPES.join(", ")}` },
      { status: 400, headers: corsHeaders },
    );
  }
  if (!VALID_PRIORITIES.includes(priority as typeof VALID_PRIORITIES[number])) {
    return NextResponse.json(
      { message: `priority must be one of: ${VALID_PRIORITIES.join(", ")}` },
      { status: 400, headers: corsHeaders },
    );
  }
  if (!title || typeof title !== "string" || !title.trim()) {
    return NextResponse.json({ message: "title is required" }, { status: 400, headers: corsHeaders });
  }
  if (title.length > 100) {
    return NextResponse.json({ message: "title must be 100 characters or fewer" }, { status: 400, headers: corsHeaders });
  }
  if (!msgBody || typeof msgBody !== "string" || !msgBody.trim()) {
    return NextResponse.json({ message: "body is required" }, { status: 400, headers: corsHeaders });
  }
  if (msgBody.length > 500) {
    return NextResponse.json({ message: "body must be 500 characters or fewer" }, { status: 400, headers: corsHeaders });
  }
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return NextResponse.json({ message: "recipients must be a non-empty array of unit codes" }, { status: 400, headers: corsHeaders });
  }

  try {
    const now = new Date();
    const normalised = (recipients as string[]).map((r) => r.replace(/\s+/g, "").toUpperCase());

    // Resolve unit codes → enrolled student IDs
    const units = await prisma.unit.findMany({
      where: { OR: [
        { code: { in: recipients as string[], mode: "insensitive" } },
        { code: { in: normalised, mode: "insensitive" } },
      ]},
      select: { id: true },
    });
    const unitIds = units.map((u) => u.id);

    let studentIds: string[] = [];
    if (unitIds.length > 0) {
      const enrollments = await prisma.enrollment.findMany({
        where: { unitId: { in: unitIds } },
        select: { studentId: true },
        distinct: ["studentId"],
      });
      studentIds = [...new Set(enrollments.map((e) => e.studentId))];
    }

    // Send push notifications
    let delivered = 0;
    if (studentIds.length > 0) {
      const msgData = {
        type,
        category: meta?.category ?? "notification",
        severity: meta?.severity ?? "info",
        sentBy: meta?.sentBy ?? lecturerId,
        sentAt: now.toISOString(),
        priority,
      };
      const notifIds = await writeUserNotificationsForStudents(studentIds, {
        type,
        title: title.trim(),
        body: msgBody.trim(),
        data: msgData,
      });
      const payloads = await buildPayloadsForStudentsWithNotifId(studentIds, {
        title: title.trim(),
        body: msgBody.trim(),
        data: msgData,
      }, notifIds);
      const results = await Promise.allSettled(
        payloads.map((p) => sendPushNotification(p))
      );
      delivered = results.filter((r) => r.status === "fulfilled" && r.value === true).length;

      // Create in-app Notification records for students
      await prisma.notification.createMany({
        data: studentIds.map((studentId) => ({
          userId: studentId,
          userType: "student" as const,
          title: title.trim(),
          message: msgBody.trim(),
          read: false,
        })),
        skipDuplicates: true,
      });
    }

    // Persist notification record
    const record = await prisma.lecturerNotification.create({
      data: {
        lecturerId,
        type,
        priority,
        title: title.trim(),
        message: msgBody.trim(),
        recipients: recipients as string[],
        category: meta?.category ?? "notification",
        severity: meta?.severity ?? "info",
        sentBy: meta?.sentBy ?? lecturerId,
        sentCount: delivered,
        readCount: 0,
        clickedCount: 0,
        status: "sent",
        sentAt: now,
        scheduledFor: null,
      },
    });

    return NextResponse.json(
      {
        id:           record.id,
        type:         record.type,
        priority:     record.priority,
        title:        record.title,
        body:         record.message,
        recipients:   record.recipients,
        sentAt:       record.sentAt?.toISOString() ?? now.toISOString(),
        scheduledFor: null,
        status:       "sent",
        analytics: {
          delivered,
          read:    0,
          clicked: 0,
        },
      },
      { headers: corsHeaders },
    );
  } catch (err: unknown) {
    console.error("[lecturer/notifications POST] error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: corsHeaders });
  }
}

/**
 * GET /api/lecturer/notifications
 * Returns the notification history for the authenticated lecturer.
 */
export async function GET(req: NextRequest) {
  const token = (req.headers.get("authorization") ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!token) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }
  let lecturerId: string;
  try {
    ({ lecturerId } = verifyLecturerAccessToken(token));
  } catch {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  try {
    const records = await prisma.lecturerNotification.findMany({
      where: { lecturerId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    const result = records.map((r) => ({
      id:           r.id,
      type:         r.type,
      priority:     r.priority,
      title:        r.title,
      body:         r.message,
      recipients:   r.recipients,
      sentAt:       r.sentAt?.toISOString() ?? null,
      scheduledFor: r.scheduledFor?.toISOString() ?? null,
      status:       r.status,
      analytics: {
        delivered: r.sentCount,
        read:      r.readCount,
        clicked:   r.clickedCount,
      },
    }));

    return NextResponse.json(result, { headers: corsHeaders });
  } catch (err: unknown) {
    console.error("[lecturer/notifications GET] error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: corsHeaders });
  }
}
