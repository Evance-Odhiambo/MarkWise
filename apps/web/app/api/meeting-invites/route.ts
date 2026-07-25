import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyLecturerAccessToken } from "@/lib/lecturerAuthJwt";
import { normalizeUnitCode } from "@/lib/unitCode";
import { buildPayloadsForStudentsWithNotifId, sendPushNotificationBatch } from "@/lib/pushNotification";
import { writeUserNotificationsForStudents } from "@/lib/userNotification";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

// POST /api/meeting-invites
// Auth: Lecturer JWT required
export async function POST(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!token) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  let lecturerId: string;
  try {
    const payload = verifyLecturerAccessToken(token);
    lecturerId = payload.lecturerId;
  } catch {
    return NextResponse.json({ message: "Invalid or expired token" }, { status: 401, headers: corsHeaders });
  }

  let body: {
    lecturerId?: string;
    lecturerName?: string;
    unitCode?: string;
    unitName?: string;
    meetingLink?: string;
    passcode?: string | null;
    scheduledAt?: string;
    message?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ message: "Invalid JSON body" }, { status: 400, headers: corsHeaders });
  }

  const { lecturerName, unitCode: rawUnitCode, unitName, meetingLink, passcode, scheduledAt, message } = body;

  // Normalize to canonical format (e.g. "BCH1101" → "BCH 1101")
  const unitCode = normalizeUnitCode(String(rawUnitCode ?? ""));

  if (!unitCode) {
    return NextResponse.json({ message: "unitCode is required" }, { status: 400, headers: corsHeaders });
  }
  if (!meetingLink?.trim()) {
    return NextResponse.json({ message: "meetingLink is required" }, { status: 400, headers: corsHeaders });
  }
  if (!scheduledAt || isNaN(Date.parse(scheduledAt))) {
    return NextResponse.json({ message: "scheduledAt must be a valid ISO-8601 date" }, { status: 400, headers: corsHeaders });
  }

  // Verify the lecturer actually teaches this unit.
  // Unit codes in the DB may have spaces (e.g. "BCH 1101") while the app may
  // send a stripped version ("BCH1101"). Normalize both sides in JS.
  const lecturerTimetables = await prisma.timetable.findMany({
    where: { lecturerId },
    include: { unitOffering: { select: { unit: { select: { code: true } } } } },
  });

  const teaches = lecturerTimetables.some(
    (entry) => entry.unitOffering?.unit?.code && normalizeUnitCode(entry.unitOffering.unit.code) === unitCode
  );

  if (!teaches) {
    return NextResponse.json(
      { message: "You are not assigned to teach this unit" },
      { status: 403, headers: corsHeaders }
    );
  }

  const invite = await prisma.meetingInvite.create({
    data: {
      lecturerId,
      lecturerName: lecturerName?.trim() ?? "",
      unitCode,
      unitName: unitName?.trim() ?? "",
      meetingLink: meetingLink.trim(),
      passcode: passcode?.trim() || null,
      scheduledAt: new Date(scheduledAt),
      message: message?.trim() || null,
    },
  });

  // Fire-and-forget FCM push to enrolled students (lecturer is the sender — skip their token)
  const displayName = lecturerName?.trim() || "Your lecturer";
  const normalizedForEnrollment = unitCode;
  ;(async () => {
    try {
      const enrollments = await prisma.enrollment.findMany({
        where: { unit: { code: { equals: normalizedForEnrollment, mode: "insensitive" } } },
        select: { studentId: true },
      });
      const studentIds = [...new Set(enrollments.map((e) => e.studentId))];
      if (studentIds.length === 0) return;
      const inviteMsg = {
        title: `${unitCode} - Meeting Invite`,
        body: `${displayName} has shared a meeting link for ${unitCode}.`,
        data: {
          type: "meeting_invite",
          unitCode,
          lecturerName: displayName,
          scheduledAt: scheduledAt ?? "",
          meetingLink: meetingLink.trim(),
        },
      };
      const notifIds = await writeUserNotificationsForStudents(studentIds, {
        type: "meeting_invite",
        title: inviteMsg.title,
        body: inviteMsg.body,
        data: inviteMsg.data,
      });
      const payloads = await buildPayloadsForStudentsWithNotifId(studentIds, inviteMsg, notifIds);
      await sendPushNotificationBatch(payloads);
    } catch (err) {
      console.error("[meeting-invites/POST] push error:", err);
    }
  })();

  return NextResponse.json(invite, { status: 201, headers: corsHeaders });
}
