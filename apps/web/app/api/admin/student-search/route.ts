/**
 * GET /api/admin/student-search?departmentId=X&q=Jane
 *
 * Search enrolled students within a department by name or admission number.
 * Returns up to 15 lightweight results for the dept-admin "find any student" widget.
 *
 * Auth: admin JWT (Bearer or admin_auth_token cookie)
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveAdminScope } from "@/lib/adminScope";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const scope = await resolveAdminScope(req);
  if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status });

  const { searchParams } = new URL(req.url);
  const departmentId = searchParams.get("departmentId") ?? scope.departmentId ?? null;
  const q = (searchParams.get("q") ?? "").trim();

  if (!departmentId) {
    return NextResponse.json({ error: "departmentId required" }, { status: 400 });
  }
  if (q.length < 2) {
    return NextResponse.json([], { status: 200 });
  }

  // Ensure the requesting admin can access this department
  if (scope.departmentId && scope.departmentId !== departmentId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const students = await prisma.student.findMany({
    where: {
      departmentId,
      OR: [
        { name:            { contains: q, mode: "insensitive" } },
        { admissionNumber: { contains: q, mode: "insensitive" } },
      ],
    },
    select: {
      id:              true,
      name:            true,
      admissionNumber: true,
      year:            true,
    },
    orderBy: { name: "asc" },
    take: 15,
  });

  return NextResponse.json(students, { status: 200 });
}
