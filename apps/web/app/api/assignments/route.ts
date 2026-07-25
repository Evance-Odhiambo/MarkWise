import { NextResponse, type NextRequest } from 'next/server';
import jwt from 'jsonwebtoken';
import { prisma } from '@/lib/prisma';
import { verifyLecturerAccessToken } from '@/lib/lecturerAuthJwt';
import { verifyStudentAccessToken } from '@/lib/studentAuthJwt';

export const runtime = 'nodejs';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

function extractToken(req: NextRequest): string {
  const header = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (header) return header;
  return new URL(req.url).searchParams.get('token') ?? '';
}

import { resolveUnit } from '@/lib/unitCode';

/**
 * Identify the caller's role and ID from the JWT by inspecting payload fields.
 * Since all tokens share the same JWT_SECRET, we MUST NOT rely on try/catch order —
 * a lecturer token will successfully verify as a student token too.
 * Instead we use payload field presence:
 *   - `lecturerId`                    → new lecturer token
 *   - `id` + `institutionId`          → legacy lecturer token
 *   - `studentId`                     → new student token
 *   - `id` + `admissionNumber`        → legacy student token
 */
function identifyToken(token: string): { role: 'student'; actorId: string } | { role: 'lecturer'; actorId: string; institutionId: string | null } | null {
  let payload: Record<string, any>;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET!) as Record<string, any>;
  } catch {
    return null;
  }
  // New lecturer token
  if (payload.lecturerId) {
    return { role: 'lecturer', actorId: payload.lecturerId, institutionId: payload.institutionId ?? null };
  }
  // New student token
  if (payload.studentId) {
    return { role: 'student', actorId: payload.studentId };
  }
  // Legacy tokens rely on distinguishing fields
  if (payload.id && payload.institutionId) {
    // institutionId is a lecturer-specific field — treat as legacy lecturer token
    return { role: 'lecturer', actorId: payload.id, institutionId: payload.institutionId };
  }
  if (payload.id && payload.admissionNumber) {
    // admissionNumber is a student-specific field
    return { role: 'student', actorId: payload.id };
  }
  // Last resort: fall back by attempting known verify helpers and checking fields
  try {
    const l = verifyLecturerAccessToken(token);
    const id = l.lecturerId ?? (l as any).id;
    if (id) return { role: 'lecturer', actorId: id, institutionId: (l as any).institutionId ?? null };
  } catch {}
  try {
    const s = verifyStudentAccessToken(token);
    const id = s.studentId ?? (s as any).id;
    if (id) return { role: 'student', actorId: id };
  } catch {}
  return null;
}

