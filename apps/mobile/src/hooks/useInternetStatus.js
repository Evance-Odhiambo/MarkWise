
import { useEffect, useState, useCallback } from 'react';
import NetInfo from '@react-native-community/netinfo';

const resolveOnline = (state) => {
  if (state.isInternetReachable === null || state.isInternetReachable === undefined) {
    return !!state.isConnected;
  }
  return !!state.isConnected && !!state.isInternetReachable;
};

export const useInternetStatus = () => {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    const handleState = (state) => setIsOnline(resolveOnline(state));
    const unsubscribe = NetInfo.addEventListener(handleState);
    // Initial check
    NetInfo.fetch().then(handleState);
    return () => unsubscribe();
  }, []);

  return {
    isOnline,
    refresh: () => NetInfo.fetch().then(resolveOnline),
  };
};

export default useInternetStatus;
