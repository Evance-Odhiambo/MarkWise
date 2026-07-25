/**
 * POST /api/notifications/dismiss
 *
 * Marks one or more notifications as dismissed (soft-delete).
 * Only affects rows that belong to the authenticated user — foreign IDs are
 * silently ignored.  Idempotent: already-dismissed rows are left unchanged.
 *
 * Auth: Bearer token — accepts both student and lecturer JWTs.
 *
 * Body:  { "ids": ["uuid1", "uuid2"] }
 * Response: { "dismissed": 2 }
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyStudentAccessToken } from '@/lib/studentAuthJwt';
import { verifyLecturerAccessToken } from '@/lib/lecturerAuthJwt';

export const runtime = 'nodejs';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

export async function POST(req: NextRequest) {
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400, headers: corsHeaders });
  }

  const ids: unknown = (body as any)?.ids;
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: 'ids must be a non-empty array' }, { status: 400, headers: corsHeaders });
  }

  const validIds = ids.filter((id): id is string => typeof id === 'string' && id.length > 0);
  if (validIds.length === 0) {
    return NextResponse.json({ dismissed: 0 }, { headers: corsHeaders });
  }

  const result = await prisma.userNotification.updateMany({
    where: {
      id:          { in: validIds },
      userId,                        // only this user's own rows
      dismissedAt: null,             // no-op if already dismissed
    },
    data: { dismissedAt: new Date() },
  });

  return NextResponse.json({ dismissed: result.count }, { headers: corsHeaders });
}
