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
 * POST /api/units/:unitId/materials/bulk-upload-urls
 *
 * Batch variant of upload-url. Accepts an array of file metadata objects and
 * returns a matching array of Vercel Blob client tokens.
 *
 * Request body (JSON):
 *   [{ fileName: string, mimeType: string, fileSize?: number }, ...]
 *   — or —
 *   { files: [{ fileName, mimeType, fileSize? }, ...] }
 *
 * Response:
 *   {
 *     urls: [
 *       { clientToken: string, pathname: string, uploadUrl: string },
 *       ...
 *     ]
 *   }
 *
 * After uploading all files, call POST /api/units/:unitId/materials/bulk with
 * JSON array:
 *   [{ title, type: "file", fileUrl: "<blob-url>", mimeType, fileSize?, description? }, ...]
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

  // ── Parse body ────────────────────────────────────────────────────────────
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400, headers: corsHeaders });
  }

  const files: Array<{ fileName?: string; mimeType?: string; fileSize?: number }> = Array.isArray(raw)
    ? raw
    : ((raw as any)?.files ?? []);

  if (!Array.isArray(files) || files.length === 0) {
    return NextResponse.json(
      { error: 'Provide a non-empty array of { fileName, mimeType } objects' },
      { status: 400, headers: corsHeaders },
    );
  }

  if (files.length > 50) {
    return NextResponse.json(
      { error: 'Maximum 50 files per batch' },
      { status: 400, headers: corsHeaders },
    );
  }

  // ── Validate each entry ───────────────────────────────────────────────────
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (!f.fileName || !f.mimeType) {
      return NextResponse.json(
        { error: `Item ${i}: fileName and mimeType are required` },
        { status: 400, headers: corsHeaders },
      );
    }
    if (!ALLOWED_MIME_TYPES.has(f.mimeType)) {
      return NextResponse.json(
        { error: `Item ${i}: file type "${f.mimeType}" not allowed` },
        { status: 400, headers: corsHeaders },
      );
    }
    if (typeof f.fileSize === 'number' && f.fileSize > MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: `Item ${i}: file too large (max 100 MB)` },
        { status: 413, headers: corsHeaders },
      );
    }
  }

  // ── Generate tokens in parallel ───────────────────────────────────────────
  const urls = await Promise.all(
    files.map(async (f) => {
      const ext = f.fileName!.split('.').pop()?.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10) ?? 'bin';
      const pathname = `materials/${unit.id}/${randomUUID()}.${ext}`;
      const clientToken = await generateClientTokenFromReadWriteToken({
        token: process.env.BLOB_READ_WRITE_TOKEN!,
        pathname,
        allowedContentTypes: [f.mimeType!],
        maximumSizeInBytes: MAX_FILE_BYTES,
        validUntil: Date.now() + 10 * 60 * 1000,
      });
      return { clientToken, pathname, uploadUrl: `https://blob.vercel-storage.com/${pathname}` };
    }),
  );

  return NextResponse.json({ urls }, { headers: corsHeaders });
}
