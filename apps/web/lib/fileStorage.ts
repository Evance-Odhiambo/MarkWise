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

/**
 * Upload a Web API `File` to local filesystem and return the public URL.
 *
 * Files are stored in `public/uploads/` directory, making them accessible
 * via the Next.js static file server at `/uploads/...`.
 * Videos are stored under `videos/` subfolder for organizational clarity.
 *
 * Throws an error with a `.status` property (400 / 413) on invalid input.
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
  
  // Create the upload directory if it doesn't exist
  const uploadDir = join(process.cwd(), 'public', 'uploads', folder);
  await mkdir(uploadDir, { recursive: true });
  
  // Write file to disk
  const filePath = join(uploadDir, filename);
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(filePath, buffer);
  
  // Return public URL (served by Next.js static file handler)
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  const publicUrl = `${baseUrl}/uploads/${folder}/${filename}`;

  return {
    fileUrl: publicUrl,
    mimeType,
    fileSize: file.size,
  };
}
