/**
 * GET /api/timetable/conflicts
 *
 * Pre-flight conflict check for timetable creators.
 *
 * Query params (all required unless noted):
 *   roomId       – target room
 *   day          – e.g. "Monday"
 *   startTime    – "09:00"
 *   endTime      – "11:00"
 *   unitId       – unit being scheduled
 *   lecturerId   – lecturer being assigned
 *   excludeId    – (optional) timetable entry id to exclude (use when editing)
 *
 * Response shape:
 * {
 *   roomConflict:     null | { id, unitCode, unitTitle, departmentName, lecturerName }
 *   lecturerConflict: null | { id, unitCode, roomName, departmentName }
 *   mergeCandidate:   null | { id, unitCode, departmentName, courseId, sharedSessionId }
 *   unitDuplicate:    null | { id, roomName, roomCode, departmentName }
 *   capacityWarning:  null | { enrolled: number, capacity: number }
 * }
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

const STRING_TO_DOW: Record<string, DayOfWeek> = {
  monday: "MON", tuesday: "TUE", wednesday: "WED",
  thursday: "THU", friday: "FRI", saturday: "SAT", sunday: "SUN",
  mon: "MON", tue: "TUE", wed: "WED", thu: "THU", fri: "FRI", sat: "SAT", sun: "SUN",
};

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function minutesToHHMM(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const roomId     = searchParams.get("roomId");
  const day        = searchParams.get("day");
  const startTime  = searchParams.get("startTime");
  const endTime    = searchParams.get("endTime");
  const unitId     = searchParams.get("unitId");
  const lecturerId = searchParams.get("lecturerId");
  const excludeId  = searchParams.get("excludeId") ?? undefined;

  if (!roomId || !day || !startTime || !endTime || !unitId || !lecturerId) {
    return NextResponse.json(
      { error: "roomId, day, startTime, endTime, unitId and lecturerId are required." },
      { status: 400, headers: corsHeaders },
    );
  }

  const dow = STRING_TO_DOW[day.toLowerCase()];
  if (!dow) {
    return NextResponse.json(
      { error: `Invalid day: ${day}` },
      { status: 400, headers: corsHeaders },
    );
  }

  const startMin = toMinutes(startTime);
  const endMin   = toMinutes(endTime);
  const overlapWhere = { startMinute: { lt: endMin }, endMinute: { gt: startMin } };
  const activeTimetableFilter = excludeId ? { some: { id: { not: excludeId } } } : { some: {} };

  const [roomSessions, lecturerSessions, room, enrollmentCount, unitSessions] = await Promise.all([
    // Room conflict: find sessions using this room at this time
    prisma.sharedSession.findMany({
      where: { roomId, day: dow, ...overlapWhere, timetables: activeTimetableFilter },
      include: {
        timetables: {
          where: excludeId ? { id: { not: excludeId } } : undefined,
          include: {
            unitOffering: {
              include: { unit: true, course: { include: { department: true } } },
            },
            lecturer: { select: { fullName: true } },
          },
          take: 1,
        },
        room: { select: { name: true, roomCode: true } },
      },
    }),
    // Lecturer conflict: find sessions with this lecturer at this time
    prisma.sharedSession.findMany({
      where: { lecturerId, day: dow, ...overlapWhere, timetables: activeTimetableFilter },
      include: {
        timetables: {
          where: excludeId ? { id: { not: excludeId } } : undefined,
          include: {
            unitOffering: { include: { unit: true } },
          },
          take: 1,
        },
        room: { select: { name: true, roomCode: true } },
      },
    }),
    prisma.room.findUnique({ where: { id: roomId }, select: { capacity: true } }),
    prisma.enrollment.count({ where: { unitId } }),
    // Unit duplicate: same unit scheduled in a different room at this time
    prisma.sharedSession.findMany({
      where: {
        day: dow,
        ...overlapWhere,
        roomId: { not: roomId },
        timetables: {
          some: {
            unitOffering: { unitId },
            ...(excludeId ? { id: { not: excludeId } } : {}),
          },
        },
      },
      include: {
        room: { select: { name: true, roomCode: true } },
        timetables: {
          where: {
            unitOffering: { unitId },
            ...(excludeId ? { id: { not: excludeId } } : {}),
          },
          include: {
            unitOffering: { include: { course: { include: { department: true } } } },
          },
          take: 1,
        },
      },
      take: 1,
    }),
  ]);

  // ── 1. Room conflicts & merge candidates ────────────────────────────────────
  let roomConflict: object | null = null;
  let mergeCandidate: object | null = null;

  for (const ss of roomSessions) {
    const timetable = ss.timetables[0];
    if (!timetable) continue;
    const tUnitId = timetable.unitOffering?.unitId;

    if (tUnitId === unitId) {
      mergeCandidate = {
        id: timetable.id,
        sharedSessionId: ss.id,
        unitCode: timetable.unitOffering?.unit?.code ?? null,
        unitTitle: timetable.unitOffering?.unit?.title ?? null,
        courseId: timetable.unitOffering?.courseId ?? null,
        departmentName: timetable.unitOffering?.course?.department?.name ?? null,
      };
    } else {
      roomConflict = {
        id: timetable.id,
        unitCode: timetable.unitOffering?.unit?.code ?? null,
        unitTitle: timetable.unitOffering?.unit?.title ?? null,
        departmentName: timetable.unitOffering?.course?.department?.name ?? null,
        lecturerName: timetable.lecturer?.fullName ?? null,
        startTime: minutesToHHMM(ss.startMinute),
        endTime: minutesToHHMM(ss.endMinute),
      };
      break;
    }
  }

  // ── 2. Lecturer conflicts ────────────────────────────────────────────────────
  let lecturerConflict: object | null = null;

  for (const ss of lecturerSessions) {
    if (ss.roomId === roomId) continue; // already handled in room conflict check
    const timetable = ss.timetables[0];
    if (!timetable) continue;
    lecturerConflict = {
      id: timetable.id,
      unitCode: timetable.unitOffering?.unit?.code ?? null,
      unitTitle: timetable.unitOffering?.unit?.title ?? null,
      roomName: ss.room?.name ?? null,
      roomCode: ss.room?.roomCode ?? null,
      startTime: minutesToHHMM(ss.startMinute),
      endTime: minutesToHHMM(ss.endMinute),
    };
    break;
  }

  // ── 3. Unit duplicate in another room ────────────────────────────────────────
  let unitDuplicate: object | null = null;

  if (unitSessions.length > 0) {
    const ss = unitSessions[0]!;
    const timetable = ss.timetables[0];
    unitDuplicate = {
      id: timetable?.id ?? null,
      roomName: ss.room?.name ?? null,
      roomCode: ss.room?.roomCode ?? null,
      departmentName: timetable?.unitOffering?.course?.department?.name ?? null,
      startTime: minutesToHHMM(ss.startMinute),
      endTime: minutesToHHMM(ss.endMinute),
    };
  }

  // ── 4. Capacity warning ──────────────────────────────────────────────────────
  let capacityWarning: object | null = null;
  if (room && enrollmentCount > room.capacity) {
    capacityWarning = { enrolled: enrollmentCount, capacity: room.capacity };
  }

  return NextResponse.json(
    { roomConflict, lecturerConflict, mergeCandidate, unitDuplicate, capacityWarning },
    { headers: corsHeaders },
  );
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}
