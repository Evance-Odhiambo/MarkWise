/**
 * GET /api/timetable/merge-suggestions
 *
 * Detects timetable entries that could benefit from being merged:
 * 1. sameRoomCandidates: entries with same unit, same SharedSession room/day/time
 *    but different courses — natural joint-class candidates.
 * 2. duplicateTimeCandidates: entries with same unit, same day, overlapping time
 *    but in different rooms — possible lecturer/unit duplicates.
 *
 * Query params:
 *   institutionId – required
 *   departmentId  – optional
 *   unitId        – optional
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { DayOfWeek, TimetableStatus } from "@prisma/client";
import { normalizeUnitCode } from "@/lib/unitCode";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const DOW_TO_STRING: Record<DayOfWeek, string> = {
  MON: "Monday", TUE: "Tuesday", WED: "Wednesday",
  THU: "Thursday", FRI: "Friday", SAT: "Saturday", SUN: "Sunday",
};

function minutesToHHMM(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const institutionId = searchParams.get("institutionId");
  const departmentId  = searchParams.get("departmentId") ?? undefined;
  const unitIdFilter  = searchParams.get("unitId") ?? undefined;

  if (!institutionId) {
    return NextResponse.json({ error: "institutionId is required." }, { status: 400, headers: corsHeaders });
  }

  const ACTIVE_STATUSES: TimetableStatus[] = ["PUBLISHED", "DRAFT"];

  // Fetch active timetable entries scoped to this institution
  const entries = await prisma.timetable.findMany({
    where: {
      timetableStatus: { in: ACTIVE_STATUSES },
      sharedSession: { institutionId },
      ...(departmentId ? { unitOffering: { course: { departmentId } } } : {}),
      ...(unitIdFilter ? { unitOffering: { unitId: unitIdFilter } } : {}),
    },
    include: {
      unitOffering: {
        include: {
          unit: { select: { id: true, code: true, title: true } },
          course: { select: { id: true, name: true, department: { select: { id: true, name: true } } } },
        },
      },
      sharedSession: {
        include: { room: { select: { id: true, name: true, roomCode: true } } },
      },
    },
  });

  // ── 1. sameRoomCandidates ────────────────────────────────────────────────────
  // SharedSessions with isMerged=false that have multiple entries from different courses
  // OR pairs of entries whose sessions overlap in the same room for the same unit.

  // Group by sharedSessionId
  const bySession = new Map<string, typeof entries>();
  for (const e of entries) {
    if (!e.sharedSessionId || e.sharedSession?.isMerged) continue;
    const key = e.sharedSessionId;
    const group = bySession.get(key) ?? [];
    group.push(e);
    bySession.set(key, group);
  }

  const sameRoomCandidates = [];
  for (const [, group] of bySession) {
    if (group.length < 2) continue;
    // Check multiple distinct courses with same unit
    const unitIds = new Set(group.map(e => e.unitOffering?.unitId).filter(Boolean));
    const courseIds = new Set(group.map(e => e.unitOffering?.courseId).filter(Boolean));
    if (unitIds.size !== 1 || courseIds.size < 2) continue;

    const firstEntry = group[0]!;
    const ss = firstEntry.sharedSession!;
    sameRoomCandidates.push({
      sharedSessionId: firstEntry.sharedSessionId,
      unitCode: normalizeUnitCode(firstEntry.unitOffering?.unit?.code ?? ""),
      unitTitle: firstEntry.unitOffering?.unit?.title ?? "",
      day: DOW_TO_STRING[ss.day] ?? ss.day,
      room: ss.room ? { name: ss.room.name, roomCode: ss.room.roomCode } : null,
      entries: group.map(e => ({
        id: e.id,
        courseId: e.unitOffering?.courseId ?? null,
        courseName: e.unitOffering?.course?.name ?? "",
        departmentId: e.unitOffering?.course?.department?.id ?? null,
        departmentName: e.unitOffering?.course?.department?.name ?? "",
        startTime: minutesToHHMM(ss.startMinute),
        endTime: minutesToHHMM(ss.endMinute),
      })),
    });
  }

  // ── 2. duplicateTimeCandidates ───────────────────────────────────────────────
  // Entries with same unit, same day, overlapping time but in DIFFERENT rooms

  type EntryWithSs = (typeof entries)[number] & { sharedSession: NonNullable<(typeof entries)[number]["sharedSession"]> };
  const withSession = entries.filter((e): e is EntryWithSs => !!e.sharedSession);

  // Group by (unitId, day)
  const byUnitDay = new Map<string, EntryWithSs[]>();
  for (const e of withSession) {
    const unitId = e.unitOffering?.unitId;
    if (!unitId) continue;
    const key = `${unitId}|${e.sharedSession.day}`;
    const group = byUnitDay.get(key) ?? [];
    group.push(e);
    byUnitDay.set(key, group);
  }

  const duplicateTimeCandidates = [];
  for (const [, group] of byUnitDay) {
    if (group.length < 2) continue;
    const roomSet = new Set(group.map(e => e.sharedSession.roomId));
    if (roomSet.size < 2) continue;

    // Check that at least two entries from different rooms overlap in time
    let hasOverlap = false;
    outer: for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i]!.sharedSession;
        const b = group[j]!.sharedSession;
        if (a.roomId !== b.roomId && a.startMinute < b.endMinute && a.endMinute > b.startMinute) {
          hasOverlap = true;
          break outer;
        }
      }
    }
    if (!hasOverlap) continue;

    const firstEntry = group[0]!;
    duplicateTimeCandidates.push({
      unitCode: normalizeUnitCode(firstEntry.unitOffering?.unit?.code ?? ""),
      unitTitle: firstEntry.unitOffering?.unit?.title ?? "",
      day: DOW_TO_STRING[firstEntry.sharedSession.day] ?? firstEntry.sharedSession.day,
      entries: group.map(e => ({
        id: e.id,
        courseId: e.unitOffering?.courseId ?? null,
        courseName: e.unitOffering?.course?.name ?? "",
        departmentId: e.unitOffering?.course?.department?.id ?? null,
        departmentName: e.unitOffering?.course?.department?.name ?? "",
        room: e.sharedSession.room ? { name: e.sharedSession.room.name, roomCode: e.sharedSession.room.roomCode } : null,
        startTime: minutesToHHMM(e.sharedSession.startMinute),
        endTime: minutesToHHMM(e.sharedSession.endMinute),
      })),
    });
  }

  return NextResponse.json(
    { sameRoomCandidates, duplicateTimeCandidates },
    { headers: corsHeaders },
  );
}
