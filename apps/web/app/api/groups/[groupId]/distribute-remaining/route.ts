import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyLecturerAccessToken } from '@/lib/lecturerAuthJwt';

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
 * POST /api/groups/:unitCode/distribute-remaining
 * Auto-assigns students who have not yet joined any group for this unit into groups
 * that still have capacity. Students are distributed round-robin into the least-full groups.
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ groupId: string }> },
) {
  const { groupId: rawUnitCode } = await context.params;

  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ?? '';
  let lecturer: ReturnType<typeof verifyLecturerAccessToken>;
  try { lecturer = verifyLecturerAccessToken(token); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders }); }

  const unit = await resolveUnitByCode(decodeURIComponent(rawUnitCode));
  if (!unit) return NextResponse.json({ error: 'Unit not found' }, { status: 404, headers: corsHeaders });

  // 403 if lecturer is not assigned to this unit
  const isAssigned = await prisma.timetable.findFirst({
    where: { lecturerId: lecturer.lecturerId, unitOffering: { unitId: unit.id } },
    select: { id: true },
  });
  if (!isAssigned)
    return NextResponse.json({ error: 'You are not assigned to this unit' }, { status: 403, headers: corsHeaders });

  // 404 if no groups exist for this unit
  const groups = await prisma.group.findMany({
    where: { unitId: unit.id },
    include: { members: { where: { leftAt: null }, select: { studentId: true } } },
    orderBy: { groupNumber: 'asc' },
  });
  if (groups.length === 0)
    return NextResponse.json({ error: 'No groups found for this unit' }, { status: 404, headers: corsHeaders });

  // Find all enrolled student IDs for this unit
  const enrollments = await prisma.enrollment.findMany({
    where: { unitId: unit.id },
    select: { studentId: true },
  });
  const enrolledIds = new Set(enrollments.map((e) => e.studentId));

  // Find student IDs already in any active group for this unit
  const alreadyAssigned = new Set(
    groups.flatMap((g) => g.members.map((m) => m.studentId)),
  );

  // Students enrolled but not yet in any group
  const unassigned = [...enrolledIds].filter((id) => !alreadyAssigned.has(id));

  if (unassigned.length === 0) {
    return NextResponse.json(
      { distributed: 0, remaining: 0, message: 'All enrolled students are already in a group.' },
      { headers: corsHeaders },
    );
  }

  // Build list of non-full, unlocked groups sorted by current member count ASC (fill smallest first)
  type GroupSlot = { id: string; capacity: number; currentCount: number };
  const available: GroupSlot[] = groups
    .filter((g) => !g.locked && g.members.length < g.capacity)
    .map((g) => ({ id: g.id, capacity: g.capacity, currentCount: g.members.length }))
    .sort((a, b) => a.currentCount - b.currentCount);

  let assigned = 0;
  let skipped = 0;
  const inserts: Array<{ groupId: string; studentId: string }> = [];

  // Round-robin across available groups
  let slotIndex = 0;
  for (const studentId of unassigned) {
    // Advance past any groups that are now full
    while (slotIndex < available.length && available[slotIndex].currentCount >= available[slotIndex].capacity) {
      slotIndex++;
    }
    if (slotIndex >= available.length) {
      // No more capacity in any group
      skipped++;
      continue;
    }
    const slot = available[slotIndex];
    inserts.push({ groupId: slot.id, studentId });
    slot.currentCount++;
    assigned++;
    // Move to next slot (round-robin)
    slotIndex = (slotIndex + 1) % available.length;
  }

  if (inserts.length > 0) {
    await prisma.groupMember.createMany({ data: inserts, skipDuplicates: true });
  }

  return NextResponse.json(
    {
      distributed: assigned,
      remaining: skipped,
      message:
        skipped > 0
          ? `${assigned} student${assigned !== 1 ? 's' : ''} assigned. ${skipped} student${skipped !== 1 ? 's' : ''} could not be placed (groups at capacity).`
          : `${assigned} student${assigned !== 1 ? 's' : ''} assigned successfully.`,
    },
    { headers: corsHeaders },
  );
}
