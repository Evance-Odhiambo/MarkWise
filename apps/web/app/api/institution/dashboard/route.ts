/**
 * GET /api/institution/dashboard?institutionId=xxx
 *
 * Aggregates institution-wide KPIs and department health rankings for the
 * main institution-admin dashboard overview page.
 *
 * Uses real data from:
 *  - Departments, Students, Lecturers, Rooms
 *  - OfflineAttendanceRecord + ConductedSession → attendance rates
 *  - Booking → space utilization
 *  - Assignment + Submission + Enrollment → submission rates
 *  - Group + GroupMember → study group metrics
 *  - Material + MaterialView + Enrollment → material access
 *  - Notification → read rates
 *  - Timetable → conflict counts
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma, withRetry } from "@/lib/prisma";
import { resolveAdminScope } from "@/lib/adminScope";

export const runtime = "nodejs";

function statusColor(value: number, goodThreshold: number, warnThreshold: number) {
  if (value >= goodThreshold) return "green";
  if (value >= warnThreshold) return "amber";
  return "red";
}

/** Detect overlapping timetable entries within same room+day using sort + single pass (O(n log n)) */
function detectTimetableConflicts(
  entries: { id: string; startMinute: number; endMinute: number; roomId: string; day: string; departmentId: string }[]
): Map<string, number> {
  const byRoomDay = new Map<string, typeof entries>();
  for (const e of entries) {
    const key = `${e.roomId}::${e.day}`;
    const list = byRoomDay.get(key) ?? [];
    list.push(e);
    byRoomDay.set(key, list);
  }
  const conflictsByDept = new Map<string, Set<string>>();
  for (const [, group] of byRoomDay) {
    // Sort by startMinute once — then a single pass detects all overlaps
    const sorted = group.slice().sort((a, b) => a.startMinute - b.startMinute);
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i];
      const b = sorted[i + 1];
      if (a.endMinute > b.startMinute) {
        const dA = conflictsByDept.get(a.departmentId) ?? new Set<string>();
        dA.add(a.id); dA.add(b.id);
        conflictsByDept.set(a.departmentId, dA);
        if (b.departmentId !== a.departmentId) {
          const dB = conflictsByDept.get(b.departmentId) ?? new Set<string>();
          dB.add(a.id); dB.add(b.id);
          conflictsByDept.set(b.departmentId, dB);
        }
      }
    }
  }
  const result = new Map<string, number>();
  for (const [deptId, ids] of conflictsByDept) {
    result.set(deptId, ids.size);
  }
  return result;
}

