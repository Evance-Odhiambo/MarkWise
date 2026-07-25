// materialsApi.js
import { API_BASE_URL } from './constants';
import { getLecturerSession, getStudentSession } from './authSession';
import ReactNativeBlobUtil from 'react-native-blob-util';

/**
 * Steps 1 & 2 of the presigned-URL upload flow.
 *
 * 1. POST presignedEndpoint → { clientToken, uploadUrl }
 * 2. PUT file bytes to uploadUrl with Authorization: Bearer {clientToken}
 *    Returns the Vercel Blob URL string.
 *
 * onProgress(pct 0-100) is optional and fires during the PUT.
 */
async function _uploadViaPresignedUrl(presignedEndpoint, file, sessionToken, onProgress) {
  // Step 1 — request a presigned token from our backend
  const tokenRes = await fetch(presignedEndpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${sessionToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      fileSize: file.size,
    }),
  });
  if (!tokenRes.ok) throw new Error('Failed to get upload token');
  const { clientToken, uploadUrl } = await tokenRes.json();

  // Step 2 — PUT raw bytes directly to Vercel Blob (bypasses Vercel's 4.5 MB serverless limit)
  const fileUri = file.uri.startsWith('file://') ? file.uri.slice(7) : file.uri;
  const putTask = ReactNativeBlobUtil.fetch(
    'PUT',
    uploadUrl,
    {
      Authorization: `Bearer ${clientToken}`,
      'Content-Type': file.type || 'application/octet-stream',
    },
    ReactNativeBlobUtil.wrap(fileUri),
  );
  if (onProgress) {
    putTask.uploadProgress((written, total) => {
      if (total > 0) onProgress(Math.round((written / total) * 100));
    });
  }
  const putRes = await putTask;
  if (putRes.respInfo.status >= 400) throw new Error('Failed to upload file to storage');
  const blobData = putRes.json(); // { url, downloadUrl, pathname, contentType, ... }
  return blobData.url;
}

function extractUnitCode(raw) {
  const s = String(raw || '').trim();
  const match = s.match(/\(([^)]+)\)/);
  if (match) return match[1].replace(/\s+/g, '').toUpperCase();
  return s.replace(/\s+/g, '').toUpperCase();
}

// Lecturer: Upload material (file, link, or text)
export async function uploadMaterial(unitId, { title, description, type, file, linkUrl, text }) {
  const session = await getLecturerSession();
  const resolvedTitle = title || (type === 'file' && file?.name) || (type === 'link' && linkUrl) || type || 'Untitled';

  if (type === 'file' && file) {
    // Step 1 & 2 — get presigned token, upload bytes directly to Vercel Blob
    const fileUrl = await _uploadViaPresignedUrl(
      `${API_BASE_URL}/api/units/${unitId}/materials/upload-url`,
      file,
      session?.token,
    );
    // Step 3 — register the material record with the blob URL
    const headers = { Authorization: `Bearer ${session?.token}`, 'Content-Type': 'application/json' };
    const res = await fetch(`${API_BASE_URL}/api/units/${unitId}/materials`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: resolvedTitle, description, type: 'file', fileUrl, fileName: file.name, mimeType: file.type || 'application/octet-stream' }),
    });
    if (!res.ok) {
      let errMsg = 'Failed to save material';
      try { const e = await res.json(); errMsg = e?.message || e?.error || errMsg; } catch (_) {}
      throw new Error(errMsg);
    }
    return res.json();
  }

  // Link or text — no file bytes, plain JSON
  const headers = { Authorization: `Bearer ${session?.token}`, 'Content-Type': 'application/json' };
  const res = await fetch(`${API_BASE_URL}/api/units/${unitId}/materials`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ title: resolvedTitle, description, type, linkUrl, text }),
  });
  if (!res.ok) {
    let errMsg = 'Failed to upload material';
    try { const e = await res.json(); errMsg = e?.message || e?.error || errMsg; } catch (_) {}
    throw new Error(errMsg);
  }
  return res.json();
}

