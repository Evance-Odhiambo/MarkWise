import { NextResponse } from "next/server";
import { verifyStudentAccessToken } from "@/lib/studentAuthJwt";
import { prisma } from "@/lib/prisma";
import { normalizeUnitCode } from "@/lib/unitCode";
import { TimetableStatus, DayOfWeek } from "@prisma/client";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const DOW_TO_STRING: Record<DayOfWeek, string> = {
  MON: "Monday", TUE: "Tuesday", WED: "Wednesday",
  THU: "Thursday", FRI: "Friday", SAT: "Saturday", SUN: "Sunday",
};
const DAY_ORDER: Record<string, number> = {
  monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4, saturday: 5, sunday: 6,
};
const STATUS_MAP: Record<TimetableStatus, string> = {
  DRAFT: "Pending", PUBLISHED: "Confirmed", ARCHIVED: "Archived",
  CANCELLED: "Cancelled", ONLINE: "Online", RESCHEDULED: "Rescheduled",
};

function minutesToHHMM(m: number) {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export async function GET(request: Request) {
  try {
    const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      return NextResponse.json({ error: "Missing or invalid authorization header." }, { status: 401, headers: corsHeaders });
    }

    let studentId: string;
    try {
      studentId = verifyStudentAccessToken(token).studentId;
    } catch {
      return NextResponse.json({ error: "Invalid or expired token." }, { status: 401, headers: corsHeaders });
    }

    const enrollments = await prisma.enrollment.findMany({
      where: { studentId },
      select: { unitId: true },
    });
    const unitIds = enrollments.map((e) => e.unitId);
    if (!unitIds.length) return NextResponse.json([], { headers: corsHeaders });

    const rows = await prisma.timetable.findMany({
      where: {
        unitOffering: { unitId: { in: unitIds } },
        timetableStatus: { notIn: ["ARCHIVED"] },
      },
      include: {
        unitOffering: { include: { unit: true, course: true } },
        lecturer: { select: { fullName: true } },
        sharedSession: {
          include: { room: { select: { name: true, roomCode: true } } },
        },
      },
    });

    const result = rows
      .map((item) => {
        const ss = item.sharedSession;
        const uo = item.unitOffering;
        const dayStr = ss ? DOW_TO_STRING[ss.day] : "";
        const startTime = ss ? minutesToHHMM(ss.startMinute) : "";
        const endTime   = ss ? minutesToHHMM(ss.endMinute)   : "";
        const code = uo?.unit?.code ? normalizeUnitCode(uo.unit.code) : "";

        return {
          id: item.id,
          unitId: uo?.unit?.id ?? null,
          unitCode: code,
          unitTitle: uo?.unit?.title ?? "",
          unit: `${uo?.unit?.title ?? ""} (${code})`,
          courseId: uo?.courseId ?? null,
          courseName: uo?.course?.name ?? "",
          day: dayStr,
          startTime,
          endTime,
          time: startTime && endTime ? `${startTime} - ${endTime}` : "",
          venue: ss?.room?.name ?? null,
          venueName: ss?.room?.name ?? null,
          roomCode: ss?.room?.roomCode ?? null,
          type: ss?.sessionType ?? "LEC",
          lessonType: ss?.sessionType ?? "LEC",
          lecturerId: item.lecturerId,
          lecturerName: item.lecturer?.fullName ?? "",
          lecturer: item.lecturer?.fullName ?? "",
          status: STATUS_MAP[item.timetableStatus] ?? item.timetableStatus,
          timetableStatus: item.timetableStatus,
          reason: item.reason ?? null,
          yearOfStudy: uo?.year?.toString() ?? "",
          semester: uo?.semester?.toString() ?? "",
          sharedSessionId: ss?.id ?? null,
          isMerged: ss?.isMerged ?? false,
          updatedAt: item.updatedAt?.toISOString() ?? null,
        };
      })
      .sort((a, b) => {
        const d = (DAY_ORDER[a.day?.toLowerCase()] ?? 99) - (DAY_ORDER[b.day?.toLowerCase()] ?? 99);
        return d !== 0 ? d : (a.startTime ?? "").localeCompare(b.startTime ?? "");
      });

    return NextResponse.json(result, { headers: corsHeaders });
  } catch (err) {
    console.error("[timetable/student/me]", err);
    return NextResponse.json({ error: "Failed to load student timetable." }, { status: 500, headers: corsHeaders });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}
