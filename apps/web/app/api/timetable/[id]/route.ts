/**
 * PUT  /api/timetable/[id]  — change lesson status (cancel, reschedule, online, confirm)
 * DELETE /api/timetable/[id] — remove entry and free the room
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveAdminOrLecturerScope } from "@/lib/adminLecturerAuth";
import { verifyLecturerAccessToken } from "@/lib/lecturerAuthJwt";
import { bumpTimetableVersion } from "@/lib/timetableSyncStore";
import { normalizeUnitCode } from "@/lib/unitCode";
import { buildPayloadForLecturer, buildPayloadsForStudentsWithNotifId, sendPushNotificationBatch } from "@/lib/pushNotification";
import { writeUserNotificationForUser, writeUserNotificationsForStudents } from "@/lib/userNotification";
import { sendFcmToTokens, getStudentTokensForUnit, getLecturerTokens } from "@/lib/fcm";
import { DayOfWeek, TimetableStatus } from "@prisma/client";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// ── helpers ───────────────────────────────────────────────────────────────────

function toMinutes(hhmm: string): number | null {
  const [h, m] = hhmm.split(":").map(Number);
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

const ENTRY_INCLUDE = {
  unitOffering: { include: { unit: true, course: true } },
  lecturer: { select: { id: true, fullName: true } },
  sharedSession: { include: { room: true } },
} as const;

function formatEntry(item: {
  id: string; timetableStatus: TimetableStatus; reason: string | null;
  lecturerId: string; originalSharedSessionId: string | null;
  createdAt: Date; updatedAt: Date;
  sharedSession: { id: string; day: DayOfWeek; startMinute: number; endMinute: number; sessionType: string; isMerged: boolean; roomId: string; room: { id: string; name: string; roomCode: string; buildingCode: string } | null } | null;
  unitOffering: { id: string; year: number; semester: number; courseId: string; unit: { id: string; code: string; title: string } | null; course: { id: string; name: string } | null } | null;
  lecturer: { id: string; fullName: string } | null;
}) {
  const ss = item.sharedSession;
  const uo = item.unitOffering;
  return {
    id: item.id,
    status: STATUS_MAP[item.timetableStatus] ?? item.timetableStatus,
    timetableStatus: item.timetableStatus,
    reason: item.reason ?? null,
    day: ss ? (DOW_TO_STRING[ss.day] ?? ss.day) : "",
    startTime: ss ? minutesToHHMM(ss.startMinute) : "",
    endTime: ss ? minutesToHHMM(ss.endMinute) : "",
    startMinute: ss?.startMinute ?? null,
    endMinute: ss?.endMinute ?? null,
    roomId: ss?.roomId ?? null,
    venueName: ss?.room?.name ?? null,
    venue: ss?.room?.name ?? null,
    lectureRoom: ss?.room?.name ?? null,
    roomCode: ss?.room?.roomCode ?? null,
    unitId: uo?.unit?.id ?? null,
    unitCode: uo?.unit?.code ? normalizeUnitCode(uo.unit.code) : "",
    unitTitle: uo?.unit?.title ?? "",
    courseId: uo?.courseId ?? null,
    courseName: uo?.course?.name ?? "",
    yearOfStudy: uo?.year?.toString() ?? "",
    semester: uo?.semester?.toString() ?? "",
    lecturerId: item.lecturerId,
    lecturerName: item.lecturer?.fullName ?? "",
    sharedSessionId: ss?.id ?? null,
    originalSharedSessionId: item.originalSharedSessionId ?? null,
    isMerged: ss?.isMerged ?? false,
    type: ss?.sessionType ?? "LEC",
    lessonType: ss?.sessionType ?? "LEC",
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

// ── PUT ───────────────────────────────────────────────────────────────────────
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  let lecturerId: string | null = null;
  let isAdmin = false;
  try {
    lecturerId = verifyLecturerAccessToken(token).lecturerId;
  } catch {
    const scope = resolveAdminOrLecturerScope(request);
    if (scope.ok) isAdmin = true;
    else return NextResponse.json({ message: "Invalid or expired token" }, { status: 401, headers: corsHeaders });
  }

  const { id } = await context.params;
  const body = await request.json() as Record<string, unknown>;

  // ── Lecturer substitution: PUT { lecturerId } with no status ─────────────
  if ("lecturerId" in body && !body.status) {
    const { lecturerId: newLecturerId } = body as { lecturerId: string };
    if (!newLecturerId) return NextResponse.json({ message: "lecturerId is required" }, { status: 400, headers: corsHeaders });

    const existing = await prisma.timetable.findUnique({ where: { id }, include: ENTRY_INCLUDE });
    if (!existing) return NextResponse.json({ message: "Timetable entry not found." }, { status: 404, headers: corsHeaders });

    const lecturerExists = await prisma.lecturer.findUnique({ where: { id: newLecturerId }, select: { id: true } });
    if (!lecturerExists) return NextResponse.json({ message: "Lecturer not found." }, { status: 404, headers: corsHeaders });

    const updated = await prisma.$transaction(async (tx) => {
      if (existing.sharedSessionId) {
        await tx.sharedSession.update({ where: { id: existing.sharedSessionId }, data: { lecturerId: newLecturerId } });
      }
      return tx.timetable.update({ where: { id }, data: { lecturerId: newLecturerId }, include: ENTRY_INCLUDE });
    });

    const courseId = updated.unitOffering?.courseId;
    if (courseId) bumpTimetableVersion(courseId).catch(() => {});
    return NextResponse.json({ timetable: formatEntry(updated) }, { headers: corsHeaders });
  }

  const {
    status,
    reason,
    rescheduledTo,
    reschedulePermanent,
    roomId: bodyRoomId,
    day: bodyDay,
    startTime: bodyStartTime,
    endTime: bodyEndTime,
    institutionId: bodyInstitutionId,
    campusId: bodyCampusId,
    lessonType,
  } = body as {
    status?: string;
    reason?: string;
    rescheduledTo?: string;
    reschedulePermanent?: boolean;
    roomId?: string;
    day?: string;
    startTime?: string;
    endTime?: string;
    institutionId?: string;
    campusId?: string;
    lessonType?: string;
  };

  if (!status) {
    return NextResponse.json({ message: "status is required." }, { status: 422, headers: corsHeaders });
  }

  const existing = await prisma.timetable.findUnique({ where: { id }, include: ENTRY_INCLUDE });
  if (!existing) {
    return NextResponse.json({ message: "Timetable entry not found." }, { status: 404, headers: corsHeaders });
  }

  if (lecturerId && existing.lecturerId !== lecturerId) {
    return NextResponse.json({ message: "Forbidden." }, { status: 403, headers: corsHeaders });
  }

  const unitId   = existing.unitOffering?.unit?.id ?? "";
  const unitCode = existing.unitOffering?.unit?.code ? normalizeUnitCode(existing.unitOffering.unit.code) : "";
  const courseId = existing.unitOffering?.courseId ?? "";
  const currentSs = existing.sharedSession;

  let updated: typeof existing;

  // ── CONFIRMED ─────────────────────────────────────────────────────────────
  if (status === "Confirmed" || status === "PUBLISHED") {
    updated = await prisma.$transaction(async (tx) => {
      let restoreSessionId = existing.sharedSessionId;

      // If we have an originalSharedSessionId, restore it
      if (existing.originalSharedSessionId) {
        // Delete the temporary rescheduled SharedSession if it exists and is different
        if (existing.sharedSessionId && existing.sharedSessionId !== existing.originalSharedSessionId) {
          const otherEntries = await tx.timetable.count({
            where: { sharedSessionId: existing.sharedSessionId, id: { not: id } },
          });
          if (otherEntries === 0) {
            await tx.sharedSession.delete({ where: { id: existing.sharedSessionId } });
          }
        }
        restoreSessionId = existing.originalSharedSessionId;
      }

      const confirmData: Parameters<typeof tx.timetable.update>[0]["data"] = {
        timetableStatus: "PUBLISHED",
        sharedSessionId: restoreSessionId,
        originalSharedSessionId: null,
        reason: null,
      };
      if (lessonType && restoreSessionId) {
        await tx.sharedSession.update({
          where: { id: restoreSessionId },
          data: { sessionType: lessonType as import("@prisma/client").SessionType },
        });
      }
      return tx.timetable.update({ where: { id }, data: confirmData, include: ENTRY_INCLUDE });
    });

  // ── PENDING (draft/revert) ─────────────────────────────────────────────────
  } else if (status === "Pending" || status === "DRAFT") {
    updated = await prisma.$transaction(async (tx) => {
      let restoreSessionId = existing.sharedSessionId;
      if (existing.originalSharedSessionId) {
        if (existing.sharedSessionId && existing.sharedSessionId !== existing.originalSharedSessionId) {
          const otherEntries = await tx.timetable.count({
            where: { sharedSessionId: existing.sharedSessionId, id: { not: id } },
          });
          if (otherEntries === 0) {
            await tx.sharedSession.delete({ where: { id: existing.sharedSessionId } });
          }
        }
        restoreSessionId = existing.originalSharedSessionId;
      }
      return tx.timetable.update({
        where: { id },
        data: {
          timetableStatus: "DRAFT",
          sharedSessionId: restoreSessionId,
          originalSharedSessionId: null,
          reason: null,
        },
        include: ENTRY_INCLUDE,
      });
    });

  // ── ONLINE ─────────────────────────────────────────────────────────────────
  } else if (status === "Online" || status === "ONLINE") {
    // Free the room: set sharedSessionId=null, save original for restoration
    updated = await prisma.timetable.update({
      where: { id },
      data: {
        timetableStatus: "ONLINE",
        originalSharedSessionId: existing.originalSharedSessionId ?? existing.sharedSessionId,
        sharedSessionId: null,
        reason: (reason?.trim()) || null,
      },
      include: ENTRY_INCLUDE,
    });

  // ── CANCELLED ─────────────────────────────────────────────────────────────
  } else if (status === "Cancelled" || status === "CANCELLED") {
    if (!reason?.trim()) {
      return NextResponse.json({ message: "Cancellation reason is required." }, { status: 422, headers: corsHeaders });
    }
    // Free the room
    updated = await prisma.timetable.update({
      where: { id },
      data: {
        timetableStatus: "CANCELLED",
        originalSharedSessionId: existing.originalSharedSessionId ?? existing.sharedSessionId,
        sharedSessionId: null,
        reason: reason.trim(),
      },
      include: ENTRY_INCLUDE,
    });

  // ── RESCHEDULED ───────────────────────────────────────────────────────────
  } else if (status === "Rescheduled" || status === "RESCHEDULED") {
    // Need new room + time
    const newRoomId   = bodyRoomId ?? currentSs?.roomId;
    const newDayStr   = bodyDay ?? (currentSs ? DOW_TO_STRING[currentSs.day] : undefined);
    const newStart    = bodyStartTime ?? (currentSs ? minutesToHHMM(currentSs.startMinute) : undefined);
    const newEnd      = bodyEndTime   ?? (currentSs ? minutesToHHMM(currentSs.endMinute)   : undefined);

    if (!newRoomId || !newDayStr || !newStart || !newEnd) {
      // Try to parse from rescheduledTo string "Wednesday 10:00 - 12:00"
      const parsed = rescheduledTo?.trim().match(/^(\w+)\s+(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})(?:\s*·\s*(.+))?$/i);
      if (!parsed && !newRoomId) {
        return NextResponse.json(
          { message: "Rescheduling requires roomId, day, startTime, and endTime." },
          { status: 422, headers: corsHeaders },
        );
      }
    }

    const effectiveDayStr = bodyDay
      ?? rescheduledTo?.trim().match(/^(\w+)\s+/)?.[1]
      ?? (currentSs ? DOW_TO_STRING[currentSs.day] : "");

    const rescheduledMatch = rescheduledTo?.trim().match(/^(\w+)\s+(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})(?:\s*·\s*(.+))?$/i);
    const effectiveStart = bodyStartTime ?? rescheduledMatch?.[2] ?? (currentSs ? minutesToHHMM(currentSs.startMinute) : "");
    const effectiveEnd   = bodyEndTime   ?? rescheduledMatch?.[3] ?? (currentSs ? minutesToHHMM(currentSs.endMinute)   : "");
    const newStart2 = toMinutes(effectiveStart);
    const newEnd2   = toMinutes(effectiveEnd);

    if (!newStart2 || !newEnd2 || newStart2 >= newEnd2) {
      return NextResponse.json({ message: "Invalid reschedule time." }, { status: 422, headers: corsHeaders });
    }

    const newDow = STRING_TO_DOW[effectiveDayStr.toLowerCase()];
    if (!newDow) {
      return NextResponse.json({ message: `Invalid day: ${effectiveDayStr}` }, { status: 422, headers: corsHeaders });
    }

    let resolvedRoomId: string = bodyRoomId ?? currentSs?.roomId ?? "";
    if (!resolvedRoomId && rescheduledMatch?.[4]) {
      const room = await prisma.room.findFirst({
        where: { roomCode: { equals: rescheduledMatch[4], mode: "insensitive" } },
        select: { id: true },
      });
      resolvedRoomId = room?.id ?? "";
    }
    if (!resolvedRoomId) {
      return NextResponse.json({ message: "roomId is required for rescheduling." }, { status: 422, headers: corsHeaders });
    }

    // Resolve campus for the new room
    const roomData = await prisma.room.findUnique({
      where: { id: resolvedRoomId },
      select: {
        institutionId: true,
        buildingFloor: { select: { building: { select: { campusId: true } } } },
      },
    });
    const resolvedInstId = bodyInstitutionId ?? roomData?.institutionId ?? existing.sharedSession?.institutionId ?? "";
    let resolvedCampusId = bodyCampusId ?? roomData?.buildingFloor?.building?.campusId ?? "";
    if (!resolvedCampusId && resolvedInstId) {
      const campus = await prisma.campus.findFirst({ where: { institutionId: resolvedInstId }, select: { id: true } });
      resolvedCampusId = campus?.id ?? "";
    }

    updated = await prisma.$transaction(async (tx) => {
      // Create new SharedSession for the rescheduled time/room
      const newSs = await tx.sharedSession.create({
        data: {
          institutionId: resolvedInstId || existing.sharedSession?.institutionId || "",
          campusId: resolvedCampusId,
          roomId: resolvedRoomId,
          lecturerId: existing.lecturerId,
          day: newDow,
          startMinute: newStart2,
          endMinute: newEnd2,
          sessionType: (currentSs?.sessionType as never) ?? "LEC",
        },
      });

      const saveOriginal = existing.originalSharedSessionId ?? existing.sharedSessionId;

      // If permanent reschedule, also update the original SharedSession
      if (reschedulePermanent && existing.sharedSessionId) {
        const otherEntries = await tx.timetable.count({
          where: { sharedSessionId: existing.sharedSessionId, id: { not: id } },
        });
        if (otherEntries === 0) {
          // Original session is only for this entry — delete it (new one is the permanent replacement)
          await tx.sharedSession.delete({ where: { id: existing.sharedSessionId } });
        }
      }

      return tx.timetable.update({
        where: { id },
        data: {
          timetableStatus: "RESCHEDULED",
          sharedSessionId: newSs.id,
          originalSharedSessionId: reschedulePermanent ? null : saveOriginal,
          reason: rescheduledTo?.trim() ?? null,
        },
        include: ENTRY_INCLUDE,
      });
    });

  } else {
    return NextResponse.json({ message: `Unknown status: ${status}` }, { status: 422, headers: corsHeaders });
  }

  // Bump version
  if (courseId) bumpTimetableVersion(courseId).catch((err) => console.error("[timetable/PUT] version:", err));

  // ── Notifications ─────────────────────────────────────────────────────────
  const normalStatus = (STATUS_MAP[updated.timetableStatus] ?? updated.timetableStatus);
  const FCM_PUSH_STATUSES = ["Cancelled", "Rescheduled", "Online", "Confirmed"];
  if (unitCode && FCM_PUSH_STATUSES.includes(normalStatus)) {
    let fcmType = "";
    let fcmTitle = "";
    let fcmBody = "";
    const displayDay = updated.sharedSession ? (DOW_TO_STRING[updated.sharedSession.day] ?? "") : "";

    if (normalStatus === "Cancelled") {
      fcmType = "LESSON_CANCELLED";
      fcmTitle = `${unitCode} — Lesson Cancelled`;
      fcmBody = `Your ${unitCode} class has been cancelled.${reason ? ` Reason: ${reason}` : ""}`;
    } else if (normalStatus === "Rescheduled") {
      const newStart = updated.sharedSession ? minutesToHHMM(updated.sharedSession.startMinute) : "";
      const newEnd   = updated.sharedSession ? minutesToHHMM(updated.sharedSession.endMinute)   : "";
      fcmType = "LESSON_RESCHEDULED";
      fcmTitle = `${unitCode} — Lesson Rescheduled`;
      fcmBody = `Your ${unitCode} class has been moved to ${displayDay} ${newStart}–${newEnd}${reschedulePermanent ? " (permanent)" : ""}.`;
    } else if (normalStatus === "Online") {
      fcmType = "LESSON_ONLINE";
      fcmTitle = `${unitCode} — Class Moving Online`;
      fcmBody = `Your ${unitCode} class will be held online.`;
    } else if (normalStatus === "Confirmed") {
      fcmType = "LESSON_CONFIRMED";
      fcmTitle = `${unitCode} — Lesson Confirmed`;
      fcmBody = `Your ${unitCode} class on ${displayDay} is confirmed.`;
    }

    if (fcmType) {
      ;(async () => {
        try {
          const enrollments = await prisma.enrollment.findMany({
            where: { unitId },
            select: { studentId: true },
          });
          const studentIds = [...new Set(enrollments.map((e) => e.studentId))];
          const inboxData: Record<string, string> = { type: fcmType, unitCode, entryId: id };
          const inboxInput = { type: fcmType, title: fcmTitle, body: fcmBody, data: inboxData as Record<string, unknown> };
          const [notifIds, lecturerNotifId] = await Promise.all([
            writeUserNotificationsForStudents(studentIds, inboxInput),
            existing.lecturerId ? writeUserNotificationForUser(existing.lecturerId, inboxInput) : Promise.resolve(null),
          ]);
          const [studentPayloads, lecturerPayload] = await Promise.all([
            buildPayloadsForStudentsWithNotifId(studentIds, { title: fcmTitle, body: fcmBody, data: inboxData }, notifIds),
            existing.lecturerId
              ? buildPayloadForLecturer(existing.lecturerId, { title: fcmTitle, body: fcmBody, data: { ...inboxData, notificationId: lecturerNotifId ?? "" } })
              : Promise.resolve(null),
          ]);
          const all = lecturerPayload ? [...studentPayloads, lecturerPayload] : studentPayloads;
          await sendPushNotificationBatch(all);
        } catch (err) {
          console.error("[timetable/PUT] notifications:", err);
        }
      })();
    }
  }

  return NextResponse.json(
    { message: "Timetable entry updated.", entry: formatEntry(updated) },
    { headers: corsHeaders },
  );
}

// ── DELETE ────────────────────────────────────────────────────────────────────
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const scope = resolveAdminOrLecturerScope(_request);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status, headers: corsHeaders });
  }

  const { id } = await context.params;

  const entry = await prisma.timetable.findUnique({
    where: { id },
    include: { unitOffering: { select: { courseId: true, unitId: true } }, sharedSession: true },
  });
  if (!entry) {
    return NextResponse.json({ error: "Timetable entry not found." }, { status: 404, headers: corsHeaders });
  }

  const courseId = entry.unitOffering?.courseId ?? "";
  const unitId   = entry.unitOffering?.unitId ?? "";

  await prisma.$transaction(async (tx) => {
    await tx.timetable.delete({ where: { id } });

    // Clean up SharedSession if no other entries use it
    if (entry.sharedSessionId) {
      const others = await tx.timetable.count({ where: { sharedSessionId: entry.sharedSessionId } });
      if (others === 0) {
        await tx.sharedSession.delete({ where: { id: entry.sharedSessionId } });
      }
    }
  });

  const versionRecord = courseId ? await bumpTimetableVersion(courseId) : null;

  // FCM fire-and-forget
  ;(async () => {
    try {
      if (!unitId) return;
      const [studentTokens, lecturerTokens] = await Promise.all([
        getStudentTokensForUnit(unitId),
        entry.lecturerId ? getLecturerTokens(entry.lecturerId) : Promise.resolve([]),
      ]);
      const allTokens = [...studentTokens, ...lecturerTokens];
      if (allTokens.length) {
        await sendFcmToTokens(allTokens, "LESSON_CANCELLED", "Class Removed", "A class has been removed from your timetable.", { entryId: id });
      }
    } catch (err) {
      console.error("[timetable/DELETE] FCM:", err);
    }
  })();

  return NextResponse.json(
    { success: true, version: versionRecord?.version ?? null },
    { headers: corsHeaders },
  );
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}
