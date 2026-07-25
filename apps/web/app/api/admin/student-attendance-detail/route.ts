/**
 * GET /api/admin/student-attendance-detail?departmentId=X&studentId=Y
 *
 * Returns full per-unit attendance breakdown for a single student, using the
 * same logic as the analytics endpoint's studentStats computation.
 *
 * Auth: admin JWT (Bearer or admin_auth_token cookie)
 *
 * Response shape:
 * {
 *   studentId, studentName, admissionNumber, year, department,
 *   overallAttendance,   // 0–100
 *   riskLevel,           // "none" | "watch" | "warning" | "critical"
 *   perCourseAttendance: Record<normCode, { sessions: number; attended: number }>,
 *   unitTitleMap:        Record<normCode, string>,
 * }
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveAdminScope } from "@/lib/adminScope";
import { normalizeUnitCode } from "@/lib/unitCode";

export const runtime = "nodejs";

function riskLevel(pct: number): "none" | "watch" | "warning" | "critical" {
  if (pct >= 75) return "none";
  if (pct >= 60) return "watch";
  if (pct >= 40) return "warning";
  return "critical";
}

export async function GET(req: NextRequest) {
  const scope = await resolveAdminScope(req);
  if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status });

  const { searchParams } = new URL(req.url);
  const departmentId = searchParams.get("departmentId") ?? scope.departmentId ?? null;
  const studentId    = searchParams.get("studentId") ?? null;

  if (!departmentId) {
    return NextResponse.json({ error: "departmentId required" }, { status: 400 });
  }
  if (!studentId) {
    return NextResponse.json({ error: "studentId required" }, { status: 400 });
  }

  // Dept-admin scope guard
  if (scope.departmentId && scope.departmentId !== departmentId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // ── Load the student ──────────────────────────────────────────────────────
  const student = await prisma.student.findFirst({
    where: { id: studentId, departmentId },
    select: {
      id:              true,
      name:            true,
      admissionNumber: true,
      year:            true,
      department:      { select: { name: true } },
    },
  });
  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  // ── Units in this department ──────────────────────────────────────────────
  const units = await prisma.unit.findMany({
    where: { departmentId },
    select: { id: true, code: true, title: true },
  });
  const unitByNormCode = new Map(units.map(u => [normalizeUnitCode(u.code), u]));
  const unitCodes = units.map(u => normalizeUnitCode(u.code));

  // ── Enrollment snapshot for this student ─────────────────────────────────
  const snapshot = await prisma.studentEnrollmentSnapshot.findUnique({
    where: { studentId: student.id },
    select: { unitCodes: true },
  });
  const enrolledNormCodes = (snapshot?.unitCodes ?? [])
    .map(c => normalizeUnitCode(c))
    .filter(c => unitByNormCode.has(c)); // restrict to this dept

  // ── Conducted sessions per unit code (scoped to dept units only) ──────────
  const conductedSessions = await prisma.conductedSession.findMany({
    where: { unitCode: { in: unitCodes } },
    select: { unitCode: true },
  });
  const sessionsPerCode = new Map<string, number>();
  for (const cs of conductedSessions) {
    const code = normalizeUnitCode(cs.unitCode);
    sessionsPerCode.set(code, (sessionsPerCode.get(code) ?? 0) + 1);
  }

  // ── Attendance records for this student across enrolled units ─────────────
  const attendanceRecords = await prisma.offlineAttendanceRecord.findMany({
    where: {
      studentId: student.id,
      unitCode:  { in: unitCodes },
    },
    select: { unitCode: true },
  });
  const recordsByCode = new Map<string, number>();
  for (const r of attendanceRecords) {
    const code = normalizeUnitCode(r.unitCode);
    recordsByCode.set(code, (recordsByCode.get(code) ?? 0) + 1);
  }

  // ── Build per-unit breakdown ──────────────────────────────────────────────
  const perCourseAttendance: Record<string, { sessions: number; attended: number }> = {};
  const unitTitleMap: Record<string, string> = {};
  let totalSessions = 0;
  let totalAttended = 0;

  for (const code of enrolledNormCodes) {
    const sessions = sessionsPerCode.get(code) ?? 0;
    const attended = Math.min(recordsByCode.get(code) ?? 0, sessions);
    perCourseAttendance[code] = { sessions, attended };
    totalSessions += sessions;
    totalAttended += attended;
    const unit = unitByNormCode.get(code);
    if (unit) unitTitleMap[code] = unit.title;
  }

  const overallAttendance = totalSessions > 0
    ? Math.round((totalAttended / totalSessions) * 100)
    : 0;

  return NextResponse.json({
    studentId:        student.id,
    studentName:      student.name,
    admissionNumber:  student.admissionNumber,
    year:             student.year,
    department:       student.department?.name ?? "—",
    overallAttendance,
    riskLevel:        riskLevel(overallAttendance),
    perCourseAttendance,
    unitTitleMap,
  });
}
