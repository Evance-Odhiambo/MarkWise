import { prisma } from "@/lib/prisma";

/** Minutes-from-midnight → "HH:MM" */
function minutesToHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export type TimetableEntry = {
  id: string;
  courseId?: string;
  courseName?: string;
  year?: number;
  semester?: number;
  unitCode: string;
  unitTitle: string;
  venueName?: string;
  lecturerId: string;
  lecturerName: string;
  day: string;
  startTime: string;
  endTime: string;
  startMinute?: number;
  endMinute?: number;
  campusId?: string;
  roomId?: string;
  timetableStatus: string;
  createdAt: string;
  updatedAt?: string;
};

export async function getTimetableEntries(): Promise<TimetableEntry[]> {
  const entries = await prisma.timetable.findMany({
    include: {
      unitOffering: {
        include: {
          unit: { select: { code: true, title: true } },
          course: { select: { name: true } },
        },
      },
      sharedSession: {
        include: {
          room: { select: { name: true, roomCode: true } },
        },
      },
      lecturer: { select: { id: true, fullName: true } },
    },
  });

  return entries.map((item) => {
    const ss = item.sharedSession;
    return {
      id: item.id,
      courseId:        item.unitOffering?.courseId,
      courseName:      item.unitOffering?.course?.name,
      year:            item.unitOffering?.year,
      semester:        item.unitOffering?.semester,
      unitCode:        item.unitOffering?.unit?.code  ?? "",
      unitTitle:       item.unitOffering?.unit?.title ?? "",
      venueName:       ss?.room?.name ?? undefined,
      lecturerId:      item.lecturerId,
      lecturerName:    item.lecturer?.fullName ?? "",
      day:             ss?.day ?? "",
      startTime:       ss?.startMinute != null ? minutesToHHMM(ss.startMinute) : "",
      endTime:         ss?.endMinute   != null ? minutesToHHMM(ss.endMinute)   : "",
      startMinute:     ss?.startMinute ?? undefined,
      endMinute:       ss?.endMinute   ?? undefined,
      campusId:        ss?.campusId    ?? undefined,
      roomId:          ss?.roomId      ?? undefined,
      timetableStatus: item.timetableStatus,
      createdAt:       item.createdAt.toISOString(),
      updatedAt:       item.updatedAt?.toISOString() ?? undefined,
    };
  });
}
