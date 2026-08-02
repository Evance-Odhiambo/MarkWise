// src/utils/onlineAttendanceApi.js
import DeviceInfo from 'react-native-device-info';
import { getStudentSession } from './authSession';
import { API_BASE_URL } from './constants';
import sqliteStorage from '../storage/sqliteStorage';

const SESS_BASE = `${API_BASE_URL}/api/attendance/sessions`;

/**
 * Stable device identity: prefer existing SQLite-backed attendance device id
 * (survives reinstall on most platforms) over platform UID.
 */
const resolveDeviceId = async () => {
  try {
    const stable = await sqliteStorage.getOrCreateAttendanceDeviceId?.();
    if (stable) return stable;
  } catch (_) {}
  try {
    return await DeviceInfo.getUniqueId();
  } catch (_) {}
  return 'unknown';
};

/**
 * Fetch public info about an online attendance session.
 * Called by OnlineMarker to display unit code, status, and time remaining.
 * Requires a student JWT (session must be active).
 */
export const fetchOnlineSessionInfo = async (sessionId) => {
    const session = await getStudentSession();
    const headers = session?.token
        ? { Authorization: `Bearer ${session.token}` }
        : {};

    const res = await fetch(`${SESS_BASE}/${encodeURIComponent(sessionId)}`, {
        headers,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data.message || `Session not found (${res.status})`);
    }
    return data;
};

/**
 * Submit online attendance for the logged-in student.
 * Identity comes from the JWT bearer token.
 * Device fingerprint is sent for rate-limiting and anti-proxy binding.
 */
export const submitOnlineAttendance = async (sessionId) => {
    const [session, deviceId] = await Promise.all([
        getStudentSession(),
        resolveDeviceId(),
    ]);

    if (!session?.token) {
        throw new Error('Please sign in to MarkWise before marking attendance.');
    }

    const res = await fetch(
        `${SESS_BASE}/${encodeURIComponent(sessionId)}/submit`,
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${session.token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ deviceId }),
        },
    );

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data.message || `Failed to submit (${res.status})`);
    }
    return data;
};

/**
 * Queue an online attendance submission for later retry when the device
 * regains connectivity. Transient failures are captured here so the student
 * does not lose attendance simply because of a brief network drop.
 */
export const queueOnlineSubmission = async (sessionId, error) => {
    try {
        await sqliteStorage.addPendingOnlineSubmission?.({ sessionId, error });
    } catch (_) {}
};

/**
 * Drain the pending online submissions queue up to a safe batch size.
 * Returns the number of successfully synced items.
 */
export const syncPendingOnlineSubmissions = async () => {
    const session = await getStudentSession().catch(() => null);
    if (!session?.token) return 0;

    const pending = await sqliteStorage.getUnsyncedOnlineSubmissions?.();
    if (!Array.isArray(pending) || pending.length === 0) {
        await sqliteStorage.clearSyncedOnlineSubmissions?.();
        return 0;
    }

    let synced = 0;
    for (const item of pending) {
        try {
            await submitOnlineAttendance(item.session_id);
            await sqliteStorage.markOnlineSubmissionSynced?.(item.id);
            synced++;
        } catch (err) {
            const msg = err?.message || 'sync_failed';
            await sqliteStorage.incrementOnlineSubmissionSyncAttempts?.(item.id, msg);
        }
    }

    await sqliteStorage.clearSyncedOnlineSubmissions?.();
    return synced;
};
