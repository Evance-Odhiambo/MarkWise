import { resolveApiBaseUrl } from './unitsApi';
import { getLecturerSession } from './authSession';

const authHeaders = async () => {
  const session = await getLecturerSession();
  return {
    'Content-Type': 'application/json',
    ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
  };
};

// POST /api/notifications/send
// Accepts either `message` or `body` as the notification text — screen uses `body`.
export async function sendNotification({ type, title, message, body, recipients, data }) {
  const session = await getLecturerSession();
  const baseUrl = resolveApiBaseUrl();
  const content = message ?? body;

  const res = await fetch(`${baseUrl}/api/notifications/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
    },
    body: JSON.stringify({ type, title, message: content, recipients, data }),
  });

  if (!res.ok) {
    const text = await res.text();
    let errorMsg;
    try {
      const parsed = JSON.parse(text);
      errorMsg = parsed?.error || parsed?.message;
    } catch (_) {
      errorMsg = text;
    }
    throw new Error(errorMsg || `Failed to send notification (${res.status})`);
  }

  return res.json();
}

// POST /api/notifications/schedule
export async function scheduleNotification({ type, title, message, body, recipients, data, scheduledFor }) {
  const baseUrl = resolveApiBaseUrl();
  const headers = await authHeaders();
  const content = message ?? body;

  const res = await fetch(`${baseUrl}/api/notifications/schedule`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ type, title, message: content, recipients, data, scheduledFor }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let errorMsg;
    try { errorMsg = JSON.parse(text)?.error || JSON.parse(text)?.message; } catch (_) { errorMsg = text; }
    throw new Error(errorMsg || `Failed to schedule notification (${res.status})`);
  }

  return res.json().catch(() => ({}));
}

// GET /api/notifications/analytics
// Returns { readRate, engagementRate, totalSent, totalDelivered, totalRead } or null on failure
export async function getNotificationAnalytics() {
  try {
    const baseUrl = resolveApiBaseUrl();
    const headers = await authHeaders();

    const res = await fetch(`${baseUrl}/api/notifications/analytics`, { headers });
    if (!res.ok) return null;
    return res.json().catch(() => null);
  } catch (_) {
    return null;
  }
}

// GET /api/notifications/admin
// Returns array of admin/system notifications sent to this lecturer
export async function fetchAdminNotifications() {
  try {
    const baseUrl = resolveApiBaseUrl();
    const headers = await authHeaders();

    const res = await fetch(`${baseUrl}/api/notifications/admin`, { headers });
    if (!res.ok) return [];
    const data = await res.json().catch(() => null);
    return Array.isArray(data) ? data : (Array.isArray(data?.notifications) ? data.notifications : []);
  } catch (_) {
    return [];
  }
}

// PATCH /api/notifications/admin/:id/read
export async function markAdminNotificationRead(id) {
  try {
    const baseUrl = resolveApiBaseUrl();
    const headers = await authHeaders();

    await fetch(`${baseUrl}/api/notifications/admin/${encodeURIComponent(id)}/read`, {
      method: 'PATCH',
      headers,
    });
  } catch (_) {
    // Non-critical — UI already reflects the read state optimistically
  }
}
