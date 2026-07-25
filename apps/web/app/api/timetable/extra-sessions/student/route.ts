/**
 * GET /api/timetable/extra-sessions/student
 *
 * Returns all active (non-deleted) extra/make-up sessions that are relevant
 * to the logged-in student — filtered by their enrolled unit codes and
 * institution.
 *
 * Enrollment source: StudentEnrollmentSnapshot.unitCodes (String[]) — the
 * primary enrollment store written by POST /api/student/enrollment.
 *
 * Auth: Bearer student JWT
 * Response 200: flat array — see shape below.  Empty → [], not 404.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyStudentAccessToken } from "@/lib/studentAuthJwt";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET(req: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const token = (req.headers.get("authorization") ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!token) {
    return NextResponse.json(
      { message: "Unauthorized" },
      { status: 401, headers: corsHeaders },
    );
  }

  let studentId: string;
  try {
    ({ studentId } = verifyStudentAccessToken(token));
  } catch {
    return NextResponse.json(
      { message: "Unauthorized" },
      { status: 401, headers: corsHeaders },
    );
  }

  // ── Fetch student + institution ───────────────────────────────────────────
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { institutionId: true },
  });
  if (!student) {
    return NextResponse.json(
      { message: "Unauthorized" },
      { status: 401, headers: corsHeaders },
    );
  }

  // ── Resolve enrolled unit codes ───────────────────────────────────────────
  // Primary source: StudentEnrollmentSnapshot written by POST /api/student/enrollment.
  // Fallback: Enrollment join-table rows (populated by the same POST since the fix).
  const snapshot = await prisma.studentEnrollmentSnapshot.findUnique({
    where: { studentId },
    select: { unitCodes: true },
  });

  const normalize = (c: string) => c.replace(/\s+/g, "").toUpperCase();

  let enrolledCodes: string[] = [];

  if (snapshot?.unitCodes?.length) {
    enrolledCodes = snapshot.unitCodes.map(normalize);
  } else {
    // Fallback to Enrollment join-table
    const enrollments = await prisma.enrollment.findMany({
      where: { studentId },
      select: { unit: { select: { code: true } } },
    });
    enrolledCodes = enrollments.map((e) => normalize(e.unit.code));
  }

  if (enrolledCodes.length === 0) {
    return NextResponse.json([], { status: 200, headers: corsHeaders });
  }

  // ── Date window: today −7 days onwards ───────────────────────────────────
  const windowStart = new Date();
  windowStart.setDate(windowStart.getDate() - 7);
  windowStart.setHours(0, 0, 0, 0);

  // ── Fetch extra sessions via raw SQL ──────────────────────────────────────
  // Uses DB-side normalization so "SCH 2172" stored in ExtraSession.unitCode
  // still matches a normalized enrolled code "SCH2172".
  // Institution boundary enforced via Unit.departmentId → Department.institutionId.
  type RawRow = {
    id: string;
    unitCode: string;
    unitName: string | null;
    date: Date;
    startTime: string;
    endTime: string;
    roomCode: string | null;
    roomId: string | null;
    lessonType: string;
    lecturerId: string;
    lecturerName: string | null;
  };

  const rows = await prisma.$queryRaw<RawRow[]>`
    SELECT
      es.id,
      es."unitCode",
      u.title        AS "unitName",
      es.date,
      es."startTime",
      es."endTime",
      es."roomCode",
      es."roomId",
      es."lessonType",
      es."lecturerId",
      l."fullName"   AS "lecturerName"
    FROM "extra_sessions" es
    LEFT JOIN "Unit" u
      ON UPPER(REPLACE(u.code, ' ', '')) = UPPER(REPLACE(es."unitCode", ' ', ''))
    LEFT JOIN "Department" d ON d.id = u."departmentId"
    LEFT JOIN "Lecturer" l ON l.id = es."lecturerId"
    WHERE es."deletedAt" IS NULL
      AND es.date >= ${windowStart}
      AND UPPER(REPLACE(es."unitCode", ' ', '')) = ANY(${enrolledCodes}::text[])
      AND (d."institutionId" = ${student.institutionId} OR d."institutionId" IS NULL)
    ORDER BY es.date ASC, es."startTime" ASC
  `;

  const result = rows.map((s) => ({
    id: s.id,
    sessionId: s.id,
    unitCode: normalize(s.unitCode),
    unitName: s.unitName ?? s.unitCode,
    date: s.date instanceof Date ? s.date.toISOString().slice(0, 10) : String(s.date).slice(0, 10),
    startTime: s.startTime,
    endTime: s.endTime,
    roomCode: s.roomCode ?? null,
    roomId: s.roomId ?? null,
    lessonType: s.lessonType,
    lecturerId: s.lecturerId,
    lecturerName: s.lecturerName ?? null,
    isExtraSession: true as const,
    status: "Confirmed",
  }));

  return NextResponse.json(result, { status: 200, headers: corsHeaders });
}
