import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveAdminOrLecturerScope } from "@/lib/adminLecturerAuth";

// GET /api/attendance/sessions/:id/attendees
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const scope = resolveAdminOrLecturerScope(req);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const { id } = await params;

  const session = await prisma.onlineAttendanceSession.findUnique({
    where: { id },
    select: { lecturerId: true },
  });

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Only the owning lecturer or an admin may view attendees
  if (scope.role === "lecturer" && scope.userId !== session.lecturerId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const records = await prisma.onlineAttendanceRecord.findMany({
    where: { sessionId: id },
    select: { studentId: true, admissionNumber: true, markedAt: true },
    orderBy: { markedAt: "asc" },
  });

  // Enrich with student name
  const studentIds = records.map((r) => r.studentId);
  const students = await prisma.student.findMany({
    where: { id: { in: studentIds } },
    select: { id: true, name: true },
  });
  const nameMap = new Map(students.map((s) => [s.id, s.name]));

  const attendees = records.map((r) => ({
    studentName: nameMap.get(r.studentId) ?? "Unknown",
    admissionNumber: r.admissionNumber,
    submittedAt: r.markedAt.getTime(),
  }));

  return NextResponse.json(attendees);
}
