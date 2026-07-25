/**
 * POST /api/reports/generate
 *
 * Generates an academic report for the authenticated lecturer and uploads it
 * to Vercel Blob storage, returning a publicly-accessible URL.
 *
 * Auth: Bearer <lecturerToken>
 *
 * Body:
 * {
 *   period:     "weekly" | "monthly" | "semester"
 *   types:      string[]
 *   format:     "pdf" | "csv" | "excel"
 *   department: string      (display name for report header)
 *   unitCodes:  string[]
 *   startDate:  "YYYY-MM-DD"
 *   endDate:    "YYYY-MM-DD"
 * }
 *
 * Returns: { fileUrl: string }
 * Errors:  { message: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyLecturerAccessToken } from "@/lib/lecturerAuthJwt";
import { normalizeUnitCode } from "@/lib/unitCode";
import { put } from "@vercel/blob";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────
const VALID_PERIODS  = ["weekly", "monthly", "semester"] as const;
const VALID_TYPES    = ["attendance", "performance", "assignments", "students", "sessions", "comprehensive"] as const;
const VALID_FORMATS  = ["pdf", "csv", "excel"] as const;

type Period     = (typeof VALID_PERIODS)[number];
type ReportType = (typeof VALID_TYPES)[number];
type Format     = (typeof VALID_FORMATS)[number];

const MIME_MAP: Record<Format, string> = {
  pdf:   "application/pdf",
  csv:   "text/csv",
  excel: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

// Attendance status thresholds
const THRESHOLD_GOOD    = 75;  // >= 75%: Good
const THRESHOLD_AT_RISK = 60;  // 60-74%: At Risk; < 60%: Warning

const STATUS_COLORS: Record<string, string> = {
  Good:      "#D1FAE5",
  "At Risk": "#FEF3C7",
  Warning:   "#FEE2E2",
};

const STATUS_SORT: Record<string, number> = {
  Warning:   0,
  "At Risk": 1,
  Good:      2,
};

// ─────────────────────────────────────────────────────────────────
// Data types
// ─────────────────────────────────────────────────────────────────
interface SessionRow {
  index:        number;    // 1-based lecture number
  sessionStart: Date;
  lectureRoom:  string;
  lessonType:   string;
  key:          string;    // "${lectureRoom}_${sessionStart.toISOString()}" for presence lookup
}

interface StudentRow {
  studentId:       string;
  admissionNumber: string;
  name:            string;
  attended:        number;
  totalSessions:   number;
  rate:            number;
  status:          "Good" | "At Risk" | "Warning";
}

interface UnitReportData {
  unitCode:        string;
  unitName:        string;
  department:      string;
  lecturerName:    string;
  institutionName: string;
  sessions:        SessionRow[];
  students:        StudentRow[];
  presenceMap:     Set<string>;  // "${studentId}__${sessionKey}"
  summary: {
    totalEnrolled:    number;
    totalSessions:    number;
    avgAttendance:    number;
    trend:            string;    // e.g. "▲ +5%" | "▼ -3%" | "→ No change"
    belowThreshold75: number;
    belowThreshold60: number;
  };
}

// ─────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────
function apiErr(msg: string, status: number): NextResponse {
  return NextResponse.json({ message: msg }, { status, headers: corsHeaders });
}

function parseCalendarDate(s: string): Date | null {
  const d = new Date(s + "T00:00:00.000Z");
  return isNaN(d.getTime()) ? null : d;
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtDateTime(d: Date): string {
  const date = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${date} ${time}`;
}

function studentStatus(rate: number): "Good" | "At Risk" | "Warning" {
  if (rate >= THRESHOLD_GOOD)    return "Good";
  if (rate >= THRESHOLD_AT_RISK) return "At Risk";
  return "Warning";
}

// ─────────────────────────────────────────────────────────────────
// Per-unit data gatherer
// ─────────────────────────────────────────────────────────────────
async function gatherUnitReportData(
  unitCode: string,
  lecturerId: string,
  lecturerName: string,
  institutionName: string,
  departmentLabel: string,
  start: Date,
  end: Date,
): Promise<UnitReportData> {
  const norm = normalizeUnitCode(unitCode);

  // 1. Unit info
  const unit = await prisma.unit.findFirst({
    where: { code: { equals: norm, mode: "insensitive" } },
    select: { id: true, title: true, code: true, department: { select: { name: true } } },
  });
  const unitName   = unit?.title                ?? unitCode;
  const department = departmentLabel || (unit?.department?.name ?? "");

  // 2. Enrolled students
  const enrollments = unit
    ? await prisma.enrollment.findMany({
        where: { unitId: unit.id },
        select: {
          studentId: true,
          student: { select: { name: true, admissionNumber: true } },
        },
      })
    : [];
  const roster = enrollments.map((e) => ({
    studentId:       e.studentId,
    admissionNumber: e.student?.admissionNumber ?? "",
    name:            e.student?.name ?? e.studentId,
  }));

  // 3. Conducted sessions in the date range
  const conductedSessions = await prisma.conductedSession.findMany({
    where: {
      lecturerId,
      unitCode: { equals: norm, mode: "insensitive" },
      sessionStart: { gte: start, lte: end },
    },
    orderBy: { sessionStart: "asc" },
  });
  const sessions: SessionRow[] = conductedSessions.map((s, i) => ({
    index:        i + 1,
    sessionStart: s.sessionStart,
    lectureRoom:  s.lectureRoom,
    lessonType:   s.lessonType ?? "LEC",
    key:          `${s.lectureRoom}_${s.sessionStart.toISOString()}`,
  }));

  // 4. Offline attendance records in range
  const offlineRecords = await prisma.offlineAttendanceRecord.findMany({
    where: {
      unitCode:     { equals: norm, mode: "insensitive" },
      sessionStart: { gte: start, lte: end },
    },
    select: { studentId: true, lectureRoom: true, sessionStart: true },
  });

  // 5. Online attendance — match to conducted sessions by time (±15 min)
  const onlineSessions = await prisma.onlineAttendanceSession.findMany({
    where: {
      lecturerId,
      unitCode: { equals: norm, mode: "insensitive" },
      createdAt: {
        gte: new Date(start.getTime() - 15 * 60_000),
        lte: new Date(end.getTime()   + 15 * 60_000),
      },
    },
    include: { records: { select: { studentId: true } } },
  });
  // Sort sessions by start time once, then use a scan window for O((n+m) log n) matching
  const sortedSessions = sessions.slice().sort((a, b) => a.sessionStart.getTime() - b.sessionStart.getTime());
  const FIFTEEN_MIN_MS = 15 * 60_000;
  const onlineToSessionKey = new Map<string, string>();
  for (const os of onlineSessions) {
    const osMs = os.createdAt.getTime();
    let bestKey: string | null = null;
    let bestDiff = Infinity;
    // Binary search for first candidate within window
    let lo = 0, hi = sortedSessions.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (sortedSessions[mid].sessionStart.getTime() < osMs - FIFTEEN_MIN_MS) lo = mid + 1;
      else hi = mid - 1;
    }
    for (let i = lo; i < sortedSessions.length; i++) {
      const diff = Math.abs(sortedSessions[i].sessionStart.getTime() - osMs);
      if (diff > FIFTEEN_MIN_MS) break;
      if (diff < bestDiff) { bestDiff = diff; bestKey = sortedSessions[i].key; }
    }
    if (bestKey) onlineToSessionKey.set(os.id, bestKey);
  }

  // 6. Build presence set:  "${studentId}__${sessionKey}"
  const presenceMap = new Set<string>();
  for (const r of offlineRecords) {
    presenceMap.add(`${r.studentId}__${r.lectureRoom}_${r.sessionStart.toISOString()}`);
  }
  for (const os of onlineSessions) {
    const key = onlineToSessionKey.get(os.id);
    if (!key) continue;
    for (const r of os.records) presenceMap.add(`${r.studentId}__${key}`);
  }

  // 7. Per-student stats — pre-build attended count from presenceMap (O(P) instead of O(n*m))
  const totalSessions = sessions.length;
  const attendedByStudent = new Map<string, number>();
  for (const key of presenceMap) {
    const sep = key.indexOf('__');
    if (sep === -1) continue;
    const sid = key.slice(0, sep);
    attendedByStudent.set(sid, (attendedByStudent.get(sid) ?? 0) + 1);
  }
  const students: StudentRow[] = roster.map(({ studentId, admissionNumber, name }) => {
    const attended = attendedByStudent.get(studentId) ?? 0;
    const rate     = totalSessions > 0 ? Math.round((attended / totalSessions) * 100) : 0;
    return { studentId, admissionNumber, name, attended, totalSessions, rate, status: studentStatus(rate) };
  });
  // Sort: Warning → At Risk → Good
  students.sort((a, b) => STATUS_SORT[a.status] - STATUS_SORT[b.status]);

  // 8. Summary
  const avgAttendance =
    students.length > 0 && totalSessions > 0
      ? Math.round(students.reduce((s, r) => s + r.rate, 0) / students.length)
      : 0;
  const belowThreshold75 = students.filter((s) => s.rate < THRESHOLD_GOOD    && totalSessions > 0).length;
  const belowThreshold60 = students.filter((s) => s.rate < THRESHOLD_AT_RISK && totalSessions > 0).length;

  // 9. Previous period trend
  const periodMs  = end.getTime() - start.getTime();
  const prevEnd   = new Date(start.getTime() - 1);
  const prevStart = new Date(start.getTime() - periodMs - 1);
  const prevSessions = await prisma.conductedSession.findMany({
    where: {
      lecturerId,
      unitCode:     { equals: norm, mode: "insensitive" },
      sessionStart: { gte: prevStart, lte: prevEnd },
    },
    select: { sessionStart: true, lectureRoom: true },
  });

  let trend = "→ No change";
  if (prevSessions.length > 0 && roster.length > 0) {
    const prevRecords = await prisma.offlineAttendanceRecord.findMany({
      where: {
        unitCode:     { equals: norm, mode: "insensitive" },
        sessionStart: { gte: prevStart, lte: prevEnd },
      },
      select: { studentId: true, lectureRoom: true, sessionStart: true },
    });
    const prevPresence = new Set(
      prevRecords.map((r) => `${r.studentId}__${r.lectureRoom}_${r.sessionStart.toISOString()}`),
    );
    const prevAvg = Math.round(
      roster
        .map(({ studentId }) => {
          const attended = prevSessions.filter((s) =>
            prevPresence.has(`${studentId}__${s.lectureRoom}_${s.sessionStart.toISOString()}`),
          ).length;
          return prevSessions.length > 0 ? Math.round((attended / prevSessions.length) * 100) : 0;
        })
        .reduce((a, b) => a + b, 0) / roster.length,
    );
    const delta = avgAttendance - prevAvg;
    if      (delta > 0) trend = `▲ +${delta}%`;
    else if (delta < 0) trend = `▼ ${delta}%`;
    else                trend = "→ No change";
  }

  return {
    unitCode: norm,
    unitName,
    department,
    lecturerName,
    institutionName,
    sessions,
    students,
    presenceMap,
    summary: {
      totalEnrolled: roster.length,
      totalSessions,
      avgAttendance,
      trend,
      belowThreshold75,
      belowThreshold60,
    },
  };
}

// ─────────────────────────────────────────────────────────────────
// Performance report — data types
// ─────────────────────────────────────────────────────────────────
interface LessonTypeBreakdown {
  lessonType: string;
  count: number;
  pct: number;
}

interface PerformanceUnitData {
  unitCode:          string;
  unitName:          string;
  department:        string;
  lecturerName:      string;
  institutionName:   string;
  sessionsConducted: number;
  sessionsPlanned:   number;
  completionRate:    number; // 0-100
  onlineSessions:    number;
  offlineSessions:   number;
  delegationSessions: number;
  avgAttendance:     number; // 0-100
  studentsEnrolled:  number;
  lessonBreakdown:   LessonTypeBreakdown[];
}

// ─────────────────────────────────────────────────────────────────
// Performance report — gather data
// ─────────────────────────────────────────────────────────────────

/** Count occurrences of each day-of-week string within [start, end] (inclusive). */
function countDayOccurrences(dayName: string, start: Date, end: Date): number {
  const DAY_INDEX: Record<string, number> = {
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
    thursday: 4, friday: 5, saturday: 6,
  };
  const idx = DAY_INDEX[dayName.toLowerCase()];
  if (idx === undefined) return 0;
  // Walk from start to end counting matching days
  let count = 0;
  const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const endMs = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  while (d.getTime() <= endMs) {
    if (d.getUTCDay() === idx) count++;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return count;
}

async function gatherPerformanceData(
  unitCode: string,
  lecturerId: string,
  lecturerName: string,
  institutionName: string,
  departmentLabel: string,
  start: Date,
  end: Date,
): Promise<PerformanceUnitData> {
  const norm = normalizeUnitCode(unitCode);

  // ── Unit info ──────────────────────────────────────────────────
  const unit = await prisma.unit.findFirst({
    where: { code: { equals: norm, mode: "insensitive" } },
    select: { id: true, title: true, code: true, department: { select: { name: true } } },
  });
  const unitName   = unit?.title              ?? unitCode;
  const department = departmentLabel || (unit?.department?.name ?? "");

  // ── Sessions conducted in range (offline + online) ─────────────
  const [offlineSessions, onlineSessionsInRange] = await Promise.all([
    prisma.conductedSession.findMany({
      where: {
        lecturerId,
        unitCode: { equals: norm, mode: "insensitive" },
        createdAt: { gte: start, lte: end },
      },
      select: { id: true, lectureRoom: true, lessonType: true, sessionStart: true },
    }),
    prisma.onlineAttendanceSession.findMany({
      where: {
        lecturerId,
        unitCode: { equals: norm, mode: "insensitive" },
        endedAt: { not: null },
        createdAt: { gte: start, lte: end },
      },
      select: { id: true, createdAt: true },
    }),
  ]);

  // ── Standalone delegation sessions in range (±5 min dedup) ──────────────────
  const rawUnitCodeForDel = unit?.code ?? norm;
  const delegationsAll = await prisma.delegation.findMany({
    where: { createdBy: lecturerId, unitCode: rawUnitCodeForDel, used: true },
    select: { validFrom: true },
  });
  const FIVE_MIN_MS_PERF = 5 * 60 * 1000;
  const BUCKET_MS = FIVE_MIN_MS_PERF;
  // Build a Set of 5-min buckets from offline session times for O(1) dedup lookup
  const offlineTimeBuckets = new Set<number>(
    offlineSessions.flatMap((s) => {
      const t = s.sessionStart.getTime();
      return [Math.floor(t / BUCKET_MS), Math.ceil(t / BUCKET_MS)];
    })
  );
  const standaloneDelegations = delegationsAll.filter((d) => {
    const delegMs = Number(d.validFrom);
    return (
      delegMs >= start.getTime() &&
      delegMs <= end.getTime() &&
      !offlineTimeBuckets.has(Math.round(delegMs / BUCKET_MS))
    );
  });
  const delegationCount = standaloneDelegations.length;

  const sessionsConducted = offlineSessions.length + onlineSessionsInRange.length + delegationCount;
  const onlineSessions    = offlineSessions.filter((s) => s.lectureRoom.toUpperCase() === "ONLINE").length
    + onlineSessionsInRange.length;
  const offlineSessionsCount = offlineSessions.filter((s) => s.lectureRoom.toUpperCase() !== "ONLINE").length;

  // ── Planned sessions from timetable ───────────────────────────
  const timetableEntries = await prisma.timetable.findMany({
    where: {
      lecturerId,
      unitOffering: { unitId: unit?.id ?? "__none__" },
      timetableStatus: { not: "CANCELLED" },
    },
    include: { sharedSession: { select: { day: true } } },
  });
  const DAY_ENUM_TO_NAME: Record<string, string> = {
    MON: "monday", TUE: "tuesday", WED: "wednesday", THU: "thursday",
    FRI: "friday", SAT: "saturday", SUN: "sunday",
  };
  const sessionsPlanned = timetableEntries.reduce(
    (sum, e) => {
      const dayEnum = e.sharedSession?.day;
      const dayName = dayEnum ? (DAY_ENUM_TO_NAME[dayEnum] ?? dayEnum.toLowerCase()) : null;
      return sum + (dayName ? countDayOccurrences(dayName, start, end) : 0);
    },
    0,
  );
  const completionRate = sessionsPlanned > 0
    ? Math.min(Math.round((sessionsConducted / sessionsPlanned) * 100), 100)
    : 100;

  // ── Lesson type breakdown ──────────────────────────────────────
  const lessonTypeCounts: Record<string, number> = {};
  for (const s of offlineSessions) {
    const lt = (s.lessonType ?? "LEC").toUpperCase();
    lessonTypeCounts[lt] = (lessonTypeCounts[lt] ?? 0) + 1;
  }
  if (onlineSessionsInRange.length > 0) {
    lessonTypeCounts["ONLINE"] = (lessonTypeCounts["ONLINE"] ?? 0) + onlineSessionsInRange.length;
  }
  if (delegationCount > 0) {
    lessonTypeCounts["GD"] = (lessonTypeCounts["GD"] ?? 0) + delegationCount;
  }
  const totalForBreakdown = sessionsConducted || 1;
  const lessonBreakdown: LessonTypeBreakdown[] = Object.entries(lessonTypeCounts)
    .map(([lessonType, count]) => ({
      lessonType,
      count,
      pct: Math.round((count / totalForBreakdown) * 100),
    }))
    .sort((a, b) => b.count - a.count);

  // ── Students enrolled ──────────────────────────────────────────
  const studentsEnrolled = unit
    ? await prisma.enrollment.count({ where: { unitId: unit.id } })
    : 0;

  // ── Average attendance per session ────────────────────────────
  let avgAttendance = 0;
  if (sessionsConducted > 0 && studentsEnrolled > 0) {
    const [offlineRecordCount, onlineRecordCount] = await Promise.all([
      prisma.offlineAttendanceRecord.count({
        where: {
          unitCode:     { equals: norm, mode: "insensitive" },
          sessionStart: { gte: start, lte: end },
        },
      }),
      onlineSessionsInRange.length > 0
        ? prisma.onlineAttendanceRecord.count({
            where: { sessionId: { in: onlineSessionsInRange.map((s) => s.id) } },
          })
        : Promise.resolve(0),
    ]);
    const totalMarks = offlineRecordCount + onlineRecordCount;
    avgAttendance = Math.round((totalMarks / (sessionsConducted * studentsEnrolled)) * 100);
    avgAttendance = Math.min(avgAttendance, 100);
  }

  return {
    unitCode: norm,
    unitName,
    department,
    lecturerName,
    institutionName,
    sessionsConducted,
    sessionsPlanned,
    completionRate,
    onlineSessions,
    offlineSessions: offlineSessionsCount,
    delegationSessions: delegationCount,
    avgAttendance,
    studentsEnrolled,
    lessonBreakdown,
  };
}

// ─────────────────────────────────────────────────────────────────
// Performance report — PDF builder
// ─────────────────────────────────────────────────────────────────
const PERF_HEADER_COLOR  = "#4F46E5";
const PERF_H1_COLOR      = "#312e81";
const PERF_BORDER_COLOR  = "#4F46E5";

async function buildPerformancePdf(
  units: PerformanceUnitData[],
  period: Period,
  startDate: Date,
  endDate: Date,
): Promise<Buffer> {
  const PDFDocument = (await import("pdfkit")).default;

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ margin: 50, size: "A4", autoFirstPage: false });
    doc.on("data",  (c: Buffer) => chunks.push(c));
    doc.on("end",   () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const W         = 595 - 100; // usable width
    const FONT_BOLD = "Helvetica-Bold";
    const FONT      = "Helvetica";

    // ── Simple table row helper ────────────────────────────────
    function tableRow(
      cols: string[],
      colWidths: number[],
      x: number,
      y: number,
      bgColor?: string,
      bold?: boolean,
    ): number {
      const rowH = 18;
      if (bgColor) {
        doc.save().rect(x, y, colWidths.reduce((a, b) => a + b, 0), rowH).fill(bgColor).restore();
      }
      doc.fontSize(8).font(bold ? FONT_BOLD : FONT).fillColor("#000000");
      let cx = x;
      for (let i = 0; i < cols.length; i++) {
        doc.text(cols[i], cx + 3, y + 5, { width: colWidths[i] - 6, lineBreak: false, ellipsis: true });
        cx += colWidths[i];
      }
      return rowH;
    }

    // ── Render each unit ───────────────────────────────────────
    for (let ui = 0; ui < units.length; ui++) {
      const u = units[ui];
      doc.addPage();
      let y = 50;

      // ── Header ──────────────────────────────────────────────
      doc.fontSize(14).font(FONT_BOLD).fillColor(PERF_H1_COLOR)
        .text("MarkWise — Unit Performance Report", 50, y, { width: W });
      y += 22;
      doc.fontSize(11).font(FONT_BOLD).fillColor(PERF_H1_COLOR)
        .text(u.department, 50, y, { width: W });
      y += 20;

      // Meta table
      doc.fontSize(9).font(FONT).fillColor("#000000");
      const labelW = 80;
      const metaRows = [
        ["Unit:",       `${u.unitCode}  —  ${u.unitName}`],
        ["Lecturer:",   u.lecturerName],
        ["Period:",     `${period.charAt(0).toUpperCase() + period.slice(1)}   ${fmtDate(startDate)} – ${fmtDate(endDate)}`],
        ["Generated:",  fmtDateTime(new Date())],
      ];
      for (const [lbl, val] of metaRows) {
        doc.font(FONT_BOLD).text(lbl, 50, y, { width: labelW, continued: false });
        doc.font(FONT).text(val, 50 + labelW, y, { width: W - labelW });
        y += 14;
      }
      y += 8;

      // ── Section 1: Session Completion ───────────────────────
      doc.save().rect(50, y, W, 16).fill(PERF_HEADER_COLOR).restore();
      doc.fontSize(9).font(FONT_BOLD).fillColor("#ffffff")
        .text("SESSION COMPLETION", 54, y + 4, { width: W - 8, lineBreak: false });
      doc.fillColor("#000000");
      y += 18;

      const s1ColW = [180, W - 180];
      const completionRows: [string, string][] = [
        ["Sessions Conducted",  String(u.sessionsConducted)],
        ["Sessions Planned",    u.sessionsPlanned > 0 ? String(u.sessionsPlanned) : "N/A"],
        ["Completion Rate",     u.sessionsPlanned > 0 ? `${u.completionRate}%` : "N/A"],
        ["Online Sessions",             String(u.onlineSessions)],
        ["Offline Sessions",            String(u.offlineSessions)],
        ["Group Delegation Sessions",   String(u.delegationSessions)],
        ["Average Attendance",          `${u.avgAttendance}%`],
        ["Students Enrolled",   String(u.studentsEnrolled)],
      ];
      let altRow = false;
      for (const [field, value] of completionRows) {
        const bg = altRow ? "#F5F3FF" : "#ffffff";
        tableRow([field, value], s1ColW, 50, y, bg);
        y += 18;
        altRow = !altRow;
      }
      y += 10;

      // ── Section 2: Lesson Type Breakdown ────────────────────
      doc.save().rect(50, y, W, 16).fill(PERF_HEADER_COLOR).restore();
      doc.fontSize(9).font(FONT_BOLD).fillColor("#ffffff")
        .text("LESSON TYPE BREAKDOWN", 54, y + 4, { width: W - 8, lineBreak: false });
      doc.fillColor("#000000");
      y += 18;

      const s2ColW = [180, 100, 80, W - 360];
      // Header row
      doc.save().rect(50, y, W, 18).fill("#E0E7FF").restore();
      doc.fontSize(8).font(FONT_BOLD).fillColor("#000000");
      let hx = 50;
      for (const [col, cw] of [["Lesson Type", s2ColW[0]], ["Sessions", s2ColW[1]], ["% of Total", s2ColW[2]]] as [string, number][]) {
        doc.text(col, hx + 3, y + 5, { width: cw - 6, lineBreak: false });
        hx += cw;
      }
      y += 18;

      if (u.lessonBreakdown.length === 0) {
        doc.fontSize(8).font(FONT).fillColor("#374151")
          .text("No sessions recorded in this period.", 53, y + 4);
        y += 18;
      } else {
        altRow = false;
        for (const lt of u.lessonBreakdown) {
          const bg = altRow ? "#F5F3FF" : "#ffffff";
          tableRow(
            [lt.lessonType, String(lt.count), `${lt.pct}%`],
            [s2ColW[0], s2ColW[1], s2ColW[2]],
            50, y, bg,
          );
          y += 18;
          altRow = !altRow;
        }
      }

      // Bottom border
      doc.moveTo(50, y).lineTo(545, y).stroke(PERF_BORDER_COLOR);

      // Page number
      doc.fontSize(7).font(FONT).fillColor("#666666")
        .text(`Page ${ui + 1}`, 0, 780, { align: "center", width: 595 });
      doc.fillColor("#000000");
    }

    doc.end();
  });
}

