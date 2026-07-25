import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { resolveAdminScope } from '@/lib/adminScope';

export const runtime = 'nodejs';

// GET /api/bookings/holds?institutionId=xxx
export async function GET(req: NextRequest) {
  const scope = await resolveAdminScope(req);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const institutionId = scope.institutionId;
  if (!institutionId) {
    return NextResponse.json({ error: 'Your account is not linked to an institution.' }, { status: 403 });
  }

  const holds = await prisma.bookingHold.findMany({
    where: { room: { institutionId } },
    include: {
      room: { select: { id: true, name: true, roomCode: true, buildingCode: true } },
      lecturer: { select: { id: true, fullName: true, email: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ holds });
}
