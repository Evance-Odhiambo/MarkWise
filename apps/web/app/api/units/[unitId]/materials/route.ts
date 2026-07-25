import { NextResponse, type NextRequest } from 'next/server';
import { verifyLecturerAccessToken } from '@/lib/lecturerAuthJwt';
import { verifyStudentAccessToken } from '@/lib/studentAuthJwt';
import { prisma } from '@/lib/prisma';
import { saveUploadedFile } from '@/lib/fileStorage';
import { resolveUnit } from '@/lib/unitCode';
import { writeUserNotificationsForStudents } from '@/lib/userNotification';

function formatMaterial(m: any) {
  return {
    id: m.id,
    unitId: m.unitId,
    title: m.title,
    description: m.description,
    type: m.type,
    fileUrl: m.fileUrl,
    linkUrl: m.linkUrl,
    text: m.textContent,
    mimeType: m.mimeType,
    fileSize: m.fileSize,
    lecturerId: m.lecturerId,
    createdAt: String(new Date(m.createdAt).getTime()),
  };
}

// GET /api/units/:unitId/materials — List materials for a unit
// :unitId may be a UUID or a unit code such as "SCH 2180" / "SCH%202180"
export async function GET(req: NextRequest, context: { params: Promise<{ unitId: string }> }) {
  const { unitId: rawParam } = await context.params;
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let role: 'lecturer' | 'student' = 'lecturer';
  let actorId: string | null = null;
  let lecturerTokenInstitutionId: string | null = null;
  try {
    const l = verifyLecturerAccessToken(token);
    // Support legacy tokens that store the lecturer UUID as 'id' instead of 'lecturerId'
    const resolvedId = l.lecturerId ?? (l as any).id;
    if (!resolvedId) throw new Error('no lecturerId');
    role = 'lecturer';
    actorId = resolvedId;
    // Legacy tokens also embed institutionId directly in the payload
    lecturerTokenInstitutionId = (l as any).institutionId ?? null;
  } catch {
    try {
      const s = verifyStudentAccessToken(token);
      const resolvedId = s.studentId ?? (s as any).id;
      if (!resolvedId) throw new Error('no studentId');
      role = 'student';
      actorId = resolvedId;
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  // Resolve param to an actual Unit row (supports both UUID and unit code)
  const unit = await resolveUnit(rawParam);
  if (!unit) return NextResponse.json({ error: 'Unit not found' }, { status: 404 });
  const unitId = unit.id;

  if (role === 'lecturer') {
    // Allow any lecturer belonging to the same institution as the unit's department
    const unitWithDept = await prisma.unit.findUnique({
      where: { id: unitId },
      include: { department: { select: { institutionId: true } } },
    });
    // Try DB lookup first; fall back to institutionId embedded in legacy token payload
    const lecturerRow = await prisma.lecturer.findUnique({ where: { id: actorId! }, select: { institutionId: true } });
    const lecturerInstitutionId = lecturerRow?.institutionId ?? lecturerTokenInstitutionId;
    if (!unitWithDept || !lecturerInstitutionId || unitWithDept.department.institutionId !== lecturerInstitutionId) {
      return NextResponse.json({ error: 'Not authorised for this unit' }, { status: 403 });
    }
  } else {
    // Check direct Enrollment row, then fall back to course-unit membership
    const directEnrollment = await prisma.enrollment.findFirst({ where: { studentId: actorId!, unitId } });
    const enrolled = directEnrollment
      ? true
      : !!(await prisma.student.findFirst({
          where: { id: actorId!, course: { units: { some: { id: unitId } } } },
        }));
    if (!enrolled) return NextResponse.json({ error: 'Not enrolled in this unit' }, { status: 403 });
  }

  const materials = await prisma.material.findMany({
    where: { unitId },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json(materials.map(formatMaterial));
}

// POST /api/units/:unitId/materials — Upload material (assigned lecturer only)
// :unitId may be a UUID or a unit code such as "SCH 2180" / "SCH%202180"
export async function POST(req: NextRequest, context: { params: Promise<{ unitId: string }> }) {
  const { unitId: rawParam } = await context.params;
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  let lecturer: ReturnType<typeof verifyLecturerAccessToken>;
  try { lecturer = verifyLecturerAccessToken(token); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }

  // Support legacy tokens that store the lecturer UUID as 'id' instead of 'lecturerId'
  const lecturerId = lecturer.lecturerId ?? (lecturer as any).id;
  if (!lecturerId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Resolve param to an actual Unit row (supports both UUID and unit code)
  const unit = await resolveUnit(rawParam);
  if (!unit) return NextResponse.json({ error: 'Unit not found' }, { status: 404 });
  const unitId = unit.id;

  // Allow any lecturer belonging to the same institution as the unit's department
  const unitWithDept = await prisma.unit.findUnique({
    where: { id: unitId },
    include: { department: { select: { institutionId: true } } },
  });
  // Try DB lookup; fall back to institutionId embedded in legacy token payload
  const lecturerRow = await prisma.lecturer.findUnique({ where: { id: lecturerId }, select: { institutionId: true } });
  const lecturerInstitutionId = lecturerRow?.institutionId ?? (lecturer as any).institutionId ?? null;
  if (!unitWithDept || !lecturerInstitutionId || unitWithDept.department.institutionId !== lecturerInstitutionId) {
    return NextResponse.json({ error: 'Not authorised for this unit' }, { status: 403 });
  }

  const contentType = req.headers.get('content-type') ?? '';
  let title: string, description: string | null = null, fileUrl: string | null = null,
    linkUrl: string | null = null, textContent: string | null = null,
    type: string | null = null, mimeType: string | null = null, fileSize: number | null = null;

  if (contentType.includes('multipart/form-data')) {
    const formData = await req.formData();
    title = formData.get('title') as string;
    description = (formData.get('description') as string) ?? null;
    fileUrl = (formData.get('fileUrl') as string) ?? null;
    mimeType = (formData.get('mimeType') as string) ?? null;
    const fileSizeRaw = formData.get('fileSize');
    fileSize = fileSizeRaw ? Number(fileSizeRaw) : null;
    type = 'file';
    // Handle binary file upload (mobile sends `file` field as multipart binary)
    const fileField = formData.get('file') as File | null;
    if (fileField && fileField.size > 0 && !fileUrl) {
      try {
        const saved = await saveUploadedFile(fileField);
        fileUrl = saved.fileUrl;
        if (!mimeType) mimeType = saved.mimeType;
        if (!fileSize) fileSize = saved.fileSize;
      } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
      }
    }
  } else {
    const body = await req.json();
    title = body.title;
    description = body.description ?? null;
    fileUrl = body.fileUrl ?? null;
    linkUrl = body.linkUrl ?? null;
    textContent = body.text ?? body.textContent ?? null;
    type = body.type ?? null;
    mimeType = body.mimeType ?? null;
    fileSize = body.fileSize ?? null;
  }

  if (!title || (!fileUrl && !linkUrl && !textContent)) {
    return NextResponse.json({
      error: 'title and at least one of fileUrl, linkUrl, or text is required',
    }, { status: 400 });
  }

  const material = await prisma.material.create({
    data: {
      unitId,
      lecturerId: lecturerId,
      title,
      description,
      fileUrl,
      linkUrl,
      textContent,
      type: type ?? (fileUrl ? 'file' : linkUrl ? 'link' : 'text'),
      mimeType,
      fileSize,
    },
  });

  // Fan-out notification to all enrolled students (fire-and-forget)
  prisma.enrollment.findMany({ where: { unitId }, select: { studentId: true } })
    .then(async (enrollments) => {
      if (enrollments.length === 0) return;
      const studentIds = enrollments.map((e) => e.studentId);
      await Promise.all([
        prisma.notification.createMany({
          data: studentIds.map((studentId) => ({
            userId: studentId,
            userType: 'student' as const,
            title: `New material: ${title}`,
            message: `A new resource has been uploaded for your unit. Check it out now.`,
            read: false,
          })),
        }),
        writeUserNotificationsForStudents(studentIds, {
          type: 'materials',
          title: `New material: ${title}`,
          body: `A new resource has been uploaded for your unit. Check it out now.`,
          data: { materialId: material.id, unitId },
        }),
      ]);
    })
    .catch(err => console.error('[materials/upload] notification fan-out error:', err));

  return NextResponse.json(formatMaterial(material), { status: 201 });
}

