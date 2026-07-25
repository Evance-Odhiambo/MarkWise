
import colors from '../theme/colors';

const C = {
  primary:     colors.primary.main,
  purple:      colors.purple.main,
  success:     colors.success.main,
  danger:      colors.danger.main,
  warning:     colors.warning.main,
  info:        colors.info.main,
  pink:        colors.pink.main,
};

// ── Lesson types ────────────────────────────────────────────────────────────
// id (0-based) is encoded as byte 8 in the 10-byte BLE packet.
// Keep the order stable — never re-order existing entries.
// mcIcon = MaterialCommunityIcons name (used in timetable screens)
// aliases = additional full-name strings the backend timetable may return
export const LESSON_TYPES = [
  { id: 0, code: 'LEC', label: 'Lecture',                    icon: 'school-outline',        mcIcon: 'school',           color: C.primary, aliases: ['lecture', 'lec'] },
  { id: 1, code: 'GRD',  label: 'Group Discussion',           icon: 'people-outline',        mcIcon: 'account-group',    color: C.success, aliases: ['group discussion', 'group', 'gd'] },
  { id: 2, code: 'RAT', label: 'Random Assessment Test',     icon: 'shuffle-outline',       mcIcon: 'shuffle-variant',  color: C.warning, aliases: ['random assessment test', 'rat'] },
  { id: 3, code: 'CAT', label: 'Continuous Assessment Test', icon: 'document-text-outline', mcIcon: 'file-document',    color: C.danger, aliases: ['continuous assessment test', 'continuous assessment', 'cat', 'exam', 'test'] },
  { id: 4, code: 'LAB', label: 'Practical / Lab',            icon: 'flask-outline',         mcIcon: 'flask',            color: C.info, aliases: ['practical', 'lab', 'practical / lab'] },
  { id: 5, code: 'SEM', label: 'Seminar',                    icon: 'mic-outline',           mcIcon: 'presentation',     color: C.purple, aliases: ['seminar', 'sem'] },
  { id: 6, code: 'WRK', label: 'Workshop',                   icon: 'construct-outline',     mcIcon: 'hammer-wrench',    color: C.pink, aliases: ['workshop', 'wrk'] },
  { id: 7, code: 'TUT', label: 'Tutorial',                   icon: 'book-outline',          mcIcon: 'book-open-variant',color: '#06B6D4', aliases: ['tutorial', 'tut'] },
  { id: 8, code: 'PRE', label: 'Presentation',               icon: 'easel-outline',         mcIcon: 'presentation',     color: '#F97316', aliases: ['presentation', 'pre', 'present'] },
];

// Helper: look up a LESSON_TYPES entry by numeric id, falling back to Lecture.
export const getLessonType = (id) =>
  LESSON_TYPES.find((t) => t.id === id) ?? LESSON_TYPES[0];

// Helper: look up a LESSON_TYPES entry by short code or full label/alias string.
// Case-insensitive. Returns the Lecture entry as fallback.
export const getLessonTypeByName = (nameOrCode) => {
  if (nameOrCode == null) return LESSON_TYPES[0];
  const key = String(nameOrCode).trim().toLowerCase();
  return (
    LESSON_TYPES.find((t) => t.code.toLowerCase() === key) ??
    LESSON_TYPES.find((t) => t.label.toLowerCase() === key) ??
    LESSON_TYPES.find((t) => t.aliases.includes(key)) ??
    LESSON_TYPES[0]
  );
};

// Shared timing constants for QR rotation and timestamp tolerance
export const QR_ROTATION_MS = 3000; // QR rotates every 3 seconds
export const TIMESTAMP_TOLERANCE_MS = 3000; // Accept timestamps within ±3 seconds
export const MANUAL_TOKEN_ROTATION_MS = 30000; // Manual token rotates every 30 seconds

// Default attendance session duration (10 minutes)
export const SESSION_DURATION_MS = 10 * 60 * 1000;

// GD session duration — how long a student's scanner accepts a GD BLE packet after
// the leader pressed Start. The delegation window is day-scoped (leader can start any
// time), but once started the attendance marking window closes after 10 minutes.
export const GD_SESSION_DURATION_MS = 10 * 60 * 1000;

// Probabilistic BLE relay selection — controls automatic coverage extension
// A device is elected relay if: Math.random() < rssiNorm * (RELAY_TARGET_COUNT / roomSize)
export const RELAY_TARGET_COUNT = 8;  // expected number of relay nodes per session
export const RELAY_RSSI_MIN = -90;    // dBm: lower bound (barely receivable)
export const RELAY_RSSI_MAX = -50;    // dBm: upper bound (strong, close to lecturer)
export const RELAY_STAGGER_MS = 150;  // max random delay before relay starts advertising (de-syncs collisions)

// HTTP sync jitter — spreads backend sync calls across this window to prevent stampede
// when many students mark attendance simultaneously (e.g. 1000-seat lecture)
export const SYNC_JITTER_MS = 30000; // 30 seconds → ~33 req/sec instead of 1000 req/sec spike

// Online attendance session duration — how long the /attend link stays open
// Change this value to control the marking window for online sessions
export const ONLINE_SESSION_DURATION_MS = 10 * 60 * 1000; // 10 minutes

// Backend URL. For local development on physical device, change to your machine's LAN IP:
//   e.g. 'http://192.168.x.x:3000'
// For Android emulator use: 'http://10.0.2.2:3000'
// For iOS simulator use: 'http://localhost:3000'
// To support per-environment overrides, install react-native-config and configure .env files.
export const API_BASE_URL = 'http://192.168.0.100:3000';

/**
 * Canonical unit code normalizer used across the entire app.
 * Strips all non-alphanumeric characters and uppercases.
 * e.g. "SCH 2170" → "SCH2170", "sch2170 " → "SCH2170"
 */
export const normalizeUnitCode = (value) =>
  String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export default {
  LESSON_TYPES,
  getLessonType,
  getLessonTypeByName,
  normalizeUnitCode,
  QR_ROTATION_MS,
  TIMESTAMP_TOLERANCE_MS,
  MANUAL_TOKEN_ROTATION_MS,
  SESSION_DURATION_MS,
  GD_SESSION_DURATION_MS,
  ONLINE_SESSION_DURATION_MS,
  API_BASE_URL,
  RELAY_TARGET_COUNT,
  RELAY_RSSI_MIN,
  RELAY_RSSI_MAX,
  RELAY_STAGGER_MS,
  SYNC_JITTER_MS,
};
