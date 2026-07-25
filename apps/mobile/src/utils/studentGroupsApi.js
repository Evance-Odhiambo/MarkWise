import { API_BASE_URL } from './constants';
import { getStudentSession } from './authSession';

// Extract just the unit code from any format:
//   "SCH2170"                     -> "SCH2170"
//   "ORGANICCHEMISTRY(SCH2170)"   -> "SCH2170"
//   "Organic Chemistry (SCH2170)" -> "SCH2170"
function extractUnitCode(raw) {
  const s = String(raw || '').trim();
  const match = s.match(/\(([^)]+)\)/);
  if (match) return match[1].replace(/\s+/g, '').toUpperCase();
  return s.replace(/\s+/g, '').toUpperCase();
}

export async function fetchStudentGroups() {
  const session = await getStudentSession();
  const headers = { Authorization: `Bearer ${session?.token}` };
  const res = await fetch(`${API_BASE_URL}/student/study-groups`, { headers });
  if (!res.ok) throw new Error('Failed to fetch study groups');
  return res.json();
}

export async function getStudentGroupsByUnit(unitCode) {
  const session = await getStudentSession();
  const headers = { Authorization: `Bearer ${session?.token}` };
  const code = extractUnitCode(unitCode);
  const res = await fetch(`${API_BASE_URL}/groups?unitCode=${encodeURIComponent(code)}`, { headers });
  if (res.status === 404) return [];   // no groups yet — not an error
  if (!res.ok) throw new Error('Failed to fetch groups');
  const data = await res.json().catch(() => null);
  return Array.isArray(data) ? data : (data?.groups ?? data?.data ?? []);
}

export async function getMyGroupForUnit(unitCode) {
  const session = await getStudentSession();
  const headers = { Authorization: `Bearer ${session?.token}` };
  const code = extractUnitCode(unitCode);
  const res = await fetch(`${API_BASE_URL}/groups/my?unitCode=${encodeURIComponent(code)}`, { headers });
  if (!res.ok) return null;
  return res.json();
}

export async function joinStudyGroup(groupId) {
  const session = await getStudentSession();
  const headers = { Authorization: `Bearer ${session?.token}`, 'Content-Type': 'application/json' };
  const res = await fetch(`${API_BASE_URL}/groups/${groupId}/join`, {
    method: 'POST',
    headers,
  });
  if (!res.ok) throw new Error('Failed to join group');
  return res.json();
}

export async function leaveStudyGroup(groupId) {
  const session = await getStudentSession();
  const headers = { Authorization: `Bearer ${session?.token}` };
  const res = await fetch(`${API_BASE_URL}/groups/${groupId}/leave`, {
    method: 'POST',
    headers,
  });
  if (!res.ok) throw new Error('Failed to leave group');
  return res.json();
}

