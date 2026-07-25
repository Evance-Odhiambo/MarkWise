import { NextResponse, type NextRequest } from 'next/server';
import { verifyLecturerAccessToken } from '@/lib/lecturerAuthJwt';
import { prisma } from '@/lib/prisma';
import { normalizeUnitCode } from '@/lib/unitCode';
import { DayOfWeek, TimetableStatus } from '@prisma/client';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const DOW_TO_STRING: Record<DayOfWeek, string> = {
  MON: 'Monday', TUE: 'Tuesday', WED: 'Wednesday',
  THU: 'Thursday', FRI: 'Friday', SAT: 'Saturday', SUN: 'Sunday',
};

const STATUS_MAP: Record<TimetableStatus, string> = {
  DRAFT: 'Pending', PUBLISHED: 'Confirmed', ARCHIVED: 'Archived',
  CANCELLED: 'Cancelled', ONLINE: 'Online', RESCHEDULED: 'Rescheduled',
};

function minutesToHHMM(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ?? '';
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
  }

  let lecturerId: string;
  try {
    ({ lecturerId } = verifyLecturerAccessToken(token));
  } catch {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401, headers: corsHeaders });
  }

  try {
    const entries = await prisma.timetable.findMany({
      where: { lecturerId },
      include: {
        unitOffering: { include: { unit: true, course: { include: { department: true } } } },
        sharedSession: { include: { room: true } },
        lecturer: { select: { fullName: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const result = entries.map(entry => {
      const ss = entry.sharedSession;
      const uo = entry.unitOffering;
      const dayStr = ss ? (DOW_TO_STRING[ss.day] ?? ss.day) : '';
      const startTime = ss ? minutesToHHMM(ss.startMinute) : '';
      const endTime   = ss ? minutesToHHMM(ss.endMinute)   : '';

      return {
        id: entry.id,
        unitId:    uo?.unitId ?? null,
        unitCode:  uo?.unit?.code ? normalizeUnitCode(uo.unit.code) : '',
        unitName:  uo?.unit?.title ?? '',
        unitTitle: uo?.unit?.title ?? '',
        courseId:   uo?.courseId ?? null,
        courseName: uo?.course?.name ?? '',
        courseCode: uo?.course?.code ?? '',
        departmentId:  uo?.course?.departmentId ?? null,
        department: uo?.course?.department
          ? { id: uo.course.department.id, name: uo.course.department.name }
          : null,
        day:       dayStr,
        startAt:   startTime,
        endAt:     endTime,
        startTime,
        endTime,
        roomId:       ss?.roomId ?? null,
        room:         ss?.room?.name ?? '',
        venue:        ss?.room?.name ?? '',
        venueName:    ss?.room?.name ?? '',
        roomName:     ss?.room?.name ?? '',
        roomCode:     ss?.room?.roomCode ?? '',
        buildingCode: ss?.room?.buildingCode ?? '',
        status:              STATUS_MAP[entry.timetableStatus] ?? entry.timetableStatus,
        reason:              entry.reason ?? null,
        pendingReason:       null,
        rescheduledTo:       null,
        reschedulePermanent: null,
        originalDay:         null,
        originalStartTime:   null,
        originalEndTime:     null,
        updatedBy:           null,
        updatedAt:           entry.updatedAt?.toISOString() ?? null,
        yearOfStudy:   uo?.year?.toString() ?? '',
        semester:      uo?.semester?.toString() ?? '',
        semesterLabel: uo?.semester?.toString() ?? '',
        lecturerId:    entry.lecturerId,
        isMerged:    ss?.isMerged ?? false,
        sharedSessionId: ss?.id ?? null,
        mergedRoom:  null,
        mergedDay:   null,
        mergedStart: null,
        mergedEnd:   null,
        mergedNote:  null,
      };
    });

    return NextResponse.json(result, { headers: corsHeaders });
  } catch (error) {
    console.error('[lecturer/timetable] GET error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch timetable entries' },
      { status: 500, headers: corsHeaders },
    );
  }
}
