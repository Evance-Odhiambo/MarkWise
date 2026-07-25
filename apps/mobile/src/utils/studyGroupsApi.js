// studyGroupsApi.js
import { API_BASE_URL } from './constants';
import { getLecturerSession } from './authSession';

export async function fetchStudyGroups() {
  const session = await getLecturerSession();
  const headers = { Authorization: `Bearer ${session?.token}` };
  const res = await fetch(`${API_BASE_URL}/lecturer/study-groups`, { headers });
  if (!res.ok) throw new Error('Failed to fetch study groups');
  return res.json();
}

export async function createStudyGroup(group) {
  const session = await getLecturerSession();
  const headers = { Authorization: `Bearer ${session?.token}`, 'Content-Type': 'application/json' };
  const res = await fetch(`${API_BASE_URL}/lecturer/study-groups`, {
    method: 'POST',
    headers,
    body: JSON.stringify(group),
  });
  if (!res.ok) throw new Error('Failed to create study group');
  return res.json();
}
