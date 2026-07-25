/**
 * GET /api/student/units/:unitCode/analytics
 *
 * Returns peer-context attendance statistics for a unit:
 * class average, median, total enrolled, and the requesting student's
 * rank and percentile. Used by the InsightsScreen Peer Context card.
 *
 * Result is cached in-process for 15 minutes per unit to avoid
 * re-aggregating on every screen focus.
 *
 * Auth: Bearer student JWT
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyStudentAccessToken } from "@/lib/studentAuthJwt";
import { Prisma } from "@prisma/client";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

function normaliseCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// ── In-process cache ──────────────────────────────────────────────────────────
// Keyed by normCode. Stores the expensive aggregate so per-student rank lookup
// is just an O(n) scan on the already-sorted array.

interface UnitCache {
  classAverage: number;
  classMedian: number;
  totalEnrolled: number;
  // sorted descending by rate so index 0 is rank 1
  sortedEntries: Array<{ studentId: string; rate: number }>;
  expiresAt: number;
}

const unitCache = new Map<string, UnitCache>();
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

// ── Stats helpers ─────────────────────────────────────────────────────────────

function mean(rates: number[]): number {
  if (rates.length === 0) return 0;
  return Math.round(rates.reduce((s, r) => s + r, 0) / rates.length);
}

function median(rates: number[]): number {
  if (rates.length === 0) return 0;
  const sorted = [...rates].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? Math.round(sorted[mid])
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

// ── Aggregate builder ─────────────────────────────────────────────────────────

async function buildUnitCache(normCode: string): Promise<UnitCache> {
  // 1. All students enrolled in this unit (unnest + normalise on DB side)
  const enrolledRows = await prisma.$queryRaw<{ studentId: string }[]>(
    Prisma.sql`
      SELECT es."studentId"
      FROM   "StudentEnrollmentSnapshot" es
      WHERE  EXISTS (
        SELECT 1 FROM unnest(es."unitCodes") AS uc
        WHERE  UPPER(REPLACE(uc, ' ', '')) = ${normCode}
      )
    `,
  );
  const enrolledIds = new Set(enrolledRows.map((r) => r.studentId));
  const totalEnrolled = enrolledIds.size;

  if (totalEnrolled === 0) {
    return {
      classAverage: 0,
      classMedian: 0,
      totalEnrolled: 0,
      sortedEntries: [],
      expiresAt: Date.now() + CACHE_TTL,
    };
  }

  // 2. Total sessions conducted for this unit (online + offline, parallel)
  const [onlineRows, conductedRows] = await Promise.all([
    prisma.$queryRaw<[{ cnt: bigint }]>(
      Prisma.sql`
        SELECT COUNT(DISTINCT id)::int AS cnt
        FROM   "OnlineAttendanceSession"
        WHERE  UPPER(REPLACE("unitCode", ' ', '')) = ${normCode}
      `,
    ),
    prisma.$queryRaw<[{ cnt: bigint }]>(
      Prisma.sql`
        SELECT COUNT(DISTINCT id)::int AS cnt
        FROM   "ConductedSession"
        WHERE  UPPER(REPLACE("unitCode", ' ', '')) = ${normCode}
      `,
    ),
  ]);
  const totalSessions =
    Number(onlineRows[0]?.cnt ?? 0) + Number(conductedRows[0]?.cnt ?? 0);

  // 3. Per-student attendance counts across both sources
  const attendanceRows = await prisma.$queryRaw<
    { studentId: string; attended: bigint }[]
  >(
    Prisma.sql`
      WITH marks AS (
        -- Offline / BLE / manual attendance joined to ConductedSession
        SELECT oar."studentId", cs.id AS sk
        FROM   "OfflineAttendanceRecord" oar
        JOIN   "ConductedSession" cs
          ON   UPPER(REPLACE(cs."unitCode", ' ', '')) = ${normCode}
          AND  cs."lectureRoom" = oar."lectureRoom"
          AND  cs."sessionStart" = oar."sessionStart"
        WHERE  UPPER(REPLACE(oar."unitCode", ' ', '')) = ${normCode}

        UNION

        -- Online QR attendance
        SELECT oa."studentId", oa."sessionId" AS sk
        FROM   "OnlineAttendanceRecord" oa
        JOIN   "OnlineAttendanceSession" oas ON oas.id = oa."sessionId"
        WHERE  UPPER(REPLACE(oas."unitCode", ' ', '')) = ${normCode}
      )
      SELECT "studentId", COUNT(DISTINCT sk)::int AS attended
      FROM   marks
      GROUP  BY "studentId"
    `,
  );

  const attendedMap = new Map<string, number>(
    attendanceRows.map((r) => [r.studentId, Number(r.attended)]),
  );

  // 4. Build rate for every enrolled student (0 if no records)
  const entries = [...enrolledIds].map((sid) => {
    const attended = attendedMap.get(sid) ?? 0;
    const rate =
      totalSessions > 0
        ? Math.min(100, Math.round((attended / totalSessions) * 100))
        : 0;
    return { studentId: sid, rate };
  });

  // Sort descending (rank 1 = highest rate)
  entries.sort((a, b) => b.rate - a.rate);

  const rates = entries.map((e) => e.rate);

  return {
    classAverage: mean(rates),
    classMedian: median(rates),
    totalEnrolled,
    sortedEntries: entries,
    expiresAt: Date.now() + CACHE_TTL,
  };
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ unitCode: string }> },
) {
  const token = (req.headers.get("authorization") ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!token) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }
  let studentId: string;
  try {
    ({ studentId } = verifyStudentAccessToken(token));
  } catch {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  const { unitCode: rawCode } = await params;
  const normCode = normaliseCode(rawCode);
  if (!normCode) {
    return NextResponse.json({ message: "Invalid unitCode" }, { status: 400, headers: corsHeaders });
  }

  try {
    // Serve from cache if fresh
    let cached = unitCache.get(normCode);
    if (!cached || cached.expiresAt <= Date.now()) {
      cached = await buildUnitCache(normCode);
      unitCache.set(normCode, cached);
    }

    const { classAverage, classMedian, totalEnrolled, sortedEntries } = cached;

    // Compute this student's rank within the sorted list.
    // Students with identical rates share the same rank (competition ranking).
    let studentRate = 0;
    let studentRank = totalEnrolled; // default: last if not found
    const entry = sortedEntries.find((e) => e.studentId === studentId);
    if (entry) {
      studentRate = entry.rate;
      // Count how many students have a strictly higher rate (dense rank)
      const higherCount = sortedEntries.filter((e) => e.rate > studentRate).length;
      studentRank = higherCount + 1;
    }

    const studentPercentile =
      totalEnrolled > 0
        ? Math.round((1 - (studentRank - 1) / totalEnrolled) * 100)
        : 0;

    return NextResponse.json(
      {
        unitCode:          normCode,
        classAverage,
        classMedian,
        totalEnrolled,
        studentRank,
        studentPercentile,
      },
      { headers: corsHeaders },
    );
  } catch (err: unknown) {
    console.error("[student/units/:unitCode/analytics] error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: corsHeaders });
  }
}
