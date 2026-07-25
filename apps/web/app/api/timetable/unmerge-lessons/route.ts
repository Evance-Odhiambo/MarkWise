/**
 * POST /api/timetable/unmerge-lessons
 *
 * Unmerges a merged SharedSession: each entry gets its own independent SharedSession.
 *
 * Body:
 * {
 *   sharedSessionId: string   — the merged SharedSession ID
 *   unitCode?:       string   — for response labelling only
 * }
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveAdminOrLecturerScope } from "@/lib/adminLecturerAuth";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
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

  const { sharedSessionId, unitCode } = body ?? {};

  if (!sharedSessionId || typeof sharedSessionId !== "string") {
    return NextResponse.json({ error: "sharedSessionId is required." }, { status: 400, headers: corsHeaders });
  }

  const sessionId = sharedSessionId.trim();

  try {
    // Fetch the merged SharedSession
    const mergedSs = await prisma.sharedSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true, isMerged: true, institutionId: true, campusId: true,
        day: true, startMinute: true, endMinute: true, sessionType: true,
        timetables: {
          select: { id: true, lecturerId: true },
        },
      },
    });

    if (!mergedSs) {
      return NextResponse.json({ error: "Shared session not found." }, { status: 404, headers: corsHeaders });
    }

    if (!mergedSs.isMerged) {
      return NextResponse.json({ error: "This session is not merged." }, { status: 400, headers: corsHeaders });
    }

    // Permission: lecturer must own at least one entry
    if (role === "lecturer") {
      const owns = mergedSs.timetables.some((e) => e.lecturerId === userId);
      if (!owns) {
        return NextResponse.json(
          { error: "You do not own any of the timetable entries in this merged session." },
          { status: 403, headers: corsHeaders },
        );
      }
    }

    if (mergedSs.timetables.length === 0) {
      // Nothing to unmerge — just delete the orphaned session
      await prisma.sharedSession.delete({ where: { id: sessionId } });
      return NextResponse.json({ success: true, message: "Orphaned merged session removed." }, { headers: corsHeaders });
    }

    // Create individual SharedSessions for each entry, then delete the merged one
    await prisma.$transaction(async (tx) => {
      for (const entry of mergedSs.timetables) {
        // Find the room for this entry's lecturer (look for any non-merged session with same lecturer/time)
        // For simplicity, keep the same room/time — admin can edit afterward if needed
        const newSs = await tx.sharedSession.create({
          data: {
            institutionId: mergedSs.institutionId,
            campusId: mergedSs.campusId,
            // reuse the merged session's room for all entries — admin can reassign
            roomId: (await tx.sharedSession.findUnique({ where: { id: sessionId }, select: { roomId: true } }))!.roomId,
            lecturerId: entry.lecturerId,
            day: mergedSs.day,
            startMinute: mergedSs.startMinute,
            endMinute: mergedSs.endMinute,
            sessionType: mergedSs.sessionType,
            isMerged: false,
          },
        });
        await tx.timetable.update({
          where: { id: entry.id },
          data: { sharedSessionId: newSs.id },
        });
      }
      // Delete the merged SharedSession
      await tx.sharedSession.delete({ where: { id: sessionId } });
    });

    return NextResponse.json(
      {
        success: true,
        message: "Session unmerged successfully.",
        unitCode: typeof unitCode === "string" ? unitCode.trim().toUpperCase() : undefined,
      },
      { status: 200, headers: corsHeaders },
    );
  } catch (err) {
    console.error("[unmerge-lessons] error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500, headers: corsHeaders });
  }
}
