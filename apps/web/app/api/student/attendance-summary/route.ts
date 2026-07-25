/**
 * GET /api/student/attendance-summary
 *
 * Returns per-unit attended/conducted counts for the authenticated student.
 * Lightweight companion to /api/student/attendance/summary — used by the
 * alerts screen which polls frequently (Cache-Control: max-age=60).
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyStudentAccessToken } from "@/lib/studentAuthJwt";

export const runtime = "nodejs";

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
  attended: bigint;
  conducted: bigint;
};

export async function GET(req: NextRequest) {
  const token =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!token) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  let studentId: string;
  try {
    ({ studentId } = verifyStudentAccessToken(token));
  } catch {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  const rows = await prisma.$queryRaw<SummaryRow[]>`
    WITH student_units AS (
      SELECT DISTINCT REPLACE(UPPER("unitCode"), ' ', '') AS unit_code
      FROM   "OfflineAttendanceRecord"
      WHERE  "studentId" = ${studentId}
        AND  "unitCode"  != ''

      UNION

      SELECT DISTINCT REPLACE(UPPER(s."unitCode"), ' ', '')
      FROM   "OnlineAttendanceRecord" r
      JOIN   "OnlineAttendanceSession" s ON s.id = r."sessionId"
      WHERE  r."studentId" = ${studentId}

      UNION

      SELECT DISTINCT REPLACE(UPPER(u.code), ' ', '')
      FROM   "Enrollment"  e
      JOIN   "Unit"        u ON u.id = e."unitId"
      WHERE  e."studentId" = ${studentId}
        AND (
          EXISTS (SELECT 1 FROM "ConductedSession"        cs  WHERE REPLACE(UPPER(cs."unitCode"),  ' ', '') = REPLACE(UPPER(u.code), ' ', ''))
          OR
          EXISTS (SELECT 1 FROM "OnlineAttendanceSession" oas WHERE REPLACE(UPPER(oas."unitCode"), ' ', '') = REPLACE(UPPER(u.code), ' ', ''))
        )
    ),
    offline_attended AS (
      SELECT REPLACE(UPPER("unitCode"), ' ', '') AS unit_code,
             COUNT(DISTINCT "sessionStart") AS cnt
      FROM   "OfflineAttendanceRecord"
      WHERE  "studentId" = ${studentId}
        AND  "unitCode"  != ''
        AND  UPPER("lectureRoom") != 'ONLINE'
      GROUP  BY REPLACE(UPPER("unitCode"), ' ', '')
    ),
    online_attended AS (
      SELECT REPLACE(UPPER(s."unitCode"), ' ', '') AS unit_code,
             COUNT(DISTINCT r."sessionId") AS cnt
      FROM   "OnlineAttendanceRecord" r
      JOIN   "OnlineAttendanceSession" s ON s.id = r."sessionId"
      WHERE  r."studentId" = ${studentId}
      GROUP  BY REPLACE(UPPER(s."unitCode"), ' ', '')
    ),
    offline_conducted AS (
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
      COALESCE(oa.cnt, 0) + COALESCE(ona.cnt, 0)         AS attended,
      COALESCE(oc.cnt, 0) + COALESCE(onc.cnt, 0)         AS conducted
    FROM   student_units            su
    LEFT   JOIN offline_attended    oa  ON  oa.unit_code  = su.unit_code
    LEFT   JOIN online_attended     ona ON ona.unit_code  = su.unit_code
    LEFT   JOIN offline_conducted   oc  ON  oc.unit_code  = su.unit_code
    LEFT   JOIN online_conducted    onc ON onc.unit_code  = su.unit_code
    ORDER  BY su.unit_code
  `;

  const result = rows.map((r) => ({
    unitCode: r.unitCode,
    attended: Number(r.attended),
    conducted: Number(r.conducted),
  }));

  return NextResponse.json(result, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Cache-Control": "max-age=60",
    },
  });
}
