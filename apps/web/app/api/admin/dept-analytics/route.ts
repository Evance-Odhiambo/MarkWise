/**
 * GET /api/admin/dept-analytics?departmentId=xxx
 *
 * Returns actionable analytics for a department admin dashboard:
 *
 *  - Lecturer workload (contact hours/week per lecturer)
 *  - At-risk students  (0 attendance records in last 30 days, enrolled ≥1 unit)
 *  - Ghost sessions    (timetable entries with no matching ConductedSession this week)
 *  - Unit coverage     (units in curriculum with no timetable entry)
 *  - Attendance method breakdown (qr / ble / manual / manual_lecturer)
 *  - Assignment completion rate per unit
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveAdminScope } from "@/lib/adminScope";
import { normalizeUnitCode } from "@/lib/unitCode";

export const runtime = "nodejs";

function minutesBetween(s: string, e: string): number {
  const [sh, sm] = s.split(":").map(Number);
  const [eh, em] = e.split(":").map(Number);
  return Math.max(0, (eh * 60 + em) - (sh * 60 + sm));
}

export async function GET(req: NextRequest) {
  const scope = await resolveAdminScope(req);
  if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status });

  const { searchParams } = new URL(req.url);
  const departmentId = searchParams.get("departmentId") ?? scope.departmentId;
  if (!departmentId) {
    return NextResponse.json({ error: "departmentId required" }, { status: 400 });
  }

  // ── Fetch base data in parallel ────────────────────────────────────────────
  const [
    lecturers,
    timetableEntries,
    units,
    enrollments,
  ] = await Promise.all([
    prisma.lecturer.findMany({
      where: { timetables: { some: { unitOffering: { course: { departmentId } } } } },
      select: { id: true, fullName: true },
    }),
    prisma.timetable.findMany({
      where: { unitOffering: { course: { departmentId } } },
      select: {
        id: true,
        lecturerId: true,
        unitOffering: { select: { unitId: true, unit: { select: { code: true, title: true } } } },
        sharedSession: { select: { day: true, startMinute: true, endMinute: true } },
        lecturer: { select: { fullName: true } },
      },
    }),
    prisma.unit.findMany({
      where: { departmentId },
      select: { id: true, code: true, title: true },
    }),
    prisma.enrollment.findMany({
      where: { unit: { departmentId } },
      select: { studentId: true, unitId: true },
    }),
  ]);

  const unitIds = units.map(u => u.id);
  const unitCodes = units.map(u => normalizeUnitCode(u.code));
  const studentIds = [...new Set(enrollments.map(e => e.studentId))];

  // Window for ghost session detection: current week (Mon–Sun)
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun
  const monday = new Date(now);
  monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [
    conductedThisWeek,
    offlineRecords,
    lastAttendanceByStudent,
    assignments,
    submissions,
  ] = await Promise.all([
    // Sessions conducted this week for these unit codes
    prisma.conductedSession.findMany({
      where: {
        unitCode: { in: unitCodes },
        sessionStart: { gte: monday, lte: sunday },
      },
      select: { unitCode: true, lecturerId: true, lectureRoom: true, sessionStart: true },
    }),

    // Offline attendance records for method breakdown
    prisma.offlineAttendanceRecord.findMany({
      where: { unitCode: { in: unitCodes } },
      select: { method: true, unitCode: true, studentId: true },
    }),

    // Most recent attendance per student (last 30 days)
    studentIds.length > 0
      ? prisma.offlineAttendanceRecord.groupBy({
          by: ["studentId"],
          where: { studentId: { in: studentIds }, scannedAt: { gte: thirtyDaysAgo } },
          _max: { scannedAt: true },
        })
      : Promise.resolve([]),

    prisma.assignment.findMany({
      where: { unitId: { in: unitIds }, status: "active" },
      select: { id: true, unitId: true, title: true },
    }),

    prisma.submission.findMany({
      where: { assignment: { unitId: { in: unitIds } } },
      select: { assignmentId: true, studentId: true, status: true },
    }),
  ]);

  // Helper: convert minutes-from-midnight to HH:mm string
  function minutesToHHMM(m: number): string {
    return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  }

  // DayOfWeek enum → display string
  const DOW_TO_DISPLAY: Record<string, string> = {
    MON: "Monday", TUE: "Tuesday", WED: "Wednesday",
    THU: "Thursday", FRI: "Friday", SAT: "Saturday", SUN: "Sunday",
  };

  // ── 1. Lecturer workload ─────────────────────────────────────────────────
  const workloadMap = new Map<string, { name: string; entries: number; hoursPerWeek: number; units: Set<string> }>();
  for (const entry of timetableEntries) {
    if (!entry.lecturerId) continue;
    const lec = lecturers.find(l => l.id === entry.lecturerId);
    if (!lec) continue;
    const w = workloadMap.get(entry.lecturerId) ?? { name: lec.fullName, entries: 0, hoursPerWeek: 0, units: new Set() };
    w.entries++;
    const startMin = entry.sharedSession?.startMinute ?? 0;
    const endMin   = entry.sharedSession?.endMinute ?? 0;
    w.hoursPerWeek += Math.max(0, endMin - startMin) / 60;
    const unitCode = entry.unitOffering?.unit?.code;
    if (unitCode) w.units.add(unitCode);
    workloadMap.set(entry.lecturerId, w);
  }
  const lecturerWorkload = [...workloadMap.entries()].map(([id, w]) => ({
    lecturerId: id,
    name: w.name,
    weeklyEntries: w.entries,
    hoursPerWeek: Math.round(w.hoursPerWeek * 10) / 10,
    unitCount: w.units.size,
    status: w.hoursPerWeek > 20 ? "overloaded" : w.hoursPerWeek < 4 ? "underutilised" : "normal",
  })).sort((a, b) => b.hoursPerWeek - a.hoursPerWeek);

  // ── 2. At-risk students (no attendance in 30 days) ───────────────────────
  const attendedSet = new Set((lastAttendanceByStudent as { studentId: string }[]).map(r => r.studentId));
  const atRiskStudentIds = studentIds.filter(id => !attendedSet.has(id));

  // Fetch names for at-risk students (cap at 50 for response size)
  const atRiskStudents = atRiskStudentIds.length > 0
    ? await prisma.student.findMany({
        where: { id: { in: atRiskStudentIds.slice(0, 50) } },
        select: { id: true, name: true, admissionNumber: true, year: true },
      })
    : [];

  // ── 3. Ghost sessions — timetable entries with no matching conducted session this week ─
  const conductedKeys = new Set(
    conductedThisWeek.map(s => `${normalizeUnitCode(s.unitCode)}::${s.lecturerId}`)
  );
  const todayWeekday = dayOfWeek === 0 ? 7 : dayOfWeek; // 1=Mon…7=Sun

  // Map DayOfWeek enum values to weekday numbers (1=Mon…7=Sun)
  const DOW_TO_WEEKDAY: Record<string, number> = {
    MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6, SUN: 7,
  };

  const ghostSessions = timetableEntries
    .filter(e => {
      const dow = e.sharedSession?.day ?? "";
      const entryWeekday = DOW_TO_WEEKDAY[dow] ?? 0;
      // Only count days that have already passed this week
      if (entryWeekday > todayWeekday) return false;
      const key = `${normalizeUnitCode(e.unitOffering?.unit?.code ?? "")}::${e.lecturerId}`;
      return !conductedKeys.has(key);
    })
    .map(e => {
      const dow = e.sharedSession?.day ?? "";
      return {
        timetableId: e.id,
        day: DOW_TO_DISPLAY[dow] ?? dow,
        startTime: minutesToHHMM(e.sharedSession?.startMinute ?? 0),
        endTime:   minutesToHHMM(e.sharedSession?.endMinute ?? 0),
        unitCode:  normalizeUnitCode(e.unitOffering?.unit?.code ?? ""),
        unitTitle: e.unitOffering?.unit?.title ?? "",
        lecturerName: e.lecturer?.fullName ?? "",
      };
    });

  // ── 4. Unit coverage gaps — units with no timetable entry ───────────────
  const scheduledUnitIds = new Set(timetableEntries.map(e => e.unitOffering?.unitId).filter(Boolean));
  const uncoveredUnits = units
    .filter(u => !scheduledUnitIds.has(u.id))
    .map(u => ({ unitId: u.id, code: normalizeUnitCode(u.code), title: u.title }));

  // ── 5. Attendance method breakdown ───────────────────────────────────────
  const methodCounts: Record<string, number> = {};
  for (const r of offlineRecords) {
    methodCounts[r.method] = (methodCounts[r.method] ?? 0) + 1;
  }
  const totalOffline = offlineRecords.length;
  const methodBreakdown = Object.entries(methodCounts).map(([method, count]) => ({
    method,
    count,
    pct: totalOffline > 0 ? Math.round((count / totalOffline) * 100) : 0,
  })).sort((a, b) => b.count - a.count);

  // Flag high manual rate (>30%) as a risk signal
  const manualCount = (methodCounts["manual"] ?? 0) + (methodCounts["manual_lecturer"] ?? 0);
  const manualRisk = totalOffline > 10 && (manualCount / totalOffline) > 0.3;

  // ── 6. Assignment completion per unit ────────────────────────────────────
  const assignmentByUnit = new Map<string, { title: string; ids: string[] }>();
  for (const a of assignments) {
    const unit = units.find(u => u.id === a.unitId);
    if (!unit) continue;
    const key = unit.code;
    const entry = assignmentByUnit.get(key) ?? { title: unit.title, ids: [] };
    entry.ids.push(a.id);
    assignmentByUnit.set(key, entry);
  }

  const submittedSet = new Set(
    submissions.filter(s => ["submitted", "graded"].includes(s.status)).map(s => s.assignmentId + "::" + s.studentId)
  );

  const assignmentCompletion = [...assignmentByUnit.entries()].map(([code, { title, ids }]) => {
    const unitEnrolled = enrollments.filter(e => units.find(u => u.code === code && u.id === e.unitId)).length;
    const expected = ids.length * unitEnrolled;
    const actual = submissions.filter(s => ids.includes(s.assignmentId) && ["submitted", "graded"].includes(s.status)).length;
    const rate = expected > 0 ? Math.min(100, Math.round((actual / expected) * 100)) : 0;
    return {
      unitCode: normalizeUnitCode(code),
      unitTitle: title,
      assignmentCount: ids.length,
      completionRate: rate,
      status: rate < 50 ? "low" : rate < 75 ? "fair" : "good",
    };
  }).sort((a, b) => a.completionRate - b.completionRate);

  // ── Summary KPIs ──────────────────────────────────────────────────────────
  const avgAttendanceRate = (() => {
    // sessions × enrolled students = expected; offlineRecords = present
    const sessionsByCode = new Map<string, number>();
    for (const s of conductedThisWeek) {
      const k = normalizeUnitCode(s.unitCode);
      sessionsByCode.set(k, (sessionsByCode.get(k) ?? 0) + 1);
    }
    let totalExpected = 0, totalPresent = 0;
    for (const [code, sessions] of sessionsByCode) {
      const unit = units.find(u => normalizeUnitCode(u.code) === code);
      if (!unit) continue;
      const enrolled = enrollments.filter(e => e.unitId === unit.id).length;
      totalExpected += sessions * enrolled;
      totalPresent += offlineRecords.filter(r => normalizeUnitCode(r.unitCode) === code).length;
    }
    return totalExpected > 0 ? Math.min(100, Math.round((totalPresent / totalExpected) * 100)) : null;
  })();

  const avgCompletion = assignmentCompletion.length > 0
    ? Math.round(assignmentCompletion.reduce((s, a) => s + a.completionRate, 0) / assignmentCompletion.length)
    : null;

  return NextResponse.json({
    summary: {
      totalUnits: units.length,
      totalEnrolled: studentIds.length,
      atRiskCount: atRiskStudentIds.length,
      ghostSessionsThisWeek: ghostSessions.length,
      uncoveredUnitsCount: uncoveredUnits.length,
      attendanceRate: avgAttendanceRate,
      assignmentCompletionRate: avgCompletion,
      manualAttendanceRisk: manualRisk,
    },
    lecturerWorkload,
    atRiskStudents,
    ghostSessions,
    uncoveredUnits,
    methodBreakdown,
    assignmentCompletion,
  });
}
