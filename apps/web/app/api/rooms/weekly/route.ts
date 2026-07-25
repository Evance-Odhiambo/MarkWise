import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonError, jsonOk, ApiError } from "@/lib/roomApi";
import { toRoomStatusPayload } from "@/lib/roomBookingService";

export const runtime = "nodejs";

/**
 * GET /api/rooms/weekly?institutionId=xxx
 *
 * Returns all rooms with their reservation schedule for each day of the
 * current week (Monday–Sunday). Used by the Reservations weekly view.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const institutionId = searchParams.get("institutionId") ?? undefined;

    if (!institutionId) {
      throw new ApiError(400, "MISSING_PARAM", "institutionId is required.");
    }

    const now = new Date();
    const dayOfWeekUTC = now.getUTCDay();
    const mondayOffset = dayOfWeekUTC === 0 ? -6 : 1 - dayOfWeekUTC;
    const monday = new Date(now);
    monday.setUTCHours(0, 0, 0, 0);
    monday.setUTCDate(now.getUTCDate() + mondayOffset);

    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 7);

    const rooms = await prisma.room.findMany({
      where: { institutionId, isActive: true },
      orderBy: [{ buildingCode: "asc" }, { roomCode: "asc" }],
    });

    const roomIds = rooms.map((r) => r.id);
    const reservations = roomIds.length > 0 ? await prisma.roomReservation.findMany({
      where: {
        roomId: { in: roomIds },
        status: "active",
        startAt: { lt: sunday },
        endAt: { gt: monday },
      },
      orderBy: { startAt: "asc" },
    }) : [];

    type ReservationRow = (typeof reservations)[number];
    const reservationsByRoom = new Map<string, Map<number, ReservationRow[]>>();
    for (const r of reservations) {
      const start = new Date(r.startAt);
      const dayIdx = (start.getUTCDay() + 6) % 7;
      if (!reservationsByRoom.has(r.roomId)) reservationsByRoom.set(r.roomId, new Map());
      const dayMap = reservationsByRoom.get(r.roomId)!;
      if (!dayMap.has(dayIdx)) dayMap.set(dayIdx, []);
      dayMap.get(dayIdx)!.push(r);
    }

    const dayLabels = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

    const result = rooms.map((room) => {
      const dayMap = reservationsByRoom.get(room.id);
      const weekSchedule = dayLabels.map((label, idx) => {
        const dayDate = new Date(monday);
        dayDate.setUTCDate(monday.getUTCDate() + idx);
        const dayReservations = dayMap?.get(idx) ?? [];

        let status: "free" | "reserved" | "occupied" | "unavailable" = "free";
        if (room.status === "unavailable") {
          status = "unavailable";
        } else if (dayReservations.length > 0) {
          const hasActive = dayReservations.some(r => r.status === "active");
          if (hasActive) status = "reserved";
        }

        return {
          day: label,
          date: dayDate.toISOString().slice(0, 10),
          status,
          bookings: dayReservations.map((r) => ({
            id: r.id,
            startAt: r.startAt.toISOString(),
            endAt: r.endAt.toISOString(),
            status: r.status,
            unitCode: r.purpose ?? null,
            unitName: null,
            lecturerName: r.reservedBy ?? null,
          })),
        };
      });

      return {
        ...toRoomStatusPayload(room),
        weekSchedule,
      };
    });

    return jsonOk({
      rooms: result,
      week: {
        start: monday.toISOString().slice(0, 10),
        end: new Date(sunday.getTime() - 1).toISOString().slice(0, 10),
      },
      meta: { total: result.length },
    });
  } catch (error) {
    return jsonError(error);
  }
}
