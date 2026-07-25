/**
 * GET /api/lecturer/sessions/active
 *
 * Returns the currently active online attendance session for the authenticated
 * lecturer, or null if none is in progress.
 *
 * A session is "active" when endedAt IS NULL and expiresAt > now.
 *
 * Response: session object or null
 * Auth: Bearer lecturer JWT
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

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET(req: NextRequest) {
  const token = (req.headers.get("authorization") ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }
  let lecturerId: string;
  try {
    ({ lecturerId } = verifyLecturerAccessToken(token));
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  try {
    const session = await prisma.onlineAttendanceSession.findFirst({
      where: {
        lecturerId,
        endedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, unitCode: true, type: true, createdAt: true },
    });

    if (!session) {
      return NextResponse.json(null, { headers: corsHeaders });
    }

    const normCode = session.unitCode.replace(/\s+/g, "").toUpperCase();

    // Resolve unit name
    const unitRows = await prisma.$queryRaw<{ title: string }[]>`
      SELECT title FROM "Unit"
      WHERE UPPER(REPLACE(code, ' ', '')) = ${normCode}
      LIMIT 1
    `;

    return NextResponse.json(
      {
        sessionId:   session.id,
        unitCode:    normCode,
        unitName:    unitRows[0]?.title ?? "",
        sessionType: session.type ?? "online",
        startedAt:   session.createdAt.toISOString(),
        lectureRoom: null,
      },
      { headers: corsHeaders },
    );
  } catch (err: unknown) {
    console.error("[lecturer/sessions/active] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: corsHeaders });
  }
}
