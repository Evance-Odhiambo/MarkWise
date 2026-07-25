/**
 * GET /api/lecturer/dashboard/activity
 *
 * Returns a summary activity feed for the authenticated lecturer's dashboard.
 * Includes recent assignments, upcoming timetable entries, and submission stats.
 */
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyLecturerAccessToken } from "@/lib/lecturerAuthJwt";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

const DAY_ORDER: Record<string, number> = {
  monday: 0, tuesday: 1, wednesday: 2, thursday: 3,
  friday: 4, saturday: 5, sunday: 6,
};

export async function GET(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  let lecturerId: string;
  try {
    const p = verifyLecturerAccessToken(token);
    lecturerId = p.lecturerId;
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401, headers: corsHeaders });
  }

  const [assignments, timetableEntries, recentSubmissions] = await Promise.all([
    // 5 most recently created assignments
    prisma.assignment.findMany({
      where: { lecturerId },
      include: {
        submissions: { select: { id: true, status: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),

    // All timetable entries for this lecturer
    prisma.timetable.findMany({
      where: { lecturerId },
      include: {
        unitOffering: { include: { unit: { select: { code: true, title: true } } } },
        sharedSession: { include: { room: { select: { name: true, roomCode: true } } } },
      },
      orderBy: { createdAt: "asc" },
    }),

    // 10 most recent submissions across lecturer's assignments
    prisma.submission.findMany({
      where: { assignment: { lecturerId } },
      include: {
        assignment: { select: { title: true, unitId: true } },
        student: { select: { name: true, admissionNumber: true } },
      },
      orderBy: { submittedAt: "desc" },
      take: 10,
    }),
  ]);

  // Resolve unit info for assignments (no direct relation on Assignment model)
  const assignmentUnitIds = [...new Set(assignments.map((a) => a.unitId))];
  const submissionUnitIds = [...new Set(recentSubmissions.map((s) => s.assignment?.unitId).filter(Boolean) as string[])];
  const allUnitIds = [...new Set([...assignmentUnitIds, ...submissionUnitIds])];
  const units = await prisma.unit.findMany({
    where: { id: { in: allUnitIds } },
    select: { id: true, code: true, title: true },
  });
  const unitMap = new Map(units.map((u) => [u.id, u]));

  const DOW_MAP: Record<string, string> = {
    MON: "Monday", TUE: "Tuesday", WED: "Wednesday",
    THU: "Thursday", FRI: "Friday", SAT: "Saturday", SUN: "Sunday",
  };
  const STATUS_MAP: Record<string, string> = {
    DRAFT: "Pending", PUBLISHED: "Confirmed", ARCHIVED: "Archived",
    CANCELLED: "Cancelled", ONLINE: "Online", RESCHEDULED: "Rescheduled",
  };
  function minutesToHHMM(m: number) {
    return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  }

  // Sort timetable by day then startMinute
  const sortedTimetable = timetableEntries.sort((a, b) => {
    const ssA = a.sharedSession;
    const ssB = b.sharedSession;
    const da = DAY_ORDER[(ssA ? (DOW_MAP[ssA.day] ?? "") : "").toLowerCase()] ?? 99;
    const db = DAY_ORDER[(ssB ? (DOW_MAP[ssB.day] ?? "") : "").toLowerCase()] ?? 99;
    if (da !== db) return da - db;
    return (ssA?.startMinute ?? 0) - (ssB?.startMinute ?? 0);
  });

  return NextResponse.json(
    {
      recentAssignments: assignments.map((a) => ({
        id: a.id,
        title: a.title,
        unitCode: unitMap.get(a.unitId)?.code ?? "",
        unitTitle: unitMap.get(a.unitId)?.title ?? "",
        status: a.status,
        dueDate: a.dueDate.toISOString(),
        submissionCount: (a as any).submissions?.length ?? 0,
        createdAt: a.createdAt.toISOString(),
      })),

      upcomingClasses: sortedTimetable.map((e) => {
        const ss = e.sharedSession;
        const dayStr = ss ? (DOW_MAP[ss.day] ?? "") : "";
        const startTime = ss ? minutesToHHMM(ss.startMinute) : "";
        const endTime   = ss ? minutesToHHMM(ss.endMinute)   : "";
        return {
          id: e.id,
          unitCode: e.unitOffering?.unit?.code ?? "",
          unitTitle: e.unitOffering?.unit?.title ?? "",
          day: dayStr,
          startTime,
          endTime,
          time: startTime && endTime ? `${startTime} - ${endTime}` : "",
          room: ss?.room?.name ?? "",
          roomCode: ss?.room?.roomCode ?? "",
          status: STATUS_MAP[e.timetableStatus] ?? e.timetableStatus,
        };
      }),

      recentSubmissions: recentSubmissions.map((s) => ({
        id: s.id,
        assignmentTitle: s.assignment?.title ?? "",
        unitCode: unitMap.get(s.assignment?.unitId ?? "")?.code ?? "",
        studentName: (s as any).student?.name ?? "",
        admissionNumber: (s as any).student?.admissionNumber ?? "",
        status: s.status,
        grade: s.grade ?? null,
        submittedAt: s.submittedAt.toISOString(),
      })),

      stats: {
        totalAssignments: await prisma.assignment.count({ where: { lecturerId } }),
        activeAssignments: await prisma.assignment.count({ where: { lecturerId, status: "active" } }),
        totalClasses: timetableEntries.length,
      },
    },
    { headers: corsHeaders },
  );
}
