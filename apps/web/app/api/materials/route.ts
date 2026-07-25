import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyLecturerAccessToken } from '@/lib/lecturerAuthJwt';
import { verifyStudentAccessToken } from '@/lib/studentAuthJwt';

function formatMaterial(m: any, unitCode?: string) {
  return {
    id: m.id,
    unitId: m.unitId,
    unitCode: unitCode ?? m.unitId,
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

/** Resolve a unit code (or UUID) to `{ id, code }`. Returns null if not found. */
async function resolveUnitCode(param: string): Promise<{ id: string; code: string } | null> {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(param);
  if (isUuid) {
    const u = await prisma.unit.findUnique({ where: { id: param }, select: { id: true, code: true } });
    return u ?? null;
  }
  let code = param.trim();
  const parenMatch = code.match(/\(([^)]+)\)\s*$/);
  if (parenMatch) code = parenMatch[1].trim();
  let unit = await prisma.unit.findFirst({ where: { code: { equals: code, mode: 'insensitive' } }, select: { id: true, code: true } });
  if (unit) return unit;
  const normalised = code.replace(/\s+/g, '').toUpperCase();
  unit = await prisma.unit.findFirst({ where: { code: { equals: normalised, mode: 'insensitive' } }, select: { id: true, code: true } });
  if (unit) return unit;
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "Unit" WHERE REPLACE(UPPER(code), ' ', '') = ${normalised} LIMIT 1
  `;
  if (rows.length > 0) return prisma.unit.findUnique({ where: { id: rows[0].id }, select: { id: true, code: true } });
  return null;
}

// GET /api/materials?unitId=xxx&lecturerId=xxx — Query materials
// GET /api/materials?units=SCH2100,SCH2170  — Batch materials for multiple units
export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  let authed = false;
  let studentId: string | null = null;
  try { verifyLecturerAccessToken(token); authed = true; } catch {}
  if (!authed) {
    try {
      const s = verifyStudentAccessToken(token);
      authed = true;
      studentId = s.studentId;
    } catch {}
  }
  if (!authed) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const unitId = searchParams.get('unitId');
  const lecturerId = searchParams.get('lecturerId');
  const rawUnits = searchParams.get('units'); // batch: comma-separated codes

  // ── Batch path: ?units=SCH2100,SCH2170,SCH2180 ───────────────────────────
  if (rawUnits) {
    const codes = rawUnits.split(',').map(c => c.trim()).filter(Boolean);
    if (codes.length === 0) return NextResponse.json({ materials: [] });

    const unitRows = (await Promise.all(codes.map(c => resolveUnitCode(c)))).filter(Boolean) as { id: string; code: string }[];
    if (unitRows.length === 0) return NextResponse.json({ materials: [] });

    let allowedUnitIds = unitRows.map(u => u.id);

    // Students may only see materials for enrolled units
    if (studentId) {
      const enrolled = await prisma.enrollment.findMany({
        where: { studentId, unitId: { in: allowedUnitIds } },
        select: { unitId: true },
      });
      const enrolledSet = new Set(enrolled.map(e => e.unitId));
      allowedUnitIds = allowedUnitIds.filter(id => enrolledSet.has(id));
    }

    if (allowedUnitIds.length === 0) return NextResponse.json({ materials: [] });

    const codeByUnitId = new Map(unitRows.map(u => [u.id, u.code]));
    const rows = await prisma.material.findMany({
      where: { unitId: { in: allowedUnitIds } },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json({
      materials: rows.map(m => formatMaterial(m, codeByUnitId.get(m.unitId))),
    });
  }

  // ── Single-unit / lecturer path ───────────────────────────────────────────
  if (!unitId && !lecturerId) {
    return NextResponse.json({ error: 'Provide at least unitId or lecturerId query param' }, { status: 400 });
  }

  // Students may only query materials for units they are enrolled in
  if (studentId && unitId) {
    const enrollment = await prisma.enrollment.findFirst({ where: { studentId, unitId } });
    if (!enrollment) return NextResponse.json({ error: 'Not enrolled in unit' }, { status: 403 });
  }

  const materials = await prisma.material.findMany({
    where: {
      ...(unitId ? { unitId } : {}),
      ...(lecturerId ? { lecturerId } : {}),
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json(materials.map(m => formatMaterial(m)));
}





