import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyAdminAuthToken } from "@/lib/adminAuthJwt";
import { verifyLecturerAccessToken } from "@/lib/lecturerAuthJwt";
import { resolveAdminScope } from "@/lib/adminScope";
import { bumpTimetableVersion } from "@/lib/timetableSyncStore";
import { normalizeUnitCode } from "@/lib/unitCode";
import { sendFcmToTokens, getStudentTokensForUnit, getLecturerTokens } from "@/lib/fcm";
import { DayOfWeek, TimetableStatus } from "@prisma/client";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// ── helpers ──────────────────────────────────────────────────────────────────

function toMinutes(hhmm: string): number | null {
  const parts = hhmm.split(":");
  if (parts.length < 2) return null;
  const h = parseInt(parts[0]!, 10);
  const m = parseInt(parts[1]!, 10);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

function minutesToHHMM(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

const STRING_TO_DOW: Record<string, DayOfWeek> = {
  monday: "MON", tuesday: "TUE", wednesday: "WED",
  thursday: "THU", friday: "FRI", saturday: "SAT", sunday: "SUN",
  mon: "MON", tue: "TUE", wed: "WED", thu: "THU", fri: "FRI", sat: "SAT", sun: "SUN",
};
const DOW_TO_STRING: Record<string, string> = {
  MON: "Monday", TUE: "Tuesday", WED: "Wednesday",
  THU: "Thursday", FRI: "Friday", SAT: "Saturday", SUN: "Sunday",
};

const STATUS_MAP: Record<TimetableStatus, string> = {
  DRAFT: "Pending", PUBLISHED: "Confirmed", ARCHIVED: "Archived",
  CANCELLED: "Cancelled", ONLINE: "Online", RESCHEDULED: "Rescheduled",
};

// Build the full timetable entry response shape expected by the frontend/mobile
function formatEntry(item: {
  id: string;
  timetableStatus: TimetableStatus;
  reason: string | null;
  lecturerId: string;
  createdAt: Date;
  updatedAt: Date;
  sharedSession: {
    id: string; day: DayOfWeek; startMinute: number; endMinute: number;
    sessionType: string; isMerged: boolean; roomId: string;
    room: { id: string; name: string; roomCode: string; buildingCode: string } | null;
  } | null;
  unitOffering: {
    id: string; year: number; semester: number; courseId: string;
    unit: { id: string; code: string; title: string } | null;
    course: { id: string; name: string } | null;
  } | null;
  lecturer: { id: string; fullName: string } | null;
}) {
  const ss = item.sharedSession;
  const uo = item.unitOffering;
  return {
    id: item.id,
    status: STATUS_MAP[item.timetableStatus] ?? item.timetableStatus,
    timetableStatus: item.timetableStatus,
    reason: item.reason ?? null,
    // schedule
    day: ss ? (DOW_TO_STRING[ss.day] ?? ss.day) : "",
    startTime: ss ? minutesToHHMM(ss.startMinute) : "",
    endTime: ss ? minutesToHHMM(ss.endMinute) : "",
    startMinute: ss?.startMinute ?? null,
    endMinute: ss?.endMinute ?? null,
    // room
    roomId: ss?.roomId ?? null,
    venueName: ss?.room?.name ?? null,
    venue: ss?.room?.name ?? null,
    lectureRoom: ss?.room?.name ?? null,
    roomCode: ss?.room?.roomCode ?? null,
    buildingCode: ss?.room?.buildingCode ?? null,
    // unit / course
    unitId: uo?.unit?.id ?? null,
    unitCode: uo?.unit?.code ? normalizeUnitCode(uo.unit.code) : "",
    unitTitle: uo?.unit?.title ?? "",
    courseId: uo?.courseId ?? null,
    courseName: uo?.course?.name ?? "",
    yearOfStudy: uo?.year?.toString() ?? "",
    semester: uo?.semester?.toString() ?? "",
    // lecturer
    lecturerId: item.lecturerId,
    lecturerName: item.lecturer?.fullName ?? "",
    // merge info
    sharedSessionId: ss?.id ?? null,
    isMerged: ss?.isMerged ?? false,
    type: ss?.sessionType ?? "LEC",
    lessonType: ss?.sessionType ?? "LEC",
    // timestamps
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

const ENTRY_INCLUDE = {
  unitOffering: { include: { unit: true, course: true } },
  lecturer: { select: { id: true, fullName: true } },
  sharedSession: { include: { room: true } },
} as const;

// ── GET /api/timetable ────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const departmentId  = searchParams.get("departmentId");
  const institutionId = searchParams.get("institutionId");
  const courseId      = searchParams.get("courseId");
  const lecturerId    = searchParams.get("lecturerId");

  if (!departmentId && !institutionId && !courseId && !lecturerId) {
    return NextResponse.json(
      { error: "departmentId, institutionId, courseId, or lecturerId is required" },
      { status: 400, headers: corsHeaders },
    );
  }

  const scope = await resolveAdminScope(req);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status, headers: corsHeaders });
  }

  // Build where clause using new schema relations
  type WhereClause = Record<string, unknown>;
  const where: WhereClause = {};

  if (courseId) {
    where.unitOffering = { courseId };
  } else if (departmentId) {
    where.unitOffering = { unit: { departmentId } };
  } else if (institutionId) {
    where.unitOffering = { course: { department: { institutionId } } };
  } else if (lecturerId) {
    where.lecturerId = lecturerId;
  }

  try {
    const entries = await prisma.timetable.findMany({
      where,
      include: ENTRY_INCLUDE,
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json(entries.map(formatEntry), {
      headers: { ...corsHeaders, "Cache-Control": "private, max-age=30, stale-while-revalidate=300" },
    });
  } catch (error) {
    console.error("[timetable/GET]", error);
    return NextResponse.json({ error: "Failed to fetch timetable entries" }, { status: 500, headers: corsHeaders });
  }
}

// ── POST /api/timetable ───────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  // Auth: admin or lecturer
  let token = req.cookies.get("admin_auth_token")?.value;
  if (!token) {
    const h = req.headers.get("authorization");
    if (h?.startsWith("Bearer ")) token = h.slice(7).trim();
  }
  if (!token) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401, headers: corsHeaders });
  }

  let adminId: string | null = null;
  let lecturerIdFromToken: string | null = null;

  const adminPayload = verifyAdminAuthToken(token);
  if (adminPayload?.adminId) {
    adminId = adminPayload.adminId;
  } else {
    try {
      lecturerIdFromToken = verifyLecturerAccessToken(token).lecturerId;
    } catch {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401, headers: corsHeaders });
    }
  }

  const data = await req.json();
  const {
    courseId, unitId, unitCode,
    lecturerId: bodyLecturerId,
    roomId, campusId, institutionId,
    day, startTime, endTime,
    year, yearOfStudy, semester,
    sessionType,
  } = data as Record<string, string | number | undefined>;

  const lecturerId = (bodyLecturerId as string | undefined) ?? lecturerIdFromToken ?? "";

  // Lecturer may only create for themselves
  if (lecturerIdFromToken && lecturerIdFromToken !== lecturerId) {
    return NextResponse.json({ error: "Lecturer token does not match lecturerId." }, { status: 403, headers: corsHeaders });
  }

  // Required fields
  const missing = [];
  if (!courseId) missing.push("courseId");
  if (!lecturerId) missing.push("lecturerId");
  if (!roomId) missing.push("roomId");
  if (!day) missing.push("day");
  if (!startTime) missing.push("startTime");
  if (!endTime) missing.push("endTime");
  if (!institutionId) missing.push("institutionId");
  if (missing.length) {
    return NextResponse.json({ error: `Missing required fields: ${missing.join(", ")}` }, { status: 400, headers: corsHeaders });
  }

  const startMinute = toMinutes(startTime as string);
  const endMinute   = toMinutes(endTime as string);
  if (startMinute == null || endMinute == null || startMinute >= endMinute) {
    return NextResponse.json({ error: "Invalid startTime/endTime." }, { status: 400, headers: corsHeaders });
  }

  const dow = STRING_TO_DOW[(day as string).toLowerCase()];
  if (!dow) {
    return NextResponse.json({ error: `Invalid day: ${day}` }, { status: 400, headers: corsHeaders });
  }

  const yearNum     = parseInt(String(year ?? yearOfStudy ?? "1"), 10) || 1;
  const semesterNum = parseInt(String(semester ?? "1"), 10) || 1;

  try {
    // Resolve unit ID
    let resolvedUnitId = unitId as string | undefined;
    if (!resolvedUnitId && unitCode) {
      const normalised = normalizeUnitCode(unitCode as string);
      const unit = await prisma.unit.findFirst({
        where: { OR: [{ code: normalised }, { code: (unitCode as string).trim().toUpperCase() }] },
        select: { id: true },
      });
      resolvedUnitId = unit?.id;
    }
    if (!resolvedUnitId) {
      return NextResponse.json({ error: "unitId or valid unitCode is required." }, { status: 400, headers: corsHeaders });
    }

    // Find/create UnitOffering
    const offering = await prisma.unitOffering.upsert({
      where: { courseId_year_semester_unitId: { courseId: courseId as string, year: yearNum, semester: semesterNum, unitId: resolvedUnitId } },
      create: { courseId: courseId as string, year: yearNum, semester: semesterNum, unitId: resolvedUnitId },
      update: {},
    });

    // Resolve campusId — use roomId to find room's campus
    let resolvedCampusId = campusId as string | undefined;
    if (!resolvedCampusId) {
      const room = await prisma.room.findUnique({ where: { id: roomId as string }, select: { buildingFloor: { select: { building: { select: { campusId: true } } } } } });
      resolvedCampusId = room?.buildingFloor?.building?.campusId ?? undefined;
    }
    // Fall back: find first campus in institution
    if (!resolvedCampusId) {
      const campus = await prisma.campus.findFirst({ where: { institutionId: institutionId as string }, select: { id: true } });
      resolvedCampusId = campus?.id;
    }
    if (!resolvedCampusId) {
      return NextResponse.json({ error: "Cannot resolve campusId for the given room/institution." }, { status: 400, headers: corsHeaders });
    }

    // Check conflicts on SharedSession
    const overlapWhere = { startMinute: { lt: endMinute }, endMinute: { gt: startMinute } };
    const [lecturerConflict, roomConflict] = await Promise.all([
      prisma.sharedSession.findFirst({
        where: { lecturerId, day: dow, ...overlapWhere, timetables: { some: {} } },
        select: { id: true, room: { select: { name: true } } },
      }),
      prisma.sharedSession.findFirst({
        where: { roomId: roomId as string, day: dow, ...overlapWhere, timetables: { some: {} } },
        select: { id: true },
      }),
    ]);

    if (roomConflict) {
      return NextResponse.json(
        { error: "Room is already booked for this time slot.", mergePrompt: false },
        { status: 409, headers: corsHeaders },
      );
    }
    if (lecturerConflict) {
      return NextResponse.json(
        { error: `Lecturer is already teaching in ${lecturerConflict.room?.name ?? "another room"} at this time.`, lecturerConflict: true },
        { status: 409, headers: corsHeaders },
      );
    }

    // Create SharedSession + Timetable in one transaction
    const { entry } = await prisma.$transaction(async (tx) => {
      const ss = await tx.sharedSession.create({
        data: {
          institutionId: institutionId as string,
          campusId: resolvedCampusId!,
          roomId: roomId as string,
          lecturerId,
          day: dow,
          startMinute,
          endMinute,
          sessionType: ((sessionType as string | undefined) ?? "LEC") as import("@prisma/client").SessionType,
        },
      });

      const entry = await tx.timetable.create({
        data: {
          unitOfferingId: offering.id,
          lecturerId,
          sharedSessionId: ss.id,
          timetableStatus: (adminId ? "PUBLISHED" : "DRAFT") as TimetableStatus,
        },
        include: ENTRY_INCLUDE,
      });

      return { ss, entry };
    });

    // Bump version (fire-and-forget)
    bumpTimetableVersion(courseId as string).catch((err) =>
      console.error("[timetable/POST] version bump:", err),
    );

    // FCM push (fire-and-forget)
    ;(async () => {
      try {
        const code = entry.unitOffering?.unit?.code ?? "";
        const normCode = code ? normalizeUnitCode(code) : "";
        if (!normCode) return;
        const [studentTokens, lecturerTokens] = await Promise.all([
          getStudentTokensForUnit(resolvedUnitId!),
          getLecturerTokens(lecturerId),
        ]);
        const allTokens = [...studentTokens, ...lecturerTokens];
        if (allTokens.length) {
          await sendFcmToTokens(allTokens, "timetable", "Timetable Updated",
            `New class: ${normCode} on ${DOW_TO_STRING[dow]} at ${startTime}.`, {
              unitCode: normCode, day: DOW_TO_STRING[dow] ?? dow, startTime: startTime as string, entryId: entry.id,
            });
        }
      } catch (err) {
        console.error("[timetable/POST] FCM:", err);
      }
    })();

    return NextResponse.json(formatEntry(entry), { status: 201, headers: corsHeaders });
  } catch (error) {
    console.error("[timetable/POST]", error);
    return NextResponse.json({ error: "Failed to create timetable entry" }, { status: 500, headers: corsHeaders });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}
