// src/screens/student/home/AlertsScreen.js
import React, { useCallback, useMemo, useState, useRef, useEffect } from 'react';
import Icon from 'react-native-vector-icons/Ionicons';
import {
  Alert,
  SectionList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Animated,
  Platform,
  Vibration,
} from 'react-native';
import * as Animatable from 'react-native-animatable';
import LinearGradient from 'react-native-linear-gradient';
import { Swipeable } from 'react-native-gesture-handler';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useEnrollment } from '../../../context/EnrollmentContext';
import sqliteStorage from '../../../storage/sqliteStorage';
import { fetchStudentTimetableSnapshot } from '../../../utils/studentTimetableApi';
import { getStudentSession } from '../../../utils/authSession';

import { fetchMyDelegations, fetchMyGDAttendance } from '../../../utils/delegationApi';
import { fetchStudentAttendanceSummary } from '../../../utils/studentAttendanceApi';
import OfflineBanner from '../../../components/OfflineBanner';

import { onTimetableUpdated, onNotificationReceived } from '../../../utils/notificationEventBus';
import { dismissNotificationsOnBackend } from '../../../utils/notificationsInboxApi';
import { useColors } from '../../../theme';

const TARGET_ATTENDANCE_PERCENT = 75;

// Module-level cache for expensive network + SQLite data.
// Survives tab switches and remounts; reset on force-refresh or timetable events.
const _heavyCache = {
  timetable: null, records: null, conductedCounts: null,
  goalsByCode: null, serverStats: null, timestamp: 0,
};
const HEAVY_STALE_MS = 3 * 60 * 1000; // 3 minutes


const severityConfig = {
  critical: {
    icon: 'alert-circle',
    label: 'Critical',
    gradient: ['#EF4444', '#DC2626'],
    dot: '#EF4444',
    tag: { bg: 'rgba(239,68,68,0.18)', text: '#F87171' },
  },
  warning: {
    icon: 'warning',
    label: 'Warning',
    gradient: ['#F59E0B', '#D97706'],
    dot: '#F59E0B',
    tag: { bg: 'rgba(245,158,11,0.18)', text: '#FBBF24' },
  },
  info: {
    icon: 'information-circle',
    label: 'Info',
    gradient: ['#3B82F6', '#2563EB'],
    dot: '#3B82F6',
    tag: { bg: 'rgba(59,130,246,0.18)', text: '#60A5FA' },
  },
  delegation: {
    icon: 'people',
    label: 'Delegation',
    gradient: ['#10B981', '#059669'],
    dot: '#10B981',
    tag: { bg: 'rgba(16,185,129,0.18)', text: '#34D399' },
  },
  success: {
    icon: 'checkmark-circle',
    label: 'Achievement',
    gradient: ['#8B5CF6', '#6366F1'],
    dot: '#8B5CF6',
    tag: { bg: 'rgba(139,92,246,0.18)', text: '#A78BFA' },
  },
};

const parseUnit = (unitValue) => {
  if (typeof unitValue !== 'string') return { name: '', code: '' };
  const trimmed = unitValue.trim();
  if (!trimmed) return { name: '', code: '' };
  const match = trimmed.match(/\(([^)]+)\)\s*$/);
  if (!match || !match[1]) return { name: trimmed, code: trimmed.toUpperCase() };
  return { name: trimmed.slice(0, match.index).trim(), code: match[1].trim().toUpperCase() };
};

import { normalizeUnitCode } from '../../../utils/constants';
const normalizeComparableUnitCode = normalizeUnitCode;

// ── Helpers ──────────────────────────────────────────────────────────────────
const formatTimestamp = (timestamp) => {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};


// ── Notification Card ─────────────────────────────────────────────────────────
const NotifCard = ({ alert, isRead, onMarkRead, onDismiss, onAction, styles }) => {
  const cfg = severityConfig[alert.severity] || severityConfig.info;
  const swipeableRef = useRef(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(16)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 280, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, friction: 9, tension: 50, useNativeDriver: true }),
    ]).start();
  }, []);

  const handlePress = useCallback(() => {
    if (!isRead) onMarkRead();
    onAction();
  }, [isRead, onMarkRead, onAction]);

  const renderRightActions = () => (
    <TouchableOpacity
      style={styles.swipeDelete}
      onPress={() => { swipeableRef.current?.close(); onDismiss(); }}
      activeOpacity={0.85}
    >
      <LinearGradient colors={['#EF4444', '#DC2626']} style={styles.swipeDeleteGradient}>
        <Icon name="trash-outline" size={20} color="#FFF" />
        <Text style={styles.swipeDeleteText}>Remove</Text>
      </LinearGradient>
    </TouchableOpacity>
  );

  return (
    <Swipeable ref={swipeableRef} renderRightActions={renderRightActions} overshootRight={false}>
      <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
        <TouchableOpacity
          activeOpacity={0.82}
          onPress={handlePress}
          style={[styles.notifCard, !isRead && styles.notifCardUnread]}
        >
          {/* Left: unread indicator bar */}
          {!isRead && <View style={[styles.unreadBar, { backgroundColor: cfg.dot }]} />}

          <View style={styles.notifInner}>
            {/* Icon column */}
            <LinearGradient colors={cfg.gradient} style={styles.notifIconWrap}>
              <Icon name={cfg.icon} size={19} color="#FFF" />
            </LinearGradient>

            {/* Content column */}
            <View style={styles.notifBody}>
              {/* Row 1: category tag + timestamp */}
              <View style={styles.notifMeta}>
                <View style={[styles.notifTag, { backgroundColor: cfg.tag.bg }]}>
                  <Text style={[styles.notifTagText, { color: cfg.tag.text }]}>{cfg.label}</Text>
                </View>
                <Text style={styles.notifTime}>{formatTimestamp(alert.receivedAt)}</Text>
              </View>

              {/* Row 2: title */}
              <Text style={[styles.notifTitle, isRead && styles.notifTitleRead]} numberOfLines={1}>
                {alert.title}
              </Text>

              {/* Row 3: message */}
              <Text style={styles.notifMessage} numberOfLines={2}>
                {alert.message}
              </Text>

              {/* Row 4: action link */}
              <TouchableOpacity style={styles.notifActionRow} onPress={(e) => { e.stopPropagation?.(); onAction(); }}>
                <Text style={[styles.notifActionText, { color: cfg.tag.text }]}>
                  {alert.actionLabel || 'View Details'}
                </Text>
                <Icon name="chevron-forward" size={12} color={cfg.tag.text} />
              </TouchableOpacity>
            </View>

            {/* Right: unread dot */}
            {!isRead && <View style={[styles.unreadDot, { backgroundColor: cfg.dot }]} />}
          </View>
        </TouchableOpacity>
      </Animated.View>
    </Swipeable>
  );
};

