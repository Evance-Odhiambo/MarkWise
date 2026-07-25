import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyLecturerAccessToken } from '@/lib/lecturerAuthJwt';
import { verifyStudentAccessToken } from '@/lib/studentAuthJwt';
import { formatGroup } from '@/lib/formatGroup';

export const runtime = 'nodejs';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

const GROUP_INCLUDE = {
  unit: { select: { code: true } },
  members: {
    where: { leftAt: null as null },
    include: { student: { select: { name: true, admissionNumber: true } } },
  },
} as const;

// GET /api/groups/:groupId — Get group details (lecturer or student)
export async function GET(req: NextRequest, context: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await context.params;
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ?? '';
  let authed = false;
  try { verifyLecturerAccessToken(token); authed = true; } catch {}
  if (!authed) { try { verifyStudentAccessToken(token); authed = true; } catch {} }
  if (!authed) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

  const group = await prisma.group.findUnique({ where: { id: groupId }, include: GROUP_INCLUDE });
  if (!group) return NextResponse.json({ error: 'Group not found' }, { status: 404, headers: corsHeaders });
  return NextResponse.json(formatGroup(group), { headers: corsHeaders });
}

// PATCH /api/groups/:groupId — Lecturer: lock/unlock, promote leader, or update metadata
export async function PATCH(req: NextRequest, context: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await context.params;
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ?? '';
  try { verifyLecturerAccessToken(token); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders }); }

  const group = await prisma.group.findUnique({ where: { id: groupId } });
  if (!group) return NextResponse.json({ error: 'Group not found' }, { status: 404, headers: corsHeaders });

  const body = await req.json();
  const { locked, leaderId, name, description, allowSelfEnroll, maxGroupsPerStudent, nextMeeting } = body;

  const groupUpdates: Record<string, unknown> = {};

  // Explicit lock operations
  if (locked !== undefined) groupUpdates.locked = locked;

  // Leader promotion: demote current leader, promote new one
  if (leaderId !== undefined) {
    // Demote current leader in GroupMember
    if (group.leaderId && group.leaderId !== leaderId) {
      await prisma.groupMember.updateMany({
        where: { groupId, studentId: group.leaderId, leftAt: null },
        data: { role: 'member' },
      });
    }
    // Promote new leader in GroupMember
    if (leaderId !== null) {
      await prisma.groupMember.updateMany({
        where: { groupId, studentId: leaderId, leftAt: null },
        data: { role: 'leader' },
      });
    }
    groupUpdates.leaderId = leaderId;
  }

  // General metadata updates
  if (name !== undefined) groupUpdates.name = name;
  if (description !== undefined) groupUpdates.description = description;
  if (allowSelfEnroll !== undefined) groupUpdates.allowSelfEnroll = allowSelfEnroll;
  if (maxGroupsPerStudent !== undefined) groupUpdates.maxGroupsPerStudent = maxGroupsPerStudent;
  if (nextMeeting !== undefined) groupUpdates.nextMeeting = nextMeeting ? new Date(nextMeeting) : null;

  await prisma.group.update({ where: { id: groupId }, data: groupUpdates });

  const updated = await prisma.group.findUnique({ where: { id: groupId }, include: GROUP_INCLUDE });
  return NextResponse.json(formatGroup(updated), { headers: corsHeaders });
}

// DELETE /api/groups/:groupId — Lecturer: delete a group and all membership records
export async function DELETE(req: NextRequest, context: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await context.params;
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ?? '';
  try { verifyLecturerAccessToken(token); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders }); }

  const group = await prisma.group.findUnique({ where: { id: groupId } });
  if (!group) return NextResponse.json({ error: 'Group not found' }, { status: 404, headers: corsHeaders });

  await prisma.group.delete({ where: { id: groupId } });
  return NextResponse.json({ message: 'Group deleted successfully' }, { headers: corsHeaders });
}
