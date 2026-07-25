import { NextResponse, type NextRequest } from 'next/server';
import { verifyStudentAccessToken } from '@/lib/studentAuthJwt';
import { prisma } from '@/lib/prisma';
import { isStudentEnrolledForUnit } from '@/lib/enrollmentStore';

export const runtime = 'nodejs';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

// POST /api/assignments/:assignmentId/submit — Submit or resubmit assignment (student)
export async function POST(req: NextRequest, context: { params: Promise<{ assignmentId: string }> }) {
  const { assignmentId } = await context.params;
  const token =
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ??
    new URL(req.url).searchParams.get('token') ?? '';

  let studentId: string;
  try {
    const s = verifyStudentAccessToken(token);
    // Support legacy tokens that store the student UUID as 'id' instead of 'studentId'
    studentId = s.studentId ?? (s as any).id;
    if (!studentId) throw new Error('no studentId');
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
  }

  const assignment = await prisma.assignment.findUnique({ where: { id: assignmentId } });
  if (!assignment) return NextResponse.json({ error: 'Assignment not found' }, { status: 404, headers: corsHeaders });

  if (assignment.blockLate && new Date() > assignment.dueDate)
    return NextResponse.json({ error: 'Late submissions are not allowed for this assignment' }, { status: 403, headers: corsHeaders });

  const enrolled = await isStudentEnrolledForUnit(studentId, assignment.unitId);
  if (!enrolled) return NextResponse.json({ error: 'Not enrolled in unit' }, { status: 403, headers: corsHeaders });

  // Parse body (JSON or multipart)
  const contentType = req.headers.get('content-type') ?? '';
  let fileUrl: string | null = null;
  let fileName: string | null = null;
  let mimeType: string | null = null;
  let linkUrl: string | null = null;
  let textContent: string | null = null;
  let groupId: string | null = null;
  let submissionType: string = 'text';

  if (contentType.includes('multipart/form-data')) {
    const { saveUploadedFile } = await import('@/lib/fileStorage');
    const formData = await req.formData();
    submissionType = (formData.get('type') as string) ?? 'file';
    groupId = (formData.get('groupId') as string) || null;
    const rawFile = formData.get('file');
    if (rawFile && rawFile instanceof File) {
      try {
        const saved = await saveUploadedFile(rawFile);
        fileUrl = saved.fileUrl;
        fileName = rawFile.name;
        mimeType = saved.mimeType;
      } catch (err: any) {
        return NextResponse.json({ error: err.message ?? 'Upload failed' }, { status: err.status ?? 400, headers: corsHeaders });
      }
    } else {
      fileUrl = (formData.get('fileUrl') as string) || null;
      fileName = (formData.get('fileName') as string) || null;
      mimeType = (formData.get('mimeType') as string) || null;
    }
    textContent = (formData.get('text') as string) || null;
    linkUrl = (formData.get('linkUrl') as string) || null;
  } else {
    const body = await req.json();
    submissionType = body.type ?? 'text';
    fileUrl = body.fileUrl ?? null;
    fileName = body.fileName ?? null;
    mimeType = body.mimeType ?? null;
    linkUrl = body.linkUrl ?? null;
    textContent = body.text ?? body.textContent ?? null;
    groupId = body.groupId ?? null;
  }

  if (!fileUrl && !textContent && !linkUrl)
    return NextResponse.json({ error: 'A file, link, or text is required' }, { status: 400, headers: corsHeaders });

  // --- Group submission logic ---
  if (groupId) {
    if (!assignment.isGroup)
      return NextResponse.json({ error: 'This assignment does not support group submissions' }, { status: 400, headers: corsHeaders });

    const membership = await prisma.groupMember.findFirst({
      where: { groupId, studentId, leftAt: null },
    });
    if (!membership)
      return NextResponse.json({ error: 'You are not a member of this group' }, { status: 403, headers: corsHeaders });

    const groupAlreadySubmitted = await prisma.submission.findFirst({
      where: { assignmentId, groupId },
    });
    if (groupAlreadySubmitted)
      return NextResponse.json({ error: 'GROUP_ALREADY_SUBMITTED', message: 'This group has already submitted.' }, { status: 409, headers: corsHeaders });
  }

  // Determine version for this student/group
  const existingFilter = groupId
    ? { assignmentId, groupId }
    : { assignmentId, studentId };
  const existing = await prisma.submission.findFirst({
    where: existingFilter,
    orderBy: { version: 'desc' },
  });

  const now = new Date();
  const isLate = now > assignment.dueDate;
  const version = existing ? existing.version + 1 : 1;

  // Lookup submitter name
  const studentRow = await prisma.student.findUnique({ where: { id: studentId }, select: { name: true } });

  const submission = await prisma.submission.create({
    data: {
      assignmentId,
      studentId,
      groupId: groupId ?? null,
      type: submissionType,
      fileUrl,
      fileName,
      mimeType,
      linkUrl,
      textContent,
      submittedByName: studentRow?.name ?? null,
      submittedAt: now,
      version,
      status: isLate ? 'late' : 'submitted',
    },
    include: { group: { select: { name: true } } },
  });

  return NextResponse.json({
    id: submission.id,
    assignmentId: submission.assignmentId,
    studentId: submission.studentId,
    groupId: submission.groupId ?? null,
    groupName: (submission as any).group?.name ?? null,
    submittedBy: submission.studentId,
    submittedByName: submission.submittedByName ?? null,
    type: submissionType,
    fileUrl: submission.fileUrl ?? null,
    fileName: submission.fileName ?? null,
    mimeType: submission.mimeType ?? null,
    linkUrl: submission.linkUrl ?? null,
    text: submission.textContent ?? null,
    submittedAt: submission.submittedAt,
    late: isLate,
    version: submission.version,
    grade: null,
    feedback: null,
  }, { status: 201, headers: corsHeaders });
}

