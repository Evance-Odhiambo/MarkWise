/**
 * GET /api/lecturer/dashboard/stats
 *
 * Returns aggregated statistics for the authenticated lecturer's dashboard.
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

  // Fetch unit IDs this lecturer teaches (from timetable rows)
  const timetableRows = await prisma.timetable.findMany({
    where: { lecturerId },
    include: { unitOffering: { select: { unitId: true } } },
  });
  const unitIds = [...new Set(timetableRows.map((r) => r.unitOffering?.unitId).filter(Boolean) as string[])];

  const [
    totalAssignments,
    activeAssignments,
    totalSubmissions,
    pendingGrading,
    totalClasses,
    totalMaterials,
    totalStudents,
  ] = await Promise.all([
    prisma.assignment.count({ where: { lecturerId } }),
    prisma.assignment.count({ where: { lecturerId, status: "active" } }),
    prisma.submission.count({ where: { assignment: { lecturerId } } }),
    // Submissions awaiting grading
    prisma.submission.count({ where: { assignment: { lecturerId }, status: { in: ["submitted", "pending"] } } }),
    prisma.timetable.count({ where: { lecturerId } }),
    prisma.material.count({ where: { lecturerId } }),
    // Unique enrolled students across all units this lecturer teaches
    unitIds.length > 0
      ? prisma.enrollment.count({ where: { unitId: { in: unitIds } } })
      : Promise.resolve(0),
  ]);

  return NextResponse.json(
    {
      totalAssignments,
      activeAssignments,
      totalSubmissions,
      pendingGrading,
      totalClasses,
      totalMaterials,
      totalStudents,
      totalUnits: unitIds.length,
    },
    { headers: corsHeaders },
  );
}
