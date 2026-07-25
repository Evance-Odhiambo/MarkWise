/**
 * GET /api/admin/attendance-analytics
 *
 * Scoped attendance analytics for both academic-registrar (institution-wide)
 * and department-admin (single-department) views.
 *
 * Query params:
 *   institutionId  – required for institution-level scope
 *   departmentId   – required for department-level scope (also accepted by institution admin for drill-down)
 *   days           – lookback window in days (default 30)
 *
 * Response shape: { lecturers, students, methods, overview }
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveAdminScope } from "@/lib/adminScope";
import { normalizeUnitCode } from "@/lib/unitCode";

export const runtime = "nodejs";

function minutesBetween(s: string, e: string): number {
  const [sh, sm] = s.split(":").map(Number);
  const [eh, em] = e.split(":").map(Number);
  return Math.max(0, eh * 60 + em - (sh * 60 + sm));
}

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
  const institutionId = searchParams.get("institutionId") ?? scope.institutionId;
  const departmentId  = searchParams.get("departmentId")  ?? scope.departmentId ?? null;
  const days          = Math.min(365, Math.max(7, Number(searchParams.get("days") ?? "30")));

  if (!institutionId) {
    return NextResponse.json({ error: "institutionId required" }, { status: 400 });
  }

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // ── Resolve scoped departments ────────────────────────────────────────────
  const deptWhere = departmentId
    ? { id: departmentId, institutionId }
    : { institutionId };

  const departments = await prisma.department.findMany({
    where: deptWhere,
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const deptIds = departments.map(d => d.id);

  // ── Parallel base fetches ─────────────────────────────────────────────────
  const [units, lecturers, students, timetables] =
    await Promise.all([
      prisma.unit.findMany({
        where: { departmentId: { in: deptIds } },
        select: { id: true, code: true, title: true, departmentId: true },
      }),
      prisma.lecturer.findMany({
        where: { timetables: { some: { unitOffering: { course: { departmentId: { in: deptIds } } } } } },
        select: { id: true, fullName: true },
      }),
      prisma.student.findMany({
        where: { departmentId: { in: deptIds } },
        select: { id: true, name: true, admissionNumber: true, year: true, departmentId: true, courseId: true, course: { select: { code: true, name: true } } },
      }),
      prisma.timetable.findMany({
        where: { unitOffering: { course: { departmentId: { in: deptIds } } } },
        select: {
          id: true,
          lecturerId: true,
          unitOffering: { select: { unitId: true, courseId: true } },
          sharedSession: { select: { startMinute: true, endMinute: true } },
        },
      }),
    ]);

  // ConductedSession stores codes WITHOUT spaces (e.g. "SCH2170") — use stripped codes
  // for DB queries, and normalizeUnitCode for in-memory map keys.
  const unitCodes         = units.map(u => normalizeUnitCode(u.code));
  const unitCodesStripped = units.map(u => u.code.trim().toUpperCase().replace(/\s+/g, "").replace(/[^A-Z0-9]/g, ""));

  // OfflineAttendanceRecord.institutionId is nullable (not set by submit route), so we
  // scope by unitCode instead to ensure records are always returned.
  const [conductedSessionsReal, enrollmentRecords, offlineRecords] = await Promise.all([
    prisma.conductedSession.findMany({
      where: { unitCode: { in: unitCodesStripped }, sessionStart: { gte: since } },
      select: { id: true, unitCode: true, lectureRoom: true, lecturerId: true, sessionStart: true, sessionEnd: true, lessonType: true },
    }),
    // Fetch Enrollment table so admin-imported students without app accounts are counted
    prisma.enrollment.findMany({
      where: { studentId: { in: students.map(s => s.id) }, unitId: { in: units.map(u => u.id) } },
      select: { studentId: true, unitId: true },
    }),
    prisma.offlineAttendanceRecord.findMany({
      where: { unitCode: { in: unitCodesStripped }, scannedAt: { gte: since } },
      select: { studentId: true, unitCode: true, method: true, scannedAt: true, markedByLecturerId: true },
    }),
  ]);

  // ── Build lookup maps ─────────────────────────────────────────────────────
  const unitByCode = new Map(units.map(u => [normalizeUnitCode(u.code), u]));
  const unitById   = new Map(units.map(u => [u.id, u]));
  const deptById   = new Map(departments.map(d => [d.id, d]));

  // ── Assignment counts per lecturer per unit ───────────────────────────────
  // Scoped to department units so counts are department-relevant
  const assignments = await prisma.assignment.findMany({
    where: {
      lecturerId: { in: lecturers.map(l => l.id) },
      unitId:     { in: units.map(u => u.id) },
    },
    select: { lecturerId: true, unitId: true },
  });
  // key: "lecturerId::normalizedUnitCode"
  const assignmentsByLecUnit = new Map<string, number>();
  for (const a of assignments) {
    const unit = unitById.get(a.unitId);
    if (!unit) continue;
    const key = `${a.lecturerId}::${normalizeUnitCode(unit.code)}`;
    assignmentsByLecUnit.set(key, (assignmentsByLecUnit.get(key) ?? 0) + 1);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // A. LECTURER ANALYSIS
  // ─────────────────────────────────────────────────────────────────────────

  // Fetch enrollment snapshots (mobile-synced) — used as one source of enrollment
  const snapshots = await prisma.studentEnrollmentSnapshot.findMany({
    where: { studentId: { in: students.map(s => s.id) } },
    select: { studentId: true, unitCodes: true },
  });
  const snapshotByStudent = new Map(snapshots.map(s => [s.studentId, s.unitCodes.map(c => normalizeUnitCode(c))]));

  // Merge snapshot codes with Enrollment table (admin-imported students without app accounts)
  const enrollmentCodesByStudent = new Map<string, string[]>();
  for (const e of enrollmentRecords) {
    const unit = unitById.get(e.unitId);
    if (!unit) continue;
    const code = normalizeUnitCode(unit.code);
    const list = enrollmentCodesByStudent.get(e.studentId) ?? [];
    list.push(code);
    enrollmentCodesByStudent.set(e.studentId, list);
  }
  const enrolledCodesByStudent = new Map<string, string[]>();
  for (const s of students) {
    const snapCodes = snapshotByStudent.get(s.id) ?? [];
    const enrollCodes = enrollmentCodesByStudent.get(s.id) ?? [];
    const merged = Array.from(new Set([...snapCodes, ...enrollCodes]));
    enrolledCodesByStudent.set(s.id, merged);
  }

  // Enrolled student count per normalised unit code (merged from both sources)
  const enrolledPerCode = new Map<string, number>();
  for (const [, codes] of enrolledCodesByStudent) {
    for (const code of codes) {
      if (unitByCode.has(code)) {
        enrolledPerCode.set(code, (enrolledPerCode.get(code) ?? 0) + 1);
      }
    }
  }

  // We group conductedSessions by lecturerId
  const sessionsByLecturer = new Map<string, typeof conductedSessionsReal>();
  for (const s of conductedSessionsReal) {
    const list = sessionsByLecturer.get(s.lecturerId) ?? [];
    list.push(s);
    sessionsByLecturer.set(s.lecturerId, list);
  }

  // Group offlineRecords by unitCode → count per session (sessionStart+unitCode key)
  const presentPerSession = new Map<string, Set<string>>();
  for (const r of offlineRecords) {
    const code = normalizeUnitCode(r.unitCode);
    // key without room since we're grouping by unit×lecturer, use unit+date
    const key = `${code}::${r.scannedAt.toISOString().slice(0, 10)}`;
    const s = presentPerSession.get(key) ?? new Set();
    s.add(r.studentId);
    presentPerSession.set(key, s);
  }

  // For each conducted session, work out student attendance
  const attendancePerConductedSession = new Map<string, number>();
  for (const cs of conductedSessionsReal) {
    const code = normalizeUnitCode(cs.unitCode);
    const dateKey = cs.sessionStart.toISOString().slice(0, 10);
    const key = `${code}::${dateKey}`;
    const present = presentPerSession.get(key)?.size ?? 0;
    attendancePerConductedSession.set(cs.id, present);
  }

  // Build per-lecturer timetable lookup from the fetched timetables array
  const timetablesByLecturer = new Map<string, typeof timetables>();
  for (const t of timetables) {
    const list = timetablesByLecturer.get(t.lecturerId) ?? [];
    list.push(t);
    timetablesByLecturer.set(t.lecturerId, list);
  }

  const lecturerStats = lecturers.map(lec => {
    const sessions = sessionsByLecturer.get(lec.id) ?? [];
    const totalSessions = sessions.length;
    const lecTimetables = timetablesByLecturer.get(lec.id) ?? [];

    // Hours per week from timetable (using sharedSession minutes)
    const hoursPerWeek = lecTimetables.reduce((s, t) => {
      const start = t.sharedSession?.startMinute ?? 0;
      const end   = t.sharedSession?.endMinute ?? 0;
      return s + Math.max(0, end - start) / 60;
    }, 0);
    const unitCount = new Set(lecTimetables.map(t => t.unitOffering?.unitId).filter(Boolean)).size;

    // Method compliance for this lecturer's sessions
    const lecturerOffline = offlineRecords.filter(r => r.markedByLecturerId === lec.id);
    const methodCounts: Record<string, number> = {};
    for (const r of lecturerOffline) {
      methodCounts[r.method] = (methodCounts[r.method] ?? 0) + 1;
    }

    // BLE sessions: count sessions that had ≥1 BLE record
    const lecUnitIds = new Set(lecTimetables.map(t => t.unitOffering?.unitId).filter(Boolean));
    const sessionRecordsByCode = offlineRecords.filter(r => {
      const unit = unitByCode.get(normalizeUnitCode(r.unitCode));
      return unit && lecUnitIds.has(unit.id);
    });
    const totalRecords = sessionRecordsByCode.length;
    const bleCount    = sessionRecordsByCode.filter(r => r.method === "ble").length;
    const qrCount     = sessionRecordsByCode.filter(r => r.method === "qr").length;
    const pinCount    = sessionRecordsByCode.filter(r => ["manual", "manual_lecturer"].includes(r.method)).length;

    const bleAdoptionRate  = totalRecords > 0 ? Math.round((bleCount  / totalRecords) * 100) : 0;
    const qrAdoptionRate   = totalRecords > 0 ? Math.round((qrCount   / totalRecords) * 100) : 0;
    const pinAdoptionRate  = totalRecords > 0 ? Math.round((pinCount  / totalRecords) * 100) : 0;

    // Average class attendance rate across conducted sessions:
    // For each session compute (studentsPresent / studentsEnrolledInUnit) * 100,
    // then average those percentages. This gives a true attendance rate, not a raw count.
    let sumSessionPct = 0;
    let sessionsCounted = 0;
    for (const cs of sessions) {
      const present  = attendancePerConductedSession.get(cs.id) ?? 0;
      const code     = normalizeUnitCode(cs.unitCode);
      const enrolled = enrolledPerCode.get(code) ?? 0;
      if (enrolled > 0) {
        sumSessionPct += Math.min(100, Math.round((present / enrolled) * 100));
        sessionsCounted++;
      }
    }
    const avgClassAttendance = sessionsCounted > 0
      ? Math.round(sumSessionPct / sessionsCounted)
      : 0;

    // Per-unit breakdown — session counts by lessonType + assignments posted
    const sessionsByUnit = new Map<string, typeof sessions>();
    for (const cs of sessions) {
      const code = normalizeUnitCode(cs.unitCode);
      const list = sessionsByUnit.get(code) ?? [];
      list.push(cs);
      sessionsByUnit.set(code, list);
    }
    const unitBreakdown = Array.from(sessionsByUnit.entries()).map(([code, unitSessions]) => {
      const unit = unitByCode.get(code);
      const counts: Record<string, number> = {};
      for (const cs of unitSessions) {
        const lt = (cs.lessonType ?? "LEC").toUpperCase();
        counts[lt] = (counts[lt] ?? 0) + 1;
      }
      let sumUnitPct = 0; let unitCnt = 0;
      for (const cs of unitSessions) {
        const present  = attendancePerConductedSession.get(cs.id) ?? 0;
        const enrolled = enrolledPerCode.get(code) ?? 0;
        if (enrolled > 0) {
          sumUnitPct += Math.min(100, Math.round((present / enrolled) * 100));
          unitCnt++;
        }
      }
      return {
        unitCode:          unit?.code ?? code,
        unitTitle:         unit?.title ?? code,
        totalSessions:     unitSessions.length,
        lecSessions:       counts["LEC"] ?? 0,
        catSessions:       counts["CAT"] ?? 0,
        ratSessions:       counts["RAT"] ?? 0,
        labSessions:       counts["LAB"] ?? 0,
        gdSessions:        counts["GD"]  ?? 0,
        semSessions:       counts["SEM"] ?? 0,
        assignmentsPosted: assignmentsByLecUnit.get(`${lec.id}::${code}`) ?? 0,
        avgClassAttendance: unitCnt > 0 ? Math.round(sumUnitPct / unitCnt) : 0,
      };
    }).sort((a, b) => a.unitCode.localeCompare(b.unitCode));

    const catSessions       = unitBreakdown.reduce((s, u) => s + u.catSessions, 0);
    const ratSessions       = unitBreakdown.reduce((s, u) => s + u.ratSessions, 0);
    const labSessions       = unitBreakdown.reduce((s, u) => s + u.labSessions, 0);
    const assignmentsPosted = unitBreakdown.reduce((s, u) => s + u.assignmentsPosted, 0);

    // Dept — derive from unitOffering.course.departmentId via unit lookup
    const firstUnitId = lecTimetables[0]?.unitOffering?.unitId ?? "";
    const firstUnit   = unitById.get(firstUnitId);
    const deptId      = firstUnit?.departmentId ?? "";
    const deptName    = deptById.get(deptId)?.name ?? "—";

    return {
      lecturerId:       lec.id,
      lecturerName:     lec.fullName,
      department:       deptName,
      departmentId:     deptId,
      totalSessions,
      hoursPerWeek:     Math.round(hoursPerWeek * 10) / 10,
      unitCount,
      bleAdoptionRate,
      qrAdoptionRate,
      pinAdoptionRate,
      avgClassAttendance,
      totalRecordsCreated: totalRecords,
      catSessions,
      ratSessions,
      labSessions,
      assignmentsPosted,
      units: unitBreakdown,
    };
  }).filter(l => l.totalSessions > 0 || l.totalRecordsCreated > 0)
    .sort((a, b) => b.totalSessions - a.totalSessions);

  // ─────────────────────────────────────────────────────────────────────────
  // B. STUDENT ANALYSIS
  // ─────────────────────────────────────────────────────────────────────────

  // Total distinct sessions per unit code (denominator for student attendance rate)
  const sessionsPerCode = new Map<string, number>();
  for (const cs of conductedSessionsReal) {
    const code = normalizeUnitCode(cs.unitCode);
    sessionsPerCode.set(code, (sessionsPerCode.get(code) ?? 0) + 1);
  }

  // Records per student per unit code
  const recordsByStudentUnit = new Map<string, number>();
  for (const r of offlineRecords) {
    const key = `${r.studentId}::${normalizeUnitCode(r.unitCode)}`;
    recordsByStudentUnit.set(key, (recordsByStudentUnit.get(key) ?? 0) + 1);
  }

  // Enrollment snapshot lookup — already fetched above in section A
  // snapshotByStudent and snapshots are available
  const studentStats = students.map(student => {
    const enrolledCodes = enrolledCodesByStudent.get(student.id) ?? [];
    // Only codes that belong to this scope's units
    const scopedCodes = enrolledCodes.filter(c => unitByCode.has(c));

    let totalSessions = 0;
    let totalAttended = 0;
    const perCourse: Record<string, { sessions: number; attended: number }> = {};

    for (const code of scopedCodes) {
      const sessions = sessionsPerCode.get(code) ?? 0;
      const attended = recordsByStudentUnit.get(`${student.id}::${code}`) ?? 0;
      totalSessions += sessions;
      totalAttended += Math.min(attended, sessions); // cap at total sessions
      perCourse[code] = { sessions, attended: Math.min(attended, sessions) };
    }

    const overallPct = totalSessions > 0 ? Math.round((totalAttended / totalSessions) * 100) : 0;
    const dept = deptById.get(student.departmentId)?.name ?? "—";

    return {
      studentId:        student.id,
      studentName:      student.name,
      admissionNumber:  student.admissionNumber,
      year:             student.year,
      department:       dept,
      departmentId:     student.departmentId,
      course:           student.course?.name ?? "—",
      totalSessions,
      totalAttended,
      overallAttendance: overallPct,
      riskLevel:        riskLevel(overallPct),
      enrolledUnitCount: scopedCodes.length,
      perCourseAttendance: perCourse,
    };
  });

  // Risk cohorts
  const atRisk    = studentStats.filter(s => s.riskLevel !== "none" && s.enrolledUnitCount > 0);
  const critical  = studentStats.filter(s => s.riskLevel === "critical" && s.enrolledUnitCount > 0);
  const warning   = studentStats.filter(s => s.riskLevel === "warning"  && s.enrolledUnitCount > 0);
  const watch     = studentStats.filter(s => s.riskLevel === "watch"    && s.enrolledUnitCount > 0);

  // By department
  const studentsByDept = new Map<string, typeof studentStats>();
  for (const s of studentStats) {
    const list = studentsByDept.get(s.departmentId) ?? [];
    list.push(s);
    studentsByDept.set(s.departmentId, list);
  }

  const deptBreakdown = departments.map(dept => {
    const deptStudents = studentsByDept.get(dept.id) ?? [];
    const active = deptStudents.filter(s => s.enrolledUnitCount > 0);
    const avgAtt = active.length > 0
      ? Math.round(active.reduce((s, d) => s + d.overallAttendance, 0) / active.length)
      : 0;
    const atRiskCount = active.filter(s => s.overallAttendance < 60).length;
    return {
      departmentId:  dept.id,
      name:          dept.name,
      totalStudents: deptStudents.length,
      activeStudents: active.length,
      avgAttendance: avgAtt,
      atRiskCount,
      atRiskPct:     active.length > 0 ? Math.round((atRiskCount / active.length) * 100) : 0,
    };
  }).sort((a, b) => b.avgAttendance - a.avgAttendance);

  // By year
  const byYear: Record<number, { total: number; sumPct: number; atRisk: number }> = {};
  for (const s of studentStats.filter(s => s.enrolledUnitCount > 0)) {
    byYear[s.year] = byYear[s.year] ?? { total: 0, sumPct: 0, atRisk: 0 };
    byYear[s.year].total++;
    byYear[s.year].sumPct += s.overallAttendance;
    if (s.overallAttendance < 60) byYear[s.year].atRisk++;
  }
  const yearBreakdown = Object.entries(byYear)
    .map(([year, v]) => ({
      year: Number(year),
      totalStudents: v.total,
      avgAttendance: Math.round(v.sumPct / v.total),
      atRiskCount: v.atRisk,
      atRiskPct: Math.round((v.atRisk / v.total) * 100),
    }))
    .sort((a, b) => a.year - b.year);

  // ── By Course ──────────────────────────────────────────────────────────
  // Map courseId → course metadata from raw students list
  const courseMetaById = new Map<string, { id: string; code: string; name: string }>();
  for (const s of students) {
    if (s.courseId && s.course && !courseMetaById.has(s.courseId)) {
      courseMetaById.set(s.courseId, { id: s.courseId, code: s.course.code, name: s.course.name });
    }
  }

  // Map studentId → courseId
  const courseIdByStudent = new Map<string, string>(
    students.filter(s => s.courseId).map(s => [s.id, s.courseId])
  );

  const studentsByCourse = new Map<string, typeof studentStats>();
  for (const s of studentStats) {
    const courseId = courseIdByStudent.get(s.studentId) ?? "unknown";
    const list = studentsByCourse.get(courseId) ?? [];
    list.push(s);
    studentsByCourse.set(courseId, list);
  }

  const courseBreakdown = Array.from(studentsByCourse.entries()).map(([courseId, courseStudents]) => {
    const meta   = courseMetaById.get(courseId);
    const active = courseStudents.filter(s => s.enrolledUnitCount > 0);

    const totalStudents   = courseStudents.length;
    const activeStudents  = active.length;
    const avgAttendance   = active.length > 0
      ? Math.round(active.reduce((s, d) => s + d.overallAttendance, 0) / active.length)
      : 0;
    const atRiskCount     = active.filter(s => s.overallAttendance < 60).length;
    const criticalCount   = active.filter(s => s.overallAttendance < 40).length;
    const atRiskPct       = active.length > 0 ? Math.round((atRiskCount / active.length) * 100) : 0;

    // Year breakdown within this course
    const byYearCourse: Record<number, { total: number; sumPct: number; atRisk: number }> = {};
    for (const s of active) {
      byYearCourse[s.year] = byYearCourse[s.year] ?? { total: 0, sumPct: 0, atRisk: 0 };
      byYearCourse[s.year].total++;
      byYearCourse[s.year].sumPct += s.overallAttendance;
      if (s.overallAttendance < 60) byYearCourse[s.year].atRisk++;
    }
    const yearBreakdownCourse = Object.entries(byYearCourse)
      .map(([year, v]) => ({
        year: Number(year),
        totalStudents: v.total,
        avgAttendance: Math.round(v.sumPct / v.total),
        atRiskCount: v.atRisk,
        atRiskPct: Math.round((v.atRisk / v.total) * 100),
      }))
      .sort((a, b) => a.year - b.year);

    // Top at-risk students in this course (worst first)
    const topAtRisk = active
      .filter(s => s.overallAttendance < 60)
      .sort((a, b) => a.overallAttendance - b.overallAttendance)
      .slice(0, 10)
      .map(s => ({
        studentId:        s.studentId,
        studentName:      s.studentName,
        admissionNumber:  s.admissionNumber,
        year:             s.year,
        overallAttendance: s.overallAttendance,
        riskLevel:        s.riskLevel,
      }));

    // Attendance velocity: compare first-half vs second-half of lookback per course student
    let firstHalfSum = 0; let firstHalfCount = 0;
    let secondHalfSum = 0; let secondHalfCount = 0;
    for (const s of active) {
      const firstHalfSess = conductedSessionsReal.filter(cs =>
        (enrolledCodesByStudent.get(s.studentId) ?? []).includes(normalizeUnitCode(cs.unitCode)) &&
        new Date(cs.sessionStart).getTime() < since.getTime() + (days / 2) * 86400000
      ).length;
      const secondHalfSess = conductedSessionsReal.filter(cs =>
        (enrolledCodesByStudent.get(s.studentId) ?? []).includes(normalizeUnitCode(cs.unitCode)) &&
        new Date(cs.sessionStart).getTime() >= since.getTime() + (days / 2) * 86400000
      ).length;
      const fhRate = firstHalfSess > 0 ? s.totalAttended / (s.totalSessions || 1) : null;
      if (fhRate !== null) { firstHalfSum += fhRate * 100; firstHalfCount++; }
      const shRate = secondHalfSess > 0 ? s.totalAttended / (s.totalSessions || 1) : null;
      if (shRate !== null) { secondHalfSum += shRate * 100; secondHalfCount++; }
    }
    const courseTrend = firstHalfCount > 0 && secondHalfCount > 0
      ? Math.round(secondHalfSum / secondHalfCount - firstHalfSum / firstHalfCount)
      : 0;

    return {
      courseId:       courseId,
      courseCode:     meta?.code ?? courseId,
      courseName:     meta?.name ?? "Unknown Course",
      totalStudents,
      activeStudents,
      avgAttendance,
      atRiskCount,
      criticalCount,
      atRiskPct,
      velocityDelta:  courseTrend,
      yearBreakdown:  yearBreakdownCourse,
      topAtRisk,
    };
  }).sort((a, b) => b.activeStudents - a.activeStudents);

  // ─────────────────────────────────────────────────────────────────────────
  // C. METHOD BREAKDOWN
  // ─────────────────────────────────────────────────────────────────────────
  const methodTotals: Record<string, number> = {};
  for (const r of offlineRecords) {
    methodTotals[r.method] = (methodTotals[r.method] ?? 0) + 1;
  }
  const total = offlineRecords.length;
  const methods = Object.entries(methodTotals)
    .map(([method, count]) => ({ method, count, pct: total > 0 ? Math.round((count / total) * 100) : 0 }))
    .sort((a, b) => b.count - a.count);

  // Method by department
  const methodByDept = departments.map(dept => {
    const deptCodes = new Set(units.filter(u => u.departmentId === dept.id).map(u => normalizeUnitCode(u.code)));
    const deptRecords = offlineRecords.filter(r => deptCodes.has(normalizeUnitCode(r.unitCode)));
    const t = deptRecords.length;
    const counts: Record<string, number> = {};
    for (const r of deptRecords) counts[r.method] = (counts[r.method] ?? 0) + 1;
    return {
      departmentId: dept.id,
      name: dept.name,
      total: t,
      ble:    t > 0 ? Math.round(((counts["ble"]            ?? 0) / t) * 100) : 0,
      qr:     t > 0 ? Math.round(((counts["qr"]             ?? 0) / t) * 100) : 0,
      pin:    t > 0 ? Math.round((((counts["manual"] ?? 0) + (counts["manual_lecturer"] ?? 0)) / t) * 100) : 0,
      online: 0, // OnlineAttendanceRecord not fetched here — extend if needed
    };
  });

  // ─────────────────────────────────────────────────────────────────────────
  // D. OVERVIEW KPIs
  // ─────────────────────────────────────────────────────────────────────────
  const activeStudents = studentStats.filter(s => s.enrolledUnitCount > 0);
  const overallAvgAttendance = activeStudents.length > 0
    ? Math.round(activeStudents.reduce((s, x) => s + x.overallAttendance, 0) / activeStudents.length)
    : 0;

  const overview = {
    totalStudents:        students.length,
    activeStudents:       activeStudents.length,
    totalLecturers:       lecturers.length,
    totalSessions:        conductedSessionsReal.length,
    overallAvgAttendance,
    atRiskCount:          atRisk.length,
    atRiskPct:            activeStudents.length > 0 ? Math.round((atRisk.length / activeStudents.length) * 100) : 0,
    criticalCount:        critical.length,
    criticalPct:          activeStudents.length > 0 ? Math.round((critical.length / activeStudents.length) * 100) : 0,
    lookbackDays:         days,
  };

  // ─────────────────────────────────────────────────────────────────────────
  // E. UNIT-LEVEL BREAKDOWN
  // ─────────────────────────────────────────────────────────────────────────

  // Pre-build assignments-per-unit map (unit code → total across all lecturers)
  const assignmentsByUnit = new Map<string, number>();
  for (const a of assignments) {
    const unit = unitById.get(a.unitId);
    if (!unit) continue;
    const code = normalizeUnitCode(unit.code);
    assignmentsByUnit.set(code, (assignmentsByUnit.get(code) ?? 0) + 1);
  }

  // Pre-build lesson-type counts per unit code
  const lessonTypesByUnit = new Map<string, Record<string, number>>();
  for (const cs of conductedSessionsReal) {
    const code  = normalizeUnitCode(cs.unitCode);
    const lt    = (cs.lessonType ?? "LEC").toUpperCase();
    const entry = lessonTypesByUnit.get(code) ?? {};
    entry[lt]   = (entry[lt] ?? 0) + 1;
    lessonTypesByUnit.set(code, entry);
  }

  const unitBreakdown = units.map(unit => {
    const code         = normalizeUnitCode(unit.code);
    const sessCount    = sessionsPerCode.get(code) ?? 0;
    const dept         = deptById.get(unit.departmentId)?.name ?? "—";

    // Enrolled students for this unit (snapshot + Enrollment table merged)
    const enrolledStudentIds = students
      .filter(s => (enrolledCodesByStudent.get(s.id) ?? []).includes(code))
      .map(s => s.id);
    const enrolled = enrolledStudentIds.length;

    // Per-student attendance for this unit
    let sumPct = 0;
    let atRiskCount = 0;
    for (const sid of enrolledStudentIds) {
      const attended = recordsByStudentUnit.get(`${sid}::${code}`) ?? 0;
      const capped   = Math.min(attended, sessCount);
      const pct      = sessCount > 0 ? Math.round((capped / sessCount) * 100) : 0;
      sumPct += pct;
      if (pct < 60) atRiskCount++;
    }
    const avgAttendance = enrolled > 0 ? Math.round(sumPct / enrolled) : 0;

    // Lecturer(s) for this unit
    const lecturerName = lecturers
      .filter(l => (timetablesByLecturer.get(l.id) ?? []).some(t => {
        const u = unitById.get(t.unitOffering?.unitId ?? "");
        return u && normalizeUnitCode(u.code) === code;
      }))
      .map(l => l.fullName)
      .join(", ") || "—";

    // Lesson type counts
    const ltCounts = lessonTypesByUnit.get(code) ?? {};

    return {
      unitId:           unit.id,
      unitCode:         unit.code,
      unitTitle:        unit.title,
      department:       dept,
      sessionsHeld:     sessCount,
      enrolled,
      avgAttendance,
      atRiskCount,
      atRiskPct:        enrolled > 0 ? Math.round((atRiskCount / enrolled) * 100) : 0,
      lecturerName,
      lowActivity:      sessCount < 2,
      lecSessions:      ltCounts["LEC"] ?? 0,
      catSessions:      ltCounts["CAT"] ?? 0,
      ratSessions:      ltCounts["RAT"] ?? 0,
      labSessions:      ltCounts["LAB"] ?? 0,
      gdSessions:       ltCounts["GD"]  ?? 0,
      semSessions:      ltCounts["SEM"] ?? 0,
      assignmentsPosted: assignmentsByUnit.get(code) ?? 0,
    };
  })
    .filter(u => u.enrolled > 0)
    .sort((a, b) => a.avgAttendance - b.avgAttendance);

  // ─────────────────────────────────────────────────────────────────────────
  // F. ATTENDANCE DISTRIBUTION (10% buckets)
  // ─────────────────────────────────────────────────────────────────────────
  const buckets: number[] = Array(10).fill(0); // index 0 = 0–9%, index 9 = 90–100%
  for (const s of activeStudents) {
    const idx = Math.min(9, Math.floor(s.overallAttendance / 10));
    buckets[idx]++;
  }
  const distribution = buckets.map((count, i) => ({
    range: `${i * 10}–${i * 10 + 9}%`,
    count,
  }));
  // Merge last bucket to show 90–100%
  distribution[9] = { range: "90–100%", count: buckets[9] };

  // ─────────────────────────────────────────────────────────────────────────
  // G. WEEKLY TREND
  // ─────────────────────────────────────────────────────────────────────────
  // Group conducted sessions + attendance records by ISO week
  const weeklyMap = new Map<string, { sessions: number; totalPresent: number }>();
  for (const cs of conductedSessionsReal) {
    const d    = new Date(cs.sessionStart);
    // ISO week label: YYYY-Www
    const year = d.getUTCFullYear();
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const weekNum = Math.ceil(((d.getTime() - jan4.getTime()) / 86400000 + jan4.getUTCDay() + 1) / 7);
    const label = `${year}-W${String(weekNum).padStart(2, "0")}`;

    const prev = weeklyMap.get(label) ?? { sessions: 0, totalPresent: 0 };
    const present = attendancePerConductedSession.get(cs.id) ?? 0;
    weeklyMap.set(label, {
      sessions:     prev.sessions + 1,
      totalPresent: prev.totalPresent + present,
    });
  }
  const weeklyTrend = Array.from(weeklyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, v]) => ({
      week,
      sessions:     v.sessions,
      avgPresent:   v.sessions > 0 ? Math.round(v.totalPresent / v.sessions) : 0,
    }));

  // ─────────────────────────────────────────────────────────────────────────
  // H. DAY-OF-WEEK ABSENTEEISM
  // ─────────────────────────────────────────────────────────────────────────
  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const dowMap = new Map<number, { sessions: number; totalPresent: number; totalEnrolled: number }>();
  for (const cs of conductedSessionsReal) {
    const dow     = new Date(cs.sessionStart).getUTCDay();
    const present = attendancePerConductedSession.get(cs.id) ?? 0;
    // enrolled in this unit (snapshot + Enrollment table merged)
    const code    = normalizeUnitCode(cs.unitCode);
    const enrolledCount = students.filter(s =>
      (enrolledCodesByStudent.get(s.id) ?? []).includes(code)
    ).length;
    const prev = dowMap.get(dow) ?? { sessions: 0, totalPresent: 0, totalEnrolled: 0 };
    dowMap.set(dow, {
      sessions:     prev.sessions + 1,
      totalPresent: prev.totalPresent + present,
      totalEnrolled: prev.totalEnrolled + enrolledCount,
    });
  }
  const dowAbsenteeism = DAYS.map((name, i) => {
    const v          = dowMap.get(i);
    const avgPct     = v && v.sessions > 0 && v.totalEnrolled > 0
      ? Math.round((v.totalPresent / v.totalEnrolled) * 100)
      : null;
    return { day: name, sessions: v?.sessions ?? 0, avgAttendancePct: avgPct };
  }).filter(d => d.sessions > 0);

  // ─────────────────────────────────────────────────────────────────────────
  // I. PREDICTIVE ANALYTICS
  // ─────────────────────────────────────────────────────────────────────────

  const midTime = since.getTime() + (days / 2) * 24 * 60 * 60 * 1000;

  // 1. Threshold proximity — students close to (but not yet below) 75%
  //    and sessions needed to reach/stay safe at 75%
  // 2. Attendance velocity — compare 1st half vs 2nd half record counts
  // 3. Projection to 75% — how many more sessions they need to attend
  // 4. Consecutive absence streak — max gap without a record per student per unit
  //    approximated via offlineRecords sorted by scannedAt

  // Build per-student per-unit records with timestamps for streak detection
  const recordsByStudentUnitDated = new Map<string, Date[]>();
  for (const r of offlineRecords) {
    const key  = `${r.studentId}::${normalizeUnitCode(r.unitCode)}`;
    const list = recordsByStudentUnitDated.get(key) ?? [];
    list.push(r.scannedAt);
    recordsByStudentUnitDated.set(key, list);
  }

  // Build per-unit conducted-session dates (sorted)
  const sessionDatesByUnit = new Map<string, Date[]>();
  for (const cs of conductedSessionsReal) {
    const code = normalizeUnitCode(cs.unitCode);
    const list = sessionDatesByUnit.get(code) ?? [];
    list.push(new Date(cs.sessionStart));
    sessionDatesByUnit.set(code, list);
  }
  // Sort each unit's session list
  for (const [code, dates] of sessionDatesByUnit) {
    sessionDatesByUnit.set(code, dates.sort((a, b) => a.getTime() - b.getTime()));
  }

  interface StudentPrediction {
    studentId:          string;
    studentName:        string;
    admissionNumber:    string;
    year:               number;
    overallAttendance:  number;
    riskLevel:          string;
    // Per-unit predictive fields are aggregated to worst-case at top level
    sessionsNeededGlobal: number; // to reach 75% overall
    velocityTrend:      "improving" | "declining" | "stable";
    velocityDelta:      number;   // pp change between halves
    maxConsecAbsences:  number;   // max streak across all units
    worstStreakUnit:    string;   // unit code where streak is worst
    projectedEndRate:   number;   // projected overall at same velocity
    unitsAtThreshold:  number;   // units where student is within 2 sessions of dropping below 75%
  }

  const studentPredictions: StudentPrediction[] = activeStudents.map(student => {
    const enrolledCodes = enrolledCodesByStudent.get(student.studentId) ?? [];
    const scopedCodes   = enrolledCodes.filter(c => unitByCode.has(c));

    // Overall projection
    const totalSess   = student.totalSessions;
    const totalAtt    = student.totalAttended;
    // sessions needed at 100% attendance to reach 75% overall
    const needed = totalSess > 0 && student.overallAttendance < 75
      ? Math.max(0, Math.ceil((0.75 * totalSess - totalAtt) / 0.25))
      : 0;

    // Velocity: split offlineRecords into first/second half of lookback window
    let firstHalfCount  = 0;
    let secondHalfCount = 0;
    const firstHalfSess  = conductedSessionsReal.filter(cs =>
      scopedCodes.includes(normalizeUnitCode(cs.unitCode)) && new Date(cs.sessionStart).getTime() < midTime
    ).length;
    const secondHalfSess = conductedSessionsReal.filter(cs =>
      scopedCodes.includes(normalizeUnitCode(cs.unitCode)) && new Date(cs.sessionStart).getTime() >= midTime
    ).length;

    for (const r of offlineRecords) {
      if (r.studentId !== student.studentId) continue;
      if (!scopedCodes.includes(normalizeUnitCode(r.unitCode))) continue;
      if (r.scannedAt.getTime() < midTime) firstHalfCount++;
      else secondHalfCount++;
    }

    const firstHalfRate  = firstHalfSess  > 0 ? firstHalfCount  / firstHalfSess  : null;
    const secondHalfRate = secondHalfSess > 0 ? secondHalfCount / secondHalfSess : null;

    let velocityTrend: "improving" | "declining" | "stable" = "stable";
    let velocityDelta = 0;
    if (firstHalfRate !== null && secondHalfRate !== null) {
      velocityDelta = Math.round((secondHalfRate - firstHalfRate) * 100);
      if      (velocityDelta >= 5)  velocityTrend = "improving";
      else if (velocityDelta <= -5) velocityTrend = "declining";
    }

    // Consecutive absence streak (max sessions missed in a row per unit)
    let maxConsecAbsences = 0;
    let worstStreakUnit   = "";
    for (const code of scopedCodes) {
      const sessionDates = sessionDatesByUnit.get(code) ?? [];
      if (sessionDates.length < 2) continue;
      const attendedDates = new Set(
        (recordsByStudentUnitDated.get(`${student.studentId}::${code}`) ?? [])
          .map(d => d.toISOString().slice(0, 10))
      );
      let streak = 0;
      let maxStreak = 0;
      for (const sd of sessionDates) {
        if (!attendedDates.has(sd.toISOString().slice(0, 10))) {
          streak++;
          if (streak > maxStreak) maxStreak = streak;
        } else {
          streak = 0;
        }
      }
      if (maxStreak > maxConsecAbsences) {
        maxConsecAbsences = maxStreak;
        worstStreakUnit   = unitByCode.get(code)?.code ?? code;
      }
    }

    // Units at threshold (within 2 sessions of dropping below 75%)
    let unitsAtThreshold = 0;
    for (const code of scopedCodes) {
      const sess = sessionsPerCode.get(code) ?? 0;
      const att  = Math.min(recordsByStudentUnit.get(`${student.studentId}::${code}`) ?? 0, sess);
      const pct  = sess > 0 ? (att / sess) * 100 : 0;
      if (pct >= 60 && pct < 75) unitsAtThreshold++;
    }

    // Projected end rate (linear extrapolation — if velocity continues, apply delta to current)
    const projectedEndRate = Math.min(100, Math.max(0, student.overallAttendance + velocityDelta));

    return {
      studentId:           student.studentId,
      studentName:         student.studentName,
      admissionNumber:     student.admissionNumber,
      year:                student.year,
      overallAttendance:   student.overallAttendance,
      riskLevel:           student.riskLevel,
      sessionsNeededGlobal: needed,
      velocityTrend,
      velocityDelta,
      maxConsecAbsences,
      worstStreakUnit,
      projectedEndRate,
      unitsAtThreshold,
    };
  });

  // 5. Ghost enrollment — units with sessions held but very low coverage
  const ghostEnrollmentUnits = unitBreakdown
    .filter(u => u.sessionsHeld >= 3 && u.avgAttendance < 30 && u.enrolled >= 5)
    .map(u => ({
      unitCode:       u.unitCode,
      unitTitle:      u.unitTitle,
      enrolled:       u.enrolled,
      sessionsHeld:   u.sessionsHeld,
      avgAttendance:  u.avgAttendance,
      lecturerName:   u.lecturerName,
    }));

  // 6. Lecturer session regularity score
  //    stddev of weekly session counts; lower = more regular
  const lecturerRegularity = lecturerStats.map(lec => {
    const lecSessions = (lecSessions => lecSessions)(
      conductedSessionsReal.filter(cs => cs.lecturerId === lec.lecturerId)
    );
    const weekCounts: Record<string, number> = {};
    for (const cs of lecSessions) {
      const d    = new Date(cs.sessionStart);
      const year = d.getUTCFullYear();
      const jan4 = new Date(Date.UTC(year, 0, 4));
      const wn   = Math.ceil(((d.getTime() - jan4.getTime()) / 86400000 + jan4.getUTCDay() + 1) / 7);
      const key  = `${year}-W${String(wn).padStart(2, "0")}`;
      weekCounts[key] = (weekCounts[key] ?? 0) + 1;
    }
    const counts = Object.values(weekCounts);
    const mean   = counts.length > 0 ? counts.reduce((a, b) => a + b, 0) / counts.length : 0;
    const variance = counts.length > 1
      ? counts.reduce((s, c) => s + (c - mean) ** 2, 0) / counts.length
      : 0;
    const stddev = Math.sqrt(variance);
    // Score 0–100: lower stddev → higher regularity
    const maxPossibleStddev = 3;
    const regularityScore = counts.length > 0
      ? Math.round(Math.max(0, (1 - Math.min(stddev, maxPossibleStddev) / maxPossibleStddev)) * 100)
      : 0;
    return {
      lecturerId:       lec.lecturerId,
      lecturerName:     lec.lecturerName,
      weeklySessionAvg: Math.round(mean * 10) / 10,
      regularityScore,
      weeksActive:      counts.length,
    };
  }).sort((a, b) => b.regularityScore - a.regularityScore);

  // 7. Cohort summary for threshold proximity
  const thresholdProximity = studentPredictions
    .filter(s => s.unitsAtThreshold > 0 || (s.overallAttendance >= 60 && s.overallAttendance < 75))
    .sort((a, b) => a.overallAttendance - b.overallAttendance)
    .slice(0, 100);

  // 8. Velocity declines
  const velocityDeclines = studentPredictions
    .filter(s => s.velocityTrend === "declining")
    .sort((a, b) => a.velocityDelta - b.velocityDelta)
    .slice(0, 100);

  // 9. Consecutive absence alerts (≥3 consecutive misses)
  const consecutiveAlerts = studentPredictions
    .filter(s => s.maxConsecAbsences >= 3)
    .sort((a, b) => b.maxConsecAbsences - a.maxConsecAbsences)
    .slice(0, 100);

  const predictive = {
    thresholdProximity,
    velocityDeclines,
    consecutiveAlerts,
    ghostEnrollmentUnits,
    lecturerRegularity,
    summary: {
      studentsNearThreshold:    thresholdProximity.length,
      studentsVelocityDecline:  velocityDeclines.length,
      studentsConsecAbsent:     consecutiveAlerts.length,
      ghostEnrollmentUnitCount: ghostEnrollmentUnits.length,
    },
  };

  return NextResponse.json({
    overview,
    lecturers:  lecturerStats,
    students: {
      byDepartment:   deptBreakdown,
      byYear:         yearBreakdown,
      byCourse:       courseBreakdown,
      atRisk:         atRisk.slice(0, 100).map(s => ({ ...s, perCourseAttendance: s.perCourseAttendance })),
      critical:       critical.slice(0, 50).map(s => ({ ...s, perCourseAttendance: s.perCourseAttendance })),
      all:            activeStudents
        .sort((a, b) => a.overallAttendance - b.overallAttendance)
        .slice(0, 300)
        .map(s => ({ ...s, perCourseAttendance: s.perCourseAttendance })),
    },
    methods,
    methodByDept,
    units:        unitBreakdown,
    unitTitleMap: Object.fromEntries(units.map(u => [normalizeUnitCode(u.code), u.title])),
    distribution,
    weeklyTrend,
    dowAbsenteeism,
    predictive,
  });
}