// ── Section Header ────────────────────────────────────────────────────────────
const SectionHeader = ({ title, count, styles }) => (
  <View style={styles.sectionHeader}>
    <Text style={styles.sectionHeaderTitle}>{title}</Text>
    {count > 0 && (
      <View style={styles.sectionHeaderBadge}>
        <Text style={styles.sectionHeaderBadgeText}>{count}</Text>
      </View>
    )}
    <View style={styles.sectionHeaderLine} />
  </View>
);

// ── Empty State ───────────────────────────────────────────────────────────────
const EmptyState = ({ onRefresh, styles, C }) => (
  <View style={styles.emptyWrap}>
    <LinearGradient
      colors={[C.surfaceSecondary, C.surfaceCard]}
      style={styles.emptyIconBg}
    >
      <Icon name="notifications-off-outline" size={44} color={C.textMuted} />
    </LinearGradient>
    <Text style={styles.emptyTitle}>All clear!</Text>
    <Text style={styles.emptySubtitle}>
      You're fully up to date. New alerts will appear here.
    </Text>
    <TouchableOpacity style={styles.emptyBtn} onPress={onRefresh}>
      <Icon name="refresh-outline" size={15} color={C.primaryMain} />
      <Text style={styles.emptyBtnText}>Refresh</Text>
    </TouchableOpacity>
  </View>
);


