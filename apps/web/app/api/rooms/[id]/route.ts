import { RoomStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiError, jsonError, jsonOk, optionsResponse } from "@/lib/roomApi";
import { resolveRoomScope } from "@/lib/roomAuth";
import { emitRoomEvent } from "@/lib/roomEvents";
import { patchRoomSchema } from "@/lib/roomValidation";
import { toRoomStatusPayload } from "@/lib/roomBookingService";

export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const scope = await resolveRoomScope(request);
    if (!scope.ok) {
      throw new ApiError(scope.status, "UNAUTHORIZED", scope.error);
    }

    if (scope.role !== "admin" && scope.role !== "facilitiesManager") {
      throw new ApiError(403, "FORBIDDEN", "Only admins or room managers can update rooms.");
    }

    const { id } = await context.params;
    const body = await request.json();
    const parsed = patchRoomSchema.safeParse(body);

    if (!parsed.success) {
      throw new ApiError(400, "VALIDATION_ERROR", "Invalid room update payload.", parsed.error.flatten());
    }

    const { room, previousStatus } = await prisma.$transaction(async (tx) => {
      const existing = await tx.room.findUnique({ where: { id } });
      if (!existing) {
        throw new ApiError(404, "ROOM_NOT_FOUND", "Room not found.");
      }

      const updated = await tx.room.update({
        where: { id },
        data: parsed.data,
      });

      return { room: updated, previousStatus: existing.status };
    });

    if (parsed.data.status && parsed.data.status !== previousStatus) {
      emitRoomEvent({
        roomId: id,
        fromStatus: previousStatus,
        toStatus: parsed.data.status as RoomStatus,
        reason: "room.updated",
        actorId: scope.userId,
      });
    }

    return jsonOk({ room: toRoomStatusPayload(room) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function OPTIONS() {
  return optionsResponse();
}
