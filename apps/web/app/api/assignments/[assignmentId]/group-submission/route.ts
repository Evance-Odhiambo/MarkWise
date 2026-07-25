import { NextResponse, type NextRequest } from 'next/server';
import { verifyStudentAccessToken } from '@/lib/studentAuthJwt';
import { prisma } from '@/lib/prisma';

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
 * GET /api/assignments/:assignmentId/group-submission?groupId=<id>
 * Returns the latest submission for the given group + assignment.
 * 404 if no submission exists (frontend treats 404 as "not submitted yet").
 * Auth: student JWT — student must be an active member of the group.
 */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ assignmentId: string }> },
) {
  const { assignmentId } = await context.params;
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ?? '';

  let studentId: string;
  try {
    const s = verifyStudentAccessToken(token);
    studentId = s.studentId ?? (s as any).id;
    if (!studentId) throw new Error('no studentId');
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
  }

  const groupId = new URL(req.url).searchParams.get('groupId');
  if (!groupId)
    return NextResponse.json({ error: 'groupId is required' }, { status: 400, headers: corsHeaders });

  // Verify the student is an active member of this group
  const membership = await prisma.groupMember.findFirst({
    where: { groupId, studentId, leftAt: null },
  });
  if (!membership)
    return NextResponse.json({ error: 'You are not a member of this group' }, { status: 403, headers: corsHeaders });

  const assignment = await prisma.assignment.findUnique({ where: { id: assignmentId } });
  if (!assignment)
    return NextResponse.json({ error: 'Assignment not found' }, { status: 404, headers: corsHeaders });

  // Latest submission for this group on this assignment
  const submission = await prisma.submission.findFirst({
    where: { assignmentId, groupId },
    orderBy: { version: 'desc' },
    include: {
      student: { select: { name: true } },
      group: { select: { name: true } },
    },
  });

  if (!submission)
    return NextResponse.json({ error: 'No submission found' }, { status: 404, headers: corsHeaders });

  const type = submission.fileUrl ? 'file' : submission.linkUrl ? 'link' : 'text';

  return NextResponse.json({
    id: submission.id,
    assignmentId: submission.assignmentId,
    studentId: submission.studentId ?? null,
    studentName: submission.student?.name ?? null,
    groupId: submission.groupId,
    groupName: submission.group?.name ?? null,
    fileUrl: submission.fileUrl ?? null,
    fileName: submission.fileName ?? null,
    linkUrl: submission.linkUrl ?? null,
    text: submission.textContent ?? null,
    type,
    submittedBy: submission.studentId ?? null,
    submittedByName: submission.submittedByName ?? null,
    submittedAt: submission.submittedAt,
    late: submission.submittedAt > assignment.dueDate,
    version: submission.version,
    grade: submission.grade ?? null,
    feedback: submission.feedback ?? null,
  }, { headers: corsHeaders });
}
