// assignmentsApiV2.js
import ReactNativeBlobUtil from 'react-native-blob-util';
import { API_BASE_URL } from './constants';
import { getLecturerSession, getStudentSession } from './authSession';

function extractUnitCode(raw) {
  const s = String(raw || '').trim();
  const match = s.match(/\(([^)]+)\)/);
  if (match) return match[1].replace(/\s+/g, '').toUpperCase();
  return s.replace(/\s+/g, '').toUpperCase();
}

async function getSession() {
  return (await getLecturerSession()) || (await getStudentSession());
}

/** Normalize a form payload before sending to the API.
 * - Converts the `points` form field to `maxScore` (number) that the backend expects.
 * - Sends both `isGroup` (camelCase, JS convention) and `is_group` (snake_case, DB
 *   convention) so either backend style is satisfied.
 * - Removes UI-only fields that the API doesn't store.
 */
function normalizeAssignmentPayload(data) {
  const { points, isGroup, ...rest } = data;
  return {
    ...rest,
    maxScore: parseInt(points ?? data.maxScore ?? 100, 10) || 100,
    isGroup: Boolean(isGroup),
    is_group: Boolean(isGroup),
  };
}

// ─── helpers for multipart attachment upload ────────────────────────────────

function isLocalUri(uri) {
  return typeof uri === 'string' && (uri.startsWith('file://') || uri.startsWith('content://'));
}

/**
 * Sends `body` as JSON when there are no local file attachments; falls back to
 * a multipart/form-data request (BlobUtil) when local URIs are present so the
 * file bytes actually reach the server.
 */
async function requestWithAttachments(method, url, token, body) {
  const attachments = (body.attachments || []).filter(a => isLocalUri(a?.uri));

  if (attachments.length === 0) {
    // Plain JSON — existing behaviour, no changes.
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      let msg = `Request failed (${res.status})`;
      try { msg = JSON.parse(errText)?.error || JSON.parse(errText)?.message || msg; } catch (_) {}
      throw new Error(msg);
    }
    return res.json();
  }

  // Multipart — send JSON fields as `payload` + each file as `attachment`.
  const parts = [
    {
      name: 'payload',
      data: JSON.stringify(body),
      type: 'application/json',
    },
    ...attachments.map(a => ({
      name: 'attachment',
      filename: a.name || 'file',
      type: a.type || 'application/octet-stream',
      // BlobUtil.wrap(): strip file:// prefix; content:// passed as-is.
      data: ReactNativeBlobUtil.wrap(
        a.uri.startsWith('file://') ? a.uri.replace('file://', '') : a.uri,
      ),
    })),
  ];

  const res = await ReactNativeBlobUtil.fetch(
    method,
    url,
    { Authorization: `Bearer ${token}` },
    parts,
  );

  const status = res.respInfo.status;
  if (status < 200 || status >= 300) {
    let msg = `Request failed (${status})`;
    try { const j = JSON.parse(res.data); msg = j?.error || j?.message || msg; } catch (_) {}
    throw new Error(msg);
  }
  return JSON.parse(res.data);
}

// ─────────────────────────────────────────────────────────────────────────────

export async function createAssignment(unitId, data) {
  const session = await getLecturerSession();
  return requestWithAttachments(
    'POST',
    `${API_BASE_URL}/api/assignments`,
    session?.token,
    normalizeAssignmentPayload({ ...data, unitId }),
  );
}

export async function fetchAssignments(unitId) {
  const session = await getSession();
  const headers = { Authorization: `Bearer ${session?.token}` };
  const code = extractUnitCode(unitId);
  const res = await fetch(`${API_BASE_URL}/api/assignments?unitId=${encodeURIComponent(code)}`, { headers });
  if (!res.ok) throw new Error('Failed to fetch assignments');
  return res.json();
}

export async function getAssignmentDetails(assignmentId) {
  const session = await getLecturerSession();
  const headers = { Authorization: `Bearer ${session?.token}` };
  const res = await fetch(`${API_BASE_URL}/api/assignments/${assignmentId}`, { headers });
  if (!res.ok) throw new Error('Failed to fetch assignment details');
  return res.json();
}

export async function submitAssignment(assignmentId, submission) {
  const session = await getStudentSession();
  const headers = { Authorization: `Bearer ${session?.token}`, 'Content-Type': 'application/json' };
  const res = await fetch(`${API_BASE_URL}/api/assignments/${assignmentId}/submit`, {
    method: 'POST',
    headers,
    body: JSON.stringify(submission),
  });
  if (!res.ok) throw new Error('Failed to submit assignment');
  return res.json();
}

