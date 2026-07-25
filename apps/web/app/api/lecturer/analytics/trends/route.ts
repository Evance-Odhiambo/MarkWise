/**
 * GET /api/lecturer/analytics/trends?unitCodes=SCH2170,BIO1101
 *
 * Returns per-unit attendance rates for the last 7 conducted sessions,
 * used to draw sparkline charts on unit cards.
 *
 * Response — object keyed by normalised unit code, values oldest→newest:
 *   { "SCH2170": [72, 68, 75, 80, 77, 71, 78] }
 *
 * Empty array returned for units with 0–1 sessions (need ≥ 2 to show a trend).
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
    if (units.length === 0) return NextResponse.json({}, { headers: corsHeaders });

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

    const [enrollmentCounts, onlineSessions, offlineSessionsWithCounts, delegations] =
      await Promise.all([
        // Enrollment counts per unit
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

        // Online sessions (ended) with per-session present count
        normalisedUnitCodes.length > 0
          ? prisma.onlineAttendanceSession.findMany({
              where: { lecturerId, unitCode: { in: normalisedUnitCodes }, endedAt: { not: null } },
              select: {
                id: true,
                unitCode: true,
                createdAt: true,
                _count: { select: { records: true } },
              },
            })
          : Promise.resolve(
              [] as { id: string; unitCode: string; createdAt: Date; _count: { records: number } }[]
            ),

        // Offline sessions with per-session present counts (LEFT JOIN — 0-attendance sessions included)
        normCodes.length > 0
          ? prisma.$queryRaw<{
              normCode: string;
              sessionId: string;
              sessionTime: Date;
              presentCount: bigint;
            }[]>(
              Prisma.sql`
                SELECT
                  UPPER(REPLACE(cs."unitCode", ' ', '')) AS "normCode",
                  cs."id"           AS "sessionId",
                  cs."sessionStart" AS "sessionTime",
                  COUNT(DISTINCT oar."studentId") AS "presentCount"
                FROM "ConductedSession" cs
                LEFT JOIN "OfflineAttendanceRecord" oar
                  ON  UPPER(REPLACE(oar."unitCode", ' ', '')) = UPPER(REPLACE(cs."unitCode", ' ', ''))
                  AND oar."sessionStart" = cs."sessionStart"
                WHERE cs."lecturerId" = ${lecturerId}
                  AND UPPER(REPLACE(cs."unitCode", ' ', '')) IN (${Prisma.join(normCodes)})
                  AND UPPER(cs."lectureRoom") != 'ONLINE'
                GROUP BY cs."id", cs."sessionStart", cs."unitCode"
              `
            )
          : Promise.resolve(
              [] as { normCode: string; sessionId: string; sessionTime: Date; presentCount: bigint }[]
            ),

        // Delegation sessions with their attendance records (for standalone ones)
        rawUnitCodes.length > 0
          ? prisma.delegation.findMany({
              where: { createdBy: lecturerId, unitCode: { in: rawUnitCodes }, used: true },
              select: {
                id: true,
                unitCode: true,
                validFrom: true,
                attendanceRecords: { select: { studentId: true } },
              },
            })
          : Promise.resolve(
              [] as {
                id: string;
                unitCode: string;
                validFrom: bigint;
                attendanceRecords: { studentId: string }[];
              }[]
            ),
      ]);

    const enrolledMap = new Map(
      (enrollmentCounts as { normCode: string; cnt: bigint }[]).map((r) => [
        r.normCode,
        Number(r.cnt),
      ])
    );

    // Build offline session-time map for delegation dedup
    const offlineTimeMap = new Map<string, number[]>();
    for (const s of offlineSessionsWithCounts) {
      const times = offlineTimeMap.get(s.normCode) ?? [];
      times.push(s.sessionTime.getTime());
      offlineTimeMap.set(s.normCode, times);
    }

    // Accumulate sessions per unit: { time (ms), presentCount }
    type SessionPoint = { time: number; presentCount: number };
    const sessionsByUnit = new Map<string, SessionPoint[]>();
    const addSession = (normCode: string, point: SessionPoint) => {
      const arr = sessionsByUnit.get(normCode) ?? [];
      arr.push(point);
      sessionsByUnit.set(normCode, arr);
    };

    for (const s of onlineSessions) {
      addSession(norm(s.unitCode), { time: s.createdAt.getTime(), presentCount: s._count.records });
    }
    for (const s of offlineSessionsWithCounts) {
      addSession(s.normCode, { time: s.sessionTime.getTime(), presentCount: Number(s.presentCount) });
    }
    // Standalone delegation sessions only (dedup against offline ±5 min)
    for (const d of delegations) {
      const normCode = norm(d.unitCode);
      const offlineTimes = offlineTimeMap.get(normCode) ?? [];
      const delegMs = Number(d.validFrom);
      if (!offlineTimes.some((t) => Math.abs(t - delegMs) <= FIVE_MIN_MS)) {
        const uniqueStudents = new Set(d.attendanceRecords.map((r) => r.studentId));
        addSession(normCode, { time: delegMs, presentCount: uniqueStudents.size });
      }
    }

    // Build response: last 7 sessions (chronological), return rates
    const response: Record<string, number[]> = {};

    for (const normCode of normCodes) {
      const enrolled = enrolledMap.get(normCode) ?? 0;
      const sessions = (sessionsByUnit.get(normCode) ?? []).sort((a, b) => a.time - b.time);
      const last7 = sessions.slice(-7);

      if (last7.length < 2) {
        response[normCode] = [];
        continue;
      }

      response[normCode] = last7.map((s) =>
        enrolled > 0 ? Math.min(Math.round((s.presentCount / enrolled) * 100), 100) : 0
      );
    }

    return NextResponse.json(response, { headers: corsHeaders });
  } catch (err: unknown) {
    console.error("[lecturer/analytics/trends] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: corsHeaders });
  }
}
