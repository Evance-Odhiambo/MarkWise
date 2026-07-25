import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyLecturerAccessToken } from '@/lib/lecturerAuthJwt';
import { verifyStudentAccessToken } from '@/lib/studentAuthJwt';
import { formatGroup } from '@/lib/formatGroup';

export const runtime = 'nodejs';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

/** Resolve a unit code (including stripped/display-string variants) to a Unit row, or null. */
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

// GET /api/groups?unitCode=...  List groups for a unit ([] if none, never 404)
export async function GET(req: NextRequest) {
  const token =
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ??
    new URL(req.url).searchParams.get('token') ?? '';
  let authed = false;
  try { verifyLecturerAccessToken(token); authed = true; } catch {}
  if (!authed) { try { verifyStudentAccessToken(token); authed = true; } catch {} }
  if (!authed) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

  const rawCode = new URL(req.url).searchParams.get('unitCode');
  if (!rawCode) return NextResponse.json({ error: 'unitCode is required' }, { status: 400, headers: corsHeaders });

  const unit = await resolveUnitByCode(decodeURIComponent(rawCode));
  // Return [] rather than 404 when unit not found or no groups
  if (!unit) return NextResponse.json([], { headers: corsHeaders });

  const groups = await prisma.group.findMany({
    where: { unitId: unit.id },
    include: {
      unit: { select: { code: true } },
      members: {
        where: { leftAt: null },
        include: { student: { select: { name: true, admissionNumber: true } } },
      },
    },
    orderBy: { groupNumber: 'asc' },
  });
  return NextResponse.json(groups.map(formatGroup), { headers: corsHeaders });
}