// Lecturer: Upload material with real upload-progress callback
export async function uploadMaterialWithProgress(unitId, { title, description, type, file, linkUrl, text }, onProgress) {
  const session = await getLecturerSession();
  const resolvedTitle = title || (type === 'file' && file?.name) || (type === 'link' && linkUrl) || type || 'Untitled';

  if (type === 'file' && file) {
    // Step 1 & 2 — presigned token + direct PUT with progress tracking
    const fileUrl = await _uploadViaPresignedUrl(
      `${API_BASE_URL}/api/units/${unitId}/materials/upload-url`,
      file,
      session?.token,
      onProgress,
    );
    // Step 3 — register the material record
    const headers = { Authorization: `Bearer ${session?.token}`, 'Content-Type': 'application/json' };
    const res = await fetch(`${API_BASE_URL}/api/units/${unitId}/materials`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: resolvedTitle, description, type: 'file', fileUrl, fileName: file.name, mimeType: file.type || 'application/octet-stream' }),
    });
    if (!res.ok) {
      let errMsg = 'Failed to save material';
      try { const e = await res.json(); errMsg = e?.message || e?.error || errMsg; } catch (_) {}
      throw new Error(errMsg);
    }
    return res.json();
  }

  // Non-file types (link, text)
  const headers = { Authorization: `Bearer ${session?.token}`, 'Content-Type': 'application/json' };
  const res = await fetch(`${API_BASE_URL}/api/units/${unitId}/materials`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ title: resolvedTitle, description, type, linkUrl, text }),
  });
  if (!res.ok) throw new Error('Failed to upload material');
  onProgress?.(100);
  return res.json();
}

// Lecturer: Edit material (metadata-only or with a replacement file)
export async function editMaterial(materialId, data) {
  const session = await getLecturerSession();
  const file = data.file;
  const hasLocalFile = file && typeof file.uri === 'string' &&
    (file.uri.startsWith('file://') || file.uri.startsWith('content://'));

  if (hasLocalFile) {
    // Step 1 & 2 — presigned token for replacement file + direct PUT to Vercel Blob
    const fileUrl = await _uploadViaPresignedUrl(
      `${API_BASE_URL}/api/materials/${materialId}/upload-url`,
      file,
      session?.token,
    );
    // Step 3 — update material record with blob URL (no file bytes sent to backend)
    const { file: _drop, ...meta } = data;
    const headers = { Authorization: `Bearer ${session?.token}`, 'Content-Type': 'application/json' };
    const res = await fetch(`${API_BASE_URL}/api/materials/${materialId}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ ...meta, fileUrl, fileName: file.name, mimeType: file.type || 'application/octet-stream' }),
    });
    if (res.status >= 400) throw new Error('Failed to edit material');
    return res.json();
  }

  // No new file — plain JSON update
  const { file: _unused, ...body } = data;
  const headers = { Authorization: `Bearer ${session?.token}`, 'Content-Type': 'application/json' };
  const res = await fetch(`${API_BASE_URL}/api/materials/${materialId}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('Failed to edit material');
  return res.json();
}

// Lecturer: Delete material
export async function deleteMaterial(materialId) {
  const session = await getLecturerSession();
  const headers = { Authorization: `Bearer ${session?.token}` };
  const res = await fetch(`${API_BASE_URL}/materials/${materialId}`, {
    method: 'DELETE',
    headers,
  });
  if (!res.ok) throw new Error('Failed to delete material');
  return res.json();
}

// Lecturer: Bulk upload materials
export async function bulkUploadMaterials(unitId, files) {
  const session = await getLecturerSession();

  // Step 1 — request presigned tokens for all files in one call (up to 50)
  const tokenRes = await fetch(`${API_BASE_URL}/api/units/${unitId}/materials/bulk-upload-urls`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session?.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(
      files.map(f => ({ fileName: f.name, mimeType: f.type || 'application/octet-stream', fileSize: f.size }))
    ),
  });
  if (!tokenRes.ok) throw new Error('Failed to get bulk upload tokens');
  const tokens = await tokenRes.json(); // [{ clientToken, uploadUrl }, ...]

  // Step 2 — PUT each file directly to its Vercel Blob URL (in parallel)
  const fileUrls = await Promise.all(
    files.map(async (file, i) => {
      const { clientToken, uploadUrl } = tokens[i];
      const fileUri = file.uri.startsWith('file://') ? file.uri.slice(7) : file.uri;
      const putRes = await ReactNativeBlobUtil.fetch(
        'PUT',
        uploadUrl,
        {
          Authorization: `Bearer ${clientToken}`,
          'Content-Type': file.type || 'application/octet-stream',
        },
        ReactNativeBlobUtil.wrap(fileUri),
      );
      if (putRes.respInfo.status >= 400) throw new Error(`Failed to upload ${file.name}`);
      return putRes.json().url;
    })
  );

  // Step 3 — register all material records in one request
  const res = await fetch(`${API_BASE_URL}/api/units/${unitId}/materials/bulk`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session?.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(
      files.map((f, i) => ({
        title: f.name,
        type: 'file',
        fileUrl: fileUrls[i],
        fileName: f.name,
        mimeType: f.type || 'application/octet-stream',
      }))
    ),
  });
  if (!res.ok) throw new Error('Failed to bulk register materials');
  return res.json();
}

