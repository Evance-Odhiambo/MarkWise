import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyLecturerAccessToken } from '@/lib/lecturerAuthJwt';

export const runtime = 'nodejs';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

const ZERO_ANALYTICS = {
  averageGrade: 0,
  meetingAttendance: 0,
  completedAssignments: 0,
  gradeDistribution: { A: 0, B: 0, C: 0, D: 0, F: 0 },
  meetings: [] as { date: string; attendance: number }[],
  recentActivity: [] as { icon: string; color: string; text: string; time: string }[],
};

// GET /api/groups/:groupId/analytics — Group performance analytics (lecturer only)
// Returns zero-filled object when no data exists yet.
export async function GET(req: NextRequest, context: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await context.params;
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ?? '';
  try { verifyLecturerAccessToken(token); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders }); }

  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: {
      members: { where: { leftAt: null } },
      submissions: { select: { id: true, grade: true, status: true, submittedAt: true } },
    },
  });
  if (!group) return NextResponse.json({ error: 'Group not found' }, { status: 404, headers: corsHeaders });

  const grades = group.submissions.filter(s => s.grade != null).map(s => s.grade as number);
  const averageGrade = grades.length
    ? Math.round((grades.reduce((a, b) => a + b, 0) / grades.length) * 10) / 10
    : 0;

  // Grade distribution (A≥90, B≥80, C≥70, D≥60, F<60)
  const gradeDistribution = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  for (const g of grades) {
    if (g >= 90) gradeDistribution.A++;
    else if (g >= 80) gradeDistribution.B++;
    else if (g >= 70) gradeDistribution.C++;
    else if (g >= 60) gradeDistribution.D++;
    else gradeDistribution.F++;
  }

  const completedAssignments = group.submissions.filter(s => s.status === 'graded' || s.status === 'submitted').length;

  // Build recentActivity from submissions (most recent 5)
  const recentSubs = [...group.submissions]
    .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime())
    .slice(0, 5);

  const now = Date.now();
  const timeAgo = (d: Date) => {
    const diff = now - d.getTime();
    const h = Math.floor(diff / 3_600_000);
    if (h < 1) return 'just now';
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  };

  const recentActivity = recentSubs.map(s => ({
    icon: s.status === 'graded' ? 'check-circle-outline' : 'file-upload-outline',
    color: s.status === 'graded' ? 'success' : 'info',
    text: s.status === 'graded' ? 'Assignment graded' : 'Assignment submitted',
    time: timeAgo(new Date(s.submittedAt)),
  }));

  return NextResponse.json({
    averageGrade,
    meetingAttendance: 0,
    completedAssignments,
    gradeDistribution,
    meetings: [],
    recentActivity,
  }, { headers: corsHeaders });
}
