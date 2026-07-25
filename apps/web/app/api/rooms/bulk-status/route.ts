import { NextRequest, NextResponse } from 'next/server';
import { RoomStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { resolveAdminScope } from '@/lib/adminScope';
import { verifyFacilitiesManagerJwt } from '@/lib/facilitiesManagerAuthJwt';
import { emitRoomEvent } from '@/lib/roomEvents';

export const runtime = 'nodejs';

const VALID_STATUSES: RoomStatus[] = ['free', 'reserved', 'occupied', 'unavailable'];

/**
 * Resolve the institution ID from either an admin JWT or a room manager JWT.
 * Returns { institutionId, actorId } on success or { error, status } on failure.
 */
async function resolveAuth(
  req: NextRequest
): Promise<{ institutionId: string; actorId: string } | { error: string; status: number }> {
  // Try cookie-based admin auth first (used by dashboard pages)
  const adminScope = await resolveAdminScope(req);
  if (adminScope.ok && adminScope.institutionId) {
    return { institutionId: adminScope.institutionId, actorId: adminScope.adminId };
  }

  // Fall back to Bearer token (facilities manager JWT from external clients)
  const authHeader = req.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (token) {
    try {
      const payload = verifyFacilitiesManagerJwt(token);
      if (payload?.id && payload?.institutionId) {
        return { institutionId: payload.institutionId, actorId: payload.id };
      }
    } catch {}
  }

  return {
    error: 'Unauthorized. Valid admin or room manager token required.',
    status: 401,
  };
}

/**
 * PATCH /api/rooms/bulk-status
 * Body: { roomIds: string[], status: RoomStatus, isActive?: boolean }
 *
 * Batch-updates room status (and optionally isActive).
 * Authorised for admins linked to an institution and room managers.
 */
export async function PATCH(req: NextRequest) {
  const auth = await resolveAuth(req);
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: { roomIds?: unknown; status?: unknown; isActive?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { roomIds, status, isActive } = body;

  if (!Array.isArray(roomIds) || roomIds.length === 0) {
    return NextResponse.json({ error: 'roomIds must be a non-empty array' }, { status: 400 });
  }
  if (roomIds.some((id) => typeof id !== 'string')) {
    return NextResponse.json({ error: 'All roomIds must be strings' }, { status: 400 });
  }
  if (status !== undefined && !VALID_STATUSES.includes(status as RoomStatus)) {
    return NextResponse.json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` }, { status: 400 });
  }
  if (isActive !== undefined && typeof isActive !== 'boolean') {
    return NextResponse.json({ error: 'isActive must be a boolean' }, { status: 400 });
  }
  if (status === undefined && isActive === undefined) {
    return NextResponse.json({ error: 'Provide at least one of status or isActive' }, { status: 400 });
  }

  const updateData: Record<string, unknown> = {};
  if (status !== undefined) updateData.status = status as RoomStatus;
  if (isActive !== undefined) updateData.isActive = isActive as boolean;

  // Only update rooms that belong to the auth institution
  const updated = await prisma.$transaction(async (tx) => {
    const rooms = await tx.room.findMany({
      where: { id: { in: roomIds as string[] }, institutionId: auth.institutionId },
      select: { id: true, status: true },
    });

    if (rooms.length === 0) {
      return [];
    }

    const updatedRooms = await Promise.all(
      rooms.map(async (room) => {
        const result = await tx.room.update({
          where: { id: room.id },
          data: updateData,
        });

        if (status && status !== room.status) {
          emitRoomEvent({
            roomId: room.id,
            fromStatus: room.status,
            toStatus: status as RoomStatus,
            reason: 'bulk.status.update',
            actorId: auth.actorId,
          });
        }

        return result;
      })
    );

    return updatedRooms;
  });

  return NextResponse.json({ updated: updated.length, rooms: updated });
}