export async function GET(req: NextRequest) {
  const scope = await resolveAdminScope(req);
  if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status });

  const { searchParams } = new URL(req.url);
  const institutionId = searchParams.get("institutionId") ?? scope.institutionId;
  if (!institutionId) {
    return NextResponse.json({ error: "institutionId required" }, { status: 400 });
  }

  // ── Parallel fetches ───────────────────────────────────────────────────────

  const [
    departments,
    students,
    lecturers,
    rooms,
    timetableEntries,
    conductedSessions,
    attendanceRecords,
    groups,
    groupMembers,
    enrollments,
    materials,
    materialViews,
    units,
  ] = await withRetry(() => Promise.all([
    prisma.department.findMany({
      where: { institutionId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.student.findMany({
      where: { institutionId },
      select: { id: true, departmentId: true },
    }),
    prisma.lecturer.findMany({
      where: { institutionId },
      select: { id: true },
    }),
    prisma.room.findMany({
      where: { institutionId },
      select: { id: true, buildingCode: true, name: true, capacity: true, status: true },
    }),
    prisma.sharedSession.findMany({
      where: { institutionId },
      select: {
        id: true,
        day: true,
        startMinute: true,
        endMinute: true,
        roomId: true,
        timetables: {
          select: {
            unitOffering: { select: { course: { select: { departmentId: true } } } },
          },
          take: 1,
        },
      },
    }),
    prisma.conductedSession.groupBy({
      by: ["unitCode"],
      _count: { id: true },
    }),
    prisma.offlineAttendanceRecord.groupBy({
      by: ["unitCode"],
      where: { institutionId },
      _count: { id: true },
    }),
    prisma.group.findMany({
      where: { unit: { department: { institutionId } } },
      select: { id: true, unitId: true, updatedAt: true, unit: { select: { departmentId: true } } },
    }),
    prisma.groupMember.findMany({
      where: { group: { unit: { department: { institutionId } } }, leftAt: null },
      select: { id: true, groupId: true, studentId: true },
    }),
    prisma.enrollment.findMany({
      where: { unit: { department: { institutionId } } },
      select: { studentId: true, unitId: true },
    }),
    prisma.material.findMany({
      where: { unit: { department: { institutionId } } },
      select: { id: true, unitId: true },
    }),
    prisma.materialView.findMany({
      where: { material: { unit: { department: { institutionId } } } },
      select: { materialId: true, studentId: true },
    }),
    prisma.unit.findMany({
      where: { department: { institutionId } },
      select: { id: true, code: true, departmentId: true },
    }),
  ]));

  // ── Stage 2: scoped by unitIds / studentIds ────────────────────────────────
  const unitIds = units.map(u => u.id);
  const studentIds = students.map(s => s.id);

  const [assignments, submissions, notifications] = await withRetry(() => Promise.all([
    prisma.assignment.findMany({
      where: { unitId: { in: unitIds } },
      select: { id: true, unitId: true },
    }),
    prisma.submission.findMany({
      where: { assignment: { unitId: { in: unitIds } } },
      select: { id: true, assignmentId: true, studentId: true, submittedAt: true },
    }),
    prisma.notification.findMany({
      where: { userId: { in: studentIds } },
      select: { read: true },
    }).catch(() => [] as { read: boolean }[]),
  ]));

  // ── Build lookup maps ──────────────────────────────────────────────────────

  const sessionMap = new Map(conductedSessions.map(s => [s.unitCode, s._count.id]));
  const attendMap = new Map(attendanceRecords.map(a => [a.unitCode, a._count.id]));

  const unitMap = new Map(units.map(u => [u.id, u]));
  const unitByCode = new Map(units.map(u => [u.code, u]));

  // Conflict detection — map SharedSession rows into the shape detectTimetableConflicts expects
  const conflictEntries = timetableEntries.flatMap(ss =>
    (ss.timetables ?? []).map(t => ({
      id:           ss.id,
      startMinute:  ss.startMinute,
      endMinute:    ss.endMinute,
      roomId:       ss.roomId,
      day:          ss.day as string,
      departmentId: t.unitOffering?.course?.departmentId ?? "",
    }))
  );
  const conflictsPerDept = detectTimetableConflicts(conflictEntries);

  // ── Pre-build lookup Maps for O(1) per-dept lookups ──────────────────────

  const studentsByDept = new Map<string, typeof students>();
  for (const s of students) {
    if (!studentsByDept.has(s.departmentId)) studentsByDept.set(s.departmentId, []);
    studentsByDept.get(s.departmentId)!.push(s);
  }

  const unitsByDept = new Map<string, typeof units>();
  for (const u of units) {
    if (!unitsByDept.has(u.departmentId)) unitsByDept.set(u.departmentId, []);
    unitsByDept.get(u.departmentId)!.push(u);
  }

  const groupsByDept = new Map<string, typeof groups>();
  for (const g of groups) {
    const dId = g.unit?.departmentId;
    if (!dId) continue;
    if (!groupsByDept.has(dId)) groupsByDept.set(dId, []);
    groupsByDept.get(dId)!.push(g);
  }

  const enrollmentsByUnit = new Map<string, number>();
  for (const e of enrollments) {
    enrollmentsByUnit.set(e.unitId, (enrollmentsByUnit.get(e.unitId) ?? 0) + 1);
  }

  const assignmentsByDept = new Map<string, typeof assignments>();
  for (const a of assignments) {
    const dId = unitMap.get(a.unitId)?.departmentId;
    if (!dId) continue;
    if (!assignmentsByDept.has(dId)) assignmentsByDept.set(dId, []);
    assignmentsByDept.get(dId)!.push(a);
  }

  const submissionsByAssignment = new Map<string, number>();
  for (const s of submissions) {
    submissionsByAssignment.set(s.assignmentId, (submissionsByAssignment.get(s.assignmentId) ?? 0) + 1);
  }

  const materialsByDept = new Map<string, typeof materials>();
  for (const m of materials) {
    const dId = unitMap.get(m.unitId)?.departmentId;
    if (!dId) continue;
    if (!materialsByDept.has(dId)) materialsByDept.set(dId, []);
    materialsByDept.get(dId)!.push(m);
  }

  const viewsByMaterial = new Map<string, Set<string>>();
  for (const v of materialViews) {
    if (!viewsByMaterial.has(v.materialId)) viewsByMaterial.set(v.materialId, new Set());
    viewsByMaterial.get(v.materialId)!.add(v.studentId);
  }

  const groupMembersByGroup = new Map<string, typeof groupMembers>();
  for (const m of groupMembers) {
    if (!groupMembersByGroup.has(m.groupId)) groupMembersByGroup.set(m.groupId, []);
    groupMembersByGroup.get(m.groupId)!.push(m);
  }

  // ── Per-department calculations ────────────────────────────────────────────

  interface DeptStats {
    id: string;
    name: string;
    totalStudents: number;
    totalLecturers: number;
    attendance: number;
    studyGroups: number;
    studyGroupParticipation: number;
    submissionRate: number;
    materialAccess: number;
    timetableConflicts: number;
  }

  const deptStats: DeptStats[] = departments.map(dept => {
    const deptStudents = studentsByDept.get(dept.id) ?? [];
    const totalStudents = deptStudents.length;
    const studentIdSet = new Set(deptStudents.map(s => s.id));

    // Attendance
    const deptUnits = unitsByDept.get(dept.id) ?? [];
    let totalExpected = 0, totalPresent = 0;
    for (const u of deptUnits) {
      const sessions = sessionMap.get(u.code) ?? 0;
      const enrolled = enrollmentsByUnit.get(u.id) ?? 0;
      const present = attendMap.get(u.code) ?? 0;
      if (sessions > 0 && enrolled > 0) {
        totalExpected += sessions * enrolled;
        totalPresent += present;
      }
    }
    const attendance = totalExpected > 0
      ? Math.min(100, Math.round((totalPresent / totalExpected) * 100))
      : 0;

    // Study groups
    const deptGroups = groupsByDept.get(dept.id) ?? [];
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const activeGroups = deptGroups.filter(g => g.updatedAt > twoWeeksAgo);
    const studyGroups = activeGroups.length;
    const groupIdSet = new Set(deptGroups.map(g => g.id));
    const uniqueStudentsInGroups = new Set(
      [...groupIdSet].flatMap(gId =>
        (groupMembersByGroup.get(gId) ?? [])
          .filter(m => studentIdSet.has(m.studentId))
          .map(m => m.studentId)
      )
    ).size;
    const studyGroupParticipation = totalStudents > 0
      ? Math.round((uniqueStudentsInGroups / totalStudents) * 100)
      : 0;

    // Submission rate
    const deptAssignments = assignmentsByDept.get(dept.id) ?? [];
    const deptSubmissionCount = deptAssignments.reduce(
      (sum, a) => sum + (submissionsByAssignment.get(a.id) ?? 0), 0
    );
    const expectedSubmissions = deptAssignments.length * (totalStudents || 1);
    const submissionRate = expectedSubmissions > 0
      ? Math.min(100, Math.round((deptSubmissionCount / expectedSubmissions) * 100))
      : 0;

    // Material access
    const deptMaterials = materialsByDept.get(dept.id) ?? [];
    const uniqueViewers = new Set(
      deptMaterials.flatMap(m =>
        [...(viewsByMaterial.get(m.id) ?? [])].filter(sid => studentIdSet.has(sid))
      )
    ).size;
    const materialAccess = totalStudents > 0
      ? Math.min(100, Math.round((uniqueViewers / totalStudents) * 100))
      : 0;

    return {
      id: dept.id,
      name: dept.name,
      totalStudents,
      totalLecturers: 0,
      attendance,
      studyGroups,
      studyGroupParticipation,
      submissionRate,
      materialAccess,
      timetableConflicts: conflictsPerDept.get(dept.id) ?? 0,
    };
  });

  // ── Institution-wide KPIs ──────────────────────────────────────────────────

  const avgAttendance = deptStats.length > 0
    ? Math.round(deptStats.reduce((s, d) => s + d.attendance, 0) / deptStats.length)
    : 0;
  const avgSubmission = deptStats.length > 0
    ? Math.round(deptStats.reduce((s, d) => s + d.submissionRate, 0) / deptStats.length)
    : 0;
  const avgMaterial = deptStats.length > 0
    ? Math.round(deptStats.reduce((s, d) => s + d.materialAccess, 0) / deptStats.length)
    : 0;
  const totalActiveGroups = deptStats.reduce((s, d) => s + d.studyGroups, 0);

  // Space utilization: rooms with active bookings in next 7 days / total rooms
  const now = new Date();
  const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const activeBookings = await prisma.roomReservation.findMany({
    where: {
      room: { institutionId },
      status: "active",
      startAt: { gte: now, lte: sevenDaysLater },
    },
    select: { roomId: true },
    distinct: ["roomId"],
  });
  const spaceUtil = rooms.length > 0
    ? Math.round((activeBookings.length / rooms.length) * 100)
    : 0;

  // Notification read rate
  const totalNotifs = notifications.length;
  const readNotifs = notifications.filter(n => n.read).length;
  const notifReadRate = totalNotifs > 0 ? Math.round((readNotifs / totalNotifs) * 100) : 0;

  // Building utilization breakdown
  const buildingMap = new Map<string, { total: number; active: number }>();
  for (const r of rooms) {
    const code = r.buildingCode || "Unknown";
    const b = buildingMap.get(code) ?? { total: 0, active: 0 };
    b.total++;
    if (r.status === "occupied" || r.status === "reserved") b.active++;
    buildingMap.set(code, b);
  }
  const buildings = [...buildingMap.entries()].map(([building, v]) => ({
    building,
    total: v.total,
    active: v.active,
    rate: v.total > 0 ? Math.round((v.active / v.total) * 100) : 0,
  })).sort((a, b) => b.rate - a.rate);

  // Alerts generation
  const alerts: { level: "critical" | "warning" | "info"; message: string }[] = [];
  for (const d of deptStats) {
    if (d.attendance > 0 && d.attendance < 70)
      alerts.push({ level: "critical", message: `${d.name}: attendance ${d.attendance}% is below 70% threshold` });
    if (d.submissionRate > 0 && d.submissionRate < 65)
      alerts.push({ level: "critical", message: `${d.name}: assignment submission rate ${d.submissionRate}% is critically low` });
    if (d.timetableConflicts > 20)
      alerts.push({ level: "critical", message: `${d.name}: ${d.timetableConflicts} timetable conflicts detected` });
    if (d.attendance >= 70 && d.attendance < 80)
      alerts.push({ level: "warning", message: `${d.name}: attendance ${d.attendance}% is below 80% target` });
    if (d.materialAccess > 0 && d.materialAccess < 60)
      alerts.push({ level: "warning", message: `${d.name}: material access ${d.materialAccess}% needs improvement` });
    if (d.studyGroups === 0)
      alerts.push({ level: "warning", message: `${d.name}: no active study groups in the past 2 weeks` });
    if (d.attendance >= 85)
      alerts.push({ level: "info", message: `${d.name}: achieving ${d.attendance}% attendance — excellent performance` });
  }
  const underutilizedBuildings = buildings.filter(b => b.rate < 50);
  if (underutilizedBuildings.length > 0)
    alerts.push({ level: "warning", message: `${underutilizedBuildings.length} building(s) below 50% utilization` });

  return NextResponse.json({
    kpis: {
      attendanceRate: avgAttendance,
      spaceUtilization: spaceUtil,
      submissionRate: avgSubmission,
      activeGroups: totalActiveGroups,
      materialAccess: avgMaterial,
      notifReadRate,
      totalStudents: students.length,
      totalLecturers: lecturers.length,
      totalRooms: rooms.length,
      totalDepartments: departments.length,
    },
    departments: deptStats.sort((a, b) => b.attendance - a.attendance),
    buildings,
    alerts,
  });
}