// ─────────────────────────────────────────────────────────────────
// Performance report — CSV builder
// ─────────────────────────────────────────────────────────────────
function buildPerformanceCsv(
  units: PerformanceUnitData[],
  period: Period,
  startDate: Date,
  endDate: Date,
): string {
  const lines: string[] = [];
  const esc = (v: string | number | null | undefined) =>
    `"${String(v ?? "").replace(/"/g, '""')}"`;
  const row = (...cells: (string | number | null | undefined)[]) =>
    lines.push(cells.map(esc).join(","));

  for (const u of units) {
    row("MarkWise Unit Performance Report");
    row("Department",  u.department);
    row("Unit Code",   u.unitCode);
    row("Unit Name",   u.unitName);
    row("Lecturer",    u.lecturerName);
    row("Period",      `${period.charAt(0).toUpperCase() + period.slice(1)}  ${fmtDate(startDate)} – ${fmtDate(endDate)}`);
    row("Generated",   fmtDateTime(new Date()));
    lines.push("");

    row("SESSION COMPLETION");
    row("Field",            "Value");
    row("Sessions Conducted", u.sessionsConducted);
    row("Sessions Planned",   u.sessionsPlanned > 0 ? u.sessionsPlanned : "N/A");
    row("Completion Rate",    u.sessionsPlanned > 0 ? `${u.completionRate}%` : "N/A");
    row("Online Sessions",            u.onlineSessions);
    row("Offline Sessions",           u.offlineSessions);
    row("Group Delegation Sessions",  u.delegationSessions);
    row("Average Attendance",         `${u.avgAttendance}%`);
    row("Students Enrolled",  u.studentsEnrolled);
    lines.push("");

    row("LESSON TYPE BREAKDOWN");
    row("Lesson Type", "Sessions", "% of Total");
    for (const lt of u.lessonBreakdown) {
      row(lt.lessonType, lt.count, `${lt.pct}%`);
    }
    lines.push("", "");
  }

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────
// Performance report — Excel builder
// ─────────────────────────────────────────────────────────────────
function buildPerformanceExcel(
  units: PerformanceUnitData[],
  period: Period,
  startDate: Date,
  endDate: Date,
): Buffer {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const XLSX = require("xlsx");
  const wb   = XLSX.utils.book_new();

  for (const u of units) {
    const sheetName = u.unitCode.slice(0, 31);
    const data: (string | number)[][] = [];

    data.push(["MarkWise Unit Performance Report"]);
    data.push(["Department",  u.department]);
    data.push(["Unit Code",   u.unitCode]);
    data.push(["Unit Name",   u.unitName]);
    data.push(["Lecturer",    u.lecturerName]);
    data.push(["Period",      `${period.charAt(0).toUpperCase() + period.slice(1)}  ${fmtDate(startDate)} – ${fmtDate(endDate)}`]);
    data.push(["Generated",   fmtDateTime(new Date())]);
    data.push([]);

    data.push(["SESSION COMPLETION"]);
    data.push(["Field",             "Value"]);
    data.push(["Sessions Conducted", u.sessionsConducted]);
    data.push(["Sessions Planned",   u.sessionsPlanned > 0 ? u.sessionsPlanned : "N/A"]);
    data.push(["Completion Rate",    u.sessionsPlanned > 0 ? `${u.completionRate}%` : "N/A"]);
    data.push(["Online Sessions",           u.onlineSessions]);
    data.push(["Offline Sessions",          u.offlineSessions]);
    data.push(["Group Delegation Sessions", u.delegationSessions]);
    data.push(["Average Attendance",        `${u.avgAttendance}%`]);
    data.push(["Students Enrolled",  u.studentsEnrolled]);
    data.push([]);

    data.push(["LESSON TYPE BREAKDOWN"]);
    data.push(["Lesson Type", "Sessions", "% of Total"]);
    for (const lt of u.lessonBreakdown) {
      data.push([lt.lessonType, lt.count, `${lt.pct}%`]);
    }

    const ws = XLSX.utils.aoa_to_sheet(data);
    // Bold first 7 rows (report meta)
    for (let r = 0; r < 7; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c: 0 })];
      if (cell) cell.s = { font: { bold: true } };
    }
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

