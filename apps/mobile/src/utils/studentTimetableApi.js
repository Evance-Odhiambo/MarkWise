import { resolveApiBaseUrl } from './unitsApi';
import { hasInternetConnection } from './connectivity';

const parseResponsePayload = async (response) => {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.toLowerCase().includes('application/json')) {
    return response.json();
  }

  const text = await response.text();
  return text ? { message: text } : {};
};

const resolveErrorMessage = (payload, fallback) => {
  if (typeof payload?.message === 'string' && payload.message.trim()) {
    return payload.message;
  }
  if (typeof payload?.error === 'string' && payload.error.trim()) {
    return payload.error;
  }
  return fallback;
};

export const normalizeEntry = (entry) => {
  if (__DEV__) {
    // Uncomment to debug field-name mismatches: console.log('[TimetableNorm] rescheduled entry raw:', { id, status, rescheduledTo, rescheduled_to });
  }
  const unitName =
    entry?.unitName ||
    entry?.unit?.name ||
    entry?.unit?.title ||
    entry?.unitTitle ||
    entry?.name ||
    '';

  // Extract code from "Unit Name (CODE)" string if no dedicated field exists
  const extractCode = (str) => {
    const m = String(str || '').match(/\(([^)]+)\)/);
    return m ? m[1].replace(/\s+/g, ' ').trim().toUpperCase() : '';
  };

  // Shorten a full venue name to building acronym + room number.
  // e.g. "Human Resource Development Room 005" → "HRD 005"
  //      "Science Block Lab 3"                 → "SB 3"
  //      "Main Lecture Theatre 2"              → "MLT 2"
  //      "LT4"                                 → "LT4"   (already short)
  const ROOM_KEYWORDS = /^(Room|Lab(?:oratory)?|Theatre|Theater|Hall|Studio|Annex|Wing|Suite|Floor|Lecture\s+(?:Theatre|Theater|Hall))$/i;
  const STOP_WORDS = /^(of|the|a|an|and|for|in|at|to|by)$/i;
  const shortenVenue = (venue) => {
    if (!venue || venue === 'TBA') return '';
    if (venue.length <= 12) return venue; // already a short code
    const words = venue.trim().split(/\s+/);
    // Find the index of the room-type keyword
    let keywordIdx = -1;
    for (let i = 0; i < words.length; i++) {
      if (ROOM_KEYWORDS.test(words[i])) { keywordIdx = i; break; }
      // Handle two-word keywords like "Lecture Theatre"
      if (i < words.length - 1 && ROOM_KEYWORDS.test(`${words[i]} ${words[i + 1]}`)) {
        keywordIdx = i; break;
      }
    }
    if (keywordIdx > 0) {
      // Build acronym from building-name words before the room keyword
      const buildingWords = words.slice(0, keywordIdx).filter(w => !STOP_WORDS.test(w));
      const acronym = buildingWords.map(w => w[0].toUpperCase()).join('');
      // Room identifier is the word(s) after the keyword
      const roomId = words.slice(keywordIdx + 1).join(' ').trim();
      if (acronym && roomId) return `${acronym} ${roomId}`;
    }
    // Fall back to last two words
    return words.slice(-2).join(' ');
  };

  const unitCode =
    entry?.unitCode ||
    entry?.unit?.code ||
    entry?.code ||
    extractCode(entry?.unit) ||
    '';

  // Normalize to uppercase so it matches the enrollment store
  const normalizedUnitCode = (unitCode || unitName || '').replace(/\s+/g, ' ').trim().toUpperCase();

  const unit =
    (typeof entry?.unit === 'string' ? entry.unit : null) ||
    (unitName && unitCode ? `${unitName} (${unitCode})` : unitName || unitCode || '');

  const updatedAt =
    entry?.updatedAt ||
    entry?.updated_at ||
    entry?.lastUpdated ||
    entry?.modifiedAt ||
    entry?.modified_at ||
    null;

  const updatedBy =
    entry?.updatedBy ||
    entry?.updated_by ||
    entry?.updatedByName ||
    entry?.updatedByUser ||
    entry?.updatedByUserName ||
    entry?.lecturer ||
    entry?.lecturerName ||
    'Lecturer';

  // Derive day-of-week name from a specific date when no explicit `day` field exists.
  // Make-up sessions carry `date` (e.g. "2026-03-25") rather than `day` ("Wednesday").
  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const derivedDay = (() => {
    const raw = String(entry?.day || entry?.dayOfWeek || '').trim();
    if (raw) return raw;
    const dateStr = entry?.date || entry?.sessionDate || entry?.session_date || '';
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return !isNaN(d.getTime()) ? DAY_NAMES[d.getDay()] : '';
  })();

  return {
    id: String(entry?.id || entry?.sessionId || `${derivedDay || 'Day'}-${entry?.startTime || entry?.time || Math.random()}`),
    day: derivedDay,
    time:
      String(entry?.time || '').trim() ||
      `${String(entry?.startTime || '').trim()}${entry?.startTime && entry?.endTime ? ' - ' : ''}${String(entry?.endTime || '').trim()}`,
    unit,
    unitCode: normalizedUnitCode,
    type: String(entry?.type || entry?.lessonType || 'Lecture').trim() || 'Lecture',
    venue: String(entry?.venue || entry?.room || entry?.lectureRoom || 'TBA').trim() || 'TBA',
    roomCode: (
      String(entry?.roomCode || entry?.room_code || entry?.venueCode || entry?.venue_code || entry?.roomId || '').trim()
      || shortenVenue(entry?.venue || entry?.room || entry?.lectureRoom || '')
    ),
    status: String(entry?.status || 'Pending').trim() || 'Pending',
    lecturer: String(entry?.lecturer || entry?.lecturerName || 'Lecturer').trim() || 'Lecturer',
    rescheduledTo: String(
      entry?.rescheduledTo ||
      entry?.rescheduled_to ||
      entry?.rescheduleTime ||
      entry?.reschedule_time ||
      entry?.newTime ||
      entry?.new_time ||
      ''
    ).trim() || null,
    rescheduledVenue: String(
      entry?.rescheduledVenue ||
      entry?.rescheduled_venue ||
      entry?.newVenue ||
      entry?.new_venue ||
      entry?.rescheduleVenue ||
      entry?.reschedule_venue ||
      ''
    ).trim() || null,
    reschedulePermanent: entry?.reschedulePermanent ?? entry?.reschedule_permanent ?? null,
    reason: entry?.reason || null,
    pendingReason: entry?.pendingReason || null,
    meetingLink: entry?.meetingLink || entry?.meeting_link || entry?.meetingUrl || entry?.meeting_url || null,
    meetingPlatform: entry?.meetingPlatform || entry?.meeting_platform || entry?.platform || null,
    meetingNote: entry?.meetingNote || entry?.meeting_note || entry?.onlineNote || null,
    notifications: Number(entry?.notifications || 0),
    updatedAt,
    updatedBy,
    isExtraSession: !!entry?.isExtraSession,
    date: String(entry?.date || entry?.sessionDate || entry?.session_date || '').trim() || null,
  };
};

