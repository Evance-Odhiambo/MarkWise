import React, { useState, useCallback, useRef, useEffect, memo, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
  Animated,
  ScrollView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getLecturerSession } from '../../utils/authSession';
import { API_BASE_URL } from '../../utils/constants';
import useResponsive from '../../hooks/useResponsive';
import { useColors } from '../../theme';

// ─── Palette ──────────────────────────────────────────────────────────────────

const makeGradeColors = (C) => [
  { min: 75, color: C.success, bg: C.successSoft, label: 'On Track' },
  { min: 50, color: C.warning, bg: C.warningSoft, label: 'At Risk' },
  { min: 0,  color: C.danger,  bg: C.dangerSoft,  label: 'Critical' },
];

const getGrade = (pct, gradeColors) => gradeColors.find(g => pct >= g.min) || gradeColors[2];

// ─── Module-level caches — survive component unmount/remount ─────────────────
// Analytics list cache (the main unit list from /api/lecturer/analytics)
const _analyticsCache = { units: null, token: '', timestamp: 0 };
// Per-unit grid cache — keyed by unitCode
const _gridCache = new Map();
// Per-unit student list cache — keyed by unitCode
const _studentCache = new Map();
const STALE_MS = 5 * 60 * 1000; // 5 min TTL before a background refresh fires
const ANALYTICS_PERSIST_KEY = 'markwise.lecturer.analytics.v1';

// ─── Helper: schedule background tasks without InteractionManager ────────────
const scheduleBackgroundTask = (callback, options = { timeout: 2000 }) => {
  if (typeof requestIdleCallback !== 'undefined') {
    const handle = requestIdleCallback(callback, options);
    return () => cancelIdleCallback(handle);
  }
  // Fallback for older environments
  const timeoutId = setTimeout(callback, 50);
  return () => clearTimeout(timeoutId);
};

// ─── Field normalisation ──────────────────────────────────────────────────────
function normalizeUnit(u) {
  if (!u || typeof u !== 'object') return u;

  if (__DEV__) console.log('[Analytics raw unit]', JSON.stringify(u));

  const unitCode =
    u.unitCode ?? u.unit_code ?? u.code ?? u.subject_code ?? u.courseCode ?? u.course_code ?? '';

  const unitName =
    u.unitName ?? u.unit_name ?? u.name ?? u.title ??
    u.subject_name ?? u.courseName ?? u.course_name ?? '';

  const safeNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

  const enrolledStudents = safeNum(
    u.enrolledStudents ?? u.enrolled_students ?? u.enrolled ??
    u.total_enrolled ?? u.studentCount ?? u.student_count ??
    u.totalStudents ?? u.total_students ?? u.numStudents ?? u.num_students,
  );

  const conductedSessions = safeNum(
    u.conductedSessions ?? u.conducted_sessions ??
    u.sessionCount      ?? u.session_count       ??
    u.sessionsCount     ?? u.sessions_count       ??
    u.numSessions       ?? u.num_sessions         ??
    u.sessionsTaken     ?? u.sessions_taken       ??
    u.totalSessions     ?? u.total_sessions       ??
    u.totalConducted    ?? u.total_conducted       ??
    u.lectureCount      ?? u.lecture_count         ??
    u.classCount        ?? u.class_count           ??
    u.conducted         ?? u.sessions,
  );

  const avgAttended = safeNum(
    u.avgAttended        ?? u.avg_attended         ??
    u.avgPresent         ?? u.avg_present           ??
    u.averagePresent     ?? u.average_present       ??
    u.averageAttended    ?? u.average_attended      ??
    u.avgPresentStudents ?? u.avg_present_students  ??
    u.averageAttendance  ?? u.average_attendance    ??
    u.avgAttendance      ?? u.avg_attendance        ??
    u.averageStudents    ?? u.average_students,
  );

  const totalPresent = safeNum(
    u.totalPresent        ?? u.total_present         ??
    u.totalAttended       ?? u.total_attended        ??
    u.presentCount        ?? u.present_count         ??
    u.attendanceCount     ?? u.attendance_count      ??
    u.totalMarked         ?? u.total_marked,
  );

  const resolvedAvg = avgAttended > 0
    ? avgAttended
    : (conductedSessions > 0 && totalPresent > 0
        ? Math.round(totalPresent / conductedSessions)
        : 0);

  let rawPct = safeNum(
    u.attendancePercent   ?? u.attendance_percent  ??
    u.attendanceRate      ?? u.attendance_rate     ??
    u.rate                ?? u.percentage          ??
    u.percent             ?? u.averagePercent      ??
    u.average_percent,
  );

  if (rawPct > 0 && rawPct <= 1) rawPct = rawPct * 100;

  if ((!rawPct || !Number.isFinite(rawPct)) && conductedSessions > 0 && enrolledStudents > 0) {
    const totalPossible = conductedSessions * enrolledStudents;
    const present = totalPresent > 0 ? totalPresent : resolvedAvg * conductedSessions;
    if (present > 0) rawPct = (present / totalPossible) * 100;
  }

  const attendancePercent = Number.isFinite(rawPct) ? Math.min(100, Math.round(rawPct)) : 0;

  return { ...u, unitCode, unitName, enrolledStudents, conductedSessions, avgAttended: resolvedAvg, attendancePercent };
}

