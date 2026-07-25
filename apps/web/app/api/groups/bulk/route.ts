import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyLecturerAccessToken } from '@/lib/lecturerAuthJwt';
import { formatGroup } from '@/lib/formatGroup';
import { normalizeUnitCode } from '@/lib/unitCode';

export const runtime = 'nodejs';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

/** Resolve a unit code to a Unit row, or null. */
async function resolveUnitByCode(raw: string) {
  let code = raw.trim();
  const parenMatch = code.match(/\(([^)]+)\)\s*$/);
  if (parenMatch) code = parenMatch[1].trim();
  let unit = await prisma.unit.findFirst({ where: { code: { equals: code, mode: 'insensitive' } } });
  if (unit) return unit;
  const normalised = code.replace(/\s+/g, '').toUpperCase();
  unit = await prisma.unit.findFirst({ where: { code: { equals: normalised, mode: 'insensitive' } } });
  if (unit) return unit;
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "Unit" WHERE REPLACE(UPPER(code), ' ', '') = ${normalised} LIMIT 1
  `;
  if (rows.length > 0) return prisma.unit.findUnique({ where: { id: rows[0].id } });
  return null;
}

/**
 * POST /api/groups/bulk
 * Body: { unitCode, groups: [{ name, description?, leader?, members: string[] }] }
 * members[] items can be: studentId UUID, display name, or admission number.
 */
export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  let lecturer: ReturnType<typeof verifyLecturerAccessToken>;
  try { lecturer = verifyLecturerAccessToken(token); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders }); }

  const raw = await req.json();
  const body = Array.isArray(raw) ? raw[0] : raw;
  const { unitCode, groups } = body as {
    unitCode: string;
    groups: Array<{ name: string; description?: string; leader?: string; members?: string[] }>;
  };

  if (!unitCode || !Array.isArray(groups) || groups.length === 0) {
    return NextResponse.json({ error: 'unitCode and groups array are required' }, { status: 400, headers: corsHeaders });
  }

  const unit = await resolveUnitByCode(unitCode);
  if (!unit) return NextResponse.json({ error: 'Unit not found' }, { status: 404, headers: corsHeaders });

  // Collect all unique member identifiers across all groups for a single batch lookup
  const allIdentifiers = new Set<string>();
  for (const g of groups) {
    for (const m of g.members ?? []) allIdentifiers.add(m);
    if (g.leader) allIdentifiers.add(g.leader);
  }

  // Resolve identifiers: try studentId UUID → admissionNumber → name (case-insensitive)
  const identList = Array.from(allIdentifiers);
  const students = await prisma.student.findMany({
    where: {
      OR: [
        { id: { in: identList } },
        { admissionNumber: { in: identList } },
        { name: { in: identList, mode: 'insensitive' } },
      ],
    },
    select: { id: true, name: true, admissionNumber: true },
  });

  // Build lookup: identifier → studentId
  const idMap = new Map<string, string>();
  for (const s of students) {
    idMap.set(s.id, s.id);
    idMap.set(s.admissionNumber.toLowerCase(), s.id);
    idMap.set(s.name.toLowerCase(), s.id);
  }
  const resolve = (ident: string): string | null =>
    idMap.get(ident) ?? idMap.get(ident.toLowerCase()) ?? null;

  // Find current max groupNumber for stable sequential naming
  const maxResult = await prisma.group.aggregate({
    where: { unitId: unit.id },
    _max: { groupNumber: true },
  });
  const startNumber = (maxResult._max.groupNumber ?? 0) + 1;

  const created = await prisma.$transaction(
    groups.map((g, i) => {
      const groupNum = startNumber + i;
      const memberIds = (g.members ?? []).map(resolve).filter(Boolean) as string[];
      const leaderId = g.leader ? (resolve(g.leader) ?? null) : null;

      return prisma.group.create({
        data: {
          name: g.name || `Group ${groupNum}`,
          unitId: unit.id,
          unitCode: normalizeUnitCode(unit.code),
          groupNumber: groupNum,
          leaderId,
          description: g.description ?? null,
          ...(memberIds.length > 0 && {
            members: {
              create: memberIds.map(studentId => ({
                studentId,
                role: studentId === leaderId ? 'leader' : 'member',
              })),
            },
          }),
        },
        include: {
          unit: { select: { code: true } },
          members: { where: { leftAt: null }, include: { student: { select: { name: true, admissionNumber: true } } } },
        },
      });
    })
  );

  return NextResponse.json({ groups: created.map(g => formatGroup(g)) }, { status: 201, headers: corsHeaders });
}
