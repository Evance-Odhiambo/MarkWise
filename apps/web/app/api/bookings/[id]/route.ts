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
 * DELETE /api/bookings/:id
 * Cancels a room reservation. Scoped to the institution of the authenticated user.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const institutionId = await resolveInstitutionId(req);
  if (!institutionId) {
    return NextResponse.json(
      { error: "Unauthorized. Valid admin or room manager token required." },
      { status: 401 }
    );
  }

  const { id } = await params;

  const reservation = await prisma.roomReservation.findUnique({
    where: { id },
    include: { room: { select: { institutionId: true } } },
  });

  if (!reservation) {
    return NextResponse.json({ error: "Booking not found." }, { status: 404 });
  }

  if (reservation.room.institutionId !== institutionId) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  if (reservation.status === "cancelled") {
    return NextResponse.json({ error: "Booking is already cancelled." }, { status: 409 });
  }

  await prisma.roomReservation.update({
    where: { id },
    data: { status: "cancelled" },
  });

  return NextResponse.json({ message: "Booking cancelled." });
}