// ─── helpers ─────────────────────────────────────────────────────────────────
const toKey = (code) => String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// ─── API ──────────────────────────────────────────────────────────────────────
async function fetchAnalyticsData(token) {
  let list = [];

  try {
    const res = await fetch(`${API_BASE_URL}/api/lecturer/analytics`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Failed to load analytics (${res.status})`);
    const data = await res.json();

    let raw;
    if (Array.isArray(data)) {
      raw = data;
    } else {
      raw = data?.units ?? data?.data?.units ?? data?.data ?? data?.analytics ??
            data?.results ?? data?.items ?? data?.payload ?? data?.list ?? [];
      if (!Array.isArray(raw)) raw = [];
    }
    list = raw.map(normalizeUnit);
  } catch (e) {
    try {
      const { fetchMyLecturerTimetable } = require('../../utils/lecturerTimetableApi');
      const tt = await fetchMyLecturerTimetable(token).catch(() => []);
      const seen = new Set();
      list = [];
      for (const entry of (Array.isArray(tt) ? tt : [])) {
        const code = String(entry?.unitCode || '').trim();
        if (code && !seen.has(code)) {
          seen.add(code);
          list.push(normalizeUnit({ unitCode: code, unitName: entry.unitName || entry.unitTitle || code }));
        }
      }
      if (list.length === 0) throw e;
    } catch (_) {
      if (list.length === 0) throw e;
    }
  }

  // Deduplicate: "SCH2170" and "SCH 2170" are the same unit
  const seen = new Map();
  const deduped = [];
  for (const u of list) {
    const k = toKey(u.unitCode);
    if (!k) { deduped.push(u); continue; }
    if (!seen.has(k)) {
      seen.set(k, deduped.length);
      deduped.push(u);
    } else {
      const idx = seen.get(k);
      if ((u.enrolledStudents ?? 0) > (deduped[idx].enrolledStudents ?? 0)) deduped[idx] = u;
    }
  }
  return deduped;
}

// ─── Progress Bar ─────────────────────────────────────────────────────────────
const ProgressBar = memo(({ percent, color, height = 6, styles }) => {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, { toValue: percent, duration: 800, useNativeDriver: false }).start();
  }, [percent]);
  const width = anim.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'], extrapolate: 'clamp' });
  return (
    <View style={[styles.progressTrack, { height }]}>
      <Animated.View style={[styles.progressFill, { width, backgroundColor: color, height }]} />
    </View>
  );
});

// ─── helpers shared by StudentRow and UnitCard ────────────────────────────────
const safeStudentNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

const extractAttended = (student) => safeStudentNum(
  student.attended        ??
  student.attendedCount   ?? student.attended_count   ??
  student.sessionsAttended ?? student.sessions_attended ??
  student.attendanceCount ?? student.attendance_count  ??
  student.presentCount    ?? student.present_count     ??
  student.markedPresent   ?? student.marked_present    ??
  student.totalAttended   ?? student.total_attended    ??
  student.present,
);

// ─── Student Row ─────────────────────────────────────────────────────────────
const StudentRow = memo(({ student, conducted, rank, attendedOverride, styles, C, gradeColors }) => {
  const attended = (attendedOverride != null) ? attendedOverride : extractAttended(student);
  const effectiveConducted = conducted;
  const pct = effectiveConducted > 0
    ? Math.min(100, Math.round((attended / effectiveConducted) * 100))
    : 0;
  const grade = getGrade(pct, gradeColors);
  const name =
    student.name ?? student.studentName ?? student.student_name ??
    student.fullName ?? student.full_name ?? 'Unknown';
  const admNo =
    student.admissionNumber ?? student.adm_number ??
    student.registration_number ?? student.regNumber ?? '';

  return (
    <View style={styles.studentRow}>
      <View style={[styles.studentRankBadge, { backgroundColor: `${C.primary}18` }]}>
        <Text style={styles.studentRankText}>{rank}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.studentName} numberOfLines={1}>{name}</Text>
        {!!admNo && <Text style={styles.studentAdm}>{admNo}</Text>}
      </View>
      <View style={styles.studentStatsCol}>
        <Text style={[styles.studentPct, { color: grade.color }]}>{pct}%</Text>
        <Text style={styles.studentFraction}>{attended}/{effectiveConducted}</Text>
      </View>
    </View>
  );
});

// ─── Unit Card ────────────────────────────────────────────────────────────────
const UnitCard = memo(({ unit, token, r, onStatsUpdate, styles, C, gradeColors }) => {
  // Initialise directly from module-level cache — no spinner on remount
  const cachedGrid     = _gridCache.get(unit.unitCode);
  const cachedStudents = _studentCache.get(unit.unitCode);

  const [displayStats, setDisplayStats] = useState({
    pct:       unit.attendancePercent ?? 0,
    enrolled:  unit.enrolledStudents  ?? 0,
    conducted: unit.conductedSessions ?? 0,
    avgPresent:unit.avgAttended       ?? 0,
  });

  // Single source of truth for session count — written ONLY by loadGrid
  const gridSessionCountRef  = useRef(cachedGrid ? cachedGrid.sessions.length : 0);
  const gridDataRef          = useRef(cachedGrid ?? null);
  // O(1) student ID → index map built once, reused across renders
  const gridStudentMapRef    = useRef(null);

  const pct      = displayStats.pct;
  const enrolled = displayStats.enrolled;
  const conducted = displayStats.conducted;

  const grade = getGrade(pct, gradeColors);

  const [expanded,       setExpanded]       = useState(false);
  const [students,       setStudents]       = useState(cachedStudents?.list ?? null);
  const [studentsLoading,setStudentsLoading] = useState(false);
  const [studentsError,  setStudentsError]  = useState('');
  const [gridExpanded,   setGridExpanded]   = useState(false);
  const [gridData,       setGridData]       = useState(cachedGrid ?? null);
  const [gridLoading,    setGridLoading]    = useState(false);
  const [gridError,      setGridError]      = useState('');

  const isMountedRef    = useRef(true);
  const studentsFetchRef = useRef(null);
  const gridFetchRef     = useRef(null);
  const backgroundTaskRef = useRef(null);

  // Build the O(1) student map from cached grid on first render
  useEffect(() => {
    if (cachedGrid && !gridStudentMapRef.current) {
      const map = new Map();
      for (let i = 0; i < cachedGrid.students.length; i++) {
        const gs = cachedGrid.students[i];
        const gid = gs.studentId ?? gs.id ?? gs.student_id ??
                    gs.admissionNumber ?? gs.adm_number ?? gs.registration_number;
        if (gid != null) map.set(String(gid), i);
      }
      gridStudentMapRef.current = map;
      gridSessionCountRef.current = cachedGrid.sessions.length;

      // Apply cached grid stats immediately
      const gridTotalPresent = cachedGrid.students.reduce(
        (sum, s) => sum + (s.attendance || []).filter(Boolean).length, 0,
      );
      const sessionCount = cachedGrid.sessions.length;
      const gridAvgPresent = sessionCount > 0 ? Math.round(gridTotalPresent / sessionCount) : 0;
      setDisplayStats(prev => {
        const enrolledForPct = prev.enrolled > 0 ? prev.enrolled : cachedGrid.students.length;
        const gridPct = sessionCount > 0 && enrolledForPct > 0
          ? Math.min(100, Math.round((gridTotalPresent / (sessionCount * enrolledForPct)) * 100))
          : prev.pct;
        return { ...prev, conducted: sessionCount || prev.conducted, pct: gridPct, avgPresent: gridAvgPresent || prev.avgPresent };
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Bubble corrected stats up so the summary banner stays accurate
  useEffect(() => {
    if (onStatsUpdate) onStatsUpdate(unit.unitCode, { conducted: displayStats.conducted, pct: displayStats.pct });
  }, [displayStats.conducted, displayStats.pct]); // eslint-disable-line react-hooks/exhaustive-deps

  // Defer eager grid load until after interactions — prevents N parallel
  // requests firing simultaneously on every screen mount
  // REPLACED InteractionManager.runAfterInteractions with scheduleBackgroundTask
  useEffect(() => {
    isMountedRef.current = true;
    // Skip if we already have cached data that is still fresh
    const cacheAge = cachedGrid ? (Date.now() - (cachedGrid.timestamp ?? 0)) : Infinity;
    if (cachedGrid && cacheAge < STALE_MS) return () => { isMountedRef.current = false; };

    // Schedule background task using requestIdleCallback (fallback to setTimeout)
    backgroundTaskRef.current = scheduleBackgroundTask(() => {
      if (isMountedRef.current) loadGrid();
    }, { timeout: 2000 });

    return () => {
      isMountedRef.current = false;
      if (backgroundTaskRef.current) backgroundTaskRef.current();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Cancel in-flight requests on unmount
  useEffect(() => {
    return () => {
      studentsFetchRef.current?.abort();
      gridFetchRef.current?.abort();
    };
  }, [unit.unitCode]);

  const loadStudents = useCallback(async () => {
    if (students !== null || studentsLoading) return;
    setStudentsLoading(true);
    setStudentsError('');
    try {
      studentsFetchRef.current?.abort();
      const controller = new AbortController();
      studentsFetchRef.current = controller;

      const res = await fetch(
        `${API_BASE_URL}/api/lecturer/units/${encodeURIComponent(unit.unitCode)}/attendance`,
        { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: controller.signal },
      );
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();

      const rawList = Array.isArray(data) ? data
        : Array.isArray(data?.students)  ? data.students
        : Array.isArray(data?.data)       ? data.data
        : Array.isArray(data?.attendance) ? data.attendance
        : Array.isArray(data?.records)    ? data.records
        : [];

      // Deduplicate by student ID
      const seenStudentIds = new Map();
      const list = [];
      for (const s of rawList) {
        const sid = s.studentId ?? s.id ?? s.student_id ?? s.admissionNumber ?? s.adm_number ?? s.registration_number;
        if (sid == null) { list.push(s); continue; }
        const k = String(sid);
        if (!seenStudentIds.has(k)) {
          seenStudentIds.set(k, list.length);
          list.push(s);
        } else {
          const idx = seenStudentIds.get(k);
          if (extractAttended(s) > extractAttended(list[idx])) list[idx] = s;
        }
      }

      const conductedFromEnvelope = Number(
        data?.conductedSessions ?? data?.conducted_sessions ??
        data?.sessionCount      ?? data?.session_count      ??
        data?.totalSessions     ?? data?.total_sessions     ?? 0,
      );
      const conductedValues = list
        .map(s => Number(
          s.conducted ?? s.conductedSessions ?? s.conducted_sessions ??
          s.totalSessions ?? s.total_sessions ?? s.sessionCount ?? s.session_count ?? s.sessions ?? 0,
        ))
        .filter(n => n > 0);
      const derivedConducted = conductedFromEnvelope > 0
        ? conductedFromEnvelope
        : (conductedValues.length ? Math.max(...conductedValues) : (unit.conductedSessions ?? 0));

      const sortedList = [...list].sort((a, b) => {
        const ca = derivedConducted > 0 ? derivedConducted : 1;
        return (
          Math.round((extractAttended(b) / ca) * 100) -
          Math.round((extractAttended(a) / ca) * 100)
        );
      });

      const currentGridData = gridDataRef.current;
      const conductedForCalcs =
        gridSessionCountRef.current > 0 ? gridSessionCountRef.current : derivedConducted;
      const derivedEnrolled = list.length || (unit.enrolledStudents ?? 0);

      let derivedAvgPresent, derivedPct;

      if (currentGridData && currentGridData.students.length > 0 && gridStudentMapRef.current) {
        // O(1) map lookup — avoids O(n²) find loop
        let gridTotalPresent = 0;
        for (const s of list) {
          const sid = s.studentId ?? s.id ?? s.student_id ??
                      s.admissionNumber ?? s.adm_number ?? s.registration_number;
          if (sid == null) continue;
          const gridIdx = gridStudentMapRef.current.get(String(sid));
          if (gridIdx !== undefined) {
            gridTotalPresent += (currentGridData.students[gridIdx].attendance || []).filter(Boolean).length;
          }
        }
        derivedAvgPresent = conductedForCalcs > 0
          ? Math.round(gridTotalPresent / conductedForCalcs)
          : (unit.avgAttended ?? 0);
        derivedPct = conductedForCalcs > 0 && derivedEnrolled > 0
          ? Math.min(100, Math.round((gridTotalPresent / (conductedForCalcs * derivedEnrolled)) * 100))
          : (unit.attendancePercent ?? 0);
      } else {
        const totalAttended = list.reduce((s, st) => s + extractAttended(st), 0);
        derivedAvgPresent = conductedForCalcs > 0
          ? Math.round(totalAttended / conductedForCalcs)
          : (unit.avgAttended ?? 0);
        derivedPct = conductedForCalcs > 0 && derivedEnrolled > 0
          ? Math.min(100, Math.round((totalAttended / (conductedForCalcs * derivedEnrolled)) * 100))
          : (unit.attendancePercent ?? 0);
      }

      setDisplayStats(prev => ({
        ...prev,
        pct:       derivedPct,
        enrolled:  derivedEnrolled,
        conducted: gridSessionCountRef.current > 0 ? gridSessionCountRef.current
                 : (prev.conducted > derivedConducted ? prev.conducted : derivedConducted),
        avgPresent: derivedAvgPresent,
      }));

      // Persist to module-level cache
      _studentCache.set(unit.unitCode, { list: sortedList, timestamp: Date.now() });
      if (isMountedRef.current) setStudents(sortedList);
    } catch (e) {
      if (e.name !== 'AbortError' && isMountedRef.current) {
        setStudentsError(e.message || 'Failed to load');
      }
    } finally {
      if (isMountedRef.current) setStudentsLoading(false);
    }
  }, [students, studentsLoading, unit, token]);

  const handleToggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && students === null) {
      loadStudents();
      loadGrid();
    }
  };

  const loadGrid = useCallback(async () => {
    if (gridData !== null || gridLoading) return;
    setGridLoading(true);
    setGridError('');
    try {
      gridFetchRef.current?.abort();
      const controller = new AbortController();
      gridFetchRef.current = controller;

      const res = await fetch(
        `${API_BASE_URL}/api/lecturer/units/${encodeURIComponent(unit.unitCode)}/attendance/grid`,
        { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: controller.signal },
      );
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();

      let rawSessions = Array.isArray(data?.sessions)      ? data.sessions
        : Array.isArray(data?.lectureLabels)               ? data.lectureLabels
        : Array.isArray(data?.sessionLabels)               ? data.sessionLabels
        : Array.isArray(data?.lectures)                    ? data.lectures
        : Array.isArray(data?.labels)                      ? data.labels
        : [];

      // Deduplicate sessions
      {
        const seenSessIds  = new Set();
        const seenSessStrs = new Set();
        rawSessions = rawSessions.filter(s => {
          if (!s || typeof s !== 'object') {
            const str = String(s ?? '').trim();
            if (!str || seenSessStrs.has(str)) return false;
            seenSessStrs.add(str);
            return true;
          }
          const id = s.sessionId ?? s.id ?? s.session_id;
          if (id == null) return true;
          const k = String(id);
          if (seenSessIds.has(k)) return false;
          seenSessIds.add(k);
          return true;
        });
      }

      const rawStudentRows = Array.isArray(data?.students)  ? data.students
        : Array.isArray(data?.data)                         ? data.data
        : Array.isArray(data?.rows)                         ? data.rows
        : Array.isArray(data?.attendance)                   ? data.attendance
        : [];

      // Deduplicate grid students
      const seenGridIds = new Map();
      const studentRows = [];
      for (const s of rawStudentRows) {
        const sid = s.studentId ?? s.id ?? s.student_id ?? s.admissionNumber ?? s.adm_number ?? s.registration_number;
        if (sid == null) { studentRows.push(s); continue; }
        const k = String(sid);
        if (!seenGridIds.has(k)) {
          seenGridIds.set(k, studentRows.length);
          studentRows.push(s);
        }
      }

      const inferredCount = studentRows.length > 0
        ? Math.max(0, ...studentRows.map(s => (Array.isArray(s.attendance) ? s.attendance.length : 0)))
        : 0;
      const sessionCount = rawSessions.length > 0 ? rawSessions.length : inferredCount;

      const normalizedSessions = rawSessions.length > 0
        ? rawSessions.map((s, i) => {
            if (s && typeof s === 'object') {
              const objLabel =
                s.label ?? s.name ?? s.title ?? s.sessionLabel ?? s.session_label ??
                s.sessionType ?? s.lessonType ?? s.type ?? null;
              if (objLabel) { const ls = String(objLabel).trim(); if (ls) return ls; }
              const dateVal =
                s.date ?? s.sessionDate ?? s.session_date ??
                s.createdAt ?? s.created_at ?? s.startTime ?? s.start_time ?? null;
              if (dateVal) {
                try {
                  const d = new Date(dateVal);
                  if (!isNaN(d.getTime()))
                    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
                } catch (_) {}
              }
              return `LEC ${i + 1}`;
            }
            const str = String(s ?? '').trim();
            return (str && str.length <= 12) ? str : `LEC ${i + 1}`;
          })
        : Array.from({ length: sessionCount }, (_, i) => `LEC ${i + 1}`);

      const sessionIds = rawSessions.map((s, i) => {
        if (s && typeof s === 'object') return s.sessionId ?? s.id ?? s.session_id ?? i;
        return i;
      });

      const resolveValue = (v) => {
        if (v === undefined || v === null) return false;
        if (typeof v === 'boolean') return v;
        if (typeof v === 'number') return v !== 0;
        if (typeof v === 'object') {
          const inner = v.attended ?? v.present ?? v.status ?? v.value;
          if (inner !== undefined) return resolveValue(inner);
          return false;
        }
        const s = String(v).trim().toUpperCase();
        return s === 'P' || s === 'TRUE' || s === '1' || s === 'YES' || s === 'PRESENT';
      };

      const normalizedStudents = studentRows.map(student => ({
        ...student,
        attendance: Array.from({ length: sessionCount }, (_, i) => {
          const sessId = sessionIds[i];
          if (student.records && typeof student.records === 'object') {
            const v = student.records[sessId] ?? student.records[String(sessId)];
            if (v !== undefined) return resolveValue(v);
          }
          const arr = Array.isArray(student.attendance) ? student.attendance
            : Array.isArray(student.sessions) ? student.sessions
            : Array.isArray(student.present) ? student.present
            : null;
          return arr ? resolveValue(arr[i]) : false;
        }),
      }));

      if (sessionCount > 0) gridSessionCountRef.current = sessionCount;

      const resolvedGridData = { sessions: normalizedSessions, students: normalizedStudents, timestamp: Date.now() };
      gridDataRef.current = resolvedGridData;

      // Build O(1) ID→index map for this grid
      const gridStudentMap = new Map();
      for (let i = 0; i < normalizedStudents.length; i++) {
        const gs = normalizedStudents[i];
        const gid = gs.studentId ?? gs.id ?? gs.student_id ??
                    gs.admissionNumber ?? gs.adm_number ?? gs.registration_number;
        if (gid != null) gridStudentMap.set(String(gid), i);
      }
      gridStudentMapRef.current = gridStudentMap;

      const gridTotalPresent = normalizedStudents.reduce(
        (sum, s) => sum + (s.attendance || []).filter(Boolean).length, 0,
      );
      const gridAvgPresent = sessionCount > 0 ? Math.round(gridTotalPresent / sessionCount) : 0;

      setDisplayStats(prev => {
        const enrolledForPct = prev.enrolled > 0 ? prev.enrolled : normalizedStudents.length;
        const gridPct = sessionCount > 0 && enrolledForPct > 0
          ? Math.min(100, Math.round((gridTotalPresent / (sessionCount * enrolledForPct)) * 100))
          : prev.pct;
        return {
          ...prev,
          conducted:  sessionCount > 0 ? sessionCount : prev.conducted,
          pct:        gridPct,
          avgPresent: gridAvgPresent > 0 ? gridAvgPresent : prev.avgPresent,
        };
      });

      // Persist to module-level grid cache
      _gridCache.set(unit.unitCode, resolvedGridData);
      if (isMountedRef.current) setGridData(resolvedGridData);
    } catch (e) {
      if (e.name !== 'AbortError' && isMountedRef.current) {
        setGridError(e.message || 'Failed to load');
      }
    } finally {
      if (isMountedRef.current) setGridLoading(false);
    }
  }, [gridData, gridLoading, unit, token]);

  const handleGridToggle = () => {
    const next = !gridExpanded;
    setGridExpanded(next);
    if (next && gridData === null) loadGrid();
  };

  return (
    <View style={[styles.card, { borderRadius: r.cardRad, padding: r.pad }]}>
      {/* Header row */}
      <View style={styles.cardHeader}>
        <View style={[styles.codeChip, { backgroundColor: `${C.primary}20` }]}>
          <Text style={styles.codeChipText}>{unit.unitCode}</Text>
        </View>
        <View style={[styles.gradeBadge, { backgroundColor: grade.bg }]}>
          <View style={[styles.gradeDot, { backgroundColor: grade.color }]} />
          <Text style={[styles.gradeLabel, { color: grade.color }]}>{grade.label}</Text>
        </View>
      </View>

      {!!unit.unitName && (
        <Text style={[styles.unitName, { fontSize: r.bodySize }]} numberOfLines={2}>
          {unit.unitName}
        </Text>
      )}

      <View style={styles.barSection}>
        <View style={styles.barLabelRow}>
          <Text style={styles.barLabel}>Attendance</Text>
          <Text style={[styles.barPercent, { color: grade.color }]}>{pct}%</Text>
        </View>
        <ProgressBar percent={pct} color={grade.color} styles={styles} />
      </View>

      <View style={styles.statsRow}>
        <View style={styles.statItem}>
          <Icon name="account-group-outline" size={16} color={C.info} />
          <Text style={styles.statValue}>{enrolled}</Text>
          <Text style={styles.statLabel}>Students</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Icon name="calendar-check-outline" size={16} color={C.primary} />
          <Text style={styles.statValue}>{conducted}</Text>
          <Text style={styles.statLabel}>Sessions</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Icon name="account-check-outline" size={16} color={C.success} />
          <Text style={styles.statValue}>{displayStats.avgPresent}</Text>
          <Text style={styles.statLabel}>Avg Present</Text>
        </View>
      </View>

      <View style={styles.expandBtnRow}>
        <TouchableOpacity style={styles.expandBtnHalf} onPress={handleToggle} activeOpacity={0.7}>
          <Icon name="account-group-outline" size={14} color={C.primary} />
          <Text style={styles.expandBtnText}>
            {expanded ? 'Hide Students' : `Students (${enrolled})`}
          </Text>
          <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={C.primary} />
        </TouchableOpacity>
        <View style={styles.expandBtnDivider} />
        <TouchableOpacity style={styles.expandBtnHalf} onPress={handleGridToggle} activeOpacity={0.7}>
          <Icon name="table-large" size={14} color={C.info} />
          <Text style={[styles.expandBtnText, { color: C.info }]}>
            {gridExpanded ? 'Hide Grid' : 'Attendance Grid'}
          </Text>
          <Icon name={gridExpanded ? 'chevron-up' : 'chevron-down'} size={14} color={C.info} />
        </TouchableOpacity>
      </View>

      {/* Students panel */}
      {expanded && (
        <View style={styles.studentsPanel}>
          <View style={styles.studentHeader}>
            <Text style={[styles.studentHeaderText, { marginLeft: 38 }]}>Student</Text>
            <Text style={styles.studentHeaderText}>Attended / Sessions</Text>
          </View>

          {studentsLoading && (
            <ActivityIndicator size="small" color={C.primary} style={{ marginVertical: 14 }} />
          )}

          {!!studentsError && !studentsLoading && (
            <View style={styles.studentsErrorRow}>
              <Icon name="alert-circle-outline" size={14} color={C.danger} />
              <Text style={styles.studentsErrorText}>
                Could not load student list ({studentsError})
              </Text>
              <TouchableOpacity onPress={() => { setStudents(null); loadStudents(); }}>
                <Text style={styles.studentsRetry}>Retry</Text>
              </TouchableOpacity>
            </View>
          )}

          {students !== null && students.length === 0 && !studentsLoading && (
            <Text style={styles.studentsEmpty}>No student records found for this unit.</Text>
          )}

          {(students || []).map((student, i) => {
            // O(1) map lookup — no .find() in the hot render path
            let attendedOverride = null;
            const conductedOverride =
              gridSessionCountRef.current > 0 ? gridSessionCountRef.current
              : (gridData !== null && gridData.sessions.length > 0 ? gridData.sessions.length
              : conducted);

            if (gridData !== null && gridStudentMapRef.current) {
              const sid =
                student.studentId ?? student.id ?? student.student_id ??
                student.admissionNumber ?? student.adm_number ?? student.registration_number;
              if (sid != null) {
                const gridIdx = gridStudentMapRef.current.get(String(sid));
                if (gridIdx !== undefined) {
                  attendedOverride = (gridData.students[gridIdx].attendance || []).filter(Boolean).length;
                }
              }
            }

            return (
              <StudentRow
                key={student.studentId ?? student.id ?? i}
                student={student}
                conducted={conductedOverride}
                rank={i + 1}
                attendedOverride={attendedOverride}
                styles={styles}
                C={C}
                gradeColors={gradeColors}
              />
            );
          })}
        </View>
      )}

      {/* Attendance Grid panel */}
      {gridExpanded && (
        <View style={styles.gridPanel}>
          {gridLoading && (
            <ActivityIndicator size="small" color={C.info} style={{ marginVertical: 14 }} />
          )}

          {!!gridError && !gridLoading && (
            <View style={styles.gridErrorRow}>
              <Icon name="alert-circle-outline" size={14} color={C.danger} />
              <Text style={styles.gridErrorText}>Could not load grid ({gridError})</Text>
              <TouchableOpacity onPress={() => { setGridData(null); _gridCache.delete(unit.unitCode); loadGrid(); }}>
                <Text style={styles.gridRetry}>Retry</Text>
              </TouchableOpacity>
            </View>
          )}

          {gridData !== null && !gridLoading && (
            gridData.students.length === 0 ? (
              <Text style={styles.gridEmpty}>No attendance records found.</Text>
            ) : (
              <View style={styles.gridWrapper}>
                <View>
                  <View style={[styles.gridRow, styles.gridHeaderStrip]}>
                    <Text style={[styles.gridHCell, styles.gridStudentCol]}>STUDENT</Text>
                  </View>
                  {gridData.students.map((student, i) => {
                    const fullName = (
                      student.name ?? student.studentName ?? student.student_name ??
                      student.fullName ?? student.full_name ?? ''
                    ).trim();
                    const admNo = (
                      student.admissionNumber ?? student.adm_number ?? student.admNo ??
                      student.adm_no ?? student.admission_no ?? student.registrationNumber ??
                      student.registration_number ?? student.reg_number ?? student.regNumber ?? ''
                    ).trim();
                    return (
                      <View key={i} style={[styles.gridStudentCell, i % 2 === 1 && styles.gridRowAlt]}>
                        <Text style={styles.gridStudentName} numberOfLines={1}>
                          {fullName || admNo || 'Unknown'}
                        </Text>
                        {!!admNo && <Text style={styles.gridStudentAdm} numberOfLines={1}>{admNo}</Text>}
                      </View>
                    );
                  })}
                </View>

                <View style={styles.gridColSep} />

                <ScrollView horizontal showsHorizontalScrollIndicator style={{ flex: 1 }}>
                  <View>
                    <View style={[styles.gridRow, styles.gridHeaderStrip]}>
                      {gridData.sessions.map((sess, i) => (
                        <Text key={i} style={[styles.gridHCell, styles.gridSessCol]}>{sess}</Text>
                      ))}
                      <Text style={[styles.gridHCell, styles.gridTotalsCol]}>PRES / TOT</Text>
                    </View>
                    {gridData.students.map((student, rowIdx) => {
                      const attendance  = student.attendance ?? [];
                      const presentCount = attendance.filter(Boolean).length;
                      const totalCount   = gridData.sessions.length;
                      const pctRow = totalCount > 0 ? presentCount / totalCount : 0;
                      return (
                        <View key={rowIdx} style={[styles.gridRow, rowIdx % 2 === 1 && styles.gridRowAlt]}>
                          {attendance.map((present, colIdx) => (
                            <View key={colIdx} style={styles.gridTickCell}>
                              <Icon
                                name={present ? 'check-circle' : 'close-circle'}
                                size={15}
                                color={present ? C.success : C.danger}
                              />
                            </View>
                          ))}
                          <View style={styles.gridTotalsCell}>
                            <Text style={[
                              styles.gridTotalsText,
                              { color: pctRow >= 0.75 ? C.success : pctRow >= 0.5 ? C.warning : C.danger },
                            ]}>
                              {presentCount}/{totalCount}
                            </Text>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                </ScrollView>
              </View>
            )
          )}
        </View>
      )}
    </View>
  );
});

// ─── Screen ───────────────────────────────────────────────────────────────────
const AnalyticsScreen = () => {
  const { isTablet, isDesktop, contentMaxWidth, r } = useResponsive();
  const colors = useColors();
  const C = useMemo(() => ({
    primary:       colors.primary.main,
    primaryDk:     colors.primary.dark,
    success:       colors.success.main,
    successSoft:   colors.success.soft,
    warning:       colors.warning.main,
    warningSoft:   colors.warning.soft,
    danger:        colors.danger.main,
    dangerSoft:    colors.danger.soft,
    info:          colors.info.main,
    infoSoft:      colors.info.soft,
    bg:            colors.background.primary,
    surface:       colors.surface.primary,
    surfaceAlt:    colors.surface.secondary,
    border:        colors.border.light,
    textPrimary:   colors.text.primary,
    textSecondary: colors.text.secondary,
    textMuted:     colors.text.muted,
  }), [colors]);
  const styles = useMemo(() => makeStyles(C), [C]);
  const gradeColors = useMemo(() => makeGradeColors(C), [C]);

  // Initialise from module-level cache so the screen is never blank on remount
  const [units,              setUnits]              = useState(_analyticsCache.units ?? []);
  const [token,              setToken]              = useState(_analyticsCache.token ?? '');
  const [loading,            setLoading]            = useState(!_analyticsCache.units);
  const [refreshing,         setRefreshing]         = useState(false);
  const [isBackgroundUpdate, setIsBackgroundUpdate] = useState(false);
  const [error,              setError]              = useState('');
  const [lastRefreshed,      setLastRefreshed]      = useState(_analyticsCache.timestamp ?? 0);
  const [unitOverrides,      setUnitOverrides]      = useState({});

  const isMountedRef = useRef(true);
  const backgroundTaskRef = useRef(null);

  // Seed from AsyncStorage on first mount so data shows while the network call is in flight.
  useEffect(() => {
    if (_analyticsCache.units) return;
    AsyncStorage.getItem(ANALYTICS_PERSIST_KEY).then(raw => {
      if (!raw || _analyticsCache.units) return;
      const persisted = JSON.parse(raw);
      if (Array.isArray(persisted.units) && persisted.units.length > 0) {
        _analyticsCache.units = persisted.units;
        _analyticsCache.timestamp = persisted.timestamp ?? 0;
        if (isMountedRef.current) {
          setUnits(persisted.units);
          setLastRefreshed(persisted.timestamp ?? 0);
          setLoading(false);
        }
      }
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStatsUpdate = useCallback((unitCode, stats) => {
    setUnitOverrides(prev => ({ ...prev, [unitCode]: stats }));
  }, []);

  const load = useCallback(async (isRefresh = false) => {
    const cacheAge    = Date.now() - (_analyticsCache.timestamp ?? 0);
    const hasFreshCache = _analyticsCache.units && cacheAge < STALE_MS;

    if (isRefresh) {
      setRefreshing(true);
    } else if (!hasFreshCache || !_analyticsCache.units) {
      setLoading(true);
    } else {
      // Cache is warm — refresh silently without blocking the UI
      setIsBackgroundUpdate(true);
    }

    setError('');
    try {
      const session = await getLecturerSession();
      if (!session?.token) throw new Error('Please sign in to view analytics.');

      // Update cached token for UnitCards that restore from cache
      _analyticsCache.token = session.token;
      if (isMountedRef.current) setToken(session.token);

      const data = await fetchAnalyticsData(session.token);

      _analyticsCache.units     = data;
      _analyticsCache.timestamp = Date.now();

      if (isMountedRef.current) {
        setUnits(data);
        setLastRefreshed(Date.now());
        if (isRefresh) setUnitOverrides({});
      }

      AsyncStorage.setItem(
        ANALYTICS_PERSIST_KEY,
        JSON.stringify({ units: data, timestamp: Date.now() }),
      ).catch(() => {});
    } catch (e) {
      // If in-memory cache is available, swallow silently — stale data > empty screen.
      const hasCache = _analyticsCache.units && _analyticsCache.units.length > 0;
      if (!hasCache) {
        // Try AsyncStorage as offline fallback.
        try {
          const raw = await AsyncStorage.getItem(ANALYTICS_PERSIST_KEY);
          if (raw) {
            const persisted = JSON.parse(raw);
            if (Array.isArray(persisted.units) && persisted.units.length > 0) {
              _analyticsCache.units = persisted.units;
              _analyticsCache.timestamp = persisted.timestamp ?? 0;
              if (isMountedRef.current) {
                setUnits(persisted.units);
                setLastRefreshed(persisted.timestamp ?? 0);
              }
              // Don't surface the error — cached data is showing.
              return;
            }
          }
        } catch (_) {}
        if (isMountedRef.current) setError(e.message || 'Failed to load analytics');
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
        setRefreshing(false);
        setIsBackgroundUpdate(false);
      }
    }
  }, []);

  // REPLACED InteractionManager.runAfterInteractions with scheduleBackgroundTask
  useFocusEffect(useCallback(() => {
    isMountedRef.current = true;

    const cacheAge    = Date.now() - (_analyticsCache.timestamp ?? 0);
    const hasFreshCache = _analyticsCache.units && cacheAge < STALE_MS;

    if (!hasFreshCache) {
      // No cache or cache is stale — do a visible load
      load();
    } else {
      // Cache is fresh — restore immediately and refresh quietly in the background
      if (units.length === 0 && _analyticsCache.units.length > 0) {
        setUnits(_analyticsCache.units);
        setToken(_analyticsCache.token);
        setLastRefreshed(_analyticsCache.timestamp);
      }
      // Still fire a background refresh so data stays current
      // Using scheduleBackgroundTask instead of InteractionManager
      backgroundTaskRef.current = scheduleBackgroundTask(() => {
        if (isMountedRef.current) load();
      }, { timeout: 2000 });

      return () => {
        isMountedRef.current = false;
        if (backgroundTaskRef.current) backgroundTaskRef.current();
      };
    }

    return () => { isMountedRef.current = false; };
  }, [load, units.length]));

  // Aggregate totals — prefer corrected values reported back by each UnitCard
  const totalEnrollments = units.reduce((s, u) => s + (u.enrolledStudents ?? 0), 0);
  const totalSessions    = units.reduce((s, u) => {
    const override = unitOverrides[u.unitCode];
    return s + (override?.conducted ?? u.conductedSessions ?? 0);
  }, 0);
  const gridsReady = Object.keys(unitOverrides).length > 0;
  const overallPct = units.length
    ? (() => {
        let weightedSum = 0, weightTotal = 0;
        for (const u of units) {
          const override = unitOverrides[u.unitCode];
          const p = override?.pct ?? u.attendancePercent ?? 0;
          const w = override?.conducted ?? u.conductedSessions ?? 0;
          if (w <= 0) continue;
          weightedSum += p * w;
          weightTotal += w;
        }
        return weightTotal > 0 ? Math.round(weightedSum / weightTotal) : 0;
      })()
    : 0;
  const overallGrade = getGrade(overallPct, gradeColors);

  const lastRefreshedLabel = lastRefreshed
    ? new Date(lastRefreshed).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;

  if (loading && !refreshing) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={C.primary} />
        <Text style={styles.loadingText}>Loading analytics…</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <FlatList
        data={units}
        keyExtractor={(item, i) => item.unitCode ?? String(i)}
        contentContainerStyle={[
          styles.listContent,
          { paddingHorizontal: r.pad },
          (isTablet || isDesktop) && { maxWidth: contentMaxWidth, alignSelf: 'center', width: '100%' },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => load(true)}
            tintColor={C.primary}
            colors={[C.primary]}
          />
        }
        ListHeaderComponent={
          <>
            {/* Summary banner */}
            <LinearGradient
              colors={[C.primary, C.primaryDk]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[styles.banner, { borderRadius: r.cardRad }]}
            >
              <View style={styles.bannerTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.bannerTitle}>Teaching Analytics</Text>
                  <View style={styles.bannerSubRow}>
                    <Text style={styles.bannerSubtitle}>
                      {units.length} unit{units.length !== 1 ? 's' : ''} assigned
                    </Text>
                    {isBackgroundUpdate && (
                      <View style={styles.bgUpdateDot} />
                    )}
                    {!isBackgroundUpdate && lastRefreshedLabel && (
                      <Text style={styles.bannerRefreshedAt}>Updated {lastRefreshedLabel}</Text>
                    )}
                  </View>
                </View>
                <View style={styles.bannerRing}>
                  <Text style={styles.bannerPct}>
                    {gridsReady ? `${overallPct}%` : '—'}
                  </Text>
                  <Text style={styles.bannerPctLabel}>Overall</Text>
                </View>
              </View>

              <View style={styles.bannerStats}>
                <View style={styles.bannerStat}>
                  <Text style={styles.bannerStatValue}>{totalEnrollments || '—'}</Text>
                  <Text style={styles.bannerStatLabel}>Enrollments</Text>
                </View>
                <View style={styles.bannerStatDivider} />
                <View style={styles.bannerStat}>
                  <Text style={styles.bannerStatValue}>
                    {gridsReady ? totalSessions : '—'}
                  </Text>
                  <Text style={styles.bannerStatLabel}>Sessions</Text>
                </View>
                <View style={styles.bannerStatDivider} />
                <View style={styles.bannerStat}>
                  <Text style={[styles.bannerStatValue, { color: gridsReady ? overallGrade.color : C.textSecondary }]}>
                    {gridsReady ? overallGrade.label : 'Loading…'}
                  </Text>
                  <Text style={styles.bannerStatLabel}>Status</Text>
                </View>
              </View>
            </LinearGradient>

            <Text style={[styles.sectionTitle, { fontSize: r.bodySize + 2 }]}>Unit Breakdown</Text>

            {!!error && (
              <View style={styles.errorBanner}>
                <Icon name="alert-circle-outline" size={18} color={C.danger} />
                <Text style={styles.errorText}>{error}</Text>
                <TouchableOpacity onPress={() => load()}>
                  <Text style={styles.retryLink}>Retry</Text>
                </TouchableOpacity>
              </View>
            )}
          </>
        }
        renderItem={({ item }) => (
          <UnitCard unit={item} token={token} r={r} onStatsUpdate={handleStatsUpdate} styles={styles} C={C} gradeColors={gradeColors} />
        )}
        ListEmptyComponent={
          !error ? (
            <View style={styles.emptyWrap}>
              <Icon name="chart-box-outline" size={56} color={C.textMuted} />
              <Text style={styles.emptyTitle}>No Analytics Yet</Text>
              <Text style={styles.emptyText}>
                Conduct attendance sessions to see unit analytics here.
              </Text>
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const makeStyles = (C) => StyleSheet.create({
  screen:      { flex: 1, backgroundColor: C.bg },
  centered:    { flex: 1, backgroundColor: C.bg, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: C.textSecondary, marginTop: 12, fontSize: 14 },
  listContent: { paddingTop: 16, paddingBottom: 32 },

  // Banner
  banner:           { padding: 20, marginBottom: 20 },
  bannerTop:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  bannerTitle:      { fontSize: 22, fontWeight: '800', color: '#fff' },
  bannerSubRow:     { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  bannerSubtitle:   { fontSize: 13, color: 'rgba(255,255,255,0.75)' },
  bannerRefreshedAt:{ fontSize: 11, color: 'rgba(255,255,255,0.5)', fontStyle: 'italic' },
  bgUpdateDot:      { width: 7, height: 7, borderRadius: 4, backgroundColor: C.warning, opacity: 0.9 },
  bannerRing: {
    width: 64, height: 64, borderRadius: 32,
    borderWidth: 3, borderColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center', justifyContent: 'center',
  },
  bannerPct:          { fontSize: 18, fontWeight: '800', color: '#fff' },
  bannerPctLabel:     { fontSize: 9,  color: 'rgba(255,255,255,0.7)', fontWeight: '600' },
  bannerStats:        { flexDirection: 'row', alignItems: 'center' },
  bannerStat:         { flex: 1, alignItems: 'center' },
  bannerStatValue:    { fontSize: 18, fontWeight: '700', color: '#fff' },
  bannerStatLabel:    { fontSize: 11, color: 'rgba(255,255,255,0.65)', marginTop: 2 },
  bannerStatDivider:  { width: 1, height: 28, backgroundColor: 'rgba(255,255,255,0.15)' },

  // Section
  sectionTitle: { fontWeight: '700', color: C.textPrimary, marginBottom: 12 },

  // Card
  card: {
    backgroundColor: C.surface, marginBottom: 14,
    borderWidth: 1, borderColor: C.border,
  },
  cardHeader:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  codeChip:      { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  codeChipText:  { fontSize: 13, fontWeight: '700', color: C.primary },
  gradeBadge:    { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, gap: 5 },
  gradeDot:      { width: 7, height: 7, borderRadius: 4 },
  gradeLabel:    { fontSize: 11, fontWeight: '700' },
  unitName:      { color: C.textSecondary, marginBottom: 12, lineHeight: 20 },

  // Progress
  barSection:    { marginBottom: 14 },
  barLabelRow:   { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  barLabel:      { fontSize: 12, color: C.textMuted, fontWeight: '600' },
  barPercent:    { fontSize: 13, fontWeight: '800' },
  progressTrack: { backgroundColor: C.surfaceAlt, borderRadius: 4, overflow: 'hidden' },
  progressFill:  { borderRadius: 4 },

  // Stats row
  statsRow:    { flexDirection: 'row', alignItems: 'center', paddingTop: 12, borderTopWidth: 1, borderTopColor: C.border },
  statItem:    { flex: 1, alignItems: 'center', gap: 3 },
  statValue:   { fontSize: 16, fontWeight: '700', color: C.textPrimary },
  statLabel:   { fontSize: 10, color: C.textMuted, fontWeight: '600' },
  statDivider: { width: 1, height: 32, backgroundColor: C.border },

  // Error
  errorBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.dangerSoft, borderRadius: 12, padding: 12, marginBottom: 14 },
  errorText:   { flex: 1, fontSize: 13, color: C.danger },
  retryLink:   { fontSize: 13, fontWeight: '700', color: C.primary },

  // Expand buttons
  expandBtnRow:     { flexDirection: 'row', marginTop: 12, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 2 },
  expandBtnHalf:    { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 8 },
  expandBtnDivider: { width: 1, backgroundColor: C.border, marginVertical: 6 },
  expandBtnText:    { fontSize: 12, fontWeight: '700', color: C.primary },

  // Students panel
  studentsPanel:     { marginTop: 10, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 8 },
  studentHeader:     { flexDirection: 'row', justifyContent: 'space-between', paddingBottom: 6, marginBottom: 4, borderBottomWidth: 1, borderBottomColor: C.border },
  studentHeaderText: { fontSize: 10, fontWeight: '700', color: C.textMuted, letterSpacing: 0.5, textTransform: 'uppercase' },
  studentRow:        { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: `${C.border}88` },
  studentRankBadge:  { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  studentRankText:   { fontSize: 11, fontWeight: '700', color: C.primary },
  studentName:       { fontSize: 13, fontWeight: '600', color: C.textPrimary },
  studentAdm:        { fontSize: 11, color: C.textMuted, marginTop: 1 },
  studentStatsCol:   { alignItems: 'flex-end', minWidth: 64 },
  studentPct:        { fontSize: 14, fontWeight: '800' },
  studentFraction:   { fontSize: 11, color: C.textMuted, marginTop: 1 },
  studentsErrorRow:  { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10 },
  studentsErrorText: { flex: 1, fontSize: 12, color: C.danger },
  studentsRetry:     { fontSize: 12, fontWeight: '700', color: C.primary },
  studentsEmpty:     { fontSize: 13, color: C.textMuted, textAlign: 'center', paddingVertical: 14 },

  // Attendance grid
  gridPanel:        { marginTop: 10, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 8 },
  gridWrapper:      { flexDirection: 'row', borderWidth: 1, borderColor: C.border, borderRadius: 8, overflow: 'hidden' },
  gridRow:          { flexDirection: 'row', alignItems: 'center', height: 44 },
  gridHeaderStrip:  { backgroundColor: C.surfaceAlt, borderBottomWidth: 1, borderBottomColor: C.border, height: 30 },
  gridRowAlt:       { backgroundColor: `${C.surfaceAlt}70` },
  gridHCell:        { fontSize: 9, fontWeight: '700', color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.4, paddingHorizontal: 6 },
  gridDCell:        { fontSize: 11, color: C.textSecondary, paddingHorizontal: 6 },
  gridStudentCol:   { width: 160, paddingHorizontal: 8 },
  gridStudentCell:  { width: 160, height: 44, justifyContent: 'center', paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: `${C.border}55` },
  gridStudentName:  { fontSize: 12, fontWeight: '600', color: C.textPrimary },
  gridStudentAdm:   { fontSize: 10, color: C.textMuted, marginTop: 1 },
  gridSessCol:      { width: 44, textAlign: 'center', paddingHorizontal: 0 },
  gridTickCell:     { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  gridTotalsCol:    { width: 68, textAlign: 'center', paddingHorizontal: 4 },
  gridTotalsCell:   { width: 68, height: 44, alignItems: 'center', justifyContent: 'center', borderLeftWidth: 1, borderLeftColor: C.border },
  gridTotalsText:   { fontSize: 12, fontWeight: '700' },
  gridColSep:       { width: 1, backgroundColor: C.border },
  gridErrorRow:     { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10 },
  gridErrorText:    { flex: 1, fontSize: 12, color: C.danger },
  gridRetry:        { fontSize: 12, fontWeight: '700', color: C.primary },
  gridEmpty:        { fontSize: 13, color: C.textMuted, textAlign: 'center', paddingVertical: 14 },

  // Empty
  emptyWrap:  { alignItems: 'center', paddingTop: 60 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: C.textPrimary, marginTop: 16 },
  emptyText:  { fontSize: 14, color: C.textSecondary, textAlign: 'center', marginTop: 6, paddingHorizontal: 32 },
});

export default AnalyticsScreen;