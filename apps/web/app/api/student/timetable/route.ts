import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyStudentAccessToken } from "@/lib/studentAuthJwt";
import { normalizeUnitCode } from "@/lib/unitCode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, If-None-Match",
};

/** Parse "Wednesday 10:00 - 12:00" → { day, startTime, endTime, venue } or null */
function parseRescheduledTo(
  raw: string | null,
  venue?: string | null,
): { day: string; startTime: string; endTime: string; venue: string } | null {
  if (!raw) return null;
  const m = raw.trim().match(/^(\w+)\s+(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})$/i);
  if (!m) return null;
  return { day: m[1], startTime: m[2], endTime: m[3], venue: venue || "TBA" };
}

/** Capitalise first letter, lowercase rest — "monday" → "Monday" */
function capitaliseDay(s: string) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/** Returns the most recent Saturday at 00:00:00 local server time. */
function getMostRecentSaturdayMidnight(): Date {
  const now = new Date();
  const day = now.getDay(); // 0=Sun … 6=Sat
  const daysAgo = day === 6 ? 0 : day + 1;
  const sat = new Date(now);
  sat.setDate(sat.getDate() - daysAgo);
  sat.setHours(0, 0, 0, 0);
  return sat;
}

/**
 * Defence-in-depth: if a transient (non-permanent) status was last set before
 * the most recent Saturday reset, treat it as 'Pending' in the response
 * without modifying the DB row.
 */
function getEffectiveStatus(
  status: string,
  reschedulePermanent: boolean | null | undefined,
  updatedAt: Date | null | undefined,
): string {
  if (!["Cancelled", "Rescheduled", "Online"].includes(status)) return status;
  if (reschedulePermanent === true) return status;
  const lastReset = getMostRecentSaturdayMidnight();
  if (updatedAt && updatedAt < lastReset) return "Pending";
  return status;
}

