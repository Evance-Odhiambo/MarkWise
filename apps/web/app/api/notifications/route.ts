import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonOk, jsonError, optionsResponse } from "@/lib/roomApi";
import { verifyLecturerAccessToken } from "@/lib/lecturerAuthJwt";

// GET /api/notifications?userId=...&userType=...
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get("userId");
    const userType = searchParams.get("userType");
    if (!userId || !userType) {
      return jsonError({
        status: 400,
        code: "MISSING_PARAMS",
        message: "userId and userType are required."
      });
    }
    const notifications = await prisma.notification.findMany({
      where: { userId, userType: userType as "student" | "lecturer" | "admin" },
      orderBy: { createdAt: "desc" },
    });
    return jsonOk(notifications);
  } catch (error) {
    return jsonError(error);
  }
}

// POST /api/notifications — Send notifications (lecturer only)
// Body: { title, message, recipients: studentId[] | groupId[] | 'all' }
export async function POST(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  let lecturer: ReturnType<typeof verifyLecturerAccessToken>;
  try { lecturer = verifyLecturerAccessToken(token); }
  catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }

  const { title, message, recipients } = await req.json();
  if (!title || !message) {
    return NextResponse.json({ error: "title and message are required" }, { status: 400 });
  }

  let studentIds: string[] = [];

  if (recipients === "all") {
    // Notify all students taught by this lecturer — find units via timetable and get enrolled students
    const timetableRows = await prisma.timetable.findMany({
      where: { lecturerId: lecturer.lecturerId },
      include: { unitOffering: { select: { unitId: true } } },
    });
    const unitIds = [...new Set(timetableRows.map(r => r.unitOffering?.unitId).filter(Boolean) as string[])];
    const enrollments = await prisma.enrollment.findMany({
      where: { unitId: { in: unitIds } },
      select: { studentId: true },
      distinct: ["studentId"],
    });
    studentIds = enrollments.map(e => e.studentId);
  } else if (Array.isArray(recipients) && recipients.length > 0) {
    // Try to resolve recipients as unit codes first (spec: recipients: ["BCS301"])
    const unitsByCode = await prisma.unit.findMany({
      where: { code: { in: recipients, mode: "insensitive" } },
      select: { id: true },
    });
    if (unitsByCode.length > 0) {
      // Recipients are unit codes — fan out to enrolled students
      const unitIds = unitsByCode.map(u => u.id);
      const enrollments = await prisma.enrollment.findMany({
        where: { unitId: { in: unitIds } },
        select: { studentId: true },
        distinct: ["studentId"],
      });
      studentIds = enrollments.map(e => e.studentId);
    } else {
      // Fall back: determine if items are group IDs or direct student IDs
      const groups = await prisma.group.findMany({
        where: { id: { in: recipients } },
        include: { members: { where: { leftAt: null }, select: { studentId: true } } },
      });
      const groupIds = new Set(groups.map(g => g.id));
      const fromGroups = groups.flatMap(g => g.members.map(m => m.studentId));
      const directStudentIds = recipients.filter(r => !groupIds.has(r));
      studentIds = [...new Set([...fromGroups, ...directStudentIds])];
    }
  }

  if (studentIds.length === 0) {
    return NextResponse.json({ sent: 0 });
  }

  const result = await prisma.notification.createMany({
    data: studentIds.map(studentId => ({
      userId: studentId,
      userType: "student" as const,
      title,
      message,
      read: false,
    })),
  });

  return NextResponse.json({ sent: result.count });
}

export function OPTIONS() {
  return optionsResponse();
}
