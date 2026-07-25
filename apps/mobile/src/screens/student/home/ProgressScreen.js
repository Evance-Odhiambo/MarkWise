import React, {
  useCallback,
  useMemo,
  useState,
  useEffect,
  useRef,
  memo,
} from 'react';
import {
  ActivityIndicator,
  InteractionManager,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Animated,
  Modal,
  Vibration,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Ionicons';
import { useEnrollment } from '../../../context/EnrollmentContext';
import OfflineBanner from '../../../components/OfflineBanner';
import useInternetStatus from '../../../hooks/useInternetStatus';
import useSyncOnReconnect from '../../../hooks/useSyncOnReconnect';
import sqliteStorage from '../../../storage/sqliteStorage';

import {
  fetchStudentAttendanceSummary,
  syncPendingAttendance,
  fetchConductedSessionCounts,
  getCachedAttendanceSummary,
  getCachedConductedCounts,
} from '../../../utils/offlineAttendanceApi';
import { normalizeUnitCode } from '../../../utils/constants';
import { useColors } from '../../../theme';

const _progressCache = {
  records: null,
  conductedCounts: null,
  backendSummary: null,
  goalsByCode: null,
  attendanceHistory: null,
  timestamp: 0,
};
const STALE_MS = 5 * 60 * 1000;

const TARGET_ATTENDANCE_PERCENT = 75;
const toTitleCase = str =>
  str.toLowerCase().replace(/\b\w/g, char => char.toUpperCase());

const parseUnit = unitValue => {
  if (typeof unitValue !== 'string') return { name: '', code: '' };
  const trimmed = unitValue.trim();
  if (!trimmed) return { name: '', code: '' };
  const match = trimmed.match(/\(([^)]+)\)\s*$/);
  if (!match || !match[1])
    return { name: toTitleCase(trimmed), code: trimmed.toUpperCase() };
  return {
    name: toTitleCase(trimmed.slice(0, match.index).trim()),
    code: match[1].trim().toUpperCase(),
  };
};

const normalizeComparableUnitCode = normalizeUnitCode;

// ── Memoized Child Components ──────────────────────────────────────────────

// Progress Ring Component (Memoized) - Now receives styles as prop
const ProgressRing = memo(
  ({ percent, size = 60, strokeWidth = 6, color = '#4F46E5', styles }) => {
    const animatedValue = useRef(new Animated.Value(0)).current;

    useEffect(() => {
      Animated.spring(animatedValue, {
        toValue: percent / 100,
        friction: 8,
        useNativeDriver: true,
      }).start();
      return () => animatedValue.stopAnimation();
    }, [percent]);

    return (
      <View style={{ width: size, height: size }}>
        <View
          style={[
            styles.progressRingBackground,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              borderWidth: strokeWidth,
              borderColor: `${color}20`,
            },
          ]}
        />
        <Animated.View
          style={[
            styles.progressRingFill,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              borderWidth: strokeWidth,
              borderColor: color,
              borderTopColor: color,
              borderRightColor: color,
              transform: [
                {
                  rotate: animatedValue.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['-90deg', '270deg'],
                  }),
                },
              ],
            },
          ]}
        />
        <View style={styles.progressRingInner}>
          <Text style={[styles.progressRingText, { color }]}>{percent}%</Text>
        </View>
      </View>
    );
  },
);

// Stat Card Component (Memoized) - Now receives styles as prop
const StatCard = memo(
  ({ title, value, subtitle, icon, color = '#4F46E5', trend, styles }) => (
    <LinearGradient
      colors={[`${color}15`, 'transparent']}
      style={[styles.statCard, { borderColor: color }]}
    >
      <View style={styles.statCardHeader}>
        <Icon name={icon} size={20} color={color} />
        <Text style={[styles.statCardTitle, { color }]}>{title}</Text>
      </View>
      <Text style={[styles.statCardValue, { color }]}>{value}</Text>
      {subtitle && <Text style={styles.statCardSubtitle}>{subtitle}</Text>}
      {trend !== undefined && (
        <View
          style={[
            styles.trendBadge,
            { backgroundColor: `${trend > 0 ? '#10B981' : '#EF4444'}20` },
          ]}
        >
          <Icon
            name={trend > 0 ? 'arrow-up' : 'arrow-down'}
            size={12}
            color={trend > 0 ? '#10B981' : '#EF4444'}
          />
          <Text
            style={[
              styles.trendText,
              { color: trend > 0 ? '#10B981' : '#EF4444' },
            ]}
          >
            {' '}
            {Math.abs(trend)}%
          </Text>
        </View>
      )}
    </LinearGradient>
  ),
);

