import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { resolveAdminScope } from '@/lib/adminScope';
import { normalizeUnitCode } from '@/lib/unitCode';

export const runtime = 'nodejs';

/**
 * GET /api/attendance?institutionId=xxx
 *
 * Returns per-unit attendance summary for the institution.
 * Each record: { id (unitCode), unitCode, unitTitle, departmentId, present, total, rate }
 * Computed from OfflineAttendanceRecord grouped by unitCode.
 */
export async function GET(req: NextRequest) {
  const scope = await resolveAdminScope(req);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const institutionId = scope.institutionId;
  if (!institutionId) {
    return NextResponse.json({ error: 'Your account is not linked to an institution.' }, { status: 403 });
  }

  // Count attendance records grouped by unitCode for this institution
  const grouped = await prisma.offlineAttendanceRecord.groupBy({
    by: ['unitCode'],
    where: { institutionId },
    _count: { id: true },
  });

  // Build unit lookup for metadata (scoped to this institution via unitCodes already filtered above)
  const unitCodes = grouped.map(g => g.unitCode);
  const units = unitCodes.length > 0
    ? await prisma.unit.findMany({
        where: { code: { in: unitCodes } },
        select: { id: true, code: true, title: true, departmentId: true },
      })
    : [];
  const unitMap = new Map(units.map(u => [u.code, u]));
  const unitIds = units.map(u => u.id);

  // Count conducted sessions scoped to this institution's unit codes
  const [sessionGroups, enrollmentCounts] = await Promise.all([
    unitCodes.length > 0
      ? prisma.conductedSession.groupBy({
          by: ['unitCode'],
          where: { unitCode: { in: unitCodes } },
          _count: { id: true },
        })
      : Promise.resolve([] as { unitCode: string; _count: { id: number } }[]),
    unitIds.length > 0
      ? prisma.enrollment.groupBy({
          by: ['unitId'],
          where: { unitId: { in: unitIds } },
          _count: { studentId: true },
        })
      : Promise.resolve([] as { unitId: string; _count: { studentId: number } }[]),
  ]);

  const sessionMap = new Map(sessionGroups.map(s => [s.unitCode, s._count.id]));

  // Build unitId → enrolled count, then map to unitCode
  const unitIdToCode = new Map(units.map(u => [u.id, u.code]));
  const enrolledByUnitCode = new Map<string, number>();
  for (const ec of enrollmentCounts) {
    const code = unitIdToCode.get(ec.unitId);
    if (code) enrolledByUnitCode.set(code, ec._count.studentId);
  }

  const records = grouped.map(g => {
    const unit = unitMap.get(g.unitCode);
    const presentCount    = g._count.id;
    const sessionCount    = sessionMap.get(g.unitCode) ?? 0;
    const enrolledCount   = enrolledByUnitCode.get(g.unitCode) ?? 0;

    // Rate = total attendance marks / (sessions × enrolled students) × 100
    // Falls back to 0 when either denominator is unavailable.
    const rate = sessionCount > 0 && enrolledCount > 0
      ? Math.min(100, Math.round((presentCount / (sessionCount * enrolledCount)) * 100))
      : 0;

    return {
      id: normalizeUnitCode(g.unitCode),
      unitCode: normalizeUnitCode(g.unitCode),
      unitTitle: unit?.title ?? g.unitCode,
      departmentId: unit?.departmentId ?? null,
      present: presentCount,
      total: sessionCount,
      enrolled: enrolledCount,
      rate,
    };
  });

  return NextResponse.json({ records });
}
