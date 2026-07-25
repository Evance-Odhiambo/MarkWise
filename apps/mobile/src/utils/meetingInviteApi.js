// Meeting Invite API — lecturers share meeting details with students before a session
import { API_BASE_URL } from './constants';
import { getLecturerSession, getStudentSession } from './authSession';

import colors from '../theme/colors';

const C = {
  primary:     colors.primary.main,
};


/**
 * Build the best possible join URL by embedding the passcode and display name
 * where the platform supports it via URL parameters.
 *
 * Platform support:
 * - Zoom:    ?pwd=PASSCODE  +  ?uname=NAME   (web client pre-fills both)
 * - Jitsi:   #userInfo.displayName=NAME      (hash fragment, works in all Jitsi)
 * - Whereby: ?displayName=NAME
 * - MiroTalk: ?name=NAME
 * - Others:  returns the link unchanged; caller copies passcode to clipboard
 *
 * @param {string} meetingLink
 * @param {string} [passcode]
 * @param {string} [displayName]  - Student's full name to pre-fill
 * @returns {string} The best URL to open
 */
export function buildJoinUrl(meetingLink, passcode, displayName) {
  if (!meetingLink) return meetingLink;
  let url   = meetingLink.trim();
  const lower = url.toLowerCase();
  const name  = displayName ? displayName.trim() : '';

  // ── Zoom ──────────────────────────────────────────────────────────────────
  if (lower.includes('zoom.us')) {
    if (passcode && !lower.includes('pwd=')) {
      const sep = url.includes('?') ? '&' : '?';
      url = `${url}${sep}pwd=${encodeURIComponent(passcode.trim())}`;
    }
    if (name && !lower.includes('uname=')) {
      url = `${url}&uname=${encodeURIComponent(name)}`;
    }
    return url;
  }

  // ── Jitsi ─────────────────────────────────────────────────────────────────
  if (lower.includes('jitsi')) {
    if (name) {
      const fragment = `userInfo.displayName=${encodeURIComponent(name)}`;
      url = url.includes('#') ? `${url}&${fragment}` : `${url}#${fragment}`;
    }
    return url;
  }

  // ── Whereby ───────────────────────────────────────────────────────────────
  if (lower.includes('whereby.com')) {
    if (name) {
      const sep = url.includes('?') ? '&' : '?';
      url = `${url}${sep}displayName=${encodeURIComponent(name)}`;
    }
    return url;
  }

  // ── MiroTalk ──────────────────────────────────────────────────────────────
  if (lower.includes('mirotalk')) {
    if (name) {
      const sep = url.includes('?') ? '&' : '?';
      url = `${url}${sep}name=${encodeURIComponent(name)}`;
    }
    return url;
  }

  // ── All other platforms ───────────────────────────────────────────────────
  // No URL-based name or passcode support; caller copies passcode to clipboard
  return url;
}

/**
 * Detect the video platform from a meeting URL.
 * Returns { name, icon (MaterialCommunityIcons key), color }
 */
export const detectPlatform = (url = '') => {
  const u = url.toLowerCase();
  if (u.includes('zoom.us'))          return { name: 'Zoom',        icon: 'video',           color: '#2D8CFF' };
  if (u.includes('meet.google'))      return { name: 'Google Meet', icon: 'video-outline',   color: '#00897B' };
  if (u.includes('teams.microsoft'))  return { name: 'Teams',       icon: 'microsoft-teams', color: '#5058C8' };
  if (u.includes('webex.com'))        return { name: 'Webex',       icon: 'video-wireless',  color: '#00BCEB' };
  if (u.includes('whereby.com'))      return { name: 'Whereby',     icon: 'video-box',       color: '#DC6DCF' };
  if (u.includes('mirotalk'))         return { name: 'MiroTalk',    icon: 'video-account',   color: C.primary };
  if (u.includes('jitsi'))            return { name: 'Jitsi',       icon: 'video-wireless',  color: '#97C925' };
  return { name: 'Meeting', icon: 'video', color: C.primary };
};

/**
 * Lecturer: post a meeting invite that will be visible to all enrolled students
 * of the given unit.
 *
 * @param {object} params
 * @param {string} params.unitCode       - Unit code (e.g. "CS101")
 * @param {string} params.unitName       - Full unit name
 * @param {string} params.meetingLink    - Zoom / Meet / Teams URL
 * @param {string} [params.passcode]     - Optional room passcode
 * @param {string} params.scheduledAt   - ISO-8601 datetime when the meeting starts
 * @param {string} [params.message]     - Optional note to students
 * @returns {Promise<object>} Created invite (includes id from server)
 */
export async function postMeetingInvite({ unitCode, unitName, meetingLink, passcode, scheduledAt, message }) {
  const session = await getLecturerSession();
  const res = await fetch(`${API_BASE_URL}/meeting-invites`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session?.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      lecturerId: session?.lecturerId,
      lecturerName: session?.lecturerName || 'Lecturer',
      unitCode,           // send raw — backend validates against its own timetable data
      unitName: unitName || unitCode,
      meetingLink,
      passcode: passcode || null,
      scheduledAt,
      message: message || null,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Server error ${res.status}`);
  }
  return res.json();
}

/**
 * Student: fetch all upcoming meeting invites for units the student is enrolled in.
 * @param {string[]} [unitCodes] - Array of unit codes the student is enrolled in.
 *   Sent as ?units=CS101,CS102 so the backend can filter by enrollment.
 * @returns {Promise<Array>} Array of invite objects
 */
export async function fetchStudentMeetingInvites(unitCodes = []) {
  const session = await getStudentSession();
  // Normalize unit codes to match how they are stored (uppercase, no spaces)
  const normalized = unitCodes
    .map(u => String(u).replace(/\s+/g, '').toUpperCase())
    .filter(Boolean);
  const base = `${API_BASE_URL}/meeting-invites/student`;
  const url = normalized.length > 0
    ? `${base}?units=${encodeURIComponent(normalized.join(','))}`
    : base;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${session?.token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Server error ${res.status}`);
  }
  const data = await res.json();
  const rawList = Array.isArray(data) ? data : (data?.invites ?? data?.data ?? []);

  // Normalise snake_case → camelCase so the UI works regardless of which
  // convention the backend uses (both forms are kept so the spread still
  // passes any extra fields through unchanged).
  return rawList.map(inv => ({
    ...inv,
    id:           inv.id           || inv._id,
    scheduledAt:  inv.scheduledAt  || inv.scheduled_at,
    unitCode:     inv.unitCode     || inv.unit_code     || '',
    unitName:     inv.unitName     || inv.unit_name     || inv.unitCode || inv.unit_code || '',
    lecturerName: inv.lecturerName || inv.lecturer_name || '',
    meetingLink:  inv.meetingLink  || inv.meeting_link  || '',
    passcode:     inv.passcode     || null,
    message:      inv.message      || inv.note          || null,
  }));
}

/**
 * Lecturer: revoke (delete) a previously sent meeting invite.
 * @param {string} inviteId
 */
export async function deleteMeetingInvite(inviteId) {
  const session = await getLecturerSession();
  const res = await fetch(`${API_BASE_URL}/meeting-invites/${encodeURIComponent(inviteId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${session?.token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Server error ${res.status}`);
  }
}
