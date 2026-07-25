/**
 * GET /api/lecturer/analytics
 *
 * Returns per-unit attendance analytics for the authenticated lecturer.
 *
 * Session sources counted as "conducted":
 *  1. OnlineAttendanceSession  — online QR sessions (lecturerId scoped)
 *  2. ConductedSession         — offline BLE / manual PIN sessions (lecturerId scoped)
 *  3. Delegation               — GD group leader sessions (createdBy = lecturerId, used = true)
 *
 * Present marks counted from:
 *  • OnlineAttendanceRecord  — every record in a session this lecturer ran
 *  • OfflineAttendanceRecord — records with method in the valid present set
 *    ('qr' | 'ble' | 'manual' | 'manual_lecturer' | 'proxy_leader' | 'GD')
 *    for unitCodes assigned to this lecturer
 */
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { verifyLecturerAccessToken } from "@/lib/lecturerAuthJwt";
import { normalizeUnitCode } from "@/lib/unitCode";

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
  const token =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!token) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }
  let lecturerId: string;
  try {
    ({ lecturerId } = verifyLecturerAccessToken(token));
  } catch {
    return NextResponse.json(
      { message: "Unauthorized" },
      { status: 401, headers: corsHeaders },
    );
  }

  try {
    // ── 1. Distinct units assigned to this lecturer ──────────────────────────
    const normalizeCode = (c: string) => c.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

    const timetableUnits = await prisma.timetable.findMany({
      where: { lecturerId },
      include: { unitOffering: { select: { unitId: true } } },
    });
    const unitIds = [...new Set(timetableUnits.map((t) => t.unitOffering?.unitId).filter(Boolean) as string[])];

    if (unitIds.length === 0) {
      return NextResponse.json([], { headers: corsHeaders });
    }

    // ── 2. Unit details ───────────────────────────────────────────────────────
    const units = await prisma.unit.findMany({
      where: { id: { in: unitIds } },
      select: { id: true, code: true, title: true },
    });
    const unitCodes = units.map((u) => u.code);
    // normCodes: no-space uppercase — used for $queryRaw IN() comparisons
    const normCodes = units.map((u) => normalizeCode(u.code));
    // normalisedUnitCodes: "SCH 2170" form — matches OnlineAttendanceSession.unitCode
    const normalisedUnitCodes = units.map((u) => normalizeUnitCode(u.code));

    // ── 3. Lecturer institution + enrolled students (StudentEnrollmentSnapshot) ──
    const lecturerRecord = await prisma.lecturer.findUnique({
      where: { id: lecturerId },
      select: { institutionId: true },
    });
    if (!lecturerRecord?.institutionId) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: corsHeaders });
    }
    const { institutionId } = lecturerRecord;

    const enrollmentRows = await prisma.$queryRaw<{ normCode: string; cnt: bigint }[]>(
      Prisma.sql`
        SELECT UPPER(REPLACE(uc, ' ', '')) AS "normCode", COUNT(*) AS cnt
        FROM   "StudentEnrollmentSnapshot" es
        JOIN   "Student" s ON s.id = es."studentId"
        CROSS JOIN LATERAL unnest(es."unitCodes") AS uc
        WHERE  s."institutionId" = ${institutionId}
          AND  UPPER(REPLACE(uc, ' ', '')) IN (${Prisma.join(normCodes)})
        GROUP BY UPPER(REPLACE(uc, ' ', ''))
      `
    );
    const enrolledMap = new Map(enrollmentRows.map((r) => [r.normCode, Number(r.cnt)]));

    // ── 4. Session counts + attendance totals + assignment/material counts ─────
    const [
      onlineSessions,
      offlineSessions,
      delegationSessions,
      assignmentCounts,
      materialCounts,
      perStudentAttendance,
    ] = await Promise.all([
      // Online sessions (ended only) — stored with normalizeUnitCode() at creation
      prisma.onlineAttendanceSession.findMany({
        where: { lecturerId, unitCode: { in: normalisedUnitCodes }, endedAt: { not: null } },
        select: { unitCode: true, _count: { select: { records: true } } },
      }),

      // Offline sessions — space-tolerant raw query.
      // Exclude lectureRoom = 'ONLINE': already counted via OnlineAttendanceSession.
      prisma.$queryRaw<{ normCode: string; sessionStart: Date }[]>(Prisma.sql`
        SELECT UPPER(REPLACE("unitCode", ' ', '')) AS "normCode",
               "sessionStart"
        FROM   "ConductedSession"
        WHERE  "lecturerId" = ${lecturerId}
          AND  UPPER(REPLACE("unitCode", ' ', '')) IN (${Prisma.join(normCodes)})
          AND  UPPER("lectureRoom") != 'ONLINE'
      `),

      // Delegation sessions (used, created by this lecturer)
      prisma.delegation.findMany({
        where: { createdBy: lecturerId, unitCode: { in: unitCodes }, used: true },
        select: { id: true, unitCode: true, validFrom: true },
      }),

      // Assignment and material counts per unit
      prisma.assignment.groupBy({
        by: ["unitId"],
        where: { unitId: { in: unitIds } },
        _count: { id: true },
      }),
      prisma.material.groupBy({
        by: ["unitId"],
        where: { unitId: { in: unitIds } },
        _count: { id: true },
      }),

      // Per-student per-unit attended session count — used to compute atRiskCount.
      // Combines all three sources with delegation dedup (standalone only via NOT EXISTS).
      prisma.$queryRaw<{ normCode: string; studentId: string; attended: bigint }[]>(
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
      ),
    ]);

    const assignMap = new Map(assignmentCounts.map((a) => [a.unitId, a._count.id]));
    const matMap    = new Map(materialCounts.map((m)   => [m.unitId, m._count.id]));

    // Offline attendance records — DISTINCT (student, session) pair to prevent JOIN
    // inflation: if one OfflineAttendanceRecord matches multiple ConductedSession rows
    // (same sessionStart, different lectureRoom) the un-DISTINCTed JOIN would count
    // that mark more than once.
    const offlineRecords = await prisma.$queryRaw<
      { normCode: string }[]
    >(Prisma.sql`
      SELECT DISTINCT
             UPPER(REPLACE(oar."unitCode", ' ', '')) AS "normCode",
             oar."studentId",
             cs."id" AS "sessionId"
      FROM   "OfflineAttendanceRecord" oar
      INNER JOIN "ConductedSession" cs
        ON  UPPER(REPLACE(cs."unitCode",  ' ', '')) = UPPER(REPLACE(oar."unitCode", ' ', ''))
        AND cs."sessionStart" = oar."sessionStart"
        AND cs."lecturerId"   = ${lecturerId}
        AND UPPER(cs."lectureRoom") != 'ONLINE'
      WHERE  UPPER(REPLACE(oar."unitCode", ' ', '')) IN (${Prisma.join(normCodes)})
    `);

    // ── 5. Aggregate per normCode ──────────────────────────────────────────────
    const FIVE_MIN_MS = 5 * 60 * 1000;

    const offlineSessionTimes = new Map<string, number[]>();
    for (const s of offlineSessions) {
      const times = offlineSessionTimes.get(s.normCode) ?? [];
      times.push(s.sessionStart.getTime());
      offlineSessionTimes.set(s.normCode, times);
    }

    type UnitStats = { conductedSessions: number; totalAttendances: number };
    const sessionStats = new Map<string, UnitStats>();
    const stat = (code: string): UnitStats => {
      const key = normalizeCode(code);
      if (!sessionStats.has(key)) {
        sessionStats.set(key, { conductedSessions: 0, totalAttendances: 0 });
      }
      return sessionStats.get(key)!;
    };

    for (const s of onlineSessions) {
      const st = stat(s.unitCode);
      st.conductedSessions += 1;
      st.totalAttendances += s._count.records;
    }
    for (const s of offlineSessions) {
      stat(s.normCode).conductedSessions += 1;
    }
    const standaloneDelMap = new Map<string, string>(); // delegationId → normCode
    for (const d of delegationSessions) {
      const key = normalizeCode(d.unitCode);
      const offlineTimes = offlineSessionTimes.get(key) ?? [];
      const delegMs = Number(d.validFrom);
      const overlaps = offlineTimes.some((t) => Math.abs(t - delegMs) <= FIVE_MIN_MS);
      if (!overlaps) {
        stat(d.unitCode).conductedSessions += 1;
        standaloneDelMap.set(d.id, key);
      }
    }
    for (const r of offlineRecords) {
      stat(r.normCode).totalAttendances += 1;
    }

    const standaloneDelIds = [...standaloneDelMap.keys()];
    if (standaloneDelIds.length > 0) {
      const delegationAttendanceRecords = await prisma.offlineAttendanceRecord.findMany({
        where: { delegationId: { in: standaloneDelIds } },
        select: { delegationId: true },
      });
      for (const r of delegationAttendanceRecords) {
        const normCode = standaloneDelMap.get(r.delegationId!);
        if (normCode) stat(normCode).totalAttendances += 1;
      }
    }

    // ── 6. Build per-student map for atRiskCount ───────────────────────────────
    // normCode → (studentId → distinctSessionsAttended)
    const perStudentMap = new Map<string, Map<string, number>>();
    for (const row of perStudentAttendance) {
      let m = perStudentMap.get(row.normCode);
      if (!m) { m = new Map(); perStudentMap.set(row.normCode, m); }
      m.set(row.studentId, Number(row.attended));
    }

    // ── 7. Build response ──────────────────────────────────────────────────────
    const result = units
      .map((unit) => {
        const nc = normalizeCode(unit.code);
        const enrolledStudents = enrolledMap.get(nc) ?? 0;
        const { conductedSessions, totalAttendances } =
          sessionStats.get(nc) ?? { conductedSessions: 0, totalAttendances: 0 };

        const attendancePercent =
          enrolledStudents > 0 && conductedSessions > 0
            ? Math.min(
                Math.round((totalAttendances / (enrolledStudents * conductedSessions)) * 100),
                100,
              )
            : 0;

        // atRiskCount: enrolled students with individualRate < 75%, including zero-attendance
        const atRiskCount = (() => {
          if (conductedSessions === 0) return 0;
          const threshold = 0.75 * conductedSessions;
          const studentMap = perStudentMap.get(nc) ?? new Map<string, number>();
          let low = 0;
          for (const [, attended] of studentMap) {
            if (attended < threshold) low++;
          }
          // Students not in the map attended 0 sessions → all are at risk
          const zeroAttendance = Math.max(0, enrolledStudents - studentMap.size);
          return zeroAttendance + low;
        })();

        return {
          unitCode:         nc,
          unitName:         unit.title,
          enrolledStudents,
          conductedSessions,
          totalPresent:     totalAttendances,
          attendancePercent,
          atRiskCount,
          assignments:      assignMap.get(unit.id) ?? 0,
          materials:        matMap.get(unit.id)    ?? 0,
        };
      })
      .sort((a, b) => a.unitCode.localeCompare(b.unitCode));

    return NextResponse.json(result, { headers: corsHeaders });
  } catch (err: unknown) {
    console.error("[lecturer/analytics] error:", err);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500, headers: corsHeaders },
    );
  }
}
