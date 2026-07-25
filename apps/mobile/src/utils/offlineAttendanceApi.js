// src/utils/offlineAttendanceApi.js
// Submits locally-saved offline attendance records to the backend.
// Called fire-and-forget from OfflineMarker after each successful local save.

import { getStudentSession } from './authSession';
import { API_BASE_URL, normalizeUnitCode } from './constants';
import sqliteStorage from '../storage/sqliteStorage';

let _isSyncing = false;
let _syncQueued = false; // ensures a concurrent caller is not silently dropped
// Per-session-key map: key → Promise. Concurrent callers await the same in-flight
// request rather than skipping it (a plain Set would cause early returns).
const _sessionSyncPromises = new Map();

const FETCH_TIMEOUT_MS = 15_000;

const fetchWithTimeout = (url, options) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
};

// Canonical unit code normalizer — imported from constants.js
const normalizeCode = normalizeUnitCode;

/**
 * Register a single conducted session on the backend so students can submit against it.
 * Fire-and-forget — called from OfflineTaker after local SQLite save.
 */
export const syncConductedSession = async ({ unitCode, lectureRoom, sessionStart, createdAt, sessionKey, sessionNonce }) => {
  // Normalize codes so the backend stores them in the same format students submit.
  const normUnitCode = normalizeCode(unitCode);
  const normLectureRoom = normalizeCode(lectureRoom);
  const _sessionKey = `${normUnitCode}|${normLectureRoom}|${sessionStart}`;

  // If a request for this session is already in flight, wait for it rather than
  // skipping — this ensures handleManualMark's explicit await actually blocks
  // until the backend has registered the session.
  if (_sessionSyncPromises.has(_sessionKey)) {
    return _sessionSyncPromises.get(_sessionKey);
  }

  const promise = (async () => {
    try {
      const session = await getStudentSession();
      // Lecturer uses a different session key — fall back gracefully
      const { getLecturerSession } = require('./authSession');
      const lecturerSession = await getLecturerSession().catch(() => null);
      const token = lecturerSession?.token ?? session?.token;
      if (!token) return;

      await fetch(`${API_BASE_URL}/api/attendance/conducted-sessions/sync`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessions: [{ unitCode: normUnitCode, lectureRoom: normLectureRoom, sessionStart, createdAt, sessionKey, sessionNonce }] }),
      });
    } catch (_) {
      // Non-critical — students cannot submit until this goes through, but it will
      // be retried next time the lecturer opens OfflineTaker with internet.
    } finally {
      _sessionSyncPromises.delete(_sessionKey);
    }
  })();

  _sessionSyncPromises.set(_sessionKey, promise);
  return promise;
};

/**
 * POST a single offline attendance record to the backend.
 * Returns normally on 409 (duplicate) so the local record is still marked synced.
 */
export const submitOfflineAttendance = async ({
  unitCode,
  lectureRoom,
  sessionStart,
  scannedAt,
  deviceId,
  rawPayload,
}) => {
  // Guard: reject records with missing required fields before hitting the network.
  // This catches memory-fallback records whose field names were read with the wrong
  // casing (snake_case vs camelCase) and arrived here as undefined/empty/0.
  if (!unitCode || !lectureRoom || !sessionStart) {
    console.warn('[offlineAttendanceApi] submitOfflineAttendance: skipping invalid record',
      { unitCode, lectureRoom, sessionStart });
    throw new Error('INVALID_RECORD: missing unitCode, lectureRoom, or sessionStart');
  }

  const session = await getStudentSession();
  if (!session?.token) throw new Error('Not signed in');

  // Normalize codes to match what syncConductedSession stores on the backend.
  // Prevents mismatches from unit codes with spaces (e.g. "SCH 2170" vs "SCH2170").
  const normUnitCode = normalizeCode(unitCode);
  const normLectureRoom = normalizeCode(lectureRoom);

  const body = { unitCode: normUnitCode, lectureRoom: normLectureRoom, sessionStart, scannedAt, deviceId, rawPayload };

  const res = await fetchWithTimeout(`${API_BASE_URL}/api/attendance/offline/submit`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  // 409 Conflict = already recorded on server — treat as success
  if (res.status === 409) return { duplicate: true };

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.warn('[offlineAttendanceApi] submit failed', res.status, JSON.stringify(data));
    throw new Error(data.message || `Failed (${res.status})`);
  }
  return data;
};

