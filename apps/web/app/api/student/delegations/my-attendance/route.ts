/**
 * GET /api/student/delegations/my-attendance
 *
 * Returns all GD attendance records stored on the backend for the
 * authenticated student. The mobile app uses this to back-fill its local
 * SQLite database after a session.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyStudentAccessToken } from "@/lib/studentAuthJwt";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

export async function GET(req: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  let studentId: string;
  try {
    ({ studentId } = verifyStudentAccessToken(token));
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401, headers: corsHeaders });
  }

  const records = await prisma.offlineAttendanceRecord.findMany({
    where: {
      studentId,
      lessonType: "GD",
    },
    select: {
      delegationId: true,
      unitCode: true,
      lectureRoom: true,   // stored as roomCode from delegation.roomCode
      sessionStart: true,
      scannedAt: true,
    },
    orderBy: { sessionStart: "desc" },
  });

  return NextResponse.json(
    records.map((r) => ({
      delegationId: r.delegationId ?? null,
      unitCode: r.unitCode,
      roomCode: r.lectureRoom,
      sessionStart: r.sessionStart.getTime(),
      scannedAt: r.scannedAt.getTime(),
    })),
    { headers: corsHeaders },
  );
}
