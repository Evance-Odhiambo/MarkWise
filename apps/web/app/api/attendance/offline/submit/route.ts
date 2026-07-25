import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
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

/** Canonical code form: uppercase, no spaces, no non-alphanumeric chars. */
function normaliseCode(code: string): string {
  return code.toUpperCase().replace(/\s+/g, "").replace(/[^A-Z0-9]/g, "");
}

function detectMethod(rawPayload: string): string {
  if (rawPayload.startsWith("MWQR0x01:") || rawPayload.startsWith("MWQR2:") || rawPayload.startsWith("MWQR1:")) return "qr";
  if (rawPayload.startsWith("MANUAL:")) return "manual";
  if (rawPayload.startsWith("MWBLE:"))  return "ble";
  if (rawPayload.startsWith("{"))       return "ble"; // legacy JSON BLE
  return "qr";
}

// POST /api/attendance/offline/submit
export async function POST(req: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────────
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

  // ── Parse body ──────────────────────────────────────────────────────────
  let body: {
    unitCode?: string;
    lectureRoom?: string;
    sessionStart?: number | string;
    scannedAt?: number | string;
    deviceId?: string | null;
    rawPayload?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ message: "Invalid JSON body" }, { status: 400, headers: corsHeaders });
  }

  const rawPayload = (body.rawPayload ?? null) || null;
  const deviceId   = body.deviceId || null;

  // ── Step 1: Normalise inputs ─────────────────────────────────────────────
  let unitCode    = normaliseCode(String(body.unitCode ?? ""));
  let lectureRoom = normaliseCode(body.lectureRoom ?? "");
  let sessionStart = Number(body.sessionStart ?? 0) || 0;
  const scannedAt  = Number(body.scannedAt ?? 0) || 0;

  // Fallback: parse session fields from rawPayload for legacy BLE JSON submissions
  if (rawPayload && (!unitCode || !lectureRoom || !sessionStart)) {
    if (rawPayload.startsWith("{")) {
      try {
        const parsed = JSON.parse(rawPayload) as Record<string, unknown>;
        if (!unitCode)      unitCode     = normaliseCode(String(parsed.unitCode ?? ""));
        if (!lectureRoom)   lectureRoom  = String(parsed.lectureRoom ?? "").trim().toUpperCase();
        if (!sessionStart)  sessionStart = parseInt(String(parsed.sessionStart ?? "0"), 10);
      } catch { /* leave fields empty */ }
    }
  }

  if (!unitCode || !lectureRoom || !sessionStart || !scannedAt) {
    return NextResponse.json(
      { message: "Missing or invalid session fields", reason: "MISSING_FIELDS" },
      { status: 422, headers: corsHeaders },
    );
  }

  const scannedAtDate = new Date(scannedAt);

  try {
    // sessionStart arrives in ms — normalise to second-precision ms for DB
    const normalisedStartMs = Math.floor(sessionStart / 1000) * 1000;

    // ── Step 2: Find session ─────────────────────────────────────────────
    const lectureRoomStripped = lectureRoom.replace(/\s+/g, "");
    const roomCandidates = new Set<string>([lectureRoom, lectureRoomStripped]);

    const matchedRoom = await prisma.room.findFirst({
      where: { OR: [{ roomCode: lectureRoom }, { roomCode: lectureRoomStripped }] },
      select: { name: true, roomCode: true },
    });
    if (matchedRoom) {
      roomCandidates.add(matchedRoom.name.trim().toUpperCase());
      roomCandidates.add(matchedRoom.roomCode.trim().toUpperCase());
    }

    const SESSION_TOLERANCE_MS = 10_000; // ±10 s per spec
    const session = await prisma.conductedSession.findFirst({
      where: {
        unitCode:     { in: [unitCode, unitCode.replace(/\s+/g, "")] },
        lectureRoom:  { in: Array.from(roomCandidates) },
        sessionStart: {
          gte: new Date(normalisedStartMs - SESSION_TOLERANCE_MS),
          lte: new Date(normalisedStartMs + SESSION_TOLERANCE_MS),
        },
      },
      select: {
        id: true, unitCode: true, lectureRoom: true, lessonType: true,
        sessionStart: true, sessionDuration: true,
        sessionKey: true, sessionNonce: true,
        bleUnitId: true, bleRoomId: true,
      },
      orderBy: { sessionStart: "desc" },
    });

    if (!session) {
      return NextResponse.json(
        { message: "Session not found", reason: "SESSION_NOT_FOUND" },
        { status: 404, headers: corsHeaders },
      );
    }

    const canonicalStart      = new Date(Math.floor(session.sessionStart.getTime() / 1000) * 1000);
    const canonicalLectureRoom = normaliseCode(session.lectureRoom);
    const canonicalUnitCode    = normaliseCode(session.unitCode);
    const method               = rawPayload ? detectMethod(rawPayload) : "ble";

    // ── Step 3: Verify student is enrolled in the unit ───────────────────
    const unitRecord = await prisma.unit.findFirst({
      where: { OR: [{ code: canonicalUnitCode }, { code: unitCode }] },
      select: { id: true },
    });
    if (unitRecord) {
      const enrolled = await prisma.enrollment.findFirst({
        where: { studentId, unitId: unitRecord.id },
        select: { id: true },
      });
      if (!enrolled) {
        return NextResponse.json(
          { message: "Not enrolled in this unit", reason: "NOT_ENROLLED" },
          { status: 403, headers: corsHeaders },
        );
      }
    }

    // ── Step 5: Duplicate check ──────────────────────────────────────────
    const existing = await prisma.offlineAttendanceRecord.findUnique({
      where: {
        studentId_unitCode_lectureRoom_sessionStart: {
          studentId,
          unitCode:     canonicalUnitCode,
          lectureRoom:  canonicalLectureRoom,
          sessionStart: canonicalStart,
        },
      },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json({ success: true, duplicate: true }, { status: 200, headers: corsHeaders });
    }

    // ── Step 6: Timestamp window — 2 h covers offline sync delay ─────────
    // scannedAt is client-supplied; the crypto counter check enforces real
    // scan-time accuracy. This guard limits how long a sync queue entry stays
    // actionable, reducing the blast radius of a compromised session key.
    const diffMs = Math.abs(scannedAtDate.getTime() - canonicalStart.getTime());
    if (diffMs > 2 * 3600 * 1000) {
      return NextResponse.json(
        { message: "Attendance window expired", reason: "WINDOW_EXPIRED" },
        { status: 422, headers: corsHeaders },
      );
    }

    // ── Step 7: Insert with verificationStatus = "pending" ───────────────
    const record = await prisma.offlineAttendanceRecord.create({
      data: {
        studentId,
        unitCode:           canonicalUnitCode,
        lectureRoom:        canonicalLectureRoom,
        lessonType:         session.lessonType ?? null,
        sessionStart:       canonicalStart,
        scannedAt:          scannedAtDate,
        deviceId:           deviceId ?? null,
        rawPayload:         rawPayload ?? null,
        method,
        conductedSessionId: session.id,
        verificationStatus: "pending",
      },
      select: { id: true },
    });

    // ── Step 8: Verify immediately if session key is already stored ───────
    if (session.sessionKey) {
      const attendanceSession: AttendanceSession = {
        sessionKey:      session.sessionKey,
        sessionNonce:    Number(session.sessionNonce),
        sessionStart:    Math.floor(session.sessionStart.getTime() / 1000),
        sessionDuration: session.sessionDuration,
        bleUnitId:       session.bleUnitId ?? null,
        bleRoomId:       session.bleRoomId ?? null,
      };
      const scannedAtSec = Math.floor(scannedAtDate.getTime() / 1000);
      const { status, reason } = verifyRawPayload(rawPayload, attendanceSession, scannedAtSec);

      await prisma.offlineAttendanceRecord.update({
        where: { id: record.id },
        data: { verificationStatus: status, rejectionReason: reason ?? null },
      });
    }

    return NextResponse.json(
      {
        recorded:            true,
        attendanceId:        record.id,
        pendingVerification: !session.sessionKey,
      },
      { status: 200, headers: corsHeaders },
    );
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === "P2002") {
      return NextResponse.json({ success: true, duplicate: true }, { status: 200, headers: corsHeaders });
    }
    console.error("[offline/submit] error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: corsHeaders });
  }
}
