// src/screens/lecturer/OverviewScreen.js
import React, { useState, useCallback, useEffect, useMemo, useRef, memo } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, RefreshControl,
  Animated, Platform,
  Modal, TextInput, KeyboardAvoidingView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useFocusEffect } from '@react-navigation/native';
import { getLecturerSession } from '../../utils/authSession';
import { API_BASE_URL } from '../../utils/constants';
import { fetchMyLecturerTimetable } from '../../utils/lecturerTimetableApi';
import useResponsive from '../../hooks/useResponsive';
import OfflineBanner from '../../components/OfflineBanner';
import LecturerHeader from '../../components/LecturerHeader';
import sqliteStorage from '../../storage/sqliteStorage';
import { useColors } from '../../theme';

// C and styles are populated inside OverviewScreen via useColors() — see useMemo below
let C = {};
let styles = {};

const SP = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 };
const FW = { regular: '400', medium: '500', semibold: '600', bold: '700', extrabold: '800' };

const ACTIVE_SESSION_KEY = 'markwise.lecturer.active_session.v1';
// ACCENTS reads from C, which is set at runtime — evaluated lazily per call
const getACCENTS = () => [
  [C.primary, C.primaryDark],
  [C.secondary, '#7C3AED'],
  [C.info, C.infoDark],
  [C.success, C.successDark],
  [C.warning, C.warningDark],
];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const _overviewCache = {
  units: null, stats: null, timetable: null,
  sparklines: null, atRiskCounts: null, upcomingDeadlines: null,
  activeSession: null, prevStats: null, timestamp: 0,
};
const STALE_MS = 5 * 60 * 1000;

// ── Utilities ─────────────────────────────────────────────────────────────────
const toKey = (code) => String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const getTodayStatsKey = () => { const d = new Date(); return `markwise.lecturer.stats.${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
const getPrevStatsKey  = () => { const d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); return `markwise.lecturer.stats.${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
const getTodayName     = () => DAYS[new Date().getDay()];
const formatTime = (t) => {
  if (!t) return '--:--';
  const [h, m] = t.split(':').map(Number);
  if (isNaN(h)) return t;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(m || 0).padStart(2, '0')} ${ampm}`;
};
const safeNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const getAttendanceGrade = (rate) => {
  if (rate >= 80) return { color: C.success,   bg: `${C.success}18`,  label: 'Excellent', icon: 'star-circle' };
  if (rate >= 70) return { color: C.warning,   bg: `${C.warning}18`,  label: 'At Risk',   icon: 'alert-circle' };
  if (rate > 0)   return { color: C.error,     bg: `${C.error}18`,    label: 'Critical',  icon: 'alert-octagon' };
  return             { color: C.textMuted, bg: `${C.textMuted}18`, label: 'No Data',   icon: 'help-circle' };
};
const parseTimeToday = (timeStr, refDate) => {
  if (!timeStr) return null;
  const [h, m] = timeStr.split(':').map(Number);
  if (isNaN(h)) return null;
  const d = new Date(refDate); d.setHours(h, m, 0, 0); return d;
};
const formatCountdown = (start, now) => {
  const diff = Math.max(0, start.getTime() - now.getTime());
  const totalMins = Math.floor(diff / 60000);
  if (totalMins < 1) return 'Starting now';
  if (totalMins < 60) return `in ${totalMins}m`;
  const h = Math.floor(totalMins / 60); const m = totalMins % 60;
  return m > 0 ? `in ${h}h ${m}m` : `in ${h}h`;
};

const resolveDisplayDay = (timetable) => {
  if (!timetable || timetable.length === 0) return { dayName: getTodayName(), sessions: [], isToday: true };
  const today = new Date().getDay();
  for (let offset = 0; offset < 7; offset++) {
    const dayName = DAYS[(today + offset) % 7];
    const sessions = timetable
      .filter(e => e.day?.toLowerCase() === dayName.toLowerCase())
      .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
    if (sessions.length > 0) return { dayName, sessions, isToday: offset === 0 };
  }
  return { dayName: getTodayName(), sessions: [], isToday: true };
};

const getNextClassData = (timetable, now) => {
  if (!timetable || timetable.length === 0) return null;
  const todayIdx = now.getDay();
  for (let offset = 0; offset < 7; offset++) {
    const dayIdx = (todayIdx + offset) % 7;
    const dayName = DAYS[dayIdx];
    const sessions = timetable
      .filter(e => e.day?.toLowerCase() === dayName.toLowerCase())
      .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
    for (const session of sessions) {
      const start = parseTimeToday(session.startTime, now);
      if (!start) continue;
      if (offset > 0) start.setDate(start.getDate() + offset);
      const rawEnd = session.endTime ? parseTimeToday(session.endTime, now) : null;
      const end = rawEnd ? (offset > 0 ? new Date(rawEnd.setDate(rawEnd.getDate() + offset)) : rawEnd) : new Date(start.getTime() + 60 * 60 * 1000);
      if (now > end) continue;
      const isInProgress = now >= start && now <= end;
      return { session, start, end, isInProgress, offset, dayName };
    }
  }
  return null;
};

// ── API helpers ───────────────────────────────────────────────────────────────
const fetchSparklinesData = async (token, unitCodes, signal) => {
  if (!unitCodes.length) return {};
  try {
    const params = new URLSearchParams({ unitCodes: unitCodes.join(',') });
    const res = await fetch(`${API_BASE_URL}/api/lecturer/analytics/trends?${params}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal });
    if (!res.ok) return {};
    const raw = await res.json().catch(() => null);
    if (!raw || typeof raw !== 'object') return {};
    const result = {};
    for (const [k, v] of Object.entries(raw)) { if (Array.isArray(v)) result[toKey(k)] = v.map(Number).filter(Number.isFinite); }
    return result;
  } catch (_) { return {}; }
};

