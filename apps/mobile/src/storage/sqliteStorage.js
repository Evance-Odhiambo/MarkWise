// src/storage/sqliteStorage.js
// Async SQLite helpers
export const runAsync = async (sql, params = []) => {
  const db = await getDatabase();
  if (!db) throw new Error('SQLite database is unavailable');
  return db.executeSql(sql, params);
};

export const getAllAsync = async (sql, params = []) => {
  const db = await getDatabase();
  if (!db) throw new Error('SQLite database is unavailable');
  const [result] = await db.executeSql(sql, params);
  const rows = [];
  for (let i = 0; i < result.rows.length; i++) {
    rows.push(result.rows.item(i));
  }
  return rows;
};

export const getFirstAsync = async (sql, params = []) => {
  const db = await getDatabase();
  if (!db) throw new Error('SQLite database is unavailable');
  const [result] = await db.executeSql(sql, params);
  if (result.rows.length > 0) {
    return result.rows.item(0);
  }
  return null;
};

export const execAsync = async (sql) => {
  const db = await getDatabase();
  if (!db) throw new Error('SQLite database is unavailable');
  return db.executeSql(sql);
};

import { getStudentSession, subscribeAuthSessionChanges } from '../utils/authSession';

// Cache the resolved student scope key so we don't hit the native Keychain
// on every database operation. Cleared whenever the session changes.
let _cachedStudentScopeKey = null;
subscribeAuthSessionChanges(() => {
  _cachedStudentScopeKey = null;
});

let SQLite = null;

try {
  const sqliteModule = require('react-native-sqlite-storage');
  SQLite = sqliteModule?.default || sqliteModule;
} catch (error) {
  SQLite = null;
}

const TABLES_SQL = [
  `CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT
  );`,
  `CREATE TABLE IF NOT EXISTS enrolled_units (
    student_key TEXT NOT NULL,
    unit TEXT NOT NULL,
    PRIMARY KEY(student_key, unit)
  );`,
  `CREATE TABLE IF NOT EXISTS attendance_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_key TEXT NOT NULL,
    unit_code TEXT NOT NULL,
    lecture_room TEXT NOT NULL,
    session_start INTEGER NOT NULL,
    scanned_at INTEGER NOT NULL,
    raw_payload TEXT,
    lesson_type TEXT
  );`,
  `CREATE TABLE IF NOT EXISTS conducted_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    unit_code TEXT NOT NULL,
    lecture_room TEXT NOT NULL,
    session_start INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    lesson_type TEXT,
    UNIQUE(unit_code, lecture_room, session_start)
  );`,
  `CREATE TABLE IF NOT EXISTS unit_attendance_goals (
    student_key TEXT NOT NULL,
    unit_code TEXT PRIMARY KEY NOT NULL,
    target_percent INTEGER NOT NULL,
    reminder_enabled INTEGER NOT NULL DEFAULT 0,
    reminder_days TEXT,
    reminder_time TEXT,
    updated_at INTEGER NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS shared_materials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    unit_code TEXT NOT NULL,
    link_url TEXT,
    uploader_role TEXT NOT NULL,
    uploader_name TEXT,
    created_at INTEGER NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS delegations (
    id TEXT PRIMARY KEY NOT NULL,
    unit_code TEXT NOT NULL,
    unit_id INTEGER NOT NULL,
    room_code TEXT NOT NULL,
    room_id INTEGER NOT NULL,
    group_id TEXT NOT NULL,
    group_number INTEGER NOT NULL,
    group_name TEXT,
    valid_from INTEGER NOT NULL,
    valid_until INTEGER NOT NULL,
    session_token TEXT,
    leader_student_id TEXT,
    used INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS push_notifications (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    data TEXT,
    read INTEGER NOT NULL DEFAULT 0,
    received_at INTEGER NOT NULL
  );`,
  // Lecturer-side: enrolled student roster cached per unit for offline manual mark lookup
  `CREATE TABLE IF NOT EXISTS unit_student_roster (
    unit_code TEXT NOT NULL,
    institution_id TEXT NOT NULL,
    student_id TEXT NOT NULL,
    student_name TEXT NOT NULL,
    admission_number TEXT NOT NULL,
    cached_at INTEGER NOT NULL,
    PRIMARY KEY (unit_code, student_id)
  );`,
  // Lecturer-side: roster cache metadata (last update time, student count)
  `CREATE TABLE IF NOT EXISTS roster_cache_meta (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    unit_code TEXT NOT NULL,
    institution_id TEXT NOT NULL,
    last_updated INTEGER NOT NULL,
    student_count INTEGER NOT NULL,
    unit_display TEXT,
    UNIQUE(unit_code, institution_id)
  );`,
  // Lecturer-side: offline manual attendance marks queued for later sync
  `CREATE TABLE IF NOT EXISTS pending_manual_marks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admission_number TEXT NOT NULL,
    student_id TEXT NOT NULL,
    unit_code TEXT NOT NULL,
    lecture_room TEXT NOT NULL,
    session_start INTEGER NOT NULL,
    lecturer_id TEXT NOT NULL,
    marked_at INTEGER NOT NULL,
    synced INTEGER NOT NULL DEFAULT 0,
    sync_attempts INTEGER NOT NULL DEFAULT 0
  );`,
  // pending_proxy_marks — offline queue for group-leader proxy attendance marks
  `CREATE TABLE IF NOT EXISTS pending_proxy_marks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    delegation_id TEXT NOT NULL,
    session_token TEXT NOT NULL,
    target_student_id TEXT NOT NULL,
    target_admission_number TEXT NOT NULL,
    unit_code TEXT NOT NULL,
    lecture_room TEXT NOT NULL,
    session_start INTEGER NOT NULL,
    marked_at INTEGER NOT NULL,
    synced INTEGER NOT NULL DEFAULT 0,
    sync_attempts INTEGER NOT NULL DEFAULT 0
  );`,
  // pending_session_ends — offline queue for endDelegatedSession calls
  `CREATE TABLE IF NOT EXISTS pending_session_ends (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    delegation_id TEXT NOT NULL UNIQUE,
    session_token TEXT NOT NULL,
    unit_code TEXT NOT NULL,
    room_code TEXT NOT NULL,
    session_start INTEGER NOT NULL,
    session_end INTEGER NOT NULL,
    synced INTEGER NOT NULL DEFAULT 0,
    sync_attempts INTEGER NOT NULL DEFAULT 0
  );`,
];

const SETTINGS_KEYS = {
  ENROLLMENT_STATE: 'student_enrollment_state',
  ATTENDANCE_GOALS: 'student_attendance_goals',
  ATTENDANCE_DEVICE_ID: 'attendance_device_id',
  ATTENDANCE_SUMMARY_CACHE: 'student_attendance_summary_cache',
  CONDUCTED_COUNTS_CACHE: 'student_conducted_counts_cache',
  TIMETABLE_CACHE: 'student_timetable_cache',
  ASSIGNMENTS_CACHE: 'student_assignments_cache',
  SENT_NOTIFICATIONS: 'lecturer_sent_notifications',
  NOTIFICATION_TEMPLATES: 'lecturer_notification_templates',
};

const DEFAULT_STUDENT_SCOPE = 'student:guest';

let _db = null;
let _isInitialized = false;
let _forceMemoryFallback = false;

const memoryStore = {
  attendanceDeviceId: null,
  enrollmentByStudent: {},
  attendanceByStudent: {},
  conductedSessions: [],
  attendanceGoalsByStudent: {},
  sharedMaterials: [],
};

const buildSessionKey = (unitCode, lectureRoom, sessionStart) =>
  `${String(unitCode).toUpperCase()}|${String(lectureRoom).toUpperCase()}|${Number(sessionStart)}`;

/**
 * Checks if any attendance record exists for this session (unit, room, sessionStart) for the current student.
 * Ignores deviceId, so blocks all methods.
 */
const hasAttendanceForSession = async ({ unitCode, lectureRoom, sessionStart }) => {
  const studentKey = await resolveStudentScopeKey();
  if (!isSQLiteAvailable()) {
    const attendance = getMemoryAttendance(studentKey);
    return attendance.some(
      (record) =>
        String(record.unitCode).toUpperCase() === String(unitCode).toUpperCase() &&
        String(record.lectureRoom).toUpperCase() === String(lectureRoom).toUpperCase() &&
        Number(record.sessionStart) === Number(sessionStart)
    );
  }
  try {
    const existing = await getFirstAsync(
      `SELECT id FROM attendance_records WHERE student_key = ? AND unit_code = ? AND lecture_room = ? AND session_start = ? LIMIT 1;`,
      [studentKey, String(unitCode).toUpperCase(), String(lectureRoom).toUpperCase(), Number(sessionStart)]
    );
    return !!existing;
  } catch (error) {
    enableMemoryFallback(error);
    const attendance = getMemoryAttendance(studentKey);
    return attendance.some(
      (record) =>
        String(record.unitCode).toUpperCase() === String(unitCode).toUpperCase() &&
        String(record.lectureRoom).toUpperCase() === String(lectureRoom).toUpperCase() &&
        Number(record.sessionStart) === Number(sessionStart)
    );
  }
};

const buildAttendanceDeviceSessionKey = (unitCode, lectureRoom, sessionStart, deviceId) =>
  `${String(unitCode).toUpperCase()}|${String(lectureRoom).toUpperCase()}|${Number(sessionStart)}|${String(deviceId || '')}`;

const isDuplicateColumnError = (error) => /duplicate column name/i.test(String(error?.message || error));

const normalizeScopePart = (value, fallbackValue) => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9@._-]/g, '_');
  return normalized || fallbackValue;
};

