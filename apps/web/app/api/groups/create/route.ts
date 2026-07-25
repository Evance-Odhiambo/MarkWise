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
 * POST /api/groups/create
 * Body: { unitCode, groupSize?, numGroups?, autoAssignLeaders?, allowSelfEnroll?,
 *         maxGroupsPerStudent?, description?, tags? }
 * Exactly one of numGroups or groupSize must be provided.
 */
export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  let lecturer: ReturnType<typeof verifyLecturerAccessToken>;
  try { lecturer = verifyLecturerAccessToken(token); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders }); }

  const {
    unitCode,
    groupSize,
    numGroups,
    autoAssignLeaders = false,
    allowSelfEnroll = true,
    maxGroupsPerStudent = 1,
    description = null,
    tags = [],
  } = await req.json();

  if (!unitCode) return NextResponse.json({ error: 'unitCode is required' }, { status: 400, headers: corsHeaders });

  // Exactly one of numGroups / groupSize must be provided
  const hasNumGroups = numGroups !== undefined && numGroups !== null;
  const hasGroupSize = groupSize !== undefined && groupSize !== null;
  if (!hasNumGroups && !hasGroupSize)
    return NextResponse.json({ error: 'Exactly one of numGroups or groupSize is required' }, { status: 400, headers: corsHeaders });
  if (hasNumGroups && hasGroupSize)
    return NextResponse.json({ error: 'Provide only one of numGroups or groupSize, not both' }, { status: 400, headers: corsHeaders });
  if (hasNumGroups && numGroups < 1)
    return NextResponse.json({ error: 'numGroups must be at least 1' }, { status: 400, headers: corsHeaders });
  if (hasGroupSize && groupSize < 1)
    return NextResponse.json({ error: 'groupSize must be at least 1' }, { status: 400, headers: corsHeaders });

  const unit = await resolveUnitByCode(unitCode);
  if (!unit) return NextResponse.json({ error: 'Unit not found' }, { status: 404, headers: corsHeaders });

  // 403 if lecturer is not assigned to this unit (has at least one timetable slot)
  const isAssigned = await prisma.timetable.findFirst({
    where: { lecturerId: lecturer.lecturerId, unitOffering: { unitId: unit.id } },
    select: { id: true },
  });
  if (!isAssigned)
    return NextResponse.json({ error: 'You are not assigned to this unit' }, { status: 403, headers: corsHeaders });

  // 409 if groups already exist for this unit
  const existingCount = await prisma.group.count({ where: { unitId: unit.id } });
  if (existingCount > 0)
    return NextResponse.json(
      { error: 'Groups already exist for this unit. Delete or edit existing groups instead.' },
      { status: 409, headers: corsHeaders },
    );

  // Count enrolled students for this unit
  const enrollmentCount = await prisma.enrollment.count({ where: { unitId: unit.id } });

  // Compute number of groups and per-group capacity
  let count: number;
  let capacity: number;
  if (hasNumGroups) {
    count = numGroups as number;
    // capacity = ceil(enrolled / numGroups) so the largest group never over-fills
    capacity = enrollmentCount > 0 ? Math.ceil(enrollmentCount / count) : count;
  } else {
    // numGroups = ceil(enrolled / groupSize)
    count = enrollmentCount > 0 ? Math.max(1, Math.ceil(enrollmentCount / (groupSize as number))) : 1;
    capacity = groupSize as number;
  }

  // Fetch enrolled student IDs for initial distribution
  const enrollments = await prisma.enrollment.findMany({
    where: { unitId: unit.id },
    select: { studentId: true },
  });
  const studentIds = enrollments.map((e) => e.studentId);

  // Round-robin distribute students across groups
  const groupMemberSets: string[][] = Array.from({ length: count }, () => []);
  studentIds.forEach((studentId, i) => {
    groupMemberSets[i % count].push(studentId);
  });

  const shuffle = <T>(arr: T[]): T[] => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  const created = await prisma.$transaction(
    Array.from({ length: count }, (_, i) => {
      const members = autoAssignLeaders ? shuffle([...groupMemberSets[i]]) : groupMemberSets[i];
      const leaderId = autoAssignLeaders && members.length > 0 ? members[0] : null;
      const groupNum = i + 1;
      return prisma.group.create({
        data: {
          name: `Group ${groupNum}`,
          unitId: unit.id,
          unitCode: normalizeUnitCode(unit.code),
          groupNumber: groupNum,
          leaderId,
          capacity,
          allowSelfEnroll,
          maxGroupsPerStudent,
          description,
          tags,
          ...(members.length > 0 && {
            members: {
              create: members.map((studentId) => ({
                studentId,
                role: studentId === leaderId ? 'leader' : 'member',
              })),
            },
          }),
        },
        include: {
          unit: { select: { code: true } },
          members: {
            where: { leftAt: null },
            include: { student: { select: { name: true, admissionNumber: true } } },
          },
        },
      });
    }),
  );

  return NextResponse.json({ groups: created.map((g) => formatGroup(g)) }, { status: 201, headers: corsHeaders });
}

