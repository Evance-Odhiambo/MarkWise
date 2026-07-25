import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { verifyLecturerAccessToken } from '@/lib/lecturerAuthJwt';

// POST /api/assignments/:assignmentId/clone — Duplicate an assignment (lecturer only)
export async function POST(req: NextRequest, context: { params: Promise<{ assignmentId: string }> }) {
  const { assignmentId } = await context.params;
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  let lecturer: ReturnType<typeof verifyLecturerAccessToken>;
  try { lecturer = verifyLecturerAccessToken(token); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }

  const source = await prisma.assignment.findUnique({ where: { id: assignmentId } });
  if (!source) return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
  if (source.lecturerId !== lecturer.lecturerId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id: _id, createdAt: _c, updatedAt: _u, rubric: _rubric, attachments: _attachments, ...rest } = source;
  const cloned = await prisma.assignment.create({
    data: {
      ...rest,
      title: `Copy of ${source.title}`,
      status: 'draft',
      rubric: source.rubric ?? Prisma.JsonNull,
      attachments: source.attachments ?? Prisma.JsonNull,
    },
  });
  return NextResponse.json(cloned, { status: 201 });
}
