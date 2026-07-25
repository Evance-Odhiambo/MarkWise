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

// GET /api/attendance/sessions/:id
// Auth: Student JWT required
// Returns session details with computed status
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!token) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  try {
    verifyStudentAccessToken(token);
  } catch {
    return NextResponse.json({ message: "Invalid or expired token" }, { status: 401, headers: corsHeaders });
  }

  const { id } = await params;

  const session = await prisma.onlineAttendanceSession.findUnique({
    where: { id },
    select: {
      id: true,
      lecturerId: true,
      unitCode: true,
      status: true,
      expiresAt: true,
      endedAt: true,
      createdAt: true,
    },
  });

  if (!session) {
    return NextResponse.json({ message: "Session not found" }, { status: 404, headers: corsHeaders });
  }

  // Derive effective status: a DB-"active" session whose window has passed is "expired"
  const now = new Date();
  let effectiveStatus: "active" | "ended" | "expired";
  if (session.status === "active" && session.expiresAt <= now) {
    effectiveStatus = "expired";
  } else {
    effectiveStatus = session.status as "active" | "ended" | "expired";
  }

  // Resolve unit name and lecturer name in parallel
  const canonicalCode = normalizeUnitCode(session.unitCode);
  const [unit, lecturer] = await Promise.all([
    prisma.unit.findFirst({
      where: { OR: [{ code: canonicalCode }, { code: session.unitCode }] },
      select: { title: true },
    }),
    prisma.lecturer.findUnique({
      where: { id: session.lecturerId },
      select: { fullName: true },
    }),
  ]);

  return NextResponse.json(
    {
      sessionId: session.id,
      unitCode: canonicalCode,
      unitName: unit?.title ?? canonicalCode,
      lecturerName: lecturer?.fullName ?? "",
      status: effectiveStatus,
      expiresAt: session.expiresAt.getTime(),
      sessionStart: session.createdAt.getTime(),
    },
    { headers: corsHeaders }
  );
}