const resolveStudentScopeKey = async () => {
  if (_cachedStudentScopeKey) return _cachedStudentScopeKey;
  try {
    const session = await getStudentSession();
    const admissionNumber = normalizeScopePart(session?.admissionNumber, '');
    if (admissionNumber) {
      _cachedStudentScopeKey = `adm:${admissionNumber}`;
      return _cachedStudentScopeKey;
    }

    const email = normalizeScopePart(session?.studentEmail, '');
    if (email) {
      _cachedStudentScopeKey = `email:${email}`;
      return _cachedStudentScopeKey;
    }
  } catch (error) {
    console.error('Failed to resolve student storage scope', error);
  }

  return DEFAULT_STUDENT_SCOPE;
};

const buildScopedSettingsKey = (baseKey, studentKey) => `${baseKey}:${studentKey}`;

const getMemoryEnrollmentState = (studentKey) => {
  const existing = memoryStore.enrollmentByStudent[studentKey];
  if (existing) {
    return existing;
  }

  const created = {
    selectedYear: '1',
    selectedSemester: '1',
    enrolledUnits: [],
  };
  memoryStore.enrollmentByStudent[studentKey] = created;
  return created;
};

const getMemoryAttendance = (studentKey) => {
  if (!Array.isArray(memoryStore.attendanceByStudent[studentKey])) {
    memoryStore.attendanceByStudent[studentKey] = [];
  }
  return memoryStore.attendanceByStudent[studentKey];
};

const getMemoryAttendanceGoals = (studentKey) => {
  const existing = memoryStore.attendanceGoalsByStudent[studentKey];
  if (existing && typeof existing === 'object') {
    return existing;
  }
  const created = {};
  memoryStore.attendanceGoalsByStudent[studentKey] = created;
  return created;
};

const generateDeviceId = () => {
  const seed = `${Date.now()}-${Math.random()}-${Math.random()}`;
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `MWD-${Date.now().toString(36).toUpperCase()}-${hash.toString(36).toUpperCase()}`;
};

const ensureAttendanceSchema = async () => {
  try {
    await executeSql('ALTER TABLE attendance_records ADD COLUMN device_id TEXT;');
  } catch (error) {
    if (!isDuplicateColumnError(error)) {
      throw error;
    }
  }

  try {
    await executeSql(`ALTER TABLE attendance_records ADD COLUMN student_key TEXT NOT NULL DEFAULT '${DEFAULT_STUDENT_SCOPE}';`);
  } catch (error) {
    if (!isDuplicateColumnError(error)) {
      throw error;
    }
  }

  await executeSql(
    `UPDATE attendance_records
     SET student_key = '${DEFAULT_STUDENT_SCOPE}'
     WHERE student_key IS NULL OR TRIM(student_key) = '';`,
  );

  await executeSql(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_device_session ON attendance_records (student_key, unit_code, lecture_room, session_start, device_id);',
  );

  // Session-level dedup: one record per student per session regardless of device_id.
  // Matches the semantics of hasAttendanceForSession (which also ignores device_id).
  await executeSql(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_session_dedup ON attendance_records (student_key, unit_code, lecture_room, session_start);',
  );

  try {
    await executeSql('ALTER TABLE attendance_records ADD COLUMN synced INTEGER NOT NULL DEFAULT 0;');
  } catch (error) {
    if (!isDuplicateColumnError(error)) {
      throw error;
    }
  }

  try {
    await executeSql('ALTER TABLE attendance_records ADD COLUMN sync_attempts INTEGER NOT NULL DEFAULT 0;');
  } catch (error) {
    if (!isDuplicateColumnError(error)) {
      throw error;
    }
  }

  // lesson_type migration — added when lesson type feature was introduced
  try {
    await executeSql('ALTER TABLE attendance_records ADD COLUMN lesson_type TEXT;');
  } catch (error) {
    if (!isDuplicateColumnError(error)) { throw error; }
  }
  try {
    await executeSql('ALTER TABLE conducted_sessions ADD COLUMN lesson_type TEXT;');
  } catch (error) {
    if (!isDuplicateColumnError(error)) { throw error; }
  }

  // One-time migration: recreate delegations table so group_id is TEXT (was incorrectly INTEGER).
  // Uses a PRAGMA column-type check as the guard instead of a settings flag so it is idempotent
  // across hot-reloads that skip the app_settings flag check.
  try {
    const cols = await getAllAsync('PRAGMA table_info(delegations)', []);
    const groupIdCol = cols.find((c) => c.name === 'group_id');
    if (groupIdCol && String(groupIdCol.type).toUpperCase() === 'INTEGER') {
      await executeSql('DROP TABLE IF EXISTS delegations;');
    }
    // Also set the app_settings flag so legacy code paths stay silent.
    await executeSql(
      'INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)',
      ['db_migration_delegation_group_id_text_v1', '1'],
    );
  } catch (_) {}

  // delegations table — group_id is TEXT to support UUID/string group IDs
  await executeSql(`CREATE TABLE IF NOT EXISTS delegations (
    id TEXT PRIMARY KEY NOT NULL,
    unit_code TEXT NOT NULL,
    unit_id INTEGER NOT NULL,
    room_code TEXT NOT NULL,
    room_id INTEGER NOT NULL,
    group_id TEXT NOT NULL,
    group_number INTEGER NOT NULL,
    group_name TEXT,
    valid_from INTEGER NOT NULL,
    valid_until INTEGER NOT NULL,
    session_token TEXT,
    leader_student_id TEXT,
    used INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );`);

  // Add leader_student_id for existing installations that predate this column
  try {
    await executeSql('ALTER TABLE delegations ADD COLUMN leader_student_id TEXT');
  } catch (e) {
    if (!isDuplicateColumnError(e)) { throw e; }
  }

  // push_notifications table — stores FCM messages for AlertsScreen
  await executeSql(`CREATE TABLE IF NOT EXISTS push_notifications (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    data TEXT,
    read INTEGER NOT NULL DEFAULT 0,
    received_at INTEGER NOT NULL
  );`);

  // unit_student_roster — lecturer-side roster cache for offline manual mark lookup
  await executeSql(`CREATE TABLE IF NOT EXISTS unit_student_roster (
    unit_code TEXT NOT NULL,
    institution_id TEXT NOT NULL,
    student_id TEXT NOT NULL,
    student_name TEXT NOT NULL,
    admission_number TEXT NOT NULL,
    cached_at INTEGER NOT NULL,
    PRIMARY KEY (unit_code, student_id)
  );`);

  // roster_cache_meta — metadata for roster cache
  await executeSql(`CREATE TABLE IF NOT EXISTS roster_cache_meta (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    unit_code TEXT NOT NULL,
    institution_id TEXT NOT NULL,
    last_updated INTEGER NOT NULL,
    student_count INTEGER NOT NULL,
    unit_display TEXT,
    UNIQUE(unit_code, institution_id)
  );`);

  // pending_manual_marks — offline queue for manual attendance marks
  await executeSql(`CREATE TABLE IF NOT EXISTS pending_manual_marks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admission_number TEXT NOT NULL,
    student_id TEXT NOT NULL,
    unit_code TEXT NOT NULL,
    lecture_room TEXT NOT NULL,
    session_start INTEGER NOT NULL,
    lecturer_id TEXT NOT NULL,
    marked_at INTEGER NOT NULL,
    synced INTEGER NOT NULL DEFAULT 0,
    sync_attempts INTEGER NOT NULL DEFAULT 0
  );`);

  // pending_proxy_marks — offline queue for group-leader proxy attendance marks
  await executeSql(`CREATE TABLE IF NOT EXISTS pending_proxy_marks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    delegation_id TEXT NOT NULL,
    session_token TEXT NOT NULL,
    target_student_id TEXT NOT NULL,
    target_admission_number TEXT NOT NULL,
    unit_code TEXT NOT NULL,
    lecture_room TEXT NOT NULL,
    session_start INTEGER NOT NULL,
    marked_at INTEGER NOT NULL,
    synced INTEGER NOT NULL DEFAULT 0,
    sync_attempts INTEGER NOT NULL DEFAULT 0
  );`);

  // pending_session_ends — offline queue for endDelegatedSession calls
  await executeSql(`CREATE TABLE IF NOT EXISTS pending_session_ends (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    delegation_id TEXT NOT NULL UNIQUE,
    session_token TEXT NOT NULL,
    unit_code TEXT NOT NULL,
    room_code TEXT NOT NULL,
    session_start INTEGER NOT NULL,
    session_end INTEGER NOT NULL,
    synced INTEGER NOT NULL DEFAULT 0,
    sync_attempts INTEGER NOT NULL DEFAULT 0
  );`);

  // Add sync_attempts to pending_manual_marks and pending_session_ends for existing installs
  try {
    await executeSql('ALTER TABLE pending_manual_marks ADD COLUMN sync_attempts INTEGER NOT NULL DEFAULT 0;');
  } catch (error) {
    if (!isDuplicateColumnError(error)) { throw error; }
  }
  try {
    await executeSql('ALTER TABLE pending_session_ends ADD COLUMN sync_attempts INTEGER NOT NULL DEFAULT 0;');
  } catch (error) {
    if (!isDuplicateColumnError(error)) { throw error; }
  }
};

const enableMemoryFallback = (error) => {
  _forceMemoryFallback = true;
  _db = null;
  console.warn('[SQLite] Enabling memory fallback. SQLite unavailable.', error);
};

const isSQLiteAvailable = () => {
  const available = !!SQLite && !_forceMemoryFallback;
  if (!available) {
    console.warn('[SQLite] isSQLiteAvailable: false', { SQLite, _forceMemoryFallback });
  }
  return available;
};

const executeSql = async (sql, params = []) => {
  const db = await getDatabase();
  if (!db) {
    console.error('[SQLite] executeSql: Database unavailable. SQL:', sql);
    throw new Error('SQLite database is unavailable');
  }
  return db.executeSql(sql, params);
};

