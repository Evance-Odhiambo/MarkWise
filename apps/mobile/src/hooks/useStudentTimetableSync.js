import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { getStudentSession } from '../utils/authSession';
import {
  buildStudentTimetableEventsUrl,
  fetchStudentTimetableSnapshot,
  fetchStudentExtraSessions,
} from '../utils/studentTimetableApi';
import sqliteStorage from '../storage/sqliteStorage';
import {
  onTimetableUpdated,
  isTimetableDirty,
  clearTimetableDirty,
} from '../utils/notificationEventBus';

const POLLING_INTERVAL_MS = 15000; // Reduced from 30s to 15s for faster updates

export const useStudentTimetableSync = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [timetableByDay, setTimetableByDay] = useState([]);
  const [version, setVersion] = useState(0);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(false);

  const etagRef = useRef('');
  const accessTokenRef = useRef('');
  const pollingTimerRef = useRef(null);
  const eventSourceRef = useRef(null);
  const timetableSubRef = useRef(null);
  const appStateRef = useRef(AppState.currentState);
  const mountedRef = useRef(true);
  const hasCacheRef = useRef(false);

  // ── Core fetch — always uses latest refs ──
  const doFetch = useCallback(async (silent = false) => {
    if (!mountedRef.current) return;
    if (!silent) setIsLoading(true);
    setError('');

    try {
      if (!accessTokenRef.current) {
        const session = await getStudentSession();
        accessTokenRef.current = String(session?.token || '').trim();
      }

      // Fetch regular timetable and make-up sessions in parallel.
      // fetchStudentExtraSessions is non-critical — it always resolves (returns [] on error).
      const [result, extras] = await Promise.all([
        fetchStudentTimetableSnapshot({
          accessToken: accessTokenRef.current,
          etag: etagRef.current,
        }),
        fetchStudentExtraSessions(accessTokenRef.current),
      ]);

      if (!mountedRef.current) return;

      if (result?.etag) etagRef.current = result.etag;

      if (!result?.notModified && result?.snapshot) {
        // Merge make-up sessions into the by-day structure.
        // normalizeEntry derives the day name from the session's `date` field.
        const byDay = [...(Array.isArray(result.snapshot.timetableByDay) ? result.snapshot.timetableByDay : [])];

        // Build Map<day, group>, Map<day, Set<id>>, and Map<day, Set<unitCode|time>>
        // The composite key catches duplicates when the snapshot and the extra-sessions
        // endpoint return the same logical session with different IDs.
        const normCode = (c) => String(c || '').replace(/\s+/g, '').toUpperCase();
        const compositeKey = (l) => `${normCode(l.unitCode)}|${l.time}`;

        const byDayMap = new Map(byDay.map(g => [g.day, g]));
        const existingIdsByDay = new Map(byDay.map(g => [g.day, new Set(g.lessons.map(l => l.id))]));
        const existingKeysByDay = new Map(byDay.map(g => [g.day, new Set(g.lessons.map(compositeKey))]));

        // extras are already normalized at source by fetchStudentExtraSessions
        for (const normalized of (extras || [])) {
          const targetDay = normalized.day || 'Unspecified';
          const ck = compositeKey(normalized);
          const existingGroup = byDayMap.get(targetDay);
          if (existingGroup) {
            const ids = existingIdsByDay.get(targetDay);
            const keys = existingKeysByDay.get(targetDay);
            // Skip if already present by ID or by unitCode+time (catches mismatched IDs across endpoints)
            if (!ids.has(normalized.id) && !keys.has(ck)) {
              existingGroup.lessons.push(normalized);
              ids.add(normalized.id);
              keys.add(ck);
            }
          } else {
            const newGroup = { day: targetDay, lessons: [normalized] };
            byDay.push(newGroup);
            byDayMap.set(targetDay, newGroup);
            existingIdsByDay.set(targetDay, new Set([normalized.id]));
            existingKeysByDay.set(targetDay, new Set([ck]));
          }
        }

        setTimetableByDay(byDay);
        setVersion(Number(result.snapshot.version || 0));
        setUpdatedAt(result.snapshot.updatedAt || null);

        // Persist for offline use
        hasCacheRef.current = true;
        sqliteStorage.saveTimetableCache(byDay).catch(() => {});
      }
    } catch (err) {
      if (mountedRef.current) {
        // Only surface the error if there is no cached data to fall back on
        if (!hasCacheRef.current) {
          setError(err?.message || 'Unable to sync timetable from backend.');
        }
        // Log error but don't block UI if we have cache
        console.warn('[Timetable Sync]', err?.message || 'Sync error');
      }
    } finally {
      if (mountedRef.current && !silent) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    etagRef.current = ''; // Always get full 200 on mount

    const initialize = async () => {
      const session = await getStudentSession();
      if (!mountedRef.current) return;
      accessTokenRef.current = String(session?.token || '').trim();

      // Load cached timetable immediately so offline users see data right away
      const cached = await sqliteStorage.getTimetableCache().catch(() => []);
      if (mountedRef.current && Array.isArray(cached) && cached.length > 0) {
        hasCacheRef.current = true;
        setTimetableByDay(cached);
        setIsLoading(false);
      }

      // If a timetable FCM arrived while killed/background, clear the flag and
      // force a full re-fetch (ignore any cached etag).
      const dirty = await isTimetableDirty();
      if (dirty) {
        await clearTimetableDirty();
        etagRef.current = '';
      }

      await doFetch(!hasCacheRef.current ? false : true);

      if (!mountedRef.current) return;

      // Start polling
      pollingTimerRef.current = setInterval(() => {
        doFetch(true);
      }, POLLING_INTERVAL_MS);

      // Subscribe to foreground FCM timetable events — refresh immediately without
      // waiting for the next polling tick.
      timetableSubRef.current = onTimetableUpdated(() => {
        if (!mountedRef.current) return;
        etagRef.current = ''; // bypass 304 — force a full response
        doFetch(true);
      });
    };

    initialize();

    // Refresh when app returns to foreground; check dirty flag first so we skip
    // the cached etag if a timetable FCM arrived while the app was backgrounded.
    const appStateSub = AppState.addEventListener('change', async (nextState) => {
      if (
        appStateRef.current.match(/inactive|background/) &&
        nextState === 'active' &&
        mountedRef.current
      ) {
        const dirty = await isTimetableDirty();
        if (dirty) {
          await clearTimetableDirty();
          etagRef.current = '';
        }
        doFetch(true);
      }
      appStateRef.current = nextState;
    });

    // Refresh silently when connectivity is restored
    const netInfoUnsub = NetInfo.addEventListener((state) => {
      const isOnline = state.isConnected && (state.isInternetReachable ?? true);
      if (isOnline && mountedRef.current) {
        doFetch(true);
      }
    });

    return () => {
      mountedRef.current = false;
      etagRef.current = '';
      if (pollingTimerRef.current) {
        clearInterval(pollingTimerRef.current);
        pollingTimerRef.current = null;
      }
      if (eventSourceRef.current?.close) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      timetableSubRef.current?.remove();
      timetableSubRef.current = null;
      appStateSub.remove();
      netInfoUnsub();
    };
  }, [doFetch]);

  return {
    isLoading,
    error,
    timetableByDay,
    version,
    updatedAt,
    isRealtimeConnected,
    refresh: () => doFetch(false),
  };
};

export default useStudentTimetableSync;