export async function GET(req: NextRequest) {
  const token = extractToken(req);
  const caller = identifyToken(token);
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

  const { searchParams } = new URL(req.url);
  const rawUnitId = searchParams.get('unitId');
  const rawUnits = searchParams.get('units'); // batch: comma-separated unit codes

  // ── Batch path: ?units=SCH2100,SCH2170,SCH2180 ───────────────────────────
  if (rawUnits) {
    const codes = rawUnits.split(',').map(c => c.trim()).filter(Boolean);
    if (codes.length === 0) {
      return NextResponse.json({ assignments: [] }, { headers: corsHeaders });
    }

    // Resolve all codes in parallel
    const unitRows = (await Promise.all(codes.map(c => resolveUnit(c)))).filter(Boolean) as { id: string; code: string }[];
    if (unitRows.length === 0) {
      return NextResponse.json({ assignments: [] }, { headers: corsHeaders });
    }

    // Students may only see assignments for units they are enrolled in
    let allowedUnitIds: string[] = unitRows.map(u => u.id);
    if (caller.role === 'student') {
      const enrolled = await prisma.enrollment.findMany({
        where: { studentId: caller.actorId, unitId: { in: allowedUnitIds } },
        select: { unitId: true },
      });
      const enrolledSet = new Set(enrolled.map(e => e.unitId));
      // Also allow units linked via the student's course
      const courseUnits = await prisma.student.findUnique({
        where: { id: caller.actorId },
        select: { course: { select: { units: { select: { id: true } } } } },
      });
      for (const u of courseUnits?.course?.units ?? []) enrolledSet.add(u.id);
      allowedUnitIds = allowedUnitIds.filter(id => enrolledSet.has(id));
    }

    // Build variant sets (uuid + code + stripped code) for legacy data compatibility
    const allowedUnitIdSet = new Set(allowedUnitIds); // O(1) lookup vs O(n) Array.includes
    const unitMap = new Map<string, string>(); // variantKey → canonical code
    const allVariants: string[] = [];
    for (const u of unitRows) {
      if (!allowedUnitIdSet.has(u.id)) continue;
      const stripped = u.code.replace(/\s+/g, '').toUpperCase();
      for (const v of [u.id, u.code, stripped]) {
        allVariants.push(v);
        unitMap.set(v.toUpperCase(), u.code);
      }
    }

    if (allVariants.length === 0) {
      return NextResponse.json({ assignments: [] }, { headers: corsHeaders });
    }

    const rows = await prisma.assignment.findMany({
      where: { unitId: { in: allVariants } },
      orderBy: { createdAt: 'desc' },
    });

    const assignments = rows.map(a => ({
      ...a,
      unitCode: unitMap.get(a.unitId.toUpperCase()) ?? a.unitId,
      unitId: unitMap.get(a.unitId.toUpperCase()) ?? a.unitId,
    }));
    return NextResponse.json({ assignments }, { headers: corsHeaders });
  }

  // ── Single-unit path: ?unitId=xxx ────────────────────────────────────────
  let unit: { id: string; code: string } | null = null;
  if (rawUnitId) {
    unit = await resolveUnit(decodeURIComponent(rawUnitId));
    if (!unit) return NextResponse.json({ error: 'Unit not found' }, { status: 404, headers: corsHeaders });
  }

  // Students must be enrolled in the unit (direct Enrollment row, or via their course's unit list)
  if (caller.role === 'student' && unit) {
    const directEnrollment = await prisma.enrollment.findFirst({
      where: { studentId: caller.actorId, unitId: unit.id },
    });
    const courseEnrollment = directEnrollment
      ? true
      : !!(await prisma.student.findFirst({
          where: { id: caller.actorId, course: { units: { some: { id: unit.id } } } },
        }));
    if (!courseEnrollment) return NextResponse.json({ error: 'Not enrolled in this unit' }, { status: 403, headers: corsHeaders });
  }

  // Build a resilient where clause: assignments may store the unit UUID *or* the unit code
  // (legacy data written before the UUID-resolution fix). Include both to avoid empty results.
  let whereClause: Record<string, unknown> = {};
  if (unit) {
    const variants: string[] = [unit.id, unit.code];
    const stripped = unit.code.replace(/\s+/g, '').toUpperCase();
    if (!variants.includes(stripped)) variants.push(stripped);
    whereClause = { unitId: { in: variants } };
  }

  const assignments = await prisma.assignment.findMany({
    where: whereClause,
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json(
    assignments.map(a => ({ ...a, unitId: unit?.code ?? a.unitId })),
    { headers: corsHeaders }
  );
}

export async function POST(req: NextRequest) {
  const token = extractToken(req);
  let lecturer: ReturnType<typeof verifyLecturerAccessToken>;
  try { lecturer = verifyLecturerAccessToken(token); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders }); }

  // Support legacy tokens that store the lecturer UUID as 'id' instead of 'lecturerId'
  const lecturerId = lecturer.lecturerId ?? (lecturer as any).id;
  if (!lecturerId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

  const body = await req.json();
  const { title, description, unitId: rawUnitId, dueDate, maxScore, rubric, attachments, type } = body;
  if (!title || !rawUnitId || !dueDate) {
    return NextResponse.json({ error: 'title, unitId, and dueDate are required' }, { status: 400, headers: corsHeaders });
  }

  const isGroup = Boolean(body.isGroup ?? body.is_group ?? false);
  const allowedTypes: string[] = body.allowedTypes ?? body.allowed_types ?? ['file', 'link', 'text'];
  const blockLate = Boolean(body.blockLate ?? body.block_late ?? false);
  const allowResub: boolean = body.allowResub ?? body.allow_resub ?? true;
  const attemptsAllowed = Number(body.attemptsAllowed ?? body.attempts_allowed ?? 1);

  // Resolve the incoming unitId (code or display string) to the canonical unit UUID
  const unit = await resolveUnit(String(rawUnitId));
  const resolvedUnitId = unit?.id ?? String(rawUnitId).replace(/\s+/g, '').toUpperCase();

  const assignment = await prisma.assignment.create({
    data: {
      title,
      description: description ?? null,
      unitId: resolvedUnitId,
      lecturerId,
      dueDate: new Date(dueDate),
      maxScore: maxScore ?? null,
      isGroup,
      allowedTypes,
      blockLate,
      allowResub,
      attemptsAllowed,
      rubric: rubric ?? null,
      attachments: attachments ?? null,
      type: isGroup ? 'group' : (type ?? 'individual'),
      status: 'active',
    },
  });
  return NextResponse.json({ ...assignment, unitId: unit?.code ?? assignment.unitId }, { status: 201, headers: corsHeaders });
}