// ─────────────────────────────────────────────────────────────────
// PDF builder  (pdfkit — already a dependency)
// ─────────────────────────────────────────────────────────────────
async function buildPdf(units: UnitReportData[], period: Period, startDate: Date, endDate: Date): Promise<Buffer> {
  const PDFDocument = (await import("pdfkit")).default;

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ margin: 50, size: "A4", autoFirstPage: false });
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end",  () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const W         = 595 - 100; // usable width (A4 595pt, 50pt each side)
    const FONT_BOLD = "Helvetica-Bold";
    const FONT      = "Helvetica";

    // Track total pages for "Page X of Y" — we add it as a postprocess via range
    const pageRefs: number[] = [];

    function addPageNum(landscape?: boolean) {
      const pageNum = pageRefs.length;
      if (landscape) {
        doc.fontSize(8).font(FONT).fillColor("#666666")
          .text(`Page ${pageNum}`, 0, 565, { align: "center", width: 841 });
      } else {
        doc.fontSize(8).font(FONT).fillColor("#666666")
          .text(`Page ${pageNum}`, 0, 780, { align: "center", width: 595 });
      }
      doc.fillColor("#000000");
    }

    // ── Helper: draw a simple text table row with optional background ──
    function tableRow(
      cols: string[],
      colWidths: number[],
      x: number,
      y: number,
      bgColor?: string,
      bold?: boolean,
    ): number {
      const rowH = 16;
      if (bgColor) {
        doc.save().rect(x, y, colWidths.reduce((a, b) => a + b, 0), rowH).fill(bgColor).restore();
      }
      doc.fontSize(8).font(bold ? FONT_BOLD : FONT).fillColor("#000000");
      let cx = x;
      for (let i = 0; i < cols.length; i++) {
        doc.text(cols[i], cx + 2, y + 3, { width: colWidths[i] - 4, lineBreak: false, ellipsis: true });
        cx += colWidths[i];
      }
      return rowH;
    }

    // ── Helper: ensure enough vertical space remains, else new page ──
    function ensureSpace(needed: number) {
      if (doc.y + needed > 780) {
        addPageNum();
        doc.addPage();
        pageRefs.push(1);
      }
    }

    // ─────────────────────────────────────────
    // RENDER EACH UNIT
    // ─────────────────────────────────────────
    for (const u of units) {
      doc.addPage();
      pageRefs.push(1);

      let y = 50;

      // ── BLOCK 1: HEADER ──────────────────────────────────────
      doc.fontSize(14).font(FONT_BOLD).fillColor("#1e3a8a")
        .text("MarkWise — Attendance Report", 50, y, { width: W });
      y += 20;
      doc.fontSize(11).font(FONT_BOLD).fillColor("#1e3a8a")
        .text(u.department, 50, y, { width: W });
      y += 18;

      doc.fontSize(9).font(FONT).fillColor("#000000");
      const labelW = 75;
      const lines = [
        ["Unit:",      `${u.unitCode}  —  ${u.unitName}`],
        ["Lecturer:",  u.lecturerName],
        ["Period:",    `${period.charAt(0).toUpperCase() + period.slice(1)}   ${fmtDate(startDate)} – ${fmtDate(endDate)}`],
        ["Generated:", fmtDateTime(new Date())],
      ];
      for (const [lbl, val] of lines) {
        doc.font(FONT_BOLD).text(lbl, 50, y, { width: labelW, continued: false });
        doc.font(FONT).text(val, 50 + labelW, y, { width: W - labelW });
        y += 14;
      }
      y += 6;

      // ── BLOCK 2: SUMMARY ─────────────────────────────────────
      doc.moveTo(50, y).lineTo(545, y).stroke("#1e3a8a");
      y += 8;
      doc.fontSize(10).font(FONT_BOLD).text("SUMMARY", 50, y);
      y += 14;
      doc.fontSize(9).font(FONT);
      const sumLines = [
        [`Total enrolled:`,        `${u.summary.totalEnrolled}`],
        [`Sessions held:`,         `${u.summary.totalSessions}`],
        [`Avg attendance:`,        `${u.summary.avgAttendance}%  (${u.summary.trend} from previous period)`],
        [`Below 75% (exam risk):`, `${u.summary.belowThreshold75}`],
        [`Below 60% (warning):`,   `${u.summary.belowThreshold60}`],
      ];
      for (const [lbl, val] of sumLines) {
        doc.font(FONT_BOLD).text(lbl, 50, y, { width: 160, continued: false });
        doc.font(FONT).text(val, 210, y, { width: W - 160 });
        y += 13;
      }
      y += 8;

      // ── BLOCK 3: PER-STUDENT TABLE ────────────────────────────
      doc.moveTo(50, y).lineTo(545, y).stroke("#1e3a8a");
      y += 8;
      doc.fontSize(10).font(FONT_BOLD).text("PER-STUDENT BREAKDOWN", 50, y);
      y += 14;

      const colW3 = [75, 155, 75, 40, 60];
      const hdr3  = ["Adm No.", "Name", "Attended", "%", "Status"];

      ensureSpace(20);
      y = doc.y;
      tableRow(hdr3, colW3, 50, y, "#1e3a8a", true);
      doc.fillColor("#ffffff");
      doc.text("", 50, y, { width: W }); // reset fill
      doc.fillColor("#000000");
      y += 17;

      for (const s of u.students) {
        ensureSpace(18);
        y = doc.y;
        const bg = STATUS_COLORS[s.status];
        tableRow(
          [s.admissionNumber, s.name, String(s.attended), `${s.rate}%`, s.status],
          colW3, 50, y, bg,
        );
        y += 17;
        doc.moveTo(50, y - 1).lineTo(545, y - 1).stroke("#e5e7eb");
      }

      y += 8;

      // ── BLOCK 4: ATTENDANCE MATRIX (landscape pages, one per session batch) ──
      // Close the current portrait page, then render the matrix on A4-landscape pages.
      addPageNum();

      {
        const LX         = 50;
        const LEAD_W     = [85, 115];    // Adm No., Name
        const TRAIL_W    = [60, 45]; // Sessions Attended, Avg %
        const LEAD_TOT   = LEAD_W[0] + LEAD_W[1];                 // 200
        const TRAIL_TOT  = TRAIL_W[0] + TRAIL_W[1];               // 105
        const SESS_W     = 18;
        const ROW_H      = 16;
        const LPAGE_W    = 741;  // A4 landscape usable width: 841 − 50 − 50
        const LPAGE_YMAX = 480;  // reserve ~115 pt for footer + page number

        // Max sessions per horizontal batch (trailing cols always included)
        const maxSessPerBatch = Math.floor((LPAGE_W - LEAD_TOT - TRAIL_TOT) / SESS_W); // ≈21

        // Split sessions into horizontal batches
        const batches: SessionRow[][] = [];
        for (let i = 0; i < u.sessions.length; i += maxSessPerBatch) {
          batches.push(u.sessions.slice(i, Math.min(i + maxSessPerBatch, u.sessions.length)));
        }
        if (batches.length === 0) batches.push([]); // always render at least one matrix page

        for (let bi = 0; bi < batches.length; bi++) {
          const batch       = batches[bi];
          const isLastBatch = bi === batches.length - 1;
          const batchSessW  = batch.length * SESS_W;
          const batchTotW   = LEAD_TOT + batchSessW + TRAIL_TOT;

          doc.addPage({ size: "A4", layout: "landscape" });
          pageRefs.push(1);
          let ly = 50;

          // Title
          doc.fontSize(10).font(FONT_BOLD).fillColor("#1e3a8a")
            .text("ATTENDANCE MATRIX", LX, ly);
          if (batches.length > 1) {
            doc.fontSize(8).font(FONT).fillColor("#6b7280")
              .text(
                `  — Lectures ${batch[0]?.index ?? 1}–${batch[batch.length - 1]?.index ?? 0} of ${u.sessions.length}`,
                LX + 175, ly + 1, { lineBreak: false },
              );
          }
          ly += 20;

          // ── draw matrix header row ──
          const drawHdr = (hy: number) => {
            doc.save().rect(LX, hy, batchTotW, ROW_H).fill("#1e3a8a").restore();
            doc.fontSize(7).font(FONT_BOLD).fillColor("#ffffff");
            let hx = LX;
            doc.text("Adm No.", hx + 2, hy + 4, { width: LEAD_W[0] - 4, lineBreak: false, ellipsis: true });
            hx += LEAD_W[0];
            doc.text("Name",    hx + 2, hy + 4, { width: LEAD_W[1] - 4, lineBreak: false, ellipsis: true });
            hx += LEAD_W[1];
            for (const s of batch) {
              doc.text(`L${s.index}`, hx, hy + 4, { width: SESS_W, align: "center", lineBreak: false });
              hx += SESS_W;
            }
            doc.text("Attended", hx + 2, hy + 4, { width: TRAIL_W[0] - 4, lineBreak: false });
            hx += TRAIL_W[0];
            doc.text("Avg %",    hx + 2, hy + 4, { width: TRAIL_W[1] - 4, lineBreak: false });
            doc.fillColor("#000000");
          };

          drawHdr(ly);
          ly += ROW_H + 1;

          // ── data rows ──
          for (const stu of u.students) {
            // Vertical overflow → new landscape page with repeated header
            if (ly + ROW_H > LPAGE_YMAX) {
              addPageNum(true);
              doc.addPage({ size: "A4", layout: "landscape" });
              pageRefs.push(1);
              ly = 50;
              drawHdr(ly);
              ly += ROW_H + 1;
            }

            const bg = STATUS_COLORS[stu.status];
            let rx = LX;

            // Lead columns (Adm No., Name) — status-colour background
            doc.save().rect(LX, ly, LEAD_TOT, ROW_H).fill(bg).restore();
            doc.fontSize(7).font(FONT).fillColor("#000000");
            doc.text(stu.admissionNumber, rx + 2, ly + 4, { width: LEAD_W[0] - 4, lineBreak: false, ellipsis: true });
            rx += LEAD_W[0];
            doc.text(stu.name,            rx + 2, ly + 4, { width: LEAD_W[1] - 4, lineBreak: false, ellipsis: true });
            rx += LEAD_W[1];

            // Per-session P / A cells  (green = present, red = absent)
            for (const sess of batch) {
              const present = u.presenceMap.has(`${stu.studentId}__${sess.key}`);
              doc.save().rect(rx, ly, SESS_W, ROW_H)
                .fill(present ? "#D1FAE5" : "#FEE2E2").restore();
              doc.fontSize(7).font(FONT_BOLD)
                .fillColor(present ? "#065f46" : "#991b1b")
                .text(present ? "P" : "A", rx, ly + 4, { width: SESS_W, align: "center", lineBreak: false });
              rx += SESS_W;
            }

            // Trailing summary columns — status-colour background
            doc.save().rect(rx, ly, TRAIL_TOT, ROW_H).fill(bg).restore();
            doc.fontSize(7).font(FONT).fillColor("#000000");
            doc.text(String(stu.attended),      rx + 2, ly + 4, { width: TRAIL_W[0] - 4, lineBreak: false });
            rx += TRAIL_W[0];
            doc.text(`${stu.rate}%`,             rx + 2, ly + 4, { width: TRAIL_W[1] - 4, lineBreak: false });

            ly += ROW_H;
            doc.moveTo(LX, ly).lineTo(LX + batchTotW, ly).stroke("#e5e7eb");
            ly += 1;
          }

          // ── BLOCK 5: FOOTER — rendered once on the last batch page ──────
          if (isLastBatch) {
            ly += 10;
            doc.moveTo(LX, ly).lineTo(LX + LPAGE_W, ly).stroke("#1e3a8a");
            ly += 8;
            doc.fontSize(8).font(FONT).fillColor("#374151")
              .text("NOTE: Minimum 75% attendance required to sit exams.", LX, ly);
            ly += 12;
            doc.text("Lecturer signature: _________________________   Date: ____________", LX, ly);
            doc.fillColor("#000000");
          }

          addPageNum(true);
        }
      }
    }

    doc.end();
  });
}

