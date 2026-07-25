import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
  Modal,  
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/Ionicons';
import { useEnrollment } from '../../../context/EnrollmentContext';
import sqliteStorage from '../../../storage/sqliteStorage';
import { fetchStudentAttendanceSummary, syncPendingAttendance, fetchConductedSessionCounts, getCachedAttendanceSummary, getCachedConductedCounts } from '../../../utils/offlineAttendanceApi';
import { useStudentTimetableSync } from '../../../hooks/useStudentTimetableSync';
import useInternetStatus from '../../../hooks/useInternetStatus';
import useSyncOnReconnect from '../../../hooks/useSyncOnReconnect';
import { fetchStudentAchievements, getCachedAchievements } from '../../../utils/achievementsApi';
import { normalizeUnitCode } from '../../../utils/constants';
import { useColors } from '../../../theme';

// Canonical unit code normalizer — imported from constants.js
const normalizeCode = normalizeUnitCode;

// Extract the bare unit code from both "CODE" and "Unit Name (CODE)" formats
const extractUnitCode = (raw) => {
  if (typeof raw !== 'string') return '';
  const m = raw.trim().match(/\(([^)]+)\)\s*$/);
  return m ? normalizeCode(m[1]) : normalizeCode(raw);
};

// Weekly status reset helpers (mirrors MyTimetableScreen logic)
const getLastWeekReset = () => {
  const d = new Date();
  const daysBack = d.getDay() === 6 ? 0 : d.getDay() + 1;
  d.setDate(d.getDate() - daysBack);
  d.setHours(0, 0, 0, 0);
  return d;
};
const WEEKLY_STATUSES = new Set(['Cancelled', 'Rescheduled', 'Online']);
const getEffectiveStatus = (lesson) => {
  const stored = String(lesson?.status || 'Pending').trim() || 'Pending';
  if (!WEEKLY_STATUSES.has(stored)) return stored;
  const updatedAt = lesson?.updatedAt ? new Date(lesson.updatedAt) : null;
  if (!updatedAt || Number.isNaN(updatedAt.getTime())) return 'Pending';
  return updatedAt >= getLastWeekReset() ? stored : 'Pending';
};
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SHORT_DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// Normalise sessionStart to ms — some callers store seconds, others store ms (Date.now())
const toMs = (ts) => (Number(ts) < 1e10 ? Number(ts) * 1000 : Number(ts));

