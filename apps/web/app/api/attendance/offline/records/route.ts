import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyLecturerAccessToken } from "@/lib/lecturerAuthJwt";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

// GET /api/attendance/offline/records?unitCode=SCH2170&lectureRoom=LR101&sessionStart=1741200000000
// Returns all student submissions for a specific offline session (lecturer only).
export async function GET(req: NextRequest) {
  const token =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  let lecturerId: string;
  try {
    ({ lecturerId } = verifyLecturerAccessToken(token));
  } catch {
    return NextResponse.json(
      { message: "Unauthorized" },
      { status: 401, headers: corsHeaders }
    );
  }

  const { searchParams } = new URL(req.url);
  const rawUnitCode = searchParams.get("unitCode");
  const rawLectureRoom = searchParams.get("lectureRoom");
  const rawSessionStart = searchParams.get("sessionStart");

  if (!rawUnitCode || !rawLectureRoom || !rawSessionStart) {
    return NextResponse.json(
      { message: "unitCode, lectureRoom, and sessionStart are required" },
      { status: 400, headers: corsHeaders }
    );
  }

  const unitCode = rawUnitCode.replace(/\s+/g, "").toUpperCase();
  const lectureRoom = rawLectureRoom.trim().toUpperCase();
  const sessionStart = new Date(parseInt(rawSessionStart, 10));

  if (isNaN(sessionStart.getTime())) {
    return NextResponse.json(
      { message: "sessionStart must be a valid Unix timestamp in milliseconds" },
      { status: 400, headers: corsHeaders }
    );
  }

  // Verify this session belongs to the requesting lecturer
  const session = await prisma.conductedSession.findUnique({
    where: {
      unitCode_lectureRoom_sessionStart: { unitCode, lectureRoom, sessionStart },
    },
    select: { lecturerId: true },
  });

  if (!session) {
    return NextResponse.json(
      { message: "Session not found" },
      { status: 404, headers: corsHeaders }
    );
  }

  if (session.lecturerId !== lecturerId) {
    return NextResponse.json(
      { message: "Forbidden" },
      { status: 403, headers: corsHeaders }
    );
  }

  // Fetch all attendance records for this session
  const records = await prisma.offlineAttendanceRecord.findMany({
    where: { unitCode, lectureRoom, sessionStart },
    select: {
      studentId: true,
      scannedAt: true,
      method: true,
      deviceId: true,
    },
    orderBy: { scannedAt: "asc" },
  });

  // Enrich with student names in one query
  const studentIds = records.map((r) => r.studentId);
  const students = await prisma.student.findMany({
    where: { id: { in: studentIds } },
    select: { id: true, name: true, admissionNumber: true },
  });
  const studentMap = new Map(students.map((s) => [s.id, s]));

  const result = records.map((r: { studentId: string; scannedAt: Date; method: string; deviceId: string | null }) => ({
    studentName: studentMap.get(r.studentId)?.name ?? "Unknown",
    admissionNumber: studentMap.get(r.studentId)?.admissionNumber ?? null,
    scannedAt: r.scannedAt.getTime(),
    method: r.method,
    deviceId: r.deviceId ?? null,
  }));

  return NextResponse.json(result, { headers: corsHeaders });
}
