import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyLecturerAccessToken } from '@/lib/lecturerAuthJwt';

export const runtime = 'nodejs';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

// GET /api/groups/:groupId/history — Group audit log (lecturer only)
export async function GET(req: NextRequest, context: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await context.params;
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ?? '';
  try { verifyLecturerAccessToken(token); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders }); }

  const group = await prisma.group.findUnique({ where: { id: groupId }, select: { id: true } });
  if (!group) return NextResponse.json({ error: 'Group not found' }, { status: 404, headers: corsHeaders });

  const members = await prisma.groupMember.findMany({
    where: { groupId },
    orderBy: { joinedAt: 'asc' },
    include: { student: { select: { name: true } } },
  });

  const events: {
    id: string;
    action: string;
    actorId: string;
    actorName: string;
    timestamp: string;
    details: string;
  }[] = [];

  for (const m of members) {
    events.push({
      id: `${m.id}-joined`,
      action: 'member_joined',
      actorId: m.studentId,
      actorName: m.student?.name ?? m.studentId,
      timestamp: m.joinedAt.toISOString(),
      details: m.role === 'leader' ? 'Joined as leader' : 'Joined via self-enrolment',
    });
    if (m.leftAt) {
      events.push({
        id: `${m.id}-left`,
        action: 'member_left',
        actorId: m.studentId,
        actorName: m.student?.name ?? m.studentId,
        timestamp: m.leftAt.toISOString(),
        details: 'Left the group',
      });
    }
  }

  events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  return NextResponse.json(events, { headers: corsHeaders });
}