const groupTimetableByDay = (entries) => {
  const grouped = new Map();

  entries.forEach((entry) => {
    const normalized = normalizeEntry(entry);
    const day = normalized.day || 'Unknown';
    if (!grouped.has(day)) {
      grouped.set(day, []);
    }
    grouped.get(day).push(normalized);
  });

  return Array.from(grouped.entries()).map(([day, lessons]) => ({
    day,
    lessons,
  }));
};

const normalizeSnapshot = (payload) => {
  const timetableEntries =
    (Array.isArray(payload?.timetable) && payload.timetable) ||
    (Array.isArray(payload?.data?.timetable) && payload.data.timetable) ||
    [];

  // Also pick up extra/make-up sessions if the backend bundles them in the same response
  const extraEntries = (
    (Array.isArray(payload?.extraSessions) && payload.extraSessions) ||
    (Array.isArray(payload?.data?.extraSessions) && payload.data.extraSessions) ||
    []
  ).map(s => ({ ...s, isExtraSession: true }));

  // Deduplicate by id/sessionId before grouping — the backend sometimes returns the
  // same make-up session in both timetable[] and extraSessions[], which would create
  // duplicates before doFetch even gets a chance to apply its own dedup.
  const seenIds = new Set();
  const allEntries = [...timetableEntries, ...extraEntries].filter(e => {
    const id = String(e?.id || e?.sessionId || '').trim();
    if (!id) return true; // no stable id — keep and let normalizeEntry assign one
    if (seenIds.has(id)) return false;
    seenIds.add(id);
    return true;
  });

  return {
    courseId: String(payload?.courseId || payload?.data?.courseId || '').trim(),
    version: Number(payload?.version || payload?.data?.version || 0) || 0,
    updatedAt: payload?.updatedAt || payload?.data?.updatedAt || null,
    timetableByDay: groupTimetableByDay(allEntries),
    rawEntries: allEntries,
  };
};

export const fetchStudentTimetableSnapshot = async ({ accessToken, etag } = {}) => {
  const token = String(accessToken || '').trim();
  if (!token) {
    throw new Error('Missing student access token');
  }

  const isConnected = await hasInternetConnection();
  if (!isConnected) {
    throw new Error('No internet connection. Connect to the internet to sync timetable.');
  }

  const baseUrl = resolveApiBaseUrl();
  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
  };

  const normalizedEtag = String(etag || '').trim();
  if (normalizedEtag) {
    headers['If-None-Match'] = normalizedEtag;
  }

  const response = await fetch(`${baseUrl}/api/student/timetable`, {
    method: 'GET',
    headers,
  });

  const responseEtag = String(response.headers.get('etag') || '').trim();
  if (response.status === 304) {
    return {
      notModified: true,
      etag: responseEtag || normalizedEtag,
      snapshot: null,
    };
  }

  const payload = await parseResponsePayload(response);
  if (!response.ok) {
    throw new Error(resolveErrorMessage(payload, `Failed to fetch student timetable: ${response.status}`));
  }

  return {
    notModified: false,
    etag: responseEtag,
    snapshot: normalizeSnapshot(payload),
  };
};

export const buildStudentTimetableEventsUrl = () => `${resolveApiBaseUrl()}/api/events/timetable`;

/**
 * Fetch make-up / extra sessions assigned to the logged-in student.
 * Endpoint: GET /api/timetable/extra-sessions/student
 * Non-critical — always resolves (returns [] on any error).
 *
 * @param {string} accessToken - Student JWT
 * @returns {Promise<Array>}
 */
export const fetchStudentExtraSessions = async (accessToken) => {
  const token = String(accessToken || '').trim();
  if (!token) return [];
  try {
    const baseUrl = resolveApiBaseUrl();
    const res = await fetch(`${baseUrl}/api/timetable/extra-sessions/student`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return [];
    const data = await res.json().catch(() => ({}));
    const sessions = Array.isArray(data) ? data : (data?.data ?? data?.sessions ?? data?.extraSessions ?? []);
    // Normalize at source so callers receive pre-normalized entries
    return sessions.map(s => normalizeEntry({ ...s, isExtraSession: true }));
  } catch (_) {
    return [];
  }
};