export async function GET(request: Request) {
  // ── Auth ────────────────────────────────────────────────────────────────
  const token = (request.headers.get("authorization") ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!token) {
    return NextResponse.json(
      { message: "Unauthorized" },
      { status: 401, headers: corsHeaders },
    );
  }

  let studentId: string;
  let courseId: string | undefined;
  try {
    const payload = verifyStudentAccessToken(token);
    studentId = payload.studentId;
    courseId = payload.courseId;
  } catch {
    return NextResponse.json(
      { message: "Unauthorized" },
      { status: 401, headers: corsHeaders },
    );
  }

  // If the JWT doesn't carry courseId, look it up from the Student record
  if (!courseId) {
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: { courseId: true },
    });
    courseId = student?.courseId;
  }

  if (!courseId) {
    return NextResponse.json(
      { message: "No timetable found for this course" },
      { status: 404, headers: corsHeaders },
    );
  }

  // Map TimetableStatus enum → display string
  const STATUS_MAP: Record<string, string> = {
    DRAFT:       "Pending",
    PUBLISHED:   "Confirmed",
    ARCHIVED:    "Pending",
    CANCELLED:   "Cancelled",
    ONLINE:      "Online",
    RESCHEDULED: "Rescheduled",
  };

  // DayOfWeek enum → display string
  const DOW_TO_DISPLAY: Record<string, string> = {
    MON: "Monday", TUE: "Tuesday", WED: "Wednesday",
    THU: "Thursday", FRI: "Friday", SAT: "Saturday", SUN: "Sunday",
  };

  function minutesToHHMM(m: number): string {
    return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  }

  // ── Data ────────────────────────────────────────────────────────────────
  try {
    const [entries, versionRecord] = await Promise.all([
      prisma.timetable.findMany({
        where: { unitOffering: { courseId } },
        include: {
          unitOffering: { include: { unit: { select: { code: true, title: true } } } },
          sharedSession: { include: { room: { select: { name: true } } } },
          lecturer: { select: { fullName: true } },
        },
        orderBy: [{ sharedSession: { day: "asc" } }, { sharedSession: { startMinute: "asc" } }],
      }),
      prisma.timetableVersion.findUnique({ where: { courseId } }),
    ]);

    // ── Extra (make-up) sessions ───────────────────────────────────────────
    // Derive enrolled unit codes from the timetable entries for this course.
    const enrolledUnitCodes = [...new Set(entries.map((e) => e.unitOffering?.unit?.code).filter(Boolean))] as string[];
    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);

    const extraSessions = enrolledUnitCodes.length
      ? await prisma.extraSession.findMany({
          where: {
            unitCode: { in: enrolledUnitCodes },
            deletedAt: null,
            date: { gte: todayDate },
          },
          select: {
            id: true,
            unitCode: true,
            date: true,
            startTime: true,
            endTime: true,
            roomCode: true,
            lessonType: true,
            lecturer: { select: { fullName: true } },
          },
          orderBy: [{ date: "asc" }, { startTime: "asc" }],
        })
      : [];

    const version = versionRecord?.version ?? 0;
    // Use the latest actual entry updatedAt so the ETag changes even if
    // no TimetableVersion record exists yet (pre-existing entries).
    const maxEntryMs = entries.reduce(
      (max, e) => Math.max(max, e.updatedAt?.getTime() ?? 0),
      0,
    );
    const versionMs = versionRecord?.updatedAt?.getTime() ?? 0;
    const latestMs = Math.max(maxEntryMs, versionMs);
    const updatedAt = latestMs > 0
      ? new Date(latestMs).toISOString()
      : new Date(0).toISOString();

    // ── ETag ──────────────────────────────────────────────────────────────
    // Format revision: bump this when the response shape changes so all
    // client caches are invalidated even if the data hasn't changed.
    const FORMAT_REV = 2;
    const etag = `"f${FORMAT_REV}-v${version}-${latestMs}"`;
    const ifNoneMatch = request.headers.get("if-none-match")?.trim();

    if (ifNoneMatch && ifNoneMatch === etag) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          ...corsHeaders,
          ETag: etag,
          "Cache-Control": "private, max-age=0, must-revalidate",
        },
      });
    }

    // ── Build response ────────────────────────────────────────────────────
    const timetable = entries.map((e) => {
      const rawStatus    = STATUS_MAP[e.timetableStatus] ?? "Pending";
      const effectiveStatus = getEffectiveStatus(
        rawStatus,
        null, // reschedulePermanent not on new model
        e.updatedAt,
      );
      const wasReset = effectiveStatus !== rawStatus;

      const roomName   = e.sharedSession?.room?.name ?? null;
      const dayDisplay = capitaliseDay(DOW_TO_DISPLAY[e.sharedSession?.day ?? ""] ?? "");
      const startTime  = minutesToHHMM(e.sharedSession?.startMinute ?? 0);
      const endTime    = minutesToHHMM(e.sharedSession?.endMinute ?? 0);

      // Venue resolution: Online entries with no room → null (client shows "Online")
      let effectiveVenue: string | null;
      if (wasReset) {
        effectiveVenue = roomName ?? "TBA";
      } else if (e.timetableStatus === "ONLINE") {
        effectiveVenue = null;
      } else {
        effectiveVenue = roomName ?? "TBA";
      }

      return {
        id: e.id,
        day: dayDisplay,
        startTime,
        endTime,
        unitCode: normalizeUnitCode(e.unitOffering?.unit?.code ?? ""),
        unitName: e.unitOffering?.unit?.title ?? "",
        type: "LEC",
        lessonType: "LEC",
        venue: effectiveVenue,
        status: effectiveStatus,
        lecturer: e.lecturer?.fullName ?? "",
        updatedAt: e.updatedAt?.toISOString() ?? null,
        updatedBy: wasReset ? "system" : null,
        rescheduledTo: null,
        rescheduledVenue: null,
        reschedulePermanent: null,
        reason: wasReset ? null : (e.reason ?? null),
        pendingReason: null,
        notifications: 0,
      };
    });

    // ── Build unit title map from timetable entries ────────────────────────
    const unitTitleMap: Record<string, string> = {};
    for (const e of entries) {
      const code  = e.unitOffering?.unit?.code;
      const title = e.unitOffering?.unit?.title;
      if (code && title) {
        unitTitleMap[normalizeUnitCode(code)] = title;
      }
    }

    // ── Map extra sessions to timetable entry shape ────────────────────────
    const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const extraEntries = extraSessions.map((s) => {
      const dateStr = s.date.toISOString().slice(0, 10);
      const dayName = DAYS[s.date.getDay()];
      const canonicalCode = normalizeUnitCode(s.unitCode);
      const unitTitle = unitTitleMap[canonicalCode] ?? canonicalCode;
      const venue = s.roomCode ?? "TBA";
      return {
        id: `extra-${s.id}`,
        isExtraSession: true,
        day: dayName,
        date: dateStr,
        time: `${s.startTime} - ${s.endTime}`,
        startTime: s.startTime,
        endTime: s.endTime,
        unit: `${unitTitle} (${canonicalCode})`,
        unitCode: canonicalCode,
        unitName: unitTitle,
        type: s.lessonType,
        lessonType: s.lessonType,
        venue,
        roomCode: venue,
        status: "Confirmed",
        lecturer: s.lecturer?.fullName ?? "",
        updatedAt: null,
        updatedBy: null,
        rescheduledTo: null,
        rescheduledVenue: null,
        reschedulePermanent: null,
        reason: null,
        pendingReason: null,
        notifications: 0,
      };
    });

    // extraSessions key — same data the app reads from the dedicated endpoint,
    // provided here so a single GET /api/student/timetable is enough.
    const extraSessionsPayload = extraSessions.map((s) => ({
      id: s.id,
      sessionId: s.id,
      unitCode: normalizeUnitCode(s.unitCode),
      unitName: unitTitleMap[normalizeUnitCode(s.unitCode)] ?? normalizeUnitCode(s.unitCode),
      date: s.date.toISOString().slice(0, 10),
      startTime: s.startTime,
      endTime: s.endTime,
      roomCode: s.roomCode ?? null,
      lessonType: s.lessonType,
      lecturerId: null,
      lecturerName: s.lecturer?.fullName ?? null,
      isExtraSession: true as const,
      status: "Confirmed",
    }));

    return NextResponse.json(
      {
        courseId,
        version,
        updatedAt,
        timetable: [...timetable, ...extraEntries],
        extraSessions: extraSessionsPayload,
      },
      {
        headers: {
          ...corsHeaders,
          ETag: etag,
          "Cache-Control": "private, max-age=0, must-revalidate",
        },
      },
    );
  } catch (err) {
    console.error("[GET /api/student/timetable] error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
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
