/**
 * GET /api/admin/my-notifications
 *
 * Returns AdminNotification rows targeted at the authenticated admin
 * (by their role or explicit ID). Uses the admin_auth_token cookie.
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

export async function GET(req: NextRequest) {
  const token = extractToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const payload = verifyAdminAuthToken(token);
  if (!payload) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { adminId, role } = payload;
  const adminRole = role ?? "";

  const rows = await prisma.adminNotification.findMany({
    where: {
      OR: [
        { targetIds: { has: adminId } },
        ...(adminRole ? [{ targetRoles: { has: adminRole } }] : []),
        { targetRoles: { has: "all" } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 30,
    include: {
      reads: {
        where: { lecturerId: adminId },
        select: { readAt: true },
      },
    },
  });

  const notifications = rows.map(n => ({
    id:             n.id,
    type:           n.type,
    title:          n.title,
    body:           n.body,
    priority:       n.priority,
    createdAt:      n.createdAt.toISOString(),
    read:           n.reads.length > 0,
    actionRequired: n.actionRequired,
  }));

  return NextResponse.json({ notifications });
}
