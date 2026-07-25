/**
 * POST /api/student/push-token  (PATCH accepted as alias)
 *
 * Replaces the student's stored FCM token with the latest one from the device.
 * Only the most recent token is kept per student — old tokens are deleted before
 * the new one is written. This matches FCM's expectation that tokens rotate on
 * reinstall / new device sign-in.
 *
 * Body: { "token": "<FCM token>", "platform": "android" | "ios" }
 * Also accepts legacy field names "fcmToken" and "pushToken" for token.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyStudentAccessToken } from '@/lib/studentAuthJwt';

export const runtime = 'nodejs';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

async function handler(req: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const rawToken = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ?? '';
  if (!rawToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
  }

  let studentId: string;
  try {
    ({ studentId } = verifyStudentAccessToken(rawToken));
  } catch {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401, headers: corsHeaders });
  }

  // ── Body ──────────────────────────────────────────────────────────────────
  let body: { token?: string; fcmToken?: string; pushToken?: string; platform?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400, headers: corsHeaders });
  }

  // Accept "token" (spec), "fcmToken", or legacy "pushToken"
  const fcmToken = (body.token ?? body.fcmToken ?? body.pushToken ?? '').trim();
  if (!fcmToken) {
    return NextResponse.json({ error: 'token is required' }, { status: 400, headers: corsHeaders });
  }

  const platform = body.platform ?? null;

  // ── Verify student exists ─────────────────────────────────────────────────
  const studentExists = await prisma.student.findUnique({
    where: { id: studentId },
    select: { id: true },
  });
  if (!studentExists) {
    return NextResponse.json({ error: 'Student not found' }, { status: 404, headers: corsHeaders });
  }

  // ── Replace: delete all old tokens, insert the new one ───────────────────
  // Tokens rotate on re-install / new device; keep only the latest per student.
  await prisma.$transaction([
    prisma.studentPushToken.deleteMany({ where: { studentId } }),
    prisma.studentPushToken.create({ data: { studentId, fcmToken, platform } }),
  ]);

  // Keep legacy single-token column in sync for any code still reading it
  await prisma.student.update({
    where: { id: studentId },
    data: { pushToken: fcmToken },
  }).catch(() => { /* non-fatal — column may not exist in all deployments */ });

  return NextResponse.json({ success: true }, { headers: corsHeaders });
}

// Both POST (spec) and PATCH (backward compat) do the same thing
export const POST = handler;
export const PATCH = handler;
