// useSyncOnReconnect.js
// Calls `onReconnect` once when the device transitions from offline → online.
// Debounced by 1.5 s to avoid hammering the network on flaky connections.

import { useEffect, useRef } from 'react';
import NetInfo from '@react-native-community/netinfo';

const DEBOUNCE_MS = 1500;

/**
 * @param {() => void} onReconnect  Callback to fire when connectivity is restored.
 */
export const useSyncOnReconnect = (onReconnect) => {
  const wasOnlineRef = useRef(null);
  const timerRef = useRef(null);
  const callbackRef = useRef(onReconnect);

  // Always call the latest version of the callback
  useEffect(() => {
    callbackRef.current = onReconnect;
  });

  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => {
      const isOnline = !!(state.isConnected && (state.isInternetReachable ?? true));

      // Fire on first event if online (cold-start with pending records), or on offline→online transition
      if (wasOnlineRef.current !== true && isOnline) {
        // Went offline → online: debounce the sync
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          callbackRef.current?.();
        }, DEBOUNCE_MS);
      }

      wasOnlineRef.current = isOnline;
    });

    return () => {
      unsub();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);
};

export default useSyncOnReconnect;
