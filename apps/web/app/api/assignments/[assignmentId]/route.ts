import { NextResponse } from 'next/server';
import { resolveAdminOrLecturerScope } from '@/lib/adminLecturerAuth';
import { verifyLecturerAccessToken } from '@/lib/lecturerAuthJwt';
import { verifyStudentAccessToken } from '@/lib/studentAuthJwt';
import { prisma } from '@/lib/prisma';
import { isStudentEnrolledForUnit } from '@/lib/enrollmentStore';
import type { NextRequest } from 'next/server';

// GET /api/assignments/:assignmentId — Get assignment details
export async function GET(req: NextRequest, context: { params: Promise<{ assignmentId: string }> }) {
  const { assignmentId } = await context.params;
  const authHeader = req.headers.get('authorization');
  if (!authHeader) return NextResponse.json({ error: 'Missing Authorization header' }, { status: 401 });

  // Try admin/lecturer auth first
  const adminLecturer = resolveAdminOrLecturerScope(req);
  let isStudent = false;
  let studentId: string | null = null;
  if (!adminLecturer.ok) {
    // Try student auth
    try {
      const token = authHeader.replace('Bearer ', '');
      const student = verifyStudentAccessToken(token);
      isStudent = true;
      studentId = student.studentId;
    } catch {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
    }
  }

  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
  });
  if (!assignment) return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });

  // Optionally check enrollment for students
  if (isStudent && studentId) {
    const enrolled = await isStudentEnrolledForUnit(studentId, assignment.unitId);
    if (!enrolled) return NextResponse.json({ error: 'Not enrolled in unit' }, { status: 403 });
  }

  return NextResponse.json(assignment);
}

// PUT /api/assignments/:assignmentId — Update assignment (lecturer only)
export async function PUT(req: NextRequest, context: { params: Promise<{ assignmentId: string }> }) {
  const { assignmentId } = await context.params;
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  let lecturer: ReturnType<typeof verifyLecturerAccessToken>;
  try { lecturer = verifyLecturerAccessToken(token); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }

  const assignment = await prisma.assignment.findUnique({ where: { id: assignmentId } });
  if (!assignment) return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
  if (assignment.lecturerId !== lecturer.lecturerId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const { title, description, dueDate, maxScore, rubric, attachments, type, status } = body;
  const rawIsGroup = body.isGroup ?? body.is_group;
  const rawAllowedTypes = body.allowedTypes ?? body.allowed_types;
  const rawBlockLate = body.blockLate ?? body.block_late;
  const rawAllowResub = body.allowResub ?? body.allow_resub;
  const rawAttemptsAllowed = body.attemptsAllowed ?? body.attempts_allowed;
  const updated = await prisma.assignment.update({
    where: { id: assignmentId },
    data: {
      ...(title !== undefined && { title }),
      ...(description !== undefined && { description }),
      ...(dueDate !== undefined && { dueDate: new Date(dueDate) }),
      ...(maxScore !== undefined && { maxScore }),
      ...(rawIsGroup !== undefined && { isGroup: Boolean(rawIsGroup) }),
      ...(rawAllowedTypes !== undefined && { allowedTypes: rawAllowedTypes }),
      ...(rawBlockLate !== undefined && { blockLate: Boolean(rawBlockLate) }),
      ...(rawAllowResub !== undefined && { allowResub: Boolean(rawAllowResub) }),
      ...(rawAttemptsAllowed !== undefined && { attemptsAllowed: Number(rawAttemptsAllowed) }),
      ...(rubric !== undefined && { rubric }),
      ...(attachments !== undefined && { attachments }),
      ...(type !== undefined && { type }),
      ...(status !== undefined && { status }),
    },
  });
  return NextResponse.json(updated);
}

// DELETE /api/assignments/:assignmentId — Delete assignment (lecturer only)
export async function DELETE(req: NextRequest, context: { params: Promise<{ assignmentId: string }> }) {
  const { assignmentId } = await context.params;
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  let lecturer: ReturnType<typeof verifyLecturerAccessToken>;
  try { lecturer = verifyLecturerAccessToken(token); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }

  const assignment = await prisma.assignment.findUnique({ where: { id: assignmentId } });
  if (!assignment) return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
  if (assignment.lecturerId !== lecturer.lecturerId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await prisma.assignment.delete({ where: { id: assignmentId } });
  return NextResponse.json({ message: 'Deleted' });
}
