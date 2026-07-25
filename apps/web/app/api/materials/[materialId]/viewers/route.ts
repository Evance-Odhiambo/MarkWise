import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyLecturerAccessToken } from '@/lib/lecturerAuthJwt';

export const runtime = 'nodejs';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

/**
 * GET /api/materials/:materialId/viewers
 *
 * Returns the list of students who have viewed a material, ordered by
 * viewed_at DESC.  Only the lecturer who owns the material's unit may call
 * this endpoint.
 */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ materialId: string }> },
) {
  const { materialId } = await context.params;

  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ?? '';
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
  }

  let lecturerId: string;
  try {
    ({ lecturerId } = verifyLecturerAccessToken(token));
  } catch {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401, headers: corsHeaders });
  }

  const material = await prisma.material.findUnique({
    where: { id: materialId },
    select: { id: true, lecturerId: true },
  });

  if (!material) {
    return NextResponse.json({ error: 'Material not found' }, { status: 404, headers: corsHeaders });
  }

  if (material.lecturerId !== lecturerId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: corsHeaders });
  }

  const views = await prisma.materialView.findMany({
    where: { materialId },
    orderBy: { viewedAt: 'desc' },
    include: {
      student: {
        select: { id: true, name: true, admissionNumber: true },
      },
    },
  });

  return NextResponse.json(
    views.map((v) => ({
      studentId: v.student.id,
      name: v.student.name,
      admissionNumber: v.student.admissionNumber,
      viewedAt: v.viewedAt.toISOString(),
      timeSpentSeconds: v.timeSpentSeconds ?? null,
    })),
    { headers: corsHeaders },
  );
}
