/**
 * GET /api/timetable/merge-group/[groupId]
 *
 * Returns all timetable entries that share the given SharedSession (isMerged=true),
 * including their course, room, unit and lecturer details.
 * groupId is the SharedSession ID.
 *
 * Auth: admin_auth_token cookie or Bearer token.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveAdminScope } from "@/lib/adminScope";
import { normalizeUnitCode } from "@/lib/unitCode";
import { DayOfWeek, TimetableStatus } from "@prisma/client";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
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

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ groupId: string }> },
) {
  const scope = await resolveAdminScope(req);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status, headers: corsHeaders });
  }

  const { groupId } = await context.params;
  if (!groupId) {
    return NextResponse.json({ error: "groupId is required." }, { status: 400, headers: corsHeaders });
  }

  // groupId is now the sharedSessionId
  const entries = await prisma.timetable.findMany({
    where: {
      sharedSessionId: groupId,
      timetableStatus: { notIn: ["CANCELLED", "ARCHIVED"] },
    },
    include: {
      unitOffering: {
        include: {
          unit: { select: { code: true, title: true } },
          course: { select: { id: true, name: true, code: true, department: { select: { id: true, name: true } } } },
        },
      },
      lecturer: { select: { id: true, fullName: true } },
      sharedSession: {
        include: { room: { select: { name: true, roomCode: true, capacity: true } } },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  if (entries.length === 0) {
    return NextResponse.json({ error: "Merge group not found." }, { status: 404, headers: corsHeaders });
  }

  // Count students per course from enrollments
  const unitIds = [...new Set(entries.map(e => e.unitOffering?.unitId).filter((id): id is string => !!id))];
  const courseIds = [...new Set(entries.map(e => e.unitOffering?.courseId).filter((id): id is string => !!id))];

  const enrolledStudents = await prisma.enrollment.findMany({
    where: { unitId: { in: unitIds } },
    select: { studentId: true, student: { select: { courseId: true } } },
  });

  const countByCourse: Record<string, number> = {};
  let totalStudents = 0;
  for (const row of enrolledStudents) {
    const cId = row.student?.courseId ?? "";
    if (courseIds.includes(cId)) {
      countByCourse[cId] = (countByCourse[cId] ?? 0) + 1;
      totalStudents++;
    }
  }

  const ss = entries[0]!.sharedSession;
  const result = entries.map((e) => ({
    id:             e.id,
    courseId:       e.unitOffering?.courseId ?? null,
    departmentId:   e.unitOffering?.course?.department?.id ?? null,
    departmentName: e.unitOffering?.course?.department?.name ?? "",
    courseName:     e.unitOffering?.course?.name ?? "",
    courseCode:     e.unitOffering?.course?.code ?? "",
    unitCode:       normalizeUnitCode(e.unitOffering?.unit?.code ?? ""),
    unitTitle:      e.unitOffering?.unit?.title ?? "",
    lecturerName:   e.lecturer?.fullName ?? "",
    roomName:       ss?.room?.name ?? "",
    roomCode:       ss?.room?.roomCode ?? "",
    roomCapacity:   ss?.room?.capacity ?? null,
    day:            ss ? (DOW_TO_STRING[ss.day] ?? "") : "",
    startTime:      ss ? minutesToHHMM(ss.startMinute) : "",
    endTime:        ss ? minutesToHHMM(ss.endMinute) : "",
    yearOfStudy:    e.unitOffering?.year?.toString() ?? "",
    semester:       e.unitOffering?.semester?.toString() ?? "",
    status:         STATUS_MAP[e.timetableStatus] ?? e.timetableStatus,
    studentCount:   countByCourse[e.unitOffering?.courseId ?? ""] ?? 0,
  }));

  return NextResponse.json(
    { mergeGroupId: groupId, sharedSessionId: groupId, totalStudents, entries: result },
    { headers: corsHeaders },
  );
}
