import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';

export const MAX_VIDEO_BYTES = 500 * 1024 * 1024; //  500 MB
export const MAX_FILE_BYTES  = 100 * 1024 * 1024; //  100 MB

/** MIME types accepted across all upload endpoints. */
export const ALLOWED_MIME_TYPES: ReadonlySet<string> = new Set([
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
  'application/octet-stream',
]);

export interface SavedFile {
  fileUrl: string;
  mimeType: string;
  fileSize: number;
}

async function uploadToVercelBlob(fileBuffer: Buffer, fileName: string, mimeType: string): Promise<SavedFile> {
  const { put } = await import('@vercel/blob');
  const blob = await put(fileName, Buffer.from(fileBuffer), {
    contentType: mimeType,
    access: 'public',
  });
  return {
    fileUrl: blob.url,
    mimeType,
    fileSize: blob.size,
  };
}

/**
 * Upload a Web API `File` and return the public URL.
 *
 * Prefers Vercel Blob when `BLOB_READ_WRITE_TOKEN` is configured (Vercel /
 * serverless / multi-instance deployments). Falls back to local disk under
 * `public/uploads/` for traditional Node servers.
 */
export async function saveUploadedFile(file: File): Promise<SavedFile> {
  if (file.size === 0) {
    throw Object.assign(new Error('Empty file'), { status: 400 });
  }

  const isVideo = file.type.startsWith('video/');
  const maxBytes = isVideo ? MAX_VIDEO_BYTES : MAX_FILE_BYTES;
  if (file.size > maxBytes) {
    const label = isVideo ? '500MB' : '100MB';
    throw Object.assign(new Error(`File too large (max ${label})`), { status: 413 });
  }

  const mimeType = file.type || 'application/octet-stream';

  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw Object.assign(new Error('File type not allowed'), { status: 400 });
  }

  const ext = (file.name ?? 'upload').split('.').pop()?.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10) ?? 'bin';
  const folder = isVideo ? 'videos' : 'files';
  const filename = `${randomUUID()}.${ext}`;

  // Use Vercel Blob when the write token is available. This preserves uploads
  // in serverless environments where the project directory is read-only.
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const buffer = Buffer.from(await file.arrayBuffer());
    return uploadToVercelBlob(buffer, `materials/${filename}`, mimeType);
  }

  const uploadDir = join(process.cwd(), 'public', 'uploads', folder);
  await mkdir(uploadDir, { recursive: true });

  const filePath = join(uploadDir, filename);
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(filePath, buffer);

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  const publicUrl = `${baseUrl}/uploads/${folder}/${filename}`;

  return {
    fileUrl: publicUrl,
    mimeType,
    fileSize: file.size,
  };
}