// Lecturer: Get material analytics
export async function getMaterialAnalytics(materialId) {
  const session = await getLecturerSession();
  const headers = { Authorization: `Bearer ${session?.token}` };
  const res = await fetch(`${API_BASE_URL}/materials/${materialId}/analytics`, { headers });
  if (!res.ok) return {};
  return res.json();
}

// Lecturer: Get list of students who viewed a material
// Returns: [{ studentId, name, admissionNumber, viewedAt, timeSpentSeconds }]
export async function getMaterialViewers(materialId) {
  const session = await getLecturerSession();
  const headers = { Authorization: `Bearer ${session?.token}` };
  const res = await fetch(`${API_BASE_URL}/materials/${materialId}/viewers`, { headers });
  if (!res.ok) return [];
  return res.json();
}

// Student: Record that the current student viewed a material
export async function recordMaterialView(materialId) {
  const session = await getStudentSession();
  if (!session?.token) return;
  const headers = { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' };
  // Fire-and-forget — don't block the UI on this
  fetch(`${API_BASE_URL}/materials/${materialId}/view`, { method: 'POST', headers }).catch(() => {});
}

export async function fetchMaterials(unitId) {
  const session = (await getLecturerSession()) || (await getStudentSession());
  const headers = { Authorization: `Bearer ${session?.token}` };
  const code = extractUnitCode(unitId);
  const res = await fetch(`${API_BASE_URL}/units/${encodeURIComponent(code)}/materials`, { headers });
  if (!res.ok) throw new Error('Failed to fetch materials');
  return res.json();
}

export async function fetchAssignments(unitId) {
  const session = await getStudentSession();
  const headers = { Authorization: `Bearer ${session?.token}` };
  const code = extractUnitCode(unitId);
  const res = await fetch(`${API_BASE_URL}/units/${encodeURIComponent(code)}/assignments`, { headers });
  if (!res.ok) throw new Error('Failed to fetch assignments');
  return res.json();
}

export async function submitAssignment(assignmentId, submission) {
  const session = await getStudentSession();
  const headers = { Authorization: `Bearer ${session?.token}`, 'Content-Type': 'application/json' };
  const res = await fetch(`${API_BASE_URL}/assignments/${assignmentId}/submit`, {
    method: 'POST',
    headers,
    body: JSON.stringify(submission),
  });
  if (!res.ok) throw new Error('Failed to submit assignment');
  return res.json();
}
