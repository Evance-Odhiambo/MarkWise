// C:\MarkWise\lib\roomBookingService.ts
import {
  BookingHoldStatus,
  DayOfWeek,
  Prisma,
  RoomStatus,
  type BookingHold,
  type Room,
  type RoomReservation,
} from "@prisma/client";
import { prisma } from "./prisma";
import { ApiError } from "./errors";
import { emitRoomEvent } from "./roomEvents";

// JS getDay() → 0=Sun, 1=Mon, ..., 6=Sat
const JS_DAY_TO_DOW: DayOfWeek[] = [
  DayOfWeek.SUN,
  DayOfWeek.MON,
  DayOfWeek.TUE,
  DayOfWeek.WED,
  DayOfWeek.THU,
  DayOfWeek.FRI,
  DayOfWeek.SAT,
];

const isOverlap = (startAt: Date, endAt: Date) => ({
  startAt: { lt: endAt },
  endAt: { gt: startAt },
});

const holdTtlMinutes = () => {
  const configured = Number(process.env.BOOKING_HOLD_TTL_MINUTES ?? "5");
  if (!Number.isFinite(configured) || configured <= 0) return 5;
  return Math.floor(configured);
};

type TxClient = Prisma.TransactionClient;

async function setRoomStatus(
  tx: TxClient,
  roomId: string,
  toStatus: RoomStatus,
  reason: string,
  actorId: string | null,
): Promise<Room> {
  const room = await tx.room.findUnique({ where: { id: roomId } });
  if (!room) {
    throw new ApiError(404, "ROOM_NOT_FOUND", "Room not found.");
  }

  if (room.status === toStatus) {
    return room;
  }

  const updated = await tx.room.update({
    where: { id: roomId },
    data: { status: toStatus },
  });

  emitRoomEvent({
    roomId,
    fromStatus: room.status,
    toStatus,
    reason,
    actorId,
  });

  return updated;
}

export async function recomputeRoomStatus(tx: TxClient, roomId: string, reason: string, actorId: string | null) {
  const room = await tx.room.findUnique({ where: { id: roomId } });
  if (!room) {
    throw new ApiError(404, "ROOM_NOT_FOUND", "Room not found.");
  }

  if (room.status === RoomStatus.unavailable) {
    return room;
  }

  const now = new Date();

  // Active reservation currently in progress → occupied
  const occupied = await tx.roomReservation.findFirst({
    where: {
      roomId,
      status: "active",
      startAt: { lte: now },
      endAt: { gt: now },
    },
    select: { id: true },
  });
  if (occupied) {
    return setRoomStatus(tx, roomId, RoomStatus.occupied, reason, actorId);
  }

  // Active hold → reserved
  const activeHold = await tx.bookingHold.findFirst({
    where: {
      roomId,
      status: BookingHoldStatus.active,
      startAt: { lte: now },
      expiresAt: { gt: now },
    },
    select: { id: true },
  });
  if (activeHold) {
    return setRoomStatus(tx, roomId, RoomStatus.reserved, reason, actorId);
  }

  // Active reservation later today → reserved
  const endOfDay = new Date(now);
  endOfDay.setUTCHours(23, 59, 59, 999);
  const reserved = await tx.roomReservation.findFirst({
    where: {
      roomId,
      status: "active",
      startAt: { gt: now, lte: endOfDay },
    },
    select: { id: true },
  });
  if (reserved) {
    return setRoomStatus(tx, roomId, RoomStatus.reserved, reason, actorId);
  }

  return setRoomStatus(tx, roomId, RoomStatus.free, reason, actorId);
}

export async function expireHolds(actorId: string | null = "system") {
  const now = new Date();

  const expiredHolds = await prisma.bookingHold.findMany({
    where: {
      status: BookingHoldStatus.active,
      expiresAt: { lte: now },
    },
    select: { id: true, roomId: true },
  });

  if (!expiredHolds.length) return;

  const holdIds = expiredHolds.map((item) => item.id);
  const affectedRoomIds = [...new Set(expiredHolds.map((item) => item.roomId))];

  await prisma.bookingHold.updateMany({
    where: { id: { in: holdIds } },
    data: { status: BookingHoldStatus.expired },
  });

  const BATCH_SIZE = 3;
  for (let i = 0; i < affectedRoomIds.length; i += BATCH_SIZE) {
    const batch = affectedRoomIds.slice(i, i + BATCH_SIZE);
    await Promise.allSettled(
      batch.map((roomId) =>
        prisma.$transaction(
          (tx) => recomputeRoomStatus(tx, roomId, "hold.expired", actorId),
          { maxWait: 3_000, timeout: 10_000 },
        )
      )
    );
  }
}

