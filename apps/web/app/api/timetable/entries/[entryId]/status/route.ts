/**
 * PATCH /api/timetable/entries/:entryId/status
 *
 * Mobile-app–facing endpoint for status changes.
 * rescheduledTo is received as { day, startTime, endTime } object.
 */
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyLecturerAccessToken } from "@/lib/lecturerAuthJwt";
import { resolveAdminOrLecturerScope } from "@/lib/adminLecturerAuth";
import { broadcastTimetableEvent } from "@/lib/timetableSseStore";
import { bumpTimetableVersion } from "@/lib/timetableSyncStore";
import { buildPayloadForLecturer, buildPayloadsForStudentsWithNotifId, sendPushNotificationBatch } from "@/lib/pushNotification";
import { writeUserNotificationForUser, writeUserNotificationsForStudents } from "@/lib/userNotification";
import { DayOfWeek, TimetableStatus } from "@prisma/client";
import { normalizeUnitCode } from "@/lib/unitCode";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const DOW_TO_STRING: Record<DayOfWeek, string> = {
  MON: "Monday", TUE: "Tuesday", WED: "Wednesday",
  THU: "Thursday", FRI: "Friday", SAT: "Saturday", SUN: "Sunday",
};
const STRING_TO_DOW: Record<string, DayOfWeek> = {
  monday: "MON", tuesday: "TUE", wednesday: "WED",
  thursday: "THU", friday: "FRI", saturday: "SAT", sunday: "SUN",
  mon: "MON", tue: "TUE", wed: "WED", thu: "THU", fri: "FRI", sat: "SAT", sun: "SUN",
};
const STATUS_MAP: Record<TimetableStatus, string> = {
  DRAFT: "Pending", PUBLISHED: "Confirmed", ARCHIVED: "Archived",
  CANCELLED: "Cancelled", ONLINE: "Online", RESCHEDULED: "Rescheduled",
};