const getDatabase = async () => {
  if (!isSQLiteAvailable()) {
    return null;
  }

  if (_db) {
    return _db;
  }

  try {
    SQLite.enablePromise(true);
    _db = await SQLite.openDatabase({
      name: 'markwise.db',
      location: 'default',
    });
    return _db;
  } catch (error) {
    enableMemoryFallback(error);
    return null;
  }
};

const initDatabase = async () => {
  if (_isInitialized) {
    return;
  }

  if (!isSQLiteAvailable()) {
    _isInitialized = true;
    return;
  }

  try {
    for (const statement of TABLES_SQL) {
      await executeSql(statement);
    }
    await ensureAttendanceSchema();
  } catch (error) {
    enableMemoryFallback(error);
  }

  _isInitialized = true;
};

const upsertSetting = async (key, value) => {
  await executeSql(
    'INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?);',
    [key, value],
  );
};

const getSetting = async (key, fallbackValue = null) => {
  const [result] = await executeSql('SELECT value FROM app_settings WHERE key = ? LIMIT 1;', [key]);
  if (!result.rows.length) {
    return fallbackValue;
  }
  return result.rows.item(0).value;
};

const saveEnrollmentState = async ({ selectedYear, selectedSemester, enrolledUnits, unitNamesMap }) => {
  await initDatabase();
  const studentKey = await resolveStudentScopeKey();

  const safeYear = selectedYear == null ? '1' : String(selectedYear);
  const safeSemester = selectedSemester == null ? '1' : String(selectedSemester);
  // Normalize all unit codes on write: handle legacy "NAME(CODE)" format, collapse spaces, uppercase.
  // Normalizing here (once, on save) means reads never need to do this work.
  const safeUnits = Array.isArray(enrolledUnits)
    ? [...new Set(enrolledUnits.map(unit => {
        if (typeof unit !== 'string') return null;
        const s = unit.trim();
        const match = s.match(/\(([^)]+)\)/);
        return match
          ? match[1].replace(/\s+/g, ' ').trim().toUpperCase()
          : s.replace(/\s+/g, ' ').trim().toUpperCase();
      }).filter(Boolean))]
    : [];
  const safeNamesMap = (unitNamesMap && typeof unitNamesMap === 'object') ? unitNamesMap : {};
  const statePayload = JSON.stringify({
    selectedYear: safeYear,
    selectedSemester: safeSemester,
    enrolledUnits: safeUnits,
    unitNamesMap: safeNamesMap,
  });

  if (!isSQLiteAvailable()) {
    const studentState = getMemoryEnrollmentState(studentKey);
    studentState.selectedYear = safeYear;
    studentState.selectedSemester = safeSemester;
    studentState.enrolledUnits = safeUnits;
    studentState.unitNamesMap = safeNamesMap;
    return;
  }

  try {
    await upsertSetting(buildScopedSettingsKey(SETTINGS_KEYS.ENROLLMENT_STATE, studentKey), statePayload);
  } catch (error) {
    enableMemoryFallback(error);
    const studentState = getMemoryEnrollmentState(studentKey);
    studentState.selectedYear = safeYear;
    studentState.selectedSemester = safeSemester;
    studentState.enrolledUnits = safeUnits;
    studentState.unitNamesMap = safeNamesMap;
  }
};

const getEnrollmentState = async () => {
  await initDatabase();
  const studentKey = await resolveStudentScopeKey();

  if (!isSQLiteAvailable()) {
    const studentState = getMemoryEnrollmentState(studentKey);
    return {
      selectedYear: studentState.selectedYear,
      selectedSemester: studentState.selectedSemester,
      enrolledUnits: [...studentState.enrolledUnits],
      unitNamesMap: studentState.unitNamesMap || {},
    };
  }

  try {
    const raw = await getSetting(buildScopedSettingsKey(SETTINGS_KEYS.ENROLLMENT_STATE, studentKey), null);
    if (!raw) {
      return {
        selectedYear: '1',
        selectedSemester: '1',
        enrolledUnits: [],
        unitNamesMap: {},
      };
    }

    const parsed = JSON.parse(raw);
    // Unit codes are normalized on write; just validate types here.
    // Keep the legacy "NAME(CODE)" extraction as a one-time migration safety net
    // for data written by older app versions that didn't normalize on save.
    const enrolledUnits = Array.isArray(parsed?.enrolledUnits)
      ? [...new Set(parsed.enrolledUnits
          .map((unit) => {
            if (typeof unit !== 'string') return null;
            const s = unit.trim();
            const match = s.match(/\(([^)]+)\)/);
            return match
              ? match[1].replace(/\s+/g, ' ').trim().toUpperCase()
              : s.replace(/\s+/g, ' ').trim().toUpperCase();
          })
          .filter(Boolean))]
      : [];

    const unitNamesMap = (parsed?.unitNamesMap && typeof parsed.unitNamesMap === 'object')
      ? parsed.unitNamesMap
      : {};

    return {
      selectedYear: String(parsed?.selectedYear || '1'),
      selectedSemester: String(parsed?.selectedSemester || '1'),
      enrolledUnits,
      unitNamesMap,
    };
  } catch (error) {
    enableMemoryFallback(error);
    const studentState = getMemoryEnrollmentState(studentKey);
    return {
      selectedYear: studentState.selectedYear,
      selectedSemester: studentState.selectedSemester,
      enrolledUnits: [...studentState.enrolledUnits],
      unitNamesMap: studentState.unitNamesMap || {},
    };
  }
};

