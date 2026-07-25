/**
 * GET /api/notifications/inbox
 *
 * Returns the authenticated user's active (non-dismissed) notifications,
 * ordered by createdAt DESC.
 *
 * Auth: Bearer token — accepts both student and lecturer JWTs.
 *
 * Query params:
 *   limit   integer, default 50, max 100
 *   offset  integer, default 0
 *
 * Response:
 *   { notifications: NotificationEntry[] }
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

function resolveUserId(token: string): string | null {
  try {
    return verifyStudentAccessToken(token).studentId;
  } catch {
    // not a student token — try lecturer
  }
  try {
    return verifyLecturerAccessToken(token).lecturerId;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const token = (req.headers.get('authorization') ?? '')
    .replace(/^Bearer\s+/i, '')
    .trim();
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
  }

  const userId = resolveUserId(token);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
  }

  const { searchParams } = new URL(req.url);
  const limit  = Math.min(parseInt(searchParams.get('limit')  ?? '50',  10) || 50,  100);
  const offset = Math.max(parseInt(searchParams.get('offset') ?? '0',   10) || 0,   0);

  const notifications = await prisma.userNotification.findMany({
    where: { userId, dismissedAt: null },
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip: offset,
    select: {
      id:          true,
      type:        true,
      title:       true,
      body:        true,
      data:        true,
      createdAt:   true,
      dismissedAt: true,
    },
  });

  return NextResponse.json({ notifications }, { headers: corsHeaders });
}