// Main Overview Screen Component
export default function OverviewScreen() {
  const navigation = useNavigation();
  const colors = useColors();
  const C = useMemo(() => ({
    bg:          colors.background.primary,
    bgCard:      colors.background.card,
    surface:     colors.surface.primary,
    surface2:    colors.surface.secondary,
    surfaceTer:  colors.surface.tertiary,
    surfaceLight: colors.surfaceLight,
    border:      colors.border.light,
    borderMed:   colors.border.medium,
    primary:     colors.primary.main,
    primarySoft: colors.primary.soft,
    success:     colors.success.main,
    warning:     colors.warning.main,
    warningDark: colors.warning.dark,
    warningSoft: colors.warning.soft,
    text:        colors.text.primary,
    textSec:     colors.text.secondary,
    textTer:     colors.text.tertiary,
  }), [colors]);
  const styles = useMemo(() => makeStyles(C), [C]);

  // Enhanced Smart Stats Card Component with fixed dimensions
  const TrendIndicator = ({ value, label }) => {
    const isPositive = value > 0;
    const color = isPositive ? colors.success.main : colors.danger.main;
    return (
      <View style={[styles.trendContainer, { backgroundColor: `${color}15` }]}>
        <Icon name={isPositive ? 'arrow-up' : 'arrow-down'} size={12} color={color} />
        <Text style={[styles.trendValue, { color }]}>{Math.abs(value)}%</Text>
        {label && <Text style={styles.trendLabel}>{label}</Text>}
      </View>
    );
  };

  const SmartStatsCard = ({ title, icon, gradient, children, onPress, badge, value, trend }) => (
    <TouchableOpacity style={styles.statsCard} onPress={onPress} activeOpacity={0.7}>
      <LinearGradient colors={gradient || colors.primary.gradient} style={styles.statsCardGradient}>
        <View style={styles.statsCardHeader}>
          <View style={styles.statsCardTitleContainer}>
            <Text style={styles.statsCardIcon}>{icon}</Text>
            <Text style={styles.statsCardTitle}>{title}</Text>
          </View>
          {badge && (
            <View style={[styles.statsCardBadge, { backgroundColor: `${colors.warning.main}20` }]}>
              <Text style={[styles.statsCardBadgeText, { color: colors.warning.main }]}>{badge}</Text>
            </View>
          )}
        </View>
        <View style={styles.statsCardContent}>
          {value && <Text style={styles.statsCardMain}>{value}</Text>}
          {children}
        </View>
        {trend && (
          <View style={styles.statsCardFooter}>
            <TrendIndicator value={trend.value} label={trend.label} />
          </View>
        )}
      </LinearGradient>
    </TouchableOpacity>
  );

  const ProgressBar = ({ progress, height = 6, showLabel = true, target = 75, color }) => {
    const getProgressColor = () => {
      if (color) return color;
      if (progress >= target) return colors.success.main;
      if (progress >= target - 15) return colors.warning.main;
      return colors.danger.main;
    };
    const progressColor = getProgressColor();
    return (
      <View style={styles.progressWrapper}>
        <View style={[styles.progressBarContainer, { height }]}>
          <View style={[styles.progressBarBackground, { backgroundColor: `${progressColor}20` }]}>
            <LinearGradient
              colors={[progressColor, `${progressColor}CC`]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[styles.progressFill, { width: `${Math.min(progress, 100)}%` }]}
            />
          </View>
        </View>
        {showLabel && (
          <Text style={[styles.progressLabel, { color: progressColor }]}>{progress}%</Text>
        )}
      </View>
    );
  };

  const { enrolledUnits, unitNamesMap } = useEnrollment();
  const { isOnline } = useInternetStatus();
  const [expandedSchedule, setExpandedSchedule] = useState(false);
  const [showDayBreakdown, setShowDayBreakdown] = useState(false);
  const [healthExpanded, setHealthExpanded] = useState(false);
  const [attendanceStats, setAttendanceStats] = useState({
    attended: 0, missed: 0, total: 0, percent: 0, target: 75, atRiskUnits: [], allUnits: [],
  });
  const [healthLoading, setHealthLoading] = useState(false);
  const [attendanceRecords, setAttendanceRecords] = useState([]);
  const [quote, setQuote] = useState(null);
  const [rankData, setRankData] = useState(null);
  const healthRingAnim = useRef(new Animated.Value(0)).current;

  // Live timetable from hook
  const { timetableByDay: rawTimetableByDay, isLoading: isTimetableLoading } = useStudentTimetableSync();

  // Animation values
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.95)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 8,
        useNativeDriver: true,
      }),
    ]).start();
    Animated.timing(healthRingAnim, {
      toValue: 1,
      duration: 1200,
      delay: 400,
      useNativeDriver: false,
    }).start();
  }, []);

  // Fetch inspirational quote
  const fetchQuote = React.useCallback(() => {
    let cancelled = false;
    fetch('https://zenquotes.io/api/random')
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(data => {
        if (!cancelled && Array.isArray(data) && data[0] && data[0].q) {
          setQuote({ text: data[0].q, author: data[0].a || 'Unknown' });
        }
      })
      .catch(err => {
        console.warn('[Quote] fetch failed:', err.message);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const cancel = fetchQuote();
    return cancel;
  }, [fetchQuote]);

  const loadAttendanceHealth = useCallback(async () => {
    setHealthLoading(true);

    const enrolledNormCodes = [...new Set(
      (enrolledUnits || []).map(extractUnitCode).filter(Boolean)
    )];

    // Shared helper: compute stats from all sources and update state
    const buildAndSetStats = (localRecords, localConducted, backendSummary, remoteConducted) => {
      const localAttByCode = {};
      for (const rec of localRecords) {
        const code = normalizeCode(rec.unitCode || '');
        if (!code) continue;
        if (!localAttByCode[code]) localAttByCode[code] = new Set();
        localAttByCode[code].add(rec.sessionStart);
      }

      const localCondByCode = {};
      for (const [rawCode, count] of Object.entries(localConducted || {})) {
        const code = normalizeCode(rawCode);
        if (!code) continue;
        localCondByCode[code] = (localCondByCode[code] || 0) + (Number(count) || 0);
      }
      // Merge remote conducted: take max per unit
      for (const [rawCode, count] of Object.entries(remoteConducted || {})) {
        const code = normalizeCode(rawCode);
        if (!code) continue;
        if ((Number(count) || 0) > (localCondByCode[code] || 0)) {
          localCondByCode[code] = Number(count);
        }
      }

      const backendByCode = {};
      if (backendSummary?.units && Array.isArray(backendSummary.units)) {
        for (const u of backendSummary.units) {
          const code = normalizeCode(u.unitCode || '');
          if (!code) continue;
          backendByCode[code] = {
            attended:  Number(u.attended  || 0),
            conducted: Number(u.conducted || 0),
            name:      u.unitName || u.name || '',
          };
        }
      }

      const TARGET = 75;
      let totalAttended = 0;
      let totalConducted = 0;
      const unitBreakdown = [];

      for (const code of enrolledNormCodes) {
        const localAtt  = localAttByCode[code]?.size || 0;
        const localCond = localCondByCode[code] || 0;
        const backAtt   = backendByCode[code]?.attended  || 0;
        const backCond  = backendByCode[code]?.conducted || 0;
        const attended  = Math.max(localAtt,  backAtt);
        const conducted = Math.max(localCond, backCond);
        const pct = conducted > 0 ? Math.round((attended / conducted) * 100) : 0;

        const rawEnrolledCode = (enrolledUnits || [])
          .map(u => { const m = u.trim().match(/\(([^)]+)\)\s*$/); return m ? m[1].replace(/\s+/g, '').toUpperCase() : u.replace(/\s+/g, '').toUpperCase(); })
          .find(c => normalizeCode(c) === code) || code;
        const resolvedName = backendByCode[code]?.name || unitNamesMap[rawEnrolledCode] || unitNamesMap[code] || '';
        const name = resolvedName
          ? resolvedName.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
          : code;

        totalAttended  += attended;
        totalConducted += conducted;
        unitBreakdown.push({ code, name, attended, conducted, percent: pct });
      }

      const overallPct = totalConducted > 0 ? Math.round((totalAttended / totalConducted) * 100) : 0;
      setAttendanceStats({
        attended:    totalAttended,
        missed:      Math.max(totalConducted - totalAttended, 0),
        total:       totalConducted,
        percent:     overallPct,
        target:      TARGET,
        atRiskUnits: unitBreakdown.filter(u => u.percent < TARGET && u.conducted > 0),
        allUnits:    unitBreakdown,
      });
    };

    // ── Phase 1: render immediately from SQLite + cached summary ─────────────
    try {
      syncPendingAttendance().catch(() => {});
      // Remove any synthetic placeholder rows inserted by previous app versions
      sqliteStorage.clearSyntheticConductedSessions().catch(() => {});

      const [localRecords, localConducted, cachedSummary, cachedRemoteConducted] = await Promise.all([
        sqliteStorage.getAttendanceLightRecords(2000),
        sqliteStorage.getConductedSessionCounts(enrolledNormCodes),
        getCachedAttendanceSummary(),
        getCachedConductedCounts(),
      ]);

      // Merge local DB counts with cached remote counts (take max per unit)
      const mergedLocalConducted = { ...(localConducted || {}) };
      for (const [rawCode, remoteCount] of Object.entries(cachedRemoteConducted || {})) {
        const code = normalizeCode(rawCode);
        if (!code) continue;
        if ((Number(remoteCount) || 0) > (Number(mergedLocalConducted[code]) || 0)) {
          mergedLocalConducted[code] = Number(remoteCount);
        }
      }

      buildAndSetStats(localRecords, mergedLocalConducted, cachedSummary, {});
      setAttendanceRecords(localRecords);

      healthRingAnim.setValue(0);
      Animated.timing(healthRingAnim, {
        toValue: 1, duration: 1200, delay: 200, useNativeDriver: false,
      }).start();
    } catch (err) {
      console.warn('[OverviewScreen] loadAttendanceHealth error:', err.message);
    } finally {
      setHealthLoading(false);
    }

    // ── Phase 2: sync from network when online, then re-render ───────────────
    if (!isOnline) return;
    try {
      const [backendSummary, remoteConducted] = await Promise.all([
        fetchStudentAttendanceSummary(),              // auto-caches to SQLite
        fetchConductedSessionCounts(enrolledNormCodes), // auto-caches to SQLite
      ]);

      // Re-read local data (may have been updated by sync above)
      const [localRecordsUpdated, localConductedUpdated] = await Promise.all([
        sqliteStorage.getAttendanceLightRecords(2000),
        sqliteStorage.getConductedSessionCounts(enrolledNormCodes),
      ]);

      buildAndSetStats(localRecordsUpdated, localConductedUpdated, backendSummary, remoteConducted);
      setAttendanceRecords(localRecordsUpdated);
    } catch (err) {
      console.warn('[OverviewScreen] loadAttendanceHealth sync error:', err.message);
    }
  }, [enrolledUnits, unitNamesMap, healthRingAnim, isOnline]);

  useSyncOnReconnect(useCallback(() => { loadAttendanceHealth(); }, [loadAttendanceHealth]));

  useFocusEffect(
    useCallback(() => {
      loadAttendanceHealth();
      // Load rank/points silently: show cached immediately, refresh in background
      getCachedAchievements().then(cached => { if (cached) setRankData(cached); });
      fetchStudentAchievements().then(fresh => { if (fresh) setRankData(fresh); }).catch(() => {});
    }, [loadAttendanceHealth])
  );

  // Today's schedule derived from live timetable + actual attendance records
  const todaySchedule = useMemo(() => {
    const now = new Date();
    const todayName = DAY_NAMES[now.getDay()];
    const todayDay = rawTimetableByDay.find(
      d => d.day.toLowerCase() === todayName.toLowerCase(),
    );
    if (!todayDay) return [];

    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    // Build a set of unit codes the student attended today (any session this calendar day)
    const todayStartMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const todayEndMs = todayStartMs + 24 * 60 * 60 * 1000;
    const attendedTodayCodes = new Set(
      attendanceRecords
        .filter(r => {
          const ms = toMs(r.sessionStart);
          return ms >= todayStartMs && ms < todayEndMs;
        })
        .map(r => normalizeCode(r.unitCode || ''))
        .filter(Boolean),
    );

    return (todayDay.lessons || [])
      .map(lesson => {
        const effectiveStatus = getEffectiveStatus(lesson);
        const rawTime = String(lesson.time || '').split(' - ')[0].trim();
        const [hh, mm] = rawTime.split(':').map(Number);
        const lessonMinutes = Number.isFinite(hh) ? hh * 60 + (Number.isFinite(mm) ? mm : 0) : null;
        const hasPassed = lessonMinutes !== null && lessonMinutes < nowMinutes;
        const attended = attendedTodayCodes.has(normalizeCode(lesson.unitCode || ''));

        let displayStatus;
        if (effectiveStatus === 'Cancelled') {
          displayStatus = 'cancelled';
        } else if (effectiveStatus === 'Online') {
          displayStatus = attended ? 'completed' : (hasPassed ? 'missed' : 'online');
        } else if (attended) {
          displayStatus = 'completed';
        } else if (hasPassed) {
          displayStatus = 'missed';
        } else {
          displayStatus = 'upcoming';
        }

        return {
          id: lesson.id,
          time: rawTime || lesson.time || '',
          course: lesson.unitCode || '',
          name: lesson.unit || '',
          room: lesson.venue || 'TBA',
          instructor: lesson.lecturer || 'Lecturer',
          status: displayStatus,
        };
      })
      .sort((a, b) => a.time.localeCompare(b.time));
  }, [rawTimetableByDay, attendanceRecords]);

  // ENHANCED Weekly progress derived from live timetable + local attendance records
  const weeklyProgress = useMemo(() => {
    const now = new Date();
    const dayOfWeek = now.getDay();
    
    // Calculate week start (Monday)
    const monday = new Date(now);
    monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    monday.setHours(0, 0, 0, 0);
    
    const weekStartMs = monday.getTime();
    const weekEndMs = weekStartMs + 7 * 24 * 60 * 60 * 1000;
    const prevWeekStartMs = weekStartMs - 7 * 24 * 60 * 60 * 1000;

    // Group attendance by day for current and previous week
    const thisWeekAttended = {};
    const prevWeekAttended = {};
    
    for (const rec of attendanceRecords) {
      const ms = toMs(rec.sessionStart);
      if (ms >= weekStartMs && ms < weekEndMs) {
        const idx = new Date(ms).getDay();
        if (!thisWeekAttended[idx]) thisWeekAttended[idx] = new Set();
        thisWeekAttended[idx].add(rec.sessionStart);
      } else if (ms >= prevWeekStartMs && ms < weekStartMs) {
        const idx = new Date(ms).getDay();
        if (!prevWeekAttended[idx]) prevWeekAttended[idx] = new Set();
        prevWeekAttended[idx].add(rec.sessionStart);
      }
    }

    // Process each day (Monday to Friday)
    const days = [1, 2, 3, 4, 5].map(idx => {
      const timetableDay = rawTimetableByDay.find(
        d => d.day.toLowerCase() === DAY_NAMES[idx].toLowerCase()
      );
      
      // Get all lessons from timetable
      const allLessons = timetableDay?.lessons || [];
      
      // Filter out cancelled lessons
      const activeLessons = allLessons.filter(
        l => getEffectiveStatus(l) !== 'Cancelled'
      );
      
      const total = activeLessons.length;
      const attended = total > 0 ? Math.min(thisWeekAttended[idx]?.size || 0, total) : 0;
      
      // Get list of lesson details for this day
      const lessonList = activeLessons.map(lesson => ({
        id: lesson.id,
        code: lesson.unitCode,
        name: lesson.unit,
        time: lesson.time,
        room: lesson.venue,
        attended: thisWeekAttended[idx]?.has(lesson.id) || false,
      }));
      
      return {
        day: SHORT_DAY_NAMES[idx],
        fullDay: DAY_NAMES[idx],
        attended,
        total,
        percent: total > 0 ? Math.round((attended / total) * 100) : 0,
        lessons: lessonList,
        missingCount: total - attended,
      };
    });

    // Only count days that have already occurred — future days inflate the denominator
    // and make the weekly % look far lower than actual performance.
    // days[i] maps to dayOfWeek i+1 (Mon=1 … Fri=5).
    // On Sat(6)/Sun(0) the whole weekday block is in the past, so use all 5 days.
    const todayDow = now.getDay();
    const lastElapsedDow = todayDow === 0 || todayDow === 6 ? 5 : todayDow;
    const totalSessions = days.reduce((sum, d, i) => (i + 1 <= lastElapsedDow ? sum + d.total : sum), 0);
    const attendedSessions = days.reduce((sum, d, i) => (i + 1 <= lastElapsedDow ? sum + d.attended : sum), 0);
    const missedSessions = totalSessions - attendedSessions;
    const currentPercent = totalSessions > 0 ? Math.round((attendedSessions / totalSessions) * 100) : 0;

    // Previous week: it's fully elapsed so count all 5 days
    let prevTotal = 0;
    let prevAttended = 0;
    for (let idx = 1; idx <= 5; idx++) {
      const timetableDay = rawTimetableByDay.find(
        d => d.day.toLowerCase() === DAY_NAMES[idx].toLowerCase()
      );
      const total = (timetableDay?.lessons || []).filter(
        l => getEffectiveStatus(l) !== 'Cancelled'
      ).length;
      prevTotal += total;
      prevAttended += Math.min(prevWeekAttended[idx]?.size || 0, total);
    }
    const prevPercent = prevTotal > 0 ? Math.round((prevAttended / prevTotal) * 100) : 0;
    const trend = currentPercent - prevPercent;

    // "Needed to reach goal" uses the FULL week's sessions (including future days)
    // so the count reflects sessions remaining to attend, not just elapsed ones.
    const goal = 75;
    const fullWeekTotal = days.reduce((sum, d) => sum + d.total, 0);
    let neededToReachGoal = 0;
    if (currentPercent < goal && fullWeekTotal > 0) {
      const targetAttended = Math.ceil((goal / 100) * fullWeekTotal);
      neededToReachGoal = Math.max(0, targetAttended - attendedSessions);
    }

    // Calculate remaining days in week (Mon-Fri)
    let remainingDays = 0;
    const currentDayIdx = now.getDay();
    if (currentDayIdx >= 1 && currentDayIdx <= 5) {
      remainingDays = 5 - currentDayIdx;
    } else if (currentDayIdx === 0) {
      remainingDays = 5;
    } else if (currentDayIdx === 6) {
      remainingDays = 5;
    }

    return {
      current: currentPercent,
      goal,
      trend,
      days,
      totalSessions,
      attendedSessions,
      missedSessions,
      neededToReachGoal,
      remainingDays,
      weekStart: monday,
      weekEnd: new Date(weekEndMs - 1),
    };
  }, [rawTimetableByDay, attendanceRecords]);

  // Projected semester-end attendance based on recent 2-week trend blended with overall rate
  const projectedAttendance = useMemo(() => {
    const overallPct = attendanceStats.percent;
    const totalConducted = attendanceStats.total;
    if (totalConducted < 5) return overallPct;
    const now = Date.now();
    const twoWeeksAgo = now - 14 * 24 * 60 * 60 * 1000;
    const recentAttended = attendanceRecords.filter(r => toMs(r.sessionStart) >= twoWeeksAgo).length;
    const sessionsPerWeek = rawTimetableByDay.reduce((sum, d) =>
      sum + (d.lessons || []).filter(l => getEffectiveStatus(l) !== 'Cancelled').length, 0);
    const recentConducted = sessionsPerWeek * 2;
    if (recentConducted === 0) return overallPct;
    const recentPct = Math.round((recentAttended / recentConducted) * 100);
    return Math.min(100, Math.max(0, Math.round(overallPct * 0.6 + recentPct * 0.4)));
  }, [attendanceStats, attendanceRecords, rawTimetableByDay]);

  // Points earned today: count attendance records for today × 5 pts per session (proxy)
  const computedPointsToday = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayMs = today.getTime();
    const tomorrowMs = todayMs + 24 * 60 * 60 * 1000;
    return attendanceRecords.filter(r => {
      const ms = toMs(r.sessionStart);
      return ms >= todayMs && ms < tomorrowMs;
    }).length * 5;
  }, [attendanceRecords]);

  // --- Real rank / points / leaderboard data (falls back to neutral defaults) ---
  const myRank = rankData?.rank ?? null;
  const totalStudents = rankData?.totalStudents ?? null;
  const myPoints = rankData?.currentStreak != null
    ? (rankData.points ?? rankData.totalPoints ?? (rankData.currentStreak * 10 + (rankData.attended ?? 0) * 5))
    : (rankData?.points ?? rankData?.totalPoints ?? null);
  const percentile = (myRank && totalStudents && totalStudents > 0)
    ? Math.round((1 - (myRank - 1) / totalStudents) * 100)
    : null;

  const deptRank = {
    current: myRank ?? '—',
    total: totalStudents ?? '—',
    percentile: percentile ?? '—',
    trend: rankData?.rankTrend ?? rankData?.trend ?? 0,
  };

  const pointsBank = {
    total: myPoints ?? '—',
    today: rankData?.pointsToday ?? computedPointsToday,
    expiring: rankData?.pointsExpiring ?? 0,
    expiryDate: rankData?.expiryDate ?? '',
    trend: rankData?.pointsTrend ?? 0,
  };

  // Build leaderboard: merge API top students + inject 'You' row at the right position
  const rawLeaderboard = Array.isArray(rankData?.leaderboard) ? rankData.leaderboard : [];
  const leaderboardData = (() => {
    const top = rawLeaderboard.slice(0, 5).map((p, i) => ({
      id: p.id ?? i + 1,
      rank: p.rank ?? i + 1,
      name: p.name ?? p.displayName ?? `Student ${i + 1}`,
      points: p.points ?? p.totalPoints ?? 0,
      streak: p.streak ?? p.currentStreak ?? 0,
      trend: p.trend ?? 'stable',
      isUser: false,
    }));
    // Pad to 5 entries so the podium never crashes
    while (top.length < 5) {
      top.push({ id: top.length + 1, rank: top.length + 1, name: `—`, points: 0, streak: 0, trend: 'stable', isUser: false });
    }
    const meInTop = top.some(p => p.isUser);
    if (!meInTop) {
      top.push({
        id: 'me',
        rank: myRank ?? '—',
        name: 'You',
        points: typeof myPoints === 'number' ? myPoints : 0,
        streak: rankData?.currentStreak ?? 0,
        trend: 'up',
        isUser: true,
      });
    }
    return top;
  })();

  const getProgressColor = (percent) => {
    if (percent >= 85) return colors.success.main;
    if (percent >= 60) return colors.warning.main;
    return colors.danger.main;
  };

  const handleChallenge = useCallback((opponent) => {
    Alert.alert(
      '⚡ Challenge Sent!',
      `You challenged ${opponent.name} to beat your attendance score! Attend your next session to earn points and close the gap. 🔥`,
      [
        { text: 'Maybe Later', style: 'cancel' },
        { text: "Let's Go! 💪", style: 'default' },
      ]
    );
  }, []);

  const activeToday = todaySchedule.filter(s => s.status !== 'cancelled');
  const completedToday = activeToday.filter(s => s.status === 'completed').length;
  const totalToday = activeToday.length;
  const nextClass = todaySchedule.find(s => s.status === 'upcoming' || s.status === 'online');

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        {/* A. Smart Stats Grid - Perfectly Proportioned Cards */}
        <Animated.View style={[styles.statsGrid, { opacity: fadeAnim }]}>
          {/* Today's Schedule Card */}
          <SmartStatsCard
            title="Today's Schedule"
            icon="📅"
            gradient={colors.primary.gradient}
            onPress={() => setExpandedSchedule(!expandedSchedule)}
            badge={isTimetableLoading ? '…' : `${completedToday}/${totalToday}`}
            value={isTimetableLoading ? '…' : `${completedToday}/${totalToday}`}
          >
            <View style={styles.cardDetails}>
              {nextClass && (
                <View style={styles.cardDetailRow}>
                  <Icon name="time-outline" size={12} color="rgba(255,255,255,0.8)" />
                  <Text style={styles.cardDetailText} numberOfLines={1}>
                    Next: {nextClass.time} {nextClass.course}
                  </Text>
                </View>
              )}
              <View style={styles.cardDetailRow}>
                <Icon name="calendar-outline" size={12} color="rgba(255,255,255,0.8)" />
                <Text style={styles.cardDetailText}>{totalToday} sessions today</Text>
              </View>
            </View>
          </SmartStatsCard>

          {/* ENHANCED Weekly Progress Card */}
          <SmartStatsCard
            title="Weekly Progress"
            icon="📈"
            gradient={colors.primary.gradient}
            onPress={() => setShowDayBreakdown(true)}
            trend={weeklyProgress.trend !== 0 ? { value: weeklyProgress.trend, label: 'vs last week' } : undefined}
          >
            <View style={styles.cardDetails}>
              {/* Progress Bar */}
              <ProgressBar progress={weeklyProgress.current} target={weeklyProgress.goal} />
              
              {/* Session Count Summary */}
              <View style={styles.cardDetailRow}>
                <Icon name="calendar-check" size={12} color="rgba(255,255,255,0.8)" />
                <Text style={styles.cardDetailText}>
                  {weeklyProgress.attendedSessions}/{weeklyProgress.totalSessions} sessions attended
                </Text>
              </View>
              
              {/* Needed to Reach Goal */}
              {weeklyProgress.neededToReachGoal > 0 && (
                <View style={styles.cardDetailRow}>
                  <Icon name="flag" size={12} color={colors.warning.main} />
                  <Text style={[styles.cardDetailText, { color: colors.warning.main }]}>
                    Need {weeklyProgress.neededToReachGoal} more session{weeklyProgress.neededToReachGoal !== 1 ? 's' : ''} to reach {weeklyProgress.goal}%
                  </Text>
                </View>
              )}
              
              {/* Goal Indicator */}
              <View style={styles.cardDetailRow}>
                <Icon name="flag-outline" size={12} color="rgba(255,255,255,0.8)" />
                <Text style={styles.cardDetailText}>Goal: {weeklyProgress.goal}%</Text>
              </View>
            </View>
          </SmartStatsCard>

          {/* Department Rank Card */}
          <SmartStatsCard
            title="Dept. Rank"
            icon="🏆"
            gradient={colors.primary.gradient}
            value={myRank != null ? `#${myRank}` : '—'}
          >
            <View style={styles.cardDetails}>
              <View style={styles.cardDetailRow}>
                <Icon name="people-outline" size={12} color="rgba(255,255,255,0.8)" />
                <Text style={styles.cardDetailText}>
                  {percentile != null ? `Top ${percentile}%` : totalStudents != null ? `of ${totalStudents}` : 'Loading…'}
                </Text>
              </View>
              <View style={styles.cardDetailRow}>
                {deptRank.trend > 0 ? (
                  <><Icon name="trending-up" size={12} color={colors.success.main} />
                  <Text style={[styles.cardDetailText, { color: colors.success.main }]}>+{deptRank.trend} spots</Text></>
                ) : deptRank.trend < 0 ? (
                  <><Icon name="trending-down" size={12} color={colors.danger.main} />
                  <Text style={[styles.cardDetailText, { color: colors.danger.main }]}>{deptRank.trend} spots</Text></>
                ) : (
                  <><Icon name="remove-outline" size={12} color="rgba(255,255,255,0.6)" />
                  <Text style={styles.cardDetailText}>No change</Text></>
                )}
              </View>
            </View>
          </SmartStatsCard>

          {/* Points Bank Card */}
          <SmartStatsCard
            title="Points Bank"
            icon="⚡"
            gradient={colors.primary.gradient}
            value={typeof pointsBank.total === 'number' ? `${pointsBank.total}` : '—'}
          >
            <View style={styles.cardDetails}>
              <View style={styles.cardDetailRow}>
                <Icon name="flash-outline" size={12} color="rgba(255,255,255,0.8)" />
                <Text style={styles.cardDetailText}>
                  {pointsBank.today > 0 ? `+${pointsBank.today} today` : 'No points today'}
                </Text>
              </View>
              <View style={styles.cardDetailRow}>
                {pointsBank.expiring > 0 ? (
                  <><Icon name="warning-outline" size={12} color={colors.danger.main} />
                  <Text style={[styles.cardDetailText, { color: colors.danger.main }]}>{pointsBank.expiring} expiring</Text></>
                ) : (
                  <><Icon name="checkmark-circle-outline" size={12} color={colors.success.main} />
                  <Text style={[styles.cardDetailText, { color: colors.success.main }]}>All points safe</Text></>
                )}
              </View>
            </View>
          </SmartStatsCard>
        </Animated.View>

        {/* Expanded Schedule (if expanded) */}
        {expandedSchedule && (
          <Animated.View style={[styles.expandedScheduleContainer, { opacity: fadeAnim }]}>
            <LinearGradient colors={['rgba(99, 102, 241, 0.1)', 'transparent']} style={styles.expandedScheduleGradient}>
              <Text style={styles.expandedScheduleTitle}>Today's Schedule</Text>
              {todaySchedule.map(session => (
                <View key={session.id} style={styles.expandedScheduleItem}>
                  <View style={styles.expandedScheduleTime}>
                    <Text style={styles.expandedScheduleTimeText}>{session.time}</Text>
                    <View style={[
                      styles.expandedScheduleStatus,
                      { backgroundColor: session.status === 'completed' ? colors.success.soft :
                                       session.status === 'missed'    ? colors.danger.soft :
                                       session.status === 'cancelled' ? colors.danger.soft :
                                       colors.warning.soft }
                    ]}>
                      <Text style={[
                        styles.expandedScheduleStatusText,
                        { color: session.status === 'completed' ? colors.success.main :
                                 session.status === 'missed'    ? colors.danger.main :
                                 session.status === 'cancelled' ? colors.danger.main :
                                 colors.warning.main }
                      ]}>
                        {session.status === 'completed' ? '✓' :
                         session.status === 'missed'    ? '✗' :
                         session.status === 'cancelled' ? '—' : '⏳'}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.expandedScheduleInfo}>
                    <Text style={styles.expandedScheduleCourse}>{session.course} - {session.name}</Text>
                    <Text style={styles.expandedScheduleMeta}>
                      {session.room} • {session.instructor}
                    </Text>
                  </View>
                  {session.status === 'upcoming' && (
                    <TouchableOpacity style={styles.expandedScheduleJoin}>
                      <Text style={styles.expandedScheduleJoinText}>Join</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </LinearGradient>
          </Animated.View>
        )}

        {/* B. Quick Actions Card */}
        <Animated.View style={[styles.quickActionsSection, { opacity: fadeAnim, transform: [{ scale: scaleAnim }] }]}>
          <View style={styles.quickActionsHeader}>
            <Icon name="flash" size={18} color={colors.primary.main} />
            <Text style={styles.quickActionsTitle}>Quick Actions</Text>
          </View>
          <View style={styles.quickActionsGrid}>
            <TouchableOpacity style={styles.quickActionBtn} onPress={() => navigation.navigate('StudentAttendanceSessions')}>
              <LinearGradient colors={colors.success.gradient} style={styles.quickActionGradient}>
                <View style={styles.compositeIcon}>
                  <Icon name="qr-code" size={20} color="#FFFFFF" />
                  <Icon name="bluetooth" size={10} color="#FFFFFF" style={styles.compositeBadgeRight} />
                  <View style={styles.compositeBadgeTop}>
                    <Text style={styles.compositeBadgeText}>PIN</Text>
                  </View>
                </View>
              </LinearGradient>
              <Text style={styles.quickActionLabel}>Mark{"\n"}Attendance</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.quickActionBtn} onPress={() => navigation.navigate('Timetable')}>
              <LinearGradient colors={colors.primary.gradient} style={styles.quickActionGradient}>
                <Icon name="calendar-outline" size={22} color="#FFFFFF" />
              </LinearGradient>
              <Text style={styles.quickActionLabel}>View{"\n"}Timetable</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.quickActionBtn} onPress={() => navigation.navigate('CourseCenter')}>
              <LinearGradient colors={colors.secondary.gradient} style={styles.quickActionGradient}>
                <Icon name="book-outline" size={22} color="#FFFFFF" />
              </LinearGradient>
              <Text style={styles.quickActionLabel}>Course{"\n"}Center</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.quickActionBtn} onPress={() => navigation.navigate('Alerts')}>
              <LinearGradient colors={colors.info.gradient} style={styles.quickActionGradient}>
                <Icon name="notifications-outline" size={22} color="#FFFFFF" />
              </LinearGradient>
              <Text style={styles.quickActionLabel}>View{"\n"}Alerts</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>

        {/* C. Attendance Health Dashboard */}
        <Animated.View style={[styles.healthSection, { opacity: fadeAnim }]}>
          {/* Header row */}
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => setHealthExpanded(prev => !prev)}
            style={styles.healthHeader}
          >
            <View style={styles.healthHeaderLeft}>
              <View style={styles.healthIconWrap}>
                <Icon name="pulse" size={18} color="#FFFFFF" />
              </View>
              <View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={styles.healthTitle}>Attendance Health</Text>
                  {healthLoading && <ActivityIndicator size="small" color={colors.primary.light} />}
                </View>
                <Text style={styles.healthSubtitle}>
                  {attendanceStats.percent >= attendanceStats.target ? 'On track' : 'Needs attention'} · Target {attendanceStats.target}%
                </Text>
              </View>
            </View>
            <Icon name={healthExpanded ? 'chevron-up' : 'chevron-down'} size={20} color={colors.text.tertiary} />
          </TouchableOpacity>

          {/* Ring + Summary Row */}
          <View style={styles.healthRingRow}>
            {/* Circular progress ring */}
            <View style={styles.healthRingContainer}>
              <View style={styles.healthRingBg}>
                <Animated.View
                  style={[
                    styles.healthRingFill,
                    {
                      transform: [{
                        rotate: healthRingAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: ['0deg', `${Math.min(attendanceStats.percent / 100, 1) * 360}deg`],
                        }),
                      }],
                    },
                  ]}
                />
              </View>
              <View style={styles.healthRingCenter}>
                <Text style={styles.healthRingPercent}>{attendanceStats.percent}</Text>
                <Text style={styles.healthRingPercentSign}>%</Text>
              </View>
              {/* Status badge under ring */}
              <View style={[
                styles.healthEligibilityBadge,
                { backgroundColor: attendanceStats.percent >= attendanceStats.target ? colors.success.soft : colors.danger.soft },
              ]}>
                <Icon
                  name={attendanceStats.percent >= attendanceStats.target ? 'checkmark-circle' : 'alert-circle'}
                  size={12}
                  color={attendanceStats.percent >= attendanceStats.target ? colors.success.main : colors.danger.main}
                />
                <Text style={[
                  styles.healthEligibilityText,
                  { color: attendanceStats.percent >= attendanceStats.target ? colors.success.main : colors.danger.main },
                ]}>
                  {attendanceStats.percent >= attendanceStats.target ? 'Eligible' : 'At Risk'}
                </Text>
              </View>
            </View>

            {/* Stat tiles */}
            <View style={styles.healthStatTiles}>
              <View style={[styles.healthTile, { backgroundColor: colors.success.soft }]}>
                <Icon name="checkmark-done" size={16} color={colors.success.main} />
                <Text style={[styles.healthTileValue, { color: colors.success.main }]}>{attendanceStats.attended}</Text>
                <Text style={styles.healthTileLabel}>Attended</Text>
              </View>
              <View style={[styles.healthTile, { backgroundColor: colors.danger.soft }]}>
                <Icon name="close-circle" size={16} color={colors.danger.main} />
                <Text style={[styles.healthTileValue, { color: colors.danger.main }]}>{attendanceStats.missed}</Text>
                <Text style={styles.healthTileLabel}>Missed</Text>
              </View>
              <View style={[styles.healthTile, { backgroundColor: colors.primary.soft }]}>
                <Icon name="calendar" size={16} color={colors.primary.main} />
                <Text style={[styles.healthTileValue, { color: colors.primary.main }]}>{attendanceStats.total}</Text>
                <Text style={styles.healthTileLabel}>Total</Text>
              </View>
              <View style={[styles.healthTile, { backgroundColor: colors.secondary.soft }]}>
                <Icon name="trending-up" size={16} color={colors.secondary.main} />
                <Text style={[styles.healthTileValue, { color: colors.secondary.main }]}>{projectedAttendance}%</Text>
                <Text style={styles.healthTileLabel}>Projected</Text>
              </View>
            </View>
          </View>

          {/* Projected trajectory bar */}
          <View style={styles.healthTrajectory}>
            <View style={styles.healthTrajectoryHeader}>
              <Text style={styles.healthTrajectoryTitle}>Trajectory</Text>
              <Text style={styles.healthTrajectoryProjected}>Projected {projectedAttendance}%</Text>
            </View>
            <View style={styles.healthTrajectoryTrack}>
              {/* Target marker */}
              <View style={[styles.healthTargetMarker, { left: `${attendanceStats.target}%` }]}>
                <View style={styles.healthTargetLine} />
              </View>
              {/* Current fill */}
              <Animated.View
                style={[
                  styles.healthTrajectoryFill,
                  {
                    width: healthRingAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['0%', `${attendanceStats.percent}%`],
                    }),
                  },
                ]}
              >
                <LinearGradient
                  colors={attendanceStats.percent >= attendanceStats.target ? [colors.success.main, colors.success.light] : [colors.danger.main, colors.danger.light]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.healthTrajectoryFillGradient}
                />
              </Animated.View>
              {/* Projected zone — only shown when projected exceeds current rate */}
              {projectedAttendance > attendanceStats.percent && (
                <View style={[styles.healthProjectedZone, { left: `${attendanceStats.percent}%`, width: `${projectedAttendance - attendanceStats.percent}%` }]} />
              )}
            </View>
            <View style={styles.healthTrajectoryLabels}>
              <Text style={styles.healthTrajectoryLabel}>0%</Text>
              <Text style={[styles.healthTrajectoryLabel, { color: colors.primary.main, fontWeight: '600' }]}>Target {attendanceStats.target}%</Text>
              <Text style={styles.healthTrajectoryLabel}>100%</Text>
            </View>
          </View>

          {/* Expandable at-risk units */}
          {healthExpanded && (
            <View style={styles.healthExpandedSection}>
              {/* At-risk alerts */}
              {attendanceStats.atRiskUnits.length > 0 && (
                <View style={styles.healthRiskBanner}>
                  <View style={styles.healthRiskBannerIcon}>
                    <Icon name="warning" size={16} color={colors.warning.dark} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.healthRiskBannerTitle}>{attendanceStats.atRiskUnits.length} Unit{attendanceStats.atRiskUnits.length > 1 ? 's' : ''} Below Target</Text>
                    <Text style={styles.healthRiskBannerSub}>These need immediate attention</Text>
                  </View>
                </View>
              )}

              {/* Per-unit breakdown — all units, colour-coded */}
              {(attendanceStats.allUnits?.length > 0 ? attendanceStats.allUnits : attendanceStats.atRiskUnits).map((unit) => (
                <View key={unit.code} style={styles.healthUnitRow}>
                  <View style={styles.healthUnitInfo}>
                    <Text style={styles.healthUnitCode}>{unit.code}</Text>
                    <Text style={styles.healthUnitName}>{unit.name}</Text>
                  </View>
                  <View style={styles.healthUnitBarWrap}>
                    <View style={styles.healthUnitBarTrack}>
                      <LinearGradient
                        colors={unit.percent >= attendanceStats.target ? [colors.success.main, colors.success.light] : [colors.danger.main, colors.warning.main]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={[styles.healthUnitBarFill, { width: `${Math.min(unit.percent, 100)}%` }]}
                      />
                      <View style={[styles.healthUnitTargetMark, { left: `${attendanceStats.target}%` }]} />
                    </View>
                  </View>
                  <Text style={[
                    styles.healthUnitPercent,
                    { color: unit.percent >= attendanceStats.target ? colors.success.main : colors.danger.main },
                  ]}>{unit.percent}%</Text>
                </View>
              ))}

              {/* View full report button */}
              <TouchableOpacity style={styles.healthViewReport}>
                <LinearGradient colors={colors.primary.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.healthViewReportGradient}>
                  <Icon name="stats-chart" size={16} color="#FFFFFF" />
                  <Text style={styles.healthViewReportText}>View Full Report</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          )}
        </Animated.View>

        {/* D. Department Leaderboard — Top 5 */}
        <Animated.View style={[styles.leaderboardSection, { opacity: fadeAnim }]}>
          <LinearGradient colors={['#1E0A3C', '#4F46E5']} style={styles.leaderboardHeader}>
            <View style={styles.leaderboardHeaderLeft}>
              <Text style={{ fontSize: 22 }}>🏆</Text>
              <View>
                <Text style={styles.leaderboardHeaderTitle}>Department Leaderboard</Text>
                <Text style={styles.leaderboardHeaderSub}>Top 5 · Attendance Points</Text>
              </View>
            </View>
            <View style={{ padding: 4 }}>
              <Text style={styles.leaderboardHeaderLink}>Full →</Text>
            </View>
          </LinearGradient>

          <View style={styles.leaderboardBody}>
            {/* Podium — top 3 */}
            <View style={styles.podiumRow}>
              {/* Silver #2 */}
              <View style={styles.podiumItem}>
                <Text style={styles.podiumEmoji}>🥈</Text>
                <View style={[styles.podiumBar, styles.podiumSilver]}>
                  <Text style={styles.podiumBarRank}>2</Text>
                </View>
                <Text style={styles.podiumFirstName} numberOfLines={1}>
                  {leaderboardData[1].name.split(' ')[0]}
                </Text>
                <Text style={styles.podiumPts}>{leaderboardData[1].points} pts</Text>
              </View>

              {/* Gold #1 */}
              <View style={[styles.podiumItem, { marginBottom: 0 }]}>
                <Text style={[styles.podiumEmoji, { fontSize: 30 }]}>👑</Text>
                <View style={[styles.podiumBar, styles.podiumGold]}>
                  <Text style={styles.podiumBarRank}>1</Text>
                </View>
                <Text style={styles.podiumFirstName} numberOfLines={1}>
                  {leaderboardData[0].name.split(' ')[0]}
                </Text>
                <Text style={styles.podiumPts}>{leaderboardData[0].points} pts</Text>
              </View>

              {/* Bronze #3 */}
              <View style={styles.podiumItem}>
                <Text style={styles.podiumEmoji}>🥉</Text>
                <View style={[styles.podiumBar, styles.podiumBronze]}>
                  <Text style={styles.podiumBarRank}>3</Text>
                </View>
                <Text style={styles.podiumFirstName} numberOfLines={1}>
                  {leaderboardData[2].name.split(' ')[0]}
                </Text>
                <Text style={styles.podiumPts}>{leaderboardData[2].points} pts</Text>
              </View>
            </View>

            {/* Ranks 4 & 5 */}
            <View style={styles.lowerRanksContainer}>
              {leaderboardData.slice(3, 5).map((item, idx) => (
                <View key={item.id} style={[
                  styles.lowerRankCard,
                  idx === 0 && { marginBottom: 8 },
                ]}>
                  {/* Rank badge */}
                  <View style={styles.lowerRankBadge}>
                    <Text style={styles.lowerRankNum}>#{item.rank}</Text>
                  </View>

                  {/* Name + stats */}
                  <View style={styles.lowerRankInfo}>
                    <Text style={styles.lowerRankName} numberOfLines={1}>{item.name}</Text>
                    <View style={styles.lowerRankStats}>
                      <Icon name="star"  size={11} color={colors.warning.main} />
                      <Text style={styles.lowerRankStatText}>{item.points} pts</Text>
                      <View style={styles.lowerRankStatDot} />
                      <Icon name="flame" size={11} color={colors.danger.main} />
                      <Text style={styles.lowerRankStatText}>{item.streak}d streak</Text>
                    </View>
                  </View>

                  {/* Challenge chip */}
                  <TouchableOpacity
                    style={styles.challengeChip}
                    onPress={() => handleChallenge(item)}
                    activeOpacity={0.8}
                  >
                    <Icon name="flash" size={12} color={colors.warning.main} />
                    <Text style={styles.challengeChipText}>Challenge</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>

            {/* User position */}
            <View style={styles.leaderboardUserDivider}>
              <View style={styles.leaderboardDividerLine} />
              <Text style={styles.leaderboardDividerText}>YOUR POSITION</Text>
              <View style={styles.leaderboardDividerLine} />
            </View>

            {(() => {
              const me = leaderboardData.find(d => d.isUser);
              if (!me) return null;
              const top5pts = leaderboardData.find(d => d.rank === 5 && !d.isUser)?.points ?? 0;
              const gapToTop5 = typeof me.points === 'number' && top5pts > 0 ? top5pts - me.points : 0;
              return (
                <View style={styles.leaderboardUserRow}>
                  <View style={styles.leaderboardUserRankBadge}>
                    <Text style={styles.leaderboardUserRankNum}>#{me.rank}</Text>
                  </View>
                  <View style={styles.leaderboardRaceInfo}>
                    <Text style={styles.leaderboardUserNameText}>You</Text>
                    {gapToTop5 > 0 && (
                      <Text style={styles.leaderboardGapText}>
                        🔥 {gapToTop5} pts to enter Top 5!
                      </Text>
                    )}
                  </View>
                  <View style={styles.leaderboardUserPtsWrap}>
                    <Icon name="star" size={12} color={colors.warning.main} />
                    <Text style={styles.leaderboardUserPtsText}>{me.points}</Text>
                  </View>
                </View>
              );
            })()}
          </View>
        </Animated.View>

        {/* Inspirational Quote */}
        {quote && (
          <Animated.View style={[styles.quoteSection, { opacity: fadeAnim }]}>
            <LinearGradient
              colors={['rgba(99, 102, 241, 0.08)', 'rgba(139, 92, 246, 0.04)']}
              style={styles.quoteGradient}
            >
              <View style={styles.quoteIconRow}>
                <Icon name="chatbubble-ellipses" size={16} color={colors.primary.light} />
              </View>
              <Text style={styles.quoteText}>“{quote.text}”</Text>
              <View style={styles.quoteFooter}>
                <Text style={styles.quoteAuthor}>— {quote.author}</Text>
                <TouchableOpacity onPress={() => fetchQuote()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Icon name="refresh" size={16} color={colors.primary.light} />
                </TouchableOpacity>
              </View>
            </LinearGradient>
          </Animated.View>
        )}

      </ScrollView>

      {/* ENHANCED Day Breakdown Modal */}
      <Modal visible={showDayBreakdown} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <LinearGradient colors={colors.success.gradient} style={styles.modalHeader}>
              <Text style={styles.modalHeaderTitle}>Weekly Breakdown</Text>
              <TouchableOpacity onPress={() => setShowDayBreakdown(false)}>
                <Icon name="close" size={24} color="#FFFFFF" />
              </TouchableOpacity>
            </LinearGradient>

            <ScrollView style={styles.modalBody}>
              {/* Summary Stats */}
              <View style={styles.modalSummary}>
                <View style={styles.modalSummaryItem}>
                  <Text style={styles.modalSummaryValue}>{weeklyProgress.attendedSessions}</Text>
                  <Text style={styles.modalSummaryLabel}>Attended</Text>
                </View>
                <View style={styles.modalSummaryItem}>
                  <Text style={styles.modalSummaryValue}>{weeklyProgress.missedSessions}</Text>
                  <Text style={styles.modalSummaryLabel}>Missed</Text>
                </View>
                <View style={styles.modalSummaryItem}>
                  <Text style={styles.modalSummaryValue}>{weeklyProgress.totalSessions}</Text>
                  <Text style={styles.modalSummaryLabel}>Total</Text>
                </View>
              </View>

              {/* Per Day Breakdown */}
              {weeklyProgress.days.map(day => (
                <View key={day.day} style={styles.modalDayItem}>
                  <View style={styles.modalDayHeader}>
                    <Text style={styles.modalDayName}>{day.fullDay}</Text>
                    <Text style={[styles.modalDayPercent, { color: getProgressColor(day.percent) }]}>
                      {day.percent}%
                    </Text>
                  </View>
                  
                  {/* Progress Bar */}
                  <View style={styles.modalDayBar}>
                    <LinearGradient
                      colors={[getProgressColor(day.percent), `${getProgressColor(day.percent)}CC`]}
                      style={[styles.modalDayBarFill, { width: `${day.percent}%` }]}
                    />
                  </View>
                  
                  {/* Session Count */}
                  <Text style={styles.modalDayStats}>
                    {day.attended}/{day.total} sessions
                  </Text>
                  
                  {/* Individual Lessons List */}
                  {day.lessons.length > 0 && (
                    <View style={styles.lessonList}>
                      {day.lessons.map((lesson, idx) => (
                        <View key={idx} style={styles.lessonItem}>
                          <Icon 
                            name={lesson.attended ? 'checkmark-circle' : 'close-circle'} 
                            size={14} 
                            color={lesson.attended ? colors.success.main : colors.danger.main} 
                          />
                          <Text style={styles.lessonText}>
                            {lesson.time} - {lesson.code}: {lesson.name}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              ))}

              {/* Goal Comparison */}
              <View style={styles.modalComparison}>
                <Text style={styles.modalComparisonTitle}>Progress to Goal</Text>
                <View style={styles.modalComparisonItem}>
                  <Text style={styles.modalComparisonLabel}>Your Goal</Text>
                  <Text style={styles.modalComparisonValue}>{weeklyProgress.goal}%</Text>
                </View>
                <View style={styles.modalComparisonItem}>
                  <Text style={styles.modalComparisonLabel}>Current</Text>
                  <Text style={[styles.modalComparisonValue, { color: colors.success.main }]}>
                    {weeklyProgress.current}%
                  </Text>
                </View>
                {weeklyProgress.neededToReachGoal > 0 && (
                  <View style={styles.modalComparisonItem}>
                    <Text style={styles.modalComparisonLabel}>Needed</Text>
                    <Text style={[styles.modalComparisonValue, { color: colors.warning.main }]}>
                      {weeklyProgress.neededToReachGoal} more session{weeklyProgress.neededToReachGoal !== 1 ? 's' : ''}
                    </Text>
                  </View>
                )}
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = (C) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  content: {
    padding: 16,
    paddingBottom: 24,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  statsCard: {
    width: '48%',
    height: 130,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 12,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  statsCardGradient: {
    flex: 1,
    padding: 12,
    justifyContent: 'space-between',
  },
  statsCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statsCardTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statsCardIcon: {
    fontSize: 16,
  },
  statsCardTitle: {
    fontSize: 11,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  statsCardBadge: {
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 6,
  },
  statsCardBadgeText: {
    fontSize: 8,
    fontWeight: '600',
  },
  statsCardContent: {
    flex: 1,
    justifyContent: 'center',
  },
  statsCardMain: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  statsCardFooter: {
    marginTop: 4,
  },
  cardDetails: {
    gap: 4,
  },
  cardDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  cardDetailText: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.8)',
  },
  trendContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    gap: 2,
  },
  trendValue: {
    fontSize: 9,
    fontWeight: '600',
  },
  trendLabel: {
    fontSize: 8,
    color: C.textSec,
    marginLeft: 2,
  },
  progressWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  progressBarContainer: {
    flex: 1,
  },
  progressBarBackground: {
    height: '100%',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  progressLabel: {
    fontSize: 10,
    fontWeight: '600',
    width: 30,
  },
  expandedScheduleContainer: {
    marginBottom: 16,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: C.border,
  },
  expandedScheduleGradient: {
    padding: 16,
  },
  expandedScheduleTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: C.text,
    marginBottom: 12,
  },
  expandedScheduleItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  expandedScheduleTime: {
    width: 50,
    alignItems: 'center',
    gap: 2,
  },
  expandedScheduleTimeText: {
    fontSize: 11,
    fontWeight: '600',
    color: C.text,
  },
  expandedScheduleStatus: {
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  expandedScheduleStatusText: {
    fontSize: 10,
    fontWeight: '700',
  },
  expandedScheduleInfo: {
    flex: 1,
    marginLeft: 8,
  },
  expandedScheduleCourse: {
    fontSize: 12,
    fontWeight: '600',
    color: C.text,
  },
  expandedScheduleMeta: {
    fontSize: 10,
    color: C.textTer,
    marginTop: 2,
  },
  expandedScheduleJoin: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: C.success,
    borderRadius: 12,
  },
  expandedScheduleJoinText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  quickActionsSection: {
    marginBottom: 16,
    borderRadius: 16,
    backgroundColor: C.bgCard,
    padding: 16,
    borderWidth: 1,
    borderColor: C.primarySoft,
  },
  quickActionsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  quickActionsTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: C.text,
  },
  quickActionsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  quickActionBtn: {
    alignItems: 'center',
    flex: 1,
  },
  quickActionGradient: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  quickActionLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: C.textSec,
    textAlign: 'center',
    lineHeight: 14,
  },
  healthSection: {
    marginBottom: 16,
    borderRadius: 20,
    backgroundColor: C.bgCard,
    borderWidth: 1,
    borderColor: C.border,
    overflow: 'hidden',
    elevation: 3,
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
  },
  healthHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    paddingBottom: 12,
  },
  healthHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  healthIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  healthTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: C.text,
  },
  healthSubtitle: {
    fontSize: 11,
    color: C.textTer,
    marginTop: 1,
  },
  healthRingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 14,
    gap: 16,
  },
  healthRingContainer: {
    alignItems: 'center',
    width: 100,
  },
  healthRingBg: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 8,
    borderColor: 'rgba(99, 102, 241, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  healthRingFill: {
    position: 'absolute',
    top: -8,
    left: -8,
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 8,
    borderColor: 'transparent',
    borderTopColor: '#10B981',
    borderRightColor: '#10B981',
  },
  healthRingCenter: {
    position: 'absolute',
    top: 0,
    left: 6,
    width: 88,
    height: 88,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  healthRingPercent: {
    fontSize: 26,
    fontWeight: '800',
    color: C.text,
  },
  healthRingPercentSign: {
    fontSize: 14,
    fontWeight: '600',
    color: C.textTer,
    marginTop: 4,
  },
  healthEligibilityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    gap: 4,
    marginTop: 6,
  },
  healthEligibilityText: {
    fontSize: 10,
    fontWeight: '700',
  },
  healthStatTiles: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  healthTile: {
    width: '47%',
    borderRadius: 12,
    padding: 10,
    alignItems: 'center',
    gap: 2,
  },
  healthTileValue: {
    fontSize: 18,
    fontWeight: '800',
  },
  healthTileLabel: {
    fontSize: 10,
    fontWeight: '500',
    color: C.textTer,
  },
  healthTrajectory: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  healthTrajectoryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  healthTrajectoryTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: C.textSec,
  },
  healthTrajectoryProjected: {
    fontSize: 11,
    fontWeight: '600',
    color: C.primary,
  },
  healthTrajectoryTrack: {
    height: 8,
    backgroundColor: C.surfaceTer,
    borderRadius: 4,
    overflow: 'visible',
    position: 'relative',
  },
  healthTrajectoryFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  healthTrajectoryFillGradient: {
    flex: 1,
  },
  healthProjectedZone: {
    position: 'absolute',
    top: 0,
    height: 8,
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    borderTopRightRadius: 4,
    borderBottomRightRadius: 4,
  },
  healthTargetMarker: {
    position: 'absolute',
    top: -4,
    zIndex: 2,
    alignItems: 'center',
  },
  healthTargetLine: {
    width: 2,
    height: 16,
    backgroundColor: C.primary,
    borderRadius: 1,
  },
  healthTrajectoryLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  healthTrajectoryLabel: {
    fontSize: 9,
    color: C.textTer,
  },
  healthExpandedSection: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  healthRiskBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    backgroundColor: C.warningSoft,
    borderRadius: 12,
    marginBottom: 12,
  },
  healthRiskBannerIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  healthRiskBannerTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: C.warningDark,
  },
  healthRiskBannerSub: {
    fontSize: 11,
    color: C.warning,
    marginTop: 1,
  },
  healthUnitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 10,
  },
  healthUnitInfo: {
    width: 70,
  },
  healthUnitCode: {
    fontSize: 11,
    fontWeight: '700',
    color: C.text,
  },
  healthUnitName: {
    fontSize: 9,
    color: C.textTer,
  },
  healthUnitBarWrap: {
    flex: 1,
  },
  healthUnitBarTrack: {
    height: 6,
    backgroundColor: C.surfaceTer,
    borderRadius: 3,
    overflow: 'visible',
    position: 'relative',
  },
  healthUnitBarFill: {
    height: 6,
    borderRadius: 3,
    position: 'absolute',
    top: 0,
    left: 0,
  },
  healthUnitTargetMark: {
    position: 'absolute',
    top: -3,
    width: 2,
    height: 12,
    backgroundColor: C.primary,
    borderRadius: 1,
  },
  healthUnitPercent: {
    fontSize: 12,
    fontWeight: '700',
    width: 36,
    textAlign: 'right',
  },
  healthViewReport: {
    borderRadius: 12,
    overflow: 'hidden',
    marginTop: 4,
  },
  healthViewReportGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    gap: 6,
  },
  healthViewReportText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  leaderboardSection: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 16,
    overflow: 'hidden',
  },
  leaderboardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
  },
  leaderboardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  leaderboardHeaderTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  leaderboardHeaderSub: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.6)',
    marginTop: 1,
  },
  leaderboardHeaderLink: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.9)',
    fontWeight: '600',
  },
  leaderboardBody: {
    padding: 16,
    paddingTop: 20,
    backgroundColor: C.surface,
  },
  podiumRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 20,
  },
  podiumItem: { alignItems: 'center', width: 80 },
  podiumEmoji: { fontSize: 24, marginBottom: 4 },
  podiumBar: {
    width: 56,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 8,
  },
  podiumGold:   { height: 68, backgroundColor: '#B8860B' },
  podiumSilver: { height: 52, backgroundColor: '#607D8B' },
  podiumBronze: { height: 42, backgroundColor: '#8D5524' },
  podiumBarRank: { fontSize: 18, fontWeight: '900', color: '#FFF' },
  podiumFirstName: {
    fontSize: 11,
    fontWeight: '700',
    color: C.text,
    marginTop: 4,
    textAlign: 'center',
  },
  podiumPts: { fontSize: 10, color: C.textTer, textAlign: 'center' },
  lowerRanksContainer: {
    marginBottom: 4,
  },
  lowerRankCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface2,
    borderRadius: 12,
    padding: 12,
    gap: 10,
    borderWidth: 1,
    borderColor: C.border,
  },
  lowerRankBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: C.surfaceTer,
    borderWidth: 1,
    borderColor: C.borderMed,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  lowerRankNum: {
    fontSize: 12,
    fontWeight: '800',
    color: C.textSec,
  },
  lowerRankInfo: { flex: 1 },
  lowerRankName: {
    fontSize: 13,
    fontWeight: '700',
    color: C.text,
  },
  lowerRankStats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 3,
  },
  lowerRankStatText: { fontSize: 11, color: C.textTer },
  lowerRankStatDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: C.borderMed,
  },
  challengeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(245,158,11,0.15)',
    borderRadius: 12,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.3)',
  },
  challengeChipText: { fontSize: 10, fontWeight: '700', color: C.warning },
  leaderboardUserDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginVertical: 14,
  },
  leaderboardDividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: C.borderMed },
  leaderboardDividerText: { fontSize: 9, fontWeight: '700', color: C.textTer, letterSpacing: 0.8 },
  leaderboardUserRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.primarySoft,
    borderRadius: 12,
    padding: 12,
    gap: 10,
    borderWidth: 1,
    borderColor: `${C.primary}40`,
  },
  leaderboardUserRankBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  leaderboardUserRankNum: { fontSize: 12, fontWeight: '900', color: '#FFF' },
  leaderboardUserNameText: { fontSize: 13, fontWeight: '700', color: C.primary },
  leaderboardGapText: { fontSize: 10, color: C.warning, fontWeight: '600', marginTop: 1 },
  leaderboardUserPtsWrap: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  leaderboardUserPtsText: { fontSize: 15, fontWeight: '800', color: C.warning },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
  },
  modalHeaderTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  modalBody: {
    padding: 20,
  },
  modalDayItem: {
    marginBottom: 20,
  },
  modalDayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  modalDayName: {
    fontSize: 14,
    fontWeight: '600',
    color: C.text,
  },
  modalDayPercent: {
    fontSize: 14,
    fontWeight: '700',
  },
  modalDayBar: {
    height: 8,
    backgroundColor: C.surfaceTer,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 4,
  },
  modalDayBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  modalDayStats: {
    fontSize: 11,
    color: C.textSec,
    marginBottom: 8,
  },
  modalComparison: {
    marginTop: 20,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  modalComparisonTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: C.text,
    marginBottom: 12,
  },
  modalComparisonItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  modalComparisonLabel: {
    fontSize: 13,
    color: C.textSec,
  },
  modalComparisonValue: {
    fontSize: 13,
    fontWeight: '600',
    color: C.text,
  },
  quoteSection: {
    marginBottom: 8,
    borderRadius: 16,
    overflow: 'hidden',
  },
  quoteGradient: {
    padding: 20,
    alignItems: 'center',
  },
  quoteIconRow: {
    marginBottom: 10,
    opacity: 0.6,
  },
  quoteText: {
    fontSize: 14,
    fontStyle: 'italic',
    color: C.textSec,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 10,
  },
  quoteAuthor: {
    fontSize: 12,
    fontWeight: '600',
    color: C.primary,
  },
  quoteFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },
  compositeIcon: {
    position: 'relative',
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compositeBadgeRight: {
    position: 'absolute',
    bottom: -4,
    right: -8,
    backgroundColor: '#3B82F6',
    borderRadius: 10,
    padding: 2,
    borderWidth: 1,
    borderColor: '#FFFFFF',
  },
  compositeBadgeTop: {
    position: 'absolute',
    top: -6,
    right: -10,
    backgroundColor: '#EF4444',
    borderRadius: 10,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderWidth: 1,
    borderColor: '#FFFFFF',
  },
  compositeBadgeText: {
    color: '#FFFFFF',
    fontSize: 7,
    fontWeight: 'bold',
  },
  // Enhanced modal styles
  modalSummary: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: C.surfaceLight,
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
  },
  modalSummaryItem: {
    alignItems: 'center',
  },
  modalSummaryValue: {
    fontSize: 24,
    fontWeight: '800',
    color: C.text,
  },
  modalSummaryLabel: {
    fontSize: 12,
    color: C.textSec,
    marginTop: 4,
  },
  lessonList: {
    marginTop: 8,
    marginLeft: 8,
    gap: 6,
  },
  lessonItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  lessonText: {
    fontSize: 12,
    color: C.textSec,
    flex: 1,
  },
});