export async function fetchSubmissions(assignmentId) {
  const session = await getLecturerSession();
  const headers = { Authorization: `Bearer ${session?.token}` };
  const res = await fetch(`${API_BASE_URL}/api/assignments/${assignmentId}/submissions`, { headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to fetch submissions (${res.status}): ${text}`);
  }
  const json = await res.json();
  // Unwrap all common Express / node-postgres response shapes
  if (Array.isArray(json))               return json;               // plain array
  if (Array.isArray(json?.submissions))  return json.submissions;   // { submissions: [] }
  if (Array.isArray(json?.data))         return json.data;          // { data: [] }
  if (Array.isArray(json?.rows))         return json.rows;          // raw pg query result
  if (Array.isArray(json?.result))       return json.result;        // { result: [] }
  if (Array.isArray(json?.results))      return json.results;       // { results: [] }
  if (Array.isArray(json?.items))        return json.items;         // { items: [] }
  // Completely unknown shape — surface it so we can diagnose
  throw new Error(`Unexpected response shape from submissions endpoint: ${JSON.stringify(json).slice(0, 300)}`);
}

export async function updateAssignment(assignmentId, data) {
  const session = await getLecturerSession();
  return requestWithAttachments(
    'PUT',
    `${API_BASE_URL}/api/assignments/${assignmentId}`,
    session?.token,
    normalizeAssignmentPayload(data),
  );
}

export async function deleteAssignment(assignmentId) {
  const session = await getLecturerSession();
  const headers = { Authorization: `Bearer ${session?.token}` };
  const res = await fetch(`${API_BASE_URL}/api/assignments/${assignmentId}`, {
    method: 'DELETE',
    headers,
  });
  if (!res.ok) throw new Error('Failed to delete assignment');
  return res.json();
}

export async function cloneAssignment(assignmentId) {
  const session = await getLecturerSession();
  const headers = { Authorization: `Bearer ${session?.token}` };
  const res = await fetch(`${API_BASE_URL}/api/assignments/${assignmentId}/clone`, {
    method: 'POST',
    headers,
  });
  if (!res.ok) throw new Error('Failed to clone assignment');
  return res.json();
}

export async function getAssignmentAnalytics(assignmentId) {
  const session = await getLecturerSession();
  const headers = { Authorization: `Bearer ${session?.token}` };
  const res = await fetch(`${API_BASE_URL}/api/assignments/${assignmentId}/analytics`, { headers });
  if (!res.ok) return {};
  return res.json();
}

// Grade a submission (lecturer). Grade propagates to all group members when groupId is present.
export async function gradeSubmission(assignmentId, submissionId, { grade, feedback }) {
  const session = await getLecturerSession();
  const headers = { Authorization: `Bearer ${session?.token}`, 'Content-Type': 'application/json' };
  const numericGrade = Number(grade);
  if (isNaN(numericGrade)) throw new Error('Grade must be a valid number');
  const body = JSON.stringify({ grade: numericGrade, feedback });
  const res = await fetch(`${API_BASE_URL}/api/assignments/${assignmentId}/submissions/${submissionId}/grade`, {
    method: 'POST',
    headers,
    body,
  });
  if (!res.ok) {
    let msg = 'Failed to save grade';
    try {
      const errBody = await res.json();
      msg = errBody?.error ?? errBody?.message ?? msg;
    } catch (_) {}
    throw new Error(msg);
  }
  return res.json();
}

// Fetch the shared group submission for a group assignment.
// Returns null (not an error) when the group hasn't submitted yet.
export async function fetchGroupSubmission(assignmentId, groupId) {
  const session = await getStudentSession();
  const headers = { Authorization: `Bearer ${session?.token}` };
  const res = await fetch(
    `${API_BASE_URL}/api/assignments/${assignmentId}/group-submission?groupId=${encodeURIComponent(groupId)}`,
    { headers }
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('Failed to fetch group submission');
  return res.json();
}

// Upload a file as a submission (multipart/form-data).
// groupId is included when this is a group assignment.
export async function uploadAssignmentFile(assignmentId, fileUri, fileName, mimeType, groupId) {
  const session = await getStudentSession();
  // Use ReactNativeBlobUtil so content:// URIs from the SAF document picker are
  // streamed correctly on Android 10+ scoped storage. FormData + fetch cannot read
  // content:// URIs because the React Native networking layer lacks SAF support.
  const resolvedUri = fileUri.startsWith('file://')
    ? fileUri.replace('file://', '')
    : fileUri; // content:// passed as-is to wrap()
  const parts = [
    {
      name: 'file',
      filename: fileName || 'file',
      type: mimeType || 'application/octet-stream',
      data: ReactNativeBlobUtil.wrap(resolvedUri),
    },
    { name: 'type', data: 'file' },
    ...(groupId ? [{ name: 'groupId', data: String(groupId) }] : []),
  ];
  const res = await ReactNativeBlobUtil.fetch(
    'POST',
    `${API_BASE_URL}/api/assignments/${assignmentId}/submit`,
    { Authorization: `Bearer ${session?.token}` },
    parts,
  );
  const status = res.respInfo.status;
  if (status < 200 || status >= 300) throw new Error('Failed to upload file submission');
  return JSON.parse(res.data);
}