// ─────────────────────────────────────────────────────────────────
// CSV builder
// ─────────────────────────────────────────────────────────────────
function buildCsv(units: UnitReportData[], period: Period, startDate: Date, endDate: Date): string {
  const lines: string[] = [];
  const esc  = (v: string | number | null | undefined) =>
    `"${String(v ?? "").replace(/"/g, '""')}"`;
  const row  = (...cells: (string | number | null | undefined)[]) =>
    lines.push(cells.map(esc).join(","));

  for (const u of units) {
    // Header block
    row("MarkWise Attendance Report");
    row("Department", u.department);
    row("Unit Code", u.unitCode);
    row("Unit Name", u.unitName);
    row("Lecturer", u.lecturerName);
    row("Period", `${period.charAt(0).toUpperCase() + period.slice(1)}  ${fmtDate(startDate)} – ${fmtDate(endDate)}`);
    row("Generated", fmtDateTime(new Date()));
    lines.push("");

    // Summary
    row("SUMMARY");
    row("Total Enrolled",        u.summary.totalEnrolled);
    row("Sessions Held",         u.summary.totalSessions);
    row("Avg Attendance (%)",    u.summary.avgAttendance);
    row("Trend",                 u.summary.trend);
    row("Below 75% (exam risk)", u.summary.belowThreshold75);
    row("Below 60% (warning)",   u.summary.belowThreshold60);
    lines.push("");

    // Attendance matrix
    row("ATTENDANCE MATRIX");
    const matrixHdr: (string | number)[] = ["Adm No.", "Name"];
    for (const sess of u.sessions) matrixHdr.push(`LEC ${sess.index}`);
    matrixHdr.push("Sessions Attended", "Attendance %");
    row(...matrixHdr);
    for (const stu of u.students) {
      const cells: (string | number)[] = [stu.admissionNumber, stu.name];
      for (const sess of u.sessions) {
        const present = u.presenceMap.has(`${stu.studentId}__${sess.key}`);
        cells.push(present ? "P" : "A");
      }
      cells.push(stu.attended, `${stu.rate}%`);
      row(...cells);
    }
    lines.push("", "");
  }

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────
// Excel builder
// ─────────────────────────────────────────────────────────────────
function buildExcel(units: UnitReportData[], period: Period, startDate: Date, endDate: Date): Buffer {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const XLSX = require("xlsx");
  const wb   = XLSX.utils.book_new();

  for (const u of units) {
    const sheetName = u.unitCode.slice(0, 31);
    const data: (string | number)[][] = [];

    // Header rows
    data.push(["MarkWise Attendance Report"]);
    data.push(["Department", u.department]);
    data.push(["Unit",       `${u.unitCode} — ${u.unitName}`]);
    data.push(["Lecturer",   u.lecturerName]);
    data.push(["Period",     `${period.charAt(0).toUpperCase() + period.slice(1)}  ${fmtDate(startDate)} – ${fmtDate(endDate)}`]);
    data.push(["Generated",  fmtDateTime(new Date())]);
    data.push([]);

    // Summary
    data.push(["SUMMARY"]);
    data.push(["Total Enrolled",        u.summary.totalEnrolled]);
    data.push(["Sessions Held",         u.summary.totalSessions]);
    data.push(["Avg Attendance (%)",    u.summary.avgAttendance]);
    data.push(["Trend",                 u.summary.trend]);
    data.push(["Below 75% (exam risk)", u.summary.belowThreshold75]);
    data.push(["Below 60% (warning)",   u.summary.belowThreshold60]);
    data.push([]);

    // Attendance matrix
    const matrixStart = data.length;
    const matrixHdrExcel: (string | number)[] = ["Adm No.", "Name"];
    for (const sess of u.sessions) matrixHdrExcel.push(`LEC ${sess.index}`);
    matrixHdrExcel.push("Sessions Attended", "Attendance %");
    data.push(matrixHdrExcel);
    for (const stu of u.students) {
      const cells: (string | number)[] = [stu.admissionNumber, stu.name];
      for (const sess of u.sessions) {
        const present = u.presenceMap.has(`${stu.studentId}__${sess.key}`);
        cells.push(present ? "P" : "A");
      }
      cells.push(stu.attended, stu.rate);
      data.push(cells);
    }

    const ws = XLSX.utils.aoa_to_sheet(data);

    // Bold header rows (report metadata rows 0–5)
    for (let r = 0; r < 6; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c: 0 })];
      if (cell) cell.s = { font: { bold: true } };
    }
    // Bold matrix header row
    for (let c = 0; c < matrixHdrExcel.length; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r: matrixStart, c })];
      if (cell) cell.s = { font: { bold: true } };
    }

    // Freeze pane at matrix header
    ws["!freeze"] = { xSplit: 2, ySplit: matrixStart + 1 };

    // Status column is not present in the matrix; no per-row colour needed

    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

