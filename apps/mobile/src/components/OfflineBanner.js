/**
 * OfflineBanner
 *
 * Self-contained offline indicator. Subscribes to NetInfo internally, slides in
 * when the device goes offline, then auto-dismisses after AUTO_DISMISS_MS.
 *
 * Re-fires whenever the `trigger` prop changes (pass a counter that increments
 * whenever the user attempts a network-dependent operation while offline).
 *
 * Usage:
 *   // Basic — always mount, no conditions needed:
 *   <OfflineBanner />
 *
 *   // With re-trigger on network operation:
 *   const { bannerTrigger, triggerBanner } = useOfflineBanner();
 *   // call triggerBanner() when a network op is attempted offline
 *   <OfflineBanner trigger={bannerTrigger} />
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import NetInfo from '@react-native-community/netinfo';

import { useColors } from '../theme';

const AUTO_DISMISS_MS = 4000;
const SLIDE_IN_MS     = 280;
const SLIDE_OUT_MS    = 260;
// Height the banner occupies when fully visible (px). Enough for two short lines.
const BANNER_HEIGHT   = 46;

// ─── Hook ──────────────────────────────────────────────────────────────────
/**
 * Returns helpers for screens that want to re-trigger the banner when the user
 * attempts an operation that requires network while offline.
 *
 *   const { triggerBanner, bannerTrigger } = useOfflineBanner();
 *   // then: <OfflineBanner trigger={bannerTrigger} />
 *   // and: triggerBanner() before bailing out of a network operation
 */
export function useOfflineBanner() {
  const [bannerTrigger, setBannerTrigger] = useState(0);
  const triggerBanner = useCallback(() => setBannerTrigger(t => t + 1), []);
  return { bannerTrigger, triggerBanner };
}

// ─── Component ─────────────────────────────────────────────────────────────
export default function OfflineBanner({
  message = 'You are offline. Some actions require internet.',
  trigger,
}) {
  const colors  = useColors();
  const warning = colors.warning.main;
  const [isOffline, setIsOffline] = useState(false);
  const isOfflineRef = useRef(false);

  // Animated values for slide (height) and fade
  const heightAnim  = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const dismissTimer = useRef(null);
  // Guards against running show/hide while an animation is already in progress
  const isShowing = useRef(false);

  const hide = useCallback(() => {
    clearTimeout(dismissTimer.current);
    Animated.parallel([
      Animated.timing(heightAnim,  { toValue: 0, duration: SLIDE_OUT_MS, useNativeDriver: false }),
      Animated.timing(opacityAnim, { toValue: 0, duration: SLIDE_OUT_MS, useNativeDriver: false }),
    ]).start(() => { isShowing.current = false; });
  }, [heightAnim, opacityAnim]);

  const show = useCallback(() => {
    clearTimeout(dismissTimer.current);
    isShowing.current = true;

    Animated.parallel([
      Animated.timing(heightAnim,  { toValue: BANNER_HEIGHT, duration: SLIDE_IN_MS, useNativeDriver: false }),
      Animated.timing(opacityAnim, { toValue: 1,             duration: SLIDE_IN_MS, useNativeDriver: false }),
    ]).start();

    dismissTimer.current = setTimeout(hide, AUTO_DISMISS_MS);
  }, [heightAnim, opacityAnim, hide]);

  // Subscribe to connectivity changes
  useEffect(() => {
    const handleState = (state) => {
      const online =
        state.isInternetReachable === null || state.isInternetReachable === undefined
          ? !!state.isConnected
          : !!state.isConnected && !!state.isInternetReachable;
      const nowOffline = !online;

      if (nowOffline !== isOfflineRef.current) {
        isOfflineRef.current = nowOffline;
        setIsOffline(nowOffline);
        if (nowOffline) show();
        // When back online, let the auto-dismiss finish naturally
      }
    };

    const unsub = NetInfo.addEventListener(handleState);
    NetInfo.fetch().then(handleState);
    return () => {
      unsub();
      clearTimeout(dismissTimer.current);
    };
  }, [show]);

  // Re-trigger when caller bumps the trigger counter (e.g. network op attempted offline)
  useEffect(() => {
    if (trigger != null && trigger > 0 && isOfflineRef.current) {
      show();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);

  return (
    <Animated.View
      style={[styles.container, { height: heightAnim, opacity: opacityAnim, borderColor: warning }]}
      pointerEvents="none"
    >
      <Text style={styles.text} numberOfLines={2}>{message}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    marginHorizontal: 16,
    marginBottom: 0,
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderRadius: 10,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  text: {
    color: '#92400E',
    fontSize: 13,
    fontWeight: '600',
  },
});