// ============================================================================
// MAIN COMPONENT
// ============================================================================
export default function AlertsScreen() {
  const navigation = useNavigation();
  const { enrolledUnits } = useEnrollment();

  const colors = useColors();
  const C = useMemo(() => ({
    bg:              colors.background.primary,
    surfaceSecondary: colors.surface.secondary,
    surfaceCard:     colors.surface.card,
    surfacePrimary:  colors.surface.primary,
    surfaceTertiary: colors.surface.tertiary,
    textPrimary:     colors.text.primary,
    textSecondary:   colors.text.secondary,
    textTertiary:    colors.text.tertiary,
    textMuted:       colors.text.muted,
    borderLight:     colors.border.light,
    borderMedium:    colors.border.medium,
    primaryMain:     colors.primary.main,
    primaryLight:    colors.primary.light,
    primaryGradient: colors.primary.gradient,
    primarySoft:     colors.primary.soft,
    successMain:     colors.success.main,
    dangerMain:      colors.danger.main,
    warningMain:     colors.warning.main,
    infoMain:        colors.info.main,
  }), [colors]);
  const styles = useMemo(() => makeStyles(C), [C]);

  const [records, setRecords] = useState([]);
  const [conductedCounts, setConductedCounts] = useState({});
  const [goalsByCode, setGoalsByCode] = useState({});
  const [serverAttendanceStats, setServerAttendanceStats] = useState({});
  const [readAlertIds, setReadAlertIds] = useState({});
  const [dismissedIds, setDismissedIds] = useState({});
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hasNewAlertSignal, setHasNewAlertSignal] = useState(false);
  const [timetable, setTimetable] = useState([]);
  const [activeDelegations, setActiveDelegations] = useState([]);
  const [pushNotifications, setPushNotifications] = useState([]);

  // Set to true only when a real-time event (FCM / emitNotificationReceived) triggers
  // a reload — distinguishes live signals from regular focus-based disk reads.
  const pendingRealtimeNotifRef = useRef(false);

  // ── Fast path: SQLite-only reads, always fresh, ~30 ms ───────────────────
  // Runs on every focus and on every push notification event.
  // Keeps notifications and delegations current without touching the network.
  const loadFastData = useCallback(async () => {
    const [notifs, activeDels, session] = await Promise.all([
      sqliteStorage.getPushNotifications(50).catch(() => []),
      sqliteStorage.getActiveDelegations().catch(() => []),
      getStudentSession(),
    ]);
    setPushNotifications(Array.isArray(notifs) ? notifs : []);
    const myId = String(session?.studentId || '');
    const filtered = myId
      ? (activeDels || []).filter(
          (d) => !d.leaderStudentId || String(d.leaderStudentId) === myId,
        )
      : (activeDels || []);
    setActiveDelegations(filtered);
  }, []);

  // ── Heavy path: network + SQLite writes, stale-throttled ─────────────────
  // Skipped when cached data is fresher than HEAVY_STALE_MS.
  // Force-bypasses the threshold (manual refresh, timetable event, first load).
  const loadHeavyData = useCallback(async (force = false) => {
    const age = Date.now() - _heavyCache.timestamp;
    if (!force && _heavyCache.records !== null && age < HEAVY_STALE_MS) {
      setRecords(_heavyCache.records);
      setConductedCounts(_heavyCache.conductedCounts);
      setGoalsByCode(_heavyCache.goalsByCode);
      setServerAttendanceStats(_heavyCache.serverStats || {});
      setTimetable(_heavyCache.timetable || []);
      return;
    }

    try {
      const session = await getStudentSession();
      const accessToken = session?.token || null;
      const parsedCodes = (enrolledUnits || []).map((u) => parseUnit(u).code).filter(Boolean);

      const [timetableResult, gdRecords] = await Promise.all([
        accessToken
          ? fetchStudentTimetableSnapshot({ accessToken }).catch(() => null)
          : Promise.resolve(null),
        fetchMyGDAttendance().catch(() => []),
      ]);

      await Promise.all(
        (gdRecords || []).map((r) =>
          sqliteStorage.addAttendanceRecord({
            unitCode: r.unitCode,
            lectureRoom: r.roomCode,
            sessionStart: r.sessionStart,
            scannedAt: r.scannedAt || r.sessionStart,
            rawPayload: null,
            deviceId: `GD-${r.delegationId || `${r.unitCode}-${r.sessionStart}`}`,
            synced: 1,
            lessonType: 'GD',
          }).catch(() => {}),
        ),
      );
      await sqliteStorage.backfillConductedSessionsFromAttendance();

      const [attendanceRecords, conducted, goals, summaryRows, remoteDelegations] =
        await Promise.all([
          sqliteStorage.getAttendanceLightRecords(500),
          sqliteStorage.getConductedSessionCounts(),
          sqliteStorage.getUnitAttendanceGoals(parsedCodes),
          fetchStudentAttendanceSummary().catch(() => []),
          fetchMyDelegations().catch(() => []),
        ]);

      if (Array.isArray(remoteDelegations) && remoteDelegations.length > 0) {
        await sqliteStorage.saveDelegations(remoteDelegations).catch(() => {});
      }

      // Re-read delegations after server sync so the active list reflects new data.
      const freshDels = await sqliteStorage.getActiveDelegations().catch(() => []);
      const myId = String(session?.studentId || '');
      const filtered = myId
        ? (freshDels || []).filter(
            (d) => !d.leaderStudentId || String(d.leaderStudentId) === myId,
          )
        : (freshDels || []);
      setActiveDelegations(filtered);

      const statsMap = {};
      (Array.isArray(summaryRows) ? summaryRows : []).forEach((s) => {
        const code = normalizeComparableUnitCode(s.unitCode);
        if (code) statsMap[code] = { attended: s.attended, conducted: s.conducted };
      });

      const fetchedTimetable = timetableResult?.snapshot?.timetableByDay || [];

      _heavyCache.records         = Array.isArray(attendanceRecords) ? attendanceRecords : [];
      _heavyCache.conductedCounts = conducted && typeof conducted === 'object' ? conducted : {};
      _heavyCache.goalsByCode     = goals && typeof goals === 'object' ? goals : {};
      _heavyCache.serverStats     = statsMap;
      _heavyCache.timetable       = fetchedTimetable;
      _heavyCache.timestamp       = Date.now();

      setRecords(_heavyCache.records);
      setConductedCounts(_heavyCache.conductedCounts);
      setGoalsByCode(_heavyCache.goalsByCode);
      setTimetable(fetchedTimetable);
      if (Object.keys(statsMap).length > 0) setServerAttendanceStats(statsMap);
    } catch (err) {
      console.error('[AlertsScreen] Heavy load failed:', err);
      // Fall back to last good cache on error so screen doesn't go blank.
      if (_heavyCache.records !== null) {
        setRecords(_heavyCache.records);
        setConductedCounts(_heavyCache.conductedCounts);
        setGoalsByCode(_heavyCache.goalsByCode);
        setServerAttendanceStats(_heavyCache.serverStats || {});
        setTimetable(_heavyCache.timetable || []);
      }
    }
  }, [enrolledUnits]);

  // ── Combined loader ───────────────────────────────────────────────────────
  // fast + heavy in parallel. Spinner only shows on first load or manual pull.
  const loadAlertsData = useCallback(async (force = false, manual = false) => {
    if (manual || _heavyCache.timestamp === 0) setIsRefreshing(true);
    try {
      await Promise.all([loadFastData(), loadHeavyData(force)]);
    } catch (err) {
      console.error('[AlertsScreen] Load failed:', err);
    } finally {
      setIsRefreshing(false);
    }
  }, [loadFastData, loadHeavyData]);

  // Focus: fast + heavy (heavy skipped if fresh).
  useFocusEffect(useCallback(() => { loadAlertsData(false, false); }, [loadAlertsData]));

  // Real-time events:
  // • Push notification → fast path only (new row already in SQLite).
  // • Delegation notification → also needs updated server delegation list.
  // • Timetable event → invalidate cache and force full reload.
  useEffect(() => {
    const subNotif = onNotificationReceived((payload) => {
      pendingRealtimeNotifRef.current = true;
      if (payload?.type === 'delegation') {
        _heavyCache.timestamp = 0;
        loadAlertsData(true, false);
      } else {
        loadFastData();
      }
    });
    const subTimetable = onTimetableUpdated(() => {
      pendingRealtimeNotifRef.current = true;
      _heavyCache.timestamp = 0;
      loadAlertsData(true, false);
    });
    return () => { subNotif?.remove(); subTimetable?.remove(); };
  }, [loadFastData, loadAlertsData]);

  const enrolledCodes = useMemo(
    () => (enrolledUnits || []).map((unit) => parseUnit(unit).code).filter(Boolean),
    [enrolledUnits],
  );

  const statsByUnit = useMemo(() => {
    const attendanceByCode = records.reduce((acc, record) => {
      const code = normalizeComparableUnitCode(record?.unitCode);
      const sessionStart = Number(record?.sessionStart);
      if (!code || !Number.isFinite(sessionStart)) return acc;
      if (!acc[code]) acc[code] = new Set();
      acc[code].add(sessionStart);
      return acc;
    }, {});

    const conductedByCode = Object.entries(conductedCounts || {}).reduce((acc, [rawCode, total]) => {
      const code = normalizeComparableUnitCode(rawCode);
      if (!code) return acc;
      acc[code] = (acc[code] || 0) + (Number(total) || 0);
      return acc;
    }, {});

    return enrolledCodes.map((code) => {
      const normalizedCode = normalizeComparableUnitCode(code);
      const localAttended = attendanceByCode[normalizedCode]?.size || 0;
      // Prefer server-sourced counts — SQLite backfill derives conducted from attendance,
      // making conductedCount === attendedCount and hiding real missed sessions.
      const serverStat = serverAttendanceStats[normalizedCode];
      const attendedCount = serverStat?.attended ?? localAttended;
      const conductedCount = serverStat?.conducted ?? conductedByCode[normalizedCode] ?? 0;
      const missedCount = Math.max(0, conductedCount - attendedCount);
      const percentage = conductedCount > 0 ? Math.round((attendedCount / conductedCount) * 100) : 0;
      return { code, attendedCount, conductedCount, missedCount, percentage };
    });
  }, [records, conductedCounts, enrolledCodes, serverAttendanceStats]);

  const generatedAlerts = useMemo(() => {
    const alerts = [];

    activeDelegations.forEach((d) => {
      const nowMs = Date.now();
      const windowOpen = nowMs >= d.validFrom;
      const windowText = windowOpen
        ? `Window closes ${new Date(d.validUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
        : `Opens ${new Date(d.validFrom).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      alerts.push({
        id: `delegation-${d.id}`,
        severity: 'delegation',
        category: 'delegation',
        title: `Lead Group Discussion — ${d.unitCode}`,
        message: `${d.groupName || `Group ${d.groupNumber}`} · ${d.roomCode || 'Room TBA'} · ${windowText}`,
        actionLabel: 'Start Session',
        onPress: () => (navigation.getParent() ?? navigation).navigate('LeadSession', { delegation: d }),
      });
    });

    const now = new Date();
    const todayIndex = now.getDay();
    const currentMinutes = (now.getHours() * 60) + now.getMinutes();

    if (enrolledCodes.length === 0) {
      alerts.push({
        id: 'setup-enrollment',
        severity: 'warning',
        category: 'attendance',
        title: 'Complete your enrollment',
        message: 'No enrolled units found. Add your units to start tracking attendance and receive personalized alerts.',
        actionLabel: 'View Timetable',
        onPress: () => navigation.navigate('Timetable'),
      });
    }

    statsByUnit.forEach((item) => {
      const goal = goalsByCode[item.code] || goalsByCode[normalizeComparableUnitCode(item.code)] || null;
      const targetPercent = Number(goal?.targetPercent) || TARGET_ATTENDANCE_PERCENT;
      const reminderEnabled = Number(goal?.reminderEnabled) ? 1 : 0;
      const reminderDays = String(goal?.reminderDays || '1,3,5').split(',').map((v) => Number(v.trim())).filter((v) => Number.isFinite(v));
      const reminderTime = String(goal?.reminderTime || '08:00');
      const [remHour, remMinute] = reminderTime.split(':').map((v) => Number(v));
      const reminderMinutes = (Number.isFinite(remHour) ? remHour : 8) * 60 + (Number.isFinite(remMinute) ? remMinute : 0);

      if (item.conductedCount > 0) {
        if (item.percentage < 50) {
          alerts.push({
            id: `critical-${item.code}`,
            severity: 'critical',
            category: 'attendance',
            title: `${item.code} attendance critically low`,
            message: `Current attendance is ${item.percentage}% (${item.attendedCount}/${item.conductedCount}). You've missed ${item.missedCount} session${item.missedCount > 1 ? 's' : ''}.`,
            actionLabel: 'View Progress',
            onPress: () => navigation.navigate('Home', { screen: 'Progress' }),
          });
        } else if (item.percentage < TARGET_ATTENDANCE_PERCENT) {
          alerts.push({
            id: `warning-${item.code}`,
            severity: 'warning',
            category: 'attendance',
            title: `${item.code} below ${TARGET_ATTENDANCE_PERCENT}% target`,
            message: `You're at ${item.percentage}% (${item.attendedCount}/${item.conductedCount}). Need ${Math.ceil((targetPercent * item.conductedCount / 100) - item.attendedCount)} more attendance to reach target.`,
            actionLabel: 'View Progress',
            onPress: () => navigation.navigate('Home', { screen: 'Progress' }),
          });
        }

        if (targetPercent > TARGET_ATTENDANCE_PERCENT && item.percentage < targetPercent) {
          const gap = targetPercent - item.percentage;
          alerts.push({
            id: `goal-risk-${item.code}`,
            severity: gap >= 20 ? 'critical' : 'warning',
            category: 'attendance',
            title: `${item.code} attendance goal at risk`,
            message: `Current ${item.percentage}% vs target ${targetPercent}%. ${gap >= 20 ? 'Immediate action recommended.' : 'Keep attending to stay on track.'}`,
            actionLabel: 'View Goals',
            onPress: () => navigation.navigate('Home', { screen: 'Progress' }),
          });
        }

        if (item.missedCount >= 2) {
          alerts.push({
            id: `missed-${item.code}`,
            severity: 'warning',
            category: 'attendance',
            title: `${item.code} missed sessions`,
            message: `You've missed ${item.missedCount} consecutive session${item.missedCount > 1 ? 's' : ''}. Attend the next class to improve your standing.`,
            actionLabel: 'View Schedule',
            onPress: () => navigation.navigate('Home', { screen: 'Sessions' }),
          });
        }
      }

      if (reminderEnabled && reminderDays.includes(todayIndex) && currentMinutes >= reminderMinutes) {
        alerts.push({
          id: `goal-reminder-${item.code}`,
          severity: 'info',
          category: 'attendance',
          title: `${item.code} attendance goal reminder`,
          message: `Time to check your progress toward ${targetPercent}% attendance. Stay on track!`,
          actionLabel: 'Check Progress',
          onPress: () => navigation.navigate('Home', { screen: 'Progress' }),
        });
      }

      if (item.percentage === 100 && item.conductedCount >= 5) {
        alerts.push({
          id: `perfect-${item.code}`,
          severity: 'success',
          category: 'attendance',
          title: `Perfect attendance in ${item.code}! 🎉`,
          message: `You've maintained 100% attendance for ${item.conductedCount} sessions. Excellent work!`,
          actionLabel: 'Share Achievement',
          onPress: () => {
            Alert.alert('Achievement Unlocked!', `Perfect attendance in ${item.code} for ${item.conductedCount} sessions. Keep it up!`);
          },
        });
      }
    });

    const enrolledCodeSet = new Set(enrolledCodes.map((code) => normalizeComparableUnitCode(code)));
    const seenLessonIds = new Set();
    (timetable || []).forEach((day) => {
      (day.lessons || []).forEach((lesson) => {
        const code = parseUnit(lesson.unit).code;
        if (!enrolledCodeSet.has(normalizeComparableUnitCode(code))) return;
        if ((lesson.status === 'Cancelled' || lesson.status === 'Rescheduled' || lesson.status === 'Pending') && !seenLessonIds.has(lesson.id)) {
          seenLessonIds.add(lesson.id);
          let alertMessage;
          if (lesson.status === 'Rescheduled' && (lesson.rescheduledTo || lesson.rescheduledVenue)) {
            const { time: newTime, roomCode: newRoom } = parseRescheduledInfo(lesson.rescheduledTo, lesson.rescheduledVenue);
            const scope = lesson.reschedulePermanent ? 'Permanent' : 'This week';
            alertMessage = `Moved to ${newTime || lesson.time || 'TBA'} · ${newRoom || lesson.roomCode || lesson.venue || 'TBA'} (${scope})`;
          } else {
            alertMessage = `${lesson.day || day.day || ''} ${lesson.time || ''} · ${lesson.roomCode || lesson.venue || 'Venue TBA'}`.trim();
          }
          alerts.push({
            id: `schedule-${lesson.id}`,
            severity: lesson.status === 'Cancelled' ? 'critical' : 'info',
            category: 'schedule',
            title: `${code} ${lesson.status === 'Rescheduled' ? 'rescheduled' : lesson.status === 'Cancelled' ? 'cancelled' : 'pending confirmation'}`,
            message: alertMessage,
            actionLabel: 'View Timetable',
            onPress: () => navigation.navigate('Timetable'),
          });
        }
      });
    });

    alerts.push({
      id: 'security-duplicate-guard',
      severity: 'info',
      category: 'notifications',
      title: 'Duplicate attendance protection active',
      message: 'Your account is protected against duplicate attendance marks across QR, BLE, and manual PIN methods.',
      actionLabel: 'Learn More',
      onPress: () => {
        Alert.alert('Security Feature', 'Your attendance records are protected against duplicate submissions. Each session can only be marked once per device.');
      },
    });

    const latestAttendance = records[0];
    if (latestAttendance) {
      alerts.push({
        id: 'latest-activity',
        severity: 'info',
        category: 'attendance',
        title: 'Recent attendance recorded',
        message: `${latestAttendance.unitCode} at ${latestAttendance.lectureRoom || 'unknown location'} · ${new Date(Number(latestAttendance.scannedAt)).toLocaleString()}`,
        actionLabel: 'View Details',
        onPress: () => navigation.navigate('Home', { screen: 'Progress' }),
      });
    }

    const typeToNav = {
      timetable:           () => navigation.navigate('Timetable'),
      unit_merged:         () => navigation.navigate('Timetable'),
      LESSON_CONFIRMED:    () => navigation.navigate('Timetable'),
      LESSON_CANCELLED:    () => navigation.navigate('Timetable'),
      LESSON_RESCHEDULED:  () => navigation.navigate('Timetable'),
      MERGED_LESSON:       () => navigation.navigate('Timetable'),
      UNMERGED_LESSON:     () => navigation.navigate('Timetable'),
      LESSON_ONLINE:       () => navigation.navigate('Home', { screen: 'Sessions' }),
      meeting_invite:      () => (navigation.getParent() ?? navigation).navigate('MeetingInvites'),
      groups:              () => navigation.navigate('Home', { screen: 'Sessions' }),
      assignment:          () => navigation.navigate('AssignmentsScreen'),
      materials:           () => navigation.navigate('MaterialsScreen'),
      delegation:          () => (navigation.getParent() ?? navigation).navigate('LeadSession'),
      achievement:         () => navigation.navigate('Home', { screen: 'Achievements' }),
      general:             () => {},
    };
    const typeSeverity = {
      timetable: 'info', unit_merged: 'warning',
      LESSON_CONFIRMED: 'info', LESSON_CANCELLED: 'critical', LESSON_RESCHEDULED: 'warning',
      MERGED_LESSON: 'warning', UNMERGED_LESSON: 'warning',
      LESSON_ONLINE: 'info', meeting_invite: 'info',
      groups: 'info', assignment: 'warning', materials: 'info',
      delegation: 'delegation', achievement: 'success', general: 'info',
    };
    const typeLabel = {
      timetable: 'View Timetable', unit_merged: 'View Timetable',
      LESSON_CONFIRMED: 'View Timetable', LESSON_CANCELLED: 'View Timetable', LESSON_RESCHEDULED: 'View Timetable',
      MERGED_LESSON: 'View Timetable', UNMERGED_LESSON: 'View Timetable',
      LESSON_ONLINE: 'View Sessions', meeting_invite: 'View Invite',
      groups: 'View Sessions', assignment: 'View Assignment',
      materials: 'View Materials', delegation: 'Start Session',
      achievement: 'View Achievement', general: 'View',
    };

    pushNotifications.forEach((n) => {
      const t = n.type || 'general';
      const categoryFor = (type) => {
        if (type === 'delegation') return 'delegation';
        if (type === 'achievement') return 'notifications';
        return 'notifications';
      };
      alerts.push({
        id: `push-${n.id}`,
        severity: typeSeverity[t] || 'info',
        category: categoryFor(t),
        title: n.title || 'Notification',
        message: n.body || '',
        actionLabel: typeLabel[t] || 'View',
        onPress: typeToNav[t] || (() => {}),
        receivedAt: n.receivedAt,
        read: !!n.read,
      });
    });

    const dedupedAlerts = [...new Map(alerts.map((a) => [a.id, a])).values()];
    const severityOrder = { critical: 0, warning: 1, delegation: 2, success: 2.5, info: 3 };
    return dedupedAlerts.sort((a, b) => {
      if (severityOrder[a.severity] !== severityOrder[b.severity]) return severityOrder[a.severity] - severityOrder[b.severity];
      return (b.receivedAt || 0) - (a.receivedAt || 0);
    });
  }, [activeDelegations, pushNotifications, enrolledCodes, statsByUnit, records, navigation, goalsByCode, timetable]);

  // Only vibrate when a genuine real-time event fired (not on regular focus reloads
  // or async data arriving from disk). pendingRealtimeNotifRef is set exclusively
  // by the onTimetableUpdated / onNotificationReceived handlers above.
  useEffect(() => {
    if (!pendingRealtimeNotifRef.current) return;
    pendingRealtimeNotifRef.current = false;
    setHasNewAlertSignal(true);
    Vibration.vibrate([0, 120, 60, 120]);
  }, [generatedAlerts]);

  const filteredAlerts = useMemo(
    () => generatedAlerts.filter((a) => !dismissedIds[a.id]),
    [generatedAlerts, dismissedIds],
  );

  const alertStats = useMemo(() => ({
    total: filteredAlerts.length,
    unread: filteredAlerts.filter(a => !readAlertIds[a.id]).length,
    critical: filteredAlerts.filter(a => a.severity === 'critical').length,
    warning: filteredAlerts.filter(a => a.severity === 'warning').length,
    info: filteredAlerts.filter(a => a.severity === 'info' || a.severity === 'success').length,
    delegation: filteredAlerts.filter(a => a.severity === 'delegation').length,
  }), [filteredAlerts, readAlertIds]);

  const markAsRead = useCallback((id) => {
    setReadAlertIds((prev) => ({ ...prev, [id]: true }));
    if (hasNewAlertSignal) setHasNewAlertSignal(false);
    if (id.startsWith('push-')) {
      sqliteStorage.markNotificationRead(id.slice('push-'.length)).catch(() => {});
    }
  }, [hasNewAlertSignal]);

  const markAllRead = useCallback(() => {
    const allIds = filteredAlerts.reduce((acc, a) => ({ ...acc, [a.id]: true }), {});
    setReadAlertIds((prev) => ({ ...prev, ...allIds }));
    setHasNewAlertSignal(false);
  }, [filteredAlerts]);

  const clearDelegations = useCallback(async () => {
    Alert.alert('Clear Delegations', 'This will remove all delegation notifications.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: async () => {
        await sqliteStorage.clearDelegationNotifications().catch(() => {});
        setActiveDelegations([]);
        setPushNotifications((prev) => prev.filter((n) => n.type !== 'delegation'));
      }},
    ]);
  }, []);

  const dismissAlert = useCallback(async (alertId) => {
    setDismissedIds((prev) => ({ ...prev, [alertId]: true }));
    if (alertId.startsWith('push-')) {
      const rawId = alertId.slice('push-'.length);
      await sqliteStorage.deleteNotification(rawId).catch(() => {});
      setPushNotifications((prev) => prev.filter((n) => String(n.id) !== String(rawId)));
      // Sync dismissal to backend so it reflects across all devices.
      dismissNotificationsOnBackend([rawId]).catch(() => {});
    }
  }, []);

  const deleteAllNotifications = useCallback(() => {
    Alert.alert('Clear All Notifications', 'This will permanently remove all push notifications from this device.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear All', style: 'destructive', onPress: async () => {
        await sqliteStorage.deleteAllNotifications().catch(() => {});
        setPushNotifications([]);
      }},
    ]);
  }, []);

  // Group alerts into sections
  const sections = useMemo(() => {
    const active = [];
    const pushed = [];
    filteredAlerts.forEach(a => {
      if (a.receivedAt) pushed.push(a);
      else active.push(a);
    });
    const result = [];
    if (active.length > 0) result.push({ title: 'Active', data: active });
    if (pushed.length > 0) result.push({ title: 'Received', data: pushed });
    return result;
  }, [filteredAlerts]);

  return (
    <View style={styles.screen}>
      <OfflineBanner />

      {/* ── Header ── */}
      <LinearGradient
        colors={['#0F1C35', '#0B1120']}
        style={styles.header}
      >
        {/* Top row */}
        <View style={styles.headerTopRow}>
          <View style={styles.headerTitleGroup}>
            <View style={styles.headerIconWrap}>
              <LinearGradient colors={C.primaryGradient} style={styles.headerIconGradient}>
                <Icon name="notifications" size={18} color="#FFF" />
              </LinearGradient>
            </View>
            <View>
              <Text style={styles.headerTitle}>Notifications</Text>
              {alertStats.unread > 0 ? (
                <Text style={styles.headerSubtitle}>
                  <Text style={{ color: C.primaryLight }}>{alertStats.unread} unread</Text>
                  {' '}of {alertStats.total}
                </Text>
              ) : (
                <Text style={styles.headerSubtitle}>{alertStats.total} alerts</Text>
              )}
            </View>
            {hasNewAlertSignal && (
              <Animatable.View animation="pulse" easing="ease-out" iterationCount="infinite" useNativeDriver style={styles.newDot}>
                <View style={styles.newDotInner} />
              </Animatable.View>
            )}
          </View>

          <View style={styles.headerActions}>
            {alertStats.unread > 0 && (
              <TouchableOpacity style={styles.headerBtn} onPress={markAllRead}>
                <Icon name="checkmark-done" size={17} color={C.primaryLight} />
              </TouchableOpacity>
            )}
            {activeDelegations.length > 0 && (
              <TouchableOpacity style={styles.headerBtn} onPress={clearDelegations}>
                <Icon name="people" size={17} color={C.successMain} />
              </TouchableOpacity>
            )}
            {pushNotifications.length > 0 && (
              <TouchableOpacity style={styles.headerBtn} onPress={deleteAllNotifications}>
                <Icon name="trash-outline" size={17} color={C.dangerMain} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Stats row */}
        <View style={styles.statsRow}>
          {[
            { label: 'Critical', value: alertStats.critical, color: C.dangerMain },
            { label: 'Warning', value: alertStats.warning, color: C.warningMain },
            { label: 'Info', value: alertStats.info, color: C.infoMain },
            { label: 'Other', value: alertStats.delegation, color: C.successMain },
          ].map((s, i) => (
            <View key={s.label} style={[styles.statChip, i > 0 && { marginLeft: 8 }]}>
              <View style={[styles.statChipDot, { backgroundColor: s.color }]} />
              <Text style={[styles.statChipValue, { color: s.color }]}>{s.value}</Text>
              <Text style={styles.statChipLabel}>{s.label}</Text>
            </View>
          ))}
        </View>
      </LinearGradient>

      {/* ── Alerts List ── */}
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => { _heavyCache.timestamp = 0; loadAlertsData(true, true); }}
            tintColor={C.primaryMain}
            colors={[C.primaryMain]}
          />
        }
        renderSectionHeader={({ section }) => (
          <SectionHeader title={section.title} count={section.data.length} styles={styles} />
        )}
        ListEmptyComponent={<EmptyState onRefresh={() => { _heavyCache.timestamp = 0; loadAlertsData(true, true); }} styles={styles} C={C} />}
        ListFooterComponent={<View style={{ height: 24 }} />}
        stickySectionHeadersEnabled={false}
        renderItem={({ item: alert }) => (
          <NotifCard
            alert={alert}
            isRead={!!readAlertIds[alert.id]}
            onMarkRead={() => markAsRead(alert.id)}
            onDismiss={() => dismissAlert(alert.id)}
            onAction={alert.onPress}
            styles={styles}
          />
        )}
      />

    </View>
  );
}

