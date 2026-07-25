/**
 * GET /api/student/sessions/active
 *
 * Returns ConductedSessions for the student's enrolled units that started
 * within the past 24 hours or are starting within the next 4 hours.
 * Used by mobile devices to pre-sync session metadata before class so they
 * can verify BLE beacons and QR nonces offline.
 *
 * sessionKey is NEVER included in this response — students only receive
 * the nonce and schedule metadata.
 *
 * Auth: Student JWT (Authorization: Bearer <token>).
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyStudentAccessToken } from "@/lib/studentAuthJwt";
import { normalizeUnitCode } from "@/lib/unitCode";

export const runtime = "nodejs";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors });
}

export async function GET(req: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────────
  const rawToken = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!rawToken) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401, headers: cors });
  }
  let studentId: string;
  try {
    ({ studentId } = verifyStudentAccessToken(rawToken));
  } catch {
    return NextResponse.json({ error: "Invalid or expired token." }, { status: 401, headers: cors });
  }

  // ── Enrolled unit codes ─────────────────────────────────────────────────
  const enrollments = await prisma.enrollment.findMany({
    where: { studentId },
    select: { unit: { select: { code: true } } },
  });

  if (enrollments.length === 0) {
    return NextResponse.json({ sessions: [] }, { headers: cors });
  }

  // Build both canonical and normalised forms to match ConductedSession storage
  const rawCodes  = enrollments.map(e => e.unit.code);
  const normCodes = rawCodes.map(c => normalizeUnitCode(c));
  const allCodes  = [...new Set([...rawCodes, ...normCodes])];

  // ── Query sessions ──────────────────────────────────────────────────────
  const now = new Date();
  const windowStart = new Date(now.getTime() - 24 * 3600 * 1000); // past 24 h
  const windowEnd   = new Date(now.getTime() +  4 * 3600 * 1000); // next 4 h

  const sessions = await prisma.conductedSession.findMany({
    where: {
      unitCode:     { in: allCodes },
      sessionStart: { gte: windowStart, lte: windowEnd },
      sessionNonce: { not: BigInt(0) },  // only mwv1 sessions with crypto fields
    },
    select: {
      id:              true,
      unitCode:        true,
      lectureRoom:     true,
      lessonType:      true,
      sessionStart:    true,
      sessionDuration: true,
      sessionNonce:    true,
      bleUnitId:       true,
      bleRoomId:       true,
    },
    orderBy: { sessionStart: "asc" },
  });

  const payload = sessions.map(s => ({
    sessionId:       s.id,
    unitCode:        s.unitCode,
    lectureRoom:     s.lectureRoom,
    lessonType:      s.lessonType ?? "LEC",
    sessionStart:    Math.floor(s.sessionStart.getTime() / 1000), // Unix seconds
    sessionDuration: s.sessionDuration,
    sessionNonce:    Number(s.sessionNonce),                       // uint32
    unitId:          s.bleUnitId ?? null,
    roomId:          s.bleRoomId ?? null,
  }));

  return NextResponse.json(
    { sessions: payload },
    {
      status: 200,
      headers: {
        ...cors,
        "Cache-Control": "private, max-age=30",
      },
    },
  );
}
