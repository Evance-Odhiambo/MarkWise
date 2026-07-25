import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// POST /api/attendance/sessions/:id/mark — PUBLIC, called by students from browser
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let body: { admissionNumber?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ message: "Invalid JSON body" }, { status: 400 });
  }

  const admissionNumber = body.admissionNumber?.trim();
  if (!admissionNumber) {
    return NextResponse.json({ message: "admissionNumber is required" }, { status: 400 });
  }

  // Expire stale sessions in the background before checking
  await prisma.onlineAttendanceSession.updateMany({
    where: { status: "active", expiresAt: { lte: new Date() } },
    data: { status: "expired" },
  });

  // Find an active, non-expired session
  const session = await prisma.onlineAttendanceSession.findFirst({
    where: { id, status: "active", expiresAt: { gt: new Date() } },
    select: { id: true, unitCode: true },
  });

  if (!session) {
    return NextResponse.json(
      { message: "Session not found or has expired" },
      { status: 404 }
    );
  }

  // Look up student by admission number (case-insensitive)
  const student = await prisma.student.findFirst({
    where: { admissionNumber: { equals: admissionNumber, mode: "insensitive" } },
    select: { id: true },
  });

  if (!student) {
    return NextResponse.json(
      { message: "No student found with that admission number" },
      { status: 404 }
    );
  }

  // Prevent duplicate attendance
  try {
    await prisma.onlineAttendanceRecord.create({
      data: {
        sessionId: session.id,
        studentId: student.id,
        admissionNumber: admissionNumber.toUpperCase(),
        unitCode: session.unitCode,
      },
    });
  } catch (err: unknown) {
    // Unique constraint violation → duplicate
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      return NextResponse.json({ message: "Attendance already recorded" }, { status: 409 });
    }
    throw err;
  }

  return NextResponse.json({ message: "Attendance marked successfully" });
}
