import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyLecturerAccessToken } from "@/lib/lecturerAuthJwt";
import { verifyStudentAccessToken } from "@/lib/studentAuthJwt";
import { verifyRawPayload, type AttendanceSession } from "@/lib/attendanceCrypto";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

const VALID_LESSON_TYPES = new Set(["LEC", "GD", "RAT", "CAT", "LAB", "SEM", "WRK", "TUT", "PRE"]);

type SessionPayload = {
  unitCode: string;
  lectureRoom: string;
  lessonType?: string | null;
  lesson_type?: string | null;
  sessionStart: number;
  sessionDuration?: number | null;
  createdAt?: number | null;
  sessionKey?: string | null;   // 64-char hex — null if lecturer was offline at creation
  sessionNonce?: number | null; // uint32
};

/**
 * When a session key arrives for the first time, run verification on all
 * pending attendance records that were stored before the key synced.
 */
async function runDeferredVerification(
  sessionId: string,
  session: AttendanceSession,
): Promise<void> {
  const pending = await prisma.offlineAttendanceRecord.findMany({
    where: { conductedSessionId: sessionId, verificationStatus: "pending" },
    select: { id: true, rawPayload: true, scannedAt: true },
  });
  if (pending.length === 0) return;

  await Promise.all(
    pending.map((record) => {
      const scannedAtSec = Math.floor(record.scannedAt.getTime() / 1000);
      const { status, reason } = verifyRawPayload(record.rawPayload, session, scannedAtSec);
      return prisma.offlineAttendanceRecord.update({
        where: { id: record.id },
        data: {
          verificationStatus: status,
          rejectionReason:    reason ?? null,
        },
      });
    }),
  );
}

// POST /api/attendance/conducted-sessions/sync
export async function POST(req: NextRequest) {
  const token =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!token) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  // Accept lecturer or student JWTs
  let lecturerId: string | null = null;
  try {
    ({ lecturerId } = verifyLecturerAccessToken(token));
  } catch { /* try student token */ }
  if (!lecturerId) {
    let studentOk = false;
    try { verifyStudentAccessToken(token); studentOk = true; } catch { /* fall through */ }
    if (!studentOk) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: corsHeaders });
    }
  }

  let body: { sessions?: SessionPayload[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ message: "Invalid JSON body" }, { status: 422, headers: corsHeaders });
  }

  const { sessions } = body;
  if (!Array.isArray(sessions)) {
    return NextResponse.json({ message: "sessions must be an array" }, { status: 422, headers: corsHeaders });
  }
  if (sessions.length === 0) {
    return NextResponse.json({ synced: 0, skipped: 0 }, { headers: corsHeaders });
  }

  let synced = 0;
  let skipped = 0;

  for (const s of sessions) {
    const unitCode    = s.unitCode?.toUpperCase().replace(/\s+/g, "").replace(/[^A-Z0-9]/g, "");
    const lectureRoom = s.lectureRoom?.toUpperCase().replace(/\s+/g, "").replace(/[^A-Z0-9]/g, "");
    const rawMs       = s.sessionStart ? Math.floor(Number(s.sessionStart) / 1000) * 1000 : null;
    const sessionStart = rawMs ? new Date(rawMs) : null;

    const rawLessonType = (s.lessonType ?? s.lesson_type ?? null);
    const normalized    = rawLessonType ? String(rawLessonType).trim().toUpperCase() : null;
    const lessonType    = normalized && VALID_LESSON_TYPES.has(normalized) ? normalized : null;
    const sessionDuration = s.sessionDuration ? Math.max(60, Number(s.sessionDuration)) : 3600;

    if (!unitCode || !lectureRoom || !sessionStart || isNaN(sessionStart.getTime())) {
      skipped++; continue;
    }

    // Validate sessionKey format: must be exactly 64 lowercase hex chars if present
    const incomingKey   = (typeof s.sessionKey === "string" && /^[0-9a-f]{64}$/.test(s.sessionKey))
      ? s.sessionKey : null;
    const incomingNonce = (typeof s.sessionNonce === "number" && Number.isFinite(s.sessionNonce))
      ? Math.floor(s.sessionNonce) : null;

    try {
      // COALESCE: fetch existing so we can decide what to update without overwriting
      const existing = await prisma.conductedSession.findFirst({
        where: { unitCode, lectureRoom, sessionStart },
        select: { id: true, sessionKey: true, sessionNonce: true, bleUnitId: true, bleRoomId: true },
      });

      const hadKey    = !!existing?.sessionKey;
      // Only write key/nonce if incoming is non-null AND existing column is null
      const setKey    = incomingKey   != null && !existing?.sessionKey   ? incomingKey   : undefined;
      const setNonce  = incomingNonce != null && !existing?.sessionNonce ? BigInt(incomingNonce) : undefined;

      const upserted = await prisma.conductedSession.upsert({
        where: { unitCode_lectureRoom_sessionStart: { unitCode, lectureRoom, sessionStart } },
        update: {
          ...(lessonType ? { lessonType } : {}),
          ...(setKey     ? { sessionKey: setKey, sessionNonce: setNonce, sessionDuration } : {}),
        },
        create: {
          unitCode,
          lectureRoom,
          lessonType,
          sessionStart,
          sessionDuration,
          lecturerId:   lecturerId ?? "SYSTEM_STUB",
          createdAt:    s.createdAt ? new Date(s.createdAt) : new Date(),
          sessionKey:   incomingKey  ?? null,
          sessionNonce: incomingNonce != null ? BigInt(incomingNonce) : BigInt(0),
        },
        select: {
          id: true, sessionKey: true, sessionNonce: true,
          sessionStart: true, sessionDuration: true,
          bleUnitId: true, bleRoomId: true,
        },
      });
      synced++;

      // Trigger deferred verification if a key was stored for the first time
      if (!hadKey && upserted.sessionKey) {
        const attendanceSession: AttendanceSession = {
          sessionKey:      upserted.sessionKey,
          sessionNonce:    Number(upserted.sessionNonce),
          sessionStart:    Math.floor(upserted.sessionStart.getTime() / 1000),
          sessionDuration: upserted.sessionDuration,
          bleUnitId:       upserted.bleUnitId ?? null,
          bleRoomId:       upserted.bleRoomId ?? null,
        };
        // Fire-and-don't-block — verification updates happen asynchronously
        runDeferredVerification(upserted.id, attendanceSession).catch((err) =>
          console.error("[conducted-sessions/sync] deferred verification error:", err),
        );
      }
    } catch {
      skipped++;
    }
  }

  return NextResponse.json({ synced, skipped }, { headers: corsHeaders });
}
