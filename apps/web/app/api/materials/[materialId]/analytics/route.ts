import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyLecturerAccessToken } from '@/lib/lecturerAuthJwt';
import { verifyStudentAccessToken } from '@/lib/studentAuthJwt';

// GET /api/materials/:materialId/analytics — Material view analytics (placeholder)
export async function GET(req: NextRequest, context: { params: Promise<{ materialId: string }> }) {
  const { materialId } = await context.params;
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  let authed = false;
  try { verifyLecturerAccessToken(token); authed = true; } catch {}
  if (!authed) { try { verifyStudentAccessToken(token); authed = true; } catch {} }
  if (!authed) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const material = await prisma.material.findUnique({ where: { id: materialId }, select: { id: true, unitId: true, createdAt: true } });
  if (!material) return NextResponse.json({ error: 'Material not found' }, { status: 404 });

  const [totalViews, uniqueViewers, viewsByDayRaw] = await Promise.all([
    prisma.materialView.count({ where: { materialId } }),
    prisma.materialView.groupBy({ by: ['studentId'], where: { materialId } }).then((r) => r.length),
    prisma.materialView.findMany({
      where: { materialId },
      select: { viewedAt: true },
      orderBy: { viewedAt: 'asc' },
    }),
  ]);

  // Aggregate views per calendar day (UTC)
  const dayMap = new Map<string, number>();
  for (const { viewedAt } of viewsByDayRaw) {
    const day = viewedAt.toISOString().slice(0, 10);
    dayMap.set(day, (dayMap.get(day) ?? 0) + 1);
  }
  const viewsByDay = Array.from(dayMap.entries()).map(([date, count]) => ({ date, count }));

  const avgRaw = await prisma.materialView.aggregate({
    where: { materialId, timeSpentSeconds: { not: null } },
    _avg: { timeSpentSeconds: true },
  });

  return NextResponse.json({
    materialId,
    views: totalViews,
    uniqueViewers,
    downloads: 0,
    averageTimeSpent: avgRaw._avg.timeSpentSeconds ?? null,
    viewsByDay,
  });
}
