import { API_BASE_URL } from './constants';
import { getLecturerSession } from './authSession';
import { fetchMaterials } from './materialsApi';
import { getGroups } from './groupsApi';
import { fetchAssignments } from './assignmentsApiV2';
import { fetchMyLecturerTimetable } from './lecturerTimetableApi';

const formatTimeAgo = (iso) => {
  if (!iso) return '';
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 0) return '';
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
};

// Build stats locally by aggregating from existing endpoints.
// Also tries the dedicated backend route first — if it exists and returns 200 we use it,
// otherwise we fall back to aggregation so the screen never crashes.
export async function getDashboardStats(token) {
  // 1. Try dedicated endpoint (works once backend implements it)
  try {
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
    const res = await fetch(`${API_BASE_URL}/api/lecturer/dashboard/stats`, { headers });
    if (res.ok) {
      const payload = await res.json();
      const data = payload?.data ?? payload;
      return {
        groups:         data?.groups         ?? data?.groupCount      ?? 0,
        materials:      data?.materials      ?? data?.materialCount   ?? 0,
        assignments:    data?.assignments    ?? data?.assignmentCount ?? 0,
        pendingGrading: data?.pendingGrading ?? data?.pendingGrade    ?? 0,
        totalStudents:  data?.totalStudents  ?? data?.studentCount    ?? 0,
        activeCourses:  data?.activeCourses  ?? data?.courseCount     ?? 0,
        officeHours:    data?.officeHours    ?? 0,
      };
    }
  } catch (_) {
    // endpoint not yet available — fall through to aggregation
  }

  // 2. Aggregate from existing endpoints
  const session = await getLecturerSession();
  const authHeader = { Authorization: `Bearer ${session?.token}`, Accept: 'application/json' };

  let units = [];
  try {
    const res = await fetch(`${API_BASE_URL}/api/lecturer/units`, {
      headers: { ...authHeader, 'x-lecturer-id': String(session?.lecturerId || '') },
    });
    if (res.ok) {
      const data = await res.json();
      units = Array.isArray(data) ? data : (data?.units ?? []);
    }
  } catch (_) {}

  const unitCodes = units.map(u => u.unit_code || u.unitCode || u.code).filter(Boolean);
  const activeCourses = unitCodes.length;

  let materials = 0, groups = 0, totalStudents = 0;

  await Promise.all(unitCodes.map(async (code) => {
    try {
      const mats = await fetchMaterials(code);
      if (Array.isArray(mats)) materials += mats.length;
    } catch (_) {}

    try {
      const grps = await getGroups(code);
      if (Array.isArray(grps)) {
        groups += grps.length;
        grps.forEach(g => { totalStudents += g.members?.length ?? 0; });
      }
    } catch (_) {}
  }));

  // Assignments — use the assignments list endpoint if available
  let assignments = 0, pendingGrading = 0;
  try {
    const res = await fetch(`${API_BASE_URL}/lecturer/assignments`, { headers: authHeader });
    if (res.ok) {
      const list = await res.json();
      const arr = Array.isArray(list) ? list : (list?.data ?? []);
      assignments = arr.length;
      pendingGrading = arr.filter(a => a.pendingGrading || a.submissionsToGrade > 0).length;
    }
  } catch (_) {}

  return { groups, materials, assignments, pendingGrading, totalStudents, activeCourses, officeHours: 0 };
}

export async function getRecentActivity(token) {
  // 1. Try dedicated endpoint
  try {
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
    const res = await fetch(`${API_BASE_URL}/api/lecturer/dashboard/activity`, { headers });
    if (res.ok) {
      const payload = await res.json();
      return Array.isArray(payload) ? payload : (payload?.data ?? payload?.activity ?? []);
    }
  } catch (_) {}

  // 2. Aggregate real activity from assignments, materials, and groups
  const items = [];
  try {
    const session = await getLecturerSession();
    const entries = await fetchMyLecturerTimetable(session?.token).catch(() => []);
    const unitCodes = [
      ...new Set(
        (Array.isArray(entries) ? entries : [])
          .map(e => String(e?.unitCode || e?.code || '').trim())
          .filter(Boolean),
      ),
    ];

    await Promise.all(unitCodes.map(async (code) => {
      // Assignments with pending grading
      try {
        const raw = await fetchAssignments(code);
        const arr = Array.isArray(raw) ? raw : (raw?.data ?? raw?.assignments ?? []);
        arr.forEach((a) => {
          const pending = Number(a.pendingCount ?? a.submissionsToGrade ?? a.pending ?? 0);
          const total   = Number(a.submissionCount ?? a.totalSubmissions ?? a.submitted ?? 0);
          const ts      = a.updatedAt || a.lastSubmittedAt || a.createdAt || '';
          if (pending > 0) {
            items.push({
              id: `assign-pending-${a._id ?? a.id ?? a.assignmentId}`,
              type: 'submission',
              title: 'Pending Review',
              description: `${pending} submission${pending !== 1 ? 's' : ''} to grade – "${a.title || 'Assignment'}" (${code})`,
              time: formatTimeAgo(ts),
              badge: String(pending),
              _ts: ts,
            });
          } else if (total > 0) {
            items.push({
              id: `assign-sub-${a._id ?? a.id ?? a.assignmentId}`,
              type: 'submission',
              title: a.title || 'Assignment',
              description: `${total} submission${total !== 1 ? 's' : ''} received for ${code}`,
              time: formatTimeAgo(ts),
              badge: String(total),
              _ts: ts,
            });
          }
        });
      } catch (_) {}

      // Recently uploaded materials
      try {
        const raw = await fetchMaterials(code);
        const arr = Array.isArray(raw) ? raw : (raw?.materials ?? raw?.data ?? []);
        arr.slice(0, 2).forEach((m) => {
          const ts = m.createdAt || m.uploadedAt || m.updatedAt || '';
          items.push({
            id: `mat-${m._id ?? m.id ?? m.materialId}-${code}`,
            type: 'material',
            title: m.title || 'Material',
            description: `"${m.title || 'A resource'}" shared for ${code}`,
            time: formatTimeAgo(ts),
            badge: m.type ?? null,
            _ts: ts,
          });
        });
      } catch (_) {}

      // Active groups
      try {
        const raw = await getGroups(code);
        const arr = Array.isArray(raw) ? raw : (raw?.groups ?? raw?.data ?? []);
        if (arr.length > 0) {
          const ts = arr[0]?.createdAt || arr[0]?.updatedAt || '';
          items.push({
            id: `group-${code}`,
            type: 'group',
            title: 'Study Groups',
            description: `${arr.length} group${arr.length !== 1 ? 's' : ''} active in ${code}`,
            time: formatTimeAgo(ts),
            badge: String(arr.length),
            _ts: ts,
          });
        }
      } catch (_) {}
    }));
  } catch (_) {}

  return items
    .sort((a, b) => new Date(b._ts || 0) - new Date(a._ts || 0))
    .slice(0, 8)
    .map(({ _ts, ...item }) => item);
}