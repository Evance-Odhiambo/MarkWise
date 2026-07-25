import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyLecturerAccessToken } from "@/lib/lecturerAuthJwt";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-lecturer-id",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

export async function GET(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  let lecturerId: string;
  try {
    ({ lecturerId } = verifyLecturerAccessToken(token));
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  // Also accept explicit header override (e.g. from devices that send both)
  const headerLecturerId = req.headers.get("x-lecturer-id");
  if (headerLecturerId) lecturerId = headerLecturerId;

  // Find distinct units assigned to this lecturer via Timetable rows
  const timetableRows = await prisma.timetable.findMany({
    where: { lecturerId },
    include: { unitOffering: { select: { unitId: true, unit: true } } },
  });

  // Deduplicate by unit code (same unit may appear in multiple timetable rows)
  const seen = new Set<string>();
  const units: { unit_code: string; unitCode: string; unit_name: string; unitName: string }[] = [];

  for (const row of timetableRows) {
    const unit = row.unitOffering?.unit;
    if (!unit) continue;
    const { code, title } = unit;
    if (seen.has(code)) continue;
    seen.add(code);
    units.push({ unit_code: code, unitCode: code, unit_name: title, unitName: title });
  }

  return NextResponse.json(units, { headers: corsHeaders });
}
