import { NextResponse, type NextRequest } from 'next/server';
// NOTE: Vercel Blob upload endpoints are disabled for local development.
// For local file uploads, use the direct upload API at /api/assignments/:id/submit
// with multipart/form-data instead of the presigned upload flow.
// 
// To re-enable Vercel Blob:
// 1. Uncomment: import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client';
// 2. Set BLOB_READ_WRITE_TOKEN in your .env
// 3. Restore the original implementation
import { verifyStudentAccessToken } from '@/lib/studentAuthJwt';
import { prisma } from '@/lib/prisma';
import { isStudentEnrolledForUnit } from '@/lib/enrollmentStore';
import { randomUUID } from 'crypto';

export const runtime = 'nodejs';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

/** All MIME types accepted for assignment file submissions. */
export const ALLOWED_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  'audio/mpeg',
  'video/mp4',
  'application/zip',
  'application/json',
] as const;

/** 100 MB — enforced both here and by the upload token. */
const MAX_FILE_BYTES = 100 * 1024 * 1024;

export function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

/**
 * POST /api/assignments/:assignmentId/upload-url
 *
 * DEPRECATED for local development - returns error instructing to use direct upload.
 * This presigned upload flow requires Vercel Blob which is disabled for local dev.
 * 
 * For local development, use POST /api/assignments/:id/submit with multipart/form-data directly.
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ assignmentId: string }> },
) {
  return NextResponse.json(
    { 
      error: 'Presigned uploads disabled for local development',
      message: 'Use direct file upload via POST /api/assignments/:id/submit with multipart/form-data instead',
      presignedUploadsRequire: 'Vercel Blob (BLOB_READ_WRITE_TOKEN)'
    },
    { status: 501, headers: corsHeaders },
  );
}
