import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyStudentAccessToken } from '@/lib/studentAuthJwt';

export const runtime = 'nodejs';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

// POST /api/groups/:groupId/leave — Student leaves a group
// If the student is the leader, next member is auto-promoted (or leaderId = null if empty).
export async function POST(req: NextRequest, context: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await context.params;
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ?? '';
  let student: ReturnType<typeof verifyStudentAccessToken>;
  try { student = verifyStudentAccessToken(token); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders }); }

  const studentId = student.studentId;

  const member = await prisma.groupMember.findFirst({
    where: { groupId, studentId, leftAt: null },
  });
  if (!member) return NextResponse.json({ error: 'Not a member of this group' }, { status: 404, headers: corsHeaders });

  const group = await prisma.group.findUnique({ where: { id: groupId } });
  if (!group) return NextResponse.json({ error: 'Group not found' }, { status: 404, headers: corsHeaders });

  const isLeader = group.leaderId === studentId;

  // Mark member as left
  await prisma.groupMember.update({ where: { id: member.id }, data: { leftAt: new Date() } });

  if (isLeader) {
    // Find the next eligible active member to promote
    const nextMember = await prisma.groupMember.findFirst({
      where: { groupId, studentId: { not: studentId }, leftAt: null },
      orderBy: { joinedAt: 'asc' },
    });

    if (nextMember) {
      await prisma.$transaction([
        prisma.groupMember.update({
          where: { id: nextMember.id },
          data: { role: 'leader' },
        }),
        prisma.group.update({
          where: { id: groupId },
          data: { leaderId: nextMember.studentId },
        }),
      ]);
    } else {
      // Group is now empty — clear leaderId
      await prisma.group.update({ where: { id: groupId }, data: { leaderId: null } });
    }
  }

  return NextResponse.json({ message: 'Left group successfully' }, { headers: corsHeaders });
}
