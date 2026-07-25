import { NativeModules, Platform } from 'react-native';
import { API_BASE_URL } from './constants';
import { hasInternetConnection } from './connectivity';

const DEFAULT_PORT = '3000';
const DEFAULT_ANDROID_EMULATOR_BASE_URL = `http://10.0.2.2:${DEFAULT_PORT}`;
// For iOS simulator only; Android emulator should use 10.0.2.2
const DEFAULT_IOS_SIMULATOR_BASE_URL = `http://localhost:${DEFAULT_PORT}`;

const normalizeBaseUrl = (url) => {
  if (!url || typeof url !== 'string') {
    return '';
  }
  return url.trim().replace(/\/$/, '');
};

const resolveMetroHost = () => {
  const scriptUrl = NativeModules?.SourceCode?.scriptURL;
  if (!scriptUrl || typeof scriptUrl !== 'string') {
    return '';
  }

  const hostMatch = scriptUrl.match(/^https?:\/\/([^/:]+)(?::\d+)?\//i);
  return hostMatch ? hostMatch[1] : '';
};

// Normalize a single unit entry — backend may return strings "Name (CODE)"
// or objects {unitCode, unitName}. We always produce the string form.
const normalizeUnit = (unit) => {
  if (typeof unit === 'string') return unit;
  if (unit && typeof unit === 'object') {
    const name = unit.unitName || unit.name || unit.title || unit.unit_name || '';
    const code = unit.unitCode || unit.code || unit.unit_code || '';
    if (name && code) return `${name} (${code})`;
    return name || code || '';
  }
  return String(unit || '');
};

// Walk every year-semester key in the map and normalize its unit array.
const normalizeMap = (map) => {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return {};
  const result = {};
  for (const key of Object.keys(map)) {
    const val = map[key];
    result[key] = Array.isArray(val) ? val.map(normalizeUnit).filter(Boolean) : val;
  }
  return result;
};

const toUnitsMap = (payload) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Invalid units response payload');
  }

  if (payload.unitsByCourseYearSemester && typeof payload.unitsByCourseYearSemester === 'object') {
    return normalizeMap(payload.unitsByCourseYearSemester);
  }

  if (payload.unitsByYearSemester && typeof payload.unitsByYearSemester === 'object') {
    return normalizeMap(payload.unitsByYearSemester);
  }

  return normalizeMap(payload);
};

export const resolveApiBaseUrl = () => {
  // Always use the constant for backend
  return normalizeBaseUrl(API_BASE_URL);

  return DEFAULT_IOS_SIMULATOR_BASE_URL;
};

const normalizeCourseId = (courseId) => {
  const normalized = String(courseId || '').trim();
  return normalized || '';
};

const buildUnitsEndpoint = (baseUrl, courseId, courseCode) => {
  const normalizedCourseId = normalizeCourseId(courseId);
  const normalizedCourseCode = String(courseCode || '').trim();
  const params = [];
  if (normalizedCourseId) params.push(`courseId=${encodeURIComponent(normalizedCourseId)}`);
  if (normalizedCourseCode) params.push(`courseCode=${encodeURIComponent(normalizedCourseCode)}`);
  const qs = params.join('&');
  return qs ? `${baseUrl}/api/units-by-year-semester?${qs}` : `${baseUrl}/api/units-by-year-semester`;
};

export const fetchUnitsByYearSemester = async ({ courseId, courseCode } = {}) => {
  const isConnected = await hasInternetConnection();
  if (!isConnected) {
    throw new Error('No internet connection. Connect to the internet to load units.');
  }

  const baseUrl = resolveApiBaseUrl();
  const response = await fetch(buildUnitsEndpoint(baseUrl, courseId, courseCode), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch units: ${response.status}`);
  }

  const payload = await response.json();
  return toUnitsMap(payload);
};

/**
 * Fetch units assigned to a lecturer using the backend API and x-lecturer-id header.
 * @param {string} lecturerId
 * @returns {Promise<any>} Units JSON
 */
export const fetchLecturerUnits = async (lecturerId) => {
  const isConnected = await hasInternetConnection();
  if (!isConnected) {
    throw new Error('No internet connection. Connect to the internet to load units.');
  }
  // Import getLecturerSession lazily to avoid circular deps
  const { getLecturerSession } = require('./authSession');
  const session = await getLecturerSession();
  const response = await fetch(`${API_BASE_URL}/api/lecturer/units`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: session?.token ? `Bearer ${session.token}` : '',
      'x-lecturer-id': lecturerId,
    },
  });
  if (!response.ok) {
    throw new Error('Failed to fetch units');
  }
  return response.json();
};
