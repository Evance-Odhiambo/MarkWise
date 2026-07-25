import { prisma } from "@/lib/prisma";

// ── Scoring Table ─────────────────────────────────────────────────────────────
const POINTS: Record<string, number> = {
  attend: 10,
  daily_bonus: 5,
  ontime: 3,
  weekly_100: 25,
  monthly_100: 100,
  streak_7: 50,
  streak_30: 200,
  unit_90: 30,
  comeback: 20,
  first: 10,
};

// 5 minutes in ms for on-time check
const ONTIME_MS = 5 * 60 * 1000;

// ── Types ─────────────────────────────────────────────────────────────────────
export type BreakdownEntry = { rule: string; count: number; pts: number };
export type RecentActivity = {
  id: string;
  label: string;
  rule: string;
  pts: number;
  date: string;
};

export type GamificationStats = {
  totalSessions: number;
  attended: number;
  missed: number;
  percent: number;
  currentStreak: number;
  longestStreak: number;
  perfectWeeks: number;
  perfectMonths: number;
  ontimeCount: number;
  comebacks: number;
  firstSessionDone: boolean;
  unitsAbove90: string[];
  /** Per-unit attendance counts derived from timetable + attendance records */
  unitAttendance: Record<string, { attended: number; total: number }>;
};

export type GamificationResult = {
  stats: GamificationStats;
  points: { total: number; breakdown: BreakdownEntry[] };
  recentActivity: RecentActivity[];
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** "YYYY-MM-DD" from a Date */
function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Monday-based ISO week number and year key, e.g. "2026-W11" */
function weekKey(d: Date): string {
  const dt = new Date(d);
  dt.setHours(0, 0, 0, 0);
  // Adjust to Thursday of current week (ISO 8601 week starts Monday)
  const day = dt.getDay() || 7; // Sunday=7
  dt.setDate(dt.getDate() + 4 - day);
  const yearStart = new Date(dt.getFullYear(), 0, 1);
  const weekNo = Math.ceil(((dt.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${dt.getFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

/** "YYYY-MM" from a Date */
function monthKey(d: Date): string {
  return d.toISOString().slice(0, 7);
}

/** Map day name (from Timetable "Monday") to JS getDay() value */
const DAY_MAP: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

/**
 * Given Timetable entries and a date range, return the set of (dateKey, unitCode)
 * pairs representing every scheduled session in the timeframe.
 */
function expandScheduledSessions(
  timetableEntries: { day: string; unitId: string; startTime: string; unitCode: string }[],
  rangeStart: Date,
  rangeEnd: Date,
): { dateStr: string; unitCode: string; startTime: string }[] {
  const sessions: { dateStr: string; unitCode: string; startTime: string }[] = [];
  const cursor = new Date(rangeStart);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(rangeEnd);
  end.setHours(23, 59, 59, 999);

  // Build lookup: dayOfWeek → entries
  const byDay = new Map<number, typeof timetableEntries>();
  for (const entry of timetableEntries) {
    const dow = DAY_MAP[entry.day.toLowerCase()];
    if (dow === undefined) continue;
    const arr = byDay.get(dow) ?? [];
    arr.push(entry);
    byDay.set(dow, arr);
  }

  while (cursor <= end) {
    const dow = cursor.getDay();
    const entries = byDay.get(dow);
    if (entries) {
      const ds = dateKey(cursor);
      for (const e of entries) {
        sessions.push({ dateStr: ds, unitCode: e.unitCode, startTime: e.startTime });
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return sessions;
}

/**
 * Parse "HH:MM" into a Date on a given dateStr ("YYYY-MM-DD").
 */
function parseSessionDateTime(dateStr: string, timeStr: string): Date {
  return new Date(`${dateStr}T${timeStr}:00`);
}

// ── Main Computation ──────────────────────────────────────────────────────────

export async function computeGamification(studentId: string): Promise<GamificationResult> {
  // 1. Fetch the student's enrolled units
  const enrollments = await prisma.enrollment.findMany({
    where: { studentId },
    select: { unitId: true, unit: { select: { code: true } } },
  });

  const enrolledUnitIds = enrollments.map((e) => e.unitId);
  const enrolledUnitCodes = new Set(enrollments.map((e) => e.unit.code.toUpperCase()));

  if (enrolledUnitIds.length === 0) {
    return emptyResult();
  }

  // 2. Get the student record for courseId
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { courseId: true },
  });
  if (!student) return emptyResult();

  // 3. Fetch timetable entries for the student's course + enrolled units
  const timetableEntries = await prisma.timetable.findMany({
    where: {
      unitOffering: {
        courseId: student.courseId,
        unitId: { in: enrolledUnitIds },
      },
      timetableStatus: { not: "CANCELLED" },
    },
    include: {
      unitOffering: { include: { unit: { select: { code: true } } } },
      sharedSession: { select: { day: true, startMinute: true } },
    },
  });

  const DOW_MAP: Record<string, string> = {
    MON: "Monday", TUE: "Tuesday", WED: "Wednesday",
    THU: "Thursday", FRI: "Friday", SAT: "Saturday", SUN: "Sunday",
  };
  function minsToHHMM(m: number) {
    return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  }

  const entriesWithCode = timetableEntries
    .filter(t => t.unitOffering?.unit && t.sharedSession)
    .map((t) => ({
      day: DOW_MAP[t.sharedSession!.day] ?? t.sharedSession!.day,
      startTime: minsToHHMM(t.sharedSession!.startMinute),
      unitId: t.unitOffering!.unitId,
      unitCode: t.unitOffering!.unit!.code.toUpperCase(),
    }));

  // 4. Define semester range — approximate: last 4 months to now
  const now = new Date();
  const semesterStart = new Date(now);
  semesterStart.setMonth(semesterStart.getMonth() - 4);
  semesterStart.setDate(1);
  semesterStart.setHours(0, 0, 0, 0);

  // 5. Expand scheduled sessions in the semester
  const scheduled = expandScheduledSessions(entriesWithCode, semesterStart, now);
  const totalSessions = scheduled.length;

  // 6. Fetch all attendance records for this student in the timeframe
  //    Source A: online QR sessions (OnlineAttendanceRecord)
  //    Source B: offline BLE / manual / manual_lecturer (OfflineAttendanceRecord)
  const [attendanceRecords, offlineAttendanceRecords] = await Promise.all([
    prisma.onlineAttendanceRecord.findMany({
      where: {
        studentId,
        markedAt: { gte: semesterStart, lte: now },
      },
      select: {
        id: true,
        unitCode: true,
        markedAt: true,
        session: {
          select: { createdAt: true, unitCode: true },
        },
      },
      orderBy: { markedAt: "desc" },
    }),

    // Source B: offline BLE / manual / manual_lecturer
    prisma.offlineAttendanceRecord.findMany({
      where: {
        studentId,
        scannedAt: { gte: semesterStart, lte: now },
        unitCode: { not: "" },
      },
      select: {
        id: true,
        unitCode: true,
        scannedAt: true,
        sessionStart: true,
      },
      orderBy: { scannedAt: "desc" },
    }),
  ]);

  // Build a set of attended (dateKey, unitCode) pairs — union of online + offline
  const attendedSet = new Set<string>();
  for (const rec of attendanceRecords) {
    const dk = dateKey(rec.markedAt);
    const uc = (rec.unitCode || rec.session.unitCode).toUpperCase();
    attendedSet.add(`${dk}|${uc}`);
  }
  for (const rec of offlineAttendanceRecords) {
    const dk = dateKey(rec.scannedAt);
    const uc = rec.unitCode.toUpperCase();
    attendedSet.add(`${dk}|${uc}`);
  }

  const attended = attendedSet.size;
  const missed = Math.max(0, totalSessions - attended);
  const percent = totalSessions > 0 ? Math.round((attended / totalSessions) * 1000) / 10 : 0;

  // 7. On-time count: within 5 minutes of session start
  //    Online: markedAt within 5 min of session.createdAt
  //    Offline: scannedAt within 5 min of sessionStart
  let ontimeCount = 0;
  for (const rec of attendanceRecords) {
    const diff = rec.markedAt.getTime() - rec.session.createdAt.getTime();
    if (diff >= 0 && diff <= ONTIME_MS) {
      ontimeCount++;
    }
  }
  for (const rec of offlineAttendanceRecords) {
    const diff = rec.scannedAt.getTime() - rec.sessionStart.getTime();
    if (diff >= 0 && diff <= ONTIME_MS) {
      ontimeCount++;
    }
  }

  // 8. Build per-day and per-unit stats from scheduled sessions
  // dayScheduled: dateKey → set of unitCodes scheduled
  // dayAttended: dateKey → set of unitCodes attended
  const dayScheduled = new Map<string, Set<string>>();
  const dayAttended = new Map<string, Set<string>>();

  for (const s of scheduled) {
    const set = dayScheduled.get(s.dateStr) ?? new Set();
    set.add(s.unitCode);
    dayScheduled.set(s.dateStr, set);
  }

  for (const rec of attendanceRecords) {
    const dk = dateKey(rec.markedAt);
    const uc = (rec.unitCode || rec.session.unitCode).toUpperCase();
    const set = dayAttended.get(dk) ?? new Set();
    set.add(uc);
    dayAttended.set(dk, set);
  }
  for (const rec of offlineAttendanceRecords) {
    const dk = dateKey(rec.scannedAt);
    const uc = rec.unitCode.toUpperCase();
    const set = dayAttended.get(dk) ?? new Set();
    set.add(uc);
    dayAttended.set(dk, set);
  }

  // perfectDay: a day where all scheduled sessions were attended
  const sortedDays = [...dayScheduled.keys()].sort();
  const perfectDayFlags: boolean[] = [];
  const perfectDays: string[] = [];
  for (const day of sortedDays) {
    const sched = dayScheduled.get(day)!;
    const att = dayAttended.get(day);
    const perfect = att != null && [...sched].every((uc) => att.has(uc));
    perfectDayFlags.push(perfect);
    if (perfect) perfectDays.push(day);
  }

  // 9. Streaks: consecutive perfect days (only days that have scheduled sessions)
  let currentStreak = 0;
  let longestStreak = 0;
  let streak = 0;
  for (let i = 0; i < sortedDays.length; i++) {
    if (perfectDayFlags[i]) {
      streak++;
      if (streak > longestStreak) longestStreak = streak;
    } else {
      streak = 0;
    }
  }
  // currentStreak: count backwards from the most recent scheduled day
  currentStreak = 0;
  for (let i = sortedDays.length - 1; i >= 0; i--) {
    if (perfectDayFlags[i]) {
      currentStreak++;
    } else {
      break;
    }
  }

  // 10. Perfect weeks (Mon-Fri): group scheduled days by ISO week,
  //     a week is perfect if ALL scheduled days in that week are perfect
  const weekGroups = new Map<string, { scheduled: number; perfect: number }>();
  for (let i = 0; i < sortedDays.length; i++) {
    const wk = weekKey(new Date(sortedDays[i]));
    const g = weekGroups.get(wk) ?? { scheduled: 0, perfect: 0 };
    g.scheduled++;
    if (perfectDayFlags[i]) g.perfect++;
    weekGroups.set(wk, g);
  }
  let perfectWeeks = 0;
  for (const g of weekGroups.values()) {
    if (g.scheduled > 0 && g.scheduled === g.perfect) perfectWeeks++;
  }

  // 11. Perfect months
  const monthGroups = new Map<string, { scheduled: number; perfect: number }>();
  for (let i = 0; i < sortedDays.length; i++) {
    const mk = monthKey(new Date(sortedDays[i]));
    const g = monthGroups.get(mk) ?? { scheduled: 0, perfect: 0 };
    g.scheduled++;
    if (perfectDayFlags[i]) g.perfect++;
    monthGroups.set(mk, g);
  }
  let perfectMonths = 0;
  for (const g of monthGroups.values()) {
    if (g.scheduled > 0 && g.scheduled === g.perfect) perfectMonths++;
  }

  // 12. Comebacks: after 3+ consecutive misses, next attendance = comeback
  let comebacks = 0;
  let consecutiveMisses = 0;
  for (let i = 0; i < sortedDays.length; i++) {
    if (!perfectDayFlags[i]) {
      consecutiveMisses++;
    } else {
      if (consecutiveMisses >= 3) comebacks++;
      consecutiveMisses = 0;
    }
  }

  // 13. Units above 90%
  const unitScheduledCount = new Map<string, number>();
  const unitAttendedCount = new Map<string, number>();
  for (const s of scheduled) {
    unitScheduledCount.set(s.unitCode, (unitScheduledCount.get(s.unitCode) ?? 0) + 1);
  }
  for (const rec of attendanceRecords) {
    const uc = (rec.unitCode || rec.session.unitCode).toUpperCase();
    unitAttendedCount.set(uc, (unitAttendedCount.get(uc) ?? 0) + 1);
  }
  for (const rec of offlineAttendanceRecords) {
    const uc = rec.unitCode.toUpperCase();
    unitAttendedCount.set(uc, (unitAttendedCount.get(uc) ?? 0) + 1);
  }
  const unitsAbove90: string[] = [];
  for (const [uc, sCount] of unitScheduledCount) {
    const aCount = unitAttendedCount.get(uc) ?? 0;
    if (sCount > 0 && aCount / sCount > 0.9) {
      unitsAbove90.push(uc);
    }
  }

  // 14. Per-unit attendance summary
  const unitAttendance: Record<string, { attended: number; total: number }> = {};
  for (const [uc, total] of unitScheduledCount) {
    unitAttendance[uc] = { total, attended: unitAttendedCount.get(uc) ?? 0 };
  }
  // Also include units that have attendance records but no timetable entries
  for (const [uc, attCount] of unitAttendedCount) {
    if (!(uc in unitAttendance)) {
      unitAttendance[uc] = { total: attCount, attended: attCount };
    }
  }

  // 15. Perfect days count (for daily_bonus rule)
  const perfectDayCount = perfectDays.length;

  // 15. First session done
  const firstSessionDone = attended > 0;

  // ── Points Breakdown ────────────────────────────────────────────────────────
  const streak7Count = longestStreak >= 7 ? Math.floor(longestStreak / 7) : 0;
  const streak30Count = longestStreak >= 30 ? Math.floor(longestStreak / 30) : 0;

  const breakdown: BreakdownEntry[] = [
    { rule: "attend", count: attended, pts: attended * POINTS.attend },
    { rule: "daily_bonus", count: perfectDayCount, pts: perfectDayCount * POINTS.daily_bonus },
    { rule: "ontime", count: ontimeCount, pts: ontimeCount * POINTS.ontime },
    { rule: "weekly_100", count: perfectWeeks, pts: perfectWeeks * POINTS.weekly_100 },
    { rule: "monthly_100", count: perfectMonths, pts: perfectMonths * POINTS.monthly_100 },
    { rule: "streak_7", count: streak7Count, pts: streak7Count * POINTS.streak_7 },
    { rule: "streak_30", count: streak30Count, pts: streak30Count * POINTS.streak_30 },
    { rule: "unit_90", count: unitsAbove90.length, pts: unitsAbove90.length * POINTS.unit_90 },
    { rule: "comeback", count: comebacks, pts: comebacks * POINTS.comeback },
    { rule: "first", count: firstSessionDone ? 1 : 0, pts: firstSessionDone ? POINTS.first : 0 },
  ];
  const total = breakdown.reduce((s, b) => s + b.pts, 0);

  // ── Recent Activity (most recent 20 across all methods) ─────────────────────
  // Merge online + offline into a unified list sorted by time desc
  type ActivityEntry = { id: string; unitCode: string; date: Date; ontime: boolean; method: string };
  const allActivity: ActivityEntry[] = [];
  for (const rec of attendanceRecords) {
    const uc = (rec.unitCode || rec.session.unitCode).toUpperCase();
    const diff = rec.markedAt.getTime() - rec.session.createdAt.getTime();
    allActivity.push({ id: rec.id, unitCode: uc, date: rec.markedAt, ontime: diff >= 0 && diff <= ONTIME_MS, method: "qr" });
  }
  for (const rec of offlineAttendanceRecords) {
    const uc = rec.unitCode.toUpperCase();
    const diff = rec.scannedAt.getTime() - rec.sessionStart.getTime();
    allActivity.push({ id: rec.id, unitCode: uc, date: rec.scannedAt, ontime: diff >= 0 && diff <= ONTIME_MS, method: "offline" });
  }
  allActivity.sort((a, b) => b.date.getTime() - a.date.getTime());

  const recentActivity: RecentActivity[] = [];
  for (const entry of allActivity.slice(0, 20)) {
    recentActivity.push({
      id: entry.id,
      label: `Attended ${entry.unitCode} Session`,
      rule: "attend",
      pts: POINTS.attend,
      date: entry.date.toISOString(),
    });
    if (entry.ontime) {
      recentActivity.push({
        id: `${entry.id}-ontime`,
        label: "On-time bonus",
        rule: "ontime",
        pts: POINTS.ontime,
        date: entry.date.toISOString(),
      });
    }
  }

  // Cap at 20 entries
  const stats: GamificationStats = {
    totalSessions,
    attended,
    missed,
    percent,
    currentStreak,
    longestStreak,
    perfectWeeks,
    perfectMonths,
    ontimeCount,
    comebacks,
    firstSessionDone,
    unitsAbove90,
    unitAttendance,
  };

  return {
    stats,
    points: { total, breakdown },
    recentActivity: recentActivity.slice(0, 20),
  };
}

// ── Persist to Cache Table ────────────────────────────────────────────────────

export async function computeAndCachePoints(studentId: string) {
  const result = await computeGamification(studentId);

  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { courseId: true, institutionId: true },
  });
  if (!student) return result;

  await prisma.studentPoints.upsert({
    where: { studentId },
    create: {
      studentId,
      courseId: student.courseId,
      institutionId: student.institutionId,
      totalPoints: result.points.total,
      currentStreak: result.stats.currentStreak,
      longestStreak: result.stats.longestStreak,
      attendancePct: result.stats.percent,
      statsJson: result.stats as any,
      breakdownJson: result.points.breakdown as any,
      computedAt: new Date(),
    },
    update: {
      courseId: student.courseId,
      institutionId: student.institutionId,
      totalPoints: result.points.total,
      currentStreak: result.stats.currentStreak,
      longestStreak: result.stats.longestStreak,
      attendancePct: result.stats.percent,
      statsJson: result.stats as any,
      breakdownJson: result.points.breakdown as any,
      computedAt: new Date(),
    },
  });

  return result;
}

// ── Empty Result ──────────────────────────────────────────────────────────────

function emptyResult(): GamificationResult {
  return {
    stats: {
      totalSessions: 0,
      attended: 0,
      missed: 0,
      percent: 0,
      currentStreak: 0,
      longestStreak: 0,
      perfectWeeks: 0,
      perfectMonths: 0,
      ontimeCount: 0,
      comebacks: 0,
      firstSessionDone: false,
      unitsAbove90: [],
      unitAttendance: {},
    },
    points: {
      total: 0,
      breakdown: Object.keys(POINTS).map((rule) => ({ rule, count: 0, pts: 0 })),
    },
    recentActivity: [],
  };
}