const addAttendanceRecord = async ({ unitCode, lectureRoom, sessionStart, scannedAt, rawPayload, deviceId, synced = 0, lessonType }) => {
  await initDatabase();
  const studentKey = await resolveStudentScopeKey();

  const normalizedUnitCode = String(unitCode || '').toUpperCase();
  const normalizedLectureRoom = String(lectureRoom || '').toUpperCase();
  const normalizedSessionStart = Number(sessionStart);
  const normalizedScannedAt = Number.isFinite(Number(scannedAt)) ? Number(scannedAt) : Date.now();
  const normalizedDeviceId = String(deviceId || '').trim();

  const safeRecord = {
    unitCode: normalizedUnitCode,
    lectureRoom: normalizedLectureRoom,
    sessionStart: normalizedSessionStart,
    scannedAt: normalizedScannedAt,
    rawPayload: rawPayload || null,
    deviceId: normalizedDeviceId,
    studentKey,
    synced: synced ? 1 : 0,
    lessonType: lessonType != null ? String(lessonType) : null,
  };

  if (!safeRecord.unitCode || !safeRecord.lectureRoom || !Number.isFinite(safeRecord.sessionStart) || safeRecord.sessionStart <= 0) {
    return { saved: false, duplicate: false, reason: 'invalid' };
  }

  if (!isSQLiteAvailable()) {
    const studentAttendance = getMemoryAttendance(studentKey);
    const key = buildAttendanceDeviceSessionKey(
      safeRecord.unitCode,
      safeRecord.lectureRoom,
      safeRecord.sessionStart,
      safeRecord.deviceId
    );
    const exists = studentAttendance.some((record) =>
      buildAttendanceDeviceSessionKey(record.unit_code ?? record.unitCode, record.lecture_room ?? record.lectureRoom, record.session_start ?? record.sessionStart, record.device_id ?? record.deviceId) === key
    );
    if (exists) {
      return { saved: false, duplicate: true };
    }

    // Store with snake_case keys to match SQLite column names returned by
    // getUnsyncedAttendanceRecords — keeps syncPendingAttendance field-reading consistent.
    studentAttendance.unshift({
      id: `${Date.now()}-${Math.random()}`,
      unit_code:     safeRecord.unitCode,
      lecture_room:  safeRecord.lectureRoom,
      session_start: safeRecord.sessionStart,
      scanned_at:    safeRecord.scannedAt,
      raw_payload:   safeRecord.rawPayload,
      device_id:     safeRecord.deviceId,
      student_key:   safeRecord.studentKey,
      synced:        safeRecord.synced,
      lesson_type:   safeRecord.lessonType,
    });
    return { saved: true, duplicate: false };
  }

  try {
    // Check for existing attendance for this session — device_id excluded to match
    // hasAttendanceForSession semantics and the idx_attendance_session_dedup unique index.
    const existing = await getFirstAsync(
      `SELECT id FROM attendance_records WHERE student_key = ? AND unit_code = ? AND lecture_room = ? AND session_start = ? LIMIT 1;`,
      [safeRecord.studentKey, safeRecord.unitCode, safeRecord.lectureRoom, safeRecord.sessionStart]
    );
    if (existing) {
      return { saved: false, duplicate: true };
    }

    const [result] = await executeSql(
      `INSERT INTO attendance_records (student_key, unit_code, lecture_room, session_start, scanned_at, raw_payload, device_id, synced, lesson_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        safeRecord.studentKey,
        safeRecord.unitCode,
        safeRecord.lectureRoom,
        safeRecord.sessionStart,
        safeRecord.scannedAt,
        safeRecord.rawPayload,
        safeRecord.deviceId,
        safeRecord.synced,
        safeRecord.lessonType,
      ],
    );
    return { saved: true, duplicate: false };
  } catch (error) {
    enableMemoryFallback(error);
    const studentAttendance = getMemoryAttendance(studentKey);
    const key = buildAttendanceDeviceSessionKey(
      safeRecord.unitCode,
      safeRecord.lectureRoom,
      safeRecord.sessionStart,
      safeRecord.deviceId
    );
    const exists = studentAttendance.some((record) =>
      buildAttendanceDeviceSessionKey(record.unitCode, record.lectureRoom, record.sessionStart, record.deviceId) === key
    );
    if (exists) {
      return { saved: false, duplicate: true };
    }
    studentAttendance.unshift({
      id: `${Date.now()}-${Math.random()}`,
      unit_code:     safeRecord.unitCode,
      lecture_room:  safeRecord.lectureRoom,
      session_start: safeRecord.sessionStart,
      scanned_at:    safeRecord.scannedAt,
      raw_payload:   safeRecord.rawPayload,
      device_id:     safeRecord.deviceId,
      student_key:   safeRecord.studentKey,
      synced:        safeRecord.synced,
      lesson_type:   safeRecord.lessonType,
    });
    return { saved: true, duplicate: false };
  }
};

const getAttendanceRecords = async (limit = 100) => {
  await initDatabase();
  const studentKey = await resolveStudentScopeKey();

  if (!isSQLiteAvailable()) {
    return getMemoryAttendance(studentKey).slice(0, limit);
  }

  try {
    const [result] = await executeSql(
      `SELECT id, student_key, unit_code, lecture_room, session_start, scanned_at, raw_payload, device_id, lesson_type
       FROM attendance_records
       WHERE student_key = ?
       ORDER BY scanned_at DESC
       LIMIT ?;`,
      [studentKey, limit],
    );

    const records = [];
    for (let index = 0; index < result.rows.length; index += 1) {
      const item = result.rows.item(index);
      records.push({
        id: item.id,
        unitCode: item.unit_code,
        lectureRoom: item.lecture_room,
        sessionStart: item.session_start,
        scannedAt: item.scanned_at,
        rawPayload: item.raw_payload,
        deviceId: item.device_id,
        studentKey: item.student_key,
        lessonType: item.lesson_type ?? null,
      });
    }

    return records;
  } catch (error) {
    enableMemoryFallback(error);
    return getMemoryAttendance(studentKey).slice(0, limit);
  }
};

/**
 * Lightweight version of getAttendanceRecords — only fetches the three fields
 * needed for stats computation (unitCode, sessionStart, scannedAt).
 * Avoids loading raw_payload, lecture_room, device_id into JS memory.
 * Use this in place of getAttendanceRecords when full record details aren't needed.
 */
const getAttendanceLightRecords = async (limit = 2000) => {
  await initDatabase();
  const studentKey = await resolveStudentScopeKey();

  if (!isSQLiteAvailable()) {
    return getMemoryAttendance(studentKey).slice(0, limit).map(r => ({
      unitCode:     r.unit_code  ?? r.unitCode,
      sessionStart: r.session_start ?? r.sessionStart,
      scannedAt:    r.scanned_at   ?? r.scannedAt,
    }));
  }

  try {
    const [result] = await executeSql(
      `SELECT unit_code, session_start, scanned_at
       FROM attendance_records
       WHERE student_key = ?
       ORDER BY scanned_at DESC
       LIMIT ?;`,
      [studentKey, limit],
    );

    const records = [];
    for (let index = 0; index < result.rows.length; index += 1) {
      const item = result.rows.item(index);
      records.push({
        unitCode:     item.unit_code,
        sessionStart: item.session_start,
        scannedAt:    item.scanned_at,
      });
    }
    return records;
  } catch (error) {
    enableMemoryFallback(error);
    return getMemoryAttendance(studentKey).slice(0, limit).map(r => ({
      unitCode:     r.unit_code  ?? r.unitCode,
      sessionStart: r.session_start ?? r.sessionStart,
      scannedAt:    r.scanned_at   ?? r.scannedAt,
    }));
  }
};

const getUnsyncedAttendanceRecords = async () => {
  await initDatabase();
  const studentKey = await resolveStudentScopeKey();

  if (!isSQLiteAvailable()) {
    return getMemoryAttendance(studentKey).filter(r => !r.synced).slice(0, 50);
  }

  try {
    const [result] = await executeSql(
      `SELECT id, unit_code, lecture_room, session_start, scanned_at, raw_payload, device_id, sync_attempts
       FROM attendance_records WHERE student_key = ? AND synced = 0 AND sync_attempts < 10
       ORDER BY scanned_at ASC LIMIT 50;`,
      [studentKey],
    );
    const records = [];
    for (let i = 0; i < result.rows.length; i++) {
      records.push(result.rows.item(i));
    }
    return records;
  } catch (error) {
    enableMemoryFallback(error);
    return [];
  }
};

const markAttendanceSynced = async (id) => {
  if (!isSQLiteAvailable()) {
    Object.values(memoryStore.attendanceByStudent).forEach(arr => {
      const rec = arr.find(r => r.id === id);
      if (rec) rec.synced = 1;
    });
    return;
  }
  try {
    await executeSql('UPDATE attendance_records SET synced = 1 WHERE id = ?;', [id]);
  } catch (error) {
    enableMemoryFallback(error);
  }
};

const incrementSyncAttempts = async (id) => {
  if (!isSQLiteAvailable()) {
    Object.values(memoryStore.attendanceByStudent).forEach(arr => {
      const rec = arr.find(r => r.id === id);
      if (rec) rec.sync_attempts = (rec.sync_attempts || 0) + 1;
    });
    return;
  }
  try {
    await executeSql(
      'UPDATE attendance_records SET sync_attempts = sync_attempts + 1 WHERE id = ?;',
      [id],
    );
  } catch (error) {
    enableMemoryFallback(error);
  }
};

const clearAttendanceRecords = async () => {
  await initDatabase();
  const studentKey = await resolveStudentScopeKey();

  if (!isSQLiteAvailable()) {
    memoryStore.attendanceByStudent[studentKey] = [];
    return;
  }

  try {
    await executeSql('DELETE FROM attendance_records WHERE student_key = ?;', [studentKey]);
  } catch (error) {
    enableMemoryFallback(error);
    memoryStore.attendanceByStudent[studentKey] = [];
  }
};

const clearConductedSessions = async () => {
  await initDatabase();

  if (!isSQLiteAvailable()) {
    memoryStore.conductedSessions = [];
    return;
  }

  try {
    await executeSql('DELETE FROM conducted_sessions;');
  } catch (error) {
    enableMemoryFallback(error);
    memoryStore.conductedSessions = [];
  }
};

const clearAttendanceTrackingData = async () => {
  await Promise.all([
    clearAttendanceRecords(),
    clearUnitAttendanceGoals(),
  ]);
};

const upsertUnitAttendanceGoal = async ({
  unitCode,
  targetPercent,
  reminderEnabled,
  reminderDays,
  reminderTime,
  updatedAt,
}) => {
  await initDatabase();
  const studentKey = await resolveStudentScopeKey();

  const safeGoal = {
    unitCode: String(unitCode || '').trim().toUpperCase(),
    targetPercent: Math.max(1, Math.min(100, Number(targetPercent) || 75)),
    reminderEnabled: reminderEnabled ? 1 : 0,
    reminderDays: Array.isArray(reminderDays) ? reminderDays.join(',') : String(reminderDays || '1,3,5'),
    reminderTime: String(reminderTime || '08:00').trim(),
    updatedAt: Number.isFinite(Number(updatedAt)) ? Number(updatedAt) : Date.now(),
  };

  if (!safeGoal.unitCode) {
    return { saved: false, reason: 'invalid' };
  }

  const goalsKey = buildScopedSettingsKey(SETTINGS_KEYS.ATTENDANCE_GOALS, studentKey);

  if (!isSQLiteAvailable()) {
    const goalsByUnit = getMemoryAttendanceGoals(studentKey);
    goalsByUnit[safeGoal.unitCode] = {
      unitCode: safeGoal.unitCode,
      targetPercent: safeGoal.targetPercent,
      reminderEnabled: safeGoal.reminderEnabled,
      reminderDays: safeGoal.reminderDays,
      reminderTime: safeGoal.reminderTime,
      updatedAt: safeGoal.updatedAt,
    };
    return { saved: true };
  }

  try {
    const raw = await getSetting(goalsKey, '{}');
    const parsed = JSON.parse(raw || '{}');
    parsed[safeGoal.unitCode] = {
      unitCode: safeGoal.unitCode,
      targetPercent: safeGoal.targetPercent,
      reminderEnabled: safeGoal.reminderEnabled,
      reminderDays: safeGoal.reminderDays,
      reminderTime: safeGoal.reminderTime,
      updatedAt: safeGoal.updatedAt,
    };
    await upsertSetting(goalsKey, JSON.stringify(parsed));
    return { saved: true };
  } catch (error) {
    enableMemoryFallback(error);
    const goalsByUnit = getMemoryAttendanceGoals(studentKey);
    goalsByUnit[safeGoal.unitCode] = {
      unitCode: safeGoal.unitCode,
      targetPercent: safeGoal.targetPercent,
      reminderEnabled: safeGoal.reminderEnabled,
      reminderDays: safeGoal.reminderDays,
      reminderTime: safeGoal.reminderTime,
      updatedAt: safeGoal.updatedAt,
    };
    return { saved: true };
  }
};

const getUnitAttendanceGoals = async (unitCodes = []) => {
  await initDatabase();
  const studentKey = await resolveStudentScopeKey();

  const normalizedCodes = Array.isArray(unitCodes)
    ? [...new Set(unitCodes.map((code) => String(code || '').trim().toUpperCase()).filter(Boolean))]
    : [];
  const shouldFilter = normalizedCodes.length > 0;

  const toNormalizedGoalsObject = (sourceGoals) => {
    const result = {};
    Object.values(sourceGoals || {}).forEach((goal) => {
      const code = String(goal?.unitCode || '').trim().toUpperCase();
      if (!code || (shouldFilter && !normalizedCodes.includes(code))) {
        return;
      }
      result[code] = {
        unitCode: code,
        targetPercent: Number(goal?.targetPercent) || 75,
        reminderEnabled: Number(goal?.reminderEnabled) ? 1 : 0,
        reminderDays: String(goal?.reminderDays || '1,3,5'),
        reminderTime: String(goal?.reminderTime || '08:00'),
        updatedAt: Number(goal?.updatedAt) || Date.now(),
      };
    });
    return result;
  };

  if (!isSQLiteAvailable()) {
    return toNormalizedGoalsObject(getMemoryAttendanceGoals(studentKey));
  }

  try {
    const raw = await getSetting(buildScopedSettingsKey(SETTINGS_KEYS.ATTENDANCE_GOALS, studentKey), '{}');
    return toNormalizedGoalsObject(JSON.parse(raw || '{}'));
  } catch (error) {
    enableMemoryFallback(error);
    return toNormalizedGoalsObject(getMemoryAttendanceGoals(studentKey));
  }
};

const clearUnitAttendanceGoals = async () => {
  await initDatabase();
  const studentKey = await resolveStudentScopeKey();

  if (!isSQLiteAvailable()) {
    memoryStore.attendanceGoalsByStudent[studentKey] = {};
    return;
  }

  try {
    await upsertSetting(buildScopedSettingsKey(SETTINGS_KEYS.ATTENDANCE_GOALS, studentKey), '{}');
  } catch (error) {
    enableMemoryFallback(error);
    memoryStore.attendanceGoalsByStudent[studentKey] = {};
  }
};

const addSharedMaterial = async ({
  title,
  description,
  unitCode,
  linkUrl,
  uploaderRole,
  uploaderName,
  createdAt,
}) => {
  await initDatabase();

  const safeMaterial = {
    title: String(title || '').trim(),
    description: String(description || '').trim(),
    unitCode: String(unitCode || '').trim().toUpperCase(),
    linkUrl: String(linkUrl || '').trim(),
    uploaderRole: String(uploaderRole || '').trim().toLowerCase() || 'student',
    uploaderName: String(uploaderName || '').trim(),
    createdAt: Number.isFinite(Number(createdAt)) ? Number(createdAt) : Date.now(),
  };

  if (!safeMaterial.title || !safeMaterial.unitCode) {
    return { saved: false, reason: 'invalid' };
  }

  if (!isSQLiteAvailable()) {
    const id = `${Date.now()}-${Math.random()}`;
    memoryStore.sharedMaterials.unshift({ id, ...safeMaterial });
    return { saved: true, id };
  }

  try {
    const [result] = await executeSql(
      `INSERT INTO shared_materials (title, description, unit_code, link_url, uploader_role, uploader_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?);`,
      [
        safeMaterial.title,
        safeMaterial.description || null,
        safeMaterial.unitCode,
        safeMaterial.linkUrl || null,
        safeMaterial.uploaderRole,
        safeMaterial.uploaderName || null,
        safeMaterial.createdAt,
      ],
    );
    return { saved: true, id: result?.insertId };
  } catch (error) {
    enableMemoryFallback(error);
    const id = `${Date.now()}-${Math.random()}`;
    memoryStore.sharedMaterials.unshift({ id, ...safeMaterial });
    return { saved: true, id };
  }
};

const getSharedMaterials = async ({ unitCodes = [], limit = 200 } = {}) => {
  await initDatabase();

  const normalizedCodes = Array.isArray(unitCodes)
    ? [...new Set(unitCodes.map((code) => String(code || '').trim().toUpperCase()).filter(Boolean))]
    : [];
  const shouldFilter = normalizedCodes.length > 0;

  if (!isSQLiteAvailable()) {
    const filtered = memoryStore.sharedMaterials.filter((item) => {
      if (!shouldFilter) {
        return true;
      }
      return normalizedCodes.includes(String(item?.unitCode || '').toUpperCase());
    });
    return filtered.slice(0, limit);
  }

  try {
    const whereClause = shouldFilter
      ? `WHERE unit_code IN (${normalizedCodes.map(() => '?').join(',')})`
      : '';

    const [result] = await executeSql(
      `SELECT id, title, description, unit_code, link_url, uploader_role, uploader_name, created_at
       FROM shared_materials
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT ?;`,
      shouldFilter ? [...normalizedCodes, Number(limit) || 200] : [Number(limit) || 200],
    );

    const items = [];
    for (let index = 0; index < result.rows.length; index += 1) {
      const row = result.rows.item(index);
      items.push({
        id: row.id,
        title: row.title,
        description: row.description,
        unitCode: row.unit_code,
        linkUrl: row.link_url,
        uploaderRole: row.uploader_role,
        uploaderName: row.uploader_name,
        createdAt: row.created_at,
      });
    }

    return items;
  } catch (error) {
    enableMemoryFallback(error);
    const filtered = memoryStore.sharedMaterials.filter((item) => {
      if (!shouldFilter) {
        return true;
      }
      return normalizedCodes.includes(String(item?.unitCode || '').toUpperCase());
    });
    return filtered.slice(0, limit);
  }
};

const backfillConductedSessionsFromAttendance = async () => {
  await initDatabase();

  if (!isSQLiteAvailable()) {
    const seen = new Set(
      memoryStore.conductedSessions.map((session) =>
        buildSessionKey(session?.unitCode, session?.lectureRoom, session?.sessionStart),
      ),
    );

    Object.values(memoryStore.attendanceByStudent).forEach((records) => {
      (Array.isArray(records) ? records : []).forEach((record) => {
      const unitCode = String(record?.unitCode || '').toUpperCase();
      const lectureRoom = String(record?.lectureRoom || '');
      const sessionStart = Number(record?.sessionStart);
      const createdAt = Number(record?.scannedAt) || Date.now();
      if (!unitCode || !lectureRoom || !Number.isFinite(sessionStart)) {
        return;
      }
      const key = buildSessionKey(unitCode, lectureRoom, sessionStart);
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      memoryStore.conductedSessions.push({
        unitCode,
        lectureRoom,
        sessionStart,
        createdAt,
      });
      });
    });
    return;
  }

  try {
    await executeSql(
      `INSERT OR IGNORE INTO conducted_sessions (unit_code, lecture_room, session_start, created_at)
       SELECT unit_code, lecture_room, session_start, MIN(scanned_at)
       FROM attendance_records
       GROUP BY unit_code, lecture_room, session_start;`,
    );
  } catch (error) {
    enableMemoryFallback(error);
  }
};

const getOrCreateAttendanceDeviceId = async () => {
  await initDatabase();

  if (!isSQLiteAvailable()) {
    if (!memoryStore.attendanceDeviceId) {
      memoryStore.attendanceDeviceId = generateDeviceId();
    }
    return memoryStore.attendanceDeviceId;
  }

  try {
    let deviceId = await getSetting(SETTINGS_KEYS.ATTENDANCE_DEVICE_ID, null);
    if (!deviceId) {
      deviceId = generateDeviceId();
      await upsertSetting(SETTINGS_KEYS.ATTENDANCE_DEVICE_ID, deviceId);
    }
    return deviceId;
  } catch (error) {
    enableMemoryFallback(error);
    if (!memoryStore.attendanceDeviceId) {
      memoryStore.attendanceDeviceId = generateDeviceId();
    }
    return memoryStore.attendanceDeviceId;
  }
};

const addConductedSession = async ({ unitCode, lectureRoom, sessionStart, createdAt, lessonType }) => {
  await initDatabase();

  const safeSession = {
    unitCode: (unitCode || '').toUpperCase(),
    lectureRoom: lectureRoom || '',
    sessionStart: Number(sessionStart),
    createdAt: Number.isFinite(createdAt) ? Number(createdAt) : Date.now(),
    lessonType: lessonType != null ? String(lessonType) : null,
  };

  if (!safeSession.unitCode || !safeSession.lectureRoom || !Number.isFinite(safeSession.sessionStart)) {
    return;
  }

  if (!isSQLiteAvailable()) {
    const key = buildSessionKey(safeSession.unitCode, safeSession.lectureRoom, safeSession.sessionStart);
    const exists = memoryStore.conductedSessions.some((item) =>
      buildSessionKey(item.unitCode, item.lectureRoom, item.sessionStart) === key,
    );
    if (!exists) {
      memoryStore.conductedSessions.push(safeSession);
    }
    return;
  }

  try {
    await executeSql(
      `INSERT OR IGNORE INTO conducted_sessions (unit_code, lecture_room, session_start, created_at, lesson_type)
       VALUES (?, ?, ?, ?, ?);`,
      [
        safeSession.unitCode,
        safeSession.lectureRoom,
        safeSession.sessionStart,
        safeSession.createdAt,
        safeSession.lessonType,
      ],
    );
  } catch (error) {
    enableMemoryFallback(error);
    const key = buildSessionKey(safeSession.unitCode, safeSession.lectureRoom, safeSession.sessionStart);
    const exists = memoryStore.conductedSessions.some((item) =>
      buildSessionKey(item.unitCode, item.lectureRoom, item.sessionStart) === key,
    );
    if (!exists) {
      memoryStore.conductedSessions.push(safeSession);
    }
  }
};

const getConductedSessionCounts = async (unitCodes = []) => {
  await initDatabase();

  const normalizedCodes = Array.isArray(unitCodes)
    ? [...new Set(unitCodes.map((code) => String(code || '').toUpperCase()).filter(Boolean))]
    : [];
  const shouldFilter = normalizedCodes.length > 0;

  if (!isSQLiteAvailable()) {
    const distinctByUnit = new Map();
    memoryStore.conductedSessions.forEach((session) => {
      const code = (session?.unitCode || '').toUpperCase();
      if (!code || (shouldFilter && !normalizedCodes.includes(code))) {
        return;
      }
      const bucket = distinctByUnit.get(code) || new Set();
      bucket.add(Number(session?.sessionStart));
      distinctByUnit.set(code, bucket);
    });

    const counts = {};
    distinctByUnit.forEach((sessionStarts, code) => {
      counts[code] = sessionStarts.size;
    });
    return counts;
  }

  try {
    const whereClause = shouldFilter
      ? `WHERE unit_code IN (${normalizedCodes.map(() => '?').join(',')})`
      : '';
    const [result] = await executeSql(
      `SELECT unit_code, COUNT(DISTINCT session_start) AS total
       FROM conducted_sessions
       ${whereClause}
       GROUP BY unit_code;`,
      shouldFilter ? normalizedCodes : [],
    );

    const counts = {};
    for (let index = 0; index < result.rows.length; index += 1) {
      const item = result.rows.item(index);
      counts[item.unit_code] = item.total;
    }
    return counts;
  } catch (error) {
    enableMemoryFallback(error);
    const distinctByUnit = new Map();
    memoryStore.conductedSessions.forEach((session) => {
      const code = (session?.unitCode || '').toUpperCase();
      if (!code || (shouldFilter && !normalizedCodes.includes(code))) {
        return;
      }
      const bucket = distinctByUnit.get(code) || new Set();
      bucket.add(Number(session?.sessionStart));
      distinctByUnit.set(code, bucket);
    });

    const counts = {};
    distinctByUnit.forEach((sessionStarts, code) => {
      counts[code] = sessionStarts.size;
    });
    return counts;
  }
};

/**
 * Persist the remote conducted-session counts as a JSON blob so the screens
 * can use them offline without synthetic placeholder rows in conducted_sessions.
 */
const saveConductedCountsCache = async (countsByCode) => {
  await initDatabase();
  if (!countsByCode || !Object.keys(countsByCode).length) return;
  const studentKey = await resolveStudentScopeKey();
  try {
    await upsertSetting(
      buildScopedSettingsKey(SETTINGS_KEYS.CONDUCTED_COUNTS_CACHE, studentKey),
      JSON.stringify(countsByCode),
    );
  } catch (_) {}
};

const getConductedCountsCache = async () => {
  await initDatabase();
  const studentKey = await resolveStudentScopeKey();
  try {
    const raw = await getSetting(
      buildScopedSettingsKey(SETTINGS_KEYS.CONDUCTED_COUNTS_CACHE, studentKey),
      null,
    );
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    return {};
  }
};

/**
 * Remove any synthetic placeholder rows that were inserted by a previous
 * version of the app (lecture_room = 'REMOTE_SYNC' or session_start < 0).
 * Safe to call fire-and-forget — idempotent.
 */
const clearSyntheticConductedSessions = async () => {
  await initDatabase();
  if (!isSQLiteAvailable()) {
    memoryStore.conductedSessions = memoryStore.conductedSessions.filter(
      s => s.lectureRoom !== 'REMOTE_SYNC' && Number(s.sessionStart) >= 0,
    );
    return;
  }
  try {
    await executeSql(
      `DELETE FROM conducted_sessions WHERE lecture_room = 'REMOTE_SYNC' OR session_start < 0;`,
    );
  } catch (_) {}
};

/**
 * Clear all per-student remote-sync caches (conducted counts and attendance summary).
 * Called when the backend signals needsFullSync: true so stale cache data is evicted
 * and fresh values are fetched on the next screen load.
 */
const clearRemoteSyncCaches = async () => {
  await initDatabase();
  if (!isSQLiteAvailable()) return;
  try {
    await executeSql(
      `DELETE FROM app_settings WHERE key LIKE '${SETTINGS_KEYS.CONDUCTED_COUNTS_CACHE}:%';`,
    );
    await executeSql(
      `DELETE FROM app_settings WHERE key LIKE '${SETTINGS_KEYS.ATTENDANCE_SUMMARY_CACHE}:%';`,
    );
  } catch (_) {}
};

const saveAttendanceSummaryCache = async (summary) => {
  await initDatabase();
  if (!summary) return;
  const studentKey = await resolveStudentScopeKey();
  try {
    await upsertSetting(
      buildScopedSettingsKey(SETTINGS_KEYS.ATTENDANCE_SUMMARY_CACHE, studentKey),
      JSON.stringify(summary),
    );
  } catch (_) {}
};

const getAttendanceSummaryCache = async () => {
  await initDatabase();
  const studentKey = await resolveStudentScopeKey();
  try {
    const raw = await getSetting(
      buildScopedSettingsKey(SETTINGS_KEYS.ATTENDANCE_SUMMARY_CACHE, studentKey),
      null,
    );
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
};

/**
 * Cache the merged timetable (regular + extra sessions, by-day array) for offline use.
 */
const saveTimetableCache = async (timetableByDay) => {
  await initDatabase();
  if (!Array.isArray(timetableByDay)) return;
  const studentKey = await resolveStudentScopeKey();
  try {
    await upsertSetting(
      buildScopedSettingsKey(SETTINGS_KEYS.TIMETABLE_CACHE, studentKey),
      JSON.stringify(timetableByDay),
    );
  } catch (_) {}
};

const getTimetableCache = async () => {
  await initDatabase();
  const studentKey = await resolveStudentScopeKey();
  try {
    const raw = await getSetting(
      buildScopedSettingsKey(SETTINGS_KEYS.TIMETABLE_CACHE, studentKey),
      null,
    );
    return raw ? JSON.parse(raw) : [];
  } catch (_) {
    return [];
  }
};

/**
 * Cache the flattened assignments array for offline use.
 */
const saveAssignmentsCache = async (assignments) => {
  await initDatabase();
  if (!Array.isArray(assignments)) return;
  const studentKey = await resolveStudentScopeKey();
  try {
    await upsertSetting(
      buildScopedSettingsKey(SETTINGS_KEYS.ASSIGNMENTS_CACHE, studentKey),
      JSON.stringify(assignments),
    );
  } catch (_) {}
};

const getAssignmentsCache = async () => {
  await initDatabase();
  const studentKey = await resolveStudentScopeKey();
  try {
    const raw = await getSetting(
      buildScopedSettingsKey(SETTINGS_KEYS.ASSIGNMENTS_CACHE, studentKey),
      null,
    );
    return raw ? JSON.parse(raw) : [];
  } catch (_) {
    return [];
  }
};

// ─── Lecturer notification / template helpers ─────────────────────────────────

const getSentNotifications = async () => {
  await initDatabase();
  try {
    const raw = await getSetting(SETTINGS_KEYS.SENT_NOTIFICATIONS, null);
    return raw ? JSON.parse(raw) : [];
  } catch (_) {
    return [];
  }
};

const saveSentNotifications = async (notifications) => {
  await initDatabase();
  try {
    await upsertSetting(SETTINGS_KEYS.SENT_NOTIFICATIONS, JSON.stringify(notifications));
  } catch (_) {}
};

const getNotificationTemplates = async () => {
  await initDatabase();
  try {
    const raw = await getSetting(SETTINGS_KEYS.NOTIFICATION_TEMPLATES, null);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
};

const saveNotificationTemplates = async (templates) => {
  await initDatabase();
  try {
    await upsertSetting(SETTINGS_KEYS.NOTIFICATION_TEMPLATES, JSON.stringify(templates));
  } catch (_) {}
};

// ─── Delegation helpers ───────────────────────────────────────────────────────

const saveDelegations = async (delegations) => {
  await initDatabase();
  if (!isSQLiteAvailable()) return;

  // Backend always sends Unix-ms (13-digit). Never multiply by 1000.
  const toMs = (v) => {
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return v;
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
    const parsed = new Date(v);
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
  };
  for (const d of delegations) {
    try {
      // Accept both camelCase (our own format) and snake_case (backend may return either)
      const id          = d.id;
      const unitCode    = d.unitCode    ?? d.unit_code    ?? '';
      const unitId      = d.unitId      ?? d.unit_id      ?? 0;
      const roomCode    = d.roomCode    ?? d.room_code    ?? '';
      const roomId      = d.roomId      ?? d.room_id      ?? 0;
      // groupId may be a UUID string — do NOT coerce to Number (NaN → null → NOT NULL failure)
      const groupId     = d.groupId     ?? d.group_id     ?? '';
      const groupNumber = d.groupNumber ?? d.group_number ?? 0;
      const groupName        = d.groupName        ?? d.group_name         ?? null;
      const validFrom        = toMs(d.validFrom   ?? d.valid_from);
      const validUntil       = toMs(d.validUntil  ?? d.valid_until);
      const sessionToken     = d.sessionToken     ?? d.session_token      ?? null;
      const leaderStudentId  = d.leaderStudentId  ?? d.leader_student_id  ?? null;
      const createdAt        = toMs(d.createdAt   ?? d.created_at ?? Date.now());
      await executeSql(
        `INSERT OR REPLACE INTO delegations
           (id, unit_code, unit_id, room_code, room_id, group_id, group_number, group_name,
            valid_from, valid_until, session_token, leader_student_id, used, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          String(id), String(unitCode).toUpperCase(), Number(unitId),
          String(roomCode).toUpperCase(), Number(roomId),
          String(groupId), Number(groupNumber), groupName,
          validFrom, validUntil,
          sessionToken, leaderStudentId ? String(leaderStudentId) : null,
          d.used ? 1 : 0, createdAt,
        ],
      );
    } catch (e) {
      console.warn('[sqliteStorage] saveDelegations insert failed:', e?.message, '| row id:', d?.id);
    }
  }
};

