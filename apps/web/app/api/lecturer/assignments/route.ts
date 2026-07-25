/**
 * GET /api/lecturer/assignments
 *
 * Returns all assignments created by the authenticated lecturer.
 * Optional query params:
 *   ?unitId=<id|code>   — filter by unit (UUID or unit code)
 *   ?status=active|closed  — filter by status
 */
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyLecturerAccessToken } from "@/lib/lecturerAuthJwt";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

export async function GET(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  let lecturerId: string;
  try {
    const p = verifyLecturerAccessToken(token);
    lecturerId = p.lecturerId;
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401, headers: corsHeaders });
  }

  const { searchParams } = new URL(req.url);
  const unitParam = searchParams.get("unitId")?.trim() ?? "";
  const status = searchParams.get("status")?.trim() ?? "";

  // Resolve unitParam to a real unitId (accepts UUID or unit code)
  let resolvedUnitId: string | undefined;
  if (unitParam) {
    let unit = await prisma.unit.findFirst({
      where: { OR: [{ id: unitParam }, { code: { equals: unitParam, mode: "insensitive" } }] },
      select: { id: true },
    });
    if (!unit) {
      const stripped = unitParam.replace(/\s+/g, "");
      unit = await prisma.unit.findFirst({
        where: { code: { equals: stripped, mode: "insensitive" } },
        select: { id: true },
      });
    }
    if (!unit) {
      return NextResponse.json({ error: "Unit not found" }, { status: 404, headers: corsHeaders });
    }
    resolvedUnitId = unit.id;
  }

  const assignments = await prisma.assignment.findMany({
    where: {
      lecturerId,
      ...(resolvedUnitId && { unitId: resolvedUnitId }),
      ...(status && { status }),
    },
    include: {
      submissions: { select: { id: true, status: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // Resolve unit info for each assignment
  const unitIds = [...new Set(assignments.map((a) => a.unitId))];
  const units = await prisma.unit.findMany({
    where: { id: { in: unitIds } },
    select: { id: true, code: true, title: true },
  });
  const unitMap = new Map(units.map((u) => [u.id, u]));

  const result = assignments.map((a) => ({
    id: a.id,
    title: a.title,
    description: a.description ?? null,
    unitId: a.unitId,
    unitCode: unitMap.get(a.unitId)?.code ?? "",
    unitTitle: unitMap.get(a.unitId)?.title ?? "",
    type: a.type,
    status: a.status,
    dueDate: a.dueDate.toISOString(),
    maxScore: a.maxScore ?? null,
    rubric: a.rubric ?? null,
    attachments: a.attachments ?? null,
    submissionCount: (a as any).submissions?.length ?? 0,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  }));

  return NextResponse.json(result, { headers: corsHeaders });
}
