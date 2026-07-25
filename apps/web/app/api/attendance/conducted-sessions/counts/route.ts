import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { verifyStudentAccessToken } from "@/lib/studentAuthJwt";
import { verifyLecturerAccessToken } from "@/lib/lecturerAuthJwt";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

/**
 * GET /api/attendance/conducted-sessions/counts?unitCodes=CS301,CS302[&byType=true]
 *
 * Returns COUNT(DISTINCT sessionStart) per unit code.
 * Auth: student OR lecturer Bearer JWT.
 */
export async function GET(req: NextRequest) {
  // ── Auth — accept either student or lecturer JWT ───────────────────────
  const token = (req.headers.get("authorization") ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!token) {
    return NextResponse.json(
      { message: "Unauthorized" },
      { status: 401, headers: corsHeaders },
    );
  }
  let authenticated = false;
  try {
    verifyStudentAccessToken(token);
    authenticated = true;
  } catch { /* try lecturer below */ }
  if (!authenticated) {
    try {
      verifyLecturerAccessToken(token);
      authenticated = true;
    } catch { /* fall through to 401 */ }
  }
  if (!authenticated) {
    return NextResponse.json(
      { message: "Unauthorized" },
      { status: 401, headers: corsHeaders },
    );
  }

  // ── Parse + sanitise unitCodes ───────────────────────────────────────────
  const raw = req.nextUrl.searchParams.get("unitCodes") ?? "";
  const codes = raw
    .split(",")
    .map((c) => c.trim().toUpperCase().replace(/[^A-Z0-9]/g, ""))
    .filter(Boolean);

  const byType = req.nextUrl.searchParams.get("byType") === "true";

  if (codes.length > 50) {
    return NextResponse.json(
      { message: "Too many unit codes — maximum 50 per request." },
      { status: 400, headers: corsHeaders },
    );
  }

  if (codes.length === 0) {
    return NextResponse.json({}, { headers: corsHeaders });
  }

  // ── Query — unified count across all three session sources ──────────────
  // Source 1: Offline sessions (ConductedSession). These codes are already
  //           normalised at insert time to match the sanitised request keys.
  // Source 2: Online sessions (OnlineAttendanceSession, endedAt != null).
  //           unitCode stored raw — normalise at query time.
  // Source 3: Delegation / GD group sessions (Delegation, used = true).
  //           unitCode stored raw — normalise at query time.
  //
  // Deduplication: if a Delegation.validFrom is within ±5 min of any
  // ConductedSession.sessionStart for the same unit, the two represent the
  // same real lecture window and should be counted once only.

  const FIVE_MIN_MS = 5 * 60 * 1000;

  const [offlineRows, onlineRows, delegationRows] = await Promise.all([
    // Source 1: offline — fetch with sessionStart for dedup + count.
    // Exclude lectureRoom = 'ONLINE': those rows are registered by the app's
    // sync-on-create for online sessions and are already counted via Source 2
    // (OnlineAttendanceSession). Including them here would double-count.
    prisma.$queryRaw<{ normCode: string; sessionStartMs: string }[]>(
      Prisma.sql`
        SELECT
          UPPER(REPLACE("unitCode", ' ', '')) AS "normCode",
          (EXTRACT(EPOCH FROM "sessionStart") * 1000)::text AS "sessionStartMs"
        FROM "ConductedSession"
        WHERE UPPER(REPLACE("unitCode", ' ', '')) IN (${Prisma.join(codes)})
          AND UPPER("lectureRoom") != 'ONLINE'
      `,
    ),

    // Source 2: online
    prisma.$queryRaw<{ normCode: string }[]>(
      Prisma.sql`
        SELECT UPPER(REPLACE("unitCode", ' ', '')) AS "normCode"
        FROM "OnlineAttendanceSession"
        WHERE UPPER(REPLACE("unitCode", ' ', '')) IN (${Prisma.join(codes)})
          AND "endedAt" IS NOT NULL
      `,
    ),

    // Source 3: delegation — cast validFrom to epoch-ms so Number() works correctly.
    prisma.$queryRaw<{ normCode: string; validFrom: string }[]>(
      Prisma.sql`
        SELECT
          UPPER(REPLACE("unitCode", ' ', '')) AS "normCode",
          (EXTRACT(EPOCH FROM "validFrom") * 1000)::text AS "validFrom"
        FROM "Delegation"
        WHERE UPPER(REPLACE("unitCode", ' ', '')) IN (${Prisma.join(codes)})
          AND used = true
      `,
    ),
  ]);

  // Build offline session-time map per unit (for dedup + count)
  const offlineTimeMap = new Map<string, number[]>();
  for (const row of offlineRows) {
    const times = offlineTimeMap.get(row.normCode) ?? [];
    times.push(Number(row.sessionStartMs));
    offlineTimeMap.set(row.normCode, times);
  }

  // Assemble unified result map
  const result: Record<string, number> = {};

  // Offline counts
  for (const [code, times] of offlineTimeMap) {
    result[code] = times.length;
  }

  // Online counts
  for (const row of onlineRows) {
    result[row.normCode] = (result[row.normCode] ?? 0) + 1;
  }

  // Delegation counts — skip any within ±5 min of an offline session
  for (const row of delegationRows) {
    const offlineTimes = offlineTimeMap.get(row.normCode) ?? [];
    const delegMs = Number(row.validFrom);
    const overlaps = offlineTimes.some((t) => Math.abs(t - delegMs) <= FIVE_MIN_MS);
    if (!overlaps) {
      result[row.normCode] = (result[row.normCode] ?? 0) + 1;
    }
  }

  if (!byType) {
    return NextResponse.json(result, { headers: corsHeaders });
  }

  // ── Optional per-type breakdown (offline lesson types only) ──────────────
  const typeRows = await prisma.conductedSession.groupBy({
    by: ["unitCode", "lessonType"],
    where: { unitCode: { in: codes } },
    _count: { sessionStart: true },
  });

  const byTypeResult: Record<string, Record<string, number>> = {};
  for (const row of typeRows) {
    const key = row.unitCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    const lt = row.lessonType ?? "LEC";
    if (!byTypeResult[key]) byTypeResult[key] = {};
    byTypeResult[key][lt] = (byTypeResult[key][lt] ?? 0) + row._count.sessionStart;
  }
  // Add online and standalone delegation entries to byType breakdown
  for (const row of onlineRows) {
    if (!byTypeResult[row.normCode]) byTypeResult[row.normCode] = {};
    byTypeResult[row.normCode]["ONLINE"] =
      (byTypeResult[row.normCode]["ONLINE"] ?? 0) + 1;
  }
  for (const row of delegationRows) {
    const offlineTimes = offlineTimeMap.get(row.normCode) ?? [];
    const delegMs = Number(row.validFrom);
    const overlaps = offlineTimes.some((t) => Math.abs(t - delegMs) <= FIVE_MIN_MS);
    if (!overlaps) {
      if (!byTypeResult[row.normCode]) byTypeResult[row.normCode] = {};
      byTypeResult[row.normCode]["GROUP"] =
        (byTypeResult[row.normCode]["GROUP"] ?? 0) + 1;
    }
  }

  return NextResponse.json({ ...result, byType: byTypeResult }, { headers: corsHeaders });
}