async function assertNoConflicts(
  tx: TxClient,
  roomId: string,
  startAt: Date,
  endAt: Date,
  ignoreHoldId?: string,
) {
  const room = await tx.room.findUnique({ where: { id: roomId } });
  if (!room || !room.isActive) {
    throw new ApiError(404, "ROOM_NOT_FOUND", "Room not found or inactive.");
  }
  if (room.status === "unavailable") {
    throw new ApiError(409, "ROOM_UNAVAILABLE", "Room is unavailable and cannot be booked.");
  }

  // Check for overlapping reservations
  const reservationConflict = await tx.roomReservation.findFirst({
    where: {
      roomId,
      status: "active",
      ...isOverlap(startAt, endAt),
    },
    select: { id: true },
  });
  if (reservationConflict) {
    throw new ApiError(409, "BOOKING_OVERLAP_RESERVED", "Room is reserved for this time slot. Please choose a non-overlapping time.");
  }

  // Check for overlapping holds
  const holdConflict = await tx.bookingHold.findFirst({
    where: {
      roomId,
      status: BookingHoldStatus.active,
      expiresAt: { gt: new Date() },
      ...(ignoreHoldId ? { id: { not: ignoreHoldId } } : {}),
      startAt: { lt: endAt },
    },
    select: { id: true },
  });
  if (holdConflict) {
    throw new ApiError(409, "HOLD_OVERLAP", "Room is currently held for the selected time range. Please choose a different slot.");
  }
}

export async function createHold(input: { roomId: string; lecturerId: string; startAt: Date; endAt: Date }) {
  await expireHolds();

  return prisma.$transaction(async (tx) => {
    const room = await tx.room.findUnique({ where: { id: input.roomId } });
    if (!room || !room.isActive) {
      throw new ApiError(404, "ROOM_NOT_FOUND", "Room not found or inactive.");
    }

    if (room.status === RoomStatus.unavailable) {
      throw new ApiError(409, "ROOM_UNAVAILABLE", "Room is unavailable.");
    }

    const lecturer = await tx.lecturer.findUnique({ where: { id: input.lecturerId } });
    if (!lecturer) {
      throw new ApiError(404, "LECTURER_NOT_FOUND", "Lecturer not found.");
    }

    await assertNoConflicts(tx, input.roomId, input.startAt, input.endAt);

    const hold = await tx.bookingHold.create({
      data: {
        roomId: input.roomId,
        lecturerId: input.lecturerId,
        startAt: input.startAt,
        endAt: input.endAt,
        expiresAt: new Date(Date.now() + holdTtlMinutes() * 60_000),
        status: BookingHoldStatus.active,
      },
    });

    await recomputeRoomStatus(tx, input.roomId, "hold.created", input.lecturerId);

    return hold;
  }, { maxWait: 10000, timeout: 30000 });
}

export async function confirmHold(input: {
  holdId: string;
  lecturerId: string;
  unitCode: string;
  idempotencyKey: string;
  startAt: Date;
  endAt: Date;
}) {
  await expireHolds();

  return prisma.$transaction(async (tx) => {
    // Idempotency: check for an existing active reservation for this slot
    const existing = await tx.roomReservation.findFirst({
      where: {
        reservedBy: input.lecturerId,
        startAt: input.startAt,
        endAt: input.endAt,
        status: "active",
      },
    });
    if (existing) {
      return { booking: existing, idempotentReplay: true };
    }

    const hold = await tx.bookingHold.findUnique({
      where: { id: input.holdId },
      include: { room: true },
    });

    if (!hold) throw new ApiError(404, "HOLD_NOT_FOUND", "Hold not found.");
    if (!hold.room) throw new ApiError(404, "ROOM_NOT_FOUND", "Room not found for this hold.");
    if (hold.lecturerId !== input.lecturerId) throw new ApiError(403, "HOLD_FORBIDDEN", "Hold belongs to another lecturer.");
    if (hold.status !== BookingHoldStatus.active) throw new ApiError(409, "HOLD_INACTIVE", "Hold is no longer active.");

    if (hold.expiresAt <= new Date()) {
      await tx.bookingHold.update({
        where: { id: hold.id },
        data: { status: BookingHoldStatus.expired },
      });
      await recomputeRoomStatus(tx, hold.roomId, "hold.expired", input.lecturerId);
      throw new ApiError(409, "HOLD_EXPIRED", "Hold has expired.");
    }

    if (!hold.room.isActive || hold.room.status === RoomStatus.unavailable) {
      throw new ApiError(409, "ROOM_UNAVAILABLE", "Room is unavailable.");
    }

    if (
      hold.startAt.getTime() !== input.startAt.getTime() ||
      hold.endAt.getTime() !== input.endAt.getTime()
    ) {
      throw new ApiError(400, "TIME_MISMATCH", "Booking times must match the hold times.");
    }

    await assertNoConflicts(tx, hold.roomId, hold.startAt, hold.endAt, hold.id);

    const reservation = await tx.roomReservation.create({
      data: {
        roomId: hold.roomId,
        reservedBy: input.lecturerId,
        purpose: input.unitCode,
        startAt: hold.startAt,
        endAt: hold.endAt,
        status: "active",
      },
    });

    const roomDisplayName = hold.room.roomCode || hold.room.name || "Unknown Room";
    await tx.notification.create({
      data: {
        userId: input.lecturerId,
        userType: "lecturer",
        title: "Room Booking Confirmed",
        message: `Your booking for room ${roomDisplayName} is confirmed from ${hold.startAt.toLocaleString()} to ${hold.endAt.toLocaleString()}.`,
      },
    });

    const admins = await tx.admin.findMany({
      where: { institutionId: hold.room.institutionId },
      select: { id: true },
    });
    if (admins.length > 0) {
      await tx.notification.createMany({
        data: admins.map((admin) => ({
          userId: admin.id,
          userType: "admin",
          title: "Room Booked",
          message: `Room ${roomDisplayName} was booked by a lecturer from ${hold.startAt.toLocaleString()} to ${hold.endAt.toLocaleString()}.`,
        })),
      });
    }

    await tx.bookingHold.update({
      where: { id: hold.id },
      data: { status: BookingHoldStatus.confirmed },
    });

    await recomputeRoomStatus(tx, hold.roomId, "booking.confirmed", input.lecturerId);

    return { booking: reservation, idempotentReplay: false };
  }, { maxWait: 10000, timeout: 30000 });
}

