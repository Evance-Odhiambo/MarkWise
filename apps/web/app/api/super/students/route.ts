import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

// GET /api/super/students?institutionId=xxx  or  ?departmentId=xxx
// Super-admin only — bypasses role-scoping used by the regular /api/students route
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const institutionId = searchParams.get("institutionId");
  const departmentId = searchParams.get("departmentId");

  try {
    const where: { institutionId?: string; departmentId?: string } = {};
    if (departmentId) {
      where.departmentId = departmentId;
    } else if (institutionId) {
      where.institutionId = institutionId;
    }

    const students = await prisma.student.findMany({
      where,
      select: {
        id: true,
        name: true,
        admissionNumber: true,
        email: true,
        year: true,
        institutionId: true,
        departmentId: true,
        courseId: true,
        department: { select: { name: true } },
        course: { select: { name: true } },
      },
      orderBy: { name: "asc" },
    });

    return NextResponse.json({ students });
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch students." },
      { status: 500 },
    );
  }
}
