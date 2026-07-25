/**
 * /api/timetable/extra-sessions
 *
 * POST  — create a make-up session (lecturer auth)
 * GET   — return all active extra sessions for the caller's unit codes
 *         (lecturer fetches by lecturerId; used internally — mine route below)
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyLecturerAccessToken } from "@/lib/lecturerAuthJwt";
import { buildPayloadsForStudents, sendPushNotificationBatch } from "@/lib/pushNotification";
import { normalizeUnitCode } from "@/lib/unitCode";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

const VALID_LESSON_TYPES = ["LEC", "TUT", "LAB", "SEM", "WRK", "CAT", "RAT", "PRE"] as const;

function extractLecturerId(req: NextRequest): string {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Unauthorized");
  const payload = verifyLecturerAccessToken(token);
  return payload.lecturerId;
}

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/timetable/extra-sessions
// ──────────────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  let lecturerIdFromJwt: string;
  try {
    lecturerIdFromJwt = extractLecturerId(req);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: corsHeaders });
  }

  const {
    unitCode,
    date: dateStr,
    startTime,
    endTime,
    roomCode,
    roomId,
    lessonType = "LEC",
    lecturerId: bodyLecturerId,
    mergedSessionId,
  } = body as {
    unitCode?: string;
    date?: string;
    startTime?: string;
    endTime?: string;
    roomCode?: string;
    roomId?: string;
    lessonType?: string;
    lecturerId?: string;
    mergedSessionId?: string;
  };

  // Use JWT identity; optionally body-supplied lecturerId is ignored for auth —
  // the lecturer can only create sessions for themselves.
  const lecturerId = lecturerIdFromJwt;
  void bodyLecturerId; // accepted in body for mobile client compatibility but not trusted

  // ── Validation ─────────────────────────────────────────────────────────────
  // unitCode is required only when not using mergedSessionId
  if (!mergedSessionId && (!unitCode || typeof unitCode !== "string" || !unitCode.trim())) {
    return NextResponse.json({ error: "unitCode is required" }, { status: 400, headers: corsHeaders });
  }
  if (!dateStr || typeof dateStr !== "string") {
    return NextResponse.json({ error: "date is required (YYYY-MM-DD)" }, { status: 400, headers: corsHeaders });
  }
  if (!startTime || typeof startTime !== "string" || !/^\d{1,2}:\d{2}$/.test(startTime.trim())) {
    return NextResponse.json({ error: "startTime is required in HH:MM format" }, { status: 400, headers: corsHeaders });
  }
  if (!endTime || typeof endTime !== "string" || !/^\d{1,2}:\d{2}$/.test(endTime.trim())) {
    return NextResponse.json({ error: "endTime is required in HH:MM format" }, { status: 400, headers: corsHeaders });
  }

  // Parse and validate date
  const sessionDate = new Date(dateStr.trim());
  if (isNaN(sessionDate.getTime())) {
    return NextResponse.json({ error: "date must be a valid ISO date (YYYY-MM-DD)" }, { status: 400, headers: corsHeaders });
  }
  // Compare date-only (strip time) against today
  const todayStr = new Date().toISOString().slice(0, 10);
  if (dateStr.trim() < todayStr) {
    return NextResponse.json({ error: "date must be today or in the future" }, { status: 400, headers: corsHeaders });
  }

  // Validate time order
  const toMinutes = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };
  if (toMinutes(endTime.trim()) <= toMinutes(startTime.trim())) {
    return NextResponse.json({ error: "endTime must be after startTime" }, { status: 400, headers: corsHeaders });
  }

  // Validate lessonType
  if (!VALID_LESSON_TYPES.includes(lessonType as (typeof VALID_LESSON_TYPES)[number])) {
    return NextResponse.json(
      { error: `lessonType must be one of: ${VALID_LESSON_TYPES.join(", ")}` },
      { status: 400, headers: corsHeaders },
    );
  }

  // ── Merged make-up path ───────────────────────────────────────────────────
  // When mergedSessionId is supplied (now a SharedSession id with isMerged=true),
  // create one ExtraSession per merged unit code and notify all enrolled students.
  if (mergedSessionId) {
    // Resolve via SharedSession (merged timetable entries share a SharedSession)
    const sharedSess = await prisma.sharedSession.findUnique({
      where: { id: mergedSessionId },
      select: {
        isMerged: true,
        room: { select: { roomCode: true, name: true } },
        timetables: {
          select: { unitOffering: { select: { unit: { select: { code: true } } } } },
        },
      },
    });

    if (!sharedSess) {
      return NextResponse.json({ error: "Merged session not found" }, { status: 404, headers: corsHeaders });
    }

    // Collect unit codes from linked timetable entries
    const rawCodes = [
      ...new Set(
        sharedSess.timetables
          .map((t) => t.unitOffering?.unit?.code)
          .filter((c): c is string => !!c)
          .map(normalizeUnitCode),
      ),
    ];
    // Fall back to body-supplied unitCode
    if (rawCodes.length === 0 && unitCode) rawCodes.push(normalizeUnitCode(unitCode));
    if (rawCodes.length === 0) {
      return NextResponse.json(
        { error: "No unit codes found for this merged session" },
        { status: 400, headers: corsHeaders },
      );
    }

    const effectiveRoomCode =
      (typeof roomCode === "string" && roomCode.trim() ? roomCode.trim() : null) ??
      sharedSess.room?.roomCode ?? null;
    const effectiveRoomId =
      typeof roomId === "string" && roomId.trim() ? roomId.trim() : null;

    const created: Record<string, unknown>[] = [];
    for (const code of rawCodes) {
      const session = await prisma.extraSession.create({
        data: {
          unitCode: normalizeUnitCode(code),
          lecturerId,
          date: sessionDate,
          startTime: startTime!.trim(),
          endTime: endTime!.trim(),
          roomCode: effectiveRoomCode,
          roomId: effectiveRoomId,
          lessonType,
        },
        select: {
          id: true, unitCode: true, date: true,
          startTime: true, endTime: true, roomCode: true,
          lessonType: true, lecturerId: true,
        },
      });
      created.push({ ...session, date: session.date.toISOString().slice(0, 10) });
    }

    const dateFmt = sessionDate.toISOString().slice(0, 10);
    const venueDisplay = effectiveRoomCode ?? "TBA";
    const displayCodes = rawCodes.map(c => normalizeUnitCode(c)).join(" / ");

    // Push notification to all students enrolled in any of the merged units
    (async () => {
      try {
        const normalizedCodes = rawCodes.map(c => normalizeUnitCode(c));
        const enrollments = await prisma.enrollment.findMany({
          where: { unit: { code: { in: normalizedCodes } } },
          select: { studentId: true },
        });
        const studentIds = [...new Set(enrollments.map(e => e.studentId))];
        if (studentIds.length === 0) return;
        const payloads = await buildPayloadsForStudents(studentIds, {
          title: `${displayCodes} — Make-Up Session Added`,
          body: `A make-up ${lessonType} for ${displayCodes} has been scheduled on ${dateFmt} at ${startTime}–${endTime}, Room ${venueDisplay}.`,
          data: {
            type: "EXTRA_SESSION",
            mergedSessionId,
            unitCodes: normalizedCodes.join(","),
            date: dateFmt,
            startTime: startTime!.trim(),
            endTime: endTime!.trim(),
            lessonType,
            roomCode: venueDisplay,
          },
        });
        await sendPushNotificationBatch(payloads);
      } catch (err) {
        console.error("[extra-sessions/POST] merged push error:", err);
      }
    })();

    return NextResponse.json(
      { success: true, message: "Merged make-up sessions created", data: created.map(s => ({ ...s, isExtraSession: true })) },
      { status: 201, headers: corsHeaders },
    );
  }
  // ── End merged make-up path ───────────────────────────────────────────────

  // Validate unitCode exists
  if (!unitCode) {
    return NextResponse.json({ error: "unitCode is required" }, { status: 400, headers: corsHeaders });
  }
  const normalisedCode = normalizeUnitCode(unitCode);
  const unit = await prisma.unit.findFirst({
    where: { OR: [{ code: normalisedCode }, { code: unitCode.trim().toUpperCase() }] },
    select: { id: true, title: true, code: true },
  });
  if (!unit) {
    return NextResponse.json({ error: `Unit "${unitCode}" not found` }, { status: 400, headers: corsHeaders });
  }

  // ── Create ──────────────────────────────────────────────────────────────────
  const session = await prisma.extraSession.create({
    data: {
      unitCode: normalizeUnitCode(unit.code),
      lecturerId,
      date: sessionDate,
      startTime: startTime.trim(),
      endTime: endTime.trim(),
      roomCode: typeof roomCode === "string" && roomCode.trim() ? roomCode.trim() : null,
      roomId: typeof roomId === "string" && roomId.trim() ? roomId.trim() : null,
      lessonType,
    },
    select: {
      id: true,
      unitCode: true,
      date: true,
      startTime: true,
      endTime: true,
      roomCode: true,
      lessonType: true,
      lecturerId: true,
    },
  });

  const dateFmt = session.date.toISOString().slice(0, 10);
  const venueDisplay = session.roomCode ?? "TBA";

  // ── Push notification to enrolled students (fire-and-forget) ───────────────
  const pushPromise = (async () => {
    try {
      const enrollments = await prisma.enrollment.findMany({
        where: { unit: { code: session.unitCode } },
        select: { studentId: true },
      });
      const studentIds = enrollments.map((e) => e.studentId);
      if (studentIds.length === 0) return;
      const payloads = await buildPayloadsForStudents(studentIds, {
        title: `${session.unitCode} — Make-Up Session Added`,
        body: `A make-up ${session.lessonType} for ${session.unitCode} has been scheduled on ${dateFmt} at ${session.startTime}–${session.endTime}, Room ${venueDisplay}.`,
        data: {
          type: "EXTRA_SESSION",
          sessionId: session.id,
          unitCode: session.unitCode,
          date: dateFmt,
          startTime: session.startTime,
          endTime: session.endTime,
          lessonType: session.lessonType,
          roomCode: venueDisplay,
        },
      });
      await sendPushNotificationBatch(payloads);
    } catch (err) {
      console.error("[extra-sessions/POST] push error:", err);
    }
  })();
  void pushPromise;

  return NextResponse.json(
    {
      success: true,
      data: {
        id: session.id,
        sessionId: session.id,
        unitCode: session.unitCode,
        date: dateFmt,
        startTime: session.startTime,
        endTime: session.endTime,
        roomCode: session.roomCode ?? null,
        lessonType: session.lessonType,
        lecturerId: session.lecturerId,
        isExtraSession: true,
      },
    },
    { status: 201, headers: corsHeaders },
  );
}
