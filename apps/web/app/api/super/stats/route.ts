import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

// GET /api/super/stats — system-wide aggregate counts
export async function GET() {
  try {
    const [institutions, admins, lecturers, students, rooms, departments] =
      await Promise.all([
        prisma.institution.count(),
        prisma.admin.count(),
        prisma.lecturer.count(),
        prisma.student.count(),
        prisma.room.count(),
        prisma.department.count(),
      ]);

    return NextResponse.json({
      institutions,
      admins,
      lecturers,
      students,
      rooms,
      departments,
    });
  } catch {
    return NextResponse.json({ error: "Failed to fetch stats." }, { status: 500 });
  }
}
