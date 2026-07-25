// src/utils/groupsApi.js
// API utility for group management (lecturer & student)
import { API_BASE_URL } from './constants';
import { getLecturerSession, getStudentSession } from './authSession';

const apiBaseUrl = API_BASE_URL;

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

async function lecturerHeaders() {
  const session = await getLecturerSession();
  return { Authorization: `Bearer ${session?.token}`, 'Content-Type': 'application/json' };
}

async function studentHeaders() {
  const session = await getStudentSession();
  return { Authorization: `Bearer ${session?.token}`, 'Content-Type': 'application/json' };
}

// Use lecturer session first, fall back to student
async function getAuthHeaders() {
  const session = (await getLecturerSession()) || (await getStudentSession());
  return { Authorization: `Bearer ${session?.token}`, 'Content-Type': 'application/json' };
}

export async function createGroups({ unitCode, groupSize, numGroups, autoAssignLeaders, allowSelfEnroll, maxGroupsPerStudent, description, tags }) {
  // Lecturer: create groups for a unit
  const code = extractUnitCode(unitCode);
  const res = await fetch(`${apiBaseUrl}/groups/create`, {
    method: 'POST',
    headers: await lecturerHeaders(),
    body: JSON.stringify({
      unitCode: code,
      groupSize,
      numGroups,
      autoAssignLeaders,
      allowSelfEnroll,
      maxGroupsPerStudent,
      description,
      tags,
    })
  });
  if (!res.ok) throw new Error(`Failed to create groups: ${res.status}`);
  return res.json();
}

export async function getGroups(unitCode) {
  // Get all groups for a unit
  const code = extractUnitCode(unitCode);
  const res = await fetch(`${apiBaseUrl}/groups?unitCode=${encodeURIComponent(code)}`, {
    headers: await getAuthHeaders()
  });
  if (res.status === 404) return [];   // endpoint not yet implemented
  if (!res.ok) throw new Error(`Failed to load groups: ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : (data?.groups ?? data?.data ?? []);
}

export async function updateGroup({ groupId, data }) {
  // Lecturer: update group (lock/unlock, assign leader, move students)
  const res = await fetch(`${apiBaseUrl}/groups/${groupId}`, {
    method: 'PATCH',
    headers: await lecturerHeaders(),
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error(`Failed to update group: ${res.status}`);
  return res.json();
}

export async function sendGroupNotification({ groupId, message }) {
  // Lecturer: send notification to group
  const res = await fetch(`${apiBaseUrl}/groups/${groupId}/notify`, {
    method: 'POST',
    headers: await lecturerHeaders(),
    body: JSON.stringify({ message })
  });
  if (!res.ok) throw new Error(`Failed to send notification: ${res.status}`);
  return res.json();
}

export async function getGroupHistory(groupId) {
  // Lecturer: audit group history
  const res = await fetch(`${apiBaseUrl}/groups/${groupId}/history`, {
    headers: await lecturerHeaders()
  });
  if (!res.ok) throw new Error(`Failed to fetch group history: ${res.status}`);
  return res.json();
}

export async function joinGroup({ groupId }) {
  // Student: join a group
  const res = await fetch(`${apiBaseUrl}/groups/${groupId}/join`, {
    method: 'POST',
    headers: await studentHeaders()
  });
  if (!res.ok) throw new Error(`Failed to join group: ${res.status}`);
  return res.json();
}

export async function leaveGroup({ groupId }) {
  // Student: leave a group
  const res = await fetch(`${apiBaseUrl}/groups/${groupId}/leave`, {
    method: 'POST',
    headers: await studentHeaders()
  });
  if (!res.ok) throw new Error(`Failed to leave group: ${res.status}`);
  return res.json();
}

export async function getMyGroup(unitCode) {
  // Student: get my group for a unit
  const code = extractUnitCode(unitCode);
  const res = await fetch(`${apiBaseUrl}/groups/my?unitCode=${encodeURIComponent(code)}`, {
    headers: await studentHeaders()
  });
  if (!res.ok) throw new Error(`Failed to fetch my group: ${res.status}`);
  return res.json();
}

export async function deleteGroup(groupId) {
  const res = await fetch(`${apiBaseUrl}/groups/${groupId}`, {
    method: 'DELETE',
    headers: await lecturerHeaders()
  });
  if (!res.ok) throw new Error('Failed to delete group');
  return res.json();
}

export async function bulkCreateGroups(unitCode, groups) {
  const res = await fetch(`${apiBaseUrl}/groups/bulk`, {
    method: 'POST',
    headers: await lecturerHeaders(),
    body: JSON.stringify({ unitCode, groups })
  });
  if (!res.ok) throw new Error('Failed to bulk create groups');
  return res.json();
}

export async function getGroupAnalytics(groupId) {
  const res = await fetch(`${apiBaseUrl}/groups/${groupId}/analytics`, {
    headers: await lecturerHeaders()
  });
  if (!res.ok) return {};
  return res.json();
}

// Returns the number of students currently enrolled in a unit (lecturer only).
// Falls back to 0 on any error so callers can still render the form.
export async function getUnitEnrollmentCount(unitCode) {
  const code = extractUnitCode(unitCode);
  try {
    const res = await fetch(
      `${apiBaseUrl}/lecturer/units/${encodeURIComponent(code)}/students`,
      { headers: await lecturerHeaders() }
    );
    if (!res.ok) return 0;
    const data = await res.json();
    const arr = Array.isArray(data) ? data : (data?.students ?? data?.data ?? []);
    return arr.length;
  } catch {
    return 0;
  }
}

// Lecturer: auto-assign students not yet in any group into available groups.
export async function distributeRemainingStudents(unitCode) {
  const code = extractUnitCode(unitCode);
  const res = await fetch(
    `${apiBaseUrl}/groups/${encodeURIComponent(code)}/distribute-remaining`,
    { method: 'POST', headers: await lecturerHeaders() }
  );
  if (!res.ok) throw new Error(`Failed to distribute students: ${res.status}`);
  return res.json();
}

/**
 * Fetch the member list for a specific group.
 * Used by the group leader in LeadSessionScreen to show who can be proxy-marked.
 * Returns an array of: { studentId, admissionNumber, name, isLeader }
 * Returns [] on any error so the caller degrades gracefully.
 */
export async function getGroupMembers(groupId) {
  if (!groupId) return [];
  try {
    const res = await fetch(`${apiBaseUrl}/groups/${encodeURIComponent(String(groupId))}/members`, {
      headers: await studentHeaders(),
    });
    if (!res.ok) return [];
    const data = await res.json().catch(() => null);
    return Array.isArray(data) ? data : (data?.members ?? data?.students ?? data?.data ?? []);
  } catch {
    return [];
  }
}
