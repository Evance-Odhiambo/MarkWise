import { NextRequest, NextResponse } from "next/server";
import { prisma } from '@/lib/prisma';
import { DayOfWeek, TimetableStatus } from "@prisma/client";
import { normalizeUnitCode } from "@/lib/unitCode";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const DOW_TO_STRING: Record<DayOfWeek, string> = {
  MON: "Monday", TUE: "Tuesday", WED: "Wednesday",
  THU: "Thursday", FRI: "Friday", SAT: "Saturday", SUN: "Sunday",
};

const STATUS_MAP: Record<TimetableStatus, string> = {
  DRAFT: "Pending", PUBLISHED: "Confirmed", ARCHIVED: "Archived",
  CANCELLED: "Cancelled", ONLINE: "Online", RESCHEDULED: "Rescheduled",
};

function minutesToHHMM(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const departmentId = searchParams.get('departmentId');
  if (!departmentId) {
    return NextResponse.json(
      { error: 'departmentId is required' },
      { status: 400, headers: corsHeaders }
    );
  }
  try {
    const department = await prisma.department.findUnique({
      where: { id: departmentId },
      select: { institutionId: true }
    });
    if (!department) {
      return NextResponse.json(
        { error: 'Department not found' },
        { status: 404, headers: corsHeaders }
      );
    }

    const [timetableEntries, rooms, courses] = await Promise.all([
      prisma.timetable.findMany({
        where: { unitOffering: { course: { departmentId } } },
        include: {
          unitOffering: {
            include: {
              unit: true,
              course: true,
            },
          },
          sharedSession: {
            include: { room: true },
          },
          lecturer: { select: { id: true, fullName: true, email: true, phoneNumber: true } },
        },
        orderBy: { createdAt: "asc" },
      }),
      prisma.room.findMany({
        where: { institutionId: department.institutionId },
        select: {
          id: true,
          name: true,
          buildingCode: true,
          roomCode: true,
          capacity: true,
        },
      }),
      prisma.course.findMany({
        where: { departmentId },
        select: {
          id: true,
          name: true,
          code: true,
          program: { select: { id: true } }
        }
      })
    ]);

    // Batch yearBlock counts
    const programIds = courses
      .map(c => c.program?.id)
      .filter((id): id is string => !!id);
    const yearBlockCounts = programIds.length > 0
      ? await prisma.yearBlock.groupBy({
          by: ['programId'],
          where: { programId: { in: programIds } },
          _count: { _all: true },
        })
      : [];
    const yearCountMap = new Map(
      yearBlockCounts.map(yb => [yb.programId, yb._count._all])
    );
    const coursesWithDuration = courses.map(course => ({
      id: course.id,
      name: course.name,
      code: course.code,
      durationYears: course.program ? (yearCountMap.get(course.program.id) ?? 0) : 0,
    }));

    // Deduplicate lecturers from timetable entries
    const lecturerMap = new Map<string, { id: string; fullName: string; email: string; phoneNumber: string | null }>();
    for (const entry of timetableEntries) {
      if (entry.lecturer && !lecturerMap.has(entry.lecturer.id)) {
        lecturerMap.set(entry.lecturer.id, entry.lecturer);
      }
    }
    const lecturers = Array.from(lecturerMap.values());

    const timetable = timetableEntries.map(item => {
      const ss = item.sharedSession;
      const uo = item.unitOffering;
      return {
        id: item.id,
        courseId: uo?.courseId ?? null,
        courseName: uo?.course?.name ?? null,
        yearOfStudy: uo?.year?.toString() ?? "",
        semester: uo?.semester?.toString() ?? "",
        unitId: uo?.unitId ?? null,
        unitCode: uo?.unit?.code ? normalizeUnitCode(uo.unit.code) : null,
        unitTitle: uo?.unit?.title ?? null,
        roomId: ss?.roomId ?? null,
        roomName: ss?.room?.name ?? null,
        venueName: ss?.room?.name ?? null,
        lecturerId: item.lecturerId,
        lecturerName: item.lecturer?.fullName ?? null,
        day: ss ? (DOW_TO_STRING[ss.day] ?? ss.day) : "",
        startTime: ss ? minutesToHHMM(ss.startMinute) : "",
        endTime: ss ? minutesToHHMM(ss.endMinute) : "",
        status: STATUS_MAP[item.timetableStatus],
        timetableStatus: item.timetableStatus,
        sharedSessionId: ss?.id ?? null,
        isMerged: ss?.isMerged ?? false,
        department: null,
      };
    });

    return NextResponse.json(
      { timetable, courses: coursesWithDuration, lecturers, rooms },
      { status: 200, headers: corsHeaders }
    );
  } catch (error) {
    const errorMessage = process.env.NODE_ENV === 'development'
      ? `Failed to fetch dashboard data: ${error instanceof Error ? error.message : JSON.stringify(error)}`
      : 'Failed to fetch dashboard data';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500, headers: corsHeaders }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: corsHeaders,
  });
}
