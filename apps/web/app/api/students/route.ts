import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { resolveAdminScope } from '@/lib/adminScope';
import { normalizeAdmission } from '@/lib/studentStore.server';

// GET /api/students?departmentId=xxx
export async function GET(req: NextRequest) {
  // Require authentication
  const scope = await resolveAdminScope(req);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const { searchParams } = new URL(req.url);
  const requestedDeptId = (searchParams.get('departmentId') ?? '').trim();
  const requestedInstId = (searchParams.get('institutionId') ?? '').trim();
  const courseId = searchParams.get('courseId');
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '500', 10), 1000);
  const page = Math.max(parseInt(searchParams.get('page') ?? '1', 10), 1);
  const skip = (page - 1) * limit;

  // Institution-wide path: return all students across the institution
  if (scope.isInstitutionAdmin && requestedInstId && !requestedDeptId) {
    const instId = scope.institutionId ?? '';
    if (!instId || (requestedInstId !== instId)) {
      return NextResponse.json({ error: 'Access denied.' }, { status: 403 });
    }
    try {
      const where: any = { institutionId: instId };
      if (courseId) where.courseId = courseId;
      const [students, total] = await Promise.all([
        prisma.student.findMany({
          where,
          orderBy: { name: 'asc' },
          take: limit,
          skip,
          include: {
            auth: { select: { id: true } },
            _count: { select: { enrollments: true } },
            course: { select: { name: true } },
          },
        }),
        prisma.student.count({ where }),
      ]);
      return NextResponse.json({ students, total, page, limit }, {
        headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=120' },
      });
    } catch {
      return NextResponse.json({ error: 'Failed to fetch students' }, { status: 500 });
    }
  }

  // Determine which departmentId to query
  // - dept_admin: must use their own departmentId (ignore or validate the param)
  // - system_admin: may query any department in their institution
  let departmentId: string;
  if (scope.isInstitutionAdmin) {
    if (!requestedDeptId) {
      return NextResponse.json({ error: 'departmentId is required' }, { status: 400 });
    }
    // Validate dept belongs to admin's institution
    if (scope.institutionId) {
      const dept = await prisma.department.findFirst({
        where: { id: requestedDeptId, institutionId: scope.institutionId },
        select: { id: true },
      });
      if (!dept) {
        return NextResponse.json({ error: 'Department not found in your institution.' }, { status: 403 });
      }
    }
    departmentId = requestedDeptId;
  } else {
    // Dept admin: always use DB-sourced departmentId, ignore URL param
    if (!scope.departmentId) {
      return NextResponse.json({ error: 'Your account is not linked to a department.' }, { status: 403 });
    }
    departmentId = scope.departmentId;
  }

  const includeOpts = {
    auth: { select: { id: true } },
    _count: { select: { enrollments: true } },
    course: { select: { name: true } },
  };

  try {
    const where: any = { departmentId };
    if (courseId) where.courseId = courseId;
    const [students, total] = await Promise.all([
      prisma.student.findMany({
        where,
        orderBy: { name: 'asc' },
        take: limit,
        skip,
        include: includeOpts,
      }),
      prisma.student.count({ where }),
    ]);
    return NextResponse.json({ students, total, page, limit }, {
      headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=120' },
    });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch students' }, { status: 500 });
  }
}

// POST /api/students
export async function POST(req: NextRequest) {
  // Require authentication — departmentId is derived from the admin's DB record
  const scope = await resolveAdminScope(req);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const data = await req.json();
  const { name, courseId, year } = data;
  const admissionNumber = normalizeAdmission(String(data.admissionNumber ?? ''));

  // Resolve departmentId server-side; never trust the body
  const departmentId = scope.isInstitutionAdmin
    ? (data.departmentId ?? '').trim()  // institution admin may specify
    : scope.departmentId;               // dept admin: always their own

  if (!name || !admissionNumber || !courseId || !departmentId) {
    return NextResponse.json({ error: 'name, admissionNumber, courseId, and departmentId are required' }, { status: 400 });
  }
  try {
    const department = await prisma.department.findUnique({ where: { id: departmentId } });
    if (!department) {
      return NextResponse.json({ error: 'Department not found' }, { status: 404 });
    }
    // Institution admins may only add students to depts within their institution
    if (scope.isInstitutionAdmin && scope.institutionId && department.institutionId !== scope.institutionId) {
      return NextResponse.json({ error: 'Department does not belong to your institution.' }, { status: 403 });
    }
    const exists = await prisma.student.findUnique({
      where: { institutionId_admissionNumber: { institutionId: department.institutionId, admissionNumber } },
    });
    if (exists) {
      return NextResponse.json({ error: 'Student with this admission number already exists in this institution.' }, { status: 409 });
    }
    const student = await prisma.student.create({
      data: { name, admissionNumber, courseId, departmentId, institutionId: department.institutionId, year: typeof year === 'number' ? year : 1 },
    });
    return NextResponse.json(student, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Failed to add student' }, { status: 500 });
  }
}

// POST /api/students/bulk
async function POST_BULK(req: NextRequest) {
  const data = await req.json();
  const { courseId, students } = data;
  // departmentId must be inferred from courseId
  if (!courseId || !Array.isArray(students) || students.length === 0) {
    return NextResponse.json({ error: 'courseId and students array required' }, { status: 400 });
  }
  // Find course to get departmentId
  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course) {
    return NextResponse.json({ error: 'Course not found' }, { status: 404 });
  }
  const departmentId = course.departmentId;
  const institutionId = (await prisma.department.findUnique({ where: { id: departmentId } }))?.institutionId;
  if (!institutionId) {
    return NextResponse.json({ error: 'Department has no associated institution' }, { status: 422 });
  }
  const results = [];
  for (const student of students) {
    const { name } = student;
    const admissionNumber = normalizeAdmission(String(student.admissionNumber ?? ''));
    if (!name || !admissionNumber) continue;
    // Check for duplicate using the compound institution+admission index
    const exists = await prisma.student.findUnique({
      where: { institutionId_admissionNumber: { institutionId, admissionNumber } },
    });
    if (exists) {
      results.push({ admissionNumber, status: 'duplicate' });
      continue;
    }
    try {
      await prisma.student.create({
        data: { name, admissionNumber, courseId, departmentId, institutionId, year: typeof student.year === 'number' ? student.year : 1 },
      });
      results.push({ admissionNumber, status: 'created' });
    } catch {
      results.push({ admissionNumber, status: 'error' });
    }
  }
  return NextResponse.json({ results });
}