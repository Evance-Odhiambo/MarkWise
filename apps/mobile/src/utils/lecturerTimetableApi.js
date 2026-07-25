import AsyncStorage from '@react-native-async-storage/async-storage';
import { resolveApiBaseUrl } from './unitsApi';
import { hasInternetConnection } from './connectivity';

const TIMETABLE_CACHE_KEY = '@markwise_lecturer_timetable_cache';

// Set to true when the last call to fetchMyLecturerTimetable returned cached data.
let _lastFetchWasCached = false;
export const wasLastTimetableFetchFromCache = () => _lastFetchWasCached;

const readTimetableCache = async () => {
  try {
    const raw = await AsyncStorage.getItem(TIMETABLE_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
};

const writeTimetableCache = async (entries) => {
  try {
    await AsyncStorage.setItem(TIMETABLE_CACHE_KEY, JSON.stringify(entries));
  } catch { /* non-critical */ }
};

export const invalidateLecturerTimetableCache = async () => {
  try {
    await AsyncStorage.removeItem(TIMETABLE_CACHE_KEY);
    _lastFetchWasCached = false;
  } catch {}
};

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

const toList = (payload) => {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (Array.isArray(payload?.data?.entries)) {
    return payload.data.entries;
  }

  if (Array.isArray(payload?.data?.timetable)) {
    return payload.data.timetable;
  }

  if (Array.isArray(payload?.entries)) {
    return payload.entries;
  }

  if (Array.isArray(payload?.timetable)) {
    return payload.timetable;
  }

  if (Array.isArray(payload?.data)) {
    return payload.data;
  }

  if (Array.isArray(payload?.assignments)) {
    return payload.assignments;
  }

  if (Array.isArray(payload?.rows)) {
    return payload.rows;
  }

  return [];
};

const firstNonEmptyString = (...values) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
};

const normalizeTime = (entry) => {
  const direct = firstNonEmptyString(
    entry?.time,
    entry?.timeLabel,
    entry?.timeSlot,
    entry?.timeslot,
    entry?.slotLabel,
    entry?.slot,
    entry?.period,
    entry?.scheduleTime,
    entry?.schedule_time,
    entry?.classTime,
    entry?.class_time,
    entry?.start_time && entry?.end_time ? `${entry.start_time} - ${entry.end_time}` : '',
    entry?.startTime && entry?.endTime ? `${entry.startTime} - ${entry.endTime}` : '',
    entry?.start && entry?.end ? `${entry.start} - ${entry.end}` : '',
    entry?.startAt && entry?.endAt ? `${entry.startAt} - ${entry.endAt}` : '',
    entry?.from && entry?.to ? `${entry.from} - ${entry.to}` : '',
    entry?.begin && entry?.finish ? `${entry.begin} - ${entry.finish}` : '',
  );

  if (direct) {
    return direct;
  }

  const nestedStart = firstNonEmptyString(
    entry?.session?.startAt, entry?.session?.start, entry?.session?.start_time,
    entry?.schedule?.startAt, entry?.schedule?.start, entry?.schedule?.start_time,
  );
  const nestedEnd = firstNonEmptyString(
    entry?.session?.endAt, entry?.session?.end, entry?.session?.end_time,
    entry?.schedule?.endAt, entry?.schedule?.end, entry?.schedule?.end_time,
  );
  if (nestedStart && nestedEnd) {
    return `${nestedStart} - ${nestedEnd}`;
  }
  if (nestedStart) {
    return nestedStart;
  }

  const windowStart = firstNonEmptyString(entry?.window?.start, entry?.window?.from);
  const windowEnd = firstNonEmptyString(entry?.window?.end, entry?.window?.to);
  if (windowStart && windowEnd) {
    return `${windowStart} - ${windowEnd}`;
  }

  return '';
};

const extractStartTime = (entry) => firstNonEmptyString(
  entry?.startTime, entry?.start_time, entry?.start, entry?.startAt,
  entry?.session?.startAt, entry?.session?.start, entry?.schedule?.start,
  entry?.window?.start, entry?.window?.from,
);

const extractEndTime = (entry) => firstNonEmptyString(
  entry?.endTime, entry?.end_time, entry?.end, entry?.endAt,
  entry?.session?.endAt, entry?.session?.end, entry?.schedule?.end,
  entry?.window?.end, entry?.window?.to,
);

const normalizeEntry = (entry) => {
  const unitCode = firstNonEmptyString(
    entry?.unitCode,
    entry?.code,
    entry?.unit?.code,
    entry?.courseUnit?.code,
    entry?.unit?.unitCode,
    entry?.unit?.unit_code,
    entry?.moduleCode,
    entry?.module?.code,
    entry?.unit_code,
  );

  const unitTitle = firstNonEmptyString(
    entry?.unitTitle,
    entry?.title,
    entry?.unit?.title,
    entry?.courseUnit?.title,
    entry?.unit_title,
    entry?.module?.title,
  );

  const unitName = firstNonEmptyString(
    unitTitle,
    entry?.unitName,
    entry?.name,
    typeof entry?.unit === 'string' ? entry.unit : '',
    entry?.unit?.name,
    entry?.unit?.title,
    entry?.courseUnit?.name,
    entry?.courseUnit?.title,
    entry?.unit_name,
  );

  const day = firstNonEmptyString(
    entry?.day,
    entry?.dayOfWeek,
    entry?.weekday,
    entry?.scheduleDay,
    entry?.schedule_day,
    entry?.schedule?.day,
    entry?.schedule?.dayOfWeek,
    entry?.day_of_week,
  );

  const time = normalizeTime(entry);
  const startTime = extractStartTime(entry);
  const endTime = extractEndTime(entry);

  const venue = firstNonEmptyString(
    entry?.venue,
    entry?.venueName,
    entry?.venue_name,
    entry?.venueCode,
    entry?.venue_code,
    entry?.venue?.name,
    entry?.venue?.venueName,
    entry?.venue?.title,
    entry?.venue?.code,
    entry?.venue?.id,
    entry?.lectureRoom,
    entry?.lecture_room,
    entry?.room,
    entry?.roomName,
    entry?.room_name,
    entry?.location,
    entry?.building,
    entry?.classroom,
    entry?.class_room,
    entry?.room?.name,
    entry?.room?.title,
    entry?.room?.code,
    entry?.room?.id,
    entry?.session?.venue,
    entry?.session?.room,
    entry?.schedule?.venue,
    entry?.schedule?.room,
  );

  const roomCode = firstNonEmptyString(
    entry?.roomCode,
    entry?.room_code,
    entry?.venueCode,
    entry?.venue_code,
    entry?.lectureRoomCode,
    entry?.lecture_room_code,
    entry?.venue?.code,
    entry?.venue?.roomCode,
    entry?.venue?.room_code,
    entry?.room?.code,
    entry?.room?.roomCode,
    entry?.room?.room_code,
    entry?.session?.roomCode,
    entry?.schedule?.roomCode,
  );

  const lectureRoom = venue;

  const status = firstNonEmptyString(entry?.status, entry?.lessonStatus, entry?.lesson_status) || 'Pending';

  const meetingLink = firstNonEmptyString(
    entry?.meetingLink,
    entry?.meeting_link,
    entry?.meetingUrl,
    entry?.meeting_url,
    entry?.joinUrl,
    entry?.join_url,
  );

  const meetingPlatform = firstNonEmptyString(
    entry?.meetingPlatform,
    entry?.meeting_platform,
    entry?.platform,
  );

  const meetingNote = firstNonEmptyString(
    entry?.meetingNote,
    entry?.meeting_note,
    entry?.onlineNote,
    entry?.online_note,
  );

  const courseName = firstNonEmptyString(
    entry?.courseName,
    entry?.course_name,
    entry?.course?.name,
    entry?.course?.title,
    entry?.program?.name,
    entry?.program?.title,
    entry?.programName,
    entry?.curriculum?.name,
    entry?.programme?.name,
  );

  const courseCode = firstNonEmptyString(
    entry?.courseCode,
    entry?.course_code,
    entry?.course?.code,
    entry?.program?.code,
    entry?.programCode,
    entry?.programme?.code,
  );

  const department = firstNonEmptyString(
    entry?.department,
    entry?.departmentName,
    entry?.department_name,
    entry?.faculty,
    entry?.school,
    entry?.course?.department,
    entry?.program?.department,
    entry?.course?.faculty,
  );

  // Numeric BLE IDs — required for GD delegation BLE packet construction.
  // The backend must include these in timetable entries for delegation to work.
  const unitId = Number(
    entry?.unitId ??
    entry?.unit_id ??
    entry?.bleUnitId ??
    entry?.ble_unit_id ??
    entry?.unit?.unitId ??
    entry?.unit?.unit_id ??
    entry?.unit?.bleId ??
    0
  ) || null;

  const roomId = Number(
    entry?.roomId ??
    entry?.room_id ??
    entry?.bleRoomId ??
    entry?.ble_room_id ??
    entry?.venue?.roomId ??
    entry?.venue?.room_id ??
    entry?.venue?.bleId ??
    entry?.room?.id ??
    0
  ) || null;

  // ── Merged-lesson fields ───────────────────────────────────────────────────
  // Accept both camelCase (app-native) and snake_case (some backend variants).
  // These must be explicit so the rendering check `entry.isMerged &&
  // entry.mergedSessionId` works regardless of what case the backend sends.
  const isMerged = !!(entry?.isMerged || entry?.is_merged);

  const mergedSessionId = firstNonEmptyString(
    typeof entry?.mergedSessionId !== 'undefined' ? String(entry.mergedSessionId) : '',
    typeof entry?.merged_session_id !== 'undefined' ? String(entry.merged_session_id) : '',
  );

  const mergedBy = firstNonEmptyString(
    entry?.mergedBy,
    entry?.merged_by,
  );

  const mergedRoom = firstNonEmptyString(
    entry?.mergedRoom,
    entry?.merged_room,
  );

  const mergedStart = firstNonEmptyString(
    entry?.mergedStart,
    entry?.merged_start,
  );

  const mergedEnd = firstNonEmptyString(
    entry?.mergedEnd,
    entry?.merged_end,
  );

  const mergedNote = firstNonEmptyString(
    entry?.mergedNote,
    entry?.merged_note,
  );

  const mergedUnitCodes = Array.isArray(entry?.mergedUnitCodes)
    ? entry.mergedUnitCodes
    : Array.isArray(entry?.merged_unit_codes)
      ? entry.merged_unit_codes
      : null;

  return {
    ...entry,
    unitCode,
    unitTitle,
    unitName,
    day,
    time,
    startTime,
    endTime,
    venue,
    roomCode,
    lectureRoom,
    status,
    unitId,
    roomId,
    meetingLink: meetingLink || null,
    meetingPlatform: meetingPlatform || null,
    meetingNote: meetingNote || null,
    courseName: courseName || null,
    courseCode: courseCode || null,
    department: department || null,
    // Explicit merge fields — override any raw spread values so the correct
    // normalised form is always used by the timetable rendering logic.
    isMerged,
    mergedSessionId: mergedSessionId || null,
    mergedBy: mergedBy || null,
    mergedRoom: mergedRoom || null,
    mergedStart: mergedStart || null,
    mergedEnd: mergedEnd || null,
    mergedNote: mergedNote || null,
    mergedUnitCodes: mergedUnitCodes || null,
  };
};

const normalizeUpdatedEntry = (payload) => {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const candidate =
    payload?.entry ||
    payload?.timetable ||
    payload?.data?.entry ||
    payload?.data?.timetable ||
    payload?.data ||
    null;

  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return null;
  }

  return normalizeEntry(candidate);
};

