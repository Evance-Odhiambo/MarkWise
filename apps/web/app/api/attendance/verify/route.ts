import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { verifyStudentAccessToken } from "@/lib/studentAuthJwt";
import { getStudentAuthUsers } from "@/lib/studentAuthStore";
import { readStudents, type StudentRecord } from "@/lib/studentStore.server";
import { isStudentEnrolledForUnit, normalizeUnitCode } from "@/lib/enrollmentStore";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

type VerifyAttendanceBody = {
  unitCode?: string;
  lectureRoom?: string;
  sessionStart?: string;
  deviceId?: string;
  rawPayload?: unknown;
  motionVerified?: boolean;
  motionObservedAt?: string;
  motionScore?: number;
};

const extractBearerToken = (authorizationHeader: string | null) => {
  if (!authorizationHeader) return null;
  const [type, token] = authorizationHeader.split(" ");
  if (type !== "Bearer" || !token) return null;
  return token;
};

const isSessionWindowActive = (sessionStartIso: string) => {
  const startTime = Date.parse(sessionStartIso);
  if (Number.isNaN(startTime)) return false;

  const now = Date.now();
  const earlyWindow = startTime - 15 * 60 * 1000;
  const lateWindow = startTime + 3 * 60 * 60 * 1000;
  return now >= earlyWindow && now <= lateWindow;
};

const parseIsoDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
};

export async function POST(request: Request) {
  try {
    const token = extractBearerToken(request.headers.get("authorization"));
    if (!token) {
      return NextResponse.json(
        { saved: false, error: "Missing or invalid authorization header." },
        { status: 401, headers: corsHeaders },
      );
    }

    let authPayload: ReturnType<typeof verifyStudentAccessToken>;
    try {
      authPayload = verifyStudentAccessToken(token);
    } catch {
      return NextResponse.json(
        { saved: false, error: "Invalid or expired token." },
        { status: 401, headers: corsHeaders },
      );
    }

    const users = await getStudentAuthUsers();
    const authUser = users.find((item) => item.id === authPayload.userId);
    if (!authUser) {
      return NextResponse.json(
        { saved: false, error: "Authenticated account not found." },
        { status: 404, headers: corsHeaders },
      );
    }

    const students = await readStudents();
    const student = students.find((item: StudentRecord) => item.id === authUser.studentId);
    if (!student) {
      return NextResponse.json(
        { saved: false, error: "Student profile not found." },
        { status: 404, headers: corsHeaders },
      );
    }

    const body = (await request.json()) as VerifyAttendanceBody;

    const unitCode = normalizeUnitCode(body.unitCode ?? "");
    const lectureRoom = body.lectureRoom?.trim() ?? "";
    const sessionStart = body.sessionStart?.trim() ?? "";
    const deviceId = body.deviceId?.trim() ?? "";
    const motionVerified = body.motionVerified;
    const motionObservedAt = body.motionObservedAt?.trim() ?? "";
    const motionScore = body.motionScore;

    if (!unitCode || !lectureRoom || !sessionStart || !deviceId || typeof motionVerified !== "boolean") {
      return NextResponse.json(
        { saved: false, error: "Missing required fields." },
        { status: 400, headers: corsHeaders },
      );
    }

    const normalizedSessionStart = parseIsoDate(sessionStart);
    const normalizedMotionObservedAt = parseIsoDate(motionObservedAt);

    if (!normalizedSessionStart || !normalizedMotionObservedAt) {
      return NextResponse.json(
        { saved: false, error: "sessionStart and motionObservedAt must be valid timestamps." },
        { status: 400, headers: corsHeaders },
      );
    }

    if (typeof motionScore !== "undefined" && (typeof motionScore !== "number" || Number.isNaN(motionScore))) {
      return NextResponse.json(
        { saved: false, error: "motionScore must be a valid number when provided." },
        { status: 400, headers: corsHeaders },
      );
    }

    if (!isSessionWindowActive(normalizedSessionStart)) {
      return NextResponse.json(
        { saved: false, error: "Attendance rejected: session window is not active." },
        { status: 400, headers: corsHeaders },
      );
    }

    const enrolled = await isStudentEnrolledForUnit(student.id, unitCode);
    if (!enrolled) {
      return NextResponse.json(
        { saved: false, error: "Attendance rejected: student is not enrolled for this unit." },
        { status: 400, headers: corsHeaders },
      );
    }

    // Find the room by name (lectureRoom)
      const room = await prisma.room.findFirst({ where: { name: lectureRoom } });
      if (!room) {
        return NextResponse.json(
          { saved: false, error: "Room not found." },
          { status: 404, headers: corsHeaders },
        );
      }

      // Check for duplicate attendance
      const isDuplicate = await prisma.attendanceRecord.findFirst({
        where: {
          studentId: student.id,
          roomId: room.id,
          date: new Date(normalizedSessionStart),
          // Optionally add deviceId if you want to prevent device-based duplicates
        },
      });
      if (isDuplicate) {
        return NextResponse.json(
          { saved: false, duplicate: true },
          { status: 409, headers: corsHeaders },
        );
      }

      // Count previous flagged records for risk scoring
      const previousNoMotionAttempts = await prisma.attendanceRecord.count({
        where: {
          studentId: student.id,
          status: "flagged",
        },
      });

    const flagged = motionVerified === false;
    const reason = flagged ? ("NO_MOTION" as const) : undefined;
    const riskScore = flagged ? Math.min(100, 35 + previousNoMotionAttempts * 20) : Math.max(0, previousNoMotionAttempts * 5);


    await prisma.attendanceRecord.create({
      data: {
        studentId: student.id,
        roomId: room.id,
        date: new Date(normalizedSessionStart),
        status: flagged ? "flagged" : "present",
        // Add additional fields as needed (motionVerified, deviceId, etc.)
      },
    });

    return NextResponse.json(
      {
        saved: true,
        flagged,
        reason,
        riskScore,
      },
      { status: 201, headers: corsHeaders },
    );
  } catch {
    return NextResponse.json(
      { saved: false, error: "Failed to verify attendance." },
      { status: 500, headers: corsHeaders },
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders,
  });
}
