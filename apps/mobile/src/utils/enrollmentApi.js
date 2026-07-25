// src/utils/enrollmentApi.js
// Persists student unit enrollments to the backend and fetches them back.

import { API_BASE_URL } from './constants';
import { getStudentSession } from './authSession';

/**
 * Push the student's current enrolled units to the backend.
 * Called when the student presses Save on the UnitEnrollmentScreen.
 *
 * POST /api/student/enrollment
 * Body: { unitCodes: string[], unitNamesMap: Record<string,string>, year: string, semester: string }
 */
export const pushEnrollmentToBackend = async (unitCodes, unitNamesMap, year, semester) => {
  const session = await getStudentSession();
  if (!session?.token) throw new Error('Not signed in');

  const res = await fetch(`${API_BASE_URL}/api/student/enrollment`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      unitCodes: unitCodes ?? [],
      unitNamesMap: unitNamesMap ?? {},
      year: year ?? '1',
      semester: semester ?? '1',
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || `Failed to save enrollment (${res.status})`);
  }
  return data;
};

/**
 * Fetch the student's saved enrollment from the backend.
 * Used on app hydration so enrollments persist across reinstalls / devices.
 *
 * GET /api/student/enrollment
 * Returns: { unitCodes: string[], unitNamesMap: {}, year: string, semester: string }
 * Returns null on any failure so callers fall back to local SQLite data.
 */
export const fetchEnrollmentFromBackend = async () => {
  const session = await getStudentSession();
  if (!session?.token) return null;

  try {
    const res = await fetch(`${API_BASE_URL}/api/student/enrollment`, {
      headers: { Authorization: `Bearer ${session.token}` },
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    if (!data) return null;

    // Normalise: handle various field names the backend may use
    const rawCodes = data?.unitCodes ?? data?.enrolledUnits ?? data?.units ?? [];
    return {
      unitCodes: Array.isArray(rawCodes) ? rawCodes : [],
      unitNamesMap: data?.unitNamesMap ?? data?.namesMap ?? {},
      year: String(data?.year ?? data?.selectedYear ?? '1'),
      semester: String(data?.semester ?? data?.selectedSemester ?? '1'),
    };
  } catch (_) {
    return null;
  }
};
