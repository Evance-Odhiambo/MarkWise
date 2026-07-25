// src/utils/onlineAttendanceApi.js
import DeviceInfo from 'react-native-device-info';
import { getStudentSession } from './authSession';
import { API_BASE_URL } from './constants';

const SESS_BASE = `${API_BASE_URL}/api/attendance/sessions`;

/**
 * Fetch public info about an online attendance session.
 * Called by OnlineMarker to display unit code, status, and time remaining.
 * Requires a student JWT (session must be active).
 *
 * @param {string} sessionId
 * @returns {Promise<{ sessionId, unitCode, unitName, status, expiresAt, lecturerName }>}
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
 *
 * @param {string} sessionId
 * @returns {Promise<{ message, attendanceId }>}
 */
export const submitOnlineAttendance = async (sessionId) => {
    const [session, deviceId] = await Promise.all([
        getStudentSession(),
        DeviceInfo.getUniqueId(),
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