/**
 * Fetch attendance summary for the logged-in student from the backend.
 * Returns per-unit attended/conducted counts for ALL units the backend has data for.
 * Response shape: { units: [{ unitCode, unitName, attended, conducted }], totalAttended, totalConducted }
 * Returns null on network failure so callers can fall back to local data.
 */
export const fetchStudentAttendanceSummary = async () => {
  const session = await getStudentSession();
  if (!session?.token) return null;

  try {
    const res = await fetch(`${API_BASE_URL}/api/student/attendance/summary`, {
      headers: { Authorization: `Bearer ${session.token}` },
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    if (data) sqliteStorage.saveAttendanceSummaryCache(data).catch(() => {});
    return data ?? null;
  } catch (_) {
    return null;
  }
};

/**
 * Read the most recently cached attendance summary from SQLite.
 * Returns null if no cache exists yet.
 */
export const getCachedAttendanceSummary = () => sqliteStorage.getAttendanceSummaryCache();

/**
 * Fetch the total number of conducted sessions per unit from the backend,
 * independently of the student's own attendance records.
 * Returns a map: { <normalisedUnitCode>: number }
 * Falls back to an empty object on network failure.
 */
export const fetchConductedSessionCounts = async (unitCodes = []) => {
  if (!unitCodes.length) return {};
  const session = await getStudentSession();
  if (!session?.token) return {};

  try {
    const params = new URLSearchParams({ unitCodes: unitCodes.join(',') });
    const res = await fetch(
      `${API_BASE_URL}/api/attendance/conducted-sessions/counts?${params}`,
      { headers: { Authorization: `Bearer ${session.token}` } },
    );
    if (!res.ok) return {};

    const data = await res.json().catch(() => null);
    if (!data) return {};

    // Accept either:
    //   { CS301: 5, CS302: 3 }
    //   [ { unitCode: 'CS301', count: 5 }, … ]
    //   { units: [ { unitCode, count|conducted } ] }
    const result = {};
    if (Array.isArray(data)) {
      for (const item of data) {
        const code = String(item?.unitCode || item?.unit_code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        const count = Number(item?.count ?? item?.conducted ?? 0);
        if (code && count >= 0) result[code] = count;
      }
    } else if (data.units && Array.isArray(data.units)) {
      for (const item of data.units) {
        const code = String(item?.unitCode || item?.unit_code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        const count = Number(item?.count ?? item?.conducted ?? 0);
        if (code && count >= 0) result[code] = count;
      }
    } else {
      for (const [k, v] of Object.entries(data)) {
        const code = String(k || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        const count = Number(v);
        if (code && Number.isFinite(count) && count >= 0) result[code] = count;
      }
    }

    // Cache into local SQLite so the counts survive offline
    if (Object.keys(result).length > 0) {
      cacheConductedCountsLocally(result).catch(() => {});
    }

    return result;
  } catch (_) {
    return {};
  }
};

/**
 * Cache remote conducted-session counts as a plain JSON blob in app_settings.
 * This replaces the old synthetic-row approach which caused double-counting
 * when a student subsequently marked a real session.
 */
const cacheConductedCountsLocally = (remoteCountsByCode) => {
  sqliteStorage.saveConductedCountsCache(remoteCountsByCode).catch(() => {});
};

/**
 * Read the most recently cached conducted-session counts from SQLite.
 * Returns {} if no cache exists yet.
 */
export const getCachedConductedCounts = () => sqliteStorage.getConductedCountsCache();

/**
 * Flush all unsynced local attendance records to the backend.
 * Also drains the pending_manual_marks queue (lecturer offline marks).
 * A module-level mutex prevents concurrent runs.
 * Returns { synced, failed } counts.
 */
export const syncPendingAttendance = async () => {
  if (_isSyncing) {
    _syncQueued = true; // re-run once the current sync finishes
    return { synced: 0, failed: 0 };
  }
  _isSyncing = true;
  _syncQueued = false;

  try {
    // Resolve session once and reuse — avoids redundant AsyncStorage reads.
    const session = await getStudentSession();
    if (!session?.token) return { synced: 0, failed: 0 };
    const studentToken = session.token;

    // Fetch all queued data in parallel upfront.
    const [records, proxyMarks, sessionEnds] = await Promise.all([
      sqliteStorage.getUnsyncedAttendanceRecords(),
      sqliteStorage.getUnsyncedProxyMarks().catch(() => []),
      sqliteStorage.getUnsyncedSessionEnds().catch(() => []),
    ]);

    let synced = 0;
    let failed = 0;

    // ── Attendance records (parallel) ────────────────────────────────────
    // Support both snake_case (real SQLite rows) and camelCase (memory-fallback
    // objects). When SQLite is unavailable, getUnsyncedAttendanceRecords() returns
    // the in-memory store which was saved with camelCase keys.
    const recordResults = await Promise.allSettled(records.map(async (record) => {
      const unitCode     = record.unit_code     ?? record.unitCode     ?? '';
      const lectureRoom  = record.lecture_room  ?? record.lectureRoom  ?? '';
      const sessionStart = record.session_start ?? record.sessionStart ?? 0;
      const scannedAt    = record.scanned_at    ?? record.scannedAt    ?? 0;
      const deviceId     = record.device_id     ?? record.deviceId     ?? null;
      const rawPayload   = record.raw_payload    ?? record.rawPayload   ?? null;

      // Skip permanently-broken records so they don't block the queue.
      if (!unitCode || !lectureRoom || !sessionStart) {
        console.warn('[syncPendingAttendance] Skipping record with missing fields', record.id,
          { unitCode, lectureRoom, sessionStart });
        await sqliteStorage.markAttendanceSynced(record.id).catch(() => {});
        return 'skipped';
      }

      await submitOfflineAttendance({ unitCode, lectureRoom, sessionStart, scannedAt, deviceId, rawPayload });
      await sqliteStorage.markAttendanceSynced(record.id);
      return 'synced';
    }));

    for (let i = 0; i < recordResults.length; i++) {
      const r = recordResults[i];
      if (r.status === 'fulfilled' && r.value === 'synced') {
        synced++;
      } else if (r.status === 'rejected') {
        console.warn('[syncPendingAttendance] Failed for record', records[i]?.id, r.reason?.message);
        sqliteStorage.incrementSyncAttempts(records[i]?.id).catch(() => {});
        failed++;
      }
    }

    // ── Lecturer offline manual marks ─────────────────────────────────────
    try {
      const { getLecturerSession } = require('./authSession');
      const lecturerSession = await getLecturerSession().catch(() => null);
      const lecturerToken = lecturerSession?.token;
      if (lecturerToken) {
        const { syncPendingManualMarks } = require('./manualMarkApi');
        const manualResult = await syncPendingManualMarks(lecturerToken);
        synced += manualResult.synced;
        failed += manualResult.failed;
      }
    } catch (_) {
      // Non-critical — manual marks stay queued until next sync
    }

    // ── Proxy marks (parallel) ────────────────────────────────────────────
    if (proxyMarks.length > 0) {
      const proxyResults = await Promise.allSettled(proxyMarks.map(async (mark) => {
        const res = await fetchWithTimeout(
          `${API_BASE_URL}/api/attendance/delegations/${encodeURIComponent(mark.delegation_id)}/proxy-mark`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${studentToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionToken: mark.session_token,
              targetStudentId: mark.target_student_id,
              targetAdmissionNumber: mark.target_admission_number,
              markedAt: mark.marked_at,
            }),
          },
        );
        if (res.ok || res.status === 409) {
          await sqliteStorage.markProxyMarkSynced(mark.id);
          return 'synced';
        }
        await sqliteStorage.incrementProxyMarkSyncAttempts(mark.id).catch(() => {});
        return 'failed';
      }));

      for (const r of proxyResults) {
        if (r.status === 'fulfilled' && r.value === 'synced') synced++;
        else failed++;
      }
    }

    // ── Session ends (parallel) ───────────────────────────────────────────
    if (sessionEnds.length > 0) {
      const sessionEndResults = await Promise.allSettled(sessionEnds.map(async (se) => {
        const res = await fetchWithTimeout(
          `${API_BASE_URL}/api/attendance/delegations/${encodeURIComponent(se.delegation_id)}/end`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${studentToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionToken: se.session_token,
              unitCode: se.unit_code,
              roomCode: se.room_code,
              sessionStart: se.session_start,
              sessionEnd: se.session_end,
            }),
          },
        );
        if (res.ok || res.status === 409) {
          await sqliteStorage.markSessionEndSynced(se.id);
          return 'synced';
        }
        sqliteStorage.incrementSessionEndSyncAttempts(se.id).catch(() => {});
        return 'failed';
      }));

      for (const r of sessionEndResults) {
        if (r.status === 'fulfilled' && r.value === 'synced') synced++;
        else failed++;
      }
    }

    return { synced, failed };
  } finally {
    _isSyncing = false;
    if (_syncQueued) {
      _syncQueued = false;
      setTimeout(() => syncPendingAttendance().catch(() => {}), 500);
    }
  }
};
