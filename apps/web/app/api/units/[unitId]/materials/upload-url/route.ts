import { NextResponse, type NextRequest } from 'next/server';
import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client';
import { verifyLecturerAccessToken } from '@/lib/lecturerAuthJwt';
import { prisma } from '@/lib/prisma';
import { ALLOWED_MIME_TYPES, MAX_FILE_BYTES } from '@/lib/fileStorage';
import { randomUUID } from 'crypto';
import { resolveUnit } from '@/lib/unitCode';

export const runtime = 'nodejs';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

/**
 * POST /api/units/:unitId/materials/upload-url
 *
 * Step 1 of the presigned-upload flow for learning materials.
 * Returns a Vercel Blob client token that the client uses to PUT the file
 * directly to Vercel Blob (bypassing Vercel's 4.5 MB serverless body limit).
 *
 * Request body (JSON):
 *   { fileName: string, mimeType: string, fileSize?: number }
 *
 * Response:
 *   { clientToken: string, pathname: string, uploadUrl: string }
 *
 * After uploading, call POST /api/units/:unitId/materials with JSON:
 *   { title, type: "file", fileUrl: "<blob-url>", mimeType, fileSize?, description? }
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ unitId: string }> },
) {
  const { unitId: rawParam } = await context.params;

  // ── Auth ──────────────────────────────────────────────────────────────────
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ?? '';
  let lecturer: ReturnType<typeof verifyLecturerAccessToken>;
  try {
    lecturer = verifyLecturerAccessToken(token);
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
  }
  const lecturerId = lecturer.lecturerId ?? (lecturer as any).id;
  if (!lecturerId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
  }

  // ── Resolve unit + institution check ─────────────────────────────────────
  const unit = await resolveUnit(rawParam);
  if (!unit) {
    return NextResponse.json({ error: 'Unit not found' }, { status: 404, headers: corsHeaders });
  }

  const unitWithDept = await prisma.unit.findUnique({
    where: { id: unit.id },
    include: { department: { select: { institutionId: true } } },
  });
  const lecturerRow = await prisma.lecturer.findUnique({
    where: { id: lecturerId },
    select: { institutionId: true },
  });
  const lecturerInstitutionId = lecturerRow?.institutionId ?? (lecturer as any).institutionId ?? null;
  if (!unitWithDept || !lecturerInstitutionId || unitWithDept.department.institutionId !== lecturerInstitutionId) {
    return NextResponse.json({ error: 'Not authorised for this unit' }, { status: 403, headers: corsHeaders });
  }

  // ── Parse + validate file metadata ───────────────────────────────────────
  let body: { fileName?: string; mimeType?: string; fileSize?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400, headers: corsHeaders });
  }

  const { fileName, mimeType, fileSize } = body;

  if (!fileName || !mimeType) {
    return NextResponse.json(
      { error: 'fileName and mimeType are required' },
      { status: 400, headers: corsHeaders },
    );
  }

  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return NextResponse.json({ error: 'File type not allowed' }, { status: 400, headers: corsHeaders });
  }

  if (typeof fileSize === 'number' && fileSize > MAX_FILE_BYTES) {
    return NextResponse.json({ error: 'File too large (max 100 MB)' }, { status: 413, headers: corsHeaders });
  }

  // ── Generate Vercel Blob client token ─────────────────────────────────────
  const ext = fileName.split('.').pop()?.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10) ?? 'bin';
  const pathname = `materials/${unit.id}/${randomUUID()}.${ext}`;

  const clientToken = await generateClientTokenFromReadWriteToken({
    token: process.env.BLOB_READ_WRITE_TOKEN!,
    pathname,
    allowedContentTypes: [mimeType],
    maximumSizeInBytes: MAX_FILE_BYTES,
    validUntil: Date.now() + 10 * 60 * 1000,
  });

  return NextResponse.json(
    { clientToken, pathname, uploadUrl: `https://blob.vercel-storage.com/${pathname}` },
    { headers: corsHeaders },
  );
}