// Filter Chip Component (Memoized) - Now receives styles as prop
const FilterChip = memo(
  ({ label, active, onPress, color = '#4F46E5', styles }) => (
    <TouchableOpacity
      style={[
        styles.filterChip,
        active && { backgroundColor: color, borderColor: color },
      ]}
      onPress={onPress}
    >
      <Text
        style={[styles.filterChipText, active && styles.filterChipTextActive]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  ),
);

// Insight Card Component (Memoized) - Now receives styles as prop
const InsightCard = memo(
  ({ icon, title, description, color = '#3B82F6', action, styles }) => (
    <LinearGradient
      colors={[`${color}10`, 'transparent']}
      style={[styles.insightCard, { borderColor: color }]}
    >
      <View style={styles.insightCardHeader}>
        <View
          style={[
            styles.insightIconContainer,
            { backgroundColor: `${color}20` },
          ]}
        >
          <Icon name={icon} size={20} color={color} />
        </View>
        <View style={styles.insightContent}>
          <Text style={[styles.insightTitle, { color }]}>{title}</Text>
          <Text style={styles.insightDescription}>{description}</Text>
        </View>
      </View>
      {action && (
        <TouchableOpacity style={styles.insightAction} onPress={action.onPress}>
          <Text style={[styles.insightActionText, { color }]}>
            {action.label}
          </Text>
          <Icon name="arrow-forward" size={14} color={color} />
        </TouchableOpacity>
      )}
    </LinearGradient>
  ),
);

// Unit Card Component (Memoized) - Now receives styles as prop
const UnitCard = memo(
  ({
    unit,
    onPress,
    onReminderToggle,
    onHistory,
    onSettings,
    getProgressColor,
    generateImprovementPlan,
    styles,
  }) => {
    const scaleAnim = useRef(new Animated.Value(0.95)).current;
    const opacityAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
      Animated.parallel([
        Animated.spring(scaleAnim, {
          toValue: 1,
          friction: 8,
          tension: 40,
          useNativeDriver: true,
        }),
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
    }, []);

    return (
      <Animated.View
        style={[
          styles.unitCard,
          { transform: [{ scale: scaleAnim }], opacity: opacityAnim },
        ]}
      >
        <TouchableOpacity onPress={() => onPress(unit)} activeOpacity={0.7}>
          <LinearGradient
            colors={['rgba(99,102,241,0.03)', 'transparent']}
            style={styles.unitGradient}
          >
            <View style={styles.unitHeader}>
              <View style={styles.unitHeaderLeft}>
                <View
                  style={[
                    styles.unitBadge,
                    {
                      backgroundColor: getProgressColor(
                        unit.percentage,
                        unit.targetPercent,
                      ),
                    },
                  ]}
                >
                  <Text style={styles.unitBadgeText}>{unit.code}</Text>
                </View>
                {unit.trend !== 0 && (
                  <View
                    style={[
                      styles.trendChip,
                      {
                        backgroundColor:
                          unit.trend > 0 ? '#10B98120' : '#EF444420',
                      },
                    ]}
                  >
                    <Icon
                      name={unit.trend > 0 ? 'arrow-up' : 'arrow-down'}
                      size={12}
                      color={unit.trend > 0 ? '#10B981' : '#EF4444'}
                    />
                    <Text
                      style={[
                        styles.trendChipText,
                        { color: unit.trend > 0 ? '#10B981' : '#EF4444' },
                      ]}
                    >
                      {Math.abs(unit.trend)}
                    </Text>
                  </View>
                )}
              </View>
              <Text
                style={[
                  styles.unitPercent,
                  {
                    color: getProgressColor(
                      unit.percentage,
                      unit.targetPercent,
                    ),
                  },
                ]}
              >
                {unit.percentage}%
              </Text>
            </View>

            {unit.name && unit.name !== unit.code && (
              <Text style={styles.unitName} numberOfLines={2}>
                {unit.name}
              </Text>
            )}

            <View style={styles.unitStats}>
              <View style={styles.unitStat}>
                <Icon name="checkmark-circle" size={14} color="#10B981" />
                <Text style={styles.unitStatText}>
                  Attended: {unit.attendedCount}
                </Text>
              </View>
              <View style={styles.unitStat}>
                <Icon name="close-circle" size={14} color="#EF4444" />
                <Text style={styles.unitStatText}>
                  Missed: {unit.missedCount}
                </Text>
              </View>
            </View>

            {!unit.isOnTarget &&
              unit.conductedCount > 0 &&
              unit.catchUpCount > 0 && (
                <View style={styles.catchUpBanner}>
                  <Icon name="trending-up" size={13} color="#D97706" />
                  <Text style={styles.catchUpText}>
                    Attend next{' '}
                    <Text style={styles.catchUpHighlight}>
                      {unit.catchUpCount} session
                      {unit.catchUpCount !== 1 ? 's' : ''}
                    </Text>{' '}
                    in a row to reach {unit.targetPercent}%
                  </Text>
                </View>
              )}

            <View style={styles.progressTrack}>
              <LinearGradient
                colors={[
                  getProgressColor(unit.percentage, unit.targetPercent),
                  `${getProgressColor(unit.percentage, unit.targetPercent)}CC`,
                ]}
                style={[styles.progressFill, { width: `${unit.percentage}%` }]}
              />
              <View
                style={[
                  styles.targetMarker,
                  { left: `${unit.targetPercent}%` },
                ]}
              >
                <View
                  style={[styles.targetDot, { backgroundColor: '#F59E0B' }]}
                />
              </View>
            </View>

            <View style={styles.unitFooter}>
              <View style={styles.goalInfo}>
                <Text style={styles.goalLabel}>Target:</Text>
                <Text
                  style={[
                    styles.goalValue,
                    {
                      color: getProgressColor(
                        unit.percentage,
                        unit.targetPercent,
                      ),
                    },
                  ]}
                >
                  {unit.targetPercent}%
                </Text>
              </View>
              <View style={styles.unitActions}>
                <TouchableOpacity
                  style={styles.unitAction}
                  onPress={() => onReminderToggle(unit)}
                >
                  <Icon
                    name={
                      unit.reminderEnabled
                        ? 'notifications'
                        : 'notifications-off-outline'
                    }
                    size={18}
                    color={unit.reminderEnabled ? '#10B981' : '#9CA3AF'}
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.unitAction}
                  onPress={() => onHistory(unit)}
                >
                  <Icon name="time-outline" size={18} color="#3B82F6" />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.unitAction}
                  onPress={() => onSettings(unit)}
                >
                  <Icon name="settings-outline" size={18} color="#4F46E5" />
                </TouchableOpacity>
              </View>
            </View>
          </LinearGradient>
        </TouchableOpacity>
      </Animated.View>
    );
  },
);

