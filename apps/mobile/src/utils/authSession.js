// Token storage uses react-native-keychain (hardware-backed encrypted storage).
// AsyncStorage is kept ONLY as a one-time migration source for users who were
// signed in before this change — their sessions are transparently migrated on
// first read and then removed from AsyncStorage.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';

// Keychain service names — one per role so each has its own encrypted entry.
const STUDENT_KEYCHAIN_SERVICE  = 'markwise.student.session.v2';
const LECTURER_KEYCHAIN_SERVICE = 'markwise.lecturer.session.v2';

// Legacy AsyncStorage keys — read once for migration, then deleted.
const LEGACY_STUDENT_KEY  = 'markwise.student.session.v1';
const LEGACY_LECTURER_KEY = 'markwise.lecturer.session.v1';

// Keychain options — use the highest available security on the device.
const KEYCHAIN_OPTIONS = {
  accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

const authSessionListeners = new Set();

const emitAuthSessionChange = (event) => {
  authSessionListeners.forEach((listener) => {
    try {
      listener(event);
    } catch (error) {
      // Swallow listener errors so one bad listener can't break auth
    }
  });
};

export const subscribeAuthSessionChanges = (listener) => {
  if (typeof listener !== 'function') {
    return () => {};
  }
  authSessionListeners.add(listener);
  return () => {
    authSessionListeners.delete(listener);
  };
};

// ─── Keychain helpers ─────────────────────────────────────────────────────────

const keychainWrite = async (service, session) => {
  // Keychain stores a username + password pair. We use the role as the username
  // and the JSON-serialised session as the password.
  await Keychain.setGenericPassword(session.role, JSON.stringify(session), {
    service,
    ...KEYCHAIN_OPTIONS,
  });
};

const keychainRead = async (service) => {
  try {
    const result = await Keychain.getGenericPassword({ service });
    if (!result || !result.password) return null;
    return JSON.parse(result.password);
  } catch (_) {
    return null;
  }
};

const keychainDelete = async (service) => {
  try {
    await Keychain.resetGenericPassword({ service });
  } catch (_) {}
};

// ─── Migration helper ─────────────────────────────────────────────────────────
// Reads a legacy AsyncStorage session, migrates it to Keychain, then deletes
// the AsyncStorage entry. Safe to call on every app start — no-ops after migration.

const migrateFromAsyncStorage = async (legacyKey, keychainService, expectedRole) => {
  try {
    const raw = await AsyncStorage.getItem(legacyKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.token || parsed?.role !== expectedRole) {
      await AsyncStorage.removeItem(legacyKey);
      return null;
    }
    // Write to Keychain, then remove from AsyncStorage.
    await keychainWrite(keychainService, parsed);
    await AsyncStorage.removeItem(legacyKey);
    return parsed;
  } catch (_) {
    return null;
  }
};

// ─── Field extractors (unchanged) ─────────────────────────────────────────────

const extractToken = (payload) =>
  payload?.accessToken ||
  payload?.token ||
  payload?.jwt ||
  payload?.data?.accessToken ||
  payload?.data?.token ||
  '';

const extractStudent = (payload) =>
  payload?.student || payload?.profile || payload?.user || payload?.data?.student || {};

const extractStudentCourseId = (student) =>
  student?.programId ||
  student?.courseId ||
  student?.course?.id ||
  student?.program?.id ||
  student?.curriculumId ||
  '';

const extractLecturer = (payload) =>
  payload?.lecturer || payload?.profile || payload?.user || payload?.data?.lecturer || {};

// ─── Student session ──────────────────────────────────────────────────────────

export const saveStudentSession = async ({ authPayload, admissionNumberOrEmail }) => {
  const token = String(extractToken(authPayload) || '').trim();
  if (!token) {
    throw new Error('Sign in succeeded but no token was returned by backend');
  }

  const student = extractStudent(authPayload);
  const studentCourseId = String(extractStudentCourseId(student) || '').trim();
  const studentCourseCode = String(
    student?.course?.code || student?.program?.code ||
    student?.courseCode   || student?.programCode  || ''
  ).trim();
  const studentCourseName = String(
    student?.course?.name || student?.program?.name ||
    student?.courseName   || student?.programName  || ''
  ).trim();
  const institutionId = authPayload?.institutionId || student?.institutionId || '';
  const studentId =
    student?.id || student?._id || student?.studentId ||
    authPayload?.id || authPayload?.sub || authPayload?.userId || '';

  const session = {
    role: 'student',
    token,
    studentId: String(studentId),
    admissionNumber: student?.admissionNumber || '',
    studentName: student?.name || student?.fullName || '',
    studentEmail:
      student?.email ||
      (String(admissionNumberOrEmail || '').includes('@')
        ? String(admissionNumberOrEmail).toLowerCase()
        : ''),
    courseId: studentCourseId,
    courseCode: studentCourseCode,
    courseName: studentCourseName,
    programId: studentCourseId,
    institutionId,
    savedAt: Date.now(),
  };

  await keychainWrite(STUDENT_KEYCHAIN_SERVICE, session);
  emitAuthSessionChange({ role: 'student', action: 'saved', session });
  return session;
};

export const getStudentSession = async () => {
  // Try Keychain first
  let session = await keychainRead(STUDENT_KEYCHAIN_SERVICE);

  // One-time migration from legacy AsyncStorage
  if (!session) {
    session = await migrateFromAsyncStorage(
      LEGACY_STUDENT_KEY, STUDENT_KEYCHAIN_SERVICE, 'student',
    );
  }

  if (!session?.token || session?.role !== 'student') {
    await keychainDelete(STUDENT_KEYCHAIN_SERVICE);
    return null;
  }
  return session;
};

export const clearStudentSession = async () => {
  await keychainDelete(STUDENT_KEYCHAIN_SERVICE);
  // Also clear any residual legacy entry
  await AsyncStorage.removeItem(LEGACY_STUDENT_KEY).catch(() => {});
  emitAuthSessionChange({ role: 'student', action: 'cleared' });
};

// ─── Lecturer session ─────────────────────────────────────────────────────────

export const saveLecturerSession = async ({ authPayload, emailOrPhoneNumber }) => {
  const token = String(extractToken(authPayload) || '').trim();
  if (!token) {
    throw new Error('Sign in succeeded but no token was returned by backend');
  }

  const lecturer = extractLecturer(authPayload);
  const identifier = String(emailOrPhoneNumber || '').trim();
  const lecturerId =
    lecturer?.id || lecturer?.lecturerId ||
    authPayload?.lecturerId || authPayload?.id || authPayload?.userId || '';
  const institutionId = authPayload?.institutionId || lecturer?.institutionId || '';

  const session = {
    role: 'lecturer',
    token,
    lecturerId,
    lecturerName: lecturer?.fullName || lecturer?.name || '',
    lecturerEmail:
      lecturer?.email ||
      (identifier.includes('@') ? identifier.toLowerCase() : ''),
    lecturerPhone: lecturer?.phoneNumber || lecturer?.phone || '',
    institutionId,
    savedAt: Date.now(),
  };

  await keychainWrite(LECTURER_KEYCHAIN_SERVICE, session);
  emitAuthSessionChange({ role: 'lecturer', action: 'saved', session });
  return session;
};

export const getLecturerSession = async () => {
  let session = await keychainRead(LECTURER_KEYCHAIN_SERVICE);

  if (!session) {
    session = await migrateFromAsyncStorage(
      LEGACY_LECTURER_KEY, LECTURER_KEYCHAIN_SERVICE, 'lecturer',
    );
  }

  if (!session?.token || session?.role !== 'lecturer') {
    await keychainDelete(LECTURER_KEYCHAIN_SERVICE);
    return null;
  }
  return session;
};

export const clearLecturerSession = async () => {
  await keychainDelete(LECTURER_KEYCHAIN_SERVICE);
  await AsyncStorage.removeItem(LEGACY_LECTURER_KEY).catch(() => {});
  emitAuthSessionChange({ role: 'lecturer', action: 'cleared' });
};

export default {
  saveStudentSession,
  getStudentSession,
  clearStudentSession,
  subscribeAuthSessionChanges,
  saveLecturerSession,
  getLecturerSession,
  clearLecturerSession,
};
