/**
 * GET /api/debug/delegation-flow?studentId=xxx
 *
 * Smoke-test endpoint — never expose in production.
 * Returns: Firebase config status, student push token, active delegations.
 *
 * Remove or gate behind NEXT_PUBLIC_DEBUG_KEY before deploying publicly.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const studentId = searchParams.get('studentId');

  // 1. Firebase config check
  const firebaseConfigured = !!process.env.FIREBASE_SERVICE_ACCOUNT;
  let firebaseInitOk = false;
  if (firebaseConfigured) {
    try {
      const raw = process.env.FIREBASE_SERVICE_ACCOUNT!;
      JSON.parse(raw); // will throw if malformed
      firebaseInitOk = true;
    } catch {
      firebaseInitOk = false;
    }
  }

  // 2. Student push token
  type StudentInfo = { id: string; name: string; pushToken: string | null };
  let studentInfo: StudentInfo | null = null;
  if (studentId) {
    studentInfo = await prisma.student.findUnique({
      where: { id: studentId },
      select: { id: true, name: true, pushToken: true },
    }) as StudentInfo | null;
  }

  // 3. Active delegations for student
  const nowMs = BigInt(Date.now());
  const delegations = studentId
    ? await prisma.delegation.findMany({
        where: {
          leaderStudentId: studentId,
          used: false,
          validUntil: { gte: nowMs },
        },
        select: {
          id: true,
          unitCode: true,
          unitId: true,
          roomCode: true,
          roomId: true,
          groupNumber: true,
          groupName: true,
          validFrom: true,
          validUntil: true,
          used: true,
          sessionToken: true,
          createdAt: true,
        },
      })
    : [];

  const now = Date.now();

  return NextResponse.json({
    timestamp: now,
    firebase: {
      envVarSet: firebaseConfigured,
      jsonParseOk: firebaseInitOk,
      hint: firebaseConfigured
        ? 'FIREBASE_SERVICE_ACCOUNT is set — push should work'
        : 'FIREBASE_SERVICE_ACCOUNT is NOT set — add it to .env.local',
    },
    student: studentInfo
      ? {
          id: studentInfo.id,
          name: studentInfo.name,
          hasPushToken: !!studentInfo.pushToken,
          pushTokenPreview: studentInfo.pushToken
            ? '…' + studentInfo.pushToken.slice(-12)
            : null,
        }
      : { hint: 'Pass ?studentId=<uuid> to check a specific student' },
    activeDelegations: delegations.map((d) => ({
      id: d.id,
      unitCode: d.unitCode,
      unitId: d.unitId,
      roomCode: d.roomCode,
      roomId: d.roomId,
      groupNumber: d.groupNumber,
      groupName: d.groupName,
      validFrom: Number(d.validFrom),
      validUntil: Number(d.validUntil),
      validFromISO: new Date(Number(d.validFrom)).toISOString(),
      validUntilISO: new Date(Number(d.validUntil)).toISOString(),
      isCurrentlyValid:
        Number(d.validFrom) <= now && now <= Number(d.validUntil),
      used: d.used,
      sessionToken: d.sessionToken,
      createdAt: Number(d.createdAt),
    })),
  });
}
