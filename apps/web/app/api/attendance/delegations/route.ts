/**
 * POST /api/attendance/delegations
 *
 * Lecturer creates a GD delegation for one or more groups.
 * One Delegation row is created per group in the request.
 * Leaders receive an in-app notification.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyLecturerAccessToken } from "@/lib/lecturerAuthJwt";
import { sendFcmToTokens } from "@/lib/fcm";
import { writeUserNotificationsForStudents } from "@/lib/userNotification";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

export async function POST(req: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  let lecturerId: string;
  try {
    ({ lecturerId } = verifyLecturerAccessToken(token));
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401, headers: corsHeaders });
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: {
    timetableEntryId: string;
    unitCode: string;
    unitId: number;
    roomCode: string;
    roomId: number;
    validFrom: number;
    validUntil: number;
    groups: Array<{
      groupId: string;
      groupNumber: number;
      groupName?: string;
      leaderStudentId?: string | null;
    }>;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: corsHeaders });
  }

  const { timetableEntryId, unitCode, unitId, roomCode, roomId, validFrom, validUntil, groups } = body;

  // ── Validate ──────────────────────────────────────────────────────────────
  if (!timetableEntryId || !unitCode || !roomCode || !Array.isArray(groups) || groups.length === 0) {
    return NextResponse.json(
      { error: "timetableEntryId, unitCode, roomCode, and a non-empty groups array are required" },
      { status: 422, headers: corsHeaders },
    );
  }

  if (!validFrom || !validUntil || validUntil <= validFrom) {
    return NextResponse.json(
      { error: "validUntil must be greater than validFrom" },
      { status: 422, headers: corsHeaders },
    );
  }

  const MAX_DELEGATION_WINDOW_MS = 15 * 60 * 1000;
  if (validUntil - validFrom > MAX_DELEGATION_WINDOW_MS) {
    return NextResponse.json(
      { error: "Delegation window must not exceed 15 minutes" },
      { status: 422, headers: corsHeaders },
    );
  }

  // ── Confirm lecturer teaches this timetable entry ─────────────────────────
  const entry = await prisma.timetable.findUnique({
    where: { id: timetableEntryId },
    select: {
      lecturerId: true,
      unitOffering: { include: { unit: true } },
      lecturer: { select: { institutionId: true } },
    },
  });

  if (!entry) {
    return NextResponse.json({ error: "Timetable entry not found" }, { status: 404, headers: corsHeaders });
  }

  if (entry.lecturerId !== lecturerId) {
    return NextResponse.json(
      { error: "Forbidden: you do not teach this timetable entry" },
      { status: 403, headers: corsHeaders },
    );
  }

  // ── Create delegation rows ────────────────────────────────────────────────
  try {
    console.log(`[delegations/POST] received ${groups.length} group(s). leaderIds:`, groups.map(g => g.leaderStudentId));

    const created = await prisma.$transaction(
      groups.map((g) =>
        prisma.delegation.create({
          data: {
            timetableEntryId,
            institutionId: entry.lecturer?.institutionId ?? null,
            unitCode,
            unitId,
            roomCode,
            roomId,
            groupId: g.groupId,
            groupNumber: g.groupNumber,
            groupName: g.groupName ?? null,
            leaderStudentId: g.leaderStudentId ?? null,
            validFrom: BigInt(validFrom),
            validUntil: BigInt(validUntil),
            createdBy: lecturerId,
          },
        }),
      ),
    );

    // ── Look up push tokens for all leaders from StudentPushToken table ───────────
    const leaderIds = [...new Set(created.map((d) => d.leaderStudentId).filter(Boolean))] as string[];
    console.log(`[delegations/POST] created ${created.length} delegation(s). leaderIds: [${leaderIds.join(', ')}]`);

    if (leaderIds.length > 0) {
      // Count how many have at least one token
      const tokenCounts = await prisma.studentPushToken.groupBy({
        by: ['studentId'],
        where: { studentId: { in: leaderIds } },
        _count: true,
      });
      const leadersWithToken = tokenCounts.length;
      console.log(`[delegations/POST] ${leadersWithToken}/${leaderIds.length} leader(s) have a push token`);
      if (leadersWithToken === 0) {
        console.warn('[delegations/POST] No push tokens found — leaders have not called PATCH /api/student/push-token yet');
      }

      // Format time window as HH:MM–HH:MM (UTC)
      const fmt = (ms: number) => new Date(ms).toISOString().slice(11, 16);
      const timeWindow = `${fmt(validFrom)}–${fmt(validUntil)}`;

      // ── In-app DB notifications ───────────────────────────────────────────
      const dbNotifyPromises = created
        .filter((d) => d.leaderStudentId)
        .map((d) =>
          prisma.notification.create({
            data: {
              userId: d.leaderStudentId!,
              userType: "student",
              title: "GD Session Delegated",
              message: `You must lead ${d.unitCode} Group ${d.groupNumber} · ${d.roomCode} · ${timeWindow}`,
            },
          }).catch((err) =>
            console.error("[delegations/POST] db notification failed:", err),
          ),
        );
      Promise.allSettled(dbNotifyPromises);

      // ── FCM data-only push (one multicast per delegation, all leader devices) ─
      // Batch-fetch all leader tokens up front to avoid N+1 queries
      const tokenRows = await prisma.studentPushToken.findMany({
        where: { studentId: { in: leaderIds } },
        select: { studentId: true, fcmToken: true },
      });
      const tokensByLeader = new Map<string, string[]>();
      for (const row of tokenRows) {
        const list = tokensByLeader.get(row.studentId) ?? [];
        list.push(row.fcmToken);
        tokensByLeader.set(row.studentId, list);
      }

      // Pre-create inbox rows for all delegation leaders so we can inject
      // per-leader notificationId into each FCM payload.
      const delegationsWithLeader = created.filter((d) => d.leaderStudentId);
      const uniqueLeaderIds = [...new Set(delegationsWithLeader.map((d) => d.leaderStudentId!))] as string[];
      const notifIds = await writeUserNotificationsForStudents(uniqueLeaderIds, {
        type: "delegation",
        title: "GD Session Delegated",
        body: `You have been assigned to lead a GD session.`,
        data: { unitCode: delegationsWithLeader[0]?.unitCode ?? "" },
      });

      const pushPromises = delegationsWithLeader.map(async (d) => {
          const tokens = tokensByLeader.get(d.leaderStudentId!) ?? [];
          if (tokens.length === 0) return;
          return sendFcmToTokens(
            tokens,
            "delegation",
            "GD Session Delegated",
            `Lead ${d.unitCode} — ${d.groupName ?? `Group ${d.groupNumber}`} · ${d.roomCode}`,
            {
              delegationId: d.id,
              unitCode: d.unitCode,
              unitId: String(d.unitId),
              roomCode: d.roomCode,
              roomId: String(d.roomId),
              groupId: d.groupId,
              groupNumber: String(d.groupNumber),
              groupName: d.groupName ?? "",
              validFrom: String(Number(d.validFrom)),
              validUntil: String(Number(d.validUntil)),
              leaderStudentId: d.leaderStudentId!,
              notificationId: notifIds.get(d.leaderStudentId!) ?? "",
            },
            { dataOnly: true },
          );
        });

      // Fire-and-forget — push failure must never block the HTTP response
      Promise.allSettled(pushPromises).catch((err) =>
        console.error("[delegations/POST] push batch failed:", err),
      );
    }

    // Serialize BigInt / Date fields before JSON response
    const delegations = created.map((d) => ({
      id: d.id,
      timetableEntryId: d.timetableEntryId,
      institutionId: d.institutionId ?? null,
      unitCode: d.unitCode,
      unitId: d.unitId,
      roomCode: d.roomCode,
      roomId: d.roomId,
      groupId: d.groupId,
      groupNumber: d.groupNumber,
      groupName: d.groupName,
      leaderStudentId: d.leaderStudentId,
      validFrom: Number(d.validFrom),
      validUntil: Number(d.validUntil),
      used: d.used,
      sessionToken: d.sessionToken ?? null,
      createdAt: Number(d.createdAt),
    }));

    return NextResponse.json({ message: "Delegation created", delegations }, { headers: corsHeaders });
  } catch (err) {
    console.error("[delegations/POST] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: corsHeaders });
  }
}
