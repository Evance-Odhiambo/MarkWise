/**
 * GET /api/admin/notifications
 *
 * Returns notifications sent from admin to the authenticated lecturer,
 * including per-lecturer read status. Sorted newest first.
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
    // Fetch admin notifications targeted at this lecturer (by ID) or broadcast to all lecturers
    const notifications = await prisma.adminNotification.findMany({
      where: {
        OR: [
          { targetIds: { has: lecturerId } },
          { targetRoles: { has: "lecturer" } },
        ],
      },
      orderBy: { createdAt: "desc" },
      include: {
        reads: {
          where: { lecturerId },
          select: { readAt: true },
        },
      },
    });

    const result = notifications.map((n) => ({
      id:             n.id,
      type:           n.type,
      title:          n.title,
      body:           n.body,
      priority:       n.priority,
      createdAt:      n.createdAt.toISOString(),
      read:           n.reads.length > 0,
      attachment:     n.attachmentUrl != null,
      actionRequired: n.actionRequired,
    }));

    return NextResponse.json(result, { headers: corsHeaders });
  } catch (err: unknown) {
    console.error("[admin/notifications GET] error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: corsHeaders });
  }
}