const getActiveDelegations = async () => {
  await initDatabase();
  if (!isSQLiteAvailable()) return [];
  try {
    const now = Date.now();
    const rows = await getAllAsync(
      `SELECT * FROM delegations WHERE used = 0 AND valid_until >= ? ORDER BY valid_from ASC`,
      [now],
    );
    return (rows || []).map((r) => ({
      id: r.id,
      unitCode: r.unit_code,
      unitId: r.unit_id,
      roomCode: r.room_code,
      roomId: r.room_id,
      groupId: r.group_id,
      groupNumber: r.group_number,
      groupName: r.group_name,
      validFrom: r.valid_from,
      validUntil: r.valid_until,
      sessionToken: r.session_token,
      leaderStudentId: r.leader_student_id || null,
      used: r.used === 1,
    }));
  } catch (_) {
    return [];
  }
};

const markDelegationUsed = async (delegationId, sessionToken) => {
  await initDatabase();
  if (!isSQLiteAvailable()) return;
  try {
    await executeSql(
      `UPDATE delegations SET used = 1, session_token = ? WHERE id = ?`,
      [sessionToken || null, String(delegationId)],
    );
  } catch (_) {}
};

// ─── Push notification helpers ────────────────────────────────────────────────

const savePushNotification = async ({ id, type, title, body, data }) => {
  await initDatabase();
  if (!isSQLiteAvailable()) return false;
  try {
    const [result] = await executeSql(
      `INSERT OR IGNORE INTO push_notifications (id, type, title, body, data, read, received_at)
       VALUES (?, ?, ?, ?, ?, 0, ?)`,
      [
        String(id || `${Date.now()}-${Math.random()}`),
        String(type || 'general'),
        String(title || ''),
        body ? String(body) : null,
        data ? JSON.stringify(data) : null,
        Date.now(),
      ],
    );
    // Returns true only when a new row was actually inserted (not when IGNORE fired).
    return (result?.rowsAffected ?? 0) > 0;
  } catch (_) {
    return false;
  }
};

