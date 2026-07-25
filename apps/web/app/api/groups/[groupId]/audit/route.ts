import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyLecturerAccessToken } from '@/lib/lecturerAuthJwt';

// GET /api/groups/:groupId/audit — Group membership history (lecturer only)
export async function GET(req: NextRequest, context: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await context.params;
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  try { verifyLecturerAccessToken(token); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }

  const members = await prisma.groupMember.findMany({
    where: { groupId },
    orderBy: { joinedAt: 'asc' },
    include: { student: { select: { id: true, name: true, email: true } } },
  });

  const events = members.flatMap(m => {
    const evts: any[] = [{ event: 'member_joined', studentId: m.studentId, at: m.joinedAt }];
    if (m.leftAt) evts.push({ event: 'member_left', studentId: m.studentId, at: m.leftAt });
    return evts;
  }).sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  return NextResponse.json(events);
}

