/**
 * Centralised notification service — wraps react-native-notify-kit.
 *
 * Custom sound setup (optional — 'default' works out of the box):
 *   Android → drop notification_chime.mp3 into android/app/src/main/res/raw/
 *             then change CUSTOM_SOUND_ANDROID to 'notification_chime'
 *   iOS     → add notification_chime.caf to Xcode bundle (Copy Bundle Resources)
 *             then change CUSTOM_SOUND_IOS to 'notification_chime.caf'
 */
import { Platform } from 'react-native';

// ─── Sound names ─────────────────────────────────────────────────────────────
// 'default' = device's own notification tone (works immediately, no file needed)
// To use a custom file: see header comment above
const CUSTOM_SOUND_ANDROID = 'default'; // e.g. 'notification_chime'
const CUSTOM_SOUND_IOS     = 'default'; // e.g. 'notification_chime.caf'

// ─── Channel IDs (exported so other modules can reference them) ───────────────
export const CHANNELS = {
  general:    'markwise_general',      // incoming FCM push for students
  lesson:     'markwise_lesson',       // lesson status updates
  reminder:   'markwise_reminder',     // pending-action reminders (lecturer)
  attendance: 'attendance_alerts',     // background BLE attendance marks
};

const CHANNEL_DEFS = [
  {
    id:          CHANNELS.general,
    name:        'General Notifications',
    description: 'Incoming MarkWise notifications',
    sound:       CUSTOM_SOUND_ANDROID,
  },
  {
    id:          CHANNELS.lesson,
    name:        'Lesson Updates',
    description: 'Lesson status updates from lecturers',
    sound:       CUSTOM_SOUND_ANDROID,
  },
  {
    id:          CHANNELS.reminder,
    name:        'Action Reminders',
    description: 'Lessons requiring status confirmation',
    sound:       CUSTOM_SOUND_ANDROID,
  },
  {
    id:          CHANNELS.attendance,
    name:        'Attendance Alerts',
    description: 'Background BLE attendance marking confirmations',
    sound:       CUSTOM_SOUND_ANDROID,
  },
];

// ─── Lazy-load so the app won't crash if native module isn't linked yet ───────
let _notifee = null;
let _AndroidImportance = null;

function loadNotifee() {
  if (!_notifee) {
    try {
      const mod = require('react-native-notify-kit');
      _notifee = mod.default;
      _AndroidImportance = mod.AndroidImportance;
    } catch (_) {}
  }
  return { notifee: _notifee, AndroidImportance: _AndroidImportance };
}

// ─── Type → channel routing ───────────────────────────────────────────────────
// Lesson-level events (timetable changes, meeting invites) → lesson channel
const LESSON_TYPES = new Set([
  'LESSON_CANCELLED', 'LESSON_RESCHEDULED', 'LESSON_ONLINE',
  'MERGED_LESSON', 'UNMERGED_LESSON', 'meeting_invite', 'timetable',
]);
// Pending-action reminders → reminder channel (higher urgency tone)
const REMINDER_TYPES = new Set(['status_reminder', 'reminder']);

/**
 * Returns the notification channel ID that should be used for a given FCM
 * message type so the correct sound and importance level play on Android.
 */
export function getChannelForType(type = '') {
  if (LESSON_TYPES.has(type))   return CHANNELS.lesson;
  if (REMINDER_TYPES.has(type)) return CHANNELS.reminder;
  return CHANNELS.general;
}

// ─── One-time setup — call once on app start (App.js) ────────────────────────
export async function setupNotificationChannels() {
  if (Platform.OS !== 'android') return;
  const { notifee, AndroidImportance } = loadNotifee();
  if (!notifee || !AndroidImportance) return;

  await Promise.all(
    CHANNEL_DEFS.map(ch =>
      notifee
        .createChannel({
          id:          ch.id,
          name:        ch.name,
          description: ch.description,
          sound:       ch.sound,
          importance:  AndroidImportance.HIGH,
          vibration:   true,
        })
        .catch(() => {})
    )
  );
}

// ─── Permission request — call after user signs in ───────────────────────────
export async function requestNotificationPermission() {
  const { notifee } = loadNotifee();
  if (!notifee) return;
  try {
    await notifee.requestPermission();
  } catch (_) {}
}

// ─── Display a local notification (heads-up banner + custom sound) ────────────
// channelId — use one of the CHANNELS constants
// data      — arbitrary key-value pairs (available when user taps the notification)
export async function displayLocalNotification({
  title,
  body,
  channelId = CHANNELS.general,
  data = {},
}) {
  const { notifee } = loadNotifee();
  if (!notifee) return;

  try {
    await notifee.displayNotification({
      title,
      body,
      data,
      android: {
        channelId,
        smallIcon:   'ic_launcher',
        pressAction: { id: 'default' },
      },
      ios: {
        sound: CUSTOM_SOUND_IOS,
      },
    });
  } catch (_) {}
}
