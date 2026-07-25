/**
 * POST /api/lecturer/notifications/schedule
 *
 * Schedules a notification to be delivered at a future time.
 * Creates a LecturerNotification record with status = "scheduled".
 * Actual delivery requires a background job to poll for scheduled records.
 *
 * Auth: Bearer lecturer JWT
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyLecturerAccessToken } from "@/lib/lecturerAuthJwt";

export const runtime = "nodejs";

const VALID_TYPES = ["announcement", "reminder", "deadline", "assignment", "event", "grade"] as const;
const VALID_PRIORITIES = ["urgent", "high", "normal", "low"] as const;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

  const { type, priority = "normal", title, body: msgBody, recipients, scheduledFor: scheduledForRaw, data: meta } = body as {
    type?: string;
    priority?: string;
    title?: string;
    body?: string;
    recipients?: unknown;
    scheduledFor?: string;
    data?: Record<string, string>;
  };

  // Validate fields
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
  if (!scheduledForRaw || typeof scheduledForRaw !== "string") {
    return NextResponse.json({ message: "scheduledFor is required" }, { status: 400, headers: corsHeaders });
  }
  const scheduledFor = new Date(scheduledForRaw);
  if (isNaN(scheduledFor.getTime())) {
    return NextResponse.json({ message: "scheduledFor must be a valid ISO 8601 datetime" }, { status: 400, headers: corsHeaders });
  }
  if (scheduledFor <= new Date()) {
    return NextResponse.json({ message: "scheduledFor must be in the future" }, { status: 400, headers: corsHeaders });
  }

  try {
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
        sentCount: 0,
        readCount: 0,
        clickedCount: 0,
        status: "scheduled",
        sentAt: null,
        scheduledFor,
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
        sentAt:       null,
        scheduledFor: record.scheduledFor?.toISOString() ?? scheduledFor.toISOString(),
        status:       "scheduled",
        analytics: { delivered: 0, read: 0, clicked: 0 },
      },
      { headers: corsHeaders },
    );
  } catch (err: unknown) {
    console.error("[lecturer/notifications/schedule] error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: corsHeaders });
  }
}