const getPushNotifications = async (limit = 100) => {
  await initDatabase();
  if (!isSQLiteAvailable()) return [];
  try {
    const rows = await getAllAsync(
      `SELECT * FROM push_notifications ORDER BY received_at DESC LIMIT ?`,
      [limit],
    );
    return (rows || []).map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      body: r.body,
      data: r.data ? (() => { try { return JSON.parse(r.data); } catch (_) { return {}; } })() : {},
      read: r.read === 1,
      receivedAt: r.received_at,
    }));
  } catch (_) {
    return [];
  }
};

const markNotificationRead = async (id) => {
  await initDatabase();
  if (!isSQLiteAvailable()) return;
  try {
    await executeSql(`UPDATE push_notifications SET read = 1 WHERE id = ?`, [String(id)]);
  } catch (_) {}
};

const markAllNotificationsRead = async () => {
  await initDatabase();
  if (!isSQLiteAvailable()) return;
  try {
    await executeSql(`UPDATE push_notifications SET read = 1`);
  } catch (_) {}
};

/**
 * Delete all delegation-type push notifications and clear the delegations
 * table. Call this after the lecturer re-sends updated delegations so stale
 * rows (with old roomId=0) are fully purged from the device.
 */
const clearDelegationNotifications = async () => {
  await initDatabase();
  if (!isSQLiteAvailable()) return;
  try {
    await executeSql(`DELETE FROM push_notifications WHERE type = 'delegation'`);
  } catch (_) {}
  try {
    await executeSql(`DELETE FROM delegations`);
  } catch (_) {}
};