// ============================================================================
// STYLES
// ============================================================================
const makeStyles = (C) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },

  // ── Header ──
  header: {
    paddingTop: Platform.OS === 'ios' ? 54 : 20,
    paddingHorizontal: 18,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: C.borderLight,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  headerTitleGroup: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerIconWrap: { borderRadius: 14, overflow: 'hidden' },
  headerIconGradient: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 22, fontWeight: '800', color: C.textPrimary, letterSpacing: -0.4 },
  headerSubtitle: { fontSize: 12, color: C.textSecondary, marginTop: 1 },
  newDot: { marginLeft: 4 },
  newDotInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.dangerMain },
  headerActions: { flexDirection: 'row', gap: 8 },
  headerBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: C.surfaceSecondary,
    borderWidth: 1, borderColor: C.borderMedium,
    alignItems: 'center', justifyContent: 'center',
  },

  // Stats row
  statsRow: { flexDirection: 'row', gap: 8 },
  statChip: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: C.surfaceSecondary,
    borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10,
    borderWidth: 1, borderColor: C.borderLight,
  },
  statChipDot: { width: 6, height: 6, borderRadius: 3 },
  statChipValue: { fontSize: 15, fontWeight: '800' },
  statChipLabel: { fontSize: 10, color: C.textTertiary, fontWeight: '500' },

  // ── List ──
  listContent: { paddingTop: 8, paddingHorizontal: 14 },

  // ── Section Header ──
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 10, paddingHorizontal: 2, marginBottom: 4,
  },
  sectionHeaderTitle: { fontSize: 12, fontWeight: '700', color: C.textTertiary, letterSpacing: 0.8, textTransform: 'uppercase' },
  sectionHeaderBadge: {
    backgroundColor: C.surfaceTertiary,
    borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2,
  },
  sectionHeaderBadgeText: { fontSize: 10, fontWeight: '700', color: C.textSecondary },
  sectionHeaderLine: { flex: 1, height: 1, backgroundColor: C.borderLight },

  // ── Notification Card ──
  notifCard: {
    backgroundColor: C.surfaceCard,
    borderRadius: 16, marginBottom: 10,
    borderWidth: 1, borderColor: C.borderLight,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 4,
  },
  notifCardUnread: {
    backgroundColor: C.surfacePrimary,
    borderColor: C.borderMedium,
  },
  unreadBar: {
    position: 'absolute', left: 0, top: 0, bottom: 0,
    width: 3, borderRadius: 2,
    zIndex: 2,
  },
  notifInner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 14,
    gap: 12,
    paddingLeft: 17,
  },
  notifIconWrap: {
    width: 44, height: 44, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    marginTop: 2, flexShrink: 0,
  },
  notifBody: { flex: 1 },
  notifMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 },
  notifTag: {
    paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: 6,
  },
  notifTagText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.3 },
  notifTime: { fontSize: 11, color: C.textMuted, fontWeight: '500' },
  notifTitle: { fontSize: 14, fontWeight: '700', color: C.textPrimary, marginBottom: 4, lineHeight: 20 },
  notifTitleRead: { color: C.textSecondary, fontWeight: '600' },
  notifMessage: { fontSize: 12, color: C.textSecondary, lineHeight: 17, marginBottom: 8 },
  notifActionRow: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    alignSelf: 'flex-start',
  },
  notifActionText: { fontSize: 12, fontWeight: '700' },
  unreadDot: {
    width: 8, height: 8, borderRadius: 4,
    marginTop: 6, flexShrink: 0,
  },

  // ── Swipe Delete ──
  swipeDelete: { width: 80, marginLeft: 6, borderRadius: 16, overflow: 'hidden', marginBottom: 10 },
  swipeDeleteGradient: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 },
  swipeDeleteText: { fontSize: 10, fontWeight: '700', color: '#FFF' },

  // ── Empty State ──
  emptyWrap: { alignItems: 'center', paddingVertical: 64, paddingHorizontal: 32 },
  emptyIconBg: {
    width: 88, height: 88, borderRadius: 44,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 20, borderWidth: 1, borderColor: C.borderMedium,
  },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: C.textPrimary, marginBottom: 8, textAlign: 'center' },
  emptySubtitle: { fontSize: 13, color: C.textTertiary, textAlign: 'center', lineHeight: 20, marginBottom: 20 },
  emptyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 18, paddingVertical: 9,
    backgroundColor: C.primarySoft,
    borderRadius: 20, borderWidth: 1, borderColor: `${C.primaryMain}30`,
  },
  emptyBtnText: { fontSize: 13, fontWeight: '700', color: C.primaryMain },

});
