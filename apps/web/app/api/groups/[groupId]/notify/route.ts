import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyLecturerAccessToken } from '@/lib/lecturerAuthJwt';

export const runtime = 'nodejs';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

// POST /api/groups/:groupId/notify — Send notification to all group members (lecturer only)
export async function POST(req: NextRequest, context: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await context.params;
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ?? '';
  try { verifyLecturerAccessToken(token); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders }); }

  const { message, title } = await req.json();
  if (!message) return NextResponse.json({ error: 'message is required' }, { status: 400, headers: corsHeaders });

  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: { members: { where: { leftAt: null } } },
  });
  if (!group) return NextResponse.json({ error: 'Group not found' }, { status: 404, headers: corsHeaders });

  const notifTitle = title || `Notification: ${group.name}`;
  const result = await prisma.notification.createMany({
    data: group.members.map(m => ({
      userId: m.studentId,
      userType: 'student' as const,
      title: notifTitle,
      message,
      read: false,
    })),
  });

  return NextResponse.json(
    { message: `Notification sent to ${result.count} members` },
    { headers: corsHeaders },
  );
}

