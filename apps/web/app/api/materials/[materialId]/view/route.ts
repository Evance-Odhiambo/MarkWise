import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyStudentAccessToken } from '@/lib/studentAuthJwt';

export const runtime = 'nodejs';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

/**
 * POST /api/materials/:materialId/view
 *
 * Records (or refreshes) a student's view of a material.
 * Upserts on (materialId, studentId) — first call inserts, subsequent calls
 * update viewedAt and optionally timeSpentSeconds.
 *
 * Body (all optional): { timeSpentSeconds?: number }
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ materialId: string }> },
) {
  const { materialId } = await context.params;

  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ?? '';
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
  }

  let studentId: string;
  try {
    ({ studentId } = verifyStudentAccessToken(token));
  } catch {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401, headers: corsHeaders });
  }

  const material = await prisma.material.findUnique({
    where: { id: materialId },
    select: { id: true },
  });
  if (!material) {
    return NextResponse.json({ error: 'Material not found' }, { status: 404, headers: corsHeaders });
  }

  let timeSpentSeconds: number | undefined;
  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body.timeSpentSeconds === 'number' && body.timeSpentSeconds >= 0) {
      timeSpentSeconds = Math.round(body.timeSpentSeconds);
    }
  } catch {
    // body is optional — ignore parse errors
  }

  await prisma.materialView.upsert({
    where: { materialId_studentId: { materialId, studentId } },
    create: { materialId, studentId, timeSpentSeconds: timeSpentSeconds ?? null },
    update: {
      viewedAt: new Date(),
      ...(timeSpentSeconds !== undefined ? { timeSpentSeconds } : {}),
    },
  });

  return NextResponse.json({ ok: true }, { headers: corsHeaders });
}
