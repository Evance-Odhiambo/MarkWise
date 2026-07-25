import { NextResponse, type NextRequest } from 'next/server';
import { verifyStudentAccessToken } from '@/lib/studentAuthJwt';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function POST(req: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ?? '';
  let studentId: string;
  try {
    const payload = verifyStudentAccessToken(token);
    studentId = payload.studentId;
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
  }

  // ── Parse body ──────────────────────────────────────────────────────────────
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400, headers: corsHeaders });
  }

  const { fcmToken, platform } = body;
  if (!fcmToken || typeof fcmToken !== 'string' || fcmToken.trim().length === 0) {
    return NextResponse.json({ error: 'fcmToken is required' }, { status: 400, headers: corsHeaders });
  }

  try {
    // Replace any existing tokens for this student with the new one.
    // Deleting first, then creating is simplest given the (studentId, fcmToken) compound unique.
    await prisma.studentPushToken.deleteMany({ where: { studentId } });
    await prisma.studentPushToken.create({
      data: {
        studentId,
        fcmToken: fcmToken.trim(),
        platform: platform ?? null,
      },
    });

    return NextResponse.json({ success: true }, { headers: corsHeaders });
  } catch (err) {
    console.error('[notifications/register-token] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: corsHeaders });
  }
}
