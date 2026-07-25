import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyStudentAccessToken } from '@/lib/studentAuthJwt';

export const runtime = 'nodejs';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

/**
 * GET /api/student/study-groups
 * Overview of all groups across all enrolled units for the student.
 * Returns [] if not in any groups.
 */
export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ?? '';
  let student: ReturnType<typeof verifyStudentAccessToken>;
  try { student = verifyStudentAccessToken(token); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders }); }

  const memberships = await prisma.groupMember.findMany({
    where: { studentId: student.studentId, leftAt: null },
    include: {
      group: {
        select: {
          id: true,
          name: true,
          unitCode: true,
          unit: { select: { code: true } },
          groupNumber: true,
          locked: true,
          _count: { select: { members: { where: { leftAt: null } } } },
        },
      },
    },
  });

  const result = memberships.map(m => ({
    id: m.group.id,
    name: m.group.name,
    unitCode: m.group.unitCode ?? m.group.unit?.code ?? null,
    groupNumber: m.group.groupNumber,
    role: m.role,
    locked: m.group.locked,
    memberCount: m.group._count.members,
  }));

  return NextResponse.json(result, { headers: corsHeaders });
}
