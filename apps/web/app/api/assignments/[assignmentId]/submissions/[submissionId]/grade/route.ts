import { NextResponse, type NextRequest } from 'next/server';
import { verifyLecturerAccessToken } from '@/lib/lecturerAuthJwt';
import { prisma } from '@/lib/prisma';

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
 * POST /api/assignments/:assignmentId/submissions/:submissionId/grade
 * Body: { grade: number, feedback?: string }
 * Auth: lecturer JWT (must own the assignment).
 * If the submission has a groupId, grade is propagated to all group members'
 * submissions for this assignment.
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ assignmentId: string; submissionId: string }> },
) {
  const { assignmentId, submissionId } = await context.params;
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ?? '';

  let lecturer: ReturnType<typeof verifyLecturerAccessToken>;
  try { lecturer = verifyLecturerAccessToken(token); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders }); }

  const lecturerId = lecturer.lecturerId ?? (lecturer as any).id;

  const assignment = await prisma.assignment.findUnique({ where: { id: assignmentId } });
  if (!assignment)
    return NextResponse.json({ error: 'Assignment not found' }, { status: 404, headers: corsHeaders });
  if (assignment.lecturerId !== lecturerId)
    return NextResponse.json({ error: 'Not authorized for this assignment' }, { status: 403, headers: corsHeaders });

  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: { student: { select: { name: true } }, group: { select: { name: true } } },
  });
  if (!submission || submission.assignmentId !== assignmentId)
    return NextResponse.json({ error: 'Submission not found' }, { status: 404, headers: corsHeaders });

  const body = await req.json();
  const grade = typeof body.grade === 'number' ? body.grade : parseFloat(body.grade);
  const feedback: string | null = body.feedback ?? null;

  if (isNaN(grade))
    return NextResponse.json({ error: 'grade must be a number' }, { status: 400, headers: corsHeaders });

  if (assignment.maxScore !== null && grade > assignment.maxScore)
    return NextResponse.json(
      { error: `Grade cannot exceed the maximum score of ${assignment.maxScore}` },
      { status: 400, headers: corsHeaders },
    );

  let updatedSubmission: typeof submission;

  if (submission.groupId) {
    // Propagate grade to all submissions for this group + assignment
    await prisma.submission.updateMany({
      where: { assignmentId, groupId: submission.groupId },
      data: { grade, feedback, status: 'graded' },
    });

    // Reload the specific submission to return
    updatedSubmission = await prisma.submission.findUnique({
      where: { id: submissionId },
      include: { student: { select: { name: true } }, group: { select: { name: true } } },
    }) as typeof submission;
  } else {
    updatedSubmission = await prisma.submission.update({
      where: { id: submissionId },
      data: { grade, feedback, status: 'graded' },
      include: { student: { select: { name: true } }, group: { select: { name: true } } },
    });
  }

  const type = updatedSubmission.fileUrl ? 'file' : updatedSubmission.linkUrl ? 'link' : 'text';

  return NextResponse.json({
    id: updatedSubmission.id,
    assignmentId: updatedSubmission.assignmentId,
    studentId: updatedSubmission.studentId ?? null,
    studentName: updatedSubmission.student?.name ?? null,
    groupId: updatedSubmission.groupId ?? null,
    groupName: updatedSubmission.group?.name ?? null,
    fileUrl: updatedSubmission.fileUrl ?? null,
    fileName: updatedSubmission.fileName ?? null,
    linkUrl: updatedSubmission.linkUrl ?? null,
    text: updatedSubmission.textContent ?? null,
    type,
    submittedByName: updatedSubmission.submittedByName ?? null,
    submittedAt: updatedSubmission.submittedAt,
    late: updatedSubmission.submittedAt > assignment.dueDate,
    version: updatedSubmission.version,
    grade: updatedSubmission.grade ?? null,
    feedback: updatedSubmission.feedback ?? null,
  }, { headers: corsHeaders });
}
