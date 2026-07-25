import { NextResponse, type NextRequest } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import jwt from 'jsonwebtoken';

export const runtime = 'nodejs';

const MIME_TYPES: Record<string, string> = {
  pdf:  'application/pdf',
  png:  'image/png',
  jpg:  'image/jpeg',
  jpeg: 'image/jpeg',
  gif:  'image/gif',
  webp: 'image/webp',
  svg:  'image/svg+xml',
  doc:  'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls:  'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt:  'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt:  'text/plain',
  csv:  'text/csv',
  json: 'application/json',
  zip:  'application/zip',
  mp3:  'audio/mpeg',
  mp4:  'video/mp4',
};

export function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

/**
 * GET /api/files/:filename
 * JWT-authenticated file download. Accepts the token via:
 *   - Authorization: Bearer <token>   (preferred)
 *   - ?token=<token>                  (fallback for clients that can't set headers on file requests)
 */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ filename: string[] }> },
) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const token =
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ??
    new URL(req.url).searchParams.get('token') ??
    '';

  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    jwt.verify(token, process.env.JWT_SECRET!);
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── Resolve path ──────────────────────────────────────────────────────────
  const { filename: segments } = await context.params;
  const joined = segments.join('/');

  // Block path traversal
  if (joined.includes('..') || joined.includes('\\')) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  const filePath = path.join(process.cwd(), 'public', 'uploads', joined);

  // Ensure the resolved path stays inside public/uploads/
  const uploadsRoot = path.join(process.cwd(), 'public', 'uploads');
  if (!filePath.startsWith(uploadsRoot + path.sep) && filePath !== uploadsRoot) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  // ── Read & stream ─────────────────────────────────────────────────────────
  let fileBuffer: Buffer;
  try {
    fileBuffer = await fs.promises.readFile(filePath);
  } catch {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }

  const ext = path.extname(joined).toLowerCase().slice(1);
  const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
  const displayName = segments[segments.length - 1];

  return new NextResponse(new Uint8Array(fileBuffer), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(fileBuffer.length),
      'Content-Disposition': `attachment; filename="${displayName}"`,
      'Cache-Control': 'private, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
