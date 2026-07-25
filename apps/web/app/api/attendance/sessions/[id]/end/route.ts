import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveAdminOrLecturerScope } from "@/lib/adminLecturerAuth";

// POST /api/attendance/sessions/:id/end — authenticated
export async function POST(
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
    select: { lecturerId: true, status: true },
  });

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Only the owning lecturer or an admin may end a session
  if (scope.role === "lecturer" && scope.userId !== session.lecturerId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (session.status === "ended") {
    return NextResponse.json({ message: "Session already ended" });
  }

  await prisma.onlineAttendanceSession.update({
    where: { id },
    data: { status: "ended", endedAt: new Date() },
  });

  return NextResponse.json({ message: "Session ended" });
}