const fetchAtRiskData = async (token, unitCodes, signal) => {
  if (!unitCodes.length) return {};
  try {
    const params = new URLSearchParams({ unitCodes: unitCodes.join(',') });
    const res = await fetch(`${API_BASE_URL}/api/lecturer/analytics/at-risk?${params}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal });
    if (!res.ok) return {};
    const raw = await res.json().catch(() => null);
    if (!raw || typeof raw !== 'object') return {};
    const result = {};
    for (const [k, v] of Object.entries(raw)) { const count = typeof v === 'number' ? v : (v?.atRisk ?? v?.at_risk ?? v?.count ?? 0); result[toKey(k)] = Number(count) || 0; }
    return result;
  } catch (_) { return {}; }
};

const fetchUpcomingDeadlines = async (token, signal) => {
  try {
    const res = await fetch(`${API_BASE_URL}/api/lecturer/assignments/upcoming?days=14`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal });
    if (!res.ok) return [];
    const raw = await res.json().catch(() => null);
    const arr = Array.isArray(raw) ? raw : Array.isArray(raw?.assignments) ? raw.assignments : Array.isArray(raw?.data) ? raw.data : Array.isArray(raw?.items) ? raw.items : [];
    return arr
      .filter(d => d?.dueAt || d?.due_at || d?.dueDate || d?.due_date)
      .map(d => ({
        id: d.id ?? d._id ?? String(Math.random()),
        unitCode: d.unitCode ?? d.unit_code ?? '',
        unitName: d.unitName ?? d.unit_name ?? d.unitCode ?? '',
        title: d.title ?? d.name ?? 'Assignment',
        dueAt: new Date(d.dueAt ?? d.due_at ?? d.dueDate ?? d.due_date),
        type: d.type ?? 'assignment',
      }))
      .filter(d => !isNaN(d.dueAt))
      .sort((a, b) => a.dueAt - b.dueAt)
      .slice(0, 3);
  } catch (_) { return []; }
};

const fetchActiveSession = async (token, signal) => {
  try {
    const cached = await AsyncStorage.getItem(ACTIVE_SESSION_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      const ageMs = Date.now() - new Date(parsed.startedAt).getTime();
      if (ageMs < 4 * 60 * 60 * 1000) return parsed;
      await AsyncStorage.removeItem(ACTIVE_SESSION_KEY);
    }
  } catch (_) {}
  try {
    const res = await fetch(`${API_BASE_URL}/api/lecturer/sessions/active`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal });
    if (!res.ok) return null;
    const d = await res.json().catch(() => null);
    if (!d || typeof d !== 'object') return null;
    return { unitCode: d.unitCode ?? d.unit_code ?? '', unitName: d.unitName ?? d.unit_name ?? '', sessionType: d.sessionType ?? d.session_type ?? d.type ?? 'online', startedAt: d.startedAt ?? d.started_at ?? d.createdAt ?? new Date().toISOString(), lectureRoom: d.lectureRoom ?? d.lecture_room ?? d.venue ?? '' };
  } catch (_) { return null; }
};

const scheduleBackgroundTask = (callback, options = { timeout: 2000 }) => {
  if (typeof requestIdleCallback !== 'undefined') { const handle = requestIdleCallback(callback, options); return () => cancelIdleCallback(handle); }
  const timeoutId = setTimeout(callback, 50);
  return () => clearTimeout(timeoutId);
};

// ── Data hook (unchanged) ─────────────────────────────────────────────────────
const useOverviewData = () => {
  const [timetable, setTimetable] = useState(() => _overviewCache.timetable ?? []);
  const [units, setUnits] = useState(() => _overviewCache.units ?? []);
  const [stats, setStats] = useState(() => _overviewCache.stats ?? { units: 0, students: 0, uniqueStudents: 0, assignments: 0, materials: 0, totalSessions: 0, avgAttendance: null });
  const [sparklines, setSparklines] = useState(() => _overviewCache.sparklines ?? {});
  const [atRiskCounts, setAtRiskCounts] = useState(() => _overviewCache.atRiskCounts ?? {});
  const [upcomingDeadlines, setUpcomingDeadlines] = useState(() => _overviewCache.upcomingDeadlines ?? []);
  const [activeSession, setActiveSession] = useState(() => _overviewCache.activeSession ?? null);
  const [prevStats, setPrevStats] = useState(() => _overviewCache.prevStats ?? null);
  const [loading, setLoading] = useState(() => !_overviewCache.units);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [isBackgroundUpdate, setIsBackgroundUpdate] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const abortControllerRef = useRef(null);

  const loadData = useCallback(async (isRefresh = false, isBackground = false) => {
    if (abortControllerRef.current) abortControllerRef.current.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const { signal } = controller;
    if (isBackground) { setIsBackgroundUpdate(true); } else if (!isRefresh && !_overviewCache.units) { setLoading(true); }
    if (!isBackground) setError(null);
    let finalSparklines = {}, finalAtRiskCounts = {}, finalDeadlines = [], finalActiveSession = null;
    try {
      const prevSnapshotRaw = await AsyncStorage.getItem(getPrevStatsKey());
      if (prevSnapshotRaw) { const parsed = JSON.parse(prevSnapshotRaw); setPrevStats(parsed); _overviewCache.prevStats = parsed; }
    } catch (_) {}
    try {
      const s = await getLecturerSession();
      if (signal.aborted) return;
      const tt = await fetchMyLecturerTimetable(s.token);
      const timetableList = Array.isArray(tt) ? tt : [];
      setTimetable(timetableList);
      const uniqueUnits = new Map();
      for (const entry of timetableList) {
        const code = entry.unitCode; if (!code) continue;
        const k = toKey(code);
        if (!uniqueUnits.has(k)) uniqueUnits.set(k, { code, name: entry.unitName || entry.unitTitle || code, students: 0, assignments: 0, materials: 0, conductedSessions: 0, attendanceRate: 0 });
      }
      const unitCodes = Array.from(uniqueUnits.keys());
      let unitStatsList = Array.from(uniqueUnits.values());
      const normalizeBatchEntry = (d) => {
        if (!d || typeof d !== 'object') return {};
        const students = safeNum(d.students ?? d.enrolledStudents ?? d.enrolled_students ?? d.enrolled ?? d.studentCount ?? d.student_count ?? d.totalStudents ?? d.total_students ?? d.numStudents ?? d.num_students);
        const conductedSessions = safeNum(d.conductedSessions ?? d.conducted_sessions ?? d.sessionCount ?? d.session_count ?? d.sessionsCount ?? d.totalSessions ?? d.total_sessions ?? d.conducted ?? d.lectureCount ?? d.lecture_count ?? d.numSessions ?? d.num_sessions ?? d.totalConducted ?? d.total_conducted ?? d.lecturesConducted ?? d.lectures_conducted);
        const assignments = safeNum(d.assignments ?? d.assignmentCount ?? d.assignment_count ?? d.totalAssignments ?? d.total_assignments);
        const materials = safeNum(d.materials ?? d.materialCount ?? d.material_count ?? d.totalMaterials ?? d.total_materials);
        let rawRate = safeNum(d.attendanceRate ?? d.attendance_rate ?? d.attendancePercent ?? d.attendance_percent ?? d.avgAttendance ?? d.avg_attendance ?? d.rate ?? d.percentage ?? d.percent ?? d.averagePercent ?? d.average_percent);
        if (rawRate > 0 && rawRate <= 1) rawRate *= 100;
        if ((rawRate === 0 || !Number.isFinite(rawRate)) && conductedSessions > 0 && students > 0) { const totalPresent = safeNum(d.totalPresent ?? d.total_present ?? d.presentCount ?? d.present_count ?? d.totalAttended ?? d.total_attended ?? d.attendedCount ?? d.attended_count); if (totalPresent > 0) rawRate = Math.min(100, (totalPresent / (conductedSessions * students)) * 100); }
        const atRisk = safeNum(d.atRiskCount ?? d.at_risk_count ?? d.atRisk ?? d.at_risk);
        const attendanceRate = (Number.isFinite(rawRate) && rawRate > 0) ? Math.min(100, Math.round(rawRate)) : 0;
        return { students, conductedSessions, attendanceRate, assignments, materials, atRisk };
      };
      if (unitCodes.length > 0) {
        const [analyticsResult, conductedResult, localResult, sparklinesResult, atRiskResult, deadlinesResult, activeSessionResult] = await Promise.allSettled([
          (async () => {
            let analyticsMap = {};
            try {
              const res = await fetch(`${API_BASE_URL}/api/lecturer/analytics/batch`, { method: 'POST', headers: { Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ unitCodes }), signal });
              if (res.ok) { const raw = await res.json().catch(() => null); if (raw && typeof raw === 'object') { for (const [k, v] of Object.entries(raw)) analyticsMap[toKey(k)] = v; } }
            } catch (_) {}
            if (Object.keys(analyticsMap).length === 0) {
              try {
                const res = await fetch(`${API_BASE_URL}/api/lecturer/analytics`, { headers: { Authorization: `Bearer ${s.token}`, Accept: 'application/json' }, signal });
                if (res.ok) { const raw = await res.json().catch(() => null); const arr = Array.isArray(raw) ? raw : Array.isArray(raw?.units) ? raw.units : Array.isArray(raw?.data?.units) ? raw.data.units : Array.isArray(raw?.data) ? raw.data : []; for (const item of arr) { const k = toKey(item?.unitCode ?? item?.unit_code ?? item?.code ?? ''); if (k) analyticsMap[k] = item; } }
              } catch (_) {}
            }
            return analyticsMap;
          })(),
          (async () => {
            const countMap = {};
            try {
              const params = new URLSearchParams({ unitCodes: unitCodes.join(',') });
              const res = await fetch(`${API_BASE_URL}/api/attendance/conducted-sessions/counts?${params}`, { headers: { Authorization: `Bearer ${s.token}`, Accept: 'application/json' }, signal });
              if (res.ok) {
                const raw = await res.json().catch(() => null);
                if (raw) {
                  const rows = Array.isArray(raw) ? raw : Array.isArray(raw?.units) ? raw.units : Array.isArray(raw?.data) ? raw.data : null;
                  if (rows) { for (const item of rows) { const k = toKey(item?.unitCode ?? item?.unit_code ?? item?.code ?? ''); const n = safeNum(item?.count ?? item?.conducted ?? item?.conductedSessions ?? 0); if (k) countMap[k] = n; } }
                  else if (typeof raw === 'object') { for (const [k, v] of Object.entries(raw)) countMap[toKey(k)] = safeNum(v); }
                }
              }
            } catch (_) {}
            return countMap;
          })(),
          sqliteStorage.getConductedSessionCounts(unitCodes).catch(() => ({})),
          fetchSparklinesData(s.token, unitCodes, signal),
          fetchAtRiskData(s.token, unitCodes, signal),
          fetchUpcomingDeadlines(s.token, signal),
          fetchActiveSession(s.token, signal),
        ]);
        const analyticsMap = analyticsResult.status === 'fulfilled' ? analyticsResult.value : {};
        const conductedMap = conductedResult.status === 'fulfilled' ? conductedResult.value : {};
        const localCounts  = localResult.status === 'fulfilled' ? localResult.value : {};
        const sparklinesMap = sparklinesResult.status === 'fulfilled' ? sparklinesResult.value : {};
        const atRiskRaw = atRiskResult.status === 'fulfilled' ? atRiskResult.value : {};
        const deadlines = deadlinesResult.status === 'fulfilled' ? deadlinesResult.value : [];
        const sessionActive = activeSessionResult.status === 'fulfilled' ? activeSessionResult.value : null;
        const atRiskMerged = { ...atRiskRaw };
        unitStatsList = unitStatsList.map(u => {
          const k = toKey(u.code);
          const norm = normalizeBatchEntry(analyticsMap[k] ?? {});
          const remoteConducted = conductedMap[k] ?? 0;
          const localConducted = safeNum(localCounts[String(u.code).toUpperCase()] ?? localCounts[k] ?? 0);
          if (norm.atRisk > 0 && !atRiskMerged[k]) atRiskMerged[k] = norm.atRisk;
          return { ...u, students: norm.students > 0 ? norm.students : u.students, conductedSessions: Math.max(norm.conductedSessions > 0 ? norm.conductedSessions : u.conductedSessions, remoteConducted, localConducted), attendanceRate: norm.attendanceRate > 0 ? norm.attendanceRate : u.attendanceRate, assignments: norm.assignments > 0 ? norm.assignments : u.assignments, materials: norm.materials > 0 ? norm.materials : u.materials };
        });
        finalSparklines = sparklinesMap; finalAtRiskCounts = atRiskMerged; finalDeadlines = deadlines; finalActiveSession = sessionActive;
        setSparklines(sparklinesMap); setAtRiskCounts(atRiskMerged); setUpcomingDeadlines(deadlines); setActiveSession(sessionActive);
      } else {
        const [deadlinesResult, activeSessionResult] = await Promise.allSettled([fetchUpcomingDeadlines(s.token, signal), fetchActiveSession(s.token, signal)]);
        finalDeadlines = deadlinesResult.status === 'fulfilled' ? deadlinesResult.value : [];
        finalActiveSession = activeSessionResult.status === 'fulfilled' ? activeSessionResult.value : null;
        setUpcomingDeadlines(finalDeadlines); setActiveSession(finalActiveSession);
      }
      setUnits(unitStatsList);
      let uniqueStudentCount = 0;
      if (unitCodes.length > 0) {
        try {
          const seenStudentIds = new Set();
          let unitStatsPatched = false;
          const fetchPromises = unitCodes.map(unitCode => fetch(`${API_BASE_URL}/api/lecturer/units/${encodeURIComponent(unitCode)}/attendance`, { headers: { Authorization: `Bearer ${s.token}`, Accept: 'application/json' }, signal }).then(res => res.ok ? res.json().catch(() => null) : null).catch(() => null));
          const responses = await Promise.all(fetchPromises);
          for (let ri = 0; ri < responses.length; ri++) {
            const data = responses[ri]; if (!data) continue;
            const rawList = Array.isArray(data) ? data : Array.isArray(data?.students) ? data.students : Array.isArray(data?.data) ? data.data : Array.isArray(data?.attendance) ? data.attendance : Array.isArray(data?.records) ? data.records : [];
            for (const student of rawList) { const sid = student.studentId ?? student.id ?? student.student_id ?? student.admissionNumber ?? student.adm_number ?? student.registration_number; if (sid != null) seenStudentIds.add(String(sid)); }
            if (rawList.length === 0) continue;
            const unitKey = toKey(unitCodes[ri]);
            const unitIdx = unitStatsList.findIndex(u => toKey(u.code) === unitKey);
            if (unitIdx === -1) continue;
            const u = unitStatsList[unitIdx];
            const envelopeConducted = safeNum(data?.conductedSessions ?? data?.conducted_sessions ?? data?.sessionCount ?? data?.session_count ?? data?.totalSessions ?? data?.total_sessions ?? 0);
            const perStudentConducted = rawList.reduce((mx, st) => Math.max(mx, safeNum(st.conducted ?? st.conductedSessions ?? st.conducted_sessions ?? st.totalSessions ?? st.total_sessions ?? st.sessionCount ?? st.session_count ?? 0)), 0);
            const conductedForCalc = Math.max(envelopeConducted, perStudentConducted, u.conductedSessions);
            const totalAttended = rawList.reduce((sum, st) => sum + safeNum(st.attended ?? st.attendedCount ?? st.attended_count ?? st.sessionsAttended ?? st.sessions_attended ?? st.attendanceCount ?? st.attendance_count ?? st.presentCount ?? st.present_count ?? st.markedPresent ?? st.marked_present ?? st.totalAttended ?? st.total_attended ?? 0), 0);
            const enrolledForCalc = u.students > 0 ? u.students : rawList.length;
            let attendanceRate = u.attendanceRate;
            if (attendanceRate === 0 && conductedForCalc > 0 && enrolledForCalc > 0 && totalAttended > 0) attendanceRate = Math.min(100, Math.round((totalAttended / (conductedForCalc * enrolledForCalc)) * 100));
            const newConducted = Math.max(conductedForCalc, u.conductedSessions);
            const newStudents = Math.max(enrolledForCalc, u.students);
            if (newConducted !== u.conductedSessions || attendanceRate !== u.attendanceRate || newStudents !== u.students) { unitStatsList[unitIdx] = { ...u, students: newStudents, conductedSessions: newConducted, attendanceRate }; unitStatsPatched = true; }
          }
          uniqueStudentCount = seenStudentIds.size;
          if (unitStatsPatched) setUnits([...unitStatsList]);
        } catch (_) {}
      }
      const totalStudents = unitStatsList.reduce((acc, u) => acc + u.students, 0);
      const totalAssignments = unitStatsList.reduce((acc, u) => acc + u.assignments, 0);
      const totalMaterials = unitStatsList.reduce((acc, u) => acc + (u.materials || 0), 0);
      const totalSessions = unitStatsList.reduce((acc, u) => acc + u.conductedSessions, 0);
      let avgAttendance = null;
      const validUnitsWithStats = unitStatsList.filter(u => u.attendanceRate > 0 && u.conductedSessions > 0);
      if (validUnitsWithStats.length > 0) { const weightedSum = validUnitsWithStats.reduce((sum, u) => sum + (u.attendanceRate * u.conductedSessions), 0); const totalW = validUnitsWithStats.reduce((sum, u) => sum + u.conductedSessions, 0); avgAttendance = Math.round(weightedSum / totalW); }
      const newStats = { units: unitStatsList.length, students: totalStudents, uniqueStudents: uniqueStudentCount, assignments: totalAssignments, materials: totalMaterials, totalSessions, avgAttendance };
      setStats(newStats);
      _overviewCache.units = unitStatsList; _overviewCache.stats = newStats; _overviewCache.timetable = timetableList; _overviewCache.sparklines = finalSparklines; _overviewCache.atRiskCounts = finalAtRiskCounts; _overviewCache.upcomingDeadlines = finalDeadlines; _overviewCache.activeSession = finalActiveSession; _overviewCache.timestamp = Date.now();
      setLastRefreshed(new Date());
      try {
        await AsyncStorage.setItem(getTodayStatsKey(), JSON.stringify({ totalSessions: newStats.totalSessions, avgAttendance: newStats.avgAttendance }));
        await AsyncStorage.setItem('markwise.lecturer.overview.v6', JSON.stringify({ units: unitStatsList, stats: newStats, timetable: timetableList, sparklines: finalSparklines, atRiskCounts: finalAtRiskCounts, upcomingDeadlines: finalDeadlines.map(d => ({ ...d, dueAt: d.dueAt instanceof Date ? d.dueAt.toISOString() : String(d.dueAt) })), activeSession: finalActiveSession, fetchedAt: new Date().toISOString() }));
      } catch (_) {}
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (_overviewCache.units) return;
      const msg = err instanceof Error ? err.message : 'Failed to load data';
      const isConnectivity = /no internet|network|offline|connection/i.test(msg);
      if (!isConnectivity) setError(msg);
      try {
        const cached = await AsyncStorage.getItem('markwise.lecturer.overview.v6');
        if (cached) {
          const data = JSON.parse(cached);
          if (data.units) setUnits(data.units);
          if (data.stats) setStats(data.stats);
          if (data.timetable) setTimetable(data.timetable);
          if (data.sparklines) setSparklines(data.sparklines);
          if (data.atRiskCounts) setAtRiskCounts(data.atRiskCounts);
          if (data.upcomingDeadlines) setUpcomingDeadlines(data.upcomingDeadlines.map(d => ({ ...d, dueAt: d.dueAt ? new Date(d.dueAt) : null })).filter(d => d.dueAt && !isNaN(d.dueAt.getTime())));
          if (data.activeSession) setActiveSession(data.activeSession);
        }
      } catch (_) {}
    } finally {
      setLoading(false);
      if (isRefresh) setRefreshing(false);
      if (isBackground) setIsBackgroundUpdate(false);
    }
  }, []);

  const refresh = useCallback(() => { setRefreshing(true); loadData(true); }, [loadData]);
  const recheckActiveSession = useCallback(async () => {
    try { const s = await getLecturerSession(); if (!s?.token) return; const session = await fetchActiveSession(s.token, null); setActiveSession(session); } catch (_) {}
  }, []);
  useEffect(() => { return () => { if (abortControllerRef.current) abortControllerRef.current.abort(); }; }, []);
  useFocusEffect(useCallback(() => {
    let cleanup;
    const age = Date.now() - _overviewCache.timestamp;
    if (!_overviewCache.units || age > STALE_MS) { loadData(false, false); }
    else { cleanup = scheduleBackgroundTask(() => loadData(false, true), { timeout: 2000 }); }
    return () => { if (cleanup) cleanup(); };
  }, [loadData]));
  return { timetable, units, stats, sparklines, atRiskCounts, upcomingDeadlines, activeSession, prevStats, loading, refreshing, error, isBackgroundUpdate, lastRefreshed, refresh, recheckActiveSession };
};

// ── Shared animation wrapper ──────────────────────────────────────────────────
const FadeIn = memo(({ children, delay = 0 }) => {
  const anim  = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(14)).current;
  useEffect(() => {
    const t = setTimeout(() => {
      Animated.parallel([
        Animated.timing(anim,  { toValue: 1, duration: 380, delay, useNativeDriver: true }),
        Animated.timing(slide, { toValue: 0, duration: 380, delay, useNativeDriver: true }),
      ]).start();
    }, 0);
    return () => clearTimeout(t);
  }, [delay, anim, slide]);
  return <Animated.View style={{ opacity: anim, transform: [{ translateY: slide }] }}>{children}</Animated.View>;
});

// ── Sparkline bar chart ───────────────────────────────────────────────────────
const Sparkline = memo(({ data, color, width = 56, height = 20 }) => {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data, 1);
  const gap = 2;
  const barW = Math.max(3, Math.floor((width - gap * (data.length - 1)) / data.length));
  return (
    <View style={{ width, height, flexDirection: 'row', alignItems: 'flex-end', gap }}>
      {data.map((val, i) => {
        const barH = Math.max(3, Math.round((val / max) * height));
        const isLatest = i === data.length - 1;
        return <View key={i} style={{ width: barW, height: barH, backgroundColor: isLatest ? color : `${color}50`, borderRadius: 2 }} />;
      })}
    </View>
  );
});

// ── Live session banner (persistent above scroll) ─────────────────────────────
const LiveSessionWidget = memo(({ session, onPress }) => {
  const pulse = useRef(new Animated.Value(1)).current;
  const [elapsed, setElapsed] = useState('');
  useEffect(() => {
    const anim = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 0.2, duration: 700, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1,   duration: 700, useNativeDriver: true }),
    ]));
    anim.start();
    return () => anim.stop();
  }, [pulse]);
  useEffect(() => {
    const update = () => {
      const ms = Date.now() - new Date(session.startedAt).getTime();
      const totSecs = Math.floor(ms / 1000);
      const h = Math.floor(totSecs / 3600);
      const m = Math.floor((totSecs % 3600) / 60);
      const sec = totSecs % 60;
      setElapsed(h > 0 ? `${h}h ${m}m` : `${m}m ${String(sec).padStart(2, '0')}s`);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [session.startedAt]);

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.88} style={styles.liveWidget}>
      <LinearGradient
        colors={[`${C.success}28`, `${C.success}10`]}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
      />
      <View style={styles.livePulseWrap}>
        <Animated.View style={[styles.livePulseDot, { opacity: pulse }]} />
        <View style={styles.liveDotInner} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.liveLabel}>LIVE SESSION</Text>
        <Text style={styles.liveUnit} numberOfLines={1}>
          {session.unitName || session.unitCode || 'Active session'}
          {session.lectureRoom ? `  ·  ${session.lectureRoom}` : ''}
        </Text>
        <Text style={styles.liveElapsed}>{elapsed} elapsed</Text>
      </View>
      <LinearGradient colors={[C.success, C.successDark]} style={styles.liveResumeBtn} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
        <Icon name="play-circle-outline" size={14} color="#fff" />
        <Text style={styles.liveResumeTxt}>Resume</Text>
      </LinearGradient>
    </TouchableOpacity>
  );
});

// ── 2×2 key stats grid ────────────────────────────────────────────────────────
const StatCard = memo(({ icon, value, label, color }) => (
  <View style={[styles.statCard, { borderColor: `${color}22` }]}>
    <LinearGradient colors={[`${color}18`, `${color}08`]} style={StyleSheet.absoluteFill} borderRadius={18} />
    <View style={[styles.statIcon, { backgroundColor: `${color}25` }]}>
      <Icon name={icon} size={17} color={color} />
    </View>
    <Text style={styles.statValue}>{value ?? '—'}</Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
));

// ── Next-class hero card ──────────────────────────────────────────────────────
const NextClassHero = memo(({ nextClass, onStart }) => {
  const [cd, setCd] = useState('');
  useEffect(() => {
    if (!nextClass || nextClass.isInProgress) { setCd(''); return; }
    const update = () => setCd(formatCountdown(nextClass.start, new Date()));
    update();
    const id = setInterval(update, 15000);
    return () => clearInterval(id);
  }, [nextClass]);
  if (!nextClass) return null;
  const { session, isInProgress, offset, dayName } = nextClass;
  const unitName = session.unitName || session.unitTitle || session.unitCode || '—';
  const venue    = session.venue || session.roomCode || 'TBA';
  const accent   = isInProgress ? C.success : C.primary;
  const whenTag  = isInProgress ? 'NOW' : offset === 0 ? 'TODAY' : offset === 1 ? 'TOMORROW' : dayName.toUpperCase();
  const cdText   = isInProgress ? 'In progress' : cd || formatTime(session.startTime);
  return (
    <View style={[styles.nextCard, { borderColor: `${accent}30` }]}>
      <LinearGradient colors={[`${accent}16`, `${accent}06`]} style={StyleSheet.absoluteFill} borderRadius={20} />
      <View style={[styles.nextAccentBar, { backgroundColor: accent }]} />
      <View style={styles.nextBody}>
        <View style={styles.nextTopRow}>
          <View style={[styles.nextWhenTag, { backgroundColor: `${accent}22` }]}>
            {isInProgress && <View style={[styles.nextLiveDot, { backgroundColor: accent }]} />}
            <Text style={[styles.nextWhenTxt, { color: accent }]}>{whenTag}</Text>
          </View>
          <Text style={[styles.nextCd, { color: accent }]}>{cdText}</Text>
        </View>
        <Text style={styles.nextUnitName} numberOfLines={2}>{unitName}</Text>
        {!!session.unitCode && <Text style={styles.nextUnitCode}>{session.unitCode}</Text>}
        <View style={styles.nextMeta}>
          <Icon name="map-marker-outline" size={11} color={C.textMuted} />
          <Text style={styles.nextMetaTxt}>{venue}</Text>
          <View style={styles.nextMetaDot} />
          <Icon name="clock-outline" size={11} color={C.textMuted} />
          <Text style={styles.nextMetaTxt}>
            {formatTime(session.startTime)}{session.endTime ? ` – ${formatTime(session.endTime)}` : ''}
          </Text>
        </View>
      </View>
      {offset === 0 && (
        <TouchableOpacity
          style={[styles.nextStartBtn, { backgroundColor: accent }]}
          onPress={() => onStart(session)}
          activeOpacity={0.82}
        >
          <Icon name={isInProgress ? 'play-circle' : 'qrcode-scan'} size={16} color="#fff" />
          <Text style={styles.nextStartTxt}>{isInProgress ? 'Resume' : 'Start'}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
});

// ── Section header ────────────────────────────────────────────────────────────
const SectionHeader = memo(({ icon, title, count, onAction, actionLabel }) => (
  <View style={styles.secHeader}>
    <View style={styles.secHeaderLeft}>
      <Icon name={icon} size={13} color={C.textMuted} />
      <Text style={styles.secTitle}>{title}</Text>
      {count != null && <View style={styles.secCountBadge}><Text style={styles.secCountTxt}>{count}</Text></View>}
    </View>
    {onAction && (
      <TouchableOpacity onPress={onAction} style={styles.secAction} activeOpacity={0.7}>
        <Text style={styles.secActionTxt}>{actionLabel || 'See all'}</Text>
        <Icon name="chevron-right" size={13} color={C.primary} />
      </TouchableOpacity>
    )}
  </View>
));

// ── Lesson card (today's schedule) ───────────────────────────────────────────
const LessonCard = memo(({ entry, index, onStart }) => {
  const ACCENTS = getACCENTS();
  const accent    = ACCENTS[index % ACCENTS.length];
  const lessonType = entry.lessonType || 'Lecture';
  const venue     = entry.venue || entry.roomCode || 'TBA';
  const unitName  = entry.unitName || entry.unitTitle || entry.unitCode || '—';
  const unitCode  = entry.unitCode || '';
  return (
    <FadeIn delay={80 * Math.min(index, 3)}>
      <TouchableOpacity activeOpacity={0.88} onPress={onStart} style={styles.lessonCard}>
        <LinearGradient colors={accent} style={styles.lessonBar} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} />
        <View style={styles.lessonTimeCol}>
          <Text style={styles.lessonTimeStart}>{formatTime(entry.startTime)}</Text>
          {!!entry.endTime && <Text style={styles.lessonTimeEnd}>{formatTime(entry.endTime)}</Text>}
        </View>
        <View style={styles.lessonSep} />
        <View style={styles.lessonInfo}>
          <View style={styles.lessonInfoTop}>
            <Text style={styles.lessonUnit} numberOfLines={1}>{unitName}</Text>
            <View style={[styles.lessonTypePill, { backgroundColor: `${accent[0]}22` }]}>
              <Text style={[styles.lessonTypeTxt, { color: accent[0] }]}>{lessonType}</Text>
            </View>
          </View>
          {!!unitCode && <Text style={styles.lessonCode}>{unitCode}</Text>}
          <View style={styles.lessonMeta}>
            <Icon name="map-marker-outline" size={11} color={C.textMuted} />
            <Text style={styles.lessonMetaTxt}>{venue}</Text>
          </View>
        </View>
        <LinearGradient colors={accent} style={styles.lessonStartChip} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
          <Icon name="play-circle-outline" size={12} color="#fff" />
          <Text style={styles.lessonStartTxt}>Start</Text>
        </LinearGradient>
      </TouchableOpacity>
    </FadeIn>
  );
});

// ── Unit performance cards (column layout) ────────────────────────────────────
const UnitCard = memo(({ unit, sparkline, atRisk, onPress }) => {
  const grade = getAttendanceGrade(unit.attendanceRate);
  return (
    <TouchableOpacity style={[styles.unitCard, { borderColor: `${grade.color}30` }]} onPress={onPress} activeOpacity={0.82}>
      <LinearGradient colors={[`${grade.color}18`, `${grade.color}08`]} style={StyleSheet.absoluteFill} borderRadius={16} />

      {/* Left: code, grade, sessions, at-risk */}
      <View style={styles.unitCardLeft}>
        <View style={styles.unitCardTop}>
          <View style={[styles.unitCardDot, { backgroundColor: grade.color }]} />
          <Text style={styles.unitCardCode} numberOfLines={1}>{unit.code}</Text>
          <View style={[styles.unitGradePill, { backgroundColor: grade.bg }]}>
            <Text style={[styles.unitGradeTxt, { color: grade.color }]}>{grade.label}</Text>
          </View>
        </View>
        <Text style={styles.unitSessions}>
          {unit.conductedSessions > 0
            ? `${unit.conductedSessions} session${unit.conductedSessions !== 1 ? 's' : ''}`
            : 'No sessions yet'}
        </Text>
        {atRisk > 0 && (
          <View style={styles.unitAtRisk}>
            <Icon name="account-alert-outline" size={10} color={C.warning} />
            <Text style={[styles.unitAtRiskTxt, { color: C.warning }]}>{atRisk} at risk</Text>
          </View>
        )}
      </View>

      {/* Right: sparkline + rate */}
      <View style={styles.unitCardRight}>
        {sparkline && sparkline.length > 1 && (
          <Sparkline data={sparkline} color={grade.color} width={64} height={20} />
        )}
        <Text style={[styles.unitRate, { color: grade.color }]}>
          {unit.attendanceRate > 0 ? `${unit.attendanceRate}%` : '—'}
        </Text>
        <Text style={styles.unitRateLbl}>attendance</Text>
      </View>
    </TouchableOpacity>
  );
});

// ── Quick actions flat grid ───────────────────────────────────────────────────
const QuickActionsGrid = memo(({ onStartAttendance, onTeachingHub, onAnalytics, onReports, onTimetable, onAnnounce }) => {
  const ACTIONS = [
    { icon: 'qrcode-scan',       label: 'Attendance', grad: [C.primary,    C.primaryDark],  onPress: onStartAttendance },
    { icon: 'book-open-variant', label: 'Library',    grad: [C.success,    C.successDark],  onPress: onTeachingHub },
    { icon: 'chart-bar',         label: 'Analytics',  grad: [C.secondary,  '#7C3AED'],      onPress: onAnalytics },
    { icon: 'calendar-month',    label: 'Timetable',  grad: [C.warning,    C.warningDark],  onPress: onTimetable },
    { icon: 'file-chart',        label: 'Reports',    grad: [C.info,       C.infoDark],     onPress: onReports },
    { icon: 'bullhorn-outline',  label: 'Announce',   grad: ['#EC4899',    '#DB2777'],      onPress: onAnnounce },
  ];
  return (
    <View style={styles.qaGrid}>
      {ACTIONS.map((a, i) => (
        <TouchableOpacity key={i} style={styles.qaCell} onPress={a.onPress} activeOpacity={0.78}>
          <LinearGradient colors={a.grad} style={styles.qaIcon} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
            <Icon name={a.icon} size={20} color="#fff" />
          </LinearGradient>
          <Text style={styles.qaLabel} numberOfLines={1}>{a.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
});

// ── Smart insights card ───────────────────────────────────────────────────────
const SmartInsightCard = memo(({ units, atRiskCounts, upcomingDeadlines, sparklines }) => {
  const insights = useMemo(() => {
    const list = [];
    const totalAtRisk = Object.values(atRiskCounts).reduce((s, n) => s + n, 0);
    if (totalAtRisk > 0) {
      const unitCount = Object.keys(atRiskCounts).filter(k => atRiskCounts[k] > 0).length;
      list.push({ key: 'atrisk', icon: 'account-alert-outline', color: C.error, title: `${totalAtRisk} student${totalAtRisk !== 1 ? 's' : ''} below threshold`, body: `Across ${unitCount} unit${unitCount !== 1 ? 's' : ''} · Consider attendance reminders` });
    }
    const urgentDeadline = upcomingDeadlines.find(d => Math.ceil((d.dueAt.getTime() - Date.now()) / 86400000) <= 3);
    if (urgentDeadline) {
      const days = Math.ceil((urgentDeadline.dueAt.getTime() - Date.now()) / 86400000);
      const when = days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
      list.push({ key: 'deadline', icon: 'clock-alert-outline', color: C.warning, title: `Assignment due ${when}`, body: `"${urgentDeadline.title}" · ${urgentDeadline.unitCode || urgentDeadline.unitName}` });
    }
    const declining = units.filter(u => { const s = sparklines[toKey(u.code)]; return s && s.length >= 3 && s[s.length - 1] < s[s.length - 3] - 5; });
    if (declining.length > 0 && list.length < 3) list.push({ key: 'trend', icon: 'trending-down', color: C.warning, title: `Attendance dropping in ${declining.length} unit${declining.length !== 1 ? 's' : ''}`, body: declining.map(u => u.code).slice(0, 3).join(', ') + ' · Review recent sessions' });
    return list.slice(0, 3);
  }, [units, atRiskCounts, upcomingDeadlines, sparklines]);
  if (insights.length === 0) return null;
  return (
    <FadeIn delay={200}>
      <View style={styles.insightCard}>
        <View style={styles.insightHeader}>
          <View style={styles.insightBulb}>
            <Icon name="lightbulb-on-outline" size={13} color={C.warning} />
          </View>
          <Text style={styles.insightTitle}>Smart Insights</Text>
        </View>
        {insights.map((item, i) => (
          <View key={item.key} style={[styles.insightRow, i < insights.length - 1 && { borderBottomWidth: 1, borderBottomColor: C.border }]}>
            <View style={[styles.insightRowIcon, { backgroundColor: `${item.color}15` }]}>
              <Icon name={item.icon} size={15} color={item.color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.insightRowTitle}>{item.title}</Text>
              <Text style={styles.insightRowBody} numberOfLines={2}>{item.body}</Text>
            </View>
          </View>
        ))}
      </View>
    </FadeIn>
  );
});

// ── Upcoming deadlines card ───────────────────────────────────────────────────
const DeadlineCard = memo(({ deadlines }) => {
  if (!deadlines || deadlines.length === 0) return null;
  return (
    <FadeIn delay={240}>
      <View style={styles.deadlineCard}>
        <View style={styles.deadlineCardHeader}>
          <LinearGradient colors={[C.error, '#F87171']} style={styles.deadlineCardIcon}>
            <Icon name="clock-alert-outline" size={16} color="#fff" />
          </LinearGradient>
          <View style={{ flex: 1 }}>
            <Text style={styles.deadlineCardTitle}>Upcoming Deadlines</Text>
            <Text style={styles.deadlineCardSub}>{deadlines.length} assignment{deadlines.length !== 1 ? 's' : ''} in the next 2 weeks</Text>
          </View>
        </View>
        {deadlines.map((item) => {
          const daysLeft = Math.ceil((item.dueAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
          const urgent = daysLeft <= 2;
          const accent = urgent ? C.error : daysLeft <= 5 ? C.warning : C.info;
          const daysText = daysLeft <= 0 ? 'Due today' : daysLeft === 1 ? 'Tomorrow' : `${daysLeft}d left`;
          return (
            <View key={item.id} style={[styles.deadlineRow, { borderLeftColor: accent, backgroundColor: `${accent}08` }]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.deadlineTitle} numberOfLines={1}>{item.title}</Text>
                <Text style={styles.deadlineUnit}>{item.unitCode || item.unitName}</Text>
              </View>
              <View style={[styles.deadlineBadge, { backgroundColor: `${accent}22` }]}>
                <Text style={[styles.deadlineDaysTxt, { color: accent }]}>{daysText}</Text>
              </View>
            </View>
          );
        })}
      </View>
    </FadeIn>
  );
});

// ── Skeleton loader ───────────────────────────────────────────────────────────
const SkeletonLesson = memo(() => (
  <View style={[styles.lessonCard, { overflow: 'hidden', marginBottom: SP.sm }]}>
    <View style={[styles.lessonBar, { backgroundColor: C.surfaceHover }]} />
    <View style={{ flex: 1, gap: SP.sm, paddingVertical: SP.xs }}>
      <View style={{ height: 12, width: '55%', backgroundColor: C.surfaceHover, borderRadius: 4 }} />
      <View style={{ height: 10, width: '35%', backgroundColor: C.surfaceHover, borderRadius: 4 }} />
    </View>
  </View>
));

// ── Announce modal ────────────────────────────────────────────────────────────
const QuickResponseModal = memo(({ visible, onClose, units, onSend }) => {
  const [selectedUnit, setSelectedUnit] = useState('ALL');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const TEMPLATES = useMemo(() => [
    { label: 'Class rescheduled', icon: 'calendar-refresh',    text: "Today's class has been rescheduled. You'll be notified of the new time shortly." },
    { label: 'Room change',       icon: 'map-marker-outline',  text: "The venue for today's class has changed. Please check the updated location." },
    { label: 'Deadline reminder', icon: 'clock-alert-outline', text: 'Reminder: ensure your assignment submission is completed before the deadline.' },
    { label: 'No class today',    icon: 'calendar-remove',     text: "There will be no class today. A makeup session will be announced shortly." },
  ], []);
  const canSend = message.trim().length > 0 && !sending;
  const handleSend = async () => {
    if (!canSend) return;
    setSending(true);
    try { await onSend({ unitCode: selectedUnit === 'ALL' ? null : selectedUnit, message: message.trim() }); setMessage(''); setSelectedUnit('ALL'); onClose(); } catch (_) {} finally { setSending(false); }
  };
  if (!visible) return null;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={onClose} />
        <View style={styles.modalSheet}>
          <View style={styles.modalDrag} />
          <View style={styles.modalTitleRow}>
            <LinearGradient colors={[C.primary, C.secondary]} style={styles.modalTitleIcon}>
              <Icon name="bullhorn-outline" size={16} color="#fff" />
            </LinearGradient>
            <View style={{ flex: 1 }}>
              <Text style={styles.modalTitle}>Quick Announce</Text>
              <Text style={styles.modalSub}>Send a message to your students</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.modalClose} activeOpacity={0.7}>
              <Icon name="close" size={18} color={C.textMuted} />
            </TouchableOpacity>
          </View>
          <View style={styles.modalSection}>
            <Text style={styles.modalLabel}>Send to</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.unitChips}>
              <TouchableOpacity style={[styles.unitChip, selectedUnit === 'ALL' && styles.unitChipActive]} onPress={() => setSelectedUnit('ALL')}>
                <Text style={[styles.unitChipTxt, selectedUnit === 'ALL' && styles.unitChipTxtActive]}>All units</Text>
              </TouchableOpacity>
              {units.map(u => (
                <TouchableOpacity key={u.code} style={[styles.unitChip, selectedUnit === u.code && styles.unitChipActive]} onPress={() => setSelectedUnit(u.code)}>
                  <Text style={[styles.unitChipTxt, selectedUnit === u.code && styles.unitChipTxtActive]}>{u.code}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
          <View style={styles.modalSection}>
            <Text style={styles.modalLabel}>Quick templates</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SP.sm, paddingHorizontal: SP.lg }}>
              {TEMPLATES.map(tpl => (
                <TouchableOpacity key={tpl.label} style={styles.templateChip} onPress={() => setMessage(tpl.text)} activeOpacity={0.78}>
                  <Icon name={tpl.icon} size={13} color={C.primary} />
                  <Text style={styles.templateChipTxt}>{tpl.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
          <View style={styles.modalSection}>
            <Text style={styles.modalLabel}>Message</Text>
            <TextInput
              style={styles.messageInput}
              value={message}
              onChangeText={setMessage}
              placeholder="Type your message…"
              placeholderTextColor={C.textMuted}
              multiline
              numberOfLines={4}
              maxLength={500}
            />
            <Text style={styles.charCount}>{message.length}/500</Text>
          </View>
          <TouchableOpacity style={[styles.sendBtn, !canSend && styles.sendBtnDisabled]} onPress={handleSend} activeOpacity={0.82} disabled={!canSend}>
            <LinearGradient colors={canSend ? [C.primary, C.secondary] : [C.surfaceHover, C.surfaceHover]} style={styles.sendBtnGrad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
              {sending ? <Text style={[styles.sendBtnTxt, { color: C.textMuted }]}>Sending…</Text> : <><Icon name="send" size={15} color={canSend ? '#fff' : C.textMuted} /><Text style={[styles.sendBtnTxt, !canSend && { color: C.textMuted }]}>Send Announcement</Text></>}
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
});

// ── Empty states ──────────────────────────────────────────────────────────────
const EmptySchedule = memo(({ dayName, isToday }) => (
  <View style={styles.emptySchedule}>
    <View style={styles.emptyScheduleIcon}>
      <Icon name="calendar-blank-outline" size={32} color={C.textMuted} />
    </View>
    <Text style={styles.emptyTitle}>No classes {isToday ? 'today' : `on ${dayName}`}</Text>
    <Text style={styles.emptyBody}>{isToday ? 'Enjoy your break — next scheduled classes shown above.' : 'No classes scheduled for this day.'}</Text>
  </View>
));

// ============================================================================
// MAIN SCREEN
// ============================================================================
export default function OverviewScreen({ navigation }) {
  const { isTablet, isDesktop, contentMaxWidth } = useResponsive();
  const colors = useColors();
  const C_local = useMemo(() => ({
    primary:      colors.primary.main,
    primaryDark:  colors.primary.dark,
    primaryLight: colors.primary.light,
    secondary:    colors.purple.main,
    success:      colors.success.main,
    successDark:  colors.success.dark,
    warning:      colors.warning.main,
    warningDark:  colors.warning.dark,
    error:        colors.danger.main,
    info:         colors.info.main,
    infoDark:     colors.info.dark,
    bg:           colors.background.primary,
    surface:      colors.surface.primary,
    surfaceEl:    colors.surface.secondary,
    surfaceHover: colors.surface.tertiary,
    textPrimary:  colors.text.primary,
    textSecondary:colors.text.secondary,
    textMuted:    colors.text.muted,
    border:       colors.border.light,
    borderLight:  colors.border.light,
  }), [colors]);
  // Assign to module-level C and styles so sub-components can read them from the closure
  Object.assign(C, C_local);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  styles = useMemo(() => makeStyles(C_local), [C_local]);
  const {
    timetable, units, stats, sparklines, atRiskCounts, upcomingDeadlines,
    activeSession, loading, refreshing, error, refresh, recheckActiveSession,
  } = useOverviewData();

  useEffect(() => {
    const unsub = navigation?.addListener?.('focus', recheckActiveSession);
    return () => unsub?.();
  }, [navigation, recheckActiveSession]);

  const [tick, setTick] = useState(() => new Date());
  useEffect(() => { const id = setInterval(() => setTick(new Date()), 30000); return () => clearInterval(id); }, []);

  const [showAnnounce, setShowAnnounce] = useState(false);

  const handleSendAnnouncement = useCallback(async ({ unitCode, message }) => {
    try {
      const s = await getLecturerSession();
      if (!s?.token) return;
      await fetch(`${API_BASE_URL}/api/lecturer/announcements`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ unitCode, message }),
      });
    } catch (_) {}
  }, []);

  const { dayName, sessions: daySchedule, isToday } = useMemo(() => resolveDisplayDay(timetable), [timetable]);
  const nextClass = useMemo(() => getNextClassData(timetable, tick), [timetable, tick]);
  const atRiskTotal = useMemo(() => Object.values(atRiskCounts).reduce((s, n) => s + n, 0), [atRiskCounts]);

  const handleStartAttendance = useCallback((session) => {
    navigation.navigate('Attendance', {
      unitCode:   session?.unitCode,
      unitName:   session?.unitName || session?.unitTitle || session?.unitCode,
      lessonType: session?.lessonType || 'Lecture',
    });
  }, [navigation]);

  return (
    <View style={styles.screen}>
      <LecturerHeader navigation={navigation} />
      <OfflineBanner />

      {/* Live session pinned above scroll — always visible when active */}
      {!!activeSession && (
        <LiveSessionWidget session={activeSession} onPress={() => navigation.navigate('Attendance')} />
      )}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          (isTablet || isDesktop) && { maxWidth: contentMaxWidth, alignSelf: 'center', width: '100%' },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[C.primary]} tintColor={C.primary} />}
      >

        {/* ── Key stats 2×2 ──────────────────────────────────────── */}
        <FadeIn delay={0}>
          <View style={styles.statsGrid}>
            <StatCard icon="book-open-variant" value={stats.units || '—'} label="Units" color={C.primary} />
            <StatCard
              icon="account-group"
              value={stats.uniqueStudents > 0 ? stats.uniqueStudents.toLocaleString() : stats.students > 0 ? stats.students.toLocaleString() : '—'}
              label="Students"
              color={C.success}
            />
            <StatCard icon="calendar-check" value={stats.totalSessions || '—'} label="Sessions" color={C.secondary} />
            <StatCard
              icon="chart-line"
              value={stats.avgAttendance != null ? `${stats.avgAttendance}%` : '—'}
              label="Avg. Attendance"
              color={stats.avgAttendance != null && stats.avgAttendance >= 70 ? C.success : C.warning}
            />
          </View>
        </FadeIn>

        {/* ── At-risk alert strip (compact) ─────────────────────── */}
        {!loading && atRiskTotal > 0 && (
          <FadeIn delay={60}>
            <TouchableOpacity
              style={styles.atRiskBanner}
              onPress={() => navigation.navigate('Analytics')}
              activeOpacity={0.85}
            >
              <LinearGradient colors={[`${C.error}20`, `${C.error}08`]} style={StyleSheet.absoluteFill} borderRadius={16} />
              <View style={[styles.atRiskIconWrap, { backgroundColor: `${C.error}28` }]}>
                <Icon name="account-alert-outline" size={16} color={C.error} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.atRiskTitle}>{atRiskTotal} student{atRiskTotal !== 1 ? 's' : ''} need attention</Text>
                <Text style={styles.atRiskSub}>Below attendance threshold · Tap for details</Text>
              </View>
              <Icon name="chevron-right" size={16} color={C.error} />
            </TouchableOpacity>
          </FadeIn>
        )}

        {/* ── Next class hero ────────────────────────────────────── */}
        {!loading && nextClass && (
          <FadeIn delay={80}>
            <View style={styles.section}>
              <SectionHeader icon="clock-fast" title="Up Next" />
              <NextClassHero nextClass={nextClass} onStart={handleStartAttendance} />
            </View>
          </FadeIn>
        )}

        {/* ── Today's schedule ───────────────────────────────────── */}
        <FadeIn delay={120}>
          <View style={styles.section}>
            <SectionHeader
              icon="calendar-today"
              title={isToday ? "Today's Classes" : `${dayName}'s Classes`}
              count={daySchedule.length > 0 ? daySchedule.length : undefined}
            />
            {loading
              ? [1, 2].map(i => <SkeletonLesson key={i} />)
              : daySchedule.length > 0
                ? daySchedule.map((entry, i) => (
                    <LessonCard
                      key={`${entry.unitCode}-${i}`}
                      entry={entry}
                      index={i}
                      total={daySchedule.length}
                      onStart={() => handleStartAttendance(entry)}
                    />
                  ))
                : <EmptySchedule dayName={dayName} isToday={isToday} />
            }
          </View>
        </FadeIn>

        {/* ── Quick actions ──────────────────────────────────────── */}
        <FadeIn delay={160}>
          <View style={styles.section}>
            <SectionHeader icon="gesture-tap" title="Quick Actions" />
            <QuickActionsGrid
              onStartAttendance={() => navigation.navigate('Attendance')}
              onTeachingHub={() => navigation.navigate('Teaching Hub')}
              onAnalytics={() => navigation.navigate('Analytics')}
              onTimetable={() => navigation.navigate('Timetable')}
              onReports={() => navigation.navigate('Reports')}
              onAnnounce={() => setShowAnnounce(true)}
            />
          </View>
        </FadeIn>

        {/* ── Unit performance cards ─────────────────────────────── */}
        {!loading && units.length > 0 && (
          <FadeIn delay={200}>
            <View style={styles.section}>
              <SectionHeader
                icon="chart-bar"
                title="Unit Performance"
                onAction={() => navigation.navigate('Analytics')}
              />
              <View style={styles.unitCardsList}>
                {units.map((unit) => (
                  <UnitCard
                    key={unit.code}
                    unit={unit}
                    sparkline={sparklines[toKey(unit.code)]}
                    atRisk={atRiskCounts[toKey(unit.code)] ?? 0}
                    onPress={() => navigation.navigate('Analytics', { unitCode: unit.code })}
                  />
                ))}
              </View>
            </View>
          </FadeIn>
        )}

        {/* ── Smart insights ─────────────────────────────────────── */}
        {!loading && (
          <View style={styles.section}>
            <SmartInsightCard
              units={units}
              atRiskCounts={atRiskCounts}
              upcomingDeadlines={upcomingDeadlines}
              sparklines={sparklines}
            />
          </View>
        )}

        {/* ── Upcoming deadlines ─────────────────────────────────── */}
        <View style={styles.section}>
          <DeadlineCard deadlines={upcomingDeadlines} />
        </View>

        {/* ── Error ──────────────────────────────────────────────── */}
        {!!error && (
          <View style={styles.errorBanner}>
            <Icon name="alert-circle-outline" size={15} color={C.error} />
            <Text style={styles.errorTxt} numberOfLines={2}>{error}</Text>
            <TouchableOpacity onPress={refresh} style={styles.retryBtn}>
              <Text style={styles.retryTxt}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Empty state ────────────────────────────────────────── */}
        {!loading && !error && units.length === 0 && timetable.length === 0 && (
          <View style={styles.fullEmpty}>
            <LinearGradient colors={[C.surfaceEl, C.surface]} style={styles.fullEmptyIcon}>
              <Icon name="calendar-blank" size={48} color={C.textMuted} />
            </LinearGradient>
            <Text style={styles.fullEmptyTitle}>No timetable yet</Text>
            <Text style={styles.fullEmptyBody}>Your timetable hasn't been published yet. Pull down to refresh.</Text>
          </View>
        )}

        <View style={{ height: SP.xxxl + 24 }} />
      </ScrollView>

      <QuickResponseModal
        visible={showAnnounce}
        onClose={() => setShowAnnounce(false)}
        units={units}
        onSend={handleSendAnnouncement}
      />
    </View>
  );
}

// ============================================================================
// STYLES
// ============================================================================
const makeStyles = (C) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: SP.xxxl },

  // ── Live session widget ────────────────────────────────────────────────────
  liveWidget: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SP.lg,
    paddingVertical: SP.md,
    borderBottomWidth: 1,
    borderBottomColor: `${C.success}20`,
    overflow: 'hidden',
  },
  livePulseWrap: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center', marginRight: SP.md },
  livePulseDot:  { position: 'absolute', width: 16, height: 16, borderRadius: 8, backgroundColor: C.success },
  liveDotInner:  { width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff' },
  liveLabel:     { fontSize: 10, fontWeight: FW.bold, color: C.success, letterSpacing: 1.2, marginBottom: 2 },
  liveUnit:      { fontSize: 14, fontWeight: FW.semibold, color: C.textPrimary },
  liveElapsed:   { fontSize: 11, color: C.textMuted, marginTop: 2 },
  liveResumeBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: SP.md, paddingVertical: SP.xs, borderRadius: 20 },
  liveResumeTxt: { fontSize: 13, fontWeight: FW.semibold, color: '#fff' },

  // ── Stats 2×2 grid ─────────────────────────────────────────────────────────
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: SP.lg,
    paddingTop: SP.lg,
    gap: SP.md,
  },
  statCard: {
    flex: 1,
    minWidth: '44%',
    borderRadius: 18,
    borderWidth: 1,
    padding: SP.lg,
    overflow: 'hidden',
  },
  statIcon:  { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: SP.sm },
  statValue: { fontSize: 26, fontWeight: FW.extrabold, color: C.textPrimary, letterSpacing: -0.5 },
  statLabel: { fontSize: 12, color: C.textSecondary, marginTop: 2, fontWeight: FW.medium },

  // ── At-risk banner ─────────────────────────────────────────────────────────
  atRiskBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: SP.lg,
    marginTop: SP.md,
    borderRadius: 16,
    padding: SP.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: `${C.error}22`,
    gap: SP.md,
  },
  atRiskIconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  atRiskTitle:   { fontSize: 13, fontWeight: FW.semibold, color: C.error, marginBottom: 2 },
  atRiskSub:     { fontSize: 11, color: C.textMuted },

  // ── Section wrapper ────────────────────────────────────────────────────────
  section: { marginTop: SP.xl },

  // ── Section header ──────────────────────────────────────────────────────────
  secHeader:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.lg, marginBottom: SP.md },
  secHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  secTitle:      { fontSize: 15, fontWeight: FW.bold, color: C.textPrimary },
  secCountBadge: { backgroundColor: C.surfaceEl, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 1 },
  secCountTxt:   { fontSize: 11, fontWeight: FW.semibold, color: C.textSecondary },
  secAction:     { flexDirection: 'row', alignItems: 'center', gap: 2 },
  secActionTxt:  { fontSize: 13, color: C.primary, fontWeight: FW.medium },

  // ── Next class hero ─────────────────────────────────────────────────────────
  nextCard: {
    marginHorizontal: SP.lg,
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
  },
  nextAccentBar: { width: 4, alignSelf: 'stretch' },
  nextBody:      { flex: 1, padding: SP.lg },
  nextTopRow:    { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.sm },
  nextWhenTag:   { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: SP.sm, paddingVertical: 3, borderRadius: 8 },
  nextLiveDot:   { width: 6, height: 6, borderRadius: 3 },
  nextWhenTxt:   { fontSize: 11, fontWeight: FW.bold, letterSpacing: 0.8 },
  nextCd:        { fontSize: 13, fontWeight: FW.semibold },
  nextUnitName:  { fontSize: 16, fontWeight: FW.bold, color: C.textPrimary, marginBottom: 3 },
  nextUnitCode:  { fontSize: 12, color: C.textMuted, marginBottom: SP.sm, fontWeight: FW.medium },
  nextMeta:      { flexDirection: 'row', alignItems: 'center', gap: 4 },
  nextMetaTxt:   { fontSize: 11, color: C.textMuted },
  nextMetaDot:   { width: 3, height: 3, borderRadius: 1.5, backgroundColor: C.textMuted, marginHorizontal: 2 },
  nextStartBtn:  { margin: SP.lg, paddingHorizontal: SP.lg, paddingVertical: SP.md, borderRadius: 16, alignItems: 'center', gap: 4 },
  nextStartTxt:  { fontSize: 13, fontWeight: FW.bold, color: '#fff' },

  // ── Lesson card (schedule) ──────────────────────────────────────────────────
  lessonCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: SP.lg,
    marginBottom: SP.sm,
    borderRadius: 14,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    overflow: 'hidden',
    minHeight: 70,
  },
  lessonBar:      { width: 4, alignSelf: 'stretch' },
  lessonTimeCol:  { width: 58, paddingLeft: SP.md, alignItems: 'flex-start' },
  lessonTimeStart:{ fontSize: 13, fontWeight: FW.bold, color: C.textPrimary },
  lessonTimeEnd:  { fontSize: 11, color: C.textMuted, marginTop: 2 },
  lessonSep:      { width: 1, height: '60%', backgroundColor: C.border, marginHorizontal: SP.sm },
  lessonInfo:     { flex: 1, paddingVertical: SP.md },
  lessonInfoTop:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SP.sm },
  lessonUnit:     { fontSize: 14, fontWeight: FW.semibold, color: C.textPrimary, flex: 1 },
  lessonTypePill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  lessonTypeTxt:  { fontSize: 10, fontWeight: FW.bold, letterSpacing: 0.3 },
  lessonCode:     { fontSize: 11, color: C.textMuted, marginTop: 2 },
  lessonMeta:     { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 4 },
  lessonMetaTxt:  { fontSize: 11, color: C.textMuted },
  lessonStartChip:{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: SP.md, paddingVertical: SP.sm, margin: SP.md, borderRadius: 12 },
  lessonStartTxt: { fontSize: 12, fontWeight: FW.semibold, color: '#fff' },

  // ── Quick actions flat grid ────────────────────────────────────────────────
  qaGrid:  { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: SP.lg, gap: SP.md },
  qaCell:  { width: '29%', flexGrow: 1, alignItems: 'center', gap: 8 },
  qaIcon:  { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  qaLabel: { fontSize: 12, color: C.textSecondary, fontWeight: FW.medium, textAlign: 'center' },

  // ── Unit cards column list ─────────────────────────────────────────────────
  unitCardsList:  { paddingHorizontal: SP.lg, gap: SP.sm },
  unitCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: SP.md,
    paddingHorizontal: SP.lg,
    overflow: 'hidden',
  },
  unitCardLeft:   { flex: 1, gap: SP.xs },
  unitCardTop:    { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  unitCardDot:    { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  unitCardCode:   { flex: 1, fontSize: 13, fontWeight: FW.bold, color: C.textPrimary },
  unitGradePill:  { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  unitGradeTxt:   { fontSize: 9, fontWeight: FW.bold, letterSpacing: 0.3 },
  unitCardRight:  { alignItems: 'flex-end', gap: 2 },
  unitRate:       { fontSize: 24, fontWeight: FW.extrabold, letterSpacing: -0.5 },
  unitRateLbl:    { fontSize: 10, color: C.textMuted, fontWeight: FW.medium },
  unitAtRisk:     { flexDirection: 'row', alignItems: 'center', gap: 4 },
  unitAtRiskTxt:  { fontSize: 11, fontWeight: FW.semibold },
  unitSessions:   { fontSize: 11, color: C.textMuted, fontWeight: FW.medium },

  // ── Smart insights card ─────────────────────────────────────────────────────
  insightCard: {
    marginHorizontal: SP.lg,
    borderRadius: 18,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    overflow: 'hidden',
  },
  insightHeader:  { flexDirection: 'row', alignItems: 'center', gap: SP.sm, padding: SP.lg, borderBottomWidth: 1, borderBottomColor: C.border },
  insightBulb:    { width: 28, height: 28, borderRadius: 10, backgroundColor: `${C.warning}18`, alignItems: 'center', justifyContent: 'center' },
  insightTitle:   { fontSize: 14, fontWeight: FW.bold, color: C.textPrimary },
  insightRow:     { flexDirection: 'row', alignItems: 'flex-start', gap: SP.md, padding: SP.lg },
  insightRowIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  insightRowTitle:{ fontSize: 13, fontWeight: FW.semibold, color: C.textPrimary, marginBottom: 3 },
  insightRowBody: { fontSize: 12, color: C.textSecondary, lineHeight: 17 },

  // ── Deadline card ──────────────────────────────────────────────────────────
  deadlineCard: {
    marginHorizontal: SP.lg,
    borderRadius: 18,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: `${C.error}25`,
    overflow: 'hidden',
  },
  deadlineCardHeader: { flexDirection: 'row', alignItems: 'center', gap: SP.md, padding: SP.lg, borderBottomWidth: 1, borderBottomColor: `${C.error}15` },
  deadlineCardIcon:   { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  deadlineCardTitle:  { fontSize: 14, fontWeight: FW.bold, color: C.textPrimary },
  deadlineCardSub:    { fontSize: 12, color: C.textMuted, marginTop: 2 },
  deadlineRow:        { flexDirection: 'row', alignItems: 'center', padding: SP.lg, borderLeftWidth: 3, borderBottomWidth: 1, borderBottomColor: C.border, gap: SP.md },
  deadlineTitle:      { fontSize: 13, fontWeight: FW.semibold, color: C.textPrimary },
  deadlineUnit:       { fontSize: 11, color: C.textMuted, marginTop: 2 },
  deadlineBadge:      { paddingHorizontal: SP.sm, paddingVertical: 3, borderRadius: 10, alignSelf: 'flex-start' },
  deadlineDaysTxt:    { fontSize: 11, fontWeight: FW.bold },

  // ── Error banner ───────────────────────────────────────────────────────────
  errorBanner: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginHorizontal: SP.lg, marginTop: SP.lg, padding: SP.md, backgroundColor: `${C.error}12`, borderRadius: 14, borderWidth: 1, borderColor: `${C.error}25` },
  errorTxt:    { flex: 1, fontSize: 13, color: C.error },
  retryBtn:    { paddingHorizontal: SP.md, paddingVertical: SP.xs, backgroundColor: `${C.error}20`, borderRadius: 10 },
  retryTxt:    { fontSize: 12, fontWeight: FW.semibold, color: C.error },

  // ── Empty state ─────────────────────────────────────────────────────────────
  emptySchedule:     { alignItems: 'center', padding: SP.xxl, marginHorizontal: SP.lg },
  emptyScheduleIcon: { width: 60, height: 60, borderRadius: 20, backgroundColor: C.surfaceEl, alignItems: 'center', justifyContent: 'center', marginBottom: SP.lg },
  emptyTitle:        { fontSize: 15, fontWeight: FW.bold, color: C.textPrimary, marginBottom: SP.xs },
  emptyBody:         { fontSize: 13, color: C.textMuted, textAlign: 'center', lineHeight: 19 },
  fullEmpty:     { alignItems: 'center', padding: SP.xxxl },
  fullEmptyIcon: { width: 84, height: 84, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: SP.xl },
  fullEmptyTitle:{ fontSize: 18, fontWeight: FW.bold, color: C.textPrimary, marginBottom: SP.sm },
  fullEmptyBody: { fontSize: 14, color: C.textMuted, textAlign: 'center', lineHeight: 21, paddingHorizontal: SP.xxl },

  // ── Announce modal ─────────────────────────────────────────────────────────
  modalOverlay:  { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)' },
  modalSheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingBottom: Platform.OS === 'ios' ? 34 : SP.xl,
    maxHeight: '85%',
  },
  modalDrag:      { width: 36, height: 4, borderRadius: 2, backgroundColor: C.surfaceHover, alignSelf: 'center', marginTop: SP.md, marginBottom: SP.lg },
  modalTitleRow:  { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: SP.xl, paddingBottom: SP.lg, gap: SP.md },
  modalTitleIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  modalTitle:     { fontSize: 18, fontWeight: FW.bold, color: C.textPrimary },
  modalSub:       { fontSize: 13, color: C.textMuted, marginTop: 3 },
  modalClose:     { width: 32, height: 32, borderRadius: 10, backgroundColor: C.surfaceEl, alignItems: 'center', justifyContent: 'center' },
  modalSection:   { marginBottom: SP.lg },
  modalLabel:     { fontSize: 12, fontWeight: FW.semibold, color: C.textMuted, letterSpacing: 0.5, textTransform: 'uppercase', marginHorizontal: SP.xl, marginBottom: SP.sm },
  unitChips:      { paddingHorizontal: SP.xl, gap: SP.sm },
  unitChip:       { paddingHorizontal: SP.md, paddingVertical: SP.xs, borderRadius: 20, backgroundColor: C.surfaceEl, borderWidth: 1, borderColor: C.border },
  unitChipActive: { backgroundColor: `${C.primary}20`, borderColor: C.primary },
  unitChipTxt:    { fontSize: 13, color: C.textSecondary, fontWeight: FW.medium },
  unitChipTxtActive: { color: C.primary, fontWeight: FW.semibold },
  templateChip:   { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: SP.md, paddingVertical: SP.sm, borderRadius: 20, backgroundColor: `${C.primary}12`, borderWidth: 1, borderColor: `${C.primary}25` },
  templateChipTxt:{ fontSize: 12, color: C.primary, fontWeight: FW.medium },
  messageInput: {
    marginHorizontal: SP.xl,
    backgroundColor: C.surfaceEl,
    borderRadius: 16,
    padding: SP.md,
    color: C.textPrimary,
    fontSize: 14,
    minHeight: 100,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: C.border,
  },
  charCount:   { fontSize: 11, color: C.textMuted, textAlign: 'right', marginHorizontal: SP.xl, marginTop: 4 },
  sendBtn:     { marginHorizontal: SP.xl, marginTop: SP.lg },
  sendBtnDisabled: { opacity: 0.5 },
  sendBtnGrad: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.sm, paddingVertical: SP.md, borderRadius: 16 },
  sendBtnTxt:  { fontSize: 15, fontWeight: FW.bold, color: '#fff' },
});
