/**
 * GET /api/lecturers/:lecturerId/units
 *
 * Returns the distinct units assigned to a lecturer (derived from timetable rows).
 * Auth: Bearer lecturer token — lecturers can only query their own units.
 */
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyLecturerAccessToken } from "@/lib/lecturerAuthJwt";
import { resolveAdminOrLecturerScope } from "@/lib/adminLecturerAuth";
import { normalizeUnitCode } from "@/lib/unitCode";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ lecturerId: string }> },
) {
  const { lecturerId: pathLecturerId } = await context.params;

  const token = (request.headers.get("authorization") ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  // Allow lecturer (self) or admin
  let resolvedLecturerId: string = pathLecturerId;
  try {
    const p = verifyLecturerAccessToken(token);
    // Lecturers may only request their own units
    if (p.lecturerId !== pathLecturerId) {
      // Allow if it's an admin token too
      const scope = resolveAdminOrLecturerScope(request);
      if (!scope.ok) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: corsHeaders });
      }
    }
    resolvedLecturerId = pathLecturerId;
  } catch {
    const scope = resolveAdminOrLecturerScope(request);
    if (!scope.ok) {
      return NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 401, headers: corsHeaders },
      );
    }
  }

  // Distinct units via timetable entries
  const timetableRows = await prisma.timetable.findMany({
    where: { lecturerId: resolvedLecturerId },
    include: { unitOffering: { select: { unitId: true, unit: true } } },
  });

  const seenUnitIds = new Set<string>();
  const units = timetableRows
    .filter((r) => {
      const unitId = r.unitOffering?.unit?.id;
      if (!unitId || seenUnitIds.has(unitId)) return false;
      seenUnitIds.add(unitId);
      return true;
    })
    .map((r) => ({
      unitId: r.unitOffering!.unit!.id,
      unit_code: normalizeUnitCode(r.unitOffering!.unit!.code),
      unit_name: r.unitOffering!.unit!.title,
    }));

  return NextResponse.json(units, { headers: corsHeaders });
}