export async function cancelBooking(input: { bookingId: string; actorId: string; actorRole: "admin" | "lecturer" }) {
  await expireHolds();

  return prisma.$transaction(async (tx) => {
    const reservation = await tx.roomReservation.findUnique({
      where: { id: input.bookingId },
      include: { room: true },
    });

    if (!reservation) throw new ApiError(404, "BOOKING_NOT_FOUND", "Booking not found.");

    if (input.actorRole === "lecturer" && reservation.reservedBy !== input.actorId) {
      throw new ApiError(403, "BOOKING_FORBIDDEN", "You can only cancel your own booking.");
    }

    if (reservation.status === "cancelled" || reservation.status === "completed") {
      return reservation;
    }

    const updated = await tx.roomReservation.update({
      where: { id: reservation.id },
      data: { status: "cancelled" },
    });

    const roomDisplayName = reservation.room?.roomCode || reservation.room?.name || "Unknown Room";

    await tx.notification.create({
      data: {
        userId: reservation.reservedBy,
        userType: "lecturer",
        title: "Room Booking Cancelled",
        message: `Your booking for room ${roomDisplayName} was cancelled.`,
      },
    });

    if (reservation.room) {
      const admins = await tx.admin.findMany({
        where: { institutionId: reservation.room.institutionId },
        select: { id: true },
      });
      if (admins.length > 0) {
        await tx.notification.createMany({
          data: admins.map((admin) => ({
            userId: admin.id,
            userType: "admin",
            title: "Room Booking Cancelled",
            message: `A booking for room ${roomDisplayName} was cancelled.`,
          })),
        });
      }
    }

    await recomputeRoomStatus(tx, updated.roomId, "booking.cancelled", input.actorId);

    return updated;
  }, { maxWait: 10000, timeout: 30000 });
}

export async function getBookingById(bookingId: string) {
  await expireHolds();

  const reservation = await prisma.roomReservation.findUnique({
    where: { id: bookingId },
    include: { room: true },
  });

  if (!reservation) throw new ApiError(404, "BOOKING_NOT_FOUND", "Booking not found.");

  return reservation;
}

// Cooldown: only refresh once per 30 s per institution to avoid saturating the connection pool.
const _lastRefresh = new Map<string, number>();
const REFRESH_COOLDOWN_MS = 30_000;

