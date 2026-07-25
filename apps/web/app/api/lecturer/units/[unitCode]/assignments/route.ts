/**
 * GET /api/lecturer/units/:unitCode/assignments
 *
 * Per-assignment submission statistics for a specific unit.
 * Filtered by dueDate within [startDate, endDate] when provided.
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

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

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

    // ── Enrolled count + assignments (parallel) ──────────────────────────────
    const dueDateFilter: { gte?: Date; lte?: Date } = {};
    if (start) dueDateFilter.gte = start;
    if (end)   dueDateFilter.lte = end;

    const [enrolledCount, assignments] = await Promise.all([
      prisma.enrollment.count({ where: { unitId } }),
      prisma.assignment.findMany({
        where: {
          lecturerId,
          unitId,
          ...(Object.keys(dueDateFilter).length > 0 ? { dueDate: dueDateFilter } : {}),
        },
        select: { id: true, title: true, dueDate: true },
        orderBy: { dueDate: "asc" },
      }),
    ]);

    if (assignments.length === 0) {
      return NextResponse.json({ assignments: [] }, { headers: corsHeaders });
    }

    // ── Batch-fetch submissions for all assignments ──────────────────────────
    const allSubs = await prisma.submission.findMany({
      where: { assignmentId: { in: assignments.map((a) => a.id) } },
      select: { assignmentId: true, submittedAt: true, grade: true },
    });

    const subsByAssignment = new Map<string, { submittedAt: Date; grade: number | null }[]>();
    for (const s of allSubs) {
      const list = subsByAssignment.get(s.assignmentId) ?? [];
      list.push({ submittedAt: s.submittedAt, grade: s.grade });
      subsByAssignment.set(s.assignmentId, list);
    }

    // ── Build response ───────────────────────────────────────────────────────
    const result = assignments.map((a) => {
      const subs = subsByAssignment.get(a.id) ?? [];
      const lateSubmissions = subs.filter((s) => s.submittedAt > a.dueDate).length;
      const graded = subs.filter((s) => s.grade !== null);
      const averageGrade =
        graded.length > 0
          ? Math.round((graded.reduce((sum, s) => sum + s.grade!, 0) / graded.length) * 10) / 10
          : undefined;

      return {
        title: a.title,
        dueDate: a.dueDate.toISOString(),
        totalStudents: enrolledCount,
        submitted: subs.length,
        lateSubmissions,
        ...(averageGrade !== undefined ? { averageGrade } : {}),
      };
    });

    return NextResponse.json({ assignments: result }, { headers: corsHeaders });
  } catch (err) {
    console.error("[lecturer/units/assignments] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: corsHeaders });
  }
}
