// fileUploadApi.js
import { API_BASE_URL } from './constants';
import { getStudentSession } from './authSession';

export async function uploadAssignmentFile(assignmentId, fileObj) {
  const session = await getStudentSession();
  const formData = new FormData();
  formData.append('file', {
    uri: fileObj.uri,
    name: fileObj.name,
    type: fileObj.type,
  });
  formData.append('studentId', session?.studentId);

  const headers = {
    Authorization: `Bearer ${session?.token}`,
    'Content-Type': 'multipart/form-data',
  };

  const res = await fetch(`${API_BASE_URL}/assignments/${assignmentId}/submit`, {
    method: 'POST',
    headers,
    body: formData,
  });
  if (!res.ok) throw new Error('Failed to upload file');
  return res.json();
}
