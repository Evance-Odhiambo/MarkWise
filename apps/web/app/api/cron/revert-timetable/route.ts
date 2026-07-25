/**
 * GET /api/cron/revert-timetable
 *
 * Intended to run every Friday at 23:59 (cron: "59 23 * * 5").
 * Reverts all timetable entries that were temporarily rescheduled
 * back to their original SharedSession and resets status to PUBLISHED.
 */
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth.replace(/^Bearer\s+/i, "").trim() !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const targets = await prisma.timetable.findMany({
      where: {
        timetableStatus: "RESCHEDULED",
        originalSharedSessionId: { not: null },
      },
      select: {
        id: true,
        sharedSessionId: true,
        originalSharedSessionId: true,
      },
    });

    if (targets.length === 0) {
      return NextResponse.json({ reverted: 0, message: "Nothing to revert." });
    }

    for (const t of targets) {
      await prisma.$transaction(async (tx) => {
        // Clean up temp SharedSession if no other entries use it
        if (t.sharedSessionId && t.sharedSessionId !== t.originalSharedSessionId) {
          const others = await tx.timetable.count({
            where: { sharedSessionId: t.sharedSessionId, id: { not: t.id } },
          });
          if (others === 0) {
            await tx.sharedSession.delete({ where: { id: t.sharedSessionId } });
          }
        }
        await tx.timetable.update({
          where: { id: t.id },
          data: {
            timetableStatus: "PUBLISHED",
            sharedSessionId: t.originalSharedSessionId,
            originalSharedSessionId: null,
            reason: null,
          },
        });
      });
    }

    console.log(`[cron/revert-timetable] Reverted ${targets.length} temporary reschedule(s).`);
    return NextResponse.json({ reverted: targets.length, ids: targets.map((t) => t.id) });
  } catch (err) {
    console.error("[cron/revert-timetable] error:", err);
    return NextResponse.json({ error: "Revert job failed." }, { status: 500 });
  }
}
