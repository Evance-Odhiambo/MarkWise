import { NextResponse, type NextRequest } from 'next/server';
import { verifyLecturerAccessToken } from '@/lib/lecturerAuthJwt';
import { verifyStudentAccessToken } from '@/lib/studentAuthJwt';

// POST /api/audit — Log an audit event
// Body: { action, actor?, target?, details? }
export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  let actorId: string | null = null;
  let actorType: string | null = null;

  try {
    const l = verifyLecturerAccessToken(token);
    actorId = l.lecturerId;
    actorType = 'lecturer';
  } catch {
    try {
      const s = verifyStudentAccessToken(token);
      actorId = s.studentId;
      actorType = 'student';
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const body = await req.json().catch(() => ({}));
  const entry = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    actor: actorId,
    actorType,
    action: body.action ?? 'unknown',
    target: body.target ?? null,
    details: body.details ?? null,
  };

  console.log('[AUDIT]', JSON.stringify(entry));
  return NextResponse.json(entry, { status: 201 });
}
