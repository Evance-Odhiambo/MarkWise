import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { resolveAdminScope } from '@/lib/adminScope';

export const runtime = 'nodejs';

// PATCH /api/bookings/holds/[id] — update hold status (expire / confirm / cancel)
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const scope = await resolveAdminScope(req);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const { id } = await context.params;
  const body = await req.json().catch(() => ({})) as { status?: string };
  const newStatus = body.status;

  const VALID_STATUSES = ['active', 'expired', 'confirmed', 'cancelled'];
  if (!newStatus || !VALID_STATUSES.includes(newStatus)) {
    return NextResponse.json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` }, { status: 400 });
  }

  const hold = await prisma.bookingHold.findUnique({
    where: { id },
    include: { room: { select: { institutionId: true } } },
  });
  if (!hold) {
    return NextResponse.json({ error: 'Hold not found' }, { status: 404 });
  }
  if (scope.institutionId && hold.room.institutionId !== scope.institutionId) {
    return NextResponse.json({ error: 'Access denied.' }, { status: 403 });
  }

  const updated = await prisma.bookingHold.update({
    where: { id },
    data: { status: newStatus as any },
    include: {
      room: { select: { id: true, name: true, roomCode: true, buildingCode: true } },
      lecturer: { select: { id: true, fullName: true, email: true } },
    },
  });

  return NextResponse.json({ hold: updated });
}
