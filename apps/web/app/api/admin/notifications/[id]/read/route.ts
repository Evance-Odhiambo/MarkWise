/**
 * PUT /api/admin/notifications/:id/read
 *
 * Marks an admin notification as read by the authenticated lecturer.
 * Upserts a NotificationRead row.
 *
 * Auth: Bearer lecturer JWT
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyLecturerAccessToken } from "@/lib/lecturerAuthJwt";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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

  const { id } = await params;

  try {
    // Verify the notification exists and targets this lecturer
    const notification = await prisma.adminNotification.findFirst({
      where: {
        id,
        OR: [
          { targetIds: { has: lecturerId } },
          { targetRoles: { has: "lecturer" } },
        ],
      },
      select: { id: true },
    });

    if (!notification) {
      return NextResponse.json({ message: "Notification not found" }, { status: 404, headers: corsHeaders });
    }

    // Upsert read record
    await prisma.notificationRead.upsert({
      where: { notificationId_lecturerId: { notificationId: id, lecturerId } },
      create: { notificationId: id, lecturerId },
      update: { readAt: new Date() },
    });

    return NextResponse.json({ success: true }, { headers: corsHeaders });
  } catch (err: unknown) {
    console.error("[admin/notifications/:id/read] error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: corsHeaders });
  }
}
