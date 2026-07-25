/**
 * GET /api/timetable/offerings?courseId=&year=&semester=
 *
 * Returns UnitOfferings for a specific course/year/semester context,
 * with unit details and lecturer assignments included.
 * Avoids the slow Course → YearBlock → Semester → Unit traversal on every
 * timetable query.
 *
 * POST /api/timetable/offerings
 * Body: { courseId, year, semester, unitId }
 * Creates a UnitOffering if it doesn't already exist.
 *
 * Auth: Admin JWT (GET is public within the API; POST requires admin).
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveAdminScope } from "@/lib/adminScope";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const courseId = searchParams.get("courseId");
  const yearStr  = searchParams.get("year");
  const semStr   = searchParams.get("semester");

  if (!courseId) {
    return NextResponse.json({ error: "courseId is required." }, { status: 400, headers: corsHeaders });
  }

  const where: Record<string, unknown> = { courseId };
  if (yearStr) where.year = parseInt(yearStr, 10);
  if (semStr)  where.semester = parseInt(semStr, 10);

  const offerings = await prisma.unitOffering.findMany({
    where,
    include: {
      unit: { select: { id: true, code: true, title: true, bleId: true } },
      assignments: {
        include: {
          lecturer: { select: { id: true, fullName: true, email: true } },
        },
      },
    },
    orderBy: [{ year: "asc" }, { semester: "asc" }],
  });

  return NextResponse.json(offerings, { headers: corsHeaders });
}

export async function POST(req: NextRequest) {
  const scope = await resolveAdminScope(req);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status, headers: corsHeaders });
  }

  let body: { courseId?: string; year?: number; semester?: number; unitId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400, headers: corsHeaders });
  }

  const { courseId, year, semester, unitId } = body;
  if (!courseId || year == null || semester == null || !unitId) {
    return NextResponse.json(
      { error: "courseId, year, semester, and unitId are required." },
      { status: 400, headers: corsHeaders },
    );
  }

  const offering = await prisma.unitOffering.upsert({
    where: { courseId_year_semester_unitId: { courseId, year, semester, unitId } },
    update: {},
    create: { courseId, year, semester, unitId },
    include: {
      unit: { select: { id: true, code: true, title: true } },
    },
  });

  return NextResponse.json(offering, { status: 201, headers: corsHeaders });
}
