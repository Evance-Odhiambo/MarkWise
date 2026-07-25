import { NextResponse, type NextRequest } from 'next/server';
import { verifyLecturerAccessToken } from '@/lib/lecturerAuthJwt';
import { verifyStudentAccessToken } from '@/lib/studentAuthJwt';
import { prisma } from '@/lib/prisma';

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

// GET /api/materials/:materialId — Get material details
export async function GET(req: NextRequest, context: { params: Promise<{ materialId: string }> }) {
  const { materialId } = await context.params;
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';

  let role: 'lecturer' | 'student' | null = null;
  let actorId: string | null = null;
  try { const l = verifyLecturerAccessToken(token); role = 'lecturer'; actorId = l.lecturerId; } catch {}
  if (!role) {
    try { const s = verifyStudentAccessToken(token); role = 'student'; actorId = s.studentId; } catch {}
  }
  if (!role || !actorId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const material = await prisma.material.findUnique({ where: { id: materialId } });
  if (!material) return NextResponse.json({ error: 'Material not found' }, { status: 404 });

  // Students must be enrolled in the material's unit
  if (role === 'student') {
    const enrollment = await prisma.enrollment.findFirst({
      where: { studentId: actorId, unitId: material.unitId },
    });
    if (!enrollment) return NextResponse.json({ error: 'Not enrolled in this unit' }, { status: 403 });
  }

  return NextResponse.json(formatMaterial(material));
}

async function updateMaterial(req: NextRequest, materialId: string) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  let lecturer: ReturnType<typeof verifyLecturerAccessToken>;
  try { lecturer = verifyLecturerAccessToken(token); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }

  const material = await prisma.material.findUnique({ where: { id: materialId } });
  if (!material) return NextResponse.json({ error: 'Material not found' }, { status: 404 });
  if (material.lecturerId !== lecturer.lecturerId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const { title, description, fileUrl, linkUrl, text, textContent, type, mimeType, fileSize } = body;
  const updated = await prisma.material.update({
    where: { id: materialId },
    data: {
      ...(title !== undefined && { title }),
      ...(description !== undefined && { description }),
      ...(fileUrl !== undefined && { fileUrl }),
      ...(linkUrl !== undefined && { linkUrl }),
      ...((text !== undefined || textContent !== undefined) && { textContent: text ?? textContent }),
      ...(type !== undefined && { type }),
      ...(mimeType !== undefined && { mimeType }),
      ...(fileSize !== undefined && { fileSize }),
    },
  });
  return NextResponse.json(formatMaterial(updated));
}

// PUT /api/materials/:materialId — Update material (lecturer only)
export async function PUT(req: NextRequest, context: { params: Promise<{ materialId: string }> }) {
  const { materialId } = await context.params;
  return updateMaterial(req, materialId);
}

// PATCH /api/materials/:materialId — Update material (lecturer only)
export async function PATCH(req: NextRequest, context: { params: Promise<{ materialId: string }> }) {
  const { materialId } = await context.params;
  return updateMaterial(req, materialId);
}

// DELETE /api/materials/:materialId — Delete material (lecturer only)
export async function DELETE(req: NextRequest, context: { params: Promise<{ materialId: string }> }) {
  const { materialId } = await context.params;
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  let lecturer: ReturnType<typeof verifyLecturerAccessToken>;
  try { lecturer = verifyLecturerAccessToken(token); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }

  const material = await prisma.material.findUnique({ where: { id: materialId } });
  if (!material) return NextResponse.json({ error: 'Material not found' }, { status: 404 });
  if (material.lecturerId !== lecturer.lecturerId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await prisma.material.delete({ where: { id: materialId } });
  return NextResponse.json({ message: 'Deleted' });
}


