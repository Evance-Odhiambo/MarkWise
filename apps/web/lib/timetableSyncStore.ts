import { prisma } from "@/lib/prisma";
import { publishTimetableUpdatedEvent } from "@/lib/timetableEvents";

/**
 * Bump the TimetableVersion for a course so mobile clients detect the change
 * via ETag / If-None-Match polling.  Fire-and-forget safe.
 */
export async function bumpTimetableVersion(courseId: string) {
  const now = new Date();
  const versionRecord = await prisma.timetableVersion.upsert({
    where: { courseId },
    update: { version: { increment: 1 }, updatedAt: now },
    create: { courseId, version: 1, updatedAt: now },
  });

  publishTimetableUpdatedEvent({
    courseId,
    version: versionRecord.version,
    updatedAt: versionRecord.updatedAt.toISOString(),
  });

  return versionRecord;
}

type CourseTimetableVersion = {
  version: number;
  updatedAt: string;
};

/** Minutes-from-midnight → "HH:MM" string */
function minutesToHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

const buildCourseSnapshot = async (courseId: string) => {
  const [entries, versionRecord] = await Promise.all([
    prisma.timetable.findMany({
      where: { unitOffering: { courseId } },
      include: {
        unitOffering: {
          include: {
            unit: { select: { code: true, title: true } },
            course: { select: { name: true } },
          },
        },
        sharedSession: {
          include: {
            room: { select: { name: true, roomCode: true, buildingCode: true } },
          },
        },
        lecturer: { select: { fullName: true } },
      },
    }),
    prisma.timetableVersion.findUnique({ where: { courseId } }),
  ]);

  const filtered = entries.map((entry) => {
    const ss = entry.sharedSession;
    return {
      id: entry.id,
      courseId,
      day: ss?.day ?? "",
      startTime: ss?.startMinute != null ? minutesToHHMM(ss.startMinute) : "",
      endTime:   ss?.endMinute   != null ? minutesToHHMM(ss.endMinute)   : "",
      unitCode:  entry.unitOffering?.unit?.code  ?? "",
      unitName:  entry.unitOffering?.unit?.title ?? "",
      venue:     ss?.room?.name ?? "",
      lecturer:  entry.lecturer?.fullName ?? "",
      updatedAt: entry.updatedAt?.toISOString() ?? entry.createdAt.toISOString(),
    };
  });

  const version   = versionRecord?.version ?? 0;
  const updatedAt = versionRecord?.updatedAt?.toISOString() ?? "";

  return { courseId, version, updatedAt, timetable: filtered };
};

export async function getCourseTimetableSnapshot(courseId: string) {
  return buildCourseSnapshot(courseId);
}

export async function createCourseTimetableEntry(input: { courseId: string }) {
  const versionRecord = await bumpTimetableVersion(input.courseId);
  const nextVersion: CourseTimetableVersion = {
    version: versionRecord.version,
    updatedAt: versionRecord.updatedAt.toISOString(),
  };
  return { ok: true as const, version: nextVersion };
}

export async function updateCourseTimetableEntry(entryId: string, _input: Record<string, unknown>) {
  const dbEntry = await prisma.timetable.findUnique({
    where: { id: entryId },
    select: { id: true, unitOffering: { select: { courseId: true } } },
  });

  if (!dbEntry) {
    return { ok: false as const, status: 404, error: "Timetable entry not found." };
  }

  const courseId = dbEntry.unitOffering?.courseId?.trim() ?? "";
  if (!courseId) {
    return {
      ok: false as const,
      status: 400,
      error: "Timetable entry has no unit offering. Migrate legacy entries before editing.",
    };
  }

  const versionRecord = await bumpTimetableVersion(courseId);
  return {
    ok: true as const,
    version: { version: versionRecord.version, updatedAt: versionRecord.updatedAt.toISOString() } satisfies CourseTimetableVersion,
  };
}

export async function deleteCourseTimetableEntry(entryId: string) {
  const dbEntry = await prisma.timetable.findUnique({
    where: { id: entryId },
    select: { id: true, unitOffering: { select: { courseId: true } } },
  });

  if (!dbEntry) {
    return { ok: false as const, status: 404, error: "Timetable entry not found." };
  }

  const courseId = dbEntry.unitOffering?.courseId?.trim() ?? "";
  if (!courseId) {
    return {
      ok: false as const,
      status: 400,
      error: "Timetable entry has no unit offering. Migrate legacy entries before deleting.",
    };
  }

  const versionRecord = await bumpTimetableVersion(courseId);
  return {
    ok: true as const,
    version: { version: versionRecord.version, updatedAt: versionRecord.updatedAt.toISOString() } satisfies CourseTimetableVersion,
  };
}