export const fetchMyLecturerTimetable = async (accessToken) => {
  const token = String(accessToken || '').trim();
  if (!token) {
    throw new Error('Missing lecturer access token');
  }

  const isConnected = await hasInternetConnection();
  if (!isConnected) {
    // Serve from cache so the timetable is viewable offline
    const cached = await readTimetableCache();
    if (cached && Array.isArray(cached) && cached.length > 0) {
      _lastFetchWasCached = true;
      return cached;
    }
    _lastFetchWasCached = false;
    throw new Error('No internet connection and no cached timetable available.');
  }
  _lastFetchWasCached = false;

  const baseUrl = resolveApiBaseUrl();
  const response = await fetch(`${baseUrl}/api/timetable/lecturer/me`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

  const payload = await parseResponsePayload(response);
  if (!response.ok) {
    throw new Error(resolveErrorMessage(payload, `Failed to fetch lecturer timetable: ${response.status}`));
  }

  const normalized = toList(payload).map(normalizeEntry);
  // Persist for offline use (fire-and-forget)
  writeTimetableCache(normalized);
  return normalized;
};

export const updateLecturerTimetableEntryStatus = async ({
  accessToken,
  entryId,
  status,
  rescheduledTo,
  rescheduledVenue,
  reschedulePermanent,
  reason,
  pendingReason,
  clearVenue,
  lessonType,
  onlineStartTime,
  onlineEndTime,
}) => {
  const token = String(accessToken || '').trim();
  if (!token) {
    throw new Error('Missing lecturer access token');
  }

  const isConnected = await hasInternetConnection();
  if (!isConnected) {
    throw new Error('No internet connection. Connect to the internet to update timetable status.');
  }

  const normalizedEntryId = String(entryId || '').trim();
  if (!normalizedEntryId) {
    throw new Error('Missing timetable entry id');
  }

  const normalizedStatus = String(status || '').trim();
  if (!normalizedStatus) {
    throw new Error('Status is required');
  }

  const requestBody = {
    status: normalizedStatus,
  };

  const normalizedRescheduledTo = String(rescheduledTo || '').trim();
  if (normalizedRescheduledTo) {
    requestBody.rescheduledTo = normalizedRescheduledTo;
  }
  const normalizedRescheduledVenue = String(rescheduledVenue || '').trim();
  if (normalizedRescheduledVenue) {
    requestBody.rescheduledVenue = normalizedRescheduledVenue;
  }
  if (reschedulePermanent !== undefined && reschedulePermanent !== null) {
    requestBody.reschedulePermanent = Boolean(reschedulePermanent);
  }

  const normalizedReason = String(reason || '').trim();
  if (normalizedReason) {
    requestBody.reason = normalizedReason;
  }

  const normalizedPendingReason = String(pendingReason || '').trim();
  if (normalizedPendingReason) {
    requestBody.pendingReason = normalizedPendingReason;
  }
  if (clearVenue === true) {
    requestBody.clearVenue = true;
  }

  const normalizedOnlineStart = String(onlineStartTime || '').trim();
  if (normalizedOnlineStart) {
    requestBody.onlineStartTime = normalizedOnlineStart;
  }
  const normalizedOnlineEnd = String(onlineEndTime || '').trim();
  if (normalizedOnlineEnd) {
    requestBody.onlineEndTime = normalizedOnlineEnd;
  }

  const normalizedLessonType = String(lessonType || '').trim();
  if (normalizedLessonType) {
    requestBody.lessonType = normalizedLessonType;
  }

  const baseUrl = resolveApiBaseUrl();
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
  };

  const requestOptions = {
    method: 'PUT',
    headers,
    body: JSON.stringify(requestBody),
  };

  const primaryUrl = `${baseUrl}/api/timetable/${encodeURIComponent(normalizedEntryId)}`;
  const primaryResponse = await fetch(primaryUrl, requestOptions);
  const primaryPayload = await parseResponsePayload(primaryResponse);

  if (primaryResponse.ok) {
    return {
      updatedEntry: normalizeUpdatedEntry(primaryPayload),
      raw: primaryPayload,
    };
  }

  if (primaryResponse.status !== 404 && primaryResponse.status !== 405) {
    throw new Error(resolveErrorMessage(primaryPayload, `Failed to update timetable entry: ${primaryResponse.status}`));
  }

  const fallbackUrl = `${baseUrl}/api/timetable/${encodeURIComponent(normalizedEntryId)}/status`;
  const fallbackResponse = await fetch(fallbackUrl, requestOptions);
  const fallbackPayload = await parseResponsePayload(fallbackResponse);

  if (!fallbackResponse.ok) {
    throw new Error(resolveErrorMessage(fallbackPayload, `Failed to update timetable entry: ${fallbackResponse.status}`));
  }

  return {
    updatedEntry: normalizeUpdatedEntry(fallbackPayload),
    raw: fallbackPayload,
  };
};

// POST /api/timetable/merge-lessons
// Combines multiple timetable entries (same unit, different courses) into one
// room for a single shared lecture. The backend should notify enrolled students.
export const mergeLessons = async ({ token, entryIds, unitCode, roomCode, roomId, note, day, startTime, endTime }) => {
  const baseUrl = resolveApiBaseUrl();
  const res = await fetch(`${baseUrl}/api/timetable/merge-lessons`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ entryIds, unitCode, roomCode, roomId, note, day, startTime, endTime, mergedBy: 'Lecturer' }),
  });
  const payload = await parseResponsePayload(res);
  if (!res.ok) {
    throw new Error(resolveErrorMessage(payload, `Merge failed (${res.status})`));
  }
  return payload;
};

export const unmergeLessons = async ({ token, mergedSessionId, unitCode }) => {
  const baseUrl = resolveApiBaseUrl();
  const res = await fetch(`${baseUrl}/api/timetable/unmerge-lessons`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ mergedSessionId, unitCode }),
  });
  const payload = await parseResponsePayload(res);
  if (!res.ok) {
    throw new Error(resolveErrorMessage(payload, `Unmerge failed (${res.status})`));
  }
  return payload;
};