export async function refreshRoomStatuses(institutionId?: string) {
  const key = institutionId ?? "__all__";
  const now = Date.now();
  if ((now - (_lastRefresh.get(key) ?? 0)) < REFRESH_COOLDOWN_MS) return;
  _lastRefresh.set(key, now);

  const rooms = await prisma.room.findMany({
    select: { id: true, status: true },
    where: {
      isActive: true,
      status: { not: RoomStatus.unavailable },
      ...(institutionId ? { institutionId } : {}),
    },
  });

  if (!rooms.length) return;

  const roomIds = rooms.map((r) => r.id);
  const nowDate = new Date();
  const endOfDay = new Date(nowDate);
  endOfDay.setHours(23, 59, 59, 999);

  const todayDow = JS_DAY_TO_DOW[nowDate.getDay()];
  const nowMinute = nowDate.getHours() * 60 + nowDate.getMinutes();

  const [occupiedRows, holdRows, reservedRows, sessionRows] = await Promise.all([
    prisma.roomReservation.findMany({
      where: {
        roomId: { in: roomIds },
        status: "active",
        startAt: { lte: nowDate },
        endAt: { gt: nowDate },
      },
      select: { roomId: true },
    }),
    prisma.bookingHold.findMany({
      where: {
        roomId: { in: roomIds },
        status: BookingHoldStatus.active,
        startAt: { lte: nowDate },
        expiresAt: { gt: nowDate },
      },
      select: { roomId: true },
    }),
    prisma.roomReservation.findMany({
      where: {
        roomId: { in: roomIds },
        status: "active",
        startAt: { gt: nowDate, lte: endOfDay },
      },
      select: { roomId: true },
    }),
    // SharedSession covers recurring academic classes for room status
    prisma.sharedSession.findMany({
      where: {
        roomId: { in: roomIds },
        day: todayDow,
        endMinute: { gt: nowMinute },
      },
      select: { roomId: true, startMinute: true, endMinute: true },
    }),
  ]);

  const occupiedIds = new Set(occupiedRows.map((r) => r.roomId));
  const holdIds     = new Set(holdRows.map((r) => r.roomId));
  const reservedIds = new Set(reservedRows.map((r) => r.roomId));

  for (const s of sessionRows) {
    if (s.startMinute <= nowMinute && s.endMinute > nowMinute) {
      occupiedIds.add(s.roomId);
    } else {
      reservedIds.add(s.roomId);
    }
  }

  const toOccupied: string[] = [];
  const toReserved: string[] = [];
  const toFree:     string[] = [];

  for (const room of rooms) {
    if (occupiedIds.has(room.id)) {
      if (room.status !== RoomStatus.occupied) toOccupied.push(room.id);
    } else if (holdIds.has(room.id) || reservedIds.has(room.id)) {
      if (room.status !== RoomStatus.reserved) toReserved.push(room.id);
    } else {
      if (room.status !== RoomStatus.free) toFree.push(room.id);
    }
  }

  await Promise.all([
    toOccupied.length
      ? prisma.room.updateMany({ where: { id: { in: toOccupied } }, data: { status: RoomStatus.occupied } })
      : null,
    toReserved.length
      ? prisma.room.updateMany({ where: { id: { in: toReserved } }, data: { status: RoomStatus.reserved } })
      : null,
    toFree.length
      ? prisma.room.updateMany({ where: { id: { in: toFree } }, data: { status: RoomStatus.free } })
      : null,
  ].filter(Boolean));
}

export async function markRoomUnavailable(roomId: string, actorId: string) {
  return prisma.$transaction(async (tx) => {
    const room = await tx.room.findUnique({ where: { id: roomId } });
    if (!room) throw new ApiError(404, "ROOM_NOT_FOUND", "Room not found.");
    return setRoomStatus(tx, roomId, RoomStatus.unavailable, "room.unavailable", actorId);
  }, { maxWait: 10000, timeout: 30000 });
}

export function canReadBooking(booking: { reservedBy: string }, scope: { role: "admin" | "lecturer"; userId: string }) {
  if (scope.role === "admin") return true;
  return booking.reservedBy === scope.userId;
}

export function toRoomStatusPayload(room: Room) {
  return {
    id: room.id,
    institutionId: room.institutionId,
    buildingCode: room.buildingCode,
    roomCode: room.roomCode,
    name: room.name,
    capacity: room.capacity,
    type: room.type,
    floor: room.floor,
    status: room.status,
    isActive: room.isActive,
    createdAt: room.createdAt.toISOString(),
    updatedAt: room.updatedAt.toISOString(),
  };
}

export function toHoldPayload(hold: BookingHold) {
  return {
    id: hold.id,
    roomId: hold.roomId,
    lecturerId: hold.lecturerId,
    startAt: hold.startAt.toISOString(),
    expiresAt: hold.expiresAt.toISOString(),
    status: hold.status,
    createdAt: hold.createdAt.toISOString(),
  };
}

export function toBookingPayload(reservation: RoomReservation) {
  return {
    id: reservation.id,
    roomId: reservation.roomId,
    reservedBy: reservation.reservedBy,
    purpose: reservation.purpose,
    notes: reservation.notes,
    startAt: reservation.startAt.toISOString(),
    endAt: reservation.endAt.toISOString(),
    status: reservation.status,
    createdAt: reservation.createdAt.toISOString(),
  };
}
