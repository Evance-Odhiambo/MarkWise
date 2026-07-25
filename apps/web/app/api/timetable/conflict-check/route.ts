/**
 * GET /api/timetable/conflict-check
 *
 * Fast integer-based conflict checker using SharedSession.
 * Queries day/startMinute/endMinute indexes on SharedSession.
 *
 * Query params:
 *   lecturerId   – lecturer to check
 *   roomId       – room to check
 *   day          – day string ("Monday" etc.) or DayOfWeek enum ("MON")
 *   startMinute  – integer minutes from midnight
 *   endMinute    – integer minutes from midnight
 *   excludeId    – (optional) timetable entry id to exclude
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

function parseDow(s: string): DayOfWeek | null {
  return STRING_TO_DOW[s.toLowerCase()] ?? null;
}

function minutesToHHMM(m: number) {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const lecturerId  = searchParams.get("lecturerId");
  const roomId      = searchParams.get("roomId");
  const dayStr      = searchParams.get("day");
  const startStr    = searchParams.get("startMinute");
  const endStr      = searchParams.get("endMinute");
  const excludeId   = searchParams.get("excludeId") ?? undefined;

  if (!lecturerId || !roomId || !dayStr || !startStr || !endStr) {
    return NextResponse.json(
      { error: "lecturerId, roomId, day, startMinute, and endMinute are required." },
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

  const dow = parseDow(dayStr);
  if (!dow) {
    return NextResponse.json({ error: `Invalid day: ${dayStr}` }, { status: 400, headers: corsHeaders });
  }

  // Overlap: A.start < B.end AND A.end > B.start
  const overlapWhere = { startMinute: { lt: endMinute }, endMinute: { gt: startMinute } };

  // A SharedSession causes a conflict only when at least one active Timetable entry points to it.
  // Cancelled/Online entries have sharedSessionId=null so they never appear here.
  const activeEntriesFilter = excludeId
    ? { timetables: { some: { id: { not: excludeId } } } }
    : { timetables: { some: {} } };

  const [lecturerConflict, roomConflict] = await Promise.all([
    prisma.sharedSession.findFirst({
      where: { lecturerId, day: dow, ...overlapWhere, ...activeEntriesFilter },
      select: {
        id: true, day: true, startMinute: true, endMinute: true,
        room: { select: { name: true, roomCode: true } },
        timetables: {
          take: 1,
          select: {
            unitOffering: { select: { unit: { select: { code: true, title: true } } } },
          },
        },
      },
    }),
    prisma.sharedSession.findFirst({
      where: { roomId, day: dow, ...overlapWhere, ...activeEntriesFilter },
      select: {
        id: true, day: true, startMinute: true, endMinute: true, lecturerId: true,
        room: { select: { name: true, roomCode: true } },
        timetables: {
          take: 1,
          select: {
            unitOffering: { select: { unit: { select: { code: true, title: true } } } },
            lecturer: { select: { fullName: true } },
          },
        },
      },
    }),
  ]);

  const formatConflict = (ss: typeof lecturerConflict) => {
    if (!ss) return null;
    const entry = ss.timetables[0];
    return {
      id: ss.id,
      startTime: minutesToHHMM(ss.startMinute),
      endTime: minutesToHHMM(ss.endMinute),
      startMinute: ss.startMinute,
      endMinute: ss.endMinute,
      room: ss.room,
      unit: entry?.unitOffering?.unit ?? null,
    };
  };

  return NextResponse.json(
    {
      lecturerConflict: formatConflict(lecturerConflict),
      roomConflict: formatConflict(roomConflict),
      hasConflict: !!(lecturerConflict || roomConflict),
    },
    { headers: corsHeaders },
  );
}
