/**
 * GET /api/timetable/extra-sessions/mine
 *
 * Returns all active (non-deleted) extra sessions created by the authenticated
 * lecturer, ordered by date ASC, startTime ASC.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyLecturerAccessToken } from "@/lib/lecturerAuthJwt";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  let lecturerId: string;
  try {
    const payload = verifyLecturerAccessToken(token);
    lecturerId = payload.lecturerId;
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  const sessions = await prisma.extraSession.findMany({
    where: { lecturerId, deletedAt: null },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
    select: {
      id: true,
      unitCode: true,
      date: true,
      startTime: true,
      endTime: true,
      roomCode: true,
      lessonType: true,
      createdAt: true,
    },
  });

  // Enrich with unit titles from the Unit table (best-effort — may be missing)
  const unitCodes = [...new Set(sessions.map((s) => s.unitCode))];
  const units = unitCodes.length
    ? await prisma.unit.findMany({
        where: { code: { in: unitCodes } },
        select: { code: true, title: true },
      })
    : [];
  const unitTitleMap = Object.fromEntries(units.map((u) => [u.code, u.title]));

  const result = sessions.map((s) => ({
    id: s.id,
    sessionId: s.id,
    unitCode: s.unitCode,
    unitName: unitTitleMap[s.unitCode] ?? null,
    date: s.date.toISOString().slice(0, 10),
    startTime: s.startTime,
    endTime: s.endTime,
    roomCode: s.roomCode ?? null,
    lessonType: s.lessonType,
    createdAt: s.createdAt.toISOString(),
  }));

  return NextResponse.json(result, { headers: corsHeaders });
}
