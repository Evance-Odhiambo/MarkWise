/**
 * PATCH /api/lecturer/push-token
 *
 * Store or update the FCM token for the authenticated lecturer.
 * Called by the mobile app after FCM token refresh.
 *
 * Body:  { "fcmToken": "<string>" }
 * Auth:  Bearer lecturer JWT
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyLecturerAccessToken } from '@/lib/lecturerAuthJwt';

export const runtime = 'nodejs';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function PATCH(req: NextRequest) {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401, headers: corsHeaders });
  }
  let lecturerId: string;
  try {
    ({ lecturerId } = verifyLecturerAccessToken(token));
  } catch {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401, headers: corsHeaders });
  }

  let body: { token?: unknown; fcmToken?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ message: 'Invalid JSON body' }, { status: 400, headers: corsHeaders });
  }

  // Accept both "token" (spec) and "fcmToken" (legacy) field names
  const fcmToken = ((body.token ?? body.fcmToken) as string | undefined | null);
  if (!fcmToken || typeof fcmToken !== 'string' || !fcmToken.trim()) {
    return NextResponse.json({ error: 'token required' }, { status: 400, headers: corsHeaders });
  }

  try {
    await prisma.lecturer.update({
      where: { id: lecturerId },
      data: { fcmToken: fcmToken.trim() },
    });
    return NextResponse.json({ success: true }, { headers: corsHeaders });
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === 'P2025') {
      return NextResponse.json({ message: 'Lecturer not found' }, { status: 404, headers: corsHeaders });
    }
    console.error('[lecturer/push-token] error:', err);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500, headers: corsHeaders });
  }
}
