/**
 * POST /api/lecturer/analytics/batch
 *
 * Returns per-unit attendance analytics + assignment/material counts for a
 * list of unit codes in a single call.
 *
 * Auth: Bearer lecturer JWT
 *
 * Request body:
 *   { "unitCodes": ["SCH 2170", "CHE 3101"] }
 *
 * Response — plain object keyed by the EXACT unit code string as supplied in
 * the request (same case, same spaces):
 *   {
 *     "SCH 2170": {
 *       "enrolledStudents": 45,
 *       "conductedSessions": 12,
 *       "totalPresent": 432,
 *       "avgAttended": 36,
 *       "attendancePercent": 80,
 *       "atRiskCount": 3,
 *       "assignments": 3,
 *       "materials": 7
 *     }
 *   }
 */

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { verifyLecturerAccessToken } from "@/lib/lecturerAuthJwt";
import { normalizeUnitCode } from "@/lib/unitCode";

export const runtime = "nodejs";

const FIVE_MIN_MS = 5 * 60 * 1000;

/** Strip all non-alphanumeric chars, uppercase — used to match across DB representations */
const norm = (c: string) => c.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Count how many times `dayName` (e.g. "Monday") falls within [start, end] inclusive.
 * Used to expand recurring timetable entries into a planned-session count.
 */