function minutesToHHMM(m: number) {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
function toMinutes(hhmm: string): number | null {
  const [h, m] = hhmm.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

const ENTRY_INCLUDE = {
  unitOffering: { include: { unit: true, course: true } },
  lecturer: { select: { id: true, fullName: true } },
  sharedSession: { include: { room: true } },
} as const;

function buildEntryResponse(item: {
  id: string; timetableStatus: TimetableStatus; reason: string | null;
  lecturerId: string; originalSharedSessionId: string | null;
  createdAt: Date; updatedAt: Date;
  sharedSession: { id: string; day: DayOfWeek; startMinute: number; endMinute: number; sessionType: string; isMerged: boolean; roomId: string; room: { id: string; name: string; roomCode: string; buildingCode: string } | null } | null;
  unitOffering: { id: string; year: number; semester: number; courseId: string; unitId: string; unit: { id: string; code: string; title: string } | null; course: { id: string; name: string } | null } | null;
  lecturer: { id: string; fullName: string } | null;
}) {
  const ss = item.sharedSession;
  const uo = item.unitOffering;
  const startTime = ss ? minutesToHHMM(ss.startMinute) : "";
  const endTime   = ss ? minutesToHHMM(ss.endMinute)   : "";
  const dayStr    = ss ? DOW_TO_STRING[ss.day] : "";
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
    venueName: ss?.room?.name ?? null,
    venue: ss?.room?.name ?? null,
    lectureRoom: ss?.room?.name ?? null,
    roomCode: ss?.room?.roomCode ?? null,
    roomId: ss?.roomId ?? null,
    type: ss?.sessionType ?? "LEC",
    lessonType: ss?.sessionType ?? "LEC",
    lecturerId: item.lecturerId,
    lecturerName: item.lecturer?.fullName ?? "",
    status: STATUS_MAP[item.timetableStatus] ?? item.timetableStatus,
    timetableStatus: item.timetableStatus,
    reason: item.reason ?? null,
    yearOfStudy: uo?.year?.toString() ?? "",
    semester: uo?.semester?.toString() ?? "",
    sharedSessionId: ss?.id ?? null,
    isMerged: ss?.isMerged ?? false,
    updatedAt: item.updatedAt.toISOString(),
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ entryId: string }> },
) {
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });

  let lecturerId: string | null = null;
  let isAdmin = false;
  try {
    lecturerId = verifyLecturerAccessToken(token).lecturerId;
  } catch {
    const scope = resolveAdminOrLecturerScope(request);
    if (scope.ok) isAdmin = true;
    else return NextResponse.json({ error: "Invalid or expired token" }, { status: 401, headers: corsHeaders });
  }

  const { entryId } = await context.params;

  let body: {
    status: string;
    reason?: string;
    rescheduledTo?: { day: string; startTime: string; endTime: string };
    reschedulePermanent?: boolean;
    roomId?: string;
    lessonType?: string;
  };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: corsHeaders });
  }

  const { status, reason, rescheduledTo, reschedulePermanent, roomId: bodyRoomId, lessonType } = body;

  if (!status) return NextResponse.json({ error: "status is required" }, { status: 400, headers: corsHeaders });
  if (status === "Cancelled" && !reason?.trim()) {
    return NextResponse.json({ error: "reason is required when status is Cancelled" }, { status: 400, headers: corsHeaders });
  }
  if (status === "Rescheduled" && (!rescheduledTo?.day || !rescheduledTo?.startTime || !rescheduledTo?.endTime)) {
    return NextResponse.json({ error: "rescheduledTo { day, startTime, endTime } is required for rescheduling" }, { status: 400, headers: corsHeaders });
  }

  const existing = await prisma.timetable.findUnique({ where: { id: entryId }, include: ENTRY_INCLUDE });
  if (!existing) return NextResponse.json({ error: "Timetable entry not found" }, { status: 404, headers: corsHeaders });

  if (lecturerId && !isAdmin && existing.lecturerId !== lecturerId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: corsHeaders });
  }

  const currentSs = existing.sharedSession;
  const courseId = existing.unitOffering?.courseId ?? "";
  const unitId   = existing.unitOffering?.unitId ?? "";
  const unitCode = existing.unitOffering?.unit?.code ? normalizeUnitCode(existing.unitOffering.unit.code) : "";

  let updated: typeof existing;

  if (status === "Confirmed" || status === "PUBLISHED") {
    updated = await prisma.$transaction(async (tx) => {
      let restoreId = existing.sharedSessionId;
      if (existing.originalSharedSessionId) {
        if (existing.sharedSessionId && existing.sharedSessionId !== existing.originalSharedSessionId) {
          const others = await tx.timetable.count({ where: { sharedSessionId: existing.sharedSessionId, id: { not: entryId } } });
          if (others === 0) await tx.sharedSession.delete({ where: { id: existing.sharedSessionId } });
        }
        restoreId = existing.originalSharedSessionId;
      }
      if (lessonType && restoreId) {
        await tx.sharedSession.update({ where: { id: restoreId }, data: { sessionType: lessonType as import("@prisma/client").SessionType } });
      }
      return tx.timetable.update({ where: { id: entryId }, data: { timetableStatus: "PUBLISHED", sharedSessionId: restoreId, originalSharedSessionId: null, reason: null }, include: ENTRY_INCLUDE });
    });

  } else if (status === "Pending" || status === "DRAFT") {
    updated = await prisma.$transaction(async (tx) => {
      let restoreId = existing.sharedSessionId;
      if (existing.originalSharedSessionId) {
        if (existing.sharedSessionId && existing.sharedSessionId !== existing.originalSharedSessionId) {
          const others = await tx.timetable.count({ where: { sharedSessionId: existing.sharedSessionId, id: { not: entryId } } });
          if (others === 0) await tx.sharedSession.delete({ where: { id: existing.sharedSessionId } });
        }
        restoreId = existing.originalSharedSessionId;
      }
      return tx.timetable.update({ where: { id: entryId }, data: { timetableStatus: "DRAFT", sharedSessionId: restoreId, originalSharedSessionId: null, reason: null }, include: ENTRY_INCLUDE });
    });

  } else if (status === "Online" || status === "ONLINE") {
    updated = await prisma.timetable.update({
      where: { id: entryId },
      data: { timetableStatus: "ONLINE", originalSharedSessionId: existing.originalSharedSessionId ?? existing.sharedSessionId, sharedSessionId: null, reason: reason?.trim() || null },
      include: ENTRY_INCLUDE,
    });

  } else if (status === "Cancelled" || status === "CANCELLED") {
    updated = await prisma.timetable.update({
      where: { id: entryId },
      data: { timetableStatus: "CANCELLED", originalSharedSessionId: existing.originalSharedSessionId ?? existing.sharedSessionId, sharedSessionId: null, reason: reason!.trim() },
      include: ENTRY_INCLUDE,
    });

  } else if (status === "Rescheduled" || status === "RESCHEDULED") {
    const { day: newDayStr, startTime: newStart, endTime: newEnd } = rescheduledTo!;
    const newDow = STRING_TO_DOW[newDayStr.toLowerCase()];
    const newStartMin = toMinutes(newStart);
    const newEndMin   = toMinutes(newEnd);

    if (!newDow || !newStartMin || !newEndMin) {
      return NextResponse.json({ error: "Invalid reschedule day/time." }, { status: 400, headers: corsHeaders });
    }

    // Resolve room
    let resolvedRoomId = bodyRoomId ?? currentSs?.roomId ?? "";
    const roomData = resolvedRoomId ? await prisma.room.findUnique({
      where: { id: resolvedRoomId },
      select: { institutionId: true, buildingFloor: { select: { building: { select: { campusId: true } } } } },
    }) : null;

    const instId    = roomData?.institutionId ?? currentSs?.institutionId ?? "";
    let campusId    = roomData?.buildingFloor?.building?.campusId ?? currentSs?.campusId ?? "";
    if (!campusId && instId) {
      const c = await prisma.campus.findFirst({ where: { institutionId: instId }, select: { id: true } });
      campusId = c?.id ?? "";
    }

    updated = await prisma.$transaction(async (tx) => {
      const newSs = await tx.sharedSession.create({
        data: {
          institutionId: instId,
          campusId,
          roomId: resolvedRoomId,
          lecturerId: existing.lecturerId,
          day: newDow,
          startMinute: newStartMin,
          endMinute: newEndMin,
          sessionType: (currentSs?.sessionType as import("@prisma/client").SessionType | undefined) ?? "LEC",
        },
      });
      const saveOriginal = existing.originalSharedSessionId ?? existing.sharedSessionId;
      if (reschedulePermanent && existing.sharedSessionId) {
        const others = await tx.timetable.count({ where: { sharedSessionId: existing.sharedSessionId, id: { not: entryId } } });
        if (others === 0) await tx.sharedSession.delete({ where: { id: existing.sharedSessionId } });
      }
      return tx.timetable.update({
        where: { id: entryId },
        data: { timetableStatus: "RESCHEDULED", sharedSessionId: newSs.id, originalSharedSessionId: reschedulePermanent ? null : saveOriginal, reason: `${newDayStr} ${newStart} - ${newEnd}` },
        include: ENTRY_INCLUDE,
      });
    });

  } else {
    return NextResponse.json({ error: `Unknown status: ${status}` }, { status: 400, headers: corsHeaders });
  }

  if (courseId) bumpTimetableVersion(courseId).catch(() => {});

  // SSE broadcast
  const updatedSs = updated.sharedSession;
  if (unitCode) {
    broadcastTimetableEvent(unitCode, {
      event: "timetable.updated",
      entryId: updated.id,
      unitCode,
      day: updatedSs ? DOW_TO_STRING[updatedSs.day] : "",
      startTime: updatedSs ? minutesToHHMM(updatedSs.startMinute) : "",
      endTime: updatedSs ? minutesToHHMM(updatedSs.endMinute) : "",
      status: STATUS_MAP[updated.timetableStatus],
      reason: updated.reason ?? null,
      updatedAt: updated.updatedAt.toISOString(),
    });
  }

  // Notifications (fire-and-forget)
  if (unitCode && ["CANCELLED", "RESCHEDULED", "ONLINE"].includes(updated.timetableStatus)) {
    let fcmType = "", fcmTitle = "", fcmBody = "";
    if (updated.timetableStatus === "CANCELLED") {
      fcmType = "LESSON_CANCELLED"; fcmTitle = `${unitCode} — Lesson Cancelled`;
      fcmBody = `Your ${unitCode} class has been cancelled.${reason ? ` Reason: ${reason}` : ""}`;
    } else if (updated.timetableStatus === "RESCHEDULED") {
      const nd = rescheduledTo!;
      fcmType = "LESSON_RESCHEDULED"; fcmTitle = `${unitCode} — Lesson Rescheduled`;
      fcmBody = `Your ${unitCode} class has been rescheduled to ${nd.day} ${nd.startTime}–${nd.endTime}${reschedulePermanent ? " (permanent)" : ""}.`;
    } else {
      fcmType = "LESSON_ONLINE"; fcmTitle = `${unitCode} — Class Moving Online`;
      fcmBody = `Your ${unitCode} class will be held online.`;
    }

    ;(async () => {
      try {
        const enrollments = await prisma.enrollment.findMany({ where: { unitId }, select: { studentId: true } });
        const studentIds = [...new Set(enrollments.map((e) => e.studentId))];
        const inboxData: Record<string, string> = { type: fcmType, unitCode, entryId: updated.id };
        const inboxInput = { type: fcmType, title: fcmTitle, body: fcmBody, data: inboxData as Record<string, unknown> };
        const [notifIds, lecturerNotifId] = await Promise.all([
          writeUserNotificationsForStudents(studentIds, inboxInput),
          updated.lecturerId ? writeUserNotificationForUser(updated.lecturerId, inboxInput) : Promise.resolve(null),
        ]);
        const msgPayload = { title: fcmTitle, body: fcmBody, data: inboxData };
        const [studentPayloads, lecturerPayload] = await Promise.all([
          buildPayloadsForStudentsWithNotifId(studentIds, msgPayload, notifIds),
          updated.lecturerId ? buildPayloadForLecturer(updated.lecturerId, { ...msgPayload, data: { ...inboxData, notificationId: lecturerNotifId ?? "" } }) : Promise.resolve(null),
        ]);
        const all = lecturerPayload ? [...studentPayloads, lecturerPayload] : studentPayloads;
        await sendPushNotificationBatch(all);
      } catch (err) {
        console.error("[PATCH status] notifications:", err);
      }
    })();
  }

  return NextResponse.json({ updatedEntry: buildEntryResponse(updated) }, { headers: corsHeaders });
}
