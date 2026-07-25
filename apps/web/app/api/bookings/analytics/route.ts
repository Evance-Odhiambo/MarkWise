import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveAdminScope } from "@/lib/adminScope";
import { verifyFacilitiesManagerJwt } from "@/lib/facilitiesManagerAuthJwt";

export const runtime = "nodejs";

async function resolveInstitutionId(req: NextRequest): Promise<string | null> {
  const adminScope = await resolveAdminScope(req);
  if (adminScope.ok && adminScope.institutionId) return adminScope.institutionId;

  const authHeader = req.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (token) {
    try {
      const payload = verifyFacilitiesManagerJwt(token);
      if (payload?.institutionId) return payload.institutionId;
    } catch {}
  }

  return null;
}

/**
 * GET /api/bookings/analytics
 * Returns aggregated room reservation analytics for the institution.
 */
export async function GET(req: NextRequest) {
  const institutionId = await resolveInstitutionId(req);
  if (!institutionId) {
    return NextResponse.json(
      { error: "Unauthorized. Valid admin or room manager token required." },
      { status: 401 }
    );
  }

  const now = new Date();
  const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(now); endOfToday.setHours(23, 59, 59, 999);

  const dayOfWeek = now.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(now); monday.setDate(now.getDate() + mondayOffset); monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6); sunday.setHours(23, 59, 59, 999);

  const thirtyDaysAgo = new Date(now); thirtyDaysAgo.setDate(now.getDate() - 30); thirtyDaysAgo.setHours(0, 0, 0, 0);

  const [allReservations, rooms, activeHolds] = await Promise.all([
    prisma.roomReservation.findMany({
      where: {
        room: { institutionId },
        startAt: { gte: thirtyDaysAgo },
      },
      select: {
        id: true,
        startAt: true,
        endAt: true,
        status: true,
        roomId: true,
        room: { select: { id: true, buildingCode: true, roomCode: true, name: true, type: true, capacity: true } },
      },
    }),
    prisma.room.findMany({
      where: { institutionId },
      select: { id: true, buildingCode: true, roomCode: true, name: true, type: true, capacity: true, status: true },
    }),
    prisma.bookingHold.count({
      where: { room: { institutionId }, status: "active", expiresAt: { gt: now } },
    }),
  ]);

  let todayCount = 0;
  let thisWeekCount = 0;
  const statusCounts: Record<string, number> = {};
  let totalDurationMs = 0;
  const hourMap: Record<number, number> = {};
  for (let h = 0; h < 24; h++) hourMap[h] = 0;
  const roomMap: Record<string, { count: number; totalMinutes: number; roomCode: string; buildingCode: string; name: string }> = {};

  const fourteenDaysAgo = new Date(now); fourteenDaysAgo.setDate(now.getDate() - 13);
  const dayMap: Record<string, number> = {};
  for (let d = new Date(fourteenDaysAgo); d <= now; d.setDate(d.getDate() + 1)) {
    dayMap[d.toISOString().slice(0, 10)] = 0;
  }

  for (const b of allReservations) {
    statusCounts[b.status] = (statusCounts[b.status] ?? 0) + 1;

    if (b.startAt >= startOfToday && b.startAt <= endOfToday) todayCount++;
    if (b.startAt >= monday && b.startAt <= sunday) thisWeekCount++;

    const dayKey = new Date(b.startAt).toISOString().slice(0, 10);
    if (dayKey in dayMap) dayMap[dayKey]++;

    if (b.status === "cancelled") continue;

    totalDurationMs += new Date(b.endAt).getTime() - new Date(b.startAt).getTime();
    hourMap[new Date(b.startAt).getHours()]++;

    if (!roomMap[b.roomId]) {
      roomMap[b.roomId] = {
        count: 0, totalMinutes: 0,
        roomCode: b.room.roomCode, buildingCode: b.room.buildingCode, name: b.room.name,
      };
    }
    roomMap[b.roomId].count++;
    roomMap[b.roomId].totalMinutes += Math.round(
      (new Date(b.endAt).getTime() - new Date(b.startAt).getTime()) / 60_000
    );
  }

  const totalBookings = allReservations.length;
  const cancelled = statusCounts["cancelled"] ?? 0;
  const cancellationRate = totalBookings > 0 ? Math.round((cancelled / totalBookings) * 100) : 0;
  const nonCancelledCount = totalBookings - cancelled;
  const avgDurationMinutes = nonCancelledCount > 0
    ? Math.round(totalDurationMs / nonCancelledCount / 60_000)
    : 0;

  const roomsSummary = { free: 0, reserved: 0, occupied: 0, unavailable: 0, total: rooms.length };
  for (const r of rooms) {
    if (r.status === "free") roomsSummary.free++;
    else if (r.status === "reserved") roomsSummary.reserved++;
    else if (r.status === "occupied") roomsSummary.occupied++;
    else if (r.status === "unavailable") roomsSummary.unavailable++;
  }

  const bookingsByDay = Object.entries(dayMap).map(([date, count]) => ({ date, count }));

  const peakHours = Object.entries(hourMap)
    .map(([h, count]) => ({ hour: Number(h), count }))
    .sort((a, b) => a.hour - b.hour);

  const topRooms = Object.entries(roomMap)
    .map(([roomId, v]) => ({
      roomId,
      roomCode: v.roomCode,
      buildingCode: v.buildingCode,
      name: v.name,
      count: v.count,
      totalMinutes: v.totalMinutes,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const availableMinutesPerRoom = 12 * 60 * 30;
  const utilizationByRoom = rooms.map((room) => {
    const hoursBooked = (roomMap[room.id]?.totalMinutes ?? 0) / 60;
    const utilizationPct = availableMinutesPerRoom > 0
      ? Math.min(100, Math.round((hoursBooked * 60) / availableMinutesPerRoom * 100))
      : 0;
    return {
      roomId: room.id,
      roomCode: room.roomCode,
      buildingCode: room.buildingCode,
      name: room.name,
      type: room.type,
      capacity: room.capacity,
      hoursBooked: Math.round(hoursBooked * 10) / 10,
      utilizationPct,
      bookingCount: roomMap[room.id]?.count ?? 0,
    };
  }).sort((a, b) => b.utilizationPct - a.utilizationPct);

  return NextResponse.json({
    summary: {
      totalBookings,
      todayCount,
      thisWeekCount,
      avgDurationMinutes,
      cancellationRate,
      activeHoldsCount: activeHolds,
      statusCounts,
    },
    roomsSummary,
    bookingsByDay,
    peakHours,
    topRooms,
    utilizationByRoom,
  });
}
