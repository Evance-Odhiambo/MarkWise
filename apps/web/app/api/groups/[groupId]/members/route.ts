/**
 * GET /api/groups/:groupId/members
 *
 * Returns all active members of a group with their leader flag.
 * Auth: Student or Lecturer JWT.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyStudentAccessToken } from '@/lib/studentAuthJwt';
import { verifyLecturerAccessToken } from '@/lib/lecturerAuthJwt';

export const runtime = 'nodejs';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ groupId: string }> },
) {
  // ── Auth — accept student or lecturer JWT ─────────────────────────────────
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ?? '';
  if (!token) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401, headers: corsHeaders });
  }
  let authenticated = false;
  try { verifyStudentAccessToken(token); authenticated = true; } catch { /* try lecturer */ }
  if (!authenticated) {
    try { verifyLecturerAccessToken(token); authenticated = true; } catch { /* fall through */ }
  }
  if (!authenticated) {
    return NextResponse.json({ message: 'Invalid or expired token' }, { status: 401, headers: corsHeaders });
  }

  const { groupId } = await context.params;

  // ── Verify group exists ───────────────────────────────────────────────────
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { id: true, leaderId: true },
  });
  if (!group) {
    return NextResponse.json({ message: 'Group not found' }, { status: 404, headers: corsHeaders });
  }

  // ── Fetch active members ──────────────────────────────────────────────────
  const members = await prisma.groupMember.findMany({
    where: { groupId, leftAt: null },
    select: {
      studentId: true,
      role: true,
      student: {
        select: { name: true, admissionNumber: true },
      },
    },
  });

  const response = members.map((m) => ({
    studentId: m.studentId,
    admissionNumber: m.student.admissionNumber,
    name: m.student.name,
    // isLeader: true if role column marks them, OR if they match Group.leaderId
    isLeader: m.role === 'leader' || m.studentId === group.leaderId,
  }));

  return NextResponse.json(response, { headers: corsHeaders });
}
