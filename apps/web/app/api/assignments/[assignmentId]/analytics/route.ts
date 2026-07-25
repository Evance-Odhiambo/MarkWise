import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyLecturerAccessToken } from '@/lib/lecturerAuthJwt';

// GET /api/assignments/:assignmentId/analytics — Grade + submission analytics (lecturer only)
export async function GET(req: NextRequest, context: { params: Promise<{ assignmentId: string }> }) {
  const { assignmentId } = await context.params;
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  let lecturer: ReturnType<typeof verifyLecturerAccessToken>;
  try { lecturer = verifyLecturerAccessToken(token); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }

  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: { submissions: { select: { grade: true, submittedAt: true, status: true } } },
  });
  if (!assignment) return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
  if (assignment.lecturerId !== lecturer.lecturerId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const submissions = assignment.submissions;
  const totalSubmissions = submissions.length;
  const late = submissions.filter(s => s.submittedAt > assignment.dueDate).length;
  const onTime = totalSubmissions - late;
  const grades = submissions.filter(s => s.grade != null).map(s => s.grade as number);
  const graded = grades.length;
  const pending = totalSubmissions - graded;
  const averageScore = graded
    ? Math.round((grades.reduce((a, b) => a + b, 0) / graded) * 10) / 10
    : 0;

  return NextResponse.json({ totalSubmissions, onTime, late, averageScore, graded, pending });
}
