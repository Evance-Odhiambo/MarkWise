import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyStudentAccessToken } from "@/lib/studentAuthJwt";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

type SummaryRow = {
  unitCode: string;
  unitName: string | null;
  attended: bigint;
  conducted: bigint;
};

// GET /api/student/attendance/summary
// Returns per-unit attendance counts for the authenticated student.
export async function GET(req: NextRequest) {
  const token =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!token) {
    return NextResponse.json(
      { message: "Unauthorized" },
      { status: 401, headers: corsHeaders }
    );
  }

  let studentId: string;
  try {
    ({ studentId } = verifyStudentAccessToken(token));
  } catch {
    return NextResponse.json(
      { message: "Unauthorized" },
      { status: 401, headers: corsHeaders }
    );
  }

  // Single CTE query:
  // - student_units: every unit the student has any record for, plus enrolled
  //   units that have at least one conducted session.
  //   All unitCodes normalised (spaces stripped, upper) so "SCH 2170" == "SCH2170".
  // - attended: distinct offline sessionStarts + distinct online sessionIds per unit
  // - conducted: distinct ConductedSession sessionStarts + distinct
  //   OnlineAttendanceSession ids per unit
  const rows = await prisma.$queryRaw<SummaryRow[]>`
    WITH student_units AS (
      SELECT DISTINCT REPLACE(UPPER("unitCode"), ' ', '') AS unit_code
      FROM   "OfflineAttendanceRecord"
      WHERE  "studentId" = ${studentId}
        AND  "unitCode"  != ''

      UNION

      -- Online attended units: join through session because OnlineAttendanceRecord.unitCode
      -- is "" for records created via the /mark (no-auth) route.
      SELECT DISTINCT REPLACE(UPPER(s."unitCode"), ' ', '')
      FROM   "OnlineAttendanceRecord" r
      JOIN   "OnlineAttendanceSession" s ON s.id = r."sessionId"
      WHERE  r."studentId" = ${studentId}

      UNION

      -- enrolled units that have at least one conducted or online session
      SELECT DISTINCT REPLACE(UPPER(u.code), ' ', '')
      FROM   "Enrollment"  e
      JOIN   "Unit"        u  ON u.id   = e."unitId"
      WHERE  e."studentId" = ${studentId}
        AND (
          EXISTS (SELECT 1 FROM "ConductedSession"       cs  WHERE REPLACE(UPPER(cs."unitCode"), ' ', '') = REPLACE(UPPER(u.code), ' ', ''))
          OR
          EXISTS (SELECT 1 FROM "OnlineAttendanceSession" oas WHERE REPLACE(UPPER(oas."unitCode"), ' ', '') = REPLACE(UPPER(u.code), ' ', ''))
        )
    ),
    offline_attended AS (
      -- Exclude lectureRoom='ONLINE': those records are also written to
      -- OnlineAttendanceRecord and counted separately in online_attended to
      -- preserve backward compatibility with records predating this fix.
      SELECT REPLACE(UPPER("unitCode"), ' ', '') AS unit_code,
             COUNT(DISTINCT "sessionStart") AS cnt
      FROM   "OfflineAttendanceRecord"
      WHERE  "studentId" = ${studentId}
        AND  "unitCode"  != ''
        AND  UPPER("lectureRoom") != 'ONLINE'
      GROUP  BY REPLACE(UPPER("unitCode"), ' ', '')
    ),
    online_attended AS (
      -- Join through OnlineAttendanceSession to get the canonical unit code.
      -- OnlineAttendanceRecord.unitCode is "" for records created via the /mark route.
      SELECT REPLACE(UPPER(s."unitCode"), ' ', '') AS unit_code,
             COUNT(DISTINCT r."sessionId") AS cnt
      FROM   "OnlineAttendanceRecord" r
      JOIN   "OnlineAttendanceSession" s ON s.id = r."sessionId"
      WHERE  r."studentId" = ${studentId}
      GROUP  BY REPLACE(UPPER(s."unitCode"), ' ', '')
    ),
    offline_conducted AS (
      -- Exclude lectureRoom = 'ONLINE': those rows are registered by the frontend's
      -- sync-on-create for online sessions and are already counted in online_conducted.
      SELECT REPLACE(UPPER("unitCode"), ' ', '') AS unit_code,
             COUNT(DISTINCT "sessionStart") AS cnt
      FROM   "ConductedSession"
      WHERE  "lectureRoom" != 'ONLINE'
      GROUP  BY REPLACE(UPPER("unitCode"), ' ', '')
    ),
    online_conducted AS (
      SELECT REPLACE(UPPER("unitCode"), ' ', '') AS unit_code,
             COUNT(DISTINCT id) AS cnt
      FROM   "OnlineAttendanceSession"
      WHERE  "endedAt" IS NOT NULL
      GROUP  BY REPLACE(UPPER("unitCode"), ' ', '')
    )
    SELECT
      su.unit_code                                        AS "unitCode",
      u.title                                             AS "unitName",
      COALESCE(oa.cnt, 0) + COALESCE(ona.cnt, 0)         AS attended,
      COALESCE(oc.cnt, 0) + COALESCE(onc.cnt, 0)         AS conducted
    FROM   student_units            su
    LEFT   JOIN "Unit"              u   ON  REPLACE(UPPER(u.code), ' ', '') = su.unit_code
    LEFT   JOIN offline_attended    oa  ON  oa.unit_code  = su.unit_code
    LEFT   JOIN online_attended     ona ON ona.unit_code  = su.unit_code
    LEFT   JOIN offline_conducted   oc  ON  oc.unit_code  = su.unit_code
    LEFT   JOIN online_conducted    onc ON onc.unit_code  = su.unit_code
    ORDER  BY su.unit_code
  `;

  // Prisma returns COUNT as BigInt — convert to Number for JSON serialisation
  const units = rows.map((r) => ({
    unitCode: r.unitCode,
    unitName: r.unitName ?? r.unitCode,
    attended: Number(r.attended),
    conducted: Number(r.conducted),
  }));

  const unitCodes = units.map((u) => u.unitCode);

  // ── Per-session detail (optional, non-breaking) ───────────────────────────
  // For each unit fetch all conducted sessions and whether the student attended.
  type SessionRow = {
    sessionStart: Date;
    lessonType: string | null;
    attended: boolean;
  };

  const sessionRows = unitCodes.length > 0
    ? await prisma.$queryRaw<(SessionRow & { unit_code: string })[]>`
        -- Offline + GD sessions from ConductedSession (excludes ONLINE rows)
        SELECT
          REPLACE(UPPER(cs."unitCode"), ' ', '') AS unit_code,
          cs."sessionStart"                      AS "sessionStart",
          COALESCE(cs."lessonType", 'LEC')       AS "lessonType",
          (oar.id IS NOT NULL)                   AS attended
        FROM "ConductedSession" cs
        LEFT JOIN "OfflineAttendanceRecord" oar
          ON  REPLACE(UPPER(oar."unitCode"),    ' ', '') = REPLACE(UPPER(cs."unitCode"),    ' ', '')
          AND oar."sessionStart" = cs."sessionStart"
          AND oar."studentId"    = ${studentId}
        WHERE REPLACE(UPPER(cs."unitCode"), ' ', '') = ANY(${unitCodes})
          AND UPPER(cs."lectureRoom") != 'ONLINE'

        UNION ALL

        -- Pure online sessions from OnlineAttendanceSession
        SELECT
          REPLACE(UPPER(oas."unitCode"), ' ', '') AS unit_code,
          oas."createdAt"                         AS "sessionStart",
          'ONLINE'                                AS "lessonType",
          (onr.id IS NOT NULL)                    AS attended
        FROM "OnlineAttendanceSession" oas
        LEFT JOIN "OnlineAttendanceRecord" onr
          ON  onr."sessionId" = oas.id
          AND onr."studentId" = ${studentId}
        WHERE REPLACE(UPPER(oas."unitCode"), ' ', '') = ANY(${unitCodes})
          AND oas."endedAt" IS NOT NULL

        ORDER BY "sessionStart" ASC
      `
    : [];

  // Group by unit_code
  const sessionsByUnit: Record<string, Array<{ sessionStart: number; lessonType: string; attended: boolean }>> = {};
  for (const sr of sessionRows) {
    if (!sessionsByUnit[sr.unit_code]) sessionsByUnit[sr.unit_code] = [];
    sessionsByUnit[sr.unit_code].push({
      sessionStart: sr.sessionStart.getTime(),
      lessonType: sr.lessonType ?? "LEC",
      attended: Boolean(sr.attended),
    });
  }

  const unitsWithSessions = units.map((u) => ({
    ...u,
    sessions: sessionsByUnit[u.unitCode] ?? [],
  }));

  const totalAttended = units.reduce((s, u) => s + u.attended, 0);
  const totalConducted = units.reduce((s, u) => s + u.conducted, 0);

  return NextResponse.json(
    { units: unitsWithSessions, totalAttended, totalConducted },
    { status: 200, headers: corsHeaders }
  );
}
