// src/utils/delegationApi.js
// API utilities for the GD session delegation system.
//
// Flow:
//   Lecturer  → createDelegation()        POST /api/attendance/delegations
//   Leader    → fetchMyDelegations()       GET  /api/student/delegations/me
//   Leader    → startDelegatedSession()    POST /api/attendance/delegations/:id/start
//   Leader    → endDelegatedSession()      POST /api/attendance/delegations/:id/end

import { API_BASE_URL } from './constants';
import { getLecturerSession, getStudentSession } from './authSession';
import { hasInternetConnection } from './connectivity';
import sqliteStorage from '../storage/sqliteStorage';

// ─── Lecturer side ────────────────────────────────────────────────────────────

/**
 * Lecturer creates one delegation per group.
 *
 * @param {object} params
 * @param {string} params.timetableEntryId  - The timetable entry being delegated
 * @param {string} params.unitCode
 * @param {string} params.unitId            - Numeric BLE unit id
 * @param {string} params.roomCode
 * @param {string} params.roomId            - Numeric BLE room id
 * @param {Array}  params.groups            - [{ groupId, groupNumber, groupName, leaderStudentId }]
 * @param {number} params.validFrom         - Unix ms timestamp
 * @param {number} params.validUntil        - Unix ms timestamp
 */