const deleteNotification = async (id) => {
  await initDatabase();
  if (!isSQLiteAvailable()) return;
  try {
    await executeSql(`DELETE FROM push_notifications WHERE id = ?`, [String(id)]);
  } catch (_) {}
};

const getUnreadNotificationCount = async () => {
  await initDatabase();
  if (!isSQLiteAvailable()) return 0;
  try {
    const row = await getFirstAsync(
      `SELECT COUNT(*) as cnt FROM push_notifications WHERE read = 0`,
      [],
    );
    return row?.cnt ?? 0;
  } catch (_) {
    return 0;
  }
};

const deleteAllNotifications = async () => {
  await initDatabase();
  if (!isSQLiteAvailable()) return;
  try {
    await executeSql(`DELETE FROM push_notifications`);
  } catch (_) {}
};

// ===== LECTURER OFFLINE MANUAL MARK SUPPORT =====

/**
 * Save (or replace) the enrolled student roster for a unit.
 * Called when the lecturer selects a unit while online — caches the list for
 * offline lookup during the session.
 *
 * @param {string} unitCode       — normalized unit code, e.g. "SCH2170"
 * @param {string} institutionId  — lecturer's institution
 * @param {Array}  students       — [{ studentId, studentName, admissionNumber }]
 * @throws {Error} if the save operation fails
 */
