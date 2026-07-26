/**
 * POST /api/attendance/manual-mark/submit
 *
 * Lecturer manually marks a student present using their physical ID card.
 * Auto-creates the ConductedSession if one does not already exist for this
 * (unitCode, lectureRoom, sessionStart) tuple.
 *
 * Body:
 *   studentId      string   — target student id
 *   admissionNumber string  — for audit trail
 *   unitCode       string
 *   lectureRoom    string
 *   lessonType     string   (optional)
 *   sessionStart   number   — epoch ms
 *
 * Returns 409 if the student is already marked for this session.
 * Auth: Bearer lecturer JWT
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyLecturerAccessToken } from "@/lib/lecturerAuthJwt";
import { normalizeUnitCode } from "@/lib/unitCode";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

const VALID_LESSON_TYPES = new Set(["LEC", "GD", "RAT", "CAT", "LAB", "SEM", "WRK", "TUT", "PRE"]);

function normaliseCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function normalizeUnitCodeForLookup(raw: string): string {
  return normalizeUnitCode(raw).replace(/\s+/g, "");
}

async function resolveUnitId(unitCode: string) {
  const normalized = unitCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id
    FROM "Unit"
    WHERE UPPER(REPLACE(code, ' ', '')) = ${normalized}
    LIMIT 1
  `;
  return rows[0]?.id ?? null;
}

export async function POST(req: NextRequest) {
  const token = (req.headers.get("authorization") ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!token) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }
  let lecturerId: string;
  try {
    ({ lecturerId } = verifyLecturerAccessToken(token));
  } catch {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ message: "Invalid JSON body" }, { status: 400, headers: corsHeaders });
  }

  const {
    studentId,
    admissionNumber,
    unitCode: unitCodeRaw,
    lectureRoom: lectureRoomRaw,
    lessonType: lessonTypeRaw,
    sessionStart: sessionStartRaw,
  } = body as {
    studentId?: string;
    admissionNumber?: string;
    unitCode?: string;
    lectureRoom?: string;
    lessonType?: string;
    sessionStart?: number;
  };

  if (!studentId || typeof studentId !== "string") {
    return NextResponse.json({ message: "studentId is required" }, { status: 400, headers: corsHeaders });
  }
  if (!admissionNumber || typeof admissionNumber !== "string") {
    return NextResponse.json({ message: "admissionNumber is required" }, { status: 400, headers: corsHeaders });
  }
  if (!unitCodeRaw || typeof unitCodeRaw !== "string") {
    return NextResponse.json({ message: "unitCode is required" }, { status: 400, headers: corsHeaders });
  }
  if (!lectureRoomRaw || typeof lectureRoomRaw !== "string") {
    return NextResponse.json({ message: "lectureRoom is required" }, { status: 400, headers: corsHeaders });
  }
  if (typeof sessionStartRaw !== "number" || !Number.isFinite(sessionStartRaw)) {
    return NextResponse.json({ message: "sessionStart must be a numeric epoch ms value" }, { status: 400, headers: corsHeaders });
  }

  const normUnit = normaliseCode(unitCodeRaw);
  const lectureRoom = lectureRoomRaw.trim().toUpperCase();
  const lessonType = lessonTypeRaw
    ? lessonTypeRaw.trim().toUpperCase()
    : null;
  if (lessonType && !VALID_LESSON_TYPES.has(lessonType)) {
    return NextResponse.json(
      { message: `lessonType must be one of: ${[...VALID_LESSON_TYPES].join(", ")}` },
      { status: 400, headers: corsHeaders },
    );
  }

  // sessionStart bounds: not more than 7 days in the past, not more than 1 hour in the future.
  // Prevents backdating attendance to arbitrary historical dates.
  const sessionStart = new Date(sessionStartRaw);
  const now = new Date();
  const SESSION_PAST_LIMIT_MS  = 7 * 24 * 60 * 60 * 1000;
  const SESSION_FUTURE_LIMIT_MS = 60 * 60 * 1000;
  if (sessionStart.getTime() < now.getTime() - SESSION_PAST_LIMIT_MS) {
    return NextResponse.json(
      { message: "sessionStart is too far in the past (max 7 days)" },
      { status: 422, headers: corsHeaders },
    );
  }
  if (sessionStart.getTime() > now.getTime() + SESSION_FUTURE_LIMIT_MS) {
    return NextResponse.json(
      { message: "sessionStart is in the future" },
      { status: 422, headers: corsHeaders },
    );
  }

  try {
    // Resolve lecturer's institution for scope checks
    const lecturer = await prisma.lecturer.findUnique({
      where: { id: lecturerId },
      select: { institutionId: true },
    });
    if (!lecturer) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: corsHeaders });
    }

    // Resolve the requested unit using space-insensitive matching.
    const unitId = await resolveUnitId(unitCodeRaw);
    if (!unitId) {
      return NextResponse.json(
        { message: "You are not assigned to teach this unit" },
        { status: 403, headers: corsHeaders },
      );
    }

    const assigned = await prisma.lecturerUnitAssignment.findFirst({
      where: {
        lecturerId,
        unitOffering: { unitId },
      },
      select: { id: true },
    });
    if (!assigned) {
      const timetableEntry = await prisma.timetable.findFirst({
        where: {
          lecturerId,
          unitOffering: { unitId },
        },
        select: { id: true },
      });
      if (!timetableEntry) {
        return NextResponse.json(
          { message: "You are not assigned to teach this unit" },
          { status: 403, headers: corsHeaders },
        );
      }
    }

    // Verify student exists and is in the same institution as the lecturer
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: { id: true, name: true, admissionNumber: true, institutionId: true },
    });
    if (!student) {
      return NextResponse.json({ message: "Student not found" }, { status: 404, headers: corsHeaders });
    }
    if (student.institutionId !== lecturer.institutionId) {
      return NextResponse.json({ message: "Student not found" }, { status: 404, headers: corsHeaders });
    }

    const snapshot = await prisma.studentEnrollmentSnapshot.findUnique({
      where: { studentId },
      select: { unitCodes: true },
    });
    const isEnrolled =
      snapshot?.unitCodes.some((c) => normaliseCode(c) === normUnit) ?? false;
    if (!isEnrolled) {
      return NextResponse.json(
        { message: "Student is not enrolled in this unit" },
        { status: 422, headers: corsHeaders },
      );
    }

    // Auto-create ConductedSession if it doesn't exist yet; capture id for FK
    const session = await prisma.conductedSession.upsert({
      where: { unitCode_lectureRoom_sessionStart: { unitCode: normUnit, lectureRoom, sessionStart } },
      create: {
        unitCode:     normUnit,
        lectureRoom,
        lessonType:   lessonType ?? "LEC",
        sessionStart,
        lecturerId,
      },
      update: {},
      select: { id: true },
    });

    // Create OfflineAttendanceRecord (409 if already marked)
    try {
      const record = await prisma.offlineAttendanceRecord.create({
        data: {
          studentId,
          unitCode:            normUnit,
          lectureRoom,
          lessonType:          lessonType ?? "LEC",
          sessionStart,
          scannedAt:           now,
          method:              "manual_lecturer",
          admissionNumber:     student.admissionNumber,
          markedByLecturerId:  lecturerId,
          institutionId:       student.institutionId,
          conductedSessionId:  session.id,
          verificationStatus:  "verified",
        },
      });

      return NextResponse.json(
        {
          success:         true,
          recordId:        record.id,
          studentId,
          studentName:     student.name,
          admissionNumber: student.admissionNumber,
          unitCode:        normUnit,
          lectureRoom,
          sessionStart:    sessionStart.toISOString(),
          markedAt:        now.toISOString(),
        },
        { headers: corsHeaders },
      );
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === "P2002") {
        return NextResponse.json(
          { message: "Student already marked present for this session" },
          { status: 409, headers: corsHeaders },
        );
      }
      throw err;
    }
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === "P2002") {
      return NextResponse.json(
        { message: "Student already marked present for this session" },
        { status: 409, headers: corsHeaders },
      );
    }
    console.error("[attendance/manual-mark/submit] error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: corsHeaders });
  }
}
