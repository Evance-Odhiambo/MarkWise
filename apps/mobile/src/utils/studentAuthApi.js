import { resolveApiBaseUrl } from './unitsApi';
import { getStudentSession } from './authSession';
import { API_BASE_URL } from './constants';
import { NativeModules } from 'react-native';

const VERIFY_TIMEOUT_MS = 9000;

const parseResponsePayload = async (response) => {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.toLowerCase().includes('application/json')) {
    return response.json();
  }

  const text = await response.text();
  return text ? { message: text } : {};
};

const resolveErrorMessage = (payload, fallback) => {
  if (typeof payload?.message === 'string' && payload.message.trim()) {
    return payload.message;
  }
  if (typeof payload?.error === 'string' && payload.error.trim()) {
    return payload.error;
  }
  return fallback;
};

const resolveStudentName = (payload) => {
  return (
    payload?.name ||
    payload?.fullName ||
    payload?.studentName ||
    payload?.student?.name ||
    payload?.student?.fullName ||
    ''
  );
};

const resolveCourseLabel = (coursePayload) => {
  if (typeof coursePayload === 'string') {
    return coursePayload.trim();
  }

  if (!coursePayload || typeof coursePayload !== 'object') {
    return '';
  }

  return (
    coursePayload?.name ||
    coursePayload?.courseName ||
    coursePayload?.title ||
    coursePayload?.code ||
    ''
  )
    .toString()
    .trim();
};

const resolveStudentCourse = (payload) => {
  const coursePayload =
    payload?.user?.course ||
    payload?.user?.program ||
    payload?.course ||
    payload?.program ||
    payload?.student?.course ||
    payload?.student?.program ||
    payload?.data?.course ||
    payload?.data?.program ||
    payload?.profile?.course ||
    payload?.profile?.program ||
    null;

  const label =
    resolveCourseLabel(coursePayload) ||
    String(
      payload?.courseName ||
        payload?.programName ||
        payload?.studentCourse ||
        payload?.student?.courseName ||
        payload?.student?.programName ||
        ''
    ).trim();

  const courseId = String(
    payload?.courseId ||
      payload?.programId ||
      payload?.user?.courseId ||
      payload?.user?.programId ||
      coursePayload?.id ||
      coursePayload?.courseId ||
      coursePayload?.programId ||
      ''
  ).trim();

  const courseCode = String(
    coursePayload?.code ||
      payload?.courseCode ||
      payload?.programCode ||
      payload?.user?.course?.code ||
      ''
  ).trim();

  return {
    id: courseId,
    code: courseCode,
    name: label,
  };
};

const resolveExists = (payload) => {
  if (typeof payload?.exists === 'boolean') {
    return payload.exists;
  }

  if (typeof payload?.verified === 'boolean') {
    return payload.verified;
  }

  if (typeof payload?.found === 'boolean') {
    return payload.found;
  }

  return Boolean(payload?.student);
};


export const verifyStudentAdmissionNumber = async (admissionNumber, institutionId) => {
  const normalizedAdmissionNumber = String(admissionNumber || '').trim().toUpperCase();
  const normalizedInstitutionId = String(institutionId || '').trim();
  if (!normalizedAdmissionNumber) {
    throw new Error('Admission number is required');
  }
  if (!normalizedInstitutionId) {
    throw new Error('Institution is required');
  }

  const baseUrl = resolveApiBaseUrl();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, VERIFY_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(
      `${baseUrl}/api/students/verify?admissionNumber=${encodeURIComponent(normalizedAdmissionNumber)}&institutionId=${encodeURIComponent(normalizedInstitutionId)}`,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
        signal: controller.signal,
      }
    );
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('Verification timed out. Please try again.');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  const payload = await parseResponsePayload(response);
  if (!response.ok) {
    if (response.status === 400) {
      throw new Error('Invalid admission number format. Use format like SCB211-0156/2025.');
    }
    if (response.status === 504) {
      throw new Error('Verification timed out. Please try again.');
    }
    throw new Error(resolveErrorMessage(payload, `Verification failed: ${response.status}`));
  }
  const exists = resolveExists(payload);

  if (!exists) {
    throw new Error('Student not found for this admission number');
  }

  const fullName = resolveStudentName(payload).trim();
  if (!fullName) {
    throw new Error('Student verified, but name was not provided by backend');
  }

  const course = resolveStudentCourse(payload);

  return {
    admissionNumber: normalizedAdmissionNumber,
    fullName,
    course,
    courseName: course.name,
    raw: payload,
  };
};

