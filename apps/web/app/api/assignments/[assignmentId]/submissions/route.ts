import { NextResponse, type NextRequest } from 'next/server';
import { verifyLecturerAccessToken } from '@/lib/lecturerAuthJwt';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

function deriveType(s: { fileUrl: string | null; linkUrl: string | null; textContent: string | null }): string {
  if (s.fileUrl) return 'file';
  if (s.linkUrl) return 'link';
  return 'text';
}

function formatRow(s: any, assignment: { dueDate: Date }) {
  return {
    id: s.id,
    assignmentId: s.assignmentId,
    studentId: s.studentId ?? null,
    studentName: s.student?.name ?? null,
    groupId: s.groupId ?? null,
    groupName: s.group?.name ?? null,
    type: s.type ?? deriveType(s),
    fileUrl: s.fileUrl ?? null,
    fileName: s.fileName ?? null,
    mimeType: s.mimeType ?? null,
    linkUrl: s.linkUrl ?? null,
    text: s.textContent ?? null,
    submittedByName: s.submittedByName ?? null,
    submittedAt: s.submittedAt,
    late: s.submittedAt > assignment.dueDate,
    version: s.version,
    grade: s.grade ?? null,
    feedback: s.feedback ?? null,
  };
}

/**
 * GET /api/assignments/:assignmentId/submissions — List all submissions (lecturer only)
 * For group assignments returns [{groupId, groupName, memberCount, submission}].
 * For individual assignments returns a flat array.
 * Always returns HTTP 200 with [] when there are no submissions.
 */
export async function GET(req: NextRequest, context: { params: Promise<{ assignmentId: string }> }) {
  const { assignmentId } = await context.params;
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  let lecturer: ReturnType<typeof verifyLecturerAccessToken>;
  try { lecturer = verifyLecturerAccessToken(token); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders }); }

  const lecturerId = lecturer.lecturerId ?? (lecturer as any).id;

  const assignment = await prisma.assignment.findUnique({ where: { id: assignmentId } });
  if (!assignment) return NextResponse.json({ error: 'Assignment not found' }, { status: 404, headers: corsHeaders });
  if (assignment.lecturerId !== lecturerId)
    return NextResponse.json({ error: 'Not authorized for this assignment' }, { status: 403, headers: corsHeaders });

  const rows = await prisma.submission.findMany({
    where: { assignmentId },
    orderBy: { submittedAt: 'asc' },
    include: {
      student: { select: { name: true } },
      group: { select: { name: true } },
    },
  });

  // --- Group assignments: return one entry per group (including unsubmitted groups) ---
  if (assignment.isGroup) {
    // Resolve the unit so we can fetch all groups for it
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(assignment.unitId);
    const unit = isUuid
      ? await prisma.unit.findUnique({ where: { id: assignment.unitId } })
      : await prisma.unit.findFirst({ where: { code: { equals: assignment.unitId, mode: 'insensitive' } } });

    const groups = unit
      ? await prisma.group.findMany({
          where: { unitId: unit.id },
          include: { members: { where: { leftAt: null }, select: { studentId: true } } },
          orderBy: { groupNumber: 'asc' },
        })
      : [];

    // Pick the latest submission per groupId
    const latestByGroup = new Map<string, any>();
    for (const row of rows) {
      if (!row.groupId) continue;
      const prev = latestByGroup.get(row.groupId);
      if (!prev || row.version > prev.version) latestByGroup.set(row.groupId, row);
    }

    const result = groups.map((g) => ({
      groupId: g.id,
      groupName: g.name,
      memberCount: g.members.length,
      submission: latestByGroup.has(g.id) ? formatRow(latestByGroup.get(g.id)!, assignment) : null,
    }));

    return NextResponse.json(result, { headers: corsHeaders });
  }

  // --- Individual assignments: flat array ---
  return NextResponse.json(rows.map((s) => formatRow(s, assignment)), { headers: corsHeaders });
}

