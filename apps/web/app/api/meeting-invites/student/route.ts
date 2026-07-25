import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyStudentAccessToken } from "@/lib/studentAuthJwt";
import { normalizeUnitCode } from "@/lib/unitCode";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

// GET /api/meeting-invites/student
// Auth: Student JWT required
// Optional query param: ?units=CS101,CS102  (comma-separated, normalized unit codes)
//   - If provided: normalize each code (strip whitespace, uppercase) then use directly.
//   - If absent: fall back to deriving codes from the student's enrollment records.
// Filtered to scheduledAt > now - 2 hours, sorted soonest first.
export async function GET(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!token) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  let studentId: string;
  try {
    const payload = verifyStudentAccessToken(token);
    studentId = payload.studentId;
  } catch {
    return NextResponse.json({ message: "Invalid or expired token" }, { status: 401, headers: corsHeaders });
  }

  let unitCodes: string[];

  const rawUnits = req.nextUrl.searchParams.get("units");
  if (rawUnits) {
    // Normalize each code: strip all internal whitespace, uppercase
    unitCodes = rawUnits
      .split(",")
      .map((u) => normalizeUnitCode(u))
      .filter(Boolean);
  } else {
    // Fallback: derive from the student's enrollment records
    const enrollments = await prisma.enrollment.findMany({
      where: { studentId },
      select: { unit: { select: { code: true } } },
    });
    unitCodes = enrollments.map((e) => normalizeUnitCode(e.unit.code));
  }

  if (unitCodes.length === 0) {
    return NextResponse.json([], { headers: corsHeaders });
  }

  // Cut-off: 2 hours ago
  const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000);

  const invites = await prisma.meetingInvite.findMany({
    where: {
      unitCode: { in: unitCodes },
      scheduledAt: { gte: cutoff },
    },
    orderBy: { scheduledAt: "asc" },
  });

  return NextResponse.json(invites, { headers: corsHeaders });
}
