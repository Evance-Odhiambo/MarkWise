/**
 * GET /api/lecturer/assignments/upcoming?days=14
 *
 * Returns assignments with dueDate in [now, now+days] across all units
 * taught by the authenticated lecturer, sorted ascending by dueDate.
 *
 * Auth: Bearer lecturer JWT
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyLecturerAccessToken } from "@/lib/lecturerAuthJwt";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET(req: NextRequest) {
  const token = (req.headers.get("authorization") ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }
  let lecturerId: string;
  try {
    ({ lecturerId } = verifyLecturerAccessToken(token));
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  const daysRaw = req.nextUrl.searchParams.get("days");
  const days = Math.min(Math.max(parseInt(daysRaw ?? "14", 10) || 14, 1), 90);

  const now = new Date();
  const until = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  try {
    const timetableUnits = await prisma.timetable.findMany({
      where: { lecturerId },
      include: { unitOffering: { select: { unitId: true } } },
    });
    const unitIds = [...new Set(timetableUnits.map((t) => t.unitOffering?.unitId).filter(Boolean) as string[])];

    if (unitIds.length === 0) {
      return NextResponse.json([], { headers: corsHeaders });
    }

    const [assignments, units] = await Promise.all([
      prisma.assignment.findMany({
        where: {
          lecturerId,
          unitId: { in: unitIds },
          dueDate: { gte: now, lte: until },
        },
        select: { id: true, title: true, type: true, dueDate: true, unitId: true },
        orderBy: { dueDate: "asc" },
        take: 20,
      }),
      prisma.unit.findMany({
        where: { id: { in: unitIds } },
        select: { id: true, code: true, title: true },
      }),
    ]);

    const unitMap = new Map(units.map((u) => [u.id, u]));

    const result = assignments.map((a) => {
      const unit = unitMap.get(a.unitId);
      return {
        id: a.id,
        unitCode: unit ? unit.code.replace(/\s+/g, "").toUpperCase() : "",
        unitName: unit?.title ?? "",
        title: a.title,
        dueAt: a.dueDate.toISOString(),
        type: a.type ?? "assignment",
      };
    });

    return NextResponse.json(result, { headers: corsHeaders });
  } catch (err: unknown) {
    console.error("[lecturer/assignments/upcoming] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: corsHeaders });
  }
}
