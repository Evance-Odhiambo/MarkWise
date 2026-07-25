// src/utils/extraSessionsApi.js
// API functions for one-off make-up / extra sessions created by lecturers.
// Endpoint: POST /api/timetable/extra-sessions
import { API_BASE_URL } from './constants';
import { getLecturerSession } from './authSession';

const API_PREFIX = `${API_BASE_URL}/api`;

/**
 * Create a one-off make-up session for a unit.
 * The backend stores the record and fans it out to enrolled students so it
 * appears on their timetable with an isExtraSession flag.
 *
 * @param {{ unitCode, date, startTime, endTime, roomCode, roomId, lessonType, lecturerId, token }}
 * @returns {Promise<{ id, sessionId, unitCode, date, ... }>}
 */
export async function createExtraSession({ unitCode, date, startTime, endTime, roomCode, roomId, lessonType, lecturerId, token }) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
  const res = await fetch(`${API_PREFIX}/timetable/extra-sessions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ unitCode, date, startTime, endTime, roomCode, roomId, lessonType, lecturerId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || data.error || `Failed to create make-up session (${res.status})`);
  }
  return data?.data ?? data;
}

/**
 * Fetch all extra sessions created by the logged-in lecturer.
 *
 * @param {string} token - Lecturer JWT
 * @returns {Promise<Array>}
 */
export async function fetchMyExtraSessions(token) {
  const headers = { Authorization: `Bearer ${token}` };
  const res = await fetch(`${API_PREFIX}/timetable/extra-sessions/mine`, { headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || data.error || `Failed to fetch make-up sessions (${res.status})`);
  }
  return Array.isArray(data) ? data : (data?.data ?? data?.sessions ?? []);
}

/**
 * Delete a make-up session. Only the lecturer who created it may delete it.
 *
 * @param {string} sessionId - The extra-session record ID
 * @param {string} token - Lecturer JWT
 */
export async function deleteExtraSession(sessionId, token) {
  const headers = { Authorization: `Bearer ${token}` };
  const res = await fetch(`${API_PREFIX}/timetable/extra-sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
    headers,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || data.error || `Failed to remove make-up session (${res.status})`);
  }
}
