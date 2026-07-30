import { API_BASE_URL } from './constants';

const PROBE_URLS = [
  `${API_BASE_URL}/api/health`,
  'https://clients3.google.com/generate_204',
];

const PROBE_TIMEOUT_MS = 4500;

const probeUrl = async (url) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, PROBE_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'text/plain',
      },
      signal: controller.signal,
    });

    return typeof response?.status === 'number';
  } catch (error) {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
};

export const hasInternetConnection = async () => {
  for (const url of PROBE_URLS) {
    const reachable = await probeUrl(url);
    if (reachable) {
      return true;
    }
  }

  return false;
};

export default {
  hasInternetConnection,
};
