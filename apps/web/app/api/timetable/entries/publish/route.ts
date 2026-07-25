/**
 * POST /api/timetable/entries/publish
 *
 * Transitions one or more timetable entries from DRAFT → PUBLISHED and fires
 * FCM push notifications to enrolled students and the assigned lecturer.
 *
 * Body:
 *   entryIds   string[]  – list of timetable entry IDs to publish
 *
 * Auth: Admin JWT required.
 *
 * Response: { published: number, skipped: number, entryIds: string[] }
 * "skipped" counts entries that were already PUBLISHED or ARCHIVED.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveAdminScope } from "@/lib/adminScope";
import { sendFcmToTokens, getStudentTokensForUnit, getLecturerTokens } from "@/lib/fcm";
import { normalizeUnitCode } from "@/lib/unitCode";
import { DayOfWeek } from "@prisma/client";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

export async function POST(req: NextRequest) {
  const scope = await resolveAdminScope(req);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status, headers: corsHeaders });
  }

  let body: { entryIds?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400, headers: corsHeaders });
  }

  const { entryIds } = body;
  if (!Array.isArray(entryIds) || entryIds.length === 0) {
    return NextResponse.json({ error: "entryIds must be a non-empty array." }, { status: 400, headers: corsHeaders });
  }

  // Only transition entries that are still DRAFT
  const result = await prisma.timetable.updateMany({
    where: { id: { in: entryIds }, timetableStatus: "DRAFT" },
    data: { timetableStatus: "PUBLISHED" },
  });

  const published = result.count;
  const skipped   = entryIds.length - published;

  // Fire FCM notifications for the newly published entries (fire-and-forget)
  if (published > 0) {
    ;(async () => {
      try {
        const entries = await prisma.timetable.findMany({
          where: { id: { in: entryIds }, timetableStatus: "PUBLISHED" },
          select: {
            id: true,
            lecturerId: true,
            unitOffering: {
              select: {
                unitId: true,
                unit: { select: { code: true } },
              },
            },
            sharedSession: {
              select: {
                day: true,
                startMinute: true,
                endMinute: true,
                room: { select: { name: true } },
              },
            },
          },
        });

        await Promise.allSettled(
          entries.map(async (entry) => {
            const unitCode = normalizeUnitCode(entry.unitOffering?.unit?.code ?? "");
            if (!unitCode) return;

            const ss = entry.sharedSession;
            const day = ss ? (DOW_TO_STRING[ss.day] ?? ss.day) : "";
            const startTime = ss ? minutesToHHMM(ss.startMinute) : "";
            const endTime   = ss ? minutesToHHMM(ss.endMinute)   : "";
            const venueName = ss?.room?.name ?? "";
            const unitId = entry.unitOffering?.unitId ?? "";

            const fcmTitle = "New Timetable Entry";
            const fcmBody  = `${unitCode} — ${day} ${startTime}–${endTime}${venueName ? ` · ${venueName}` : ""}`;

            const [studentTokens, lecturerTokens] = await Promise.all([
              getStudentTokensForUnit(unitId),
              entry.lecturerId ? getLecturerTokens(entry.lecturerId) : Promise.resolve([]),
            ]);
            const allTokens = [...studentTokens, ...lecturerTokens];
            if (allTokens.length > 0) {
              await sendFcmToTokens(allTokens, "timetable_published", fcmTitle, fcmBody, {
                unitCode,
                entryId: entry.id,
                day,
                startTime,
              });
            }
          }),
        );
      } catch (err) {
        console.error("[timetable/entries/publish] FCM push error:", err);
      }
    })();
  }

  return NextResponse.json(
    { published, skipped, entryIds },
    { status: 200, headers: corsHeaders },
  );
}
