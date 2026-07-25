import { NextResponse } from 'next/server';
import { verifyLecturerAccessToken } from 'lib/lecturerAuthJwt';
import { verifyStudentAccessToken } from 'lib/studentAuthJwt';
import { prisma } from 'lib/prisma';
import { isStudentEnrolledForUnit } from 'lib/enrollmentStore';
import type { NextRequest } from 'next/server';

// GET /api/units/:unitId/assignments — List assignments for a unit
export async function GET(req: NextRequest, { params }: { params: Promise<{ unitId: string }> }) {
  const { unitId } = await params;
  const authHeader = req.headers.get('authorization');
  if (!authHeader) return NextResponse.json({ error: 'Missing Authorization header' }, { status: 401 });

  // Validate JWT (student or lecturer)
  const token = authHeader.replace(/^Bearer\s+/i, '');
  let user: (ReturnType<typeof verifyLecturerAccessToken> & { role: 'lecturer' }) | (ReturnType<typeof verifyStudentAccessToken> & { role: 'student' }) | null = null;
  try {
    const lecturerPayload = verifyLecturerAccessToken(token);
    user = { ...lecturerPayload, role: 'lecturer' };
  } catch {
    try {
      const studentPayload = verifyStudentAccessToken(token);
      user = { ...studentPayload, role: 'student' };
    } catch {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
    }
  }

  // Check enrollment (students only)
  if (user.role === 'student') {
    const enrolled = await isStudentEnrolledForUnit(user.studentId, unitId);
    if (!enrolled) return NextResponse.json({ error: 'Not enrolled in unit' }, { status: 403 });
  }

  const assignments = await prisma.assignment.findMany({
    where: { unitId },
    orderBy: { dueDate: 'asc' },
    select: {
      id: true,
      title: true,
      description: true,
      dueDate: true,
      lecturerId: true,
      // Add allowedSubmissionTypes and status if needed
    },
  });
  return NextResponse.json(assignments);
}

// POST /api/units/:unitId/assignments — Create assignment (lecturer only)
export async function POST(req: NextRequest, { params }: { params: Promise<{ unitId: string }> }) {
  const { unitId } = await params;
  const authHeader = req.headers.get('authorization');
  if (!authHeader) return NextResponse.json({ error: 'Missing Authorization header' }, { status: 401 });

  // Validate JWT (lecturer only)
  const token = authHeader.replace(/^Bearer\s+/i, '');
  let lecturer;
  try {
    lecturer = verifyLecturerAccessToken(token);
  } catch {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
  }

  const body = await req.json();
  const { title, description, dueAt, allowedSubmissionTypes, rules } = body;
  if (!title || !description || !dueAt) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  // Optionally validate allowedSubmissionTypes and rules
  const assignment = await prisma.assignment.create({
    data: {
      unitId,
      title,
      description,
      dueDate: new Date(dueAt),
      lecturerId: lecturer.lecturerId,
      // allowedSubmissionTypes, rules
    },
  });
  return NextResponse.json(assignment, { status: 201 });
}
