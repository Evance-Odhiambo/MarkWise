/**
 * POST /api/timetable/merge-lessons
 *
 * Merges multiple timetable entries into one shared physical session.
 * All entries are pointed to the same SharedSession with isMerged=true.
 *
 * Body:
 * {
 *   entryIds:    string[]   — IDs to merge (min 2)
 *   roomId?:     string     — room for the merged session (defaults to primary's room)
 *   campusId?:   string
 *   day?:        string     — "Monday" etc.
 *   startTime?:  string     — "HH:MM"
 *   endTime?:    string     — "HH:MM"
 *   note?:       string
 * }
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveAdminOrLecturerScope } from "@/lib/adminLecturerAuth";
import { normalizeUnitCode } from "@/lib/unitCode";
import { buildPayloadsForStudents, sendPushNotificationBatch } from "@/lib/pushNotification";
import { DayOfWeek } from "@prisma/client";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

function toMinutes(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export async function POST(req: NextRequest) {
  const scope = resolveAdminOrLecturerScope(req);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status, headers: corsHeaders });
  }
  const { role, userId } = scope;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400, headers: corsHeaders });
  }

  const { entryIds, roomId, campusId, day, startTime, endTime, note } = body ?? {};

  if (!Array.isArray(entryIds) || entryIds.length < 2) {
    return NextResponse.json(
      { error: "entryIds must be an array of at least 2 timetable entry IDs." },
      { status: 400, headers: corsHeaders },
    );
  }
  const ids: string[] = [...new Set((entryIds as unknown[]).map(String))];

  // Fetch entries with their SharedSessions
  const entries = await prisma.timetable.findMany({
    where: { id: { in: ids } },
    include: {
      sharedSession: { include: { room: true } },
      unitOffering: { include: { unit: true, course: true } },
    },
  });

  if (entries.length !== ids.length) {
    const found = new Set(entries.map((e) => e.id));
    const missing = ids.filter((id) => !found.has(id));
    return NextResponse.json(
      { error: `Timetable entries not found: ${missing.join(", ")}` },
      { status: 400, headers: corsHeaders },
    );
  }

  // Check none are already merged with different entries
  const alreadyMergedSessions = new Set(entries.map((e) => e.sharedSession?.id).filter(Boolean));
  if (alreadyMergedSessions.size > 1) {
    // Entries span multiple sessions — allow merging but only if they're not in different merges
    const mergedSessions = entries.filter((e) => e.sharedSession?.isMerged);
    if (mergedSessions.length > 0) {
      return NextResponse.json(
        { error: "One or more entries are already part of a merged session. Unmerge first." },
        { status: 409, headers: corsHeaders },
      );
    }
  }

  // Lecturer ownership check
  if (role === "lecturer") {
    const owned = entries.filter((e) => e.lecturerId === userId);
    if (owned.length === 0) {
      return NextResponse.json(
        { error: "You must own at least one entry to initiate a merge." },
        { status: 403, headers: corsHeaders },
      );
    }
  }

  // Resolve the merged session parameters
  // Use primary entry's SharedSession as base, override with body params
  const primaryEntry = entries[0]!;
  const primarySs = primaryEntry.sharedSession;

  const effectiveRoomId = (roomId as string | undefined) ?? primarySs?.roomId;
  if (!effectiveRoomId) {
    return NextResponse.json({ error: "roomId is required (or primary entry must have a room)." }, { status: 400, headers: corsHeaders });
  }

  const effectiveDayStr = (day as string | undefined) ?? (primarySs ? Object.entries(STRING_TO_DOW).find(([,v]) => v === primarySs.day)?.[0] : undefined);
  const effectiveDow: DayOfWeek | undefined = effectiveDayStr
    ? STRING_TO_DOW[effectiveDayStr.toLowerCase()]
    : primarySs?.day;
  if (!effectiveDow) {
    return NextResponse.json({ error: "day is required." }, { status: 400, headers: corsHeaders });
  }

  const effectiveStartMinute = (startTime as string | undefined)
    ? toMinutes(startTime as string)
    : primarySs?.startMinute;
  const effectiveEndMinute = (endTime as string | undefined)
    ? toMinutes(endTime as string)
    : primarySs?.endMinute;

  if (effectiveStartMinute == null || effectiveEndMinute == null) {
    return NextResponse.json({ error: "startTime and endTime are required." }, { status: 400, headers: corsHeaders });
  }

  // Resolve institution/campus
  const room = await prisma.room.findUnique({
    where: { id: effectiveRoomId },
    select: { institutionId: true, buildingFloor: { select: { building: { select: { campusId: true } } } } },
  });
  const resolvedCampusId = (campusId as string | undefined)
    ?? room?.buildingFloor?.building?.campusId
    ?? primarySs?.campusId;
  const resolvedInstId = room?.institutionId ?? primarySs?.institutionId ?? "";

  if (!resolvedCampusId) {
    // fall back to first campus in institution
    const c = await prisma.campus.findFirst({ where: { institutionId: resolvedInstId }, select: { id: true } });
    if (!c) return NextResponse.json({ error: "Cannot resolve campus." }, { status: 400, headers: corsHeaders });
  }

  try {
    const mergedSession = await prisma.$transaction(async (tx) => {
      // Create the new merged SharedSession
      const newSs = await tx.sharedSession.create({
        data: {
          institutionId: resolvedInstId,
          campusId: resolvedCampusId!,
          roomId: effectiveRoomId,
          lecturerId: role === "lecturer" ? userId : (primarySs?.lecturerId ?? null),
          day: effectiveDow,
          startMinute: effectiveStartMinute,
          endMinute: effectiveEndMinute,
          sessionType: primarySs?.sessionType ?? "LEC",
          isMerged: true,
        },
      });

      // Delete old individual SharedSessions that are now superseded
      const oldSessionIds = [...new Set(entries.map((e) => e.sharedSessionId).filter(Boolean))] as string[];
      // Point all entries to the merged session
      await tx.timetable.updateMany({
        where: { id: { in: ids } },
        data: { sharedSessionId: newSs.id },
      });

      // Clean up old sessions that have no more entries
      for (const oldId of oldSessionIds) {
        const remaining = await tx.timetable.count({ where: { sharedSessionId: oldId } });
        if (remaining === 0) {
          await tx.sharedSession.delete({ where: { id: oldId } });
        }
      }

      return newSs;
    });

    // Notify enrolled students (fire-and-forget)
    Promise.resolve().then(async () => {
      try {
        const unitCodes = [...new Set(
          entries.map((e) => e.unitOffering?.unit?.code ? normalizeUnitCode(e.unitOffering.unit.code) : null).filter(Boolean) as string[]
        )];
        const unitIds = [...new Set(entries.map((e) => e.unitOffering?.unitId).filter(Boolean))] as string[];
        if (!unitIds.length) return;

        const enrollments = await prisma.enrollment.findMany({
          where: { unitId: { in: unitIds } },
          select: { studentId: true },
        });
        const studentIds = [...new Set(enrollments.map((e) => e.studentId))];
        if (!studentIds.length) return;

        const payloads = await buildPayloadsForStudents(studentIds, {
          title: "Timetable Update — Classes Merged",
          body: `Your classes (${unitCodes.join(" / ")}) have been merged into a joint session.`,
          data: { type: "unit_merged", mergedSessionId: mergedSession.id, unitCodes: unitCodes.join(",") },
        });
        await sendPushNotificationBatch(payloads);
      } catch (err) {
        console.error("[merge-lessons] notification error:", err);
      }
    });

    return NextResponse.json(
      { success: true, mergedSessionId: mergedSession.id, message: "Lessons merged successfully.", mergedCount: ids.length },
      { status: 200, headers: corsHeaders },
    );
  } catch (err) {
    console.error("[merge-lessons] error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500, headers: corsHeaders });
  }
}
