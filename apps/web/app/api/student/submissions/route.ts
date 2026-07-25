import { NextResponse, type NextRequest } from 'next/server';
import { verifyStudentAccessToken } from '@/lib/studentAuthJwt';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

// GET /api/student/submissions?assignmentIds=id1,id2,id3
// Returns the authenticated student's submission status for all listed assignment IDs in one call.
export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ?? '';
  let studentId: string;
  try {
    studentId = verifyStudentAccessToken(token).studentId;
  } catch {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401, headers: corsHeaders });
  }

  const rawIds = new URL(req.url).searchParams.get('assignmentIds') ?? '';
  const assignmentIds = rawIds.split(',').map(s => s.trim()).filter(Boolean);

  if (assignmentIds.length === 0) {
    return NextResponse.json({ submissions: [] }, { headers: corsHeaders });
  }

  // Fetch the latest submission version per assignment for this student
  const rows = await prisma.submission.findMany({
    where: { assignmentId: { in: assignmentIds }, studentId },
    orderBy: { version: 'desc' },
    select: {
      id: true,
      assignmentId: true,
      submittedAt: true,
      grade: true,
      feedback: true,
      version: true,
      status: true,
      type: true,
      fileUrl: true,
      linkUrl: true,
      textContent: true,
      fileName: true,
      mimeType: true,
    },
  });

  // Deduplicate: keep only the highest-version submission per assignmentId
  const latest = new Map<string, typeof rows[number]>();
  for (const row of rows) {
    const existing = latest.get(row.assignmentId);
    if (!existing || row.version > existing.version) {
      latest.set(row.assignmentId, row);
    }
  }

  // Return one entry per requested assignment ID, null fields when not submitted
  const submissions = assignmentIds.map(aid => {
    const s = latest.get(aid);
    if (!s) {
      return { assignmentId: aid, submitted: false, submittedAt: null, grade: null, feedback: null, version: null, status: null };
    }
    return {
      assignmentId: s.assignmentId,
      submitted: true,
      submittedAt: s.submittedAt,
      grade: s.grade ?? null,
      feedback: s.feedback ?? null,
      version: s.version,
      status: s.status,
      type: s.type,
      fileUrl: s.fileUrl ?? null,
      linkUrl: s.linkUrl ?? null,
      text: s.textContent ?? null,
      fileName: s.fileName ?? null,
      mimeType: s.mimeType ?? null,
    };
  });

  return NextResponse.json({ submissions }, { headers: corsHeaders });
}
