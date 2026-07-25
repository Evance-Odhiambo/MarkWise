/**
 * GET /api/lecturer/units/:unitCode/sessions
 *
 * Session log for a specific unit within a date range.
 * Returns ConductedSession records (attendance windows the lecturer opened).
 * studentsPresent counts OfflineAttendanceRecord rows linked via conductedSessionId.
 *
 * Auth:   Bearer lecturer JWT
 * 401    token missing or invalid
 * 403    lecturer not timetable-assigned to this unit
 * 404    unit not found
 *
 * Query params:
 *   startDate  YYYY-MM-DD  (optional)
 *   endDate    YYYY-MM-DD  (optional)
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyLecturerAccessToken } from "@/lib/lecturerAuthJwt";
import { normalizeUnitCode } from "@/lib/unitCode";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

const LESSON_LABELS: Record<string, string> = {
  LEC: "Lecture",
  LAB: "Lab",
  TUT: "Tutorial",
  SEM: "Seminar",
  GD:  "Group Discussion",
  RAT: "RAT",
  CAT: "CAT",
  WRK: "Workshop",
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function parseDate(s: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s + "T00:00:00.000Z");
  return isNaN(d.getTime()) ? null : d;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ unitCode: string }> },
) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const token = (req.headers.get("authorization") ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }
  let lecturerId: string;
  try {
    ({ lecturerId } = verifyLecturerAccessToken(token));
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  // ── Normalize unit code ──────────────────────────────────────────────────
  const { unitCode: rawParam } = await params;
  const unitCode = decodeURIComponent(rawParam).replace(/\s+/g, "").toUpperCase();
  const norm = normalizeUnitCode(unitCode);

  // ── Parse query params ───────────────────────────────────────────────────
  const { searchParams } = new URL(req.url);
  const start = parseDate(searchParams.get("startDate"));
  const end = parseDate(searchParams.get("endDate"));
  if (end) end.setUTCHours(23, 59, 59, 999);

  try {
    // ── Resolve unit (space-tolerant, case-insensitive) ──────────────────────
    const unitRows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Unit"
      WHERE UPPER(REPLACE(code, ' ', '')) = ${unitCode}
      LIMIT 1
    `;
    if (unitRows.length === 0) {
      return NextResponse.json({ error: "Unit not found" }, { status: 404, headers: corsHeaders });
    }
    const unitId = unitRows[0]!.id;

    // ── Auth: lecturer must be timetable-assigned to this unit ───────────────
    const timetableEntry = await prisma.timetable.findFirst({
      where: { lecturerId, unitOffering: { unitId } },
      select: { id: true },
    });
    if (!timetableEntry) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: corsHeaders });
    }

    // ── Enrolled count + conducted sessions (parallel) ───────────────────────
    const sessionStartFilter: { gte?: Date; lte?: Date } = {};
    if (start) sessionStartFilter.gte = start;
    if (end)   sessionStartFilter.lte = end;

    const [enrolledCount, conductedSessions] = await Promise.all([
      prisma.enrollment.count({ where: { unitId } }),
      prisma.conductedSession.findMany({
        where: {
          lecturerId,
          unitCode: { equals: norm, mode: "insensitive" },
          ...(Object.keys(sessionStartFilter).length > 0 ? { sessionStart: sessionStartFilter } : {}),
        },
        select: { id: true, lectureRoom: true, lessonType: true, sessionStart: true },
        orderBy: { sessionStart: "asc" },
      }),
    ]);

    if (conductedSessions.length === 0) {
      return NextResponse.json({ sessions: [] }, { headers: corsHeaders });
    }

    // ── Batch attendance counts via conductedSessionId ───────────────────────
    const sessionIds = conductedSessions.map((s) => s.id);
    const attendanceCounts = await prisma.offlineAttendanceRecord.groupBy({
      by: ["conductedSessionId"],
      where: { conductedSessionId: { in: sessionIds } },
      _count: { id: true },
    });
    const presentMap = new Map(
      attendanceCounts
        .filter((a) => a.conductedSessionId !== null)
        .map((a) => [a.conductedSessionId!, a._count.id]),
    );

    // ── Week label: relative to startDate or first session ───────────────────
    const refMs = (start ?? conductedSessions[0]!.sessionStart).getTime();

    const sessions = conductedSessions.map((s) => {
      const lessonType = s.lessonType ?? "LEC";
      const weekNum = Math.floor((s.sessionStart.getTime() - refMs) / WEEK_MS) + 1;
      const label = `Week ${weekNum} ${LESSON_LABELS[lessonType] ?? lessonType}`;
      return {
        sessionId:       s.id,
        label,
        date:            s.sessionStart.toISOString(),
        lectureRoom:     s.lectureRoom,
        lessonType,
        status:          "conducted" as const,
        studentsPresent: presentMap.get(s.id) ?? 0,
        studentsEnrolled: enrolledCount,
      };
    });

    return NextResponse.json({ sessions }, { headers: corsHeaders });
  } catch (err) {
    console.error("[lecturer/units/sessions] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: corsHeaders });
  }
}
