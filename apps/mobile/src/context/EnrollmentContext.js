// FILE: C:\Users\evanc\Desktop\TrueMark\src\context\EnrollmentContext.js
import React, { createContext, useState, useContext, useEffect, useCallback, useRef, useMemo } from 'react';
import sqliteStorage from '../storage/sqliteStorage';
import { subscribeAuthSessionChanges } from '../utils/authSession';
import { fetchEnrollmentFromBackend, pushEnrollmentToBackend } from '../utils/enrollmentApi';

export const EnrollmentContext = createContext();

export const useEnrollment = () => {
  const context = useContext(EnrollmentContext);
  if (!context) {
    throw new Error('useEnrollment must be used within EnrollmentProvider');
  }
  return context;
};

export function EnrollmentProvider({ children }) {
  const [enrolledUnits, setEnrolledUnits] = useState([]);
  const [unitNamesMap, setUnitNamesMap] = useState({});
  const [selectedYear, setSelectedYear] = useState('1');
  const [selectedSemester, setSelectedSemester] = useState('1');
  const [timetableLastUpdated, setTimetableLastUpdated] = useState(new Date());
  const [isHydrated, setIsHydrated] = useState(false);

  // Tracks the enrollment state at the END of hydration so the auto-push effect
  // can distinguish hydration-caused state changes from user-initiated mutations.
  const hydratedSnapshotRef = useRef(null);
  // Debounce timer ref for auto-push to backend.
  const autoSyncTimerRef = useRef(null);
  // Shared promise for in-progress hydration — concurrent callers await the same
  // network round-trip instead of racing and overwriting each other's state.
  const hydratingPromiseRef = useRef(null);

  const hydrateEnrollment = useCallback(async () => {
    if (hydratingPromiseRef.current) return hydratingPromiseRef.current;

    hydratingPromiseRef.current = (async () => {
    await sqliteStorage.initDatabase();
    const local = await sqliteStorage.getEnrollmentState();

    // Apply local data first so the UI is responsive immediately
    const localUnits = Array.isArray(local?.enrolledUnits) ? local.enrolledUnits : [];
    const localNamesMap = (local?.unitNamesMap && typeof local.unitNamesMap === 'object') ? local.unitNamesMap : {};
    let finalUnits = localUnits;
    let finalNamesMap = localNamesMap;
    let finalYear = local?.selectedYear || '1';
    let finalSemester = local?.selectedSemester || '1';

    setSelectedYear(finalYear);
    setSelectedSemester(finalSemester);
    setEnrolledUnits(finalUnits);
    setUnitNamesMap(finalNamesMap);
    setTimetableLastUpdated(new Date());

    // Then try to pull from backend — use it as the source of truth if available.
    // fetchEnrollmentFromBackend returns null on any error (network, auth, parse) — never throws.
    const remote = await fetchEnrollmentFromBackend();
    if (remote && Array.isArray(remote.unitCodes) && remote.unitCodes.length > 0) {
      finalUnits = remote.unitCodes;
      finalNamesMap = (remote.unitNamesMap && typeof remote.unitNamesMap === 'object')
        ? remote.unitNamesMap
        : localNamesMap;
      finalYear = remote.year ? String(remote.year) : finalYear;
      finalSemester = remote.semester ? String(remote.semester) : finalSemester;

      setEnrolledUnits(finalUnits);
      setUnitNamesMap(finalNamesMap);
      setSelectedYear(finalYear);
      setSelectedSemester(finalSemester);

      // Persist remote data to SQLite immediately — do NOT rely solely on the
      // reactive save effect below, which has not yet run (isHydrated is still false).
      sqliteStorage.saveEnrollmentState({
        selectedYear: finalYear,
        selectedSemester: finalSemester,
        enrolledUnits: finalUnits,
        unitNamesMap: finalNamesMap,
      }).catch(() => {});
    } else if (finalUnits.length > 0) {
      // Backend returned empty / null but local SQLite has data.
      // This happens when a previous push silently failed. Re-upload now so
      // that other devices can restore correctly on their next sign-in.
      pushEnrollmentToBackend(finalUnits, finalNamesMap, finalYear, finalSemester)
        .catch(() => {});
    }

    // Record what we hydrated so the auto-push effect can skip a redundant push.
      hydratedSnapshotRef.current = {
        units: [...finalUnits].sort(),
        year: finalYear,
        semester: finalSemester,
      };

      setIsHydrated(true);
    })();

    try {
      return await hydratingPromiseRef.current;
    } finally {
      hydratingPromiseRef.current = null;
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    const runHydration = async () => {
      try {
        if (isMounted) {
          await hydrateEnrollment();
        }
      } catch (error) {
        console.error('Failed to hydrate enrollment data', error);
      } finally {
        if (isMounted) {
          setIsHydrated(true);
        }
      }
    };

    runHydration();

    const unsubscribe = subscribeAuthSessionChanges((event) => {
      if (!isMounted || event?.role !== 'student') {
        return;
      }

      hydrateEnrollment().catch((error) => {
        console.error('Failed to refresh enrollment data after student session change', error);
      });
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [hydrateEnrollment]);

  // Persist to SQLite whenever enrollment changes.
  // IMPORTANT: Guarded by isHydrated — prevents the initial render's empty state
  // (enrolledUnits=[], ...) from overwriting the real persisted SQLite data before
  // hydrateEnrollment has a chance to read it. Without this guard, every app launch
  // would wipe the local cache on the first render.
  useEffect(() => {
    if (!isHydrated) return;
    sqliteStorage
      .saveEnrollmentState({
        selectedYear,
        selectedSemester,
        enrolledUnits,
        unitNamesMap,
      })
      .catch((error) => {
        console.error('Failed to persist enrollment data', error);
      });
  }, [isHydrated, selectedYear, selectedSemester, enrolledUnits, unitNamesMap]);

  // Auto-push enrollment changes to backend (debounced 2 s) so enrollments survive
  // reinstalls and new devices without requiring the student to press "Save" every time.
  // Skips the initial firing right after hydration (state matches snapshot) to avoid
  // a redundant network round-trip on every app launch.
  useEffect(() => {
    if (!isHydrated) return;

    const snap = hydratedSnapshotRef.current;
    const sortedUnits = [...enrolledUnits].sort();
    const matchesSnapshot =
      snap &&
      selectedYear === snap.year &&
      selectedSemester === snap.semester &&
      sortedUnits.length === snap.units.length &&
      sortedUnits.every((u, i) => u === snap.units[i]);

    if (matchesSnapshot) return; // No user change — skip push

    if (autoSyncTimerRef.current) clearTimeout(autoSyncTimerRef.current);
    autoSyncTimerRef.current = setTimeout(() => {
      pushEnrollmentToBackend(enrolledUnits, unitNamesMap, selectedYear, selectedSemester)
        .catch(() => {}); // Non-critical — data is already safely stored in SQLite
    }, 5000);

    return () => {
      if (autoSyncTimerRef.current) clearTimeout(autoSyncTimerRef.current);
    };
  }, [isHydrated, enrolledUnits, unitNamesMap, selectedYear, selectedSemester]);

  const toggleUnit = useCallback((unit) => {
    setEnrolledUnits((prev) =>
      prev.includes(unit)
        ? prev.filter((u) => u !== unit)
        : [...prev, unit]
    );
    setTimetableLastUpdated(new Date());
  }, []);

  const enrollAllUnits = useCallback((units) => {
    setEnrolledUnits((prev) => [...new Set([...prev, ...units])]);
    setTimetableLastUpdated(new Date());
  }, []);

  const clearAllUnits = useCallback(() => {
    setEnrolledUnits([]);
    setTimetableLastUpdated(new Date());
  }, []);

  const updateUnitNamesMap = useCallback((partial) => {
    if (!partial || typeof partial !== 'object') return;
    setUnitNamesMap(prev => ({ ...prev, ...partial }));
  }, []);

  /**
   * Push the current enrollment state to the backend.
   * Returns { ok: true } on success or throws with a message.
   */
  const syncEnrollment = useCallback(async () => {
    await pushEnrollmentToBackend(enrolledUnits, unitNamesMap, selectedYear, selectedSemester);
  }, [enrolledUnits, unitNamesMap, selectedYear, selectedSemester]);

  const getEnrollmentStats = useCallback(() => {
    return {
      totalEnrolled: enrolledUnits.length,
      year: selectedYear,
      semester: selectedSemester,
      lastUpdated: timetableLastUpdated,
    };
  }, [enrolledUnits.length, selectedYear, selectedSemester, timetableLastUpdated]);

  const contextValue = useMemo(() => ({
    enrolledUnits,
    setEnrolledUnits,
    unitNamesMap,
    updateUnitNamesMap,
    selectedYear,
    setSelectedYear,
    selectedSemester,
    setSelectedSemester,
    timetableLastUpdated,
    setTimetableLastUpdated,
    toggleUnit,
    enrollAllUnits,
    clearAllUnits,
    getEnrollmentStats,
    syncEnrollment,
    rehydrateFromBackend: hydrateEnrollment,
    isHydrated,
  }), [
    enrolledUnits,
    unitNamesMap,
    updateUnitNamesMap,
    selectedYear,
    selectedSemester,
    timetableLastUpdated,
    toggleUnit,
    enrollAllUnits,
    clearAllUnits,
    getEnrollmentStats,
    syncEnrollment,
    hydrateEnrollment,
    isHydrated,
  ]);

  return (
    <EnrollmentContext.Provider value={contextValue}>
      {children}
    </EnrollmentContext.Provider>
  );
}