export const signUpStudentAccount = async ({ admissionNumber, email, password, courseId, institutionId, campusId }) => {
  const baseUrl = resolveApiBaseUrl();
  const body = {
    admissionNumber: String(admissionNumber || '').trim().toUpperCase(),
    email: String(email || '').trim().toLowerCase(),
    password,
  };

  const normalizedCourseId = String(courseId || '').trim();
  if (normalizedCourseId) {
    body.courseId = normalizedCourseId;
  }
  const normalizedInstitutionId = String(institutionId || '').trim();
  if (normalizedInstitutionId) {
    body.institutionId = normalizedInstitutionId;
  }
  const normalizedCampusId = String(campusId || '').trim();
  if (normalizedCampusId) {
    body.campusId = normalizedCampusId;
  }

  const requestOptions = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  };

  const registerResponse = await fetch(`${baseUrl}/api/auth/register`, requestOptions);
  const registerPayload = await parseResponsePayload(registerResponse);
  if (registerResponse.ok) {
    return registerPayload;
  }

  const shouldFallbackToLegacy = registerResponse.status === 404 || registerResponse.status === 405;
  if (!shouldFallbackToLegacy) {
    throw new Error(resolveErrorMessage(registerPayload, `Sign up failed: ${registerResponse.status}`));
  }

  const legacyResponse = await fetch(`${baseUrl}/api/auth/student/signup`, requestOptions);
  const legacyPayload = await parseResponsePayload(legacyResponse);
  if (!legacyResponse.ok) {
    const fallback = `Sign up failed: ${legacyResponse.status}`;
    throw new Error(resolveErrorMessage(legacyPayload, fallback));
  }

  return legacyPayload;
};

export const signInStudentAccount = async ({ admissionNumberOrEmail, password }) => {
  const baseUrl = resolveApiBaseUrl();
  const response = await fetch(`${baseUrl}/api/auth/student/signin`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      admissionNumberOrEmail: String(admissionNumberOrEmail || '').trim(),
      password,
    }),
  });

  const payload = await parseResponsePayload(response);
  if (!response.ok) {
    throw new Error(resolveErrorMessage(payload, `Sign in failed: ${response.status}`));
  }

  return payload;
};

/**
 * Registers the device's FCM push token with the backend.
 * Called once after student sign-in and on app foreground if already signed in.
 * Fails silently — push notifications are a best-effort feature.
 */
export const registerPushToken = async () => {
  // Guard: native Firebase module is only available after a native rebuild
  // with google-services.json / GoogleService-Info.plist in place.
  // Return silently if it hasn't been linked yet — this is non-fatal.
  if (!NativeModules.RNFBAppModule) return;
  try {
    const { getMessaging, requestPermission, getToken, AuthorizationStatus } =
      require('@react-native-firebase/messaging');
    const messagingInstance = getMessaging();
    const authStatus = await requestPermission(messagingInstance);
    const granted =
      authStatus === AuthorizationStatus.AUTHORIZED ||
      authStatus === AuthorizationStatus.PROVISIONAL;
    if (!granted) return;

    const fcmToken = await getToken(messagingInstance);
    if (!fcmToken) return;

    const session = await getStudentSession();
    if (!session?.token) return;

    await fetch(`${API_BASE_URL}/api/student/push-token`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${session.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fcmToken }),
    });
  } catch (_) {
    // Non-fatal — app works without push notifications
  }
};
