/**
 * GET /api/lecturer/notifications/analytics
 *
 * Returns aggregate delivery/engagement analytics across all notifications
 * sent by the authenticated lecturer.
 *
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
    return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }
  let lecturerId: string;
  try {
    ({ lecturerId } = verifyLecturerAccessToken(token));
  } catch {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  try {
    const rows = await prisma.lecturerNotification.findMany({
      where: { lecturerId, status: "sent" },
      select: { sentCount: true, readCount: true, clickedCount: true },
    });

    const totalSent      = rows.length;
    const totalDelivered = rows.reduce((s, r) => s + r.sentCount,    0);
    const totalRead      = rows.reduce((s, r) => s + r.readCount,    0);
    const totalClicked   = rows.reduce((s, r) => s + r.clickedCount, 0);

    const readRate       = totalDelivered > 0 ? Math.round((totalRead    / totalDelivered) * 100) : 0;
    const engagementRate = totalDelivered > 0 ? Math.round((totalClicked / totalDelivered) * 100) : 0;

    return NextResponse.json(
      { totalSent, totalDelivered, totalRead, totalClicked, readRate, engagementRate },
      { headers: corsHeaders },
    );
  } catch (err: unknown) {
    console.error("[lecturer/notifications/analytics] error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: corsHeaders });
  }
}