function countDayOccurrences(dayName: string, start: Date, end: Date): number {
  const DAY_INDEX: Record<string, number> = {
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
    thursday: 4, friday: 5, saturday: 6,
  };
  const idx = DAY_INDEX[dayName.toLowerCase()];
  if (idx === undefined) return 0;
  let count = 0;
  const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const endMs = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  while (d.getTime() <= endMs) {
    if (d.getUTCDay() === idx) count++;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return count;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function POST(req: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const token = (req.headers.get("authorization") ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!token) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: corsHeaders },
    );
  }
  let lecturerId: string;
  try {
    ({ lecturerId } = verifyLecturerAccessToken(token));
  } catch {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: corsHeaders },
    );
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: { unitCodes?: unknown; startDate?: unknown; endDate?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400, headers: corsHeaders },
    );
  }

  const { unitCodes, startDate: startDateRaw, endDate: endDateRaw } = body;
  if (!Array.isArray(unitCodes) || unitCodes.length === 0) {
    return NextResponse.json(
      { error: "unitCodes is required and must be a non-empty array" },
      { status: 400, headers: corsHeaders },
    );
  }

  // Parse optional date range — used for plannedSessions calculation.
  let parsedStart: Date | null = null;
  let parsedEnd:   Date | null = null;
  if (typeof startDateRaw === "string" && typeof endDateRaw === "string") {
    const s = new Date(startDateRaw + "T00:00:00.000Z");
    const e = new Date(endDateRaw   + "T23:59:59.999Z");
    if (!isNaN(s.getTime()) && !isNaN(e.getTime())) {
      parsedStart = s;
      parsedEnd   = e;
    }
  }

  // Build norm → first-seen request key map (preserve original string as response key)
  const normToRequestKey = new Map<string, string>();
  const normCodes: string[] = [];
  for (const c of unitCodes) {
    if (typeof c !== "string") continue;
    const n = norm(c);
    if (!normToRequestKey.has(n)) {
      normToRequestKey.set(n, c);
      normCodes.push(n);
    }
  }
  if (normCodes.length === 0) {
    return NextResponse.json(
      { error: "unitCodes must contain valid unit code strings" },
      { status: 400, headers: corsHeaders },
    );
  }

  // ── Lecturer institutionId (needed for enrollment query) ─────────────────
  let institutionId: string;
  try {
    const lecturerRecord = await prisma.lecturer.findUnique({
      where: { id: lecturerId },
      select: { institutionId: true },
    });
    if (!lecturerRecord?.institutionId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
    }
    institutionId = lecturerRecord.institutionId;
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: corsHeaders });
  }

  try {
    // ── 1. Resolve units ───────────────────────────────────────────────────
    const units = await prisma.$queryRaw<{ id: string; code: string }[]>(
      Prisma.sql`
        SELECT id, code
        FROM "Unit"
        WHERE UPPER(REPLACE(code, ' ', '')) IN (${Prisma.join(normCodes)})
      `,
    );

    const normToUnit = new Map(units.map((u) => [norm(u.code), u]));
    const unitIds = units.map((u) => u.id);
    const rawUnitCodes = units.map((u) => u.code);
    const normalisedUnitCodes = rawUnitCodes.map(normalizeUnitCode);

    // ── 2. Parallel fetch ─────────────────────────────────────────────────
    const [
      enrollmentCounts,
      onlineSessions,
      offlineSessions,
      delegationSessions,
      offlineRecords,
      timetableEntries,
      assignmentCounts,
      materialCounts,
      perStudentAttendance,
    ] = await Promise.all([
      // Enrolled students from StudentEnrollmentSnapshot
      normCodes.length > 0
        ? prisma.$queryRaw<{ normCode: string; cnt: bigint }[]>(
            Prisma.sql`
              SELECT UPPER(REPLACE(uc, ' ', '')) AS "normCode", COUNT(*) AS cnt
              FROM   "StudentEnrollmentSnapshot" es
              JOIN   "Student" s ON s.id = es."studentId"
              CROSS JOIN LATERAL unnest(es."unitCodes") AS uc
              WHERE  s."institutionId" = ${institutionId}
                AND  UPPER(REPLACE(uc, ' ', '')) IN (${Prisma.join(normCodes)})
              GROUP BY UPPER(REPLACE(uc, ' ', ''))
            `
          )
        : Promise.resolve([] as { normCode: string; cnt: bigint }[]),

      // Online ended sessions
      normalisedUnitCodes.length > 0
        ? prisma.onlineAttendanceSession.findMany({
            where: { lecturerId, unitCode: { in: normalisedUnitCodes }, endedAt: { not: null } },
            select: { unitCode: true, _count: { select: { records: true } } },
          })
        : Promise.resolve([] as { unitCode: string; _count: { records: number } }[]),

      // Offline sessions — exclude ONLINE room rows
      normCodes.length > 0
        ? prisma.$queryRaw<{ unitCode: string; sessionStart: Date }[]>(
            Prisma.sql`
              SELECT UPPER(REPLACE("unitCode", ' ', '')) AS "unitCode", "sessionStart"
              FROM   "ConductedSession"
              WHERE  "lecturerId" = ${lecturerId}
                AND  UPPER(REPLACE("unitCode", ' ', '')) IN (${Prisma.join(normCodes)})
                AND  UPPER("lectureRoom") != 'ONLINE'
            `
          )
        : Promise.resolve([] as { unitCode: string; sessionStart: Date }[]),

      // Delegation / GD group sessions
      rawUnitCodes.length > 0
        ? prisma.delegation.findMany({
            where: { createdBy: lecturerId, unitCode: { in: rawUnitCodes }, used: true },
            select: { unitCode: true, validFrom: true },
          })
        : Promise.resolve([] as { unitCode: string; validFrom: Date | bigint }[]),

      // Offline attendance records — DISTINCT (studentId, sessionId)
      normCodes.length > 0
        ? prisma.$queryRaw<{ unitCode: string }[]>(
            Prisma.sql`
              SELECT DISTINCT UPPER(REPLACE(oar."unitCode", ' ', '')) AS "unitCode",
                     oar."studentId", cs."id" AS "sessionId"
              FROM   "OfflineAttendanceRecord" oar
              INNER JOIN "ConductedSession" cs
                ON  UPPER(REPLACE(cs."unitCode", ' ', '')) = UPPER(REPLACE(oar."unitCode", ' ', ''))
                AND cs."sessionStart" = oar."sessionStart"
                AND cs."lecturerId"   = ${lecturerId}
                AND UPPER(cs."lectureRoom") != 'ONLINE'
              WHERE  UPPER(REPLACE(oar."unitCode", ' ', '')) IN (${Prisma.join(normCodes)})
            `,
          )
        : Promise.resolve([] as { unitCode: string }[]),

      // Timetable entries for planned-session calculation
      unitIds.length > 0 && parsedStart
        ? prisma.timetable.findMany({
            where: { lecturerId, unitOffering: { unitId: { in: unitIds } }, timetableStatus: { not: "CANCELLED" } },
            include: { unitOffering: { select: { unitId: true } }, sharedSession: { select: { day: true } } },
          })
        : Promise.resolve([] as any[]),

      // Assignment counts per unitId
      unitIds.length > 0
        ? prisma.assignment.groupBy({
            by: ["unitId"],
            where: { unitId: { in: unitIds } },
            _count: { id: true },
          })
        : Promise.resolve([] as { unitId: string; _count: { id: number } }[]),

      // Material counts per unitId
      unitIds.length > 0
        ? prisma.material.groupBy({
            by: ["unitId"],
            where: { unitId: { in: unitIds } },
            _count: { id: true },
          })
        : Promise.resolve([] as { unitId: string; _count: { id: number } }[]),

      // Per-student per-unit attended session count — for atRiskCount
      normCodes.length > 0
        ? prisma.$queryRaw<{ normCode: string; studentId: string; attended: bigint }[]>(
            Prisma.sql`
              WITH student_sessions AS (
                SELECT
                  UPPER(REPLACE(oas."unitCode", ' ', '')) AS "normCode",
                  oar."studentId",
                  oas."id" AS "sessionKey"
                FROM "OnlineAttendanceRecord" oar
                JOIN "OnlineAttendanceSession" oas ON oas."id" = oar."sessionId"
                  AND oas."lecturerId" = ${lecturerId}
                  AND oas."endedAt" IS NOT NULL
                WHERE UPPER(REPLACE(oas."unitCode", ' ', '')) IN (${Prisma.join(normCodes)})

                UNION ALL

                SELECT DISTINCT
                  UPPER(REPLACE(cs."unitCode", ' ', '')) AS "normCode",
                  oar."studentId",
                  cs."id" AS "sessionKey"
                FROM "OfflineAttendanceRecord" oar
                JOIN "ConductedSession" cs
                  ON  UPPER(REPLACE(cs."unitCode", ' ', '')) = UPPER(REPLACE(oar."unitCode", ' ', ''))
                  AND cs."sessionStart" = oar."sessionStart"
                  AND cs."lecturerId" = ${lecturerId}
                  AND UPPER(cs."lectureRoom") != 'ONLINE'
                WHERE UPPER(REPLACE(oar."unitCode", ' ', '')) IN (${Prisma.join(normCodes)})

                UNION ALL

                SELECT DISTINCT
                  UPPER(REPLACE(d."unitCode", ' ', '')) AS "normCode",
                  oar."studentId",
                  d."id" AS "sessionKey"
                FROM "OfflineAttendanceRecord" oar
                JOIN "Delegation" d ON d."id" = oar."delegationId"
                  AND d."createdBy" = ${lecturerId}
                  AND d."used" = true
                WHERE UPPER(REPLACE(d."unitCode", ' ', '')) IN (${Prisma.join(normCodes)})
                  AND NOT EXISTS (
                    SELECT 1 FROM "ConductedSession" cs2
                    WHERE UPPER(REPLACE(cs2."unitCode", ' ', '')) = UPPER(REPLACE(d."unitCode", ' ', ''))
                      AND cs2."lecturerId" = ${lecturerId}
                      AND UPPER(cs2."lectureRoom") != 'ONLINE'
                      AND ABS(EXTRACT(EPOCH FROM cs2."sessionStart") * 1000 - d."validFrom"::float8) <= 300000
                  )
              )
              SELECT "normCode", "studentId", COUNT(DISTINCT "sessionKey") AS "attended"
              FROM student_sessions
              GROUP BY "normCode", "studentId"
            `
          )
        : Promise.resolve([] as { normCode: string; studentId: string; attended: bigint }[]),
    ]);

    // ── 3. Build lookup maps ───────────────────────────────────────────────
    const enrolledMap = new Map(
      (enrollmentCounts as { normCode: string; cnt: bigint }[]).map((r) => [r.normCode, Number(r.cnt)])
    );
    const assignMap = new Map(assignmentCounts.map((a) => [a.unitId, a._count.id]));
    const matMap = new Map(materialCounts.map((m) => [m.unitId, m._count.id]));

    // Per-student map: normCode → (studentId → attended)
    const perStudentMap = new Map<string, Map<string, number>>();
    for (const row of perStudentAttendance) {
      let m = perStudentMap.get(row.normCode);
      if (!m) { m = new Map(); perStudentMap.set(row.normCode, m); }
      m.set(row.studentId, Number(row.attended));
    }

    // Build offline session-time map (for delegation dedup)
    const offlineTimeMap = new Map<string, number[]>();
    for (const s of offlineSessions) {
      const key = norm(s.unitCode);
      const ms = s.sessionStart.getTime();
      const times = offlineTimeMap.get(key) ?? [];
      times.push(ms);
      offlineTimeMap.set(key, times);
    }

    // ── 4. Accumulate per-unit stats ───────────────────────────────────────
    type UnitStats = { conductedSessions: number; totalPresent: number };
    const statsMap = new Map<string, UnitStats>();
    const stat = (normCode: string): UnitStats => {
      if (!statsMap.has(normCode)) {
        statsMap.set(normCode, { conductedSessions: 0, totalPresent: 0 });
      }
      return statsMap.get(normCode)!;
    };

    for (const s of onlineSessions) {
      const st = stat(norm(s.unitCode));
      st.conductedSessions += 1;
      st.totalPresent += s._count.records;
    }
    for (const s of offlineSessions) {
      stat(norm(s.unitCode)).conductedSessions += 1;
    }
    for (const d of delegationSessions) {
      const normCode = norm(d.unitCode);
      const offlineTimes = offlineTimeMap.get(normCode) ?? [];
      const delegMs = Number(d.validFrom);
      if (!offlineTimes.some((t) => Math.abs(t - delegMs) <= FIVE_MIN_MS)) {
        stat(normCode).conductedSessions += 1;
      }
    }
    for (const r of offlineRecords) {
      const normCode = norm(r.unitCode);
      stat(normCode).totalPresent += 1;
    }

    // Build planned-session map
    const DAY_ENUM_TO_NAME_BATCH: Record<string, string> = {
      MON: "monday", TUE: "tuesday", WED: "wednesday", THU: "thursday",
      FRI: "friday", SAT: "saturday", SUN: "sunday",
    };
    const plannedMap = new Map<string, number>();
    if (parsedStart && parsedEnd) {
      const unitIdToNorm = new Map(units.map((u) => [u.id, norm(u.code)]));
      for (const entry of timetableEntries) {
        const unitId = (entry as any).unitOffering?.unitId;
        const dayEnum = (entry as any).sharedSession?.day;
        const normCode = unitIdToNorm.get(unitId);
        if (!normCode || !dayEnum) continue;
        const dayName = DAY_ENUM_TO_NAME_BATCH[dayEnum] ?? dayEnum.toLowerCase();
        const occurrences = countDayOccurrences(dayName, parsedStart, parsedEnd);
        plannedMap.set(normCode, (plannedMap.get(normCode) ?? 0) + occurrences);
      }
    }

    // ── 5. Build response ──────────────────────────────────────────────────
    const response: Record<string, object> = {};

    for (const normCode of normCodes) {
      const requestKey = normToRequestKey.get(normCode)!;
      const unit = normToUnit.get(normCode);
      const enrolledStudents = enrolledMap.get(normCode) ?? 0;
      const { conductedSessions, totalPresent } = statsMap.get(normCode) ?? {
        conductedSessions: 0,
        totalPresent: 0,
      };
      const avgAttended =
        conductedSessions > 0 ? Math.round(totalPresent / conductedSessions) : 0;
      const attendancePercent =
        enrolledStudents > 0 && conductedSessions > 0
          ? Math.min(
              Math.round((totalPresent / (enrolledStudents * conductedSessions)) * 100),
              100,
            )
          : 0;
      const assignments = unit ? (assignMap.get(unit.id) ?? 0) : 0;
      const materials = unit ? (matMap.get(unit.id) ?? 0) : 0;

      const plannedSessions = parsedStart ? (plannedMap.get(normCode) ?? 0) : null;
      const completionRate =
        plannedSessions !== null && plannedSessions > 0
          ? Math.min(Math.round((conductedSessions / plannedSessions) * 100), 100)
          : null;

      // atRiskCount: enrolled students with rate < 75%
      const atRiskCount = (() => {
        if (conductedSessions === 0) return 0;
        const threshold = 0.75 * conductedSessions;
        const studentMap = perStudentMap.get(normCode) ?? new Map<string, number>();
        let low = 0;
        for (const [, attended] of studentMap) {
          if (attended < threshold) low++;
        }
        const zeroAttendance = Math.max(0, enrolledStudents - studentMap.size);
        return zeroAttendance + low;
      })();

      response[requestKey] = {
        students: enrolledStudents,
        enrolledStudents,
        conductedSessions,
        totalPresent,
        avgAttended,
        attendanceRate: attendancePercent,
        attendancePercent,
        atRiskCount,
        plannedSessions,
        completionRate,
        assignments,
        materials,
      };
    }

    return NextResponse.json(response, { headers: corsHeaders });
  } catch (err: unknown) {
    console.error("[lecturer/analytics/batch] error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: corsHeaders },
    );
  }
}
