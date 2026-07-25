/**
 * GET /api/students/:studentId/units
 *
 * Returns the units a student is enrolled in.
 * Auth: Bearer student token — students can only query their own units.
 */
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyStudentAccessToken } from "@/lib/studentAuthJwt";
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
  context: { params: Promise<{ id: string }> },
) {
  const { id: pathStudentId } = await context.params;

  const token = (request.headers.get("authorization") ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  let studentId: string;
  try {
    const p = verifyStudentAccessToken(token);
    // Students may only request their own units
    if (p.studentId !== pathStudentId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: corsHeaders });
    }
    studentId = p.studentId;
  } catch {
    return NextResponse.json(
      { error: "Invalid or expired token" },
      { status: 401, headers: corsHeaders },
    );
  }

  const enrollments = await prisma.enrollment.findMany({
    where: { studentId },
    include: { unit: { select: { id: true, code: true, title: true } } },
  });

  const units = enrollments.map((e) => ({
    unitId: e.unit.id,
    unit_code: normalizeUnitCode(e.unit.code),
    unit_name: e.unit.title,
  }));

  return NextResponse.json(units, { headers: corsHeaders });
}
