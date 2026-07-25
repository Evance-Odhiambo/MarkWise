/**
 * POST /api/timetable/[id]/merge
 *
 * Merges a second course's lesson into an existing timetable entry by pointing
 * both entries at the same SharedSession (isMerged=true).
 *
 * The source entry's SharedSession is reused. A new Timetable entry is created
 * for the joining course (same unit, same SharedSession, same time/room).
 *
 * Body:
 *   {
 *     courseId:     string    – the joining course
 *     yearOfStudy?: number    – year for the joining course (defaults to source)
 *     semester?:    number    – semester (defaults to source)
 *     lecturerId?:  string    – lecturer override (defaults to same as source)
 *   }
 *
 * Response:
 *   { success: true, sharedSessionId: string, entry: <new timetable row> }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyAdminAuthToken } from "@/lib/adminAuthJwt";
import { verifyLecturerAccessToken } from "@/lib/lecturerAuthJwt";
import { normalizeUnitCode } from "@/lib/unitCode";
import { bumpTimetableVersion } from "@/lib/timetableSyncStore";
import { buildPayloadsForStudentsWithNotifId, sendPushNotificationBatch } from "@/lib/pushNotification";
import { writeUserNotificationsForStudents } from "@/lib/userNotification";
import { DayOfWeek, TimetableStatus } from "@prisma/client";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const DOW_TO_STRING: Record<DayOfWeek, string> = {
  MON: "Monday", TUE: "Tuesday", WED: "Wednesday",
  THU: "Thursday", FRI: "Friday", SAT: "Saturday", SUN: "Sunday",
};

const STATUS_MAP: Record<TimetableStatus, string> = {
  DRAFT: "Pending", PUBLISHED: "Confirmed", ARCHIVED: "Archived",
  CANCELLED: "Cancelled", ONLINE: "Online", RESCHEDULED: "Rescheduled",
};

function minutesToHHMM(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  // ── Auth ─────────────────────────────────────────────────────────────────────
  let token = req.cookies.get("admin_auth_token")?.value;
  if (!token) {
    const authHeader = req.headers.get("authorization");
    if (authHeader?.startsWith("Bearer ")) token = authHeader.slice(7).trim();
  }
  if (!token) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401, headers: corsHeaders });
  }
  const adminPayload = verifyAdminAuthToken(token);
  if (!adminPayload) {
    try { verifyLecturerAccessToken(token); }
    catch {
      return NextResponse.json({ error: "Invalid or expired token." }, { status: 401, headers: corsHeaders });
    }
  }

  const { id: sourceId } = await context.params;
  const body = await req.json();
  const { courseId, yearOfStudy, semester, lecturerId: bodyLecturerId } = body ?? {};

  if (!courseId) {
    return NextResponse.json({ error: "courseId is required." }, { status: 400, headers: corsHeaders });
  }

  // ── Fetch source entry ────────────────────────────────────────────────────────
  const source = await prisma.timetable.findUnique({
    where: { id: sourceId },
    include: {
      sharedSession: { include: { room: { select: { roomCode: true, name: true } } } },
      unitOffering: { include: { unit: true } },
    },
  });

  if (!source) {
    return NextResponse.json({ error: "Source timetable entry not found." }, { status: 404, headers: corsHeaders });
  }

  if (!source.sharedSessionId || !source.sharedSession) {
    return NextResponse.json({ error: "Source entry has no scheduled session." }, { status: 400, headers: corsHeaders });
  }

  const sourceUnitId = source.unitOffering?.unitId;
  if (!sourceUnitId) {
    return NextResponse.json({ error: "Source entry has no unit." }, { status: 400, headers: corsHeaders });
  }

  // Verify course exists
  const course = await prisma.course.findUnique({ where: { id: courseId }, select: { id: true, name: true } });
  if (!course) {
    return NextResponse.json({ error: "courseId does not exist." }, { status: 400, headers: corsHeaders });
  }

  // Guard: already merged for this course into this session
  const alreadyMerged = await prisma.timetable.findFirst({
    where: {
      sharedSessionId: source.sharedSessionId,
      unitOffering: { courseId },
    },
  });
  if (alreadyMerged) {
    return NextResponse.json(
      { error: "This course has already been merged into this session.", sharedSessionId: source.sharedSessionId },
      { status: 409, headers: corsHeaders },
    );
  }

  const effectiveLecturerId = bodyLecturerId ?? source.lecturerId;
  const yearNum     = parseInt(String(yearOfStudy ?? source.unitOffering?.year ?? 1), 10) || 1;
  const semesterNum = parseInt(String(semester    ?? source.unitOffering?.semester ?? 1), 10) || 1;

  // ── Create merged entry in transaction ───────────────────────────────────────
  const newEntry = await prisma.$transaction(async (tx) => {
    // Mark the SharedSession as merged
    await tx.sharedSession.update({
      where: { id: source.sharedSessionId! },
      data: { isMerged: true },
    });

    // Find or create UnitOffering for joining course
    const offering = await tx.unitOffering.upsert({
      where: { courseId_year_semester_unitId: { courseId, year: yearNum, semester: semesterNum, unitId: sourceUnitId } },
      create: { courseId, year: yearNum, semester: semesterNum, unitId: sourceUnitId },
      update: {},
    });

    // Create the new Timetable entry for the joining course
    return tx.timetable.create({
      data: {
        unitOfferingId: offering.id,
        lecturerId: effectiveLecturerId,
        sharedSessionId: source.sharedSessionId,
        timetableStatus: source.timetableStatus,
      },
      include: {
        unitOffering: { include: { unit: true, course: true } },
        sharedSession: { include: { room: true } },
        lecturer: { select: { id: true, fullName: true } },
      },
    });
  });

  // Bump version for joining course
  bumpTimetableVersion(courseId).catch(() => {});

  const ss = newEntry.sharedSession;
  const uo = newEntry.unitOffering;
  const unitCode = uo?.unit?.code ? normalizeUnitCode(uo.unit.code) : "";

  const response = NextResponse.json(
    {
      success: true,
      sharedSessionId: source.sharedSessionId,
      entry: {
        id: newEntry.id,
        courseId: uo?.courseId ?? null,
        courseName: uo?.course?.name ?? "",
        unitId: uo?.unitId ?? null,
        unitCode,
        unitTitle: uo?.unit?.title ?? "",
        roomId: ss?.roomId ?? null,
        roomName: ss?.room?.name ?? null,
        day: ss ? (DOW_TO_STRING[ss.day] ?? "") : "",
        startTime: ss ? minutesToHHMM(ss.startMinute) : "",
        endTime: ss ? minutesToHHMM(ss.endMinute) : "",
        lecturerId: newEntry.lecturerId,
        lecturerName: newEntry.lecturer?.fullName ?? "",
        sharedSessionId: source.sharedSessionId,
        isMerged: true,
        status: STATUS_MAP[newEntry.timetableStatus],
      },
    },
    { status: 201, headers: corsHeaders },
  );

  // ── Notify students of both courses ─────────────────────────────────────────
  Promise.resolve().then(async () => {
    try {
      const enrollments = await prisma.enrollment.findMany({
        where: { unitId: sourceUnitId },
        select: { studentId: true },
      });
      const studentIds = [...new Set(enrollments.map(e => e.studentId))];
      if (!studentIds.length || !unitCode) return;

      const mergeMsg = {
        title: "Unit Update",
        body: `Your ${unitCode} class has been merged into a joint session. Please refresh your timetable.`,
        data: { type: "unit_merged", unitCode },
      };
      const notifIds = await writeUserNotificationsForStudents(studentIds, {
        type: "unit_merged",
        title: mergeMsg.title,
        body: mergeMsg.body,
        data: mergeMsg.data,
      });
      const payloads = await buildPayloadsForStudentsWithNotifId(studentIds, mergeMsg, notifIds);
      await sendPushNotificationBatch(payloads);
    } catch (err) {
      console.error("[timetable/[id]/merge] notification failed:", err);
    }
  });

  return response;
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}
