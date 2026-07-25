import axios from 'axios';
import { API_BASE_URL } from './constants';
import { getLecturerSession, getStudentSession, subscribeAuthSessionChanges } from './authSession';

export const apiClient = axios.create({
  baseURL: `${API_BASE_URL}/api`,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// In-memory token cache so we hit Keychain at most once per auth cycle,
// not on every HTTP request. Invalidated whenever the session changes.
let _cachedToken = null;

const resolveToken = async () => {
  if (_cachedToken) return _cachedToken;
  // Try lecturer first, then student — mirrors AuthContext.loadSession order.
  let session = await getLecturerSession();
  if (!session?.token) session = await getStudentSession();
  _cachedToken = session?.token || null;
  return _cachedToken;
};

// Bust cache whenever sign-in or sign-out happens.
subscribeAuthSessionChanges(() => {
  _cachedToken = null;
});

apiClient.interceptors.request.use(async (config) => {
  try {
    const token = await resolveToken();
    if (token) config.headers.Authorization = `Bearer ${token}`;
  } catch (_) {}
  return config;
});

// Clear token cache on 401 so the next request re-reads from Keychain.
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401) {
      _cachedToken = null;
    }
    return Promise.reject(error);
  },
);

export default apiClient;
