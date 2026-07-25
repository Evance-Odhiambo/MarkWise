import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyStudentAccessToken } from '@/lib/studentAuthJwt';
import { formatGroup } from '@/lib/formatGroup';

export const runtime = 'nodejs';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
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

const MEMBER_INCLUDE = {
  where: { leftAt: null as null },
  include: { student: { select: { name: true, admissionNumber: true } } },
} as const;

/**
 * GET /api/groups/my?unitCode=SCH2170
 * Returns the student's single active group for the given unit, or 404.
 * groupNumber is critical — cached locally by the mobile app for BLE delegation.
 */
export async function GET(req: NextRequest) {
  const token =
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ??
    new URL(req.url).searchParams.get('token') ?? '';

  let studentId: string;
  try {
    const s = verifyStudentAccessToken(token);
    studentId = s.studentId ?? (s as any).id;
    if (!studentId) throw new Error('no studentId');
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
  }

  const rawCode = new URL(req.url).searchParams.get('unitCode');
  if (!rawCode) return NextResponse.json({ error: 'unitCode is required' }, { status: 400, headers: corsHeaders });

  const unit = await resolveUnitByCode(decodeURIComponent(rawCode));
  if (!unit) return NextResponse.json({ error: 'Unit not found' }, { status: 404, headers: corsHeaders });

  const membership = await prisma.groupMember.findFirst({
    where: { studentId, leftAt: null, group: { unitId: unit.id } },
    include: {
      group: {
        include: {
          unit: { select: { code: true } },
          members: MEMBER_INCLUDE,
        },
      },
    },
  });

  if (!membership) {
    return NextResponse.json(null, { headers: corsHeaders });
  }

  return NextResponse.json(formatGroup(membership.group), { headers: corsHeaders });
}

