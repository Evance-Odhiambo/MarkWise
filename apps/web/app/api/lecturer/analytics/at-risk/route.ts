/**
 * GET /api/lecturer/analytics/at-risk?unitCodes=SCH2170,BIO1101
 *
 * Returns the count of at-risk students per unit (attendance rate < 75%).
 *
 * Response — object keyed by normalised unit code:
 *   { "SCH2170": { "atRisk": 3, "critical": 1 }, "BIO1101": { "atRisk": 0, "critical": 0 } }
 *
 * Auth: Bearer lecturer JWT
 */
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { verifyLecturerAccessToken } from "@/lib/lecturerAuthJwt";
import { normalizeUnitCode } from "@/lib/unitCode";

export const runtime = "nodejs";

const FIVE_MIN_MS = 5 * 60 * 1000;
const norm = (c: string) => c.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET(req: NextRequest) {
  const token = (req.headers.get("authorization") ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }
  let lecturerId: string;
  try {
    ({ lecturerId } = verifyLecturerAccessToken(token));
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  const raw = req.nextUrl.searchParams.get("unitCodes") ?? "";
  const normCodes = [...new Set(
    raw.split(",").map((c) => norm(c)).filter(Boolean)
  )];

  if (normCodes.length === 0) {
    return NextResponse.json({}, { headers: corsHeaders });
  }

  try {
    // Resolve units
    const units = await prisma.$queryRaw<{ id: string; code: string }[]>(
      Prisma.sql`
        SELECT id, code FROM "Unit"
        WHERE UPPER(REPLACE(code, ' ', '')) IN (${Prisma.join(normCodes)})
      `
    );
    if (units.length === 0) {
      return NextResponse.json(
        Object.fromEntries(normCodes.map((c) => [c, { atRisk: 0, critical: 0 }])),
        { headers: corsHeaders }
      );
    }

    const rawUnitCodes = units.map((u) => u.code);
    const normalisedUnitCodes = rawUnitCodes.map(normalizeUnitCode);

    const lecturerRecord = await prisma.lecturer.findUnique({
      where: { id: lecturerId },
      select: { institutionId: true },
    });
    if (!lecturerRecord?.institutionId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
    }
    const { institutionId } = lecturerRecord;

    // Parallel: enrollment counts + all session data + per-student attendance
    const [
      enrollmentCounts,
      onlineSessions,
      offlineSessions,
      delegationSessions,
      perStudentAttendance,
    ] = await Promise.all([
      prisma.$queryRaw<{ normCode: string; cnt: bigint }[]>(
        Prisma.sql`
          SELECT UPPER(REPLACE(uc, ' ', '')) AS "normCode", COUNT(*) AS cnt
          FROM   "StudentEnrollmentSnapshot" es
          JOIN   "Student" s ON s.id = es."studentId"
          CROSS JOIN LATERAL unnest(es."unitCodes") AS uc
          WHERE  s."institutionId" = ${institutionId}
            AND  UPPER(REPLACE(uc, ' ', '')) IN (${Prisma.join(normCodes)})
          GROUP BY UPPER(REPLACE(uc, ' ', ''))
        `
      ),

      prisma.onlineAttendanceSession.findMany({
        where: { lecturerId, unitCode: { in: normalisedUnitCodes }, endedAt: { not: null } },
        select: { unitCode: true, _count: { select: { records: true } } },
      }),

      prisma.$queryRaw<{ normCode: string; sessionStart: Date }[]>(
        Prisma.sql`
          SELECT UPPER(REPLACE("unitCode", ' ', '')) AS "normCode", "sessionStart"
          FROM   "ConductedSession"
          WHERE  "lecturerId" = ${lecturerId}
            AND  UPPER(REPLACE("unitCode", ' ', '')) IN (${Prisma.join(normCodes)})
            AND  UPPER("lectureRoom") != 'ONLINE'
        `
      ),

      prisma.delegation.findMany({
        where: { createdBy: lecturerId, unitCode: { in: rawUnitCodes }, used: true },
        select: { unitCode: true, validFrom: true },
      }),

      // Per-student per-unit attended session counts (all three sources)
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

    // Build enrollment map
    const enrolledMap = new Map(
      (enrollmentCounts as { normCode: string; cnt: bigint }[]).map((r) => [r.normCode, Number(r.cnt)])
    );

    // Compute conductedSessions per normCode (same dedup logic)
    const offlineTimeMap = new Map<string, number[]>();
    for (const s of offlineSessions) {
      const times = offlineTimeMap.get(s.normCode) ?? [];
      times.push(s.sessionStart.getTime());
      offlineTimeMap.set(s.normCode, times);
    }

    const conductedMap = new Map<string, number>();
    for (const s of onlineSessions) {
      const nc = norm(s.unitCode);
      conductedMap.set(nc, (conductedMap.get(nc) ?? 0) + 1);
    }
    for (const s of offlineSessions) {
      conductedMap.set(s.normCode, (conductedMap.get(s.normCode) ?? 0) + 1);
    }
    for (const d of delegationSessions) {
      const nc = norm(d.unitCode);
      const offlineTimes = offlineTimeMap.get(nc) ?? [];
      const delegMs = Number(d.validFrom);
      if (!offlineTimes.some((t) => Math.abs(t - delegMs) <= FIVE_MIN_MS)) {
        conductedMap.set(nc, (conductedMap.get(nc) ?? 0) + 1);
      }
    }

    // Build per-student map: normCode → (studentId → attended)
    const perStudentMap = new Map<string, Map<string, number>>();
    for (const row of perStudentAttendance) {
      let m = perStudentMap.get(row.normCode);
      if (!m) { m = new Map(); perStudentMap.set(row.normCode, m); }
      m.set(row.studentId, Number(row.attended));
    }

    // Compute at-risk counts per unit
    const response: Record<string, { atRisk: number; critical: number }> = {};

    for (const normCode of normCodes) {
      const conducted = conductedMap.get(normCode) ?? 0;
      if (conducted === 0) {
        response[normCode] = { atRisk: 0, critical: 0 };
        continue;
      }
      const enrolled = enrolledMap.get(normCode) ?? 0;
      const studentMap = perStudentMap.get(normCode) ?? new Map<string, number>();

      let atRisk = 0;
      let critical = 0;
      for (const [, attended] of studentMap) {
        const rate = attended / conducted;
        if (rate < 0.75) atRisk++;
        if (rate < 0.50) critical++;
      }
      // Students with 0 attendance (not in studentMap) are at risk and critical
      const zeroCount = Math.max(0, enrolled - studentMap.size);
      atRisk += zeroCount;
      critical += zeroCount;

      response[normCode] = { atRisk, critical };
    }

    return NextResponse.json(response, { headers: corsHeaders });
  } catch (err: unknown) {
    console.error("[lecturer/analytics/at-risk] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: corsHeaders });
  }
}
