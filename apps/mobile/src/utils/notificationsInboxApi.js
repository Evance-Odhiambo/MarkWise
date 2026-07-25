import { apiClient } from './apiClient';
import sqliteStorage from '../storage/sqliteStorage';

/**
 * Fetches up to 50 non-dismissed notifications from the backend and upserts
 * them into local SQLite. Called once on app init so AlertsScreen is populated
 * on any device the user logs into.
 *
 * savePushNotification uses INSERT OR IGNORE, so re-seeding on subsequent
 * launches never creates duplicates for notifications already in local SQLite.
 */
export async function seedNotificationInbox() {
    const response = await apiClient.get('/notifications/inbox', {
        params: { limit: 50 },
    });

    const notifications = response.data?.notifications ?? [];
    if (!notifications.length) return;

    await Promise.all(
        notifications.map(n =>
            sqliteStorage.savePushNotification({
                id:    n.id,
                type:  n.type,
                title: n.title,
                body:  n.body ?? null,
                data:  n.data ?? {},
            }).catch(() => {})
        )
    );
}

/**
 * Marks one or more notification IDs as dismissed on the backend so the
 * dismissal is reflected across all of the user's devices.
 *
 * Fire-and-forget — the local SQLite delete has already happened before this
 * is called, so network failure is non-fatal.
 */
export async function dismissNotificationsOnBackend(ids) {
    if (!Array.isArray(ids) || !ids.length) return;
    await apiClient.post('/notifications/dismiss', { ids });
}
