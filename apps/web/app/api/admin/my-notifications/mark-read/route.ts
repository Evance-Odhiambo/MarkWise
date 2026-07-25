/**
 * POST /api/admin/my-notifications/mark-read
 *
 * Marks one or more AdminNotification rows as read for the authenticated admin.
 * Upserts NotificationRead rows using adminId in the lecturerId column
 * (no FK constraint — the column is a plain String).
 *
 * Body: { ids: string[] }
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyAdminAuthToken } from "@/lib/adminAuthJwt";

export const runtime = "nodejs";

function extractToken(req: NextRequest): string | null {
  const cookieHeader = req.headers.get("cookie") ?? "";
  const match = cookieHeader.match(/(?:^|;\s*)admin_auth_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export async function POST(req: NextRequest) {
  const token = extractToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const payload = verifyAdminAuthToken(token);
  if (!payload) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { adminId, role } = payload;
  const adminRole = role ?? "";

  let body: { ids?: unknown };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const ids = Array.isArray(body.ids)
    ? body.ids.filter((id): id is string => typeof id === "string")
    : [];

  if (ids.length === 0) return NextResponse.json({ marked: 0 });

  // Only mark notifications that actually target this admin
  const valid = await prisma.adminNotification.findMany({
    where: {
      id: { in: ids },
      OR: [
        { targetIds: { has: adminId } },
        ...(adminRole ? [{ targetRoles: { has: adminRole } }] : []),
        { targetRoles: { has: "all" } },
      ],
    },
    select: { id: true },
  });

  await Promise.all(
    valid.map(n =>
      prisma.notificationRead.upsert({
        where: { notificationId_lecturerId: { notificationId: n.id, lecturerId: adminId } },
        create: { notificationId: n.id, lecturerId: adminId },
        update: { readAt: new Date() },
      }),
    ),
  );

  return NextResponse.json({ marked: valid.length });
}
