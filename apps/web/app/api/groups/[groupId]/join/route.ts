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

// POST /api/groups/:groupId/join — Student joins a group
export async function POST(req: NextRequest, context: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await context.params;
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ?? '';
  let student: ReturnType<typeof verifyStudentAccessToken>;
  try { student = verifyStudentAccessToken(token); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders }); }

  const studentId = student.studentId;

  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: { members: { where: { leftAt: null } } },
  });
  if (!group) return NextResponse.json({ error: 'Group not found' }, { status: 404, headers: corsHeaders });

  // Enforce self-enrolment flag
  if (!group.allowSelfEnroll) {
    return NextResponse.json({ error: 'Self-enrolment is disabled for this group' }, { status: 400, headers: corsHeaders });
  }

  // Enforce locked state
  if (group.locked) {
    return NextResponse.json({ error: 'LOCKED', message: 'This group is locked' }, { status: 403, headers: corsHeaders });
  }

  // Enforce capacity
  if (group.members.length >= group.capacity) {
    return NextResponse.json({ error: 'GROUP_FULL', message: 'This group has reached its maximum capacity.' }, { status: 409, headers: corsHeaders });
  }

  // Guard against duplicate active membership in this specific group
  const alreadyMember = group.members.some((m) => m.studentId === studentId);
  if (alreadyMember) {
    return NextResponse.json({ error: 'You are already a member of this group' }, { status: 409, headers: corsHeaders });
  }

  // Enforce maxGroupsPerStudent for this unit (only when unitId is set)
  if (group.unitId) {
    const currentMemberships = await prisma.groupMember.count({
      where: { studentId, leftAt: null, group: { unitId: group.unitId } },
    });
    if (currentMemberships >= group.maxGroupsPerStudent) {
      return NextResponse.json({ error: 'You are already in a group for this unit' }, { status: 400, headers: corsHeaders });
    }
  }

  await prisma.groupMember.create({ data: { groupId, studentId, role: 'member' } });

  return NextResponse.json(
    { message: 'Joined group successfully', group: { id: group.id, name: group.name, groupNumber: group.groupNumber } },
    { headers: corsHeaders },
  );
}
