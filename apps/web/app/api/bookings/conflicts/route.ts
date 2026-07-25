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
 * GET /api/bookings/conflicts
 * Returns rooms with overlapping reservations within the next 7 days.
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
  const sevenDaysLater = new Date(now);
  sevenDaysLater.setDate(now.getDate() + 7);

  const reservations = await prisma.roomReservation.findMany({
    where: {
      room: { institutionId },
      status: "active",
      startAt: { gte: now },
      endAt: { lte: sevenDaysLater },
    },
    orderBy: [{ roomId: "asc" }, { startAt: "asc" }],
    select: {
      id: true,
      roomId: true,
      startAt: true,
      endAt: true,
      purpose: true,
      room: { select: { roomCode: true, buildingCode: true, name: true } },
    },
  });

  const conflicts: Array<{
    roomId: string;
    roomCode: string;
    buildingCode: string;
    roomName: string;
    bookingA: { id: string; startAt: string; endAt: string; unitCode: string | null };
    bookingB: { id: string; startAt: string; endAt: string; unitCode: string | null };
  }> = [];

  const byRoom: Record<string, typeof reservations> = {};
  for (const r of reservations) {
    if (!byRoom[r.roomId]) byRoom[r.roomId] = [];
    byRoom[r.roomId].push(r);
  }

  for (const [, roomReservations] of Object.entries(byRoom)) {
    for (let i = 0; i < roomReservations.length - 1; i++) {
      for (let j = i + 1; j < roomReservations.length; j++) {
        const a = roomReservations[i];
        const b = roomReservations[j];
        if (a.startAt < b.endAt && b.startAt < a.endAt) {
          conflicts.push({
            roomId: a.roomId,
            roomCode: a.room.roomCode,
            buildingCode: a.room.buildingCode,
            roomName: a.room.name,
            bookingA: { id: a.id, startAt: a.startAt.toISOString(), endAt: a.endAt.toISOString(), unitCode: a.purpose },
            bookingB: { id: b.id, startAt: b.startAt.toISOString(), endAt: b.endAt.toISOString(), unitCode: b.purpose },
          });
        }
      }
    }
  }

  return NextResponse.json({ conflicts, total: conflicts.length });
}