const saveUnitRosterCache = async (unitCode, institutionId, students) => {
  await initDatabase();
  if (!isSQLiteAvailable()) {
    throw new Error('SQLite database is not available');
  }
  if (!Array.isArray(students) || !students.length) {
    throw new Error('No students provided to cache');
  }
  const normalizedCode = String(unitCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const now = Date.now();

  let insertedCount = 0;
  let skippedCount = 0;
  
  try {
    // Use a transaction so DELETE + all INSERTs are atomic.
    // If anything fails, ROLLBACK restores the previous roster intact.
    await executeSql('BEGIN TRANSACTION');
    try {
      await executeSql(
        'DELETE FROM unit_student_roster WHERE unit_code = ? AND institution_id = ?',
        [normalizedCode, institutionId || '']
      );
      for (const s of students) {
        // Normalize field names — handle common backend response shapes
        const studentId = String(s.studentId || s.student_id || s.id || s._id || '');
        const studentName = String(s.studentName || s.student_name || s.name || s.fullName || s.full_name || '');
        const admissionNumber = String(
          s.admissionNumber || s.admission_number || s.admNo || s.adm_no || s.registrationNumber || ''
        );
        if (!studentId || !admissionNumber) {
          skippedCount++;
          console.warn('[sqliteStorage] Skipping student record - missing ID or admission number:', s);
          continue; // skip malformed records
        }
        await executeSql(
          `INSERT OR REPLACE INTO unit_student_roster (unit_code, institution_id, student_id, student_name, admission_number, cached_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [normalizedCode, institutionId || '', studentId, studentName, admissionNumber, now]
        );
        insertedCount++;
      }
      await executeSql('COMMIT');
      if (__DEV__) console.log(`[sqliteStorage] Saved ${insertedCount} students to roster cache for ${normalizedCode}${skippedCount > 0 ? ` (skipped ${skippedCount} invalid records)` : ''}`);
    } catch (innerErr) {
      try { await executeSql('ROLLBACK'); } catch (_) {}
      throw innerErr;
    }
  } catch (err) {
    const errorMsg = `Failed to save roster to SQLite: ${err?.message || err}`;
    console.error('[sqliteStorage]', errorMsg);
    throw new Error(errorMsg);
  }
};

/**
 * Search the cached roster for a student by admission number within a unit.
 * Returns { studentId, studentName, admissionNumber, isEnrolled: true } or null.
 */
const getUnitRosterCache = async (unitCode, admissionNumber) => {
  await initDatabase();
  if (!isSQLiteAvailable()) return null;
  const normalizedCode = String(unitCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const normalizedAdm = String(admissionNumber || '').trim().toLowerCase();
  try {
    const row = await getFirstAsync(
      `SELECT student_id, student_name, admission_number FROM unit_student_roster
       WHERE unit_code = ? AND LOWER(TRIM(admission_number)) = ? LIMIT 1`,
      [normalizedCode, normalizedAdm]
    );
    if (!row) return null;
    return {
      studentId: row.student_id,
      studentName: row.student_name,
      admissionNumber: row.admission_number,
      isEnrolled: true,
    };
  } catch (_) {
    return null;
  }
};

/**
 * Get all cached students for a unit (without filtering by admission number)
 */
const getAllCachedStudentsForUnit = async (unitCode) => {
  await initDatabase();
  if (!isSQLiteAvailable()) return [];
  const normalizedCode = String(unitCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  try {
    const rows = await getAllAsync(
      `SELECT student_id, student_name, admission_number FROM unit_student_roster
       WHERE unit_code = ?`,
      [normalizedCode]
    );
    return rows.map(row => ({
      studentId: row.student_id,
      studentName: row.student_name,
      admissionNumber: row.admission_number,
      unitCode: normalizedCode
    }));
  } catch (err) {
    console.warn('[sqliteStorage] getAllCachedStudentsForUnit error:', err);
    return [];
  }
};

/**
 * Get roster cache metadata for a unit (last updated time, student count)
 */
const getUnitRosterCacheMeta = async (unitCode, institutionId) => {
  await initDatabase();
  if (!isSQLiteAvailable()) return null;
  const normalizedCode = String(unitCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  try {
    const row = await getFirstAsync(
      `SELECT unit_code, institution_id, last_updated, student_count, unit_display
       FROM roster_cache_meta
       WHERE unit_code = ? AND institution_id = ?`,
      [normalizedCode, institutionId || '']
    );
    if (!row) return null;
    return {
      unit_code: row.unit_code,
      institution_id: row.institution_id,
      last_updated: row.last_updated,
      student_count: row.student_count,
      unit_display: row.unit_display
    };
  } catch (err) {
    console.warn('[sqliteStorage] getUnitRosterCacheMeta error:', err);
    return null;
  }
};

/**
 * Save roster cache metadata for a unit
 */
const saveUnitRosterCacheMeta = async (unitCode, institutionId, meta) => {
  await initDatabase();
  if (!isSQLiteAvailable()) return;
  const normalizedCode = String(unitCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  try {
    await executeSql(
      `INSERT OR REPLACE INTO roster_cache_meta (unit_code, institution_id, last_updated, student_count, unit_display)
       VALUES (?, ?, ?, ?, ?)`,
      [
        normalizedCode,
        institutionId || '',
        meta.lastUpdated || Date.now(),
        meta.studentCount || 0,
        meta.unitDisplay || unitCode
      ]
    );
  } catch (err) {
    console.warn('[sqliteStorage] saveUnitRosterCacheMeta error:', err);
  }
};

/**
 * Queue a manual attendance mark for offline sync.
 * Called when the lecturer marks a student present while offline.
 */
const addPendingManualMark = async ({ admissionNumber, studentId, unitCode, lectureRoom, sessionStart, lecturerId, markedAt }) => {
  await initDatabase();
  if (!isSQLiteAvailable()) return;
  try {
    await executeSql(
      `INSERT INTO pending_manual_marks
         (admission_number, student_id, unit_code, lecture_room, session_start, lecturer_id, marked_at, synced)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        String(admissionNumber).trim(),
        String(studentId),
        String(unitCode || '').replace(/\s+/g, ' ').trim().toUpperCase(),
        String(lectureRoom).toUpperCase(),
        Number(sessionStart),
        String(lecturerId || ''),
        Number(markedAt) || Date.now(),
      ]
    );
  } catch (_) {}
};

/**
 * Fetch all pending manual marks that have not yet been synced to the backend.
 */
const getUnsyncedPendingManualMarks = async () => {
  await initDatabase();
  if (!isSQLiteAvailable()) return [];
  try {
    return await getAllAsync(
      `SELECT id, admission_number, student_id, unit_code, lecture_room, session_start, lecturer_id, marked_at
       FROM pending_manual_marks WHERE synced = 0 AND sync_attempts < 10 ORDER BY marked_at ASC LIMIT 100`
    );
  } catch (_) {
    return [];
  }
};

/**
 * Mark a pending manual mark row as synced after successful backend submission.
 */
const markPendingManualMarkSynced = async (id) => {
  await initDatabase();
  if (!isSQLiteAvailable()) return;
  try {
    await executeSql(`UPDATE pending_manual_marks SET synced = 1 WHERE id = ?`, [id]);
  } catch (_) {}
};

// ─── Proxy-mark offline queue ─────────────────────────────────────────────────

const addPendingProxyMark = async ({
  delegationId, sessionToken, targetStudentId, targetAdmissionNumber,
  unitCode, lectureRoom, sessionStart, markedAt,
}) => {
  await initDatabase();
  if (!isSQLiteAvailable()) return;
  try {
    await executeSql(
      `INSERT OR IGNORE INTO pending_proxy_marks
         (delegation_id, session_token, target_student_id, target_admission_number,
          unit_code, lecture_room, session_start, marked_at, synced, sync_attempts)
       VALUES (?,?,?,?,?,?,?,?,0,0)`,
      [
        String(delegationId),
        String(sessionToken),
        String(targetStudentId),
        String(targetAdmissionNumber || '').trim(),
        String(unitCode || '').toUpperCase(),
        String(lectureRoom || '').toUpperCase(),
        Number(sessionStart),
        Number(markedAt || Date.now()),
      ],
    );
  } catch (_) {}
};

const getUnsyncedProxyMarks = async () => {
  await initDatabase();
  if (!isSQLiteAvailable()) return [];
  try {
    return await getAllAsync(
      `SELECT id, delegation_id, session_token, target_student_id, target_admission_number,
              unit_code, lecture_room, session_start, marked_at
       FROM pending_proxy_marks WHERE synced = 0 AND sync_attempts < 5
       ORDER BY marked_at ASC LIMIT 100`,
    );
  } catch (_) { return []; }
};

const markProxyMarkSynced = async (id) => {
  await initDatabase();
  if (!isSQLiteAvailable()) return;
  try {
    await executeSql(`UPDATE pending_proxy_marks SET synced = 1 WHERE id = ?`, [id]);
  } catch (_) {}
};

const incrementProxyMarkSyncAttempts = async (id) => {
  await initDatabase();
  if (!isSQLiteAvailable()) return;
  try {
    await executeSql(`UPDATE pending_proxy_marks SET sync_attempts = sync_attempts + 1 WHERE id = ?`, [id]);
  } catch (_) {}
};

// ─── Session-end offline queue ────────────────────────────────────────────────

const addPendingSessionEnd = async ({
  delegationId, sessionToken, unitCode, roomCode, sessionStart, sessionEnd,
}) => {
  await initDatabase();
  if (!isSQLiteAvailable()) return;
  try {
    await executeSql(
      `INSERT OR REPLACE INTO pending_session_ends
         (delegation_id, session_token, unit_code, room_code, session_start, session_end, synced)
       VALUES (?,?,?,?,?,?,0)`,
      [
        String(delegationId),
        String(sessionToken),
        String(unitCode || '').toUpperCase(),
        String(roomCode || '').toUpperCase(),
        Number(sessionStart),
        Number(sessionEnd),
      ],
    );
  } catch (_) {}
};

const getUnsyncedSessionEnds = async () => {
  await initDatabase();
  if (!isSQLiteAvailable()) return [];
  try {
    return await getAllAsync(
      `SELECT id, delegation_id, session_token, unit_code, room_code, session_start, session_end
       FROM pending_session_ends WHERE synced = 0 AND sync_attempts < 5 ORDER BY session_end ASC LIMIT 50`,
    );
  } catch (_) { return []; }
};

const markSessionEndSynced = async (id) => {
  await initDatabase();
  if (!isSQLiteAvailable()) return;
  try {
    await executeSql(`UPDATE pending_session_ends SET synced = 1 WHERE id = ?`, [id]);
  } catch (_) {}
};

const incrementManualMarkSyncAttempts = async (id) => {
  await initDatabase();
  if (!isSQLiteAvailable()) return;
  try {
    await executeSql(`UPDATE pending_manual_marks SET sync_attempts = sync_attempts + 1 WHERE id = ?`, [id]);
  } catch (_) {}
};

const incrementSessionEndSyncAttempts = async (id) => {
  await initDatabase();
  if (!isSQLiteAvailable()) return;
  try {
    await executeSql(`UPDATE pending_session_ends SET sync_attempts = sync_attempts + 1 WHERE id = ?`, [id]);
  } catch (_) {}
};

// ─── Lecturer analytics helpers ───────────────────────────────────────────────

/**
 * Return all conducted sessions for a unit ordered by session_start ASC.
 * Used by AnalyticsScreen to map grid column positions to timestamps so that
 * locally-stored manual marks can be overlaid on the backend grid data.
 *
 * @param {string} unitCode — raw unit code; spaces are normalised internally.
 * @returns {Array<{unit_code, lecture_room, session_start, created_at}>}
 */
const getConductedSessionsForUnit = async (unitCode) => {
  await initDatabase();
  // Normalise: strip all spaces for matching, because codes may be stored as
  // "SCH2170" or "SCH 2170" depending on the source.
  const withoutSpace = String(unitCode || '').toUpperCase().replace(/\s/g, '');
  if (!isSQLiteAvailable()) {
    return memoryStore.conductedSessions
      .filter(s => String(s.unitCode || '').toUpperCase().replace(/\s/g, '') === withoutSpace)
      .sort((a, b) => a.sessionStart - b.sessionStart)
      .map(s => ({
        unit_code: s.unitCode,
        lecture_room: s.lectureRoom,
        session_start: s.sessionStart,
        created_at: s.createdAt,
      }));
  }
  try {
    return await getAllAsync(
      `SELECT unit_code, lecture_room, session_start, created_at
       FROM conducted_sessions
       WHERE REPLACE(unit_code, ' ', '') = ?
       ORDER BY session_start ASC`,
      [withoutSpace],
    );
  } catch (_) { return []; }
};

/**
 * Return ALL manual marks for a unit (synced and unsynced).
 * Used by AnalyticsScreen to overlay locally-made manual attendances on top
 * of the backend grid/student-list data, which may not include them.
 *
 * @param {string} unitCode — raw unit code; spaces are normalised internally.
 * @returns {Array<{admission_number, student_id, lecture_room, session_start, marked_at, synced}>}
 */
const getAllManualMarksForUnit = async (unitCode) => {
  await initDatabase();
  const withoutSpace = String(unitCode || '').toUpperCase().replace(/\s/g, '');
  if (!isSQLiteAvailable()) return [];
  try {
    return await getAllAsync(
      `SELECT admission_number, student_id, lecture_room, session_start, marked_at, synced
       FROM pending_manual_marks
       WHERE REPLACE(unit_code, ' ', '') = ?
       ORDER BY session_start ASC, marked_at ASC`,
      [withoutSpace],
    );
  } catch (_) { return []; }
};

export default {
  initDatabase,
  saveEnrollmentState,
  getEnrollmentState,
  addAttendanceRecord,
  getAttendanceRecords,
  getAttendanceLightRecords,
  getUnsyncedAttendanceRecords,
  markAttendanceSynced,
  incrementSyncAttempts,
  addConductedSession,
  getConductedSessionCounts,
  clearAttendanceRecords,
  clearConductedSessions,
  clearAttendanceTrackingData,
  backfillConductedSessionsFromAttendance,
  upsertUnitAttendanceGoal,
  getUnitAttendanceGoals,
  addSharedMaterial,
  getSharedMaterials,
  getOrCreateAttendanceDeviceId,
  isSQLiteAvailable,
  hasAttendanceForSession,
  saveAttendanceSummaryCache,
  getAttendanceSummaryCache,
  saveConductedCountsCache,
  getConductedCountsCache,
  clearSyntheticConductedSessions,
  clearRemoteSyncCaches,
  saveDelegations,
  getActiveDelegations,
  markDelegationUsed,
  savePushNotification,
  getPushNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  clearDelegationNotifications,
  getUnreadNotificationCount,
  deleteNotification,
  deleteAllNotifications,
  // Lecturer offline manual mark
  saveUnitRosterCache,
  getUnitRosterCache,
  getAllCachedStudentsForUnit,
  getUnitRosterCacheMeta,
  saveUnitRosterCacheMeta,
  addPendingManualMark,
  getUnsyncedPendingManualMarks,
  markPendingManualMarkSynced,
  // Lecturer analytics helpers
  getConductedSessionsForUnit,
  getAllManualMarksForUnit,
  // Leader proxy-mark offline queue
  addPendingProxyMark,
  getUnsyncedProxyMarks,
  markProxyMarkSynced,
  incrementProxyMarkSyncAttempts,
  incrementManualMarkSyncAttempts,
  // Session-end offline queue
  addPendingSessionEnd,
  getUnsyncedSessionEnds,
  markSessionEndSynced,
  incrementSessionEndSyncAttempts,
  // Offline content caches
  saveTimetableCache,
  getTimetableCache,
  saveAssignmentsCache,
  getAssignmentsCache,
  // Lecturer notification helpers
  getSentNotifications,
  saveSentNotifications,
  getNotificationTemplates,
  saveNotificationTemplates,
};