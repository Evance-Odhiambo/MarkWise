// src/utils/studentAttendanceApi.js
// Student-side attendance data API helpers.
import { resolveApiBaseUrl } from './unitsApi';
import { getStudentSession } from './authSession';

/**
 * Fetch per-unit attendance summary from the backend.
 * Returns an array of { unitCode, attended, conducted } objects.
 * Returns [] on network failure or when the endpoint does not exist yet.
 *
 * Backend endpoint: GET /api/student/attendance-summary
 * Expected response:
 *   [{ unitCode: string, attended: number, conducted: number }]
 *   OR { summary: [...] }
 */
export async function fetchStudentAttendanceSummary() {
  try {
    const session = await getStudentSession();
    if (!session?.token) return [];

    const baseUrl = resolveApiBaseUrl();
    const res = await fetch(`${baseUrl}/api/student/attendance-summary`, {
      headers: { Authorization: `Bearer ${session.token}` },
    });

    if (!res.ok) return [];

    const data = await res.json().catch(() => null);
    if (!data) return [];

    const rows = Array.isArray(data) ? data : (Array.isArray(data?.summary) ? data.summary : []);
    return rows.filter(r => r && (r.unitCode || r.unit_code)).map(r => ({
      unitCode: r.unitCode ?? r.unit_code ?? '',
      attended: Number(r.attended ?? r.attendedCount ?? 0),
      conducted: Number(r.conducted ?? r.conductedCount ?? 0),
    }));
  } catch {
    return [];
  }
}