// ── Main Component ─────────────────────────────────────────────────────────
export default function ProgressScreen() {
  const colors = useColors();
  const C = useMemo(
    () => ({
      bg: colors.background.primary,
      bgSec: colors.background.secondary,
      surface: colors.surface.primary,
      border: colors.border.light,
      primary: colors.primary.main,
      primaryD: colors.primary.dark,
      success: colors.success.main,
      warning: colors.warning.main,
      danger: colors.danger.main,
      info: colors.info.main,
      text: colors.text.primary,
      textSec: colors.text.secondary,
      textTer: colors.text.muted,
    }),
    [colors],
  );

  // Create styles using the color object
  const styles = useMemo(() => makeStyles(C), [C]);

  const { enrolledUnits, unitNamesMap } = useEnrollment();
  const { isOnline } = useInternetStatus();

  // State Management
  const [records, setRecords] = useState(() => _progressCache.records ?? []);
  const [conductedCounts, setConductedCounts] = useState(
    () => _progressCache.conductedCounts ?? {},
  );
  const [backendSummary, setBackendSummary] = useState(
    () => _progressCache.backendSummary ?? null,
  );
  const [goalsByCode, setGoalsByCode] = useState(
    () => _progressCache.goalsByCode ?? {},
  );
  const [goalDraftByCode, setGoalDraftByCode] = useState({});
  const [isLoading, setIsLoading] = useState(() => !_progressCache.records);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isBackgroundUpdate, setIsBackgroundUpdate] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const [selectedFilter, setSelectedFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [selectedUnitForGoal, setSelectedUnitForGoal] = useState(null);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [selectedUnitHistory, setSelectedUnitHistory] = useState(null);
  const [attendanceHistory, setAttendanceHistory] = useState(
    () => _progressCache.attendanceHistory ?? {},
  );

  // Refs for tracking load state
  const hasLoadedRef = useRef(false);
  const isMountedRef = useRef(true);
  const scrollY = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(50)).current;

  // Entrance animation
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: 0,
        friction: 8,
        tension: 40,
        useNativeDriver: true,
      }),
    ]).start();
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Load Attendance Data
  const loadAttendance = useCallback(
    async (showSpinner = false, isBackground = false) => {
      if (isBackground) {
        setIsBackgroundUpdate(true);
      } else if (showSpinner) {
        setIsRefreshing(true);
      } else if (!_progressCache.records) {
        setIsLoading(true);
      }

      const parsedCodes = (enrolledUnits || [])
        .map(unit => normalizeComparableUnitCode(parseUnit(unit).code))
        .filter(Boolean);

      try {
        if (!hasLoadedRef.current) {
          syncPendingAttendance().catch(() => {});
          sqliteStorage.clearSyntheticConductedSessions().catch(() => {});
          await sqliteStorage.backfillConductedSessionsFromAttendance();

          const [
            attendanceRecords,
            conducted,
            goals,
            cachedSummary,
            cachedRemoteConducted,
          ] = await Promise.all([
            sqliteStorage.getAttendanceLightRecords(2000),
            sqliteStorage.getConductedSessionCounts(parsedCodes),
            sqliteStorage.getUnitAttendanceGoals(parsedCodes),
            getCachedAttendanceSummary(),
            getCachedConductedCounts(),
          ]);

          const mergedConducted = { ...(conducted || {}) };
          for (const [code, remoteCount] of Object.entries(
            cachedRemoteConducted || {},
          )) {
            const normCode = String(code)
              .toUpperCase()
              .replace(/[^A-Z0-9]/g, '');
            if (
              (Number(remoteCount) || 0) >
              (Number(mergedConducted[normCode]) || 0)
            ) {
              mergedConducted[normCode] = Number(remoteCount);
            }
          }

          const finalRecords = Array.isArray(attendanceRecords)
            ? attendanceRecords
            : [];
          const finalGoals = goals && typeof goals === 'object' ? goals : {};
          const finalSummary = cachedSummary ?? null;
          const history = {};
          finalRecords.forEach(record => {
            const code = normalizeComparableUnitCode(record?.unitCode);
            if (!code) return;
            if (!history[code]) history[code] = [];
            history[code].push({
              date: record.scannedAt,
              sessionStart: record.sessionStart,
            });
          });

          if (isMountedRef.current) {
            setRecords(finalRecords);
            setConductedCounts(mergedConducted);
            setGoalsByCode(finalGoals);
            setBackendSummary(finalSummary);
            setAttendanceHistory(history);
          }

          _progressCache.records = finalRecords;
          _progressCache.conductedCounts = mergedConducted;
          _progressCache.backendSummary = finalSummary;
          _progressCache.goalsByCode = finalGoals;
          _progressCache.attendanceHistory = history;
          _progressCache.timestamp = Date.now();
          setLastRefreshed(new Date());
          hasLoadedRef.current = true;
        }

        if (isOnline) {
          const [summary, remoteConducted] = await Promise.all([
            fetchStudentAttendanceSummary().catch(() => null),
            fetchConductedSessionCounts(parsedCodes).catch(() => ({})),
          ]);

          const conductedUpdated =
            await sqliteStorage.getConductedSessionCounts(parsedCodes);
          const mergedConducted = { ...(conductedUpdated || {}) };
          for (const [code, remoteCount] of Object.entries(
            remoteConducted || {},
          )) {
            const normCode = String(code)
              .toUpperCase()
              .replace(/[^A-Z0-9]/g, '');
            if (
              (Number(remoteCount) || 0) >
              (Number(mergedConducted[normCode]) || 0)
            ) {
              mergedConducted[normCode] = Number(remoteCount);
            }
          }
          if (isMountedRef.current) {
            setConductedCounts(mergedConducted);
            if (summary) setBackendSummary(summary);
          }
          _progressCache.conductedCounts = mergedConducted;
          if (summary) _progressCache.backendSummary = summary;
          _progressCache.timestamp = Date.now();
          setLastRefreshed(new Date());
        }
      } catch (error) {
        console.error('Failed to load attendance records', error);
        if (_progressCache.records) return;
      } finally {
        if (isMountedRef.current) {
          if (isBackground) setIsBackgroundUpdate(false);
          else if (showSpinner) setIsRefreshing(false);
          else setIsLoading(false);
        }
      }
    },
    [enrolledUnits, isOnline],
  );

  useSyncOnReconnect(
    useCallback(() => {
      loadAttendance(true);
    }, [loadAttendance]),
  );

  useFocusEffect(
    useCallback(() => {
      let task;
      const age = Date.now() - _progressCache.timestamp;
      if (!_progressCache.records || age > STALE_MS) {
        loadAttendance(false, false);
      } else {
        task = InteractionManager.runAfterInteractions(() =>
          loadAttendance(false, true),
        );
      }
      return () => task?.cancel();
    }, [loadAttendance]),
  );

  // Update Goal Handler
  const updateGoal = useCallback(
    async (unitCode, updater) => {
      const comparableCode = normalizeComparableUnitCode(unitCode);
      const existing = goalsByCode[unitCode] ||
        goalsByCode[comparableCode] || {
          unitCode,
          targetPercent: TARGET_ATTENDANCE_PERCENT,
          reminderEnabled: 0,
          reminderDays: '1,3,5',
          reminderTime: '08:00',
        };
      const next = { ...existing, ...updater, unitCode };
      await sqliteStorage.upsertUnitAttendanceGoal(next);
      setGoalsByCode(prev => ({ ...prev, [unitCode]: next }));
      Vibration.vibrate(50);
    },
    [goalsByCode],
  );

  // Memoized Computations
  const allUnitProgress = useMemo(() => {
    const localAttByCode = records.reduce((acc, record) => {
      const code = normalizeComparableUnitCode(record?.unitCode);
      if (!code) return acc;
      const sessionStart = Number(record?.sessionStart);
      if (!Number.isFinite(sessionStart)) return acc;
      if (!acc[code]) acc[code] = new Set();
      acc[code].add(sessionStart);
      return acc;
    }, {});

    const localCondByCode = Object.entries(conductedCounts || {}).reduce(
      (acc, [rawCode, count]) => {
        const code = normalizeComparableUnitCode(rawCode);
        if (!code) return acc;
        acc[code] = (acc[code] || 0) + (Number(count) || 0);
        return acc;
      },
      {},
    );

    const backendByCode = {};
    if (backendSummary?.units && Array.isArray(backendSummary.units)) {
      for (const u of backendSummary.units) {
        const code = normalizeComparableUnitCode(u.unitCode);
        if (!code) continue;
        backendByCode[code] = {
          attended: Number(u.attended || 0),
          conducted: Number(u.conducted || 0),
          name: u.unitName || u.name || '',
        };
      }
    }

    const enrolledParsed = (enrolledUnits || []).map(u => ({
      raw: u,
      parsed: parseUnit(u),
    }));
    const seenNormCodes = new Set();
    const seenMapNames = new Set();
    const allEntries = enrolledParsed
      .map(e => ({
        normCode: normalizeComparableUnitCode(e.parsed.code),
        ...e,
      }))
      .filter(({ normCode, parsed }) => {
        if (!normCode || seenNormCodes.has(normCode)) return false;
        seenNormCodes.add(normCode);
        const mapName = unitNamesMap?.[parsed.code] || unitNamesMap?.[normCode];
        if (mapName) {
          const key = mapName.trim().toLowerCase();
          if (seenMapNames.has(key)) return false;
          seenMapNames.add(key);
        }
        return true;
      });

    return allEntries.map(({ raw, parsed, normCode }) => {
      const localAtt = localAttByCode[normCode]?.size || 0;
      const localCond = localCondByCode[normCode] || 0;
      const backAtt = backendByCode[normCode]?.attended || 0;
      const backCond = backendByCode[normCode]?.conducted || 0;
      const attendedCount = Math.max(localAtt, backAtt);
      const conductedCount = Math.max(localCond, backCond);
      const missedCount = Math.max(0, conductedCount - attendedCount);
      const mapName = unitNamesMap?.[parsed.code] || unitNamesMap?.[normCode];
      const backendName = backendByCode[normCode]?.name || '';
      const parsedNameLooksLikeCode =
        normalizeComparableUnitCode(parsed.name) ===
        normalizeComparableUnitCode(parsed.code);
      const parsedName = !parsedNameLooksLikeCode ? parsed.name : '';
      const resolvedRaw = mapName || backendName || parsedName;
      const name = resolvedRaw
        ? toTitleCase(String(resolvedRaw))
        : parsed.code || normCode;
      const goal = goalsByCode[parsed.code] || goalsByCode[normCode] || null;
      const targetPercent =
        Number(goal?.targetPercent) || TARGET_ATTENDANCE_PERCENT;
      const reminderEnabled = Number(goal?.reminderEnabled) ? 1 : 0;
      const reminderTime = String(goal?.reminderTime || '08:00');
      const rawPercentage =
        conductedCount > 0 ? (attendedCount / conductedCount) * 100 : 0;
      const percentage = Math.max(0, Math.min(100, Math.round(rawPercentage)));
      const isOnTarget = percentage >= targetPercent;
      const trend = attendedCount - (attendanceHistory[normCode]?.length || 0);
      let catchUpCount = 0;
      if (!isOnTarget && conductedCount > 0) {
        if (targetPercent >= 100) catchUpCount = -1;
        else {
          const numerator =
            targetPercent * conductedCount - 100 * attendedCount;
          catchUpCount =
            numerator > 0 ? Math.ceil(numerator / (100 - targetPercent)) : 0;
        }
      }
      return {
        key: raw,
        name,
        code: parsed.code,
        attendedCount,
        conductedCount,
        missedCount,
        targetPercent,
        reminderEnabled,
        reminderTime,
        percentage,
        isOnTarget,
        catchUpCount,
        trend,
        history: attendanceHistory[normCode] || [],
      };
    });
  }, [
    enrolledUnits,
    unitNamesMap,
    records,
    conductedCounts,
    backendSummary,
    goalsByCode,
    attendanceHistory,
  ]);

  const unitProgress = useMemo(() => {
    return allUnitProgress
      .filter(unit => {
        if (selectedFilter === 'all') return true;
        if (selectedFilter === 'onTarget') return unit.isOnTarget;
        if (selectedFilter === 'atRisk')
          return !unit.isOnTarget && unit.conductedCount > 0;
        if (selectedFilter === 'noData') return unit.conductedCount === 0;
        return true;
      })
      .filter(
        unit =>
          !searchQuery ||
          unit.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
          unit.name.toLowerCase().includes(searchQuery.toLowerCase()),
      );
  }, [allUnitProgress, selectedFilter, searchQuery]);

  const totalAttended = useMemo(
    () => allUnitProgress.reduce((sum, item) => sum + item.attendedCount, 0),
    [allUnitProgress],
  );
  const totalConducted = useMemo(
    () => allUnitProgress.reduce((sum, item) => sum + item.conductedCount, 0),
    [allUnitProgress],
  );
  const unitsOnTarget = useMemo(
    () => allUnitProgress.filter(item => item.isOnTarget).length,
    [allUnitProgress],
  );
  const unitsAtRisk = useMemo(
    () =>
      allUnitProgress.filter(u => !u.isOnTarget && u.conductedCount > 0).length,
    [allUnitProgress],
  );
  const unitsNoData = useMemo(
    () => allUnitProgress.filter(u => u.conductedCount === 0).length,
    [allUnitProgress],
  );
  const overallPercentage = useMemo(
    () =>
      totalConducted === 0
        ? 0
        : Math.round((totalAttended / totalConducted) * 100),
    [totalAttended, totalConducted],
  );

  // Helper Functions
  const getProgressColor = useCallback((percent, target) => {
    if (percent >= target) return '#10B981';
    if (percent >= target - 15) return '#F59E0B';
    return '#EF4444';
  }, []);

  const generateImprovementPlan = useCallback(unit => {
    if (unit.conductedCount === 0)
      return 'No sessions conducted yet. Attend all upcoming lectures to build your record.';
    if (unit.isOnTarget)
      return `You're on track at ${unit.percentage}%! Maintain your attendance to stay above your ${unit.targetPercent}% goal.`;
    if (unit.catchUpCount === -1)
      return `You've already missed sessions. A ${unit.targetPercent}% target is no longer achievable this semester — consider lowering your goal.`;
    if (unit.catchUpCount <= 0)
      return `You're on track! Maintain your current attendance.`;
    return `Attend the next ${unit.catchUpCount} session${
      unit.catchUpCount > 1 ? 's' : ''
    } in a row without missing any to reach your ${unit.targetPercent}% goal.`;
  }, []);

  // Handlers
  const handleUnitPress = useCallback(unit => {
    setSelectedUnitForGoal(unit);
    setShowGoalModal(true);
    Vibration.vibrate(20);
  }, []);
  const handleViewHistory = useCallback(unit => {
    setSelectedUnitHistory(unit);
    setShowHistoryModal(true);
    Vibration.vibrate(20);
  }, []);
  const handleReminderToggle = useCallback(
    unit =>
      updateGoal(unit.code, { reminderEnabled: unit.reminderEnabled ? 0 : 1 }),
    [updateGoal],
  );
  const handleCloseModal = useCallback(() => setShowGoalModal(false), []);
  const handleCloseHistory = useCallback(() => setShowHistoryModal(false), []);
  const navigation = useNavigation();
  const handleSaveGoal = useCallback(() => {
    if (!selectedUnitForGoal) return;
    const draftValue =
      goalDraftByCode[selectedUnitForGoal.code] ??
      String(selectedUnitForGoal.targetPercent);
    const nextPercent = Math.max(
      1,
      Math.min(100, Number(draftValue) || selectedUnitForGoal.targetPercent),
    );
    updateGoal(selectedUnitForGoal.code, { targetPercent: nextPercent });
    setGoalDraftByCode(prev => ({
      ...prev,
      [selectedUnitForGoal.code]: String(nextPercent),
    }));
    handleCloseModal();
  }, [selectedUnitForGoal, goalDraftByCode, updateGoal, handleCloseModal]);

  if (isLoading && !hasLoadedRef.current) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={C.primary} />
        <Text style={styles.loadingText}>Loading progress...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <OfflineBanner />
      <Animated.ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.content}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: true },
        )}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => loadAttendance(true)}
            tintColor={C.primary}
            colors={[C.primary]}
          />
        }
      >
        {/* Header with Progress Ring */}
        <Animated.View
          style={[
            styles.headerCard,
            { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
          ]}
        >
          <LinearGradient
            colors={[C.primary, C.primaryD]}
            style={styles.headerGradient}
          >
            <View style={styles.headerContent}>
              <View style={styles.headerLeft}>
                <View style={styles.headerTitleRow}>
                  <Text style={styles.headerTitle}>Attendance Progress</Text>
                  {isBackgroundUpdate && <View style={styles.headerBgDot} />}
                </View>
                <Text style={styles.headerSubtitle}>
                  {unitProgress.length} enrolled units
                </Text>
                {lastRefreshed && !isBackgroundUpdate && (
                  <Text style={styles.headerRefreshedAt}>
                    Updated{' '}
                    {lastRefreshed.toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </Text>
                )}
              </View>
              <ProgressRing
                percent={overallPercentage}
                size={70}
                strokeWidth={6}
                color="#FFFFFF"
                styles={styles}
              />
            </View>
          </LinearGradient>
        </Animated.View>

        {/* Stats Grid */}
        <Animated.View style={[styles.statsGrid, { opacity: fadeAnim }]}>
          <StatCard
            title="Total Attended"
            value={`${totalAttended}/${totalConducted}`}
            subtitle="sessions"
            icon="calendar"
            color={C.primary}
            trend={overallPercentage - TARGET_ATTENDANCE_PERCENT}
            styles={styles}
          />
          <StatCard
            title="On Target"
            value={unitsOnTarget}
            subtitle={`out of ${unitProgress.length} units`}
            icon="checkmark-circle"
            color={C.success}
            styles={styles}
          />
          <StatCard
            title="At Risk"
            value={unitsAtRisk}
            subtitle="units below target"
            icon="warning"
            color={C.warning}
            styles={styles}
          />
          <StatCard
            title="No Data"
            value={unitsNoData}
            subtitle="units with no sessions"
            icon="alert-circle"
            color={C.info}
            styles={styles}
          />
        </Animated.View>

        {/* Search and Filters */}
        <View style={styles.searchContainer}>
          <View style={styles.searchBox}>
            <Icon name="search" size={18} color={C.textTer} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search units..."
              placeholderTextColor={C.textTer}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            {searchQuery ? (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <Icon name="close-circle" size={18} color={C.textTer} />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterScroll}
        >
          <View style={styles.filterContainer}>
            <FilterChip
              label="All Units"
              active={selectedFilter === 'all'}
              onPress={() => setSelectedFilter('all')}
              color={C.primary}
              styles={styles}
            />
            <FilterChip
              label="On Target"
              active={selectedFilter === 'onTarget'}
              onPress={() => setSelectedFilter('onTarget')}
              color={C.success}
              styles={styles}
            />
            <FilterChip
              label="At Risk"
              active={selectedFilter === 'atRisk'}
              onPress={() => setSelectedFilter('atRisk')}
              color={C.warning}
              styles={styles}
            />
            <FilterChip
              label="No Data"
              active={selectedFilter === 'noData'}
              onPress={() => setSelectedFilter('noData')}
              color={C.info}
              styles={styles}
            />
          </View>
        </ScrollView>

        {/* Unit Cards */}
        {unitProgress.length === 0 ? (
          <View style={styles.emptyCard}>
            <Icon name="school-outline" size={48} color={C.textTer} />
            <Text style={styles.emptyTitle}>No units found</Text>
            <Text style={styles.emptyText}>
              {searchQuery || selectedFilter !== 'all'
                ? 'Try adjusting your filters'
                : 'Enroll units to start tracking attendance progress.'}
            </Text>
          </View>
        ) : (
          unitProgress.map(unit => (
            <UnitCard
              key={unit.key}
              unit={unit}
              onPress={handleUnitPress}
              onReminderToggle={handleReminderToggle}
              onHistory={handleViewHistory}
              onSettings={handleUnitPress}
              getProgressColor={getProgressColor}
              generateImprovementPlan={generateImprovementPlan}
              styles={styles}
            />
          ))
        )}

        {/* AI Insights */}
        <View style={styles.insightsSection}>
          <Text style={styles.insightsTitle}>📊 AI Insights</Text>
          {unitsAtRisk > 0 && (
            <InsightCard
              icon="warning"
              title="At-Risk Units Detected"
              description={`${unitsAtRisk} units below target. Review improvement plans.`}
              color={C.warning}
              action={{
                label: 'View Plans',
                onPress: () => navigation.navigate('Insights'),
              }}
              styles={styles}
            />
          )}
          {unitsNoData > 0 && (
            <InsightCard
              icon="alert-circle"
              title="Units Without Data"
              description={`${unitsNoData} units have no conducted sessions yet.`}
              color={C.info}
              action={{
                label: 'View Units',
                onPress: () => setSelectedFilter('noData'),
              }}
              styles={styles}
            />
          )}
          {overallPercentage >= 90 && (
            <InsightCard
              icon="trophy"
              title="Excellent Performance!"
              description={`You're maintaining ${overallPercentage}% overall attendance. Keep it up!`}
              color={C.success}
              styles={styles}
            />
          )}
        </View>
      </Animated.ScrollView>

      {/* Goal Setting Modal */}
      <Modal
        visible={showGoalModal}
        transparent
        animationType="slide"
        onRequestClose={handleCloseModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <LinearGradient
              colors={[C.primary, C.primaryD]}
              style={styles.modalHeader}
            >
              <Text style={styles.modalHeaderTitle}>Attendance Goal</Text>
              <TouchableOpacity onPress={handleCloseModal}>
                <Icon name="close" size={24} color="#FFFFFF" />
              </TouchableOpacity>
            </LinearGradient>
            {selectedUnitForGoal && (
              <View style={styles.modalBody}>
                <Text style={styles.modalUnitCode}>
                  {selectedUnitForGoal.code}
                </Text>
                {selectedUnitForGoal.name &&
                  selectedUnitForGoal.name !== selectedUnitForGoal.code && (
                    <Text style={styles.modalUnitName}>
                      {selectedUnitForGoal.name}
                    </Text>
                  )}

                <View style={styles.modalSection}>
                  <Text style={styles.modalSectionTitle}>Current Progress</Text>
                  <View style={styles.modalStats}>
                    <View style={styles.modalStat}>
                      <Text style={styles.modalStatLabel}>Attended</Text>
                      <Text
                        style={[styles.modalStatValue, { color: C.success }]}
                      >
                        {selectedUnitForGoal.attendedCount}
                      </Text>
                    </View>
                    <View style={styles.modalStat}>
                      <Text style={styles.modalStatLabel}>Missed</Text>
                      <Text
                        style={[styles.modalStatValue, { color: C.danger }]}
                      >
                        {selectedUnitForGoal.missedCount}
                      </Text>
                    </View>
                    <View style={styles.modalStat}>
                      <Text style={styles.modalStatLabel}>Total</Text>
                      <Text style={styles.modalStatValue}>
                        {selectedUnitForGoal.conductedCount}
                      </Text>
                    </View>
                  </View>
                </View>

                <View style={styles.modalSection}>
                  <Text style={styles.modalSectionTitle}>
                    Set Target Percentage
                  </Text>
                  <View style={styles.goalInputContainer}>
                    <TextInput
                      style={styles.goalModalInput}
                      value={
                        goalDraftByCode[selectedUnitForGoal.code] ??
                        String(selectedUnitForGoal.targetPercent)
                      }
                      onChangeText={value =>
                        setGoalDraftByCode(prev => ({
                          ...prev,
                          [selectedUnitForGoal.code]: String(value)
                            .replace(/[^0-9]/g, '')
                            .slice(0, 3),
                        }))
                      }
                      keyboardType="number-pad"
                      maxLength={3}
                      placeholder="75"
                      placeholderTextColor={C.textTer}
                    />
                    <Text style={styles.goalInputSuffix}>%</Text>
                  </View>
                </View>

                <View style={styles.modalSection}>
                  <Text style={styles.modalSectionTitle}>
                    Reminder Settings
                  </Text>
                  <View style={styles.reminderOptions}>
                    <TouchableOpacity
                      style={[
                        styles.reminderOption,
                        selectedUnitForGoal.reminderEnabled &&
                          styles.reminderOptionActive,
                      ]}
                      onPress={() => handleReminderToggle(selectedUnitForGoal)}
                    >
                      <Icon
                        name={
                          selectedUnitForGoal.reminderEnabled
                            ? 'notifications'
                            : 'notifications-off-outline'
                        }
                        size={20}
                        color={
                          selectedUnitForGoal.reminderEnabled
                            ? C.success
                            : C.textTer
                        }
                      />
                      <Text
                        style={[
                          styles.reminderOptionText,
                          selectedUnitForGoal.reminderEnabled &&
                            styles.reminderOptionTextActive,
                        ]}
                      >
                        {selectedUnitForGoal.reminderEnabled
                          ? 'Reminders On'
                          : 'Reminders Off'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  <View style={styles.timeOptions}>
                    <TouchableOpacity
                      style={[
                        styles.timeOption,
                        selectedUnitForGoal.reminderTime === '08:00' &&
                          styles.timeOptionActive,
                      ]}
                      onPress={() =>
                        updateGoal(selectedUnitForGoal.code, {
                          reminderTime: '08:00',
                        })
                      }
                    >
                      <Text
                        style={[
                          styles.timeOptionText,
                          selectedUnitForGoal.reminderTime === '08:00' &&
                            styles.timeOptionTextActive,
                        ]}
                      >
                        08:00
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.timeOption,
                        selectedUnitForGoal.reminderTime === '18:00' &&
                          styles.timeOptionActive,
                      ]}
                      onPress={() =>
                        updateGoal(selectedUnitForGoal.code, {
                          reminderTime: '18:00',
                        })
                      }
                    >
                      <Text
                        style={[
                          styles.timeOptionText,
                          selectedUnitForGoal.reminderTime === '18:00' &&
                            styles.timeOptionTextActive,
                        ]}
                      >
                        18:00
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={styles.modalSection}>
                  <Text style={styles.modalSectionTitle}>Improvement Plan</Text>
                  <View style={styles.planCard}>
                    <Text style={styles.planText}>
                      {generateImprovementPlan(selectedUnitForGoal)}
                    </Text>
                  </View>
                </View>

                <View style={styles.modalActions}>
                  <TouchableOpacity
                    style={[styles.modalButton, styles.modalButtonCancel]}
                    onPress={handleCloseModal}
                  >
                    <Text style={styles.modalButtonCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalButton, styles.modalButtonSave]}
                    onPress={handleSaveGoal}
                  >
                    <LinearGradient
                      colors={[C.success, C.success]}
                      style={styles.modalButtonGradient}
                    >
                      <Text style={styles.modalButtonSaveText}>
                        Save Changes
                      </Text>
                    </LinearGradient>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* History Modal */}
      <Modal
        visible={showHistoryModal}
        transparent
        animationType="slide"
        onRequestClose={handleCloseHistory}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <LinearGradient
              colors={[C.info, C.info]}
              style={styles.modalHeader}
            >
              <Text style={styles.modalHeaderTitle}>Attendance History</Text>
              <TouchableOpacity onPress={handleCloseHistory}>
                <Icon name="close" size={24} color="#FFFFFF" />
              </TouchableOpacity>
            </LinearGradient>
            {selectedUnitHistory && (
              <View style={styles.modalBody}>
                <Text style={styles.modalUnitCode}>
                  {selectedUnitHistory.code}
                </Text>
                {selectedUnitHistory.name &&
                  selectedUnitHistory.name !== selectedUnitHistory.code && (
                    <Text style={styles.modalUnitName}>
                      {selectedUnitHistory.name}
                    </Text>
                  )}
                <View style={styles.historyStats}>
                  <View style={styles.historyStat}>
                    <Text style={styles.historyStatLabel}>Total Sessions</Text>
                    <Text style={styles.historyStatValue}>
                      {selectedUnitHistory.conductedCount}
                    </Text>
                  </View>
                  <View style={styles.historyStat}>
                    <Text style={styles.historyStatLabel}>Attended</Text>
                    <Text
                      style={[styles.historyStatValue, { color: C.success }]}
                    >
                      {selectedUnitHistory.attendedCount}
                    </Text>
                  </View>
                  <View style={styles.historyStat}>
                    <Text style={styles.historyStatLabel}>Missed</Text>
                    <Text
                      style={[styles.historyStatValue, { color: C.danger }]}
                    >
                      {selectedUnitHistory.missedCount}
                    </Text>
                  </View>
                </View>
                <View style={styles.historyTimeline}>
                  <Text style={styles.timelineTitle}>Recent Activity</Text>
                  {selectedUnitHistory.history
                    .slice(-5)
                    .reverse()
                    .map((item, index) => (
                      <View key={index} style={styles.timelineItem}>
                        <View
                          style={[
                            styles.timelineDot,
                            { backgroundColor: C.success },
                          ]}
                        />
                        <View style={styles.timelineContent}>
                          <Text style={styles.timelineDate}>
                            {new Date(item.date).toLocaleDateString('en-US', {
                              weekday: 'short',
                              month: 'short',
                              day: 'numeric',
                            })}
                          </Text>
                          <Text style={styles.timelineSession}>
                            Session #{index + 1}
                          </Text>
                        </View>
                      </View>
                    ))}
                </View>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = C =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: C.bg },
    content: { padding: 16, paddingBottom: 28 },
    loadingContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: C.bg,
    },
    loadingText: { marginTop: 10, color: C.textSec, fontSize: 14 },

    headerCard: {
      borderRadius: 24,
      overflow: 'hidden',
      marginBottom: 16,
      elevation: 4,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 8,
    },
    headerGradient: { padding: 20 },
    headerContent: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    headerLeft: { flex: 1 },
    headerTitle: {
      fontSize: 22,
      fontWeight: '800',
      color: '#FFFFFF',
      marginBottom: 4,
    },
    headerSubtitle: { fontSize: 13, color: 'rgba(255,255,255,0.9)' },
    headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    headerBgDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: 'rgba(255,255,255,0.7)',
    },
    headerRefreshedAt: {
      fontSize: 11,
      color: 'rgba(255,255,255,0.75)',
      marginTop: 2,
    },

    progressRingBackground: { position: 'absolute', top: 0, left: 0 },
    progressRingFill: { position: 'absolute', top: 0, left: 0 },
    progressRingInner: {
      ...StyleSheet.absoluteFill,
      justifyContent: 'center',
      alignItems: 'center',
    },
    progressRingText: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },

    statsGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 12,
      marginBottom: 16,
    },
    statCard: {
      width: '47%',
      padding: 14,
      borderRadius: 16,
      borderWidth: 1,
      backgroundColor: C.surface,
    },
    statCardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginBottom: 8,
    },
    statCardTitle: { fontSize: 12, fontWeight: '600' },
    statCardValue: { fontSize: 20, fontWeight: '700', marginBottom: 2 },
    statCardSubtitle: { fontSize: 11, color: C.textTer },
    trendBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 8,
      marginTop: 6,
      gap: 2,
    },
    trendText: { fontSize: 9, fontWeight: '600' },

    searchContainer: { marginBottom: 12 },
    searchBox: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: C.surface,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderWidth: 1,
      borderColor: C.border,
    },
    searchInput: {
      flex: 1,
      marginLeft: 8,
      fontSize: 14,
      color: C.text,
      padding: 0,
    },

    filterScroll: { marginBottom: 16 },
    filterContainer: { flexDirection: 'row', gap: 8, paddingVertical: 4 },
    filterChip: {
      paddingHorizontal: 14,
      paddingVertical: 6,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: C.border,
      backgroundColor: C.surface,
    },
    filterChipText: { fontSize: 12, fontWeight: '600', color: C.textSec },
    filterChipTextActive: { color: '#FFFFFF' },

    emptyCard: {
      backgroundColor: C.surface,
      borderRadius: 16,
      padding: 32,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: C.border,
    },
    emptyTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: C.text,
      marginTop: 12,
    },
    emptyText: {
      marginTop: 6,
      fontSize: 13,
      color: C.textTer,
      textAlign: 'center',
    },

    unitCard: {
      backgroundColor: C.surface,
      borderRadius: 16,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: C.border,
      overflow: 'hidden',
    },
    unitGradient: { padding: 16 },
    unitHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 8,
    },
    unitHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    unitBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
    unitBadgeText: { fontSize: 11, fontWeight: '700', color: '#FFFFFF' },
    trendChip: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 8,
      gap: 2,
    },
    trendChipText: { fontSize: 10, fontWeight: '600' },
    unitPercent: { fontSize: 18, fontWeight: '700' },
    unitName: {
      fontSize: 15,
      fontWeight: '600',
      color: C.text,
      marginBottom: 8,
    },
    unitStats: { flexDirection: 'row', gap: 16, marginBottom: 12 },
    unitStat: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    unitStatText: { fontSize: 12, color: C.textSec },

    catchUpBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: '#F59E0B20',
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 6,
      marginBottom: 10,
    },
    catchUpText: { flex: 1, fontSize: 12, color: '#D97706', lineHeight: 17 },
    catchUpHighlight: { fontWeight: '700', color: '#D97706' },

    progressTrack: {
      height: 8,
      backgroundColor: C.border,
      borderRadius: 4,
      marginBottom: 12,
      position: 'relative',
    },
    progressFill: { height: '100%', borderRadius: 4 },
    targetMarker: {
      position: 'absolute',
      top: -4,
      width: 2,
      height: 16,
      alignItems: 'center',
    },
    targetDot: { width: 8, height: 8, borderRadius: 4 },

    unitFooter: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    goalInfo: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    goalLabel: { fontSize: 12, color: C.textTer },
    goalValue: { fontSize: 14, fontWeight: '700' },
    unitActions: { flexDirection: 'row', gap: 12 },
    unitAction: { padding: 4 },

    insightsSection: { marginTop: 8, gap: 8 },
    insightsTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: C.text,
      marginBottom: 8,
    },
    insightCard: {
      padding: 16,
      borderRadius: 12,
      borderWidth: 1,
      marginBottom: 8,
    },
    insightCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    insightIconContainer: {
      width: 40,
      height: 40,
      borderRadius: 20,
      justifyContent: 'center',
      alignItems: 'center',
    },
    insightContent: { flex: 1 },
    insightTitle: { fontSize: 14, fontWeight: '600', marginBottom: 2 },
    insightDescription: { fontSize: 12, color: C.textSec },
    insightAction: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: 4,
      marginTop: 8,
    },
    insightActionText: { fontSize: 12, fontWeight: '600' },

    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'flex-end',
    },
    modalContent: {
      backgroundColor: C.surface,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      maxHeight: '90%',
    },
    modalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: 20,
    },
    modalHeaderTitle: { fontSize: 18, fontWeight: '700', color: '#FFFFFF' },
    modalBody: { padding: 20 },
    modalUnitCode: {
      fontSize: 20,
      fontWeight: '700',
      color: C.primary,
      marginBottom: 4,
    },
    modalUnitName: { fontSize: 14, color: C.textSec, marginBottom: 20 },
    modalSection: { marginBottom: 20 },
    modalSectionTitle: {
      fontSize: 14,
      fontWeight: '600',
      color: C.text,
      marginBottom: 12,
    },
    modalStats: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      backgroundColor: C.bgSec,
      padding: 16,
      borderRadius: 12,
    },
    modalStat: { alignItems: 'center' },
    modalStatLabel: { fontSize: 11, color: C.textTer, marginBottom: 4 },
    modalStatValue: { fontSize: 18, fontWeight: '700' },
    goalInputContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: C.bgSec,
      padding: 12,
      borderRadius: 12,
    },
    goalModalInput: {
      flex: 1,
      fontSize: 16,
      fontWeight: '600',
      color: C.text,
      padding: 0,
    },
    goalInputSuffix: { fontSize: 16, fontWeight: '600', color: C.text },
    reminderOptions: { marginBottom: 12 },
    reminderOption: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      padding: 12,
      backgroundColor: C.bgSec,
      borderRadius: 12,
    },
    reminderOptionActive: { backgroundColor: '#10B98120' },
    reminderOptionText: { fontSize: 14, color: C.textSec },
    reminderOptionTextActive: { color: '#10B981' },
    timeOptions: { flexDirection: 'row', gap: 8 },
    timeOption: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: C.border,
      alignItems: 'center',
    },
    timeOptionActive: { backgroundColor: '#4F46E520', borderColor: C.primary },
    timeOptionText: { fontSize: 13, fontWeight: '600', color: C.textSec },
    timeOptionTextActive: { color: C.primary },
    planCard: { backgroundColor: '#3B82F620', padding: 16, borderRadius: 12 },
    planText: { fontSize: 13, color: C.text, lineHeight: 18 },
    modalActions: { flexDirection: 'row', gap: 12, marginTop: 8 },
    modalButton: { flex: 1, borderRadius: 12, overflow: 'hidden' },
    modalButtonCancel: {
      backgroundColor: C.bgSec,
      justifyContent: 'center',
      alignItems: 'center',
      paddingVertical: 14,
    },
    modalButtonCancelText: {
      fontSize: 14,
      fontWeight: '600',
      color: C.textSec,
    },
    modalButtonSave: { overflow: 'hidden' },
    modalButtonGradient: { paddingVertical: 14, alignItems: 'center' },
    modalButtonSaveText: { fontSize: 14, fontWeight: '600', color: '#FFFFFF' },

    historyStats: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      backgroundColor: C.bgSec,
      padding: 16,
      borderRadius: 12,
      marginBottom: 20,
    },
    historyStat: { alignItems: 'center' },
    historyStatLabel: { fontSize: 11, color: C.textTer, marginBottom: 4 },
    historyStatValue: { fontSize: 16, fontWeight: '700' },
    historyTimeline: { marginTop: 8 },
    timelineTitle: {
      fontSize: 14,
      fontWeight: '600',
      color: C.text,
      marginBottom: 12,
    },
    timelineItem: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      marginBottom: 12,
    },
    timelineDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      marginRight: 12,
      marginTop: 4,
    },
    timelineContent: { flex: 1 },
    timelineDate: {
      fontSize: 13,
      fontWeight: '500',
      color: C.text,
      marginBottom: 2,
    },
    timelineSession: { fontSize: 11, color: C.textTer },
  });
