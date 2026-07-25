import { NextResponse } from "next/server";
import { verifyLecturerAccessToken } from "@/lib/lecturerAuthJwt";
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
  monday: 0, tuesday: 1, wednesday: 2, thursday: 3,
  friday: 4, saturday: 5, sunday: 6,
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

    let lecturerId: string;
    try {
      ({ lecturerId } = verifyLecturerAccessToken(token));
    } catch {
      return NextResponse.json({ error: "Invalid or expired token." }, { status: 401, headers: corsHeaders });
    }

    const rows = await prisma.timetable.findMany({
      where: { lecturerId },
      include: {
        unitOffering: { include: { unit: true, course: true } },
        lecturer: { select: { fullName: true } },
        sharedSession: {
          include: {
            room: { select: { id: true, name: true, roomCode: true, buildingCode: true } },
          },
        },
      },
    });

    const entries = rows
      .map((item) => {
        const ss = item.sharedSession;
        const uo = item.unitOffering;
        const dayStr = ss ? DOW_TO_STRING[ss.day] : "";

        return {
          id: item.id,
          courseId: uo?.courseId ?? null,
          courseName: uo?.course?.name ?? "",
          unitId: uo?.unit?.id ?? null,
          unitCode: uo?.unit?.code ? normalizeUnitCode(uo.unit.code) : "",
          unitTitle: uo?.unit?.title ?? "",
          yearOfStudy: uo?.year?.toString() ?? "",
          semester: uo?.semester?.toString() ?? "",
          lecturerId: item.lecturerId,
          lecturerName: item.lecturer?.fullName ?? "",
          day: dayStr,
          startTime: ss ? minutesToHHMM(ss.startMinute) : "",
          endTime: ss ? minutesToHHMM(ss.endMinute) : "",
          startMinute: ss?.startMinute ?? null,
          endMinute: ss?.endMinute ?? null,
          venueName: ss?.room?.name ?? null,
          venue: ss?.room?.name ?? null,
          lectureRoom: ss?.room?.name ?? null,
          roomCode: ss?.room?.roomCode ?? null,
          roomId: ss?.roomId ?? null,
          status: STATUS_MAP[item.timetableStatus] ?? item.timetableStatus,
          timetableStatus: item.timetableStatus,
          reason: item.reason ?? null,
          type: ss?.sessionType ?? "LEC",
          lessonType: ss?.sessionType ?? "LEC",
          sharedSessionId: ss?.id ?? null,
          isMerged: ss?.isMerged ?? false,
          createdAt: item.createdAt.toISOString(),
          updatedAt: item.updatedAt?.toISOString() ?? null,
        };
      })
      .sort((a, b) => {
        const dayDiff = (DAY_ORDER[a.day?.toLowerCase()] ?? 99) - (DAY_ORDER[b.day?.toLowerCase()] ?? 99);
        if (dayDiff !== 0) return dayDiff;
        return (a.startTime ?? "").localeCompare(b.startTime ?? "");
      });

    // Deduplicated unit list for dropdowns
    const seenIds = new Set<string>();
    const units: { unitCode: string; unitTitle: string }[] = [];
    for (const row of rows) {
      const u = row.unitOffering?.unit;
      if (u && !seenIds.has(u.id)) {
        seenIds.add(u.id);
        units.push({ unitCode: normalizeUnitCode(u.code), unitTitle: u.title });
      }
    }
    units.sort((a, b) => a.unitCode.localeCompare(b.unitCode));

    return NextResponse.json({ lecturerId, entries, units }, { headers: corsHeaders });
  } catch (error) {
    console.error("[lecturer/me]", error);
    return NextResponse.json({ error: "Failed to load lecturer timetable." }, { status: 500, headers: corsHeaders });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}