// ─────────────────────────────────────────────────────────────────
// POST handler
// ─────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!token) return apiErr("Unauthorized", 401);

  let lecturerId: string;
  try {
    ({ lecturerId } = verifyLecturerAccessToken(token));
  } catch {
    return apiErr("Unauthorized", 401);
  }

  // ── Parse body ────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return apiErr("Invalid JSON body.", 400);
  }

  const { period, types, format, department, unitCodes, startDate, endDate } = body ?? {};

  // ── Validate ──────────────────────────────────────────────────
  if (!period || !VALID_PERIODS.includes(period as Period))
    return apiErr(`period must be one of: ${VALID_PERIODS.join(", ")}`, 400);

  if (!Array.isArray(types) || types.length === 0)
    return apiErr("types is required and must be a non-empty array", 400);
  for (const t of types as unknown[]) {
    if (!VALID_TYPES.includes(t as ReportType))
      return apiErr(`Invalid report type: ${t}`, 400);
  }

  if (!format || !VALID_FORMATS.includes(format as Format))
    return apiErr(`format must be one of: ${VALID_FORMATS.join(", ")}`, 400);

  if (!unitCodes || !Array.isArray(unitCodes) || unitCodes.length === 0)
    return apiErr("No valid unit codes provided", 400);

  if (!startDate || typeof startDate !== "string") return apiErr("startDate is required (YYYY-MM-DD)", 400);
  if (!endDate   || typeof endDate   !== "string") return apiErr("endDate is required (YYYY-MM-DD)", 400);

  const parsedStart = parseCalendarDate(startDate);
  const parsedEnd   = parseCalendarDate(endDate);
  if (!parsedStart) return apiErr("startDate is not a valid date (use YYYY-MM-DD)", 400);
  if (!parsedEnd)   return apiErr("endDate is not a valid date (use YYYY-MM-DD)", 400);
  parsedEnd.setUTCHours(23, 59, 59, 999);

  const validPeriod  = period as Period;
  const validTypes   = types  as ReportType[];
  const validFormat  = format as Format;
  const departmentLabel = typeof department === "string" ? department : "";
  const normalizedCodes = (unitCodes as string[]).map((c) => normalizeUnitCode(c)).filter(Boolean);

  if (normalizedCodes.length === 0)
    return apiErr("No valid unit codes provided", 400);

  try {
    // ── Lecturer identity ─────────────────────────────────────
    const lecturer = await prisma.lecturer.findUnique({
      where:  { id: lecturerId },
      select: { fullName: true, institution: { select: { name: true } } },
    });
    const lecturerName    = lecturer?.fullName  ?? lecturerId;
    const institutionName = lecturer?.institution?.name ?? "MarkWise";

    // ── Dispatch by report type ───────────────────────────────
    const reportType = validTypes[0] as ReportType;

    const NOT_IMPLEMENTED_MESSAGES: Partial<Record<ReportType, string>> = {
      assignments:   "Assignment Summary reports are coming soon.",
      students:      "Student Progress reports are coming soon.",
      sessions:      "Session Log reports are coming soon.",
      comprehensive: "Comprehensive reports are coming soon.",
    };
    if (NOT_IMPLEMENTED_MESSAGES[reportType]) {
      return NextResponse.json(
        { message: NOT_IMPLEMENTED_MESSAGES[reportType] },
        { status: 501, headers: corsHeaders },
      );
    }

    // ── Performance report path ───────────────────────────────
    if (reportType === "performance") {
      const perfDataList = await Promise.all(
        normalizedCodes.map((uc) =>
          gatherPerformanceData(uc, lecturerId, lecturerName, institutionName, departmentLabel, parsedStart, parsedEnd),
        ),
      );

      const ext      = validFormat === "pdf" ? "pdf" : validFormat === "csv" ? "csv" : "xlsx";
      const filename = `MarkWise_Performance_${validPeriod}_${Date.now()}.${ext}`;
      let fileBuffer: Buffer;

      try {
        if (validFormat === "pdf") {
          fileBuffer = await buildPerformancePdf(perfDataList, validPeriod, parsedStart, parsedEnd);
        } else if (validFormat === "csv") {
          fileBuffer = Buffer.from(buildPerformanceCsv(perfDataList, validPeriod, parsedStart, parsedEnd), "utf-8");
        } else {
          fileBuffer = buildPerformanceExcel(perfDataList, validPeriod, parsedStart, parsedEnd);
        }
      } catch (buildErr) {
        console.error("[reports/generate] performance build error:", buildErr);
        return apiErr(`Report generation failed: ${buildErr instanceof Error ? buildErr.message : String(buildErr)}`, 500);
      }

      if (validFormat === "pdf") {
        await prisma.lecturerReport.create({
          data: {
            lecturerId,
            period:        validPeriod,
            types:         validTypes,
            format:        validFormat,
            unitCodes:     normalizedCodes,
            startDate:     parsedStart,
            endDate:       parsedEnd,
            fileUrl:       "",
            fileSizeBytes: fileBuffer.length,
          },
        }).catch(() => {});

        return NextResponse.json(
          { fileUrl: null, base64: fileBuffer.toString("base64"), mimeType: MIME_MAP.pdf, filename },
          { status: 200, headers: corsHeaders },
        );
      }

      const blobName = `reports/${lecturerId.slice(0, 8)}_${Date.now()}.${ext}`;
      let fileUrl: string;
      try {
        const blob = await put(blobName, fileBuffer, { access: "public", contentType: MIME_MAP[validFormat] });
        fileUrl = blob.url;
      } catch {
        return NextResponse.json(
          { fileUrl: null, base64: fileBuffer.toString("base64"), mimeType: MIME_MAP[validFormat], filename },
          { status: 200, headers: corsHeaders },
        );
      }

      const report = await prisma.lecturerReport.create({
        data: {
          lecturerId,
          period:        validPeriod,
          types:         validTypes,
          format:        validFormat,
          unitCodes:     normalizedCodes,
          startDate:     parsedStart,
          endDate:       parsedEnd,
          fileUrl,
          fileSizeBytes: fileBuffer.length,
        },
      });
      return NextResponse.json({ fileUrl: report.fileUrl }, { status: 200, headers: corsHeaders });
    }

    // ── Attendance report path (default) ──────────────────────
    // ── Gather per-unit data ──────────────────────────────────
    const unitDataList = await Promise.all(
      normalizedCodes.map((uc) =>
        gatherUnitReportData(uc, lecturerId, lecturerName, institutionName, departmentLabel, parsedStart, parsedEnd),
      ),
    );

    // ── Build file buffer ─────────────────────────────────────
    const ext      = validFormat === "pdf" ? "pdf" : validFormat === "csv" ? "csv" : "xlsx";
    const filename = `MarkWise_Attendance_${validPeriod}_${Date.now()}.${ext}`;
    let fileBuffer: Buffer;

    try {
      if (validFormat === "pdf") {
        fileBuffer = await buildPdf(unitDataList, validPeriod, parsedStart, parsedEnd);
      } else if (validFormat === "csv") {
        fileBuffer = Buffer.from(buildCsv(unitDataList, validPeriod, parsedStart, parsedEnd), "utf-8");
      } else {
        fileBuffer = buildExcel(unitDataList, validPeriod, parsedStart, parsedEnd);
      }
    } catch (buildErr) {
      console.error("[reports/generate] file build error:", buildErr);
      return apiErr(`Report generation failed: ${buildErr instanceof Error ? buildErr.message : String(buildErr)}`, 500);
    }

    // ── PDF: return base64 in-body (no filesystem / no Blob needed) ──
    if (validFormat === "pdf") {
      // Persist without a fileUrl (base64 is returned inline)
      await prisma.lecturerReport.create({
        data: {
          lecturerId,
          period:        validPeriod,
          types:         validTypes,
          format:        validFormat,
          unitCodes:     normalizedCodes,
          startDate:     parsedStart,
          endDate:       parsedEnd,
          fileUrl:       "",
          fileSizeBytes: fileBuffer.length,
        },
      }).catch(() => { /* non-fatal: log record is best-effort */ });

      return NextResponse.json(
        {
          fileUrl:  null,
          base64:   fileBuffer.toString("base64"),
          mimeType: MIME_MAP.pdf,
          filename,
        },
        { status: 200, headers: corsHeaders },
      );
    }

    // ── CSV / Excel: upload to Vercel Blob and return URL ─────
    const blobName = `reports/${lecturerId.slice(0, 8)}_${Date.now()}.${ext}`;

    let fileUrl: string;
    try {
      const blob = await put(blobName, fileBuffer, {
        access:      "public",
        contentType: MIME_MAP[validFormat],
      });
      fileUrl = blob.url;
    } catch (uploadErr) {
      console.error("[reports/generate] blob upload error:", uploadErr);
      // Fall back to base64 so the caller always gets something usable
      return NextResponse.json(
        {
          fileUrl:  null,
          base64:   fileBuffer.toString("base64"),
          mimeType: MIME_MAP[validFormat],
          filename,
        },
        { status: 200, headers: corsHeaders },
      );
    }

    // ── Persist report record ─────────────────────────────────
    const report = await prisma.lecturerReport.create({
      data: {
        lecturerId,
        period:        validPeriod,
        types:         validTypes,
        format:        validFormat,
        unitCodes:     normalizedCodes,
        startDate:     parsedStart,
        endDate:       parsedEnd,
        fileUrl,
        fileSizeBytes: fileBuffer.length,
      },
    });

    return NextResponse.json(
      { fileUrl: report.fileUrl },
      { status: 200, headers: corsHeaders },
    );
  } catch (fatal) {
    console.error("[reports/generate] fatal error:", fatal);
    return apiErr(`Report generation failed: ${fatal instanceof Error ? fatal.message : "unexpected error"}`, 500);
  }
}
