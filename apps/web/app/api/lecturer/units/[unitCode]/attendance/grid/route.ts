/**
 * GET /api/lecturer/units/:unitCode/attendance/grid
 *
 * Returns a session-by-session attendance grid for the given unit.
 * Rows = enrolled students, columns = conducted sessions (LEC1 … LECN).
 *
 * Auth:  Bearer lecturer JWT
 * 401   token missing or invalid
 * 403   lecturer not timetable-assigned to this unit
 * 404   unit not found
 * 200 { sessions: [], students: [] }   unit exists but no sessions conducted yet
 *
 * Response shape:
 * {
 *   sessions: ["LEC1", "LEC2", …],        // ordered column labels
 *   students: [                            // sorted alphabetically by name
 *     {
 *       admissionNumber: string,
 *       name: string,
 *       attendance: boolean[]              // index-aligned with sessions[]
 *     },
 *     …
 *   ]
 * }
 *
 * Sessions include both offline ConductedSessions (QR/BLE/Manual/GD) and
 * ended OnlineAttendanceSessions, merged and ordered by time ascending.
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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ unitCode: string }> },
) {
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

  // ── Normalize unit code ───────────────────────────────────────────────────
  const { unitCode: rawParam } = await params;
  const unitCode = decodeURIComponent(rawParam).replace(/\s+/g, "").toUpperCase();
  if (!unitCode) {
    return NextResponse.json(
      { error: "Unit not found" },
      { status: 404, headers: corsHeaders },
    );
  }

  try {
    // ── Resolve unit (case-insensitive, space-tolerant) ───────────────────────
    const unitRows = await prisma.$queryRaw<
      { id: string; code: string }[]
    >`
      SELECT id, code
      FROM "Unit"
      WHERE UPPER(REPLACE(code, ' ', '')) = ${unitCode}
      LIMIT 1
    `;
    if (unitRows.length === 0) {
      return NextResponse.json(
        { error: "Unit not found" },
        { status: 404, headers: corsHeaders },
      );
    }
    const unit = unitRows[0];
    // rawUnitCode: as stored in Unit table (may or may not have spaces)
    // normalisedUnitCode: canonical "SCH 2170" form — used to query OnlineAttendanceSession
    // since that table stores the output of normalizeUnitCode() at creation time.
    const rawUnitCode = unit.code;
    const normalisedUnitCode = normalizeUnitCode(rawUnitCode);

    // ── Authorization: lecturer must be timetable-assigned to this unit ───────
    const timetableEntry = await prisma.timetable.findFirst({
      where: { lecturerId, unitOffering: { unitId: unit.id } },
      select: { id: true },
    });
    if (!timetableEntry) {
      return NextResponse.json(
        { error: "Forbidden" },
        { status: 403, headers: corsHeaders },
      );
    }

    // ── Resolve institution (needed for enrollment snapshot query) ────────────
    const lecturer = await prisma.lecturer.findUnique({
      where: { id: lecturerId },
      select: { institutionId: true },
    });
    if (!lecturer?.institutionId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: corsHeaders },
      );
    }
    const { institutionId } = lecturer;

    // ── Parallel fetch: students + conducted sessions ─────────────────────────
    const [enrolledStudents, offlineSessions, onlineSessions, delegationSessions] = await Promise.all([
      // Enrolled students sorted alphabetically by name
      prisma.$queryRaw<
        { studentId: string; name: string; admissionNumber: string }[]
      >`
        SELECT
          s.id              AS "studentId",
          s.name            AS "name",
          s."admissionNumber"
        FROM "StudentEnrollmentSnapshot" es
        JOIN "Student" s ON s.id = es."studentId"
        WHERE s."institutionId" = ${institutionId}
          AND EXISTS (
            SELECT 1
            FROM unnest(es."unitCodes") AS uc
            WHERE UPPER(REPLACE(uc, ' ', '')) = ${unitCode}
          )
        ORDER BY s.name ASC
      `,

      // Offline conducted sessions — normalization-tolerant $queryRaw so that
      // manual-mark sessions (stored with spaces) and BLE sessions (stored without)
      // are both found. Exclude lectureRoom = 'ONLINE': those sessions appear in
      // onlineSessions (OnlineAttendanceSession) and are handled separately below.
      prisma.$queryRaw<{ id: string; sessionStart: Date; lectureRoom: string; lessonType: string | null }[]>(Prisma.sql`
        SELECT id, "sessionStart", "lectureRoom", "lessonType"
        FROM   "ConductedSession"
        WHERE  "lecturerId" = ${lecturerId}
          AND  UPPER(REPLACE("unitCode", ' ', '')) = ${unitCode}
          AND  UPPER("lectureRoom") != 'ONLINE'
        ORDER BY "sessionStart" ASC
      `),

      // Online ended sessions — stored with normalizeUnitCode() at creation
      prisma.onlineAttendanceSession.findMany({
        where: { lecturerId, unitCode: normalisedUnitCode, endedAt: { not: null } },
        orderBy: { createdAt: "asc" },
        select: { id: true, createdAt: true },
      }),

      // Delegation / GD group sessions (used, created by this lecturer)
      prisma.delegation.findMany({
        where: { createdBy: lecturerId, unitCode: rawUnitCode, used: true },
        orderBy: { validFrom: "asc" },
        select: { id: true, validFrom: true },
      }),
    ]);

    // ── Merge and sort all sessions by time, dedup delegation ±5 min ─────────
    type OfflineSession  = { type: "offline";    id: string; time: Date; lectureRoom: string; sessionStart: Date; lessonType: string | null };
    type OnlineSession   = { type: "online";     id: string; time: Date };
    type DelegSession    = { type: "delegation"; id: string; time: Date };
    type AnySession = OfflineSession | OnlineSession | DelegSession;

    // Session object shape returned to the mobile app.
    // sessionId is the source-table primary key; session_date is ISO YYYY-MM-DD;
    // sessionStart (Unix ms) kept for offline manual-mark matching.
    interface SessionOut {
      sessionId: string;    // canonical identifier used as key in student records
      sessionStart: number; // Unix ms
      date: string;         // ISO-8601 datetime e.g. "2025-03-01T08:00:00.000Z"
      session_date: string; // "YYYY-MM-DD" (kept for backward compat)
      lectureRoom: string;
      label: string;
      lessonType: string;   // e.g. "LEC", "TUT", "LAB", "PRE", "Online", "Group"
      type: string;         // "inperson" | "online" | "delegation"
    }

    const FIVE_MIN_MS = 5 * 60 * 1000;
    // Deduplicate offline sessions by (sessionStart ms + lectureRoom) in case the
    // ConductedSession table has duplicate rows with different PKs for the same lecture.
    const seenOfflineKeys = new Set<string>();
    const dedupedOfflineSessions = offlineSessions.filter((s) => {
      const k = `${s.sessionStart.getTime()}_${s.lectureRoom}`;
      if (seenOfflineKeys.has(k)) return false;
      seenOfflineKeys.add(k);
      return true;
    });

    const offlineTimes = dedupedOfflineSessions.map((s) => s.sessionStart.getTime());

    // Only include delegation sessions that don't overlap an offline session (±5 min)
    const standaloneDelSessions = delegationSessions.filter((d) => {
      const delegMs = Number(d.validFrom);
      return !offlineTimes.some((t) => Math.abs(t - delegMs) <= FIVE_MIN_MS);
    });

    const allSessions: AnySession[] = [
      ...dedupedOfflineSessions.map((s): OfflineSession => ({
        type: "offline",
        id: s.id,
        time: s.sessionStart,
        lectureRoom: s.lectureRoom,
        sessionStart: s.sessionStart,
        lessonType: s.lessonType,
      })),
      ...onlineSessions.map((s): OnlineSession => ({
        type: "online",
        id: s.id,
        time: s.createdAt,
      })),
      ...standaloneDelSessions.map((d): DelegSession => ({
        type: "delegation",
        id: d.id,
        time: new Date(Number(d.validFrom)),
      })),
    ].sort((a, b) => a.time.getTime() - b.time.getTime());

    // No sessions yet — return empty grid (not a 404)
    if (allSessions.length === 0) {
      return NextResponse.json(
        {
          sessions: [] as SessionOut[],
          students: enrolledStudents.map((s) => ({
            studentId:       s.studentId,
            admissionNumber: s.admissionNumber,
            name:            s.name,
            records:         {} as Record<string, boolean>,
          })),
        },
        { status: 200, headers: corsHeaders },
      );
    }

    // Build sessionObjects — each session gets a stable sessionId (source table PK)
    // and a human-readable label. Online sessions are labelled "ONL N" with their own
    // counter so they are visually distinct from in-person "LEC N" sessions.
    const sessionObjects: SessionOut[] = [];

    let lecCount = 0;
    let onlCount = 0;
    allSessions.forEach((s) => {
      let out: SessionOut;
      const isoDate = new Date(s.time).toISOString().slice(0, 10);
      if (s.type === "online") {
        onlCount++;
        out = {
          sessionId:    s.id,
          sessionStart: s.time.getTime(),
          date:         s.time.toISOString(),
          session_date: isoDate,
          lectureRoom:  "ONLINE",
          label:        `ONL ${onlCount}`,
          lessonType:   "Online",
          type:         "online",
        };
      } else if (s.type === "offline") {
        lecCount++;
        out = {
          sessionId:    s.id,
          sessionStart: s.sessionStart.getTime(),
          date:         s.sessionStart.toISOString(),
          session_date: isoDate,
          lectureRoom:  s.lectureRoom,
          label:        `LEC ${lecCount}`,
          lessonType:   s.lessonType ?? "LEC",
          type:         "inperson",
        };
      } else {
        lecCount++;
        out = {
          sessionId:    s.id,
          sessionStart: s.time.getTime(),
          date:         s.time.toISOString(),
          session_date: isoDate,
          lectureRoom:  "GD",
          label:        `LEC ${lecCount}`,
          lessonType:   "Group",
          type:         "delegation",
        };
      }
      sessionObjects.push(out);
    });

    // ── Fetch attendance records for those sessions ───────────────────────────
    const onlineSessionIds = onlineSessions.map((s) => s.id);
    const delegationIds = standaloneDelSessions.map((d) => d.id);

    const [offlineRecords, onlineRecords, delegationRecords] = await Promise.all([
      // Select DISTINCT (studentId, sessionId) — one row per student per session
      // regardless of how many attendance methods were used.
      // Uses cs.id as the canonical sessionId so it aligns with sessionObjects.
      // Exclude lectureRoom = 'ONLINE' sessions — those are handled via onlineRecords.
      offlineSessions.length > 0
        ? prisma.$queryRaw<{ studentId: string; sessionId: string }[]>(Prisma.sql`
            SELECT DISTINCT oar."studentId", cs."id" AS "sessionId"
            FROM "OfflineAttendanceRecord" oar
            INNER JOIN "ConductedSession" cs
              ON  UPPER(REPLACE(cs."unitCode", ' ', '')) = UPPER(REPLACE(oar."unitCode", ' ', ''))
              AND cs."sessionStart" = oar."sessionStart"
              AND cs."lecturerId"   = ${lecturerId}
              AND UPPER(cs."lectureRoom") != 'ONLINE'
            WHERE UPPER(REPLACE(oar."unitCode", ' ', '')) = ${unitCode}
          `)
        : Promise.resolve([] as { studentId: string; sessionId: string }[]),

      onlineSessionIds.length > 0
        ? prisma.onlineAttendanceRecord.findMany({
            where: { sessionId: { in: onlineSessionIds } },
            select: { studentId: true, sessionId: true },
          })
        : Promise.resolve([] as { studentId: string; sessionId: string }[]),

      // Delegation attendance: OfflineAttendanceRecord rows linked via delegationId
      // No method filter — count ALL attendance methods.
      delegationIds.length > 0
        ? prisma.offlineAttendanceRecord.findMany({
            where: { delegationId: { in: delegationIds } },
            select: { studentId: true, delegationId: true },
          })
        : Promise.resolve([] as { studentId: string; delegationId: string | null }[]),
    ]);

    // Build presence set: "${studentId}_${sessionId}" for O(1) lookup
    const presenceSet = new Set<string>();

    for (const r of offlineRecords) {
      presenceSet.add(`${r.studentId}_${r.sessionId}`);
    }

    for (const r of onlineRecords) {
      presenceSet.add(`${r.studentId}_${r.sessionId}`);
    }

    for (const r of delegationRecords) {
      if (!r.delegationId) continue;
      presenceSet.add(`${r.studentId}_${r.delegationId}`);
    }

    // Build grid rows — attendance[] is a boolean array aligned with sessionObjects;
    // records{} (keyed by sessionId) is kept for backward-compatibility.
    const students = enrolledStudents.map((s) => ({
      studentId:       s.studentId,
      admissionNumber: s.admissionNumber,
      name:            s.name,
      attendance: sessionObjects.map((sess) =>
        presenceSet.has(`${s.studentId}_${sess.sessionId}`)
      ),
      records: Object.fromEntries(
        sessionObjects.map((sess) => [
          sess.sessionId,
          presenceSet.has(`${s.studentId}_${sess.sessionId}`),
        ])
      ) as Record<string, boolean>,
    }));

    return NextResponse.json(
      { sessions: sessionObjects, students },
      { status: 200, headers: corsHeaders },
    );
  } catch (err: unknown) {
    console.error("[lecturer/units/attendance/grid] error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: corsHeaders },
    );
  }
}
