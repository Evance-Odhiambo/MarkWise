// assignmentsApi.js
import { API_BASE_URL } from './constants';
import { getLecturerSession } from './authSession';

export async function fetchAssignments(unitId) {
  const session = await getLecturerSession();
  const headers = { Authorization: `Bearer ${session?.token}` };
  const res = await fetch(`${API_BASE_URL}/units/${unitId}/assignments`, { headers });
  if (!res.ok) throw new Error('Failed to fetch assignments');
  return res.json();
}

export async function createAssignment(unitId, assignment) {
  const session = await getLecturerSession();
  const headers = { Authorization: `Bearer ${session?.token}`, 'Content-Type': 'application/json' };
  const res = await fetch(`${API_BASE_URL}/units/${unitId}/assignments`, {
    method: 'POST',
    headers,
    body: JSON.stringify(assignment),
  });
  if (!res.ok) throw new Error('Failed to create assignment');
  return res.json();
}

export async function fetchSubmissions(assignmentId) {
  const session = await getLecturerSession();
  const headers = { Authorization: `Bearer ${session?.token}` };
  const res = await fetch(`${API_BASE_URL}/assignments/${assignmentId}/submissions`, { headers });
  if (!res.ok) throw new Error('Failed to fetch submissions');
  return res.json();
}