export const createDelegation = async ({
  timetableEntryId,
  unitCode,
  unitId,
  roomCode,
  roomId,
  groups,
  validFrom,
  validUntil,
}) => {
  const session = await getLecturerSession();
  if (!session?.token) throw new Error('No lecturer session found.');

  const res = await fetch(`${API_BASE_URL}/api/attendance/delegations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      timetableEntryId,
      unitCode,
      unitId,
      roomCode,
      roomId,
      groups,
      validFrom,
      validUntil,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `Failed to create delegation (${res.status})`);
  return data;
};

// ─── Student / Leader side ────────────────────────────────────────────────────

/**
 * Fetch all active delegations assigned to the signed-in student.
 * Returns an array of delegation objects:
 * [{
 *   id, unitCode, unitId, roomCode, roomId,
 *   groupId, groupNumber, groupName,
 *   validFrom, validUntil, used,
 *   timetableEntryId
 * }]
 */
export const fetchMyDelegations = async () => {
  const session = await getStudentSession();
  if (!session?.token) {
    console.warn('[delegationApi] fetchMyDelegations: no student session token');
    return [];
  }

  try {
    const res = await fetch(`${API_BASE_URL}/api/student/delegations/me`, {
      headers: { Authorization: `Bearer ${session.token}` },
    });
    if (!res.ok) {
      console.warn(`[delegationApi] fetchMyDelegations failed: HTTP ${res.status}`);
      return [];
    }
    const data = await res.json().catch(() => null);
    const arr = Array.isArray(data) ? data : (data?.delegations ?? data?.data ?? []);
    return arr;
  } catch (err) {
    console.warn('[delegationApi] fetchMyDelegations network error:', err?.message);
    return [];
  }
};

/**
 * Leader starts a delegated session.
 * OFFLINE: generates a local session token so broadcasting (BLE/QR) can start
 * immediately even without internet. A "pending_start" flag is stored in SQLite.
 * The real backend start is attempted; if offline the local token is used and
 * will be reconciled when session end syncs (backend accepts offline-started tokens).
 *
 * @param {string} delegationId
 * @returns {{ sessionToken: string, startedAt: string, offline?: true }}
 */
export const startDelegatedSession = async (delegationId) => {
  const session = await getStudentSession();
  if (!session?.token) throw new Error('No student session found.');

  const online = await hasInternetConnection().catch(() => false);

  if (online) {
    try {
      const res = await fetch(`${API_BASE_URL}/api/attendance/delegations/${encodeURIComponent(delegationId)}/start`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) return data;
      // Fall through to offline path if backend rejects (e.g. already started)
      console.warn('[delegationApi] startDelegatedSession backend error, using offline token:', data?.message);
    } catch (e) {
      console.warn('[delegationApi] startDelegatedSession network error, using offline token:', e?.message);
    }
  }

  // Offline path: derive a deterministic local token from delegationId + studentId.
  // Format: LOCAL-<delegationId>-<studentId> so the backend can identify it as offline-started.
  const studentId = session.studentId ?? session.id ?? 'unknown';
  const localToken = `LOCAL-${delegationId}-${studentId}`;
  return { sessionToken: localToken, startedAt: new Date().toISOString(), offline: true };
};

/**
 * Leader ends a delegated session.
 * OFFLINE: queues the end record in SQLite (pending_session_ends) and resolves
 * immediately so the UI can move to 'done'. Synced via syncPendingAttendance.
 *
 * @param {string} delegationId
 * @param {object} params
 * @param {string} params.sessionToken
 * @param {string} params.unitCode
 * @param {string} params.roomCode
 * @param {number} params.sessionStart
 * @param {number} params.sessionEnd
 */
export const endDelegatedSession = async (delegationId, {
  sessionToken, unitCode, roomCode, sessionStart, sessionEnd,
}) => {
  const session = await getStudentSession();
  if (!session?.token) throw new Error('No student session found.');

  // Always queue locally first — guarantees the end is not lost if the network call fails.
  await sqliteStorage.addPendingSessionEnd({ delegationId, sessionToken, unitCode, roomCode, sessionStart, sessionEnd }).catch(() => {});

  const online = await hasInternetConnection().catch(() => false);
  if (!online) {
    return { queued: true };
  }

  try {
    const res = await fetch(`${API_BASE_URL}/api/attendance/delegations/${encodeURIComponent(delegationId)}/end`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionToken, unitCode, roomCode, sessionStart, sessionEnd }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.message || `Failed to end session (${res.status})`);
    // Mark the queued record as synced since we just succeeded online.
    const pending = await sqliteStorage.getUnsyncedSessionEnds();
    const match = pending.find((r) => r.delegation_id === String(delegationId));
    if (match) await sqliteStorage.markSessionEndSynced(match.id).catch(() => {});
    return data;
  } catch (err) {
    // Already queued above — UI can proceed, sync will retry.
    console.warn('[delegationApi] endDelegatedSession online call failed, will retry on next sync:', err?.message);
    return { queued: true };
  }
};

/**
 * Fetch all GD attendance records the backend has stored for this student.
 * Covers both the leader's own record and group members marked by the leader.
 * Used to back-fill SQLite on app focus / timetable sync.
 *
 * Expected response: array of
 *   { delegationId, unitCode, roomCode, sessionStart, scannedAt }
 */
export const fetchMyGDAttendance = async () => {
  const session = await getStudentSession();
  if (!session?.token) return [];
  try {
    const res = await fetch(`${API_BASE_URL}/api/student/delegations/my-attendance`, {
      headers: { Authorization: `Bearer ${session.token}` },
    });
    if (!res.ok) return [];
    const data = await res.json().catch(() => null);
    return Array.isArray(data) ? data : (data?.records ?? data?.attendance ?? []);
  } catch {
    return [];
  }
};

/**
 * Group leader marks a physically-present-but-phoneless group member as attended.
 * The backend validates:
 *   - JWT belongs to the delegation's designated leader
 *   - sessionToken is valid and the session is still within its time window
 *   - targetStudentId belongs to the leader's group
 *
 * Returns { duplicate: true } on 409 (already marked).
 *
 * @param {string} delegationId
 * @param {object} params
 * @param {string} params.sessionToken          - Active session token from startDelegatedSession
 * @param {string|number} params.targetStudentId      - Student to be marked present
 * @param {string} params.targetAdmissionNumber - Their admission number (for audit log / dedup)
 * @param {number} params.markedAt              - Unix ms timestamp of the mark
 */
export const submitLeaderProxyMark = async (delegationId, {
  sessionToken,
  targetStudentId,
  targetAdmissionNumber,
  markedAt,
}) => {
  const session = await getStudentSession();
  if (!session?.token) throw new Error('No student session found.');

  const res = await fetch(
    `${API_BASE_URL}/api/attendance/delegations/${encodeURIComponent(delegationId)}/proxy-mark`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sessionToken, targetStudentId, targetAdmissionNumber, markedAt }),
    },
  );

  if (res.status === 409) return { duplicate: true };
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `Failed to mark attendance (${res.status})`);
  return data;
};
