/**
 * GET /api/lecturer/units/:unitCode/students
 *
 * Returns the full roster of students enrolled in the given unit so the
 * app can cache them locally for offline manual-mark lookups.
 *
 * Auth:  Bearer lecturer JWT
 * 400   unitCode param is blank
 * 401   token missing or invalid / lecturer record not found
 * 403   lecturer not timetable-assigned to this unit
 * 404   unit does not exist
 * 200   { students: [{ studentId, studentName, admissionNumber }] }
 *       Empty unit returns { students: [] }, never 404.
 *
 * Enrollment source: StudentEnrollmentSnapshot.unitCodes (String[]) —
 * the primary enrollment store written by POST /api/student/enrollment.
 * Consistent with /attendance and /attendance/grid sibling routes.
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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ unitCode: string }> },
) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const token = (req.headers.get("authorization") ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!token) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: corsHeaders },
    );
  }

  let lecturerId: string;
  try {
    ({ lecturerId } = verifyLecturerAccessToken(token));
  } catch {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: corsHeaders },
    );
  }

  // ── Normalize unit code (strip all spaces, uppercase) ────────────────────
  // Matches the normalization used in /attendance and /attendance/grid.
  const { unitCode: rawParam } = await params;
  const unitCode = decodeURIComponent(rawParam).replace(/\s+/g, "").toUpperCase();
  if (!unitCode) {
    return NextResponse.json(
      { error: "unitCode is required" },
      { status: 400, headers: corsHeaders },
    );
  }

  try {
    // ── Resolve unit (case-insensitive, space-tolerant) ───────────────────
    const unitRows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id
      FROM "Unit"
      WHERE UPPER(REPLACE(code, ' ', '')) = ${unitCode}
      LIMIT 1
    `;
    if (unitRows.length === 0) {
      return NextResponse.json(
        { error: "Unit not found" },
        { status: 404, headers: corsHeaders },
      );
    }
    const unitId = unitRows[0].id;

    // ── Authorization: lecturer must be assigned to this unit either via
    //    explicit LecturerUnitAssignment or via a Timetable entry.
    const assignedUnit = await prisma.lecturerUnitAssignment.findFirst({
      where: { lecturerId, unitOffering: { unitId } },
      select: { id: true },
    });
    if (!assignedUnit) {
      const timetableEntry = await prisma.timetable.findFirst({
        where: { lecturerId, unitOffering: { unitId } },
        select: { id: true },
      });
      if (!timetableEntry) {
        return NextResponse.json(
          { error: "Forbidden" },
          { status: 403, headers: corsHeaders },
        );
      }
    }

    // ── Resolve institutionId from DB — never from caller input ──────────
    const lecturer = await prisma.lecturer.findUnique({
      where: { id: lecturerId },
      select: { institutionId: true },
    });
    if (!lecturer?.institutionId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: corsHeaders },
      );
    }
    const { institutionId } = lecturer;

    // ── Fetch enrolled students ───────────────────────────────────────────
    // StudentEnrollmentSnapshot.unitCodes is the primary store written by
    // POST /api/student/enrollment. Normalize stored codes at query time
    // so "SCH 2170" and "SCH2170" both match the requested unitCode.
    const students = await prisma.$queryRaw<
      { studentId: string; studentName: string; admissionNumber: string }[]
    >`
      SELECT
        s.id                AS "studentId",
        s.name              AS "studentName",
        s."admissionNumber"
      FROM "StudentEnrollmentSnapshot" es
      JOIN "Student" s ON s.id = es."studentId"
      WHERE s."institutionId" = ${institutionId}
        AND EXISTS (
          SELECT 1
          FROM unnest(es."unitCodes") AS uc
          WHERE UPPER(REPLACE(uc, ' ', '')) = ${unitCode}
        )
      ORDER BY s.name ASC
    `;

    return NextResponse.json(
      { students },
      { status: 200, headers: corsHeaders },
    );
  } catch (err) {
    console.error("[GET /api/lecturer/units/:unitCode/students]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: corsHeaders },
    );
  }
}
