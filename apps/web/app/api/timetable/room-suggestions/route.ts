/**
 * GET /api/timetable/room-suggestions
 *
 * Returns available rooms for a given day/time slot, ranked by capacity fit.
 * Conflicts are detected via SharedSession (not Timetable directly).
 *
 * Query params:
 *   institutionId – required
 *   day           – required; e.g. "Monday" or "MON"
 *   startMinute   – required; integer minutes from midnight
 *   endMinute     – required; integer minutes from midnight
 *   enrolledCount – optional; for ranking
 *   roomType      – optional; filter by room type
 *   excludeId     – optional; timetable entry id to exclude from conflict check
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { DayOfWeek } from "@prisma/client";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

const STRING_TO_DOW: Record<string, DayOfWeek> = {
  monday: "MON", tuesday: "TUE", wednesday: "WED",
  thursday: "THU", friday: "FRI", saturday: "SAT", sunday: "SUN",
  mon: "MON", tue: "TUE", wed: "WED", thu: "THU", fri: "FRI", sat: "SAT", sun: "SUN",
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const institutionId = searchParams.get("institutionId");
  const dayStr        = searchParams.get("day");
  const startStr      = searchParams.get("startMinute");
  const endStr        = searchParams.get("endMinute");
  const enrolledStr   = searchParams.get("enrolledCount");
  const roomType      = searchParams.get("roomType") ?? undefined;
  const excludeId     = searchParams.get("excludeId") ?? undefined;

  if (!institutionId || !dayStr || !startStr || !endStr) {
    return NextResponse.json(
      { error: "institutionId, day, startMinute, and endMinute are required." },
      { status: 400, headers: corsHeaders },
    );
  }

  const startMinute = parseInt(startStr, 10);
  const endMinute   = parseInt(endStr, 10);
  if (isNaN(startMinute) || isNaN(endMinute) || startMinute >= endMinute) {
    return NextResponse.json(
      { error: "startMinute and endMinute must be valid integers with startMinute < endMinute." },
      { status: 400, headers: corsHeaders },
    );
  }

  const dow = STRING_TO_DOW[dayStr.toLowerCase()];
  if (!dow) {
    return NextResponse.json({ error: `Invalid day: ${dayStr}` }, { status: 400, headers: corsHeaders });
  }

  const enrolled = enrolledStr ? parseInt(enrolledStr, 10) : null;

  const activeEntriesFilter = excludeId
    ? { timetables: { some: { id: { not: excludeId } } } }
    : { timetables: { some: {} } };

  const [allRooms, conflictedSessions] = await Promise.all([
    prisma.room.findMany({
      where: {
        institutionId,
        isActive: true,
        status: { in: ["free", "reserved"] },
        ...(roomType ? { type: roomType } : {}),
      },
      select: {
        id: true, name: true, roomCode: true, buildingCode: true,
        capacity: true, type: true, floor: true,
      },
      orderBy: [{ buildingCode: "asc" }, { floor: "asc" }, { roomCode: "asc" }],
    }),
    // Rooms occupied by active SharedSessions during this slot
    prisma.sharedSession.findMany({
      where: {
        day: dow,
        startMinute: { lt: endMinute },
        endMinute:   { gt: startMinute },
        ...activeEntriesFilter,
      },
      select: { roomId: true },
    }),
  ]);

  const conflictedRoomIds = new Set(conflictedSessions.map((s) => s.roomId));
  const available = allRooms.filter((r) => !conflictedRoomIds.has(r.id));

  type FitLabel = "exact" | "ok" | "large" | "full";

  function fitLabel(capacity: number): FitLabel {
    if (enrolled == null) return "ok";
    if (enrolled > capacity) return "full";
    if (enrolled >= capacity * 0.8) return "exact";
    if (enrolled >= capacity * 0.4) return "ok";
    return "large";
  }

  const fitOrder: Record<FitLabel, number> = { exact: 0, ok: 1, large: 2, full: 3 };
  const rooms = available
    .map((r) => ({ ...r, fit: fitLabel(r.capacity) }))
    .sort((a, b) => {
      const diff = fitOrder[a.fit] - fitOrder[b.fit];
      return diff !== 0 ? diff : a.capacity - b.capacity;
    });

  return NextResponse.json({ rooms }, { headers: corsHeaders });
}
