import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { resolveAdminScope } from '@/lib/adminScope';
import { computeGamification } from '@/lib/gamificationEngine';
import type { GamificationStats } from '@/lib/gamificationEngine';

export const runtime = 'nodejs';

export interface UnitAttendanceRow {
  unitCode: string;
  unitTitle: string;
  attended: number;
  total: number;
  pct: number;
}

// GET /api/students/[id]/points
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const scope = await resolveAdminScope(req);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const { id: studentId } = await context.params;

  // Verify student exists and belongs to this admin's scope
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { id: true, institutionId: true, departmentId: true },
  });
  if (!student) {
    return NextResponse.json({ error: 'Student not found' }, { status: 404 });
  }
  if (!scope.isInstitutionAdmin) {
    if (!scope.departmentId || scope.departmentId !== student.departmentId) {
      return NextResponse.json({ error: 'Access denied.' }, { status: 403 });
    }
  } else {
    if (scope.institutionId && student.institutionId !== scope.institutionId) {
      return NextResponse.json({ error: 'Access denied.' }, { status: 403 });
    }
  }

  const [cached, enrollments] = await Promise.all([
    prisma.studentPoints.findUnique({
      where: { studentId },
      select: {
        totalPoints: true,
        currentStreak: true,
        longestStreak: true,
        attendancePct: true,
        statsJson: true,
        computedAt: true,
      },
    }),
    prisma.enrollment.findMany({
      where: { studentId },
      select: { unit: { select: { id: true, code: true, title: true } } },
    }),
  ]);

  const enrolledUnitCodes = enrollments.map((e) => e.unit.code.trim().toUpperCase());

  // Build unit code → title map from enrollments
  const unitTitleMap = new Map<string, string>();
  for (const e of enrollments) {
    unitTitleMap.set(e.unit.code.trim().toUpperCase(), e.unit.title);
  }

  // Extract unitAttendance from cached statsJson if available,
  // otherwise compute fresh from the gamification engine.
  let rawUnitAttendance: Record<string, { attended: number; total: number }> | null = null;

  if (cached?.statsJson) {
    const stats = cached.statsJson as unknown as GamificationStats;
    rawUnitAttendance = stats.unitAttendance ?? null;
  }

  if (!rawUnitAttendance) {
    // Cache miss or legacy record — compute fresh (no write-back needed here)
    const fresh = await computeGamification(studentId);
    rawUnitAttendance = fresh.stats.unitAttendance;
  }

  // Filter to only enrolled units and enrich with titles
  const enrolledSet = new Set(enrolledUnitCodes);
  const unitAttendance: UnitAttendanceRow[] = Object.entries(rawUnitAttendance)
    .filter(([uc]) => enrolledSet.size === 0 || enrolledSet.has(uc.trim().toUpperCase()))
    .map(([uc, { attended, total }]) => ({
      unitCode: uc,
      unitTitle: unitTitleMap.get(uc.trim().toUpperCase()) ?? '',
      attended,
      total,
      pct: total > 0 ? Math.round((attended / total) * 100) : 0,
    }))
    .sort((a, b) => a.unitCode.localeCompare(b.unitCode));

  return NextResponse.json({
    points: cached
      ? {
          totalPoints: cached.totalPoints,
          currentStreak: cached.currentStreak,
          longestStreak: cached.longestStreak,
          attendancePct: cached.attendancePct,
          computedAt: cached.computedAt,
        }
      : null,
    enrolledUnitCodes,
    unitAttendance,
  });
}
