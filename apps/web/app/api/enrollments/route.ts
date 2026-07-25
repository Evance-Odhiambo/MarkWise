import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { resolveAdminScope } from '@/lib/adminScope';

export const runtime = 'nodejs';

// GET /api/enrollments?studentId=xxx
export async function GET(req: NextRequest) {
  const scope = await resolveAdminScope(req);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const { searchParams } = new URL(req.url);
  const studentId = searchParams.get('studentId');

  if (!studentId) {
    return NextResponse.json({ error: 'studentId is required' }, { status: 400 });
  }

  // Verify the student belongs to the admin's institution
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { id: true, institutionId: true, departmentId: true },
  });
  if (!student) {
    return NextResponse.json({ error: 'Student not found' }, { status: 404 });
  }

  // Department admin may only see students in their department
  if (!scope.isInstitutionAdmin) {
    if (!scope.departmentId || scope.departmentId !== student.departmentId) {
      return NextResponse.json({ error: 'Access denied.' }, { status: 403 });
    }
  } else {
    if (scope.institutionId && student.institutionId !== scope.institutionId) {
      return NextResponse.json({ error: 'Access denied.' }, { status: 403 });
    }
  }

  const enrollments = await prisma.enrollment.findMany({
    where: { studentId },
    include: {
      unit: {
        select: {
          id: true, code: true, title: true, departmentId: true,
          department: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { id: 'asc' },
  });

  return NextResponse.json({ enrollments });
}

// POST /api/enrollments — enroll a student in a unit
export async function POST(req: NextRequest) {
  const scope = await resolveAdminScope(req);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const body = await req.json().catch(() => ({})) as { studentId?: string; unitId?: string };
  const { studentId, unitId } = body;

  if (!studentId || !unitId) {
    return NextResponse.json({ error: 'studentId and unitId are required' }, { status: 400 });
  }

  // Verify ownership
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { id: true, institutionId: true, departmentId: true },
  });
  if (!student) {
    return NextResponse.json({ error: 'Student not found' }, { status: 404 });
  }
  if (!scope.isInstitutionAdmin) {
    if (!scope.departmentId || scope.departmentId !== student.departmentId) {
      return NextResponse.json({ error: 'Access denied.' }, { status: 403 });
    }
  } else {
    if (scope.institutionId && student.institutionId !== scope.institutionId) {
      return NextResponse.json({ error: 'Access denied.' }, { status: 403 });
    }
  }

  const unit = await prisma.unit.findUnique({ where: { id: unitId }, select: { id: true } });
  if (!unit) {
    return NextResponse.json({ error: 'Unit not found' }, { status: 404 });
  }

  try {
    const enrollment = await prisma.enrollment.create({
      data: { studentId, unitId },
      include: { unit: { select: { id: true, code: true, title: true } } },
    });
    return NextResponse.json({ enrollment }, { status: 201 });
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return NextResponse.json({ error: 'Student is already enrolled in this unit.' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Failed to create enrollment' }, { status: 500 });
  }
}

// DELETE /api/enrollments?enrollmentId=xxx
export async function DELETE(req: NextRequest) {
  const scope = await resolveAdminScope(req);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const { searchParams } = new URL(req.url);
  const enrollmentId = searchParams.get('enrollmentId');
  if (!enrollmentId) {
    return NextResponse.json({ error: 'enrollmentId is required' }, { status: 400 });
  }

  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: { student: { select: { institutionId: true, departmentId: true } } },
  });
  if (!enrollment) {
    return NextResponse.json({ error: 'Enrollment not found' }, { status: 404 });
  }

  if (!scope.isInstitutionAdmin) {
    if (!scope.departmentId || scope.departmentId !== enrollment.student.departmentId) {
      return NextResponse.json({ error: 'Access denied.' }, { status: 403 });
    }
  } else {
    if (scope.institutionId && enrollment.student.institutionId !== scope.institutionId) {
      return NextResponse.json({ error: 'Access denied.' }, { status: 403 });
    }
  }

  await prisma.enrollment.delete({ where: { id: enrollmentId } });
  return NextResponse.json({ message: 'Enrollment deleted.' });
}
