/**
 * GET /api/attendance/manual-mark/lookup
 *
 * Lecturer looks up a student by admission number to verify enrollment in a unit
 * before manually marking them present.
 *
 * Query params: admissionNumber, unitCode
 * Auth: Bearer lecturer JWT
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

function normaliseCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export async function GET(req: NextRequest) {
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

  const { searchParams } = new URL(req.url);
  const admissionNumberRaw = searchParams.get("admissionNumber");
  const unitCodeRaw = searchParams.get("unitCode");

  if (!admissionNumberRaw || !unitCodeRaw) {
    return NextResponse.json(
      { message: "admissionNumber and unitCode are required" },
      { status: 400, headers: corsHeaders },
    );
  }

  const admissionNumber = admissionNumberRaw.trim().toUpperCase();
  const normUnit = normaliseCode(unitCodeRaw);

  // Derive institutionId from lecturer for scoped student lookup
  const lecturer = await prisma.lecturer.findUnique({
    where: { id: lecturerId },
    select: { institutionId: true },
  });
  if (!lecturer) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  try {
    // Find student scoped to the lecturer's institution
    const student = await prisma.student.findUnique({
      where: { institutionId_admissionNumber: { institutionId: lecturer.institutionId, admissionNumber } },
      select: { id: true, name: true, admissionNumber: true },
    });

    if (!student) {
      return NextResponse.json({ message: "Student not found" }, { status: 404, headers: corsHeaders });
    }

    // Check enrollment via StudentEnrollmentSnapshot
    const snapshot = await prisma.studentEnrollmentSnapshot.findUnique({
      where: { studentId: student.id },
      select: { unitCodes: true },
    });

    const isEnrolled =
      snapshot?.unitCodes.some((c) => normaliseCode(c) === normUnit) ?? false;

    return NextResponse.json(
      {
        studentId:       student.id,
        studentName:     student.name,
        admissionNumber: student.admissionNumber,
        isEnrolled,
      },
      { headers: corsHeaders },
    );
  } catch (err: unknown) {
    console.error("[attendance/manual-mark/lookup] error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: corsHeaders });
  }
}
