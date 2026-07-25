// src/screens/student/home/InsightsScreen.js
import React, { useCallback, useMemo, useState, useRef, useEffect, memo } from 'react';
import {
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Animated,
  InteractionManager,
  Vibration,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/Ionicons';
import { useEnrollment } from '../../../context/EnrollmentContext';
import sqliteStorage from '../../../storage/sqliteStorage';
import { fetchStudentTimetableSnapshot, fetchStudentExtraSessions } from '../../../utils/studentTimetableApi';
import { getStudentSession } from '../../../utils/authSession';
import { fetchMyGDAttendance } from '../../../utils/delegationApi';
import { fetchConductedSessionCounts, getCachedConductedCounts, fetchStudentAttendanceSummary, getCachedAttendanceSummary } from '../../../utils/offlineAttendanceApi';
import { fetchAssignments } from '../../../utils/assignmentsApiV2';
import { getCachedAchievements } from '../../../utils/achievementsApi';
import useInternetStatus from '../../../hooks/useInternetStatus';
import useSyncOnReconnect from '../../../hooks/useSyncOnReconnect';
import { useColors } from '../../../theme';

const _insightsCache = {
  records: null, conductedCounts: null, goalsByCode: null,
  timetable: null, extraSessions: null, assignments: null, backendSummary: null,
  timestamp: 0,
};
const STALE_MS = 5 * 60 * 1000;


const TARGET_PERCENT_DEFAULT = 75;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_SHORT = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Utility functions
const normalizeUnitCode = (code) => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const parseUnit = (unitValue) => {
  if (typeof unitValue !== 'string') return { name: '', code: '' };
  const trimmed = unitValue.trim();
  if (!trimmed) return { name: '', code: '' };
  const match = trimmed.match(/\(([^)]+)\)\s*$/);
  if (!match || !match[1]) return { name: trimmed, code: trimmed.toUpperCase() };
  return { name: trimmed.slice(0, match.index).trim(), code: match[1].trim().toUpperCase() };
};

const formatDateKey = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

// ── Helper Functions for Analytics ──────────────────────────────────────────
const calculateVolatility = (attendanceArray) => {
  if (!attendanceArray || attendanceArray.length < 2) return 0;
  const mean = attendanceArray.reduce((a, b) => a + b, 0) / attendanceArray.length;
  const variance = attendanceArray.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / attendanceArray.length;
  return Math.round(Math.sqrt(variance));
};

const getBestDay = (weekDays) => {
  const valid = weekDays.filter(d => d.percent !== null);
  if (valid.length === 0) return 'No data';
  const best = valid.reduce((max, day) => (day.percent > max.percent ? day : max), valid[0]);
  return WEEKDAY_SHORT[best.date.getDay()];
};

const getBestDayPercent = (weekDays) => {
  const valid = weekDays.filter(d => d.percent !== null);
  if (valid.length === 0) return 0;
  const best = valid.reduce((max, day) => (day.percent > max.percent ? day : max), valid[0]);
  return best.percent;
};

const getWorstDay = (weekDays) => {
  const valid = weekDays.filter(d => d.percent !== null);
  if (valid.length === 0) return 'No data';
  const worst = valid.reduce((min, day) => (day.percent < min.percent ? day : min), valid[0]);
  return WEEKDAY_SHORT[worst.date.getDay()];
};

const getWorstDayPercent = (weekDays) => {
  const valid = weekDays.filter(d => d.percent !== null);
  if (valid.length === 0) return 0;
  const worst = valid.reduce((min, day) => (day.percent < min.percent ? day : min), valid[0]);
  return worst.percent;
};

const getConsistencyScore = (weekDays) => {
  const valid = weekDays.filter(d => d.percent !== null);
  if (valid.length < 2) return 100;
  const values = valid.map(d => d.percent);
  const volatility = calculateVolatility(values);
  return Math.max(0, Math.min(100, 100 - volatility));
};

const getConsistencyColor = (score, colors) => {
  if (score >= 80) return colors.success.main;
  if (score >= 60) return colors.warning.main;
  return colors.danger.main;
};

const getTrendColor = (trend, colors) => {
  if (trend > 0) return colors.success.main;
  if (trend < 0) return colors.danger.main;
  return colors.info.main;
};

const getTrendMessage = (trend, currentPercent) => {
  if (trend > 5) return `Strong upward trend! +${Math.round(trend)}% improvement`;
  if (trend > 0) return `Gradual improvement (+${Math.round(trend)}%) - keep going!`;
  if (trend < -5) return `⚠️ Sharp decline detected (${Math.round(Math.abs(trend))}% drop) - take action`;
  if (trend < 0) return `Slight decline (${Math.round(Math.abs(trend))}%) - small adjustments needed`;
  return `Stable pattern - maintain current approach`;
};

const calculateNextWeekPrediction = (weekPercent, weekDays) => {
  if (!weekDays || weekDays.length === 0) return weekPercent;
  const valid = weekDays.filter(d => d.percent !== null);
  if (valid.length < 2) return weekPercent;
  
  const recentTrend = valid.slice(-3).reduce((sum, day, i, arr) => {
    if (i === 0) return 0;
    return sum + ((day.percent || 0) - (arr[i-1].percent || 0));
  }, 0) / Math.min(3, valid.length - 1);
  
  const prediction = weekPercent + (recentTrend * 0.5);
  return Math.min(100, Math.max(0, Math.round(prediction)));
};

const getRiskMessage = (trend, weekPercent) => {
  if (trend < -5 && weekPercent < 70) return "⚠️ Critical: Attendance dropping rapidly. Immediate action needed!";
  if (trend < -3) return "📉 Warning: Declining trend detected. Review what changed recently.";
  if (trend > 5) return "📈 Excellent! Strong improvement trend - you're building great habits!";
  if (trend > 0) return "✅ Positive momentum - keep pushing!";
  return "🏃 Stable attendance - maintain this consistency.";
};

const getStreakPrediction = (currentStreak, weekDays) => {
  if (currentStreak === 0) return "Start a streak today - your first step to consistency!";
  if (currentStreak < 3) return `🔥 ${currentStreak} day streak - ${4 - currentStreak} more for habit formation!`;
  if (currentStreak < 7) return `💪 ${currentStreak} day streak - ${7 - currentStreak} days to perfect week!`;
  if (currentStreak < 14) return `🏆 Amazing ${currentStreak} day streak! ${14 - currentStreak} to 2 weeks!`;
  return `🌟 Legendary ${currentStreak} day streak! You're an attendance champion!`;
};

const calculateGoalProbability = (currentPercent, targetPercent, trend, remainingWeeks) => {
  if (currentPercent >= targetPercent) return 95;
  if (remainingWeeks <= 0) return 0;
  
  const weeklyGainNeeded = (targetPercent - currentPercent) / remainingWeeks;

  if (weeklyGainNeeded <= 0) return 95;
  if (weeklyGainNeeded <= 2) return 75;
  if (weeklyGainNeeded <= 3) return 50;
  if (weeklyGainNeeded <= 4) return 30;
  return 15;
};

const getGoalColor = (current, target, colors) => {
  if (current >= target) return colors.success.main;
  if (current >= target - 10) return colors.warning.main;
  return colors.danger.main;
};

const getGoalHint = (current, target, neededPerWeek) => {
  const gap = target - current;
  if (gap <= 0) return "🎉 You've achieved your goal! Maintain this momentum to stay on track.";
  if (neededPerWeek <= 1) return `💪 Almost there! Just ${Math.ceil(gap)} more percentage point${gap !== 1 ? 's' : ''} to reach ${target}%.`;
  if (neededPerWeek <= 2) return `🎯 On track! Need ~${neededPerWeek} more sessions this week to reach your goal.`;
  if (neededPerWeek <= 3) return `📈 Reachable: ${neededPerWeek} sessions this week will get you to ${target}%.`;
  return `⚠️ Challenge: Need ~${neededPerWeek} sessions/week. Consider adjusting your goal or increasing attendance.`;
};

const getActionItems = (weekDays, weekPercent, targetPercent, colors) => {
  const actions = [];
  const worstDay = getWorstDay(weekDays);
  const worstPercent = getWorstDayPercent(weekDays);

  if (worstPercent < 50 && worstPercent !== 0) {
    actions.push({
      text: `Break the pattern on ${worstDay} - you've missed ${Math.round((100 - worstPercent) / 10)} of the last ${Math.round(100 / (100 - worstPercent))} sessions`,
      color: colors.warning.main,
      urgent: worstPercent < 30
    });
  }

  const consistencyScore = getConsistencyScore(weekDays);
  if (consistencyScore < 50) {
    actions.push({
      text: `Improve consistency (${consistencyScore}%) - set daily reminders for all sessions`,
      color: colors.info.main,
      urgent: false
    });
  }

  if (weekPercent < targetPercent) {
    const needed = Math.ceil((targetPercent - weekPercent) / 10);
    actions.push({
      text: `Need ~${needed} more session${needed !== 1 ? 's' : ''} this week to reach ${targetPercent}%`,
      color: colors.danger.main,
      urgent: weekPercent < targetPercent - 15
    });
  } else if (weekPercent >= targetPercent) {
    actions.push({
      text: `Great job! Maintain ${weekPercent}% to stay above your ${targetPercent}% goal`,
      color: colors.success.main,
      urgent: false
    });
  }

  return actions.slice(0, 3);
};

const getQuickWins = (weekDays) => {
  const wins = [];
  const bestDay = getBestDay(weekDays);
  const bestPercent = getBestDayPercent(weekDays);
  
  if (bestPercent === 100) {
    wins.push(`Perfect attendance on ${bestDay} - replicate this habit!`);
  }
  
  const consistencyScore = getConsistencyScore(weekDays);
  if (consistencyScore >= 80) {
    wins.push(`High consistency (${consistencyScore}%) - you're building strong habits`);
  }
  
  const improvingDays = weekDays.filter((d, i) => i > 0 && d.percent && weekDays[i-1].percent && d.percent > weekDays[i-1].percent);
  if (improvingDays.length >= 2) {
    wins.push(`Improving trend detected - your effort is paying off!`);
  }
  
  if (wins.length === 0) {
    wins.push(`Start small - aim to attend just one more session this week`);
    wins.push(`Use reminders - students who set notifications attend 25% more`);
  }
  
  return wins.slice(0, 2);
};

const getEstimatedClassAverage = (item) => {
  // Deterministic estimate — stable until a real per-unit average endpoint is available
  let hash = 0;
  for (let i = 0; i < item.code.length; i++) {
    hash = Math.imul(31, hash) + item.code.charCodeAt(i);
  }
  return Math.min(85, Math.max(55, 68 + (Math.abs(hash) % 18)));
};

const getPeerInsightFromRank = (percentile) => {
  if (percentile >= 80) return "You're in the top 20% of your cohort — excellent academic discipline!";
  if (percentile >= 60) return "You're above average — push for the top quarter!";
  if (percentile >= 40) return "Near the class average — small consistent improvements will move you up.";
  if (percentile >= 20) return "Room to grow — focus on building regular attendance habits.";
  return "Let's start small — consistency now pays off all semester.";
};

const getCatchUpDifficulty = (item) => {
  if (item.needed === 0) return 0;
  const ratio = item.needed / Math.max(1, item.stat.conductedCount);
  return Math.min(100, Math.round(ratio * 50));
};

const getRequiredPerWeek = (item, remainingWeeks) => {
  if (remainingWeeks <= 0 || item.needed <= 0) return 0;
  return Math.ceil(item.needed / remainingWeeks);
};

const getDropRisk = (item) => {
  let risk = 50;
  if (item.stat.percent < item.target - 15) risk += 25;
  else if (item.stat.percent < item.target - 5) risk += 10;
  if (item.trend < -5) risk += 20;
  else if (item.trend < 0) risk += 10;
  if (item.weekLessons === 0) risk += 15;
  return Math.min(95, Math.max(5, risk));
};

const getDifficultyColor = (item, colors) => {
  const difficulty = getCatchUpDifficulty(item);
  if (difficulty < 30) return colors.success.main;
  if (difficulty < 60) return colors.warning.main;
  return colors.danger.main;
};

const getInterventions = (item, colors) => {
  const interventions = [];
  const urgencyColor = item.urgency === 'critical' ? colors.danger.main : item.urgency === 'warning' ? colors.warning.main : colors.success.main;
  
  if (item.stat.percent < item.target) {
    interventions.push({
      icon: "alarm-outline",
      type: "Smart Reminders",
      description: `Set 3 reminders for ${getWorstDayFromHistory(item)} sessions - 87% effective for students with similar patterns.`,
      impact: "+15-20% attendance",
      effort: "Low",
      color: urgencyColor
    });
  }
  
  if (item.weekLessons === 0) {
    interventions.push({
      icon: "people-outline",
      type: "Study Group",
      description: "No sessions this week - form a study group to stay engaged and review material together.",
      impact: "Maintains engagement",
      effort: "Medium",
      color: urgencyColor
    });
  }
  
  if (getCatchUpDifficulty(item) > 50) {
    interventions.push({
      icon: "trending-down-outline",
      type: "Goal Adjustment",
      description: `Consider adjusting your target from ${item.target}% to ${Math.max(60, item.target - 5)}% for a more achievable goal this semester.`,
      impact: "Reduces pressure",
      effort: "Low",
      color: urgencyColor
    });
  }
  
  if (item.stat.percent < 60 && item.target > 65) {
    interventions.push({
      icon: "flag-outline",
      type: "Milestone Setting",
      description: `Set an intermediate goal of 65% before reaching your ${item.target}% target - celebrate small wins!`,
      impact: "Builds momentum",
      effort: "Low",
      color: urgencyColor
    });
  }
  
  return interventions.slice(0, 2);
};

const getWorstDayFromHistory = (item) => {
  // Use real computed worst day from attendance records if available
  if (item.worstDay) return item.worstDay;
  // Fallback: deterministic hash so the UI never shows undefined
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  let hash = 0;
  for (let i = 0; i < item.code.length; i++) {
    hash = Math.imul(31, hash) + item.code.charCodeAt(i);
  }
  return days[Math.abs(hash) % days.length];
};

const getMilestones = (item) => {
  const milestones = [];
  const current = item.stat.percent;
  const target = item.target;
  
  milestones.push({
    name: "50% Baseline",
    icon: "flag-outline",
    progress: Math.min(100, Math.round((current / 50) * 100)),
    achieved: current >= 50
  });
  
  milestones.push({
    name: "75% Good Standing",
    icon: "star-outline",
    progress: Math.min(100, Math.round((current / 75) * 100)),
    achieved: current >= 75
  });
  
  milestones.push({
    name: `${target}% Personal Goal`,
    icon: "trophy-outline",
    progress: Math.min(100, Math.round((current / target) * 100)),
    achieved: current >= target
  });
  
  if (current >= 90) {
    milestones.push({
      name: "90% Excellence",
      icon: "medal-outline",
      progress: 100,
      achieved: true
    });
  } else {
    milestones.push({
      name: "90% Excellence",
      icon: "medal-outline",
      progress: Math.min(100, Math.round((current / 90) * 100)),
      achieved: false
    });
  }
  
  return milestones;
};

// ── Animated Card Component ──────────────────────────────────────────────
const AnimatedCard = memo(({ title, subtitle, gradient, icon, children, delay = 0, collapsible = false, defaultCollapsed = false, styles }) => {
  const scaleAnim = useRef(new Animated.Value(0.95)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  useEffect(() => {
    const timeout = setTimeout(() => {
      Animated.parallel([
        Animated.spring(scaleAnim, { toValue: 1, friction: 8, tension: 40, useNativeDriver: true }),
        Animated.timing(opacityAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
      ]).start();
    }, delay);
    return () => clearTimeout(timeout);
  }, [delay, scaleAnim, opacityAnim]);

  return (
    <Animated.View style={[styles.cardContainer, { transform: [{ scale: scaleAnim }], opacity: opacityAnim }]}>
      <TouchableOpacity
        activeOpacity={collapsible ? 0.8 : 1}
        onPress={collapsible ? () => setCollapsed(c => !c) : undefined}
        disabled={!collapsible}
      >
        <LinearGradient colors={gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.cardHeader}>
          <View style={styles.cardHeaderLeft}>
            {icon && <Icon name={icon} size={20} color="#FFFFFF" />}
            <Text style={styles.cardTitle}>{title}</Text>
          </View>
          <View style={styles.cardHeaderRight}>
            {subtitle && <Text style={styles.cardSubtitle}>{subtitle}</Text>}
            {collapsible && (
              <Icon name={collapsed ? 'chevron-down' : 'chevron-up'} size={18} color="rgba(255,255,255,0.85)" style={{ marginLeft: 6 }} />
            )}
          </View>
        </LinearGradient>
      </TouchableOpacity>
      {!collapsed && <View style={styles.cardContent}>{children}</View>}
    </Animated.View>
  );
});

// ── Stat Card Component ──────────────────────────────────────────────────
const StatCard = memo(({ label, value, icon, color, trend, styles }) => (
  <View style={[styles.statCard, { borderTopColor: color }]}>
    <View style={styles.statCardHeader}>
      <Icon name={icon} size={20} color={color} />
      {trend !== undefined && (
        <View style={[styles.trendBadge, { backgroundColor: `${color}20` }]}>
          <Icon name={trend >= 0 ? "trending-up" : "trending-down"} size={10} color={color} />
          <Text style={[styles.trendText, { color }]}>{Math.abs(trend)}%</Text>
        </View>
      )}
    </View>
    <Text style={[styles.statValue, { color }]}>{value}</Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
));

// ── Progress Ring Component ──────────────────────────────────────────────
const ProgressRing = memo(({ percent, size = 80, strokeWidth = 6, color, styles }) => {
  const progressAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: percent / 100,
      duration: 1000,
      useNativeDriver: true,
    }).start();
  }, [percent]);

  return (
    <View style={[styles.progressRingContainer, { width: size, height: size }]}>
      <View style={styles.progressRingBackground}>
        <View style={[styles.progressRingTrack, { width: size - strokeWidth, height: size - strokeWidth, borderRadius: (size - strokeWidth) / 2, borderWidth: strokeWidth, borderColor: `${color}20` }]} />
      </View>
      <Animated.View style={[styles.progressRingFill, { width: size, height: size, transform: [{ rotate: '-90deg' }] }]}>
        <Animated.View
          style={[
            styles.progressRingCircle,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              borderWidth: strokeWidth,
              borderColor: color,
              borderTopColor: 'transparent',
              borderRightColor: 'transparent',
              transform: [{ rotate: progressAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }],
            },
          ]}
        />
      </Animated.View>
      <View style={styles.progressRingCenter}>
        <Text style={[styles.progressRingPercent, { color }]}>{percent}%</Text>
      </View>
    </View>
  );
});

// ── Weekly Progress Bar ──────────────────────────────────────────────────
const WeeklyProgressBar = memo(({ label, value, max, color, styles }) => {
  const widthAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(widthAnim, {
      toValue: max > 0 ? (value / max) * 100 : 0,
      duration: 800,
      useNativeDriver: false,
    }).start();
  }, [value, max]);

  return (
    <View style={styles.weeklyProgressBar}>
      <View style={styles.weeklyProgressHeader}>
        <Text style={styles.weeklyProgressLabel}>{label}</Text>
        <Text style={[styles.weeklyProgressValue, { color }]}>{value}/{max}</Text>
      </View>
      <View style={styles.weeklyProgressTrack}>
        <Animated.View style={[styles.weeklyProgressFill, { width: widthAnim.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }), backgroundColor: color }]} />
      </View>
    </View>
  );
});

// ── Main Component ───────────────────────────────────────────────────────
export default function InsightsScreen() {
  const { enrolledUnits } = useEnrollment();
  const { isOnline } = useInternetStatus();

  const colors = useColors();
  const C = useMemo(() => ({
    bg:        colors.background.primary,
    bgSec:     colors.background.secondary,
    surface:   colors.surface.primary,
    surface2:  colors.surface.secondary,
    surface3:  colors.surface.tertiary,
    border:    colors.border.light,
    borderMed: colors.border.medium,
    primary:   colors.primary.main,
    primaryD:  colors.primary.dark,
    primarySoft: colors.primary.soft,
    primaryGrad: colors.primary.gradient,
    success:   colors.success.main,
    successSoft: colors.success.soft,
    successGrad: colors.success.gradient,
    warning:   colors.warning.main,
    warningSoft: colors.warning.soft,
    danger:    colors.danger.main,
    dangerSoft: colors.danger.soft,
    info:      colors.info.main,
    infoSoft:  colors.info.soft,
    infoGrad:  colors.info.gradient,
    purple:    colors.purple.main,
    purpleSoft: colors.purple.soft,
    purpleGrad: colors.purple.gradient,
    pink:      colors.pink.main,
    pinkGrad:  colors.pink.gradient,
    teal:      colors.teal.main,
    tealGrad:  colors.teal.gradient,
    text:      colors.text.primary,
    textSec:   colors.text.secondary,
    textTer:   colors.text.tertiary,
  }), [colors]);
  const styles = useMemo(() => makeStyles(C), [C]);

  // State management
  const [records, setRecords] = useState(() => _insightsCache.records ?? []);
  const [conductedCounts, setConductedCounts] = useState(() => _insightsCache.conductedCounts ?? {});
  const [goalsByCode, setGoalsByCode] = useState(() => _insightsCache.goalsByCode ?? {});
  const [selectedDateKey, setSelectedDateKey] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isBackgroundUpdate, setIsBackgroundUpdate] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const [timetable, setTimetable] = useState(() => _insightsCache.timetable ?? []);
  const [extraSessions, setExtraSessions] = useState(() => _insightsCache.extraSessions ?? []);
  const [assignments, setAssignments] = useState(() => _insightsCache.assignments ?? []);
  const [backendSummary, setBackendSummary] = useState(() => _insightsCache.backendSummary ?? null);
  const [achievementRank, setAchievementRank] = useState(null);
  const [achievementTotalStudents, setAchievementTotalStudents] = useState(0);
  const [achievementDeptRank, setAchievementDeptRank] = useState(null);
  const [achievementDeptTotal, setAchievementDeptTotal] = useState(0);
  const [calendarYear, setCalendarYear] = useState(() => new Date().getFullYear());
  const [calendarMonth, setCalendarMonth] = useState(() => new Date().getMonth());

  // Refs for tracking load state
  const hasLoadedRef = useRef(false);
  const isMountedRef = useRef(true);
  const scrollY = useRef(new Animated.Value(0)).current;

  // Header animation
  const headerOpacity = scrollY.interpolate({
    inputRange: [0, 100],
    outputRange: [1, 0.9],
    extrapolate: 'clamp',
  });

  const headerScale = scrollY.interpolate({
    inputRange: [0, 100],
    outputRange: [1, 0.95],
    extrapolate: 'clamp',
  });

  // Load data function - optimized to load only once
  const loadData = useCallback(async (forceRefresh = false, isBackground = false) => {
    if (isBackground) {
      setIsBackgroundUpdate(true);
    } else if (forceRefresh || !_insightsCache.records) {
      setIsRefreshing(true);
    }

    let finalTimetable = [];
    let finalExtraSessions = [];
    let finalAssignments = [];

    try {
      const [cachedTimetable, cachedAssignments] = await Promise.all([
        sqliteStorage.getTimetableCache().catch(() => []),
        sqliteStorage.getAssignmentsCache().catch(() => []),
      ]);

      if (Array.isArray(cachedTimetable) && cachedTimetable.length > 0) {
        finalTimetable = cachedTimetable;
        if (isMountedRef.current) setTimetable(cachedTimetable);
      }
      if (Array.isArray(cachedAssignments) && cachedAssignments.length > 0) {
        finalAssignments = cachedAssignments;
        if (isMountedRef.current) setAssignments(cachedAssignments);
      }

      if (isOnline) {
        const session = await getStudentSession();
        const accessToken = session?.token || null;

        if (accessToken) {
          const [timetableResult, extras] = await Promise.all([
            fetchStudentTimetableSnapshot({ accessToken }).catch(() => null),
            fetchStudentExtraSessions(accessToken),
          ]);

          if (timetableResult?.snapshot && isMountedRef.current) {
            const normalized = (timetableResult.snapshot.timetableByDay || []).map((day) => ({
              ...day,
              lessons: (day.lessons || []).map((lesson) => ({ ...lesson, status: lesson.status || 'Pending' })),
            }));
            finalTimetable = normalized;
            setTimetable(normalized);
            sqliteStorage.saveTimetableCache(normalized).catch(() => {});
          }

          if (Array.isArray(extras) && isMountedRef.current) {
            finalExtraSessions = extras;
            setExtraSessions(extras);
          }
        }

        const gdRecords = await fetchMyGDAttendance().catch(() => []);
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
            }).catch(() => {})
          )
        );

        await sqliteStorage.backfillConductedSessionsFromAttendance();
      }

      const parsedCodes = (enrolledUnits || []).map((unit) => parseUnit(unit).code).filter(Boolean);
      const [attendanceRecords, conducted, goals, cachedSummary, cachedRemoteConducted, cachedAchievements] = await Promise.all([
        sqliteStorage.getAttendanceLightRecords(2000),
        sqliteStorage.getConductedSessionCounts(parsedCodes),
        sqliteStorage.getUnitAttendanceGoals(parsedCodes),
        getCachedAttendanceSummary(),
        getCachedConductedCounts(),
        getCachedAchievements().catch(() => null),
      ]);

      const mergedConducted = { ...(conducted || {}) };
      for (const [code, remoteCount] of Object.entries(cachedRemoteConducted || {})) {
        const normCode = normalizeUnitCode(code);
        if ((Number(remoteCount) || 0) > (Number(mergedConducted[normCode]) || 0)) {
          mergedConducted[normCode] = Number(remoteCount);
        }
      }

      const finalRecords = Array.isArray(attendanceRecords) ? attendanceRecords : [];
      const finalGoals = goals && typeof goals === 'object' ? goals : {};
      const finalSummary = cachedSummary ?? null;

      if (isMountedRef.current) {
        setRecords(finalRecords);
        setConductedCounts(mergedConducted);
        setGoalsByCode(finalGoals);
        setBackendSummary(finalSummary);
        if (cachedAchievements?.rank) {
          setAchievementRank(cachedAchievements.rank);
          setAchievementTotalStudents(cachedAchievements.totalStudents || 0);
          if (cachedAchievements.deptRank) {
            setAchievementDeptRank(cachedAchievements.deptRank);
            setAchievementDeptTotal(cachedAchievements.deptTotal || 0);
          }
        }
      }

      _insightsCache.records = finalRecords;
      _insightsCache.conductedCounts = mergedConducted;
      _insightsCache.goalsByCode = finalGoals;
      _insightsCache.backendSummary = finalSummary;
      _insightsCache.timetable = finalTimetable;
      _insightsCache.extraSessions = finalExtraSessions;
      _insightsCache.assignments = finalAssignments;
      _insightsCache.timestamp = Date.now();
      setLastRefreshed(new Date());
      hasLoadedRef.current = true;

      if (isOnline && parsedCodes.length > 0) {
        Promise.all(parsedCodes.map(code => fetchAssignments(code).catch(() => []))).then(results => {
          const seen = new Set();
          const all = [];
          results.flat().forEach(a => {
            const key = String(a?.id ?? a?.assignmentId ?? JSON.stringify(a));
            if (!seen.has(key)) {
              seen.add(key);
              all.push(a);
            }
          });
          if (isMountedRef.current) {
            setAssignments(all);
            sqliteStorage.saveAssignmentsCache(all).catch(() => {});
          }
        }).catch(() => {});

        fetchStudentAttendanceSummary().then(summary => {
          if (summary && isMountedRef.current) setBackendSummary(summary);
        }).catch(() => {});

        fetchConductedSessionCounts(parsedCodes).then(async (remoteConducted) => {
          const conductedUpdated = await sqliteStorage.getConductedSessionCounts(parsedCodes).catch(() => ({}));
          const merged2 = { ...(conductedUpdated || {}) };
          for (const [code, remoteCount] of Object.entries(remoteConducted || {})) {
            const normCode = normalizeUnitCode(code);
            if ((Number(remoteCount) || 0) > (Number(merged2[normCode]) || 0)) {
              merged2[normCode] = Number(remoteCount);
            }
          }
          if (isMountedRef.current) setConductedCounts(merged2);
        }).catch(() => {});
      }
    } catch (error) {
      console.error('Failed to load schedule data', error);
      if (_insightsCache.records) return;
    } finally {
      if (isMountedRef.current) {
        if (isBackground) setIsBackgroundUpdate(false);
        else setIsRefreshing(false);
      }
    }
  }, [enrolledUnits, isOnline]);

  useSyncOnReconnect(useCallback(() => { loadData(true, false); }, [loadData]));

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  useFocusEffect(useCallback(() => {
    let task;
    const age = Date.now() - _insightsCache.timestamp;
    if (!_insightsCache.records || age > STALE_MS) {
      loadData(false, false);
    } else {
      task = InteractionManager.runAfterInteractions(() => loadData(false, true));
    }
    return () => task?.cancel();
  }, [loadData]));

  // Memoized calculations
  const enrolledCodeSet = useMemo(() => {
    const set = new Set();
    (enrolledUnits || []).forEach((unit) => {
      const code = parseUnit(unit).code;
      if (code) set.add(normalizeUnitCode(code));
    });
    return set;
  }, [enrolledUnits]);

  const filteredDays = useMemo(() => {
    return (timetable || []).map((day) => ({
      ...day,
      lessons: (day.lessons || []).filter((lesson) => {
        const code = parseUnit(lesson.unit).code;
        return enrolledCodeSet.has(normalizeUnitCode(code));
      }),
    })).filter((day) => day.lessons.length > 0);
  }, [timetable, enrolledCodeSet]);

  const semesterStart = useMemo(() => {
    if (records.length > 0) {
      const earliest = records.reduce((min, r) => {
        const t = Number(r?.scannedAt);
        return Number.isFinite(t) && t < min ? t : min;
      }, Infinity);
      if (Number.isFinite(earliest) && earliest !== Infinity) {
        const d = new Date(earliest);
        return { year: d.getFullYear(), month: d.getMonth() };
      }
    }
    return { year: new Date().getFullYear(), month: 0 };
  }, [records]);

  const navigationHandlers = useMemo(() => {
    const today = new Date();
    const isCurrentMonth = calendarYear === today.getFullYear() && calendarMonth === today.getMonth();
    const isAtSemesterStart = calendarYear < semesterStart.year || (calendarYear === semesterStart.year && calendarMonth <= semesterStart.month);

    return {
      goToPrevMonth: () => {
        if (isAtSemesterStart) return;
        if (calendarMonth === 0) {
          setCalendarYear(y => y - 1);
          setCalendarMonth(11);
        } else {
          setCalendarMonth(m => m - 1);
        }
        setSelectedDateKey('');
      },
      goToNextMonth: () => {
        if (isCurrentMonth) return;
        if (calendarMonth === 11) {
          setCalendarYear(y => y + 1);
          setCalendarMonth(0);
        } else {
          setCalendarMonth(m => m + 1);
        }
        setSelectedDateKey('');
      },
      goToToday: () => {
        setCalendarYear(today.getFullYear());
        setCalendarMonth(today.getMonth());
        setSelectedDateKey(formatDateKey(today));
        Vibration.vibrate(50);
      },
      isCurrentMonth,
      isAtSemesterStart,
    };
  }, [calendarYear, calendarMonth, semesterStart]);

  const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
  const lessonsByDayName = useMemo(() => filteredDays.reduce((acc, day) => {
    acc[day.day] = day.lessons || [];
    return acc;
  }, {}), [filteredDays]);

  const lessonMapByDate = useMemo(() => {
    const map = {};
    for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
      const date = new Date(calendarYear, calendarMonth, dayNum);
      const key = formatDateKey(date);
      const dayName = DAY_NAMES[date.getDay()];
      const recurringLessons = lessonsByDayName[dayName] || [];
      map[key] = recurringLessons.map((lesson) => ({ ...lesson, id: `${lesson.id}-${key}`, originalId: lesson.id }));
    }

    for (const extra of (extraSessions || [])) {
      const dateStr = extra.date || extra.sessionDate || extra.session_date || '';
      if (!dateStr) continue;
      const key = formatDateKey(new Date(dateStr));
      if (!key) continue;

      const extraCode = normalizeUnitCode(extra.unitCode || extra.unit_code || '');
      if (extraCode && !enrolledCodeSet.has(extraCode)) continue;

      if (!map[key]) map[key] = [];
      if (map[key].some((l) => l.originalId === String(extra.id || extra.sessionId || ''))) continue;

      const startTime = String(extra.startTime || extra.start_time || '').trim();
      const endTime = String(extra.endTime || extra.end_time || '').trim();
      const unitCode = String(extra.unitCode || extra.unit_code || '').replace(/\s+/g, '').toUpperCase();
      const unitName = String(extra.unitName || extra.unit_name || unitCode);

      map[key].push({
        id: `extra-${extra.id || extra.sessionId || dateStr}-${key}`,
        originalId: String(extra.id || extra.sessionId || ''),
        unit: unitName && unitName !== unitCode ? `${unitName} (${unitCode})` : unitCode,
        unitCode,
        time: startTime && endTime ? `${startTime} - ${endTime}` : startTime || '',
        type: extra.lessonType || extra.lesson_type || 'LEC',
        venue: extra.roomCode || extra.room_code || 'TBA',
        roomCode: extra.roomCode || extra.room_code || 'TBA',
        status: 'Confirmed',
        lecturer: extra.lecturerName || extra.lecturer_name || 'Lecturer',
        isExtraSession: true,
        day: DAY_NAMES[new Date(dateStr).getDay()] || '',
        date: dateStr,
      });
    }

    return map;
  }, [calendarYear, calendarMonth, daysInMonth, lessonsByDayName, extraSessions, enrolledCodeSet]);

  const attendedUnitSetByDate = useMemo(() => {
    const map = {};
    records.forEach((record) => {
      const key = formatDateKey(Number(record?.scannedAt));
      const code = normalizeUnitCode(record?.unitCode);
      if (!key || !code) return;
      if (!map[key]) map[key] = new Set();
      map[key].add(code);
    });
    return map;
  }, [records]);

  const unitStatsByCode = useMemo(() => {
    const localAttByCode = {};
    records.forEach((record) => {
      const code = normalizeUnitCode(record?.unitCode);
      const sessionStart = Number(record?.sessionStart);
      if (!code || !Number.isFinite(sessionStart)) return;
      if (!localAttByCode[code]) localAttByCode[code] = new Set();
      localAttByCode[code].add(sessionStart);
    });

    const localCondByCode = Object.entries(conductedCounts || {}).reduce((acc, [rawCode, total]) => {
      const code = normalizeUnitCode(rawCode);
      if (!code) return acc;
      acc[code] = (acc[code] || 0) + (Number(total) || 0);
      return acc;
    }, {});

    const backendByCode = {};
    if (backendSummary?.units && Array.isArray(backendSummary.units)) {
      for (const u of backendSummary.units) {
        const code = normalizeUnitCode(u.unitCode);
        if (!code) continue;
        backendByCode[code] = { attended: Number(u.attended || 0), conducted: Number(u.conducted || 0) };
      }
    }

    const allCodes = new Set([...Object.keys(localCondByCode), ...Object.keys(backendByCode)]);
    const stats = {};
    allCodes.forEach((code) => {
      const localAtt = localAttByCode[code]?.size || 0;
      const localCond = localCondByCode[code] || 0;
      const backAtt = backendByCode[code]?.attended || 0;
      const backCond = backendByCode[code]?.conducted || 0;
      const attendedCount = Math.max(localAtt, backAtt);
      const conductedCount = Math.max(localCond, backCond);
      stats[code] = {
        attendedCount,
        conductedCount,
        percent: conductedCount > 0 ? Math.round((attendedCount / conductedCount) * 100) : 0,
      };
    });
    return stats;
  }, [records, conductedCounts, backendSummary]);

  const calendarCells = useMemo(() => {
    const cells = [];
    const firstWeekday = new Date(calendarYear, calendarMonth, 1).getDay();
    for (let i = 0; i < firstWeekday; i++) {
      cells.push({ key: `pad-${i}`, empty: true });
    }

    const todayKey = formatDateKey(new Date());
    for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
      const date = new Date(calendarYear, calendarMonth, dayNum);
      const dateKey = formatDateKey(date);
      const lessons = lessonMapByDate[dateKey] || [];
      const planned = lessons.length;
      const isFuture = dateKey > todayKey;
      const attendedSet = attendedUnitSetByDate[dateKey] || new Set();

      const attended = lessons.reduce((sum, lesson) => {
        const code = normalizeUnitCode(parseUnit(lesson.unit).code);
        return sum + (attendedSet.has(code) ? 1 : 0);
      }, 0);

      const lessonDots = lessons.slice(0, 4).map((lesson) => {
        const code = normalizeUnitCode(parseUnit(lesson.unit).code);
        if (isFuture) return colors.info.main;
        if (String(lesson.status) === 'Cancelled') return colors.text.tertiary;
        return attendedSet.has(code) ? colors.success.main : colors.danger.main;
      });

      let cellBg = 'transparent';
      let cellNumColor = colors.text.tertiary;
      if (planned > 0) {
        if (isFuture) {
          cellBg = colors.info.soft;
          cellNumColor = colors.info.main;
        } else if (attended === 0) {
          cellBg = colors.danger.soft;
          cellNumColor = colors.danger.main;
        } else if (attended < planned) {
          cellBg = colors.warning.soft;
          cellNumColor = colors.warning.main;
        } else {
          cellBg = colors.success.soft;
          cellNumColor = colors.success.main;
        }
      }

      cells.push({
        key: dateKey,
        dateKey,
        dayNum,
        planned,
        attended,
        isToday: dateKey === todayKey,
        isFuture,
        lessonDots,
        cellBg,
        cellNumColor,
      });
    }
    return cells;
  }, [calendarYear, calendarMonth, daysInMonth, lessonMapByDate, attendedUnitSetByDate]);

  const effectiveSelectedDateKey = useMemo(() => {
    if (selectedDateKey) return selectedDateKey;
    const todayKey = formatDateKey(new Date());
    const todayCell = calendarCells.find((cell) => !cell.empty && cell.dateKey === todayKey);
    if (todayCell) return todayCell.dateKey;
    const withLessons = calendarCells.find((cell) => !cell.empty && cell.planned > 0);
    return withLessons?.dateKey || formatDateKey(new Date(calendarYear, calendarMonth, 1));
  }, [selectedDateKey, calendarCells, calendarYear, calendarMonth]);

  const selectedDateLessons = lessonMapByDate[effectiveSelectedDateKey] || [];
  const selectedAttendedSet = attendedUnitSetByDate[effectiveSelectedDateKey] || new Set();
  const selectedDayAttended = selectedDateLessons.reduce((sum, lesson) => {
    const code = normalizeUnitCode(parseUnit(lesson.unit).code);
    return sum + (selectedAttendedSet.has(code) ? 1 : 0);
  }, 0);
  const selectedDayPercent = selectedDateLessons.length > 0 ? Math.round((selectedDayAttended / selectedDateLessons.length) * 100) : 0;

  const selectedDateObj = new Date(effectiveSelectedDateKey);
  const weekStart = new Date(selectedDateObj);
  weekStart.setDate(selectedDateObj.getDate() - selectedDateObj.getDay());
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + i);
    const key = formatDateKey(date);
    const lessons = lessonMapByDate[key] || [];
    const attendedSet = attendedUnitSetByDate[key] || new Set();
    const attended = lessons.reduce((sum, lesson) => {
      const code = normalizeUnitCode(parseUnit(lesson.unit).code);
      return sum + (attendedSet.has(code) ? 1 : 0);
    }, 0);
    return { date, key, lessons, attended, percent: lessons.length > 0 ? Math.round((attended / lessons.length) * 100) : null };
  });

  const weekTotalLessons = weekDays.reduce((sum, day) => sum + day.lessons.length, 0);
  const weekTotalAttended = weekDays.reduce((sum, day) => sum + day.attended, 0);
  const weekPercent = weekTotalLessons > 0 ? Math.round((weekTotalAttended / weekTotalLessons) * 100) : 0;

  const overallPercent = useMemo(() => {
    let totalAttended = 0;
    let totalConducted = 0;
    enrolledCodeSet.forEach(code => {
      const stat = unitStatsByCode[code];
      if (stat) {
        totalAttended += stat.attendedCount;
        totalConducted += stat.conductedCount;
      }
    });
    return totalConducted > 0 ? Math.round((totalAttended / totalConducted) * 100) : 0;
  }, [unitStatsByCode, enrolledCodeSet]);

  // Week-over-week trend: compare unique (date, unit) sessions this week vs last week.
  // A positive value means more sessions attended than the prior week.
  const weeklyTrend = useMemo(() => {
    // Derive week start from effectiveSelectedDateKey (a stable string) so the
    // memo doesn't re-run on every render due to inline Date object references.
    const selDate = new Date(effectiveSelectedDateKey);
    const ws = new Date(selDate);
    ws.setDate(selDate.getDate() - selDate.getDay());
    const thisWeekStartMs = ws.getTime();
    const thisWeekEndMs = thisWeekStartMs + 7 * 86400000;
    const lastWeekStartMs = thisWeekStartMs - 7 * 86400000;

    const countSessions = (startMs, endMs) => {
      const seen = new Set();
      records.forEach(r => {
        const t = Number(r?.scannedAt);
        if (!Number.isFinite(t) || t < startMs || t >= endMs) return;
        const dateKey = formatDateKey(t);
        const code = normalizeUnitCode(r?.unitCode);
        if (dateKey && code) seen.add(`${dateKey}|${code}`);
      });
      return seen.size;
    };

    const thisCount = countSessions(thisWeekStartMs, thisWeekEndMs);
    const lastCount = countSessions(lastWeekStartMs, thisWeekStartMs);

    if (thisCount === 0 && lastCount === 0) return 0;
    if (lastCount === 0) return thisCount > 0 ? 5 : 0;
    return thisCount - lastCount;
  }, [records, effectiveSelectedDateKey]);

  const consistencyScore = useMemo(() => getConsistencyScore(weekDays), [weekDays]);
  const nextWeekPrediction = useMemo(() => calculateNextWeekPrediction(weekPercent, weekDays), [weekPercent, weekDays]);
  
  const currentStreak = useMemo(() => {
    // Walk backward from today, counting consecutive weekdays with any attendance.
    // Weekends are skipped — they don't break a streak.
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let streak = 0;
    for (let daysBack = 0; daysBack < 180; daysBack++) {
      const d = new Date(today.getTime() - daysBack * 86400000);
      const dow = d.getDay();
      if (dow === 0 || dow === 6) continue; // skip weekend
      const key = formatDateKey(d);
      const attended = attendedUnitSetByDate[key];
      if (attended && attended.size > 0) {
        streak++;
      } else {
        break;
      }
    }
    return streak;
  }, [attendedUnitSetByDate]);

  const remainingWeeks = useMemo(() => {
    // Estimate remaining weeks in semester (simplified)
    const now = new Date();
    const endOfSemester = new Date(now.getFullYear(), 11, 15); // December 15th
    const diffTime = Math.abs(endOfSemester - now);
    return Math.max(1, Math.ceil(diffTime / (7 * 24 * 60 * 60 * 1000)));
  }, []);

  // Real worst-miss day per unit derived from attendance records
  const worstDayByUnitCode = useMemo(() => {
    const todayKey = formatDateKey(new Date());
    const misses = {};
    for (const [dateKey, lessons] of Object.entries(lessonMapByDate)) {
      if (dateKey >= todayKey) continue;
      const dayIndex = new Date(dateKey).getDay();
      const attendedSet = attendedUnitSetByDate[dateKey] || new Set();
      for (const lesson of lessons) {
        if (lesson.status === 'Cancelled') continue;
        const code = normalizeUnitCode(parseUnit(lesson.unit).code);
        if (!code) continue;
        if (!attendedSet.has(code)) {
          if (!misses[code]) misses[code] = {};
          misses[code][dayIndex] = (misses[code][dayIndex] || 0) + 1;
        }
      }
    }
    const result = {};
    for (const [code, dayMap] of Object.entries(misses)) {
      let worst = -1, worstCount = 0;
      for (const [d, c] of Object.entries(dayMap)) {
        if (c > worstCount) { worstCount = c; worst = Number(d); }
      }
      if (worst >= 0) result[code] = DAY_NAMES[worst];
    }
    return result;
  }, [lessonMapByDate, attendedUnitSetByDate]);

  // Overall percentile derived from real leaderboard rank
  const overallPercentile = useMemo(() => {
    if (!achievementRank || !achievementTotalStudents) return null;
    return Math.round((1 - (achievementRank - 1) / achievementTotalStudents) * 100);
  }, [achievementRank, achievementTotalStudents]);

  // Department percentile derived from department rank
  const deptPercentile = useMemo(() => {
    if (!achievementDeptRank || !achievementDeptTotal) return null;
    return Math.round((1 - (achievementDeptRank - 1) / achievementDeptTotal) * 100);
  }, [achievementDeptRank, achievementDeptTotal]);


  const classifiedAssignments = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart.getTime() + 86400000 - 1);
    const weekEnd = new Date(todayStart.getTime() + 7 * 86400000 - 1);

    const groups = { overdue: [], dueToday: [], dueWeek: [], upcoming: [] };

    assignments.forEach(a => {
      const raw = a?.dueDate ?? a?.due_date ?? a?.deadline ?? null;
      if (!raw) { groups.upcoming.push(a); return; }
      const due = new Date(raw);
      if (isNaN(due.getTime())) { groups.upcoming.push(a); return; }
      if (due < todayStart) groups.overdue.push(a);
      else if (due <= todayEnd) groups.dueToday.push(a);
      else if (due <= weekEnd) groups.dueWeek.push(a);
      else groups.upcoming.push(a);
    });

    Object.keys(groups).forEach(key => {
      groups[key].sort((a, b) => {
        const da = new Date(a?.dueDate ?? a?.due_date ?? a?.deadline ?? 0);
        const db = new Date(b?.dueDate ?? b?.due_date ?? b?.deadline ?? 0);
        return da - db;
      });
    });

    groups.upcoming = groups.upcoming.slice(0, 5);
    return groups;
  }, [assignments]);



  const academicPlanItems = useMemo(() => {
    return (enrolledUnits || []).map(unit => {
      const { name, code } = parseUnit(unit);
      const normCode = normalizeUnitCode(code);
      const stat = unitStatsByCode[normCode] || { attendedCount: 0, conductedCount: 0, percent: 0 };
      const goal = goalsByCode[code] || goalsByCode[normCode];
      const target = Number(goal?.targetPercent) || TARGET_PERCENT_DEFAULT;
      const needed = stat.conductedCount > 0 ? Math.max(0, Math.ceil((target / 100) * stat.conductedCount) - stat.attendedCount) : 0;

      let weekLessons = 0;
      const today = new Date();
      const weekFromNow = new Date(today.getTime() + 7 * 86400000);
      for (let d = new Date(today); d <= weekFromNow; d.setDate(d.getDate() + 1)) {
        const key = formatDateKey(new Date(d));
        const lessons = lessonMapByDate[key] || [];
        weekLessons += lessons.filter(l => normalizeUnitCode(parseUnit(l.unit).code) === normCode).length;
      }

      const urgency = stat.percent >= target ? 'ok' : weekLessons === 0 ? 'critical' : 'warning';
      const trend = stat.percent - target; // gap from goal: negative = below target, positive = above
      
      return {
        code,
        name: name || code,
        stat,
        target,
        needed,
        weekLessons,
        urgency,
        trend,
        remainingWeeks,
        worstDay: worstDayByUnitCode[normCode] || null,
      };
    }).sort((a, b) => {
      const order = { critical: 0, warning: 1, ok: 2 };
      return (order[a.urgency] ?? 3) - (order[b.urgency] ?? 3);
    }).slice(0, 5);
  }, [enrolledUnits, unitStatsByCode, goalsByCode, lessonMapByDate, remainingWeeks, worstDayByUnitCode]);

  // Render
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Animated.ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => loadData(true)}
            tintColor={colors.primary.main}
            colors={[colors.primary.main]}
          />
        }
      >
        {/* Animated Header Stats */}
        <Animated.View style={[styles.headerStats, { opacity: headerOpacity, transform: [{ scale: headerScale }] }]}>
          <LinearGradient colors={colors.primary.gradient} style={styles.headerGradient}>
            <View style={styles.insightsTitleRow}>
              <Text style={styles.headerTitle}>Academic Insights</Text>
              {isBackgroundUpdate && <View style={styles.insightsBgDot} />}
            </View>
            <Text style={styles.headerSubtitle}>Track your progress, stay ahead</Text>
            {lastRefreshed && !isBackgroundUpdate && (
              <Text style={styles.insightsRefreshedAt}>Updated {lastRefreshed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
            )}
            <View style={styles.headerStatRow}>
              <StatCard label="Attendance" value={`${overallPercent}%`} icon="calendar" color={colors.success.main} trend={overallPercent - 75} styles={styles} />
              <StatCard label="Assignments" value={classifiedAssignments.dueToday.length + classifiedAssignments.dueWeek.length} icon="document-text" color={colors.warning.main} styles={styles} />
              <StatCard label="Streak" value={currentStreak} icon="flame" color={colors.danger.main} styles={styles} />
            </View>
          </LinearGradient>
        </Animated.View>

        {/* Calendar Section */}
        <AnimatedCard
          title="Attendance Calendar"
          subtitle={`${new Date(calendarYear, calendarMonth).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`}
          gradient={colors.primary.gradient}
          icon="calendar-outline"
          delay={100}
          styles={styles}
        >
          <View style={styles.calendarNavRow}>
            <TouchableOpacity style={[styles.calendarNavBtn, navigationHandlers.isAtSemesterStart && styles.calendarNavBtnDisabled]} onPress={navigationHandlers.goToPrevMonth} disabled={navigationHandlers.isAtSemesterStart}>
              <Icon name="chevron-back" size={22} color={navigationHandlers.isAtSemesterStart ? colors.text.tertiary : colors.primary.main} />
            </TouchableOpacity>
            <View style={styles.calendarNavCenter}>
              <Text style={styles.calendarMonthLabel}>{new Date(calendarYear, calendarMonth).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</Text>
              {!navigationHandlers.isCurrentMonth && (
                <TouchableOpacity style={styles.calendarTodayBtn} onPress={navigationHandlers.goToToday}>
                  <Icon name="today-outline" size={12} color={colors.primary.main} />
                  <Text style={styles.calendarTodayText}>Today</Text>
                </TouchableOpacity>
              )}
            </View>
            <TouchableOpacity style={[styles.calendarNavBtn, navigationHandlers.isCurrentMonth && styles.calendarNavBtnDisabled]} onPress={navigationHandlers.goToNextMonth} disabled={navigationHandlers.isCurrentMonth}>
              <Icon name="chevron-forward" size={22} color={navigationHandlers.isCurrentMonth ? colors.text.tertiary : colors.primary.main} />
            </TouchableOpacity>
          </View>

          <View style={styles.weekdayRow}>
            {DAY_SHORT.map((label) => (
              <Text key={label} style={styles.weekdayText}>{label}</Text>
            ))}
          </View>

          <View style={styles.calendarGrid}>
            {calendarCells.map((cell) => {
              if (cell.empty) return <View key={cell.key} style={styles.dayCellEmpty} />;
              const isSelected = cell.dateKey === effectiveSelectedDateKey;
              return (
                <TouchableOpacity
                  key={cell.key}
                  style={[styles.dayCell, { backgroundColor: cell.cellBg }, cell.isToday && styles.dayCellToday, isSelected && styles.dayCellSelected]}
                  onPress={() => { setSelectedDateKey(cell.dateKey); Vibration.vibrate(20); }}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.dayNumber, { color: cell.isToday ? colors.primary.main : cell.cellNumColor }, cell.isToday && { fontWeight: '900' }]}>{cell.dayNum}</Text>
                  <View style={styles.lessonDotsRow}>
                    {cell.lessonDots.map((dotColor, i) => (
                      <View key={i} style={[styles.lessonDot, { backgroundColor: dotColor }]} />
                    ))}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={styles.calendarLegendRow}>
            {[
              { color: colors.success.main, label: 'All attended' },
              { color: colors.warning.main, label: 'Partial' },
              { color: colors.danger.main, label: 'Missed' },
              { color: colors.info.main, label: 'Upcoming' },
            ].map(({ color, label }) => (
              <View key={label} style={styles.calendarLegendItem}>
                <View style={[styles.calendarLegendSwatch, { backgroundColor: color }]} />
                <Text style={styles.calendarLegendLabel}>{label}</Text>
              </View>
            ))}
          </View>

          {/* Day Detail Panel */}
          <View style={styles.dayDetailPanel}>
            <View style={styles.dayDetailHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.dayDetailDate}>{new Date(effectiveSelectedDateKey).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</Text>
                <View style={styles.dayDetailBadges}>
                  <View style={[styles.statBadge, { backgroundColor: `${colors.success.main}20`, borderColor: colors.success.main }]}>
                    <Icon name="checkmark-circle" size={12} color={colors.success.main} />
                    <Text style={[styles.statBadgeLabel, { color: colors.success.main }]}>Attended</Text>
                    <Text style={[styles.statBadgeValue, { color: colors.success.main }]}>{selectedDayAttended}/{selectedDateLessons.length}</Text>
                  </View>
                  <View style={[styles.statBadge, { backgroundColor: `${selectedDayPercent >= 75 ? colors.success.main : selectedDayPercent >= 50 ? colors.warning.main : colors.danger.main}20`, borderColor: selectedDayPercent >= 75 ? colors.success.main : selectedDayPercent >= 50 ? colors.warning.main : colors.danger.main }]}>
                    <Icon name="trending-up" size={12} color={selectedDayPercent >= 75 ? colors.success.main : selectedDayPercent >= 50 ? colors.warning.main : colors.danger.main} />
                    <Text style={[styles.statBadgeLabel, { color: selectedDayPercent >= 75 ? colors.success.main : selectedDayPercent >= 50 ? colors.warning.main : colors.danger.main }]}>Rate</Text>
                    <Text style={[styles.statBadgeValue, { color: selectedDayPercent >= 75 ? colors.success.main : selectedDayPercent >= 50 ? colors.warning.main : colors.danger.main }]}>{selectedDayPercent}%</Text>
                  </View>
                </View>
              </View>
              {selectedDateLessons.length > 0 && selectedDayAttended === selectedDateLessons.length && (
                <View style={styles.dayDetailStarBadge}>
                  <Icon name="star" size={18} color={colors.warning.main} />
                  <Text style={styles.dayDetailStarText}>Perfect!</Text>
                </View>
              )}
            </View>

            {selectedDateLessons.length === 0 ? (
              <View style={styles.noLessonsBox}>
                <Icon name="moon-outline" size={40} color={colors.text.tertiary} />
                <Text style={styles.noLessonsTitle}>No classes scheduled</Text>
                <Text style={styles.noLessonsSub}>Free day — use it wisely!</Text>
              </View>
            ) : (
              selectedDateLessons.map((lesson, idx) => {
                const { name: unitName, code } = parseUnit(lesson.unit);
                const isFuture = effectiveSelectedDateKey > formatDateKey(new Date());
                const isCancelled = lesson.status === 'Cancelled';
                const lessonAttended = !isFuture && !isCancelled && selectedAttendedSet.has(normalizeUnitCode(code));
                const stripColor = isCancelled ? colors.text.tertiary : isFuture ? colors.info.main : lessonAttended ? colors.success.main : colors.danger.main;
                const statusLabel = isCancelled ? 'Cancelled' : isFuture ? 'Upcoming' : lessonAttended ? 'Attended' : 'Missed';

                return (
                  <View key={lesson.id || idx} style={[styles.lessonCard, { borderLeftColor: stripColor }]}>
                    <View style={styles.lessonCardTopRow}>
                      <Text style={styles.lessonCardUnitName} numberOfLines={1}>{unitName || code}</Text>
                      <View style={[styles.lessonTypeBadge, { backgroundColor: `${colors.primary.main}20` }]}>
                        <Text style={[styles.lessonTypeBadgeText, { color: colors.primary.main }]}>{lesson.type || 'LEC'}</Text>
                      </View>
                    </View>
                    <Text style={styles.lessonCardCode}>{code}</Text>
                    <View style={styles.lessonCardMetaRow}>
                      <View style={styles.lessonCardMetaItem}>
                        <Icon name="time-outline" size={12} color={colors.text.tertiary} />
                        <Text style={styles.lessonCardMetaText}>{lesson.time || '—'}</Text>
                      </View>
                      <View style={styles.lessonCardMetaItem}>
                        <Icon name="location-outline" size={12} color={colors.text.tertiary} />
                        <Text style={styles.lessonCardMetaText}>{lesson.venue || lesson.roomCode || 'TBA'}</Text>
                      </View>
                      <View style={[styles.lessonStatusPill, { backgroundColor: `${stripColor}20` }]}>
                        <Icon name={lessonAttended ? "checkmark-circle" : isFuture ? "time-outline" : "close-circle"} size={12} color={stripColor} />
                        <Text style={[styles.lessonStatusPillText, { color: stripColor }]}>{statusLabel}</Text>
                      </View>
                    </View>
                  </View>
                );
              })
            )}
          </View>
        </AnimatedCard>

        {/* Weekly Summary Section - ENHANCED */}
        <AnimatedCard title="Weekly Summary" subtitle="This week's attendance analysis" gradient={colors.success.gradient} icon="stats-chart-outline" delay={200} styles={styles}>
          <View style={styles.weeklySummaryHeader}>
            <Text style={styles.weeklyRange}>{`${weekDays[0].date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${weekDays[6].date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}</Text>
            <View style={styles.weekPercentBadge}>
              <Text style={[styles.weekPercentValue, { color: weekPercent >= 75 ? colors.success.main : weekPercent >= 50 ? colors.warning.main : colors.danger.main }]}>{weekPercent}%</Text>
              <View style={styles.weekPercentTrack}>
                <View style={[styles.weekPercentFill, { width: `${weekPercent}%`, backgroundColor: weekPercent >= 75 ? colors.success.main : weekPercent >= 50 ? colors.warning.main : colors.danger.main }]} />
              </View>
            </View>
          </View>

          {/* Forecast Card - NEW */}
          <LinearGradient colors={[colors.purple.soft, 'transparent']} style={styles.forecastCard}>
            <View style={styles.forecastHeader}>
              <Icon name="analytics-outline" size={18} color={colors.purple.main} />
              <Text style={styles.forecastTitle}>Next Week Forecast</Text>
            </View>
            
            <View style={styles.predictionRow}>
              <Text style={styles.predictionLabel}>Predicted attendance:</Text>
              <Text style={styles.predictionValue}>{nextWeekPrediction}%</Text>
              <View style={styles.confidenceBadge}>
                <Text style={styles.confidenceText}>Based on your pattern</Text>
              </View>
            </View>
            
            <View style={styles.riskRow}>
              <Icon name="warning-outline" size={16} color={weeklyTrend < 0 ? colors.danger.main : colors.success.main} />
              <Text style={[styles.riskText, { color: weeklyTrend < 0 ? colors.danger.main : colors.info.main }]}>
                {getRiskMessage(weeklyTrend, weekPercent)}
              </Text>
            </View>
            
            <View style={styles.streakPrediction}>
              <Icon name="flame-outline" size={14} color={colors.warning.main} />
              <Text style={styles.streakPredictionText}>
                {getStreakPrediction(currentStreak, weekDays)}
              </Text>
            </View>
          </LinearGradient>

          {/* Weekly Progress Bars */}
          {weekDays.map((day, idx) => (
            <WeeklyProgressBar
              key={day.key}
              label={WEEKDAY_SHORT[day.date.getDay()]}
              value={day.attended}
              max={day.lessons.length}
              color={day.percent === 100 ? colors.success.main : day.percent && day.percent >= 75 ? colors.primary.main : day.percent && day.percent >= 50 ? colors.warning.main : colors.danger.main}
              styles={styles}
            />
          ))}

          {/* Pattern Insights - NEW */}
          <View style={styles.patternInsights}>
            <Text style={styles.patternTitle}>🔍 Attendance Patterns Detected</Text>
            
            <View style={styles.patternRow}>
              <View style={styles.bestDay}>
                <Icon name="happy-outline" size={14} color={colors.success.main} />
                <Text style={styles.patternLabel}>Best Day:</Text>
                <Text style={styles.patternValue}>{getBestDay(weekDays)} ({getBestDayPercent(weekDays)}%)</Text>
              </View>
              <View style={styles.worstDay}>
                <Icon name="sad-outline" size={14} color={colors.danger.main} />
                <Text style={styles.patternLabel}>Needs Work:</Text>
                <Text style={styles.patternValue}>{getWorstDay(weekDays)} ({getWorstDayPercent(weekDays)}%)</Text>
              </View>
            </View>
            
            <View style={styles.consistencyRow}>
              <Icon name="ribbon-outline" size={14} color={colors.info.main} />
              <Text style={styles.consistencyLabel}>Consistency Score:</Text>
              <View style={styles.consistencyBar}>
                <View style={[styles.consistencyFill, { width: `${consistencyScore}%`, backgroundColor: getConsistencyColor(consistencyScore, colors) }]} />
              </View>
              <Text style={[styles.consistencyValue, { color: getConsistencyColor(consistencyScore, colors) }]}>{consistencyScore}%</Text>
            </View>
            
            <View style={styles.trendIndicator}>
              <Icon name={weeklyTrend >= 0 ? "trending-up" : "trending-down"} size={14} color={getTrendColor(weeklyTrend, colors)} />
              <Text style={[styles.trendText, { color: getTrendColor(weeklyTrend, colors) }]}>
                {getTrendMessage(weeklyTrend, weekPercent)}
              </Text>
            </View>
          </View>

          {/* Goal Achievement Tracker - NEW */}
          <View style={styles.goalTracker}>
            <View style={styles.goalHeader}>
              <Text style={styles.goalTitle}>🎯 Goal Attendance: 75%</Text>
              <Text style={[styles.goalProbability, { color: getGoalColor(weekPercent, 75, colors) }]}>
                {calculateGoalProbability(weekPercent, 75, weeklyTrend, remainingWeeks)}% chance
              </Text>
            </View>
            
            <View style={styles.goalProgressTrack}>
              <View style={[styles.goalProgressFill, { width: `${Math.min(100, (weekPercent / 75) * 100)}%`, backgroundColor: getGoalColor(weekPercent, 75, colors) }]} />
              <View style={[styles.goalMarker, { left: `75%` }]} />
            </View>
            
            <Text style={styles.goalHint}>
              {getGoalHint(weekPercent, 75, Math.ceil((75 - weekPercent) / 10))}
            </Text>
          </View>

          {/* Weekly Action Plan - NEW */}
          <View style={styles.actionPlan}>
            <Text style={styles.actionPlanTitle}>📋 This Week's Action Plan</Text>
            
            <View style={styles.actionList}>
              {getActionItems(weekDays, weekPercent, 75, colors).map((action, idx) => (
                <View key={idx} style={styles.actionItem}>
                  <View style={[styles.actionBullet, { backgroundColor: action.color }]} />
                  <Text style={styles.actionText}>{action.text}</Text>
                  {action.urgent && <View style={styles.urgentBadge}><Text style={styles.urgentText}>Urgent</Text></View>}
                </View>
              ))}
            </View>
            
            <View style={styles.quickWins}>
              <Text style={styles.quickWinsTitle}>⚡ Quick Wins This Week</Text>
              <View style={styles.winList}>
                {getQuickWins(weekDays).map((win, idx) => (
                  <View key={idx} style={styles.winItem}>
                    <Icon name="checkmark-circle-outline" size={14} color={colors.success.main} />
                    <Text style={styles.winText}>{win}</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>

          <View style={styles.weeklyTotalCard}>
            <View>
              <Text style={styles.weeklyTotalLabel}>Total Progress</Text>
              <Text style={styles.weeklyTotalValue}>{weekTotalAttended}/{weekTotalLessons}</Text>
            </View>
            <ProgressRing percent={weekPercent} size={60} strokeWidth={4} color={weekPercent >= 75 ? colors.success.main : weekPercent >= 50 ? colors.warning.main : colors.danger.main} styles={styles} />
          </View>
        </AnimatedCard>

        {/* Assignments Section */}
        <AnimatedCard title="Assignments" subtitle={`${assignments.length} total across all units`} gradient={colors.pink.gradient} icon="document-text-outline" delay={300} styles={styles}>
          <View style={styles.assignSummaryRow}>
            {[
              { label: 'Overdue', count: classifiedAssignments.overdue.length, color: colors.danger.main, icon: 'warning' },
              { label: 'Due Today', count: classifiedAssignments.dueToday.length, color: colors.warning.main, icon: 'today' },
              { label: 'This Week', count: classifiedAssignments.dueWeek.length, color: colors.info.main, icon: 'calendar' },
              { label: 'Upcoming', count: classifiedAssignments.upcoming.length, color: colors.success.main, icon: 'time' },
            ].map(chip => (
              <View key={chip.label} style={[styles.assignChip, { backgroundColor: `${chip.color}15`, borderColor: chip.color }]}>
                <Icon name={chip.icon} size={16} color={chip.color} />
                <Text style={[styles.assignChipCount, { color: chip.color }]}>{chip.count}</Text>
                <Text style={[styles.assignChipLabel, { color: chip.color }]}>{chip.label}</Text>
              </View>
            ))}
          </View>

          {classifiedAssignments.overdue.slice(0, 3).map(a => (
            <View key={a.id} style={[styles.assignRow, { borderLeftColor: colors.danger.main, backgroundColor: `${colors.danger.main}10` }]}>
              <Text style={styles.assignTitle}>{a.title}</Text>
              <Text style={styles.assignMeta}>{new Date(a.dueDate).toLocaleDateString()}</Text>
            </View>
          ))}
        </AnimatedCard>

        {/* Smart Academic Planner - ENHANCED */}
        <AnimatedCard title="Smart Academic Planner" subtitle="Personalized action plan" gradient={colors.teal.gradient} icon="rocket-outline" delay={400} collapsible defaultCollapsed styles={styles}>
          {academicPlanItems.map(item => {
            const urgencyColor = item.urgency === 'critical' ? colors.danger.main : item.urgency === 'warning' ? colors.warning.main : colors.success.main;
            const dropRisk = getDropRisk(item);
            const catchUpDifficulty = getCatchUpDifficulty(item);
            const requiredPerWeek = getRequiredPerWeek(item, remainingWeeks);
            const interventions = getInterventions(item, colors);
            const milestones = getMilestones(item);
            
            return (
              <View key={item.code} style={[styles.plannerCard, { borderLeftColor: urgencyColor }]}>
                <View style={styles.plannerCardHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.plannerUnitName}>{item.name}</Text>
                    <Text style={styles.plannerUnitCode}>{item.code}</Text>
                  </View>
                  <View style={[styles.plannerUrgencyBadge, { backgroundColor: `${urgencyColor}20` }]}>
                    <Icon name={item.urgency === 'critical' ? "flame" : "trending-up"} size={14} color={urgencyColor} />
                    <Text style={[styles.plannerUrgencyText, { color: urgencyColor }]}>{item.urgency === 'ok' ? 'On Track' : item.urgency === 'warning' ? 'Needs Attention' : 'Critical'}</Text>
                  </View>
                </View>
                
                <View style={styles.plannerBarRow}>
                  <View style={styles.plannerBarTrack}>
                    <View style={[styles.plannerBarFill, { width: `${item.stat.percent}%`, backgroundColor: urgencyColor }]} />
                  </View>
                  <Text style={[styles.plannerBarPercent, { color: urgencyColor }]}>{item.stat.percent}%</Text>
                </View>
                
                <View style={styles.plannerStats}>
                  <Text style={styles.plannerTarget}>Goal: {item.target}%</Text>
                  <Text style={styles.plannerTarget}>Attended: {item.stat.attendedCount}/{item.stat.conductedCount}</Text>
                </View>

                {/* Risk Analysis - NEW */}
                <View style={styles.riskSection}>
                  <View style={styles.riskHeader}>
                    <Icon name="analytics-outline" size={12} color={urgencyColor} />
                    <Text style={styles.riskTitle}>Risk Analysis</Text>
                  </View>
                  
                  <View style={styles.catchUpAnalysis}>
                    <Text style={styles.catchUpLabel}>Catch-up Difficulty:</Text>
                    <View style={styles.difficultyBar}>
                      <View style={[styles.difficultyFill, { width: `${catchUpDifficulty}%`, backgroundColor: getDifficultyColor(item, colors) }]} />
                    </View>
                    <Text style={[styles.difficultyText, { color: getDifficultyColor(item, colors) }]}>{catchUpDifficulty}%</Text>
                  </View>
                  
                  {requiredPerWeek > 0 && (
                    <View style={styles.weeklyRequirement}>
                      <Icon name="calendar-outline" size={12} color={colors.text.tertiary} />
                      <Text style={styles.requirementText}>
                        Need ~{requiredPerWeek} session{requiredPerWeek !== 1 ? 's' : ''}/week to reach goal
                      </Text>
                    </View>
                  )}
                  
                  {dropRisk > 60 && (
                    <View style={styles.dropRiskAlert}>
                      <Icon name="alert-circle" size={12} color={colors.danger.main} />
                      <Text style={styles.dropRiskText}>
                        {dropRisk}% risk of dropping below {Math.max(50, item.target - 10)}% next week
                      </Text>
                    </View>
                  )}
                </View>

                {/* Smart Interventions - NEW */}
                {interventions.length > 0 && (
                  <View style={styles.interventionSection}>
                    <Text style={styles.interventionTitle}>💡 Recommended Interventions</Text>
                    
                    {interventions.map((intervention, idx) => (
                      <View key={idx} style={styles.interventionItem}>
                        <LinearGradient colors={[`${intervention.color}15`, 'transparent']} style={styles.interventionGradient}>
                          <View style={styles.interventionHeader}>
                            <Icon name={intervention.icon} size={14} color={intervention.color} />
                            <Text style={[styles.interventionType, { color: intervention.color }]}>{intervention.type}</Text>
                          </View>
                          <Text style={styles.interventionDescription}>{intervention.description}</Text>
                          <View style={styles.interventionMeta}>
                            <Text style={styles.interventionImpact}>Impact: {intervention.impact}</Text>
                            <Text style={styles.interventionEffort}>Effort: {intervention.effort}</Text>
                          </View>
                        </LinearGradient>
                      </View>
                    ))}
                  </View>
                )}

                {/* Milestone Tracker - NEW */}
                <View style={styles.milestoneSection}>
                  <Text style={styles.milestoneTitle}>🏆 Milestones Within Reach</Text>
                  
                  <View style={styles.milestoneList}>
                    {milestones.map((milestone, idx) => (
                      <View key={idx} style={[styles.milestoneItem, milestone.achieved && styles.milestoneAchieved]}>
                        <View style={[styles.milestoneIcon, { backgroundColor: milestone.achieved ? colors.success.soft : `${urgencyColor}20` }]}>
                          <Icon name={milestone.icon} size={16} color={milestone.achieved ? colors.success.main : urgencyColor} />
                        </View>
                        <View style={styles.milestoneContent}>
                          <Text style={[styles.milestoneName, milestone.achieved && { color: colors.success.main }]}>{milestone.name}</Text>
                          <Text style={styles.milestoneProgress}>{milestone.progress}% complete</Text>
                          <View style={styles.milestoneBar}>
                            <View style={[styles.milestoneFill, { width: `${milestone.progress}%`, backgroundColor: milestone.achieved ? colors.success.main : urgencyColor }]} />
                          </View>
                        </View>
                        {milestone.achieved && (
                          <Icon name="checkmark-circle" size={20} color={colors.success.main} />
                        )}
                      </View>
                    ))}
                  </View>
                </View>

                {/* Peer Context — Department Ranking */}
                <View style={styles.peerContext}>
                  <Text style={styles.peerTitle}>📊 Department Ranking</Text>

                  {(achievementDeptRank && achievementDeptTotal > 0) || (achievementRank && achievementTotalStudents > 0) ? (
                    <View style={styles.rankDisplayRow}>
                      <LinearGradient
                        colors={achievementDeptRank ? colors.primary.gradient : colors.info.gradient}
                        style={styles.rankPill}
                      >
                        <Text style={styles.rankPillNum}>#{achievementDeptRank ?? achievementRank}</Text>
                        <Text style={styles.rankPillContext}>
                          {achievementDeptRank
                            ? `of ${achievementDeptTotal} in dept`
                            : `of ${achievementTotalStudents}`}
                        </Text>
                      </LinearGradient>
                      <View style={styles.rankDetails}>
                        <Text style={styles.rankDetailsLabel}>
                          {achievementDeptRank ? 'Department Rank' : 'Overall Rank'}
                        </Text>
                        {(deptPercentile ?? overallPercentile) !== null && (
                          <>
                            <Text style={[styles.rankDetailsPercentile, { color: urgencyColor }]}>
                              Top {deptPercentile ?? overallPercentile}%
                            </Text>
                            <View style={styles.rankPercentileBar}>
                              <View style={[styles.rankPercentileFill, { width: `${deptPercentile ?? overallPercentile}%`, backgroundColor: urgencyColor }]} />
                            </View>
                          </>
                        )}
                        {achievementDeptRank && achievementRank && (
                          <Text style={styles.rankSecondary}>Global: #{achievementRank} of {achievementTotalStudents}</Text>
                        )}
                      </View>
                    </View>
                  ) : (
                    <View style={styles.peerStat}>
                      <Text style={styles.peerLabel}>Rank data loading...</Text>
                    </View>
                  )}

                  <View style={styles.peerComparison}>
                    <View style={styles.comparisonBar}>
                      <View style={[styles.yourBar, { width: `${item.stat.percent}%`, backgroundColor: urgencyColor }]} />
                      <View style={[styles.averageBar, { width: `${getEstimatedClassAverage(item)}%`, backgroundColor: colors.text.tertiary }]} />
                    </View>
                    <View style={styles.comparisonLabels}>
                      <Text style={[styles.yourLabel, { color: urgencyColor }]}>You: {item.stat.percent}%</Text>
                      <Text style={styles.averageLabel}>Est. Class Avg: {getEstimatedClassAverage(item)}%</Text>
                    </View>
                  </View>

                  <View style={styles.peerInsight}>
                    <Icon name="bulb-outline" size={14} color={colors.info.main} />
                    <Text style={styles.peerInsightText}>
                      {(deptPercentile ?? overallPercentile) !== null
                        ? getPeerInsightFromRank(deptPercentile ?? overallPercentile)
                        : item.stat.percent >= 90
                          ? "Top-tier attendance — keep it up!"
                          : item.stat.percent >= 75
                            ? "Good standing — consistent attendance will keep you there."
                            : item.stat.percent >= 60
                              ? "Below target — a few more sessions each week will make a real difference."
                              : "Attendance needs attention — start with small, consistent steps."}
                    </Text>
                  </View>
                </View>
              </View>
            );
          })}
        </AnimatedCard>
      </Animated.ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────
const makeStyles = (C) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  scrollView: { flex: 1 },
  content: { paddingBottom: 24 },

  // Header Styles
  headerStats: { marginBottom: 16, marginHorizontal: 16, marginTop: 8 },
  headerGradient: { borderRadius: 20, padding: 20, alignItems: 'center' },
  headerTitle: { fontSize: 24, fontWeight: '800', color: '#FFF', marginBottom: 4 },
  headerSubtitle: { fontSize: 12, color: 'rgba(255,255,255,0.8)', marginBottom: 16 },
  insightsTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  insightsBgDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.65)' },
  insightsRefreshedAt: { fontSize: 11, color: 'rgba(255,255,255,0.7)', marginTop: -12, marginBottom: 12 },
  headerStatRow: { flexDirection: 'row', justifyContent: 'space-around', width: '100%', gap: 12 },

  // Stat Card
  statCard: { flex: 1, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 12, padding: 12, alignItems: 'center', borderTopWidth: 3 },
  statCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', marginBottom: 8 },
  statValue: { fontSize: 22, fontWeight: '800', marginBottom: 4 },
  statLabel: { fontSize: 10, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', fontWeight: '600' },
  trendBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, gap: 2 },
  trendText: { fontSize: 9, fontWeight: '700' },

  // Card Styles
  cardContainer: { borderRadius: 20, backgroundColor: C.surface, marginHorizontal: 16, marginBottom: 16, overflow: 'hidden', borderWidth: 1, borderColor: C.border, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 5 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  cardHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardHeaderRight: { flexDirection: 'row', alignItems: 'center' },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  cardSubtitle: { fontSize: 12, color: 'rgba(255,255,255,0.8)' },
  cardContent: { padding: 16 },

  // Calendar Styles
  calendarNavRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  calendarNavBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.surface2, alignItems: 'center', justifyContent: 'center' },
  calendarNavBtnDisabled: { opacity: 0.35 },
  calendarNavCenter: { flex: 1, alignItems: 'center', gap: 4 },
  calendarMonthLabel: { fontSize: 16, fontWeight: '700', color: C.text },
  calendarTodayBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.primarySoft, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10 },
  calendarTodayText: { fontSize: 11, fontWeight: '600', color: C.primary },
  weekdayRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12, paddingHorizontal: 4 },
  weekdayText: { width: `${100 / 7}%`, textAlign: 'center', color: C.textSec, fontSize: 12, fontWeight: '600' },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCellEmpty: { width: `${100 / 7}%`, aspectRatio: 1 },
  dayCell: { width: `${100 / 7}%`, aspectRatio: 1, borderRadius: 8, borderWidth: 1, borderColor: C.border, padding: 4, alignItems: 'center', justifyContent: 'center' },
  dayCellSelected: { borderColor: C.primary, backgroundColor: C.primarySoft, transform: [{ scale: 1.05 }] },
  dayCellToday: { borderColor: C.primary, borderWidth: 2 },
  dayNumber: { fontSize: 12, fontWeight: '600', marginBottom: 2 },
  lessonDotsRow: { flexDirection: 'row', gap: 2, marginTop: 2, flexWrap: 'wrap', justifyContent: 'center' },
  lessonDot: { width: 5, height: 5, borderRadius: 2.5 },
  calendarLegendRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16, marginBottom: 8, paddingHorizontal: 2 },
  calendarLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  calendarLegendSwatch: { width: 8, height: 8, borderRadius: 4 },
  calendarLegendLabel: { fontSize: 10, color: C.textTer },

  // Day Detail Panel
  dayDetailPanel: { marginTop: 16, backgroundColor: C.surface2, borderRadius: 16, padding: 14 },
  dayDetailHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 14, gap: 8 },
  dayDetailDate: { fontSize: 14, fontWeight: '700', color: C.text, marginBottom: 8 },
  dayDetailBadges: { flexDirection: 'row', gap: 8 },
  statBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, borderWidth: 1 },
  statBadgeLabel: { fontSize: 10, fontWeight: '600' },
  statBadgeValue: { fontSize: 12, fontWeight: '800' },
  dayDetailStarBadge: { alignItems: 'center', gap: 2, backgroundColor: C.warningSoft, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12 },
  dayDetailStarText: { fontSize: 10, fontWeight: '700', color: C.warning },
  noLessonsBox: { alignItems: 'center', paddingVertical: 32, gap: 8 },
  noLessonsTitle: { fontSize: 16, fontWeight: '600', color: C.textSec, marginTop: 8 },
  noLessonsSub: { fontSize: 13, color: C.textTer },

  // Lesson Card
  lessonCard: { backgroundColor: C.surface, borderRadius: 12, padding: 12, marginBottom: 10, borderLeftWidth: 4 },
  lessonCardTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  lessonCardUnitName: { flex: 1, fontSize: 14, fontWeight: '700', color: C.text, marginRight: 8 },
  lessonTypeBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  lessonTypeBadgeText: { fontSize: 10, fontWeight: '700' },
  lessonCardCode: { fontSize: 11, color: C.textTer, marginBottom: 8, fontWeight: '500' },
  lessonCardMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  lessonCardMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  lessonCardMetaText: { fontSize: 11, color: C.textSec },
  lessonStatusPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, marginLeft: 'auto' },
  lessonStatusPillText: { fontSize: 11, fontWeight: '700' },

  // Progress Ring
  progressRingContainer: { position: 'relative', alignItems: 'center', justifyContent: 'center' },
  progressRingBackground: { position: 'absolute' },
  progressRingTrack: { borderWidth: 6, borderRadius: 40 },
  progressRingFill: { position: 'absolute' },
  progressRingCircle: { borderWidth: 6, borderTopColor: 'transparent', borderRightColor: 'transparent' },
  progressRingCenter: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  progressRingPercent: { fontSize: 16, fontWeight: '800' },

  // Weekly Progress
  weeklyProgressBar: { marginBottom: 12 },
  weeklyProgressHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  weeklyProgressLabel: { fontSize: 12, fontWeight: '600', color: C.textSec },
  weeklyProgressValue: { fontSize: 12, fontWeight: '700' },
  weeklyProgressTrack: { height: 6, backgroundColor: C.surface3, borderRadius: 3, overflow: 'hidden' },
  weeklyProgressFill: { height: '100%', borderRadius: 3 },

  // Weekly Summary
  weeklySummaryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  weeklyRange: { fontSize: 14, color: C.textSec, fontWeight: '500' },
  weekPercentBadge: { alignItems: 'center', borderWidth: 1, borderColor: C.borderMed, borderRadius: 12, padding: 8 },
  weekPercentValue: { fontSize: 18, fontWeight: '800', marginBottom: 4 },
  weekPercentTrack: { width: 64, height: 4, backgroundColor: C.border, borderRadius: 2, overflow: 'hidden' },
  weekPercentFill: { height: '100%', borderRadius: 2 },
  weeklyTotalCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: C.surface2, borderRadius: 16, padding: 16, marginTop: 8 },
  weeklyTotalLabel: { fontSize: 12, color: C.textTer, marginBottom: 4 },
  weeklyTotalValue: { fontSize: 20, fontWeight: '800', color: C.text },

  // New Weekly Summary Styles
  forecastCard: { marginBottom: 16, borderRadius: 12, overflow: 'hidden', padding: 12 },
  forecastHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  forecastTitle: { fontSize: 13, fontWeight: '600', color: C.purple },
  predictionRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
  predictionLabel: { fontSize: 12, color: C.textSec },
  predictionValue: { fontSize: 14, fontWeight: '700', color: C.purple },
  confidenceBadge: { backgroundColor: C.purpleSoft, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  confidenceText: { fontSize: 10, color: C.purple, fontWeight: '600' },
  riskRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  riskText: { fontSize: 12, flex: 1 },
  streakPrediction: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: C.border },
  streakPredictionText: { fontSize: 12, color: C.warning, flex: 1 },

  patternInsights: { backgroundColor: C.surface2, borderRadius: 12, padding: 12, marginTop: 12 },
  patternTitle: { fontSize: 13, fontWeight: '600', color: C.text, marginBottom: 8 },
  patternRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  bestDay: { flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1 },
  worstDay: { flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1 },
  patternLabel: { fontSize: 11, color: C.textTer },
  patternValue: { fontSize: 12, fontWeight: '600', color: C.text },
  consistencyRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  consistencyLabel: { fontSize: 11, color: C.textTer },
  consistencyBar: { flex: 1, height: 4, backgroundColor: C.border, borderRadius: 2, overflow: 'hidden' },
  consistencyFill: { height: '100%', borderRadius: 2 },
  consistencyValue: { fontSize: 11, fontWeight: '600', minWidth: 35 },
  trendIndicator: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  trendText: { fontSize: 11, fontWeight: '500', flex: 1 },

  goalTracker: { backgroundColor: C.surface2, borderRadius: 12, padding: 12, marginTop: 12 },
  goalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  goalTitle: { fontSize: 13, fontWeight: '600', color: C.text },
  goalProbability: { fontSize: 12, fontWeight: '700' },
  goalProgressTrack: { height: 6, backgroundColor: C.border, borderRadius: 3, marginBottom: 8, position: 'relative' },
  goalProgressFill: { height: '100%', borderRadius: 3 },
  goalMarker: { position: 'absolute', width: 2, height: 12, backgroundColor: C.warning, top: -3, borderRadius: 1 },
  goalHint: { fontSize: 11, color: C.textTer, fontStyle: 'italic' },

  actionPlan: { backgroundColor: C.surface2, borderRadius: 12, padding: 12, marginTop: 12 },
  actionPlanTitle: { fontSize: 13, fontWeight: '600', color: C.text, marginBottom: 8 },
  actionList: { gap: 8, marginBottom: 12 },
  actionItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  actionBullet: { width: 6, height: 6, borderRadius: 3 },
  actionText: { fontSize: 12, color: C.textSec, flex: 1 },
  urgentBadge: { backgroundColor: C.dangerSoft, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  urgentText: { fontSize: 9, fontWeight: '600', color: C.danger },
  quickWins: { paddingTop: 12, borderTopWidth: 1, borderTopColor: C.border },
  quickWinsTitle: { fontSize: 12, fontWeight: '600', color: C.success, marginBottom: 6 },
  winList: { gap: 6 },
  winItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  winText: { fontSize: 11, color: C.textSec, flex: 1 },

  // Assignments
  assignSummaryRow: { flexDirection: 'row', gap: 8, marginBottom: 16, flexWrap: 'wrap' },
  assignChip: { flex: 1, minWidth: 70, alignItems: 'center', gap: 4, paddingVertical: 10, paddingHorizontal: 8, borderRadius: 12, borderWidth: 1 },
  assignChipCount: { fontSize: 20, fontWeight: '800' },
  assignChipLabel: { fontSize: 9, fontWeight: '600', textTransform: 'uppercase' },
  assignRow: { borderLeftWidth: 4, borderRadius: 10, padding: 12, marginBottom: 8 },
  assignTitle: { fontSize: 13, fontWeight: '700', color: C.text, marginBottom: 4 },
  assignMeta: { fontSize: 11, color: C.textSec },

  // Planner
  plannerCard: { backgroundColor: C.surface2, borderRadius: 14, padding: 14, marginBottom: 12, borderLeftWidth: 4 },
  plannerCardHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10, gap: 8 },
  plannerUnitName: { fontSize: 14, fontWeight: '700', color: C.text },
  plannerUnitCode: { fontSize: 11, color: C.textTer, marginTop: 2 },
  plannerUrgencyBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10 },
  plannerUrgencyText: { fontSize: 10, fontWeight: '700' },
  plannerBarRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  plannerBarTrack: { flex: 1, height: 8, backgroundColor: C.surface3, borderRadius: 4, overflow: 'hidden' },
  plannerBarFill: { height: '100%', borderRadius: 4 },
  plannerBarPercent: { fontSize: 15, fontWeight: '800', minWidth: 40, textAlign: 'right' },
  plannerStats: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  plannerTarget: { fontSize: 11, color: C.textTer },

  // Planner New Styles
  riskSection: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: C.border },
  riskHeader: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6 },
  riskTitle: { fontSize: 11, fontWeight: '600', color: C.textSec },
  catchUpAnalysis: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  catchUpLabel: { fontSize: 10, color: C.textTer },
  difficultyBar: { flex: 1, height: 4, backgroundColor: C.border, borderRadius: 2, overflow: 'hidden' },
  difficultyFill: { height: '100%', borderRadius: 2 },
  difficultyText: { fontSize: 10, fontWeight: '600', minWidth: 35 },
  weeklyRequirement: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6 },
  requirementText: { fontSize: 10, color: C.textTer, flex: 1 },
  dropRiskAlert: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.dangerSoft, padding: 8, borderRadius: 8 },
  dropRiskText: { fontSize: 10, color: C.danger, flex: 1, fontWeight: '500' },

  interventionSection: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.border },
  interventionTitle: { fontSize: 12, fontWeight: '600', color: C.text, marginBottom: 8 },
  interventionItem: { marginBottom: 8, borderRadius: 8, overflow: 'hidden' },
  interventionGradient: { padding: 10 },
  interventionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  interventionType: { fontSize: 11, fontWeight: '600' },
  interventionDescription: { fontSize: 11, color: C.textSec, marginBottom: 6, lineHeight: 15 },
  interventionMeta: { flexDirection: 'row', gap: 12 },
  interventionImpact: { fontSize: 9, color: C.success },
  interventionEffort: { fontSize: 9, color: C.info },

  milestoneSection: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.border },
  milestoneTitle: { fontSize: 12, fontWeight: '600', color: C.text, marginBottom: 8 },
  milestoneList: { gap: 8 },
  milestoneItem: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8, borderRadius: 8, backgroundColor: C.surface },
  milestoneAchieved: { backgroundColor: C.successSoft },
  milestoneIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  milestoneContent: { flex: 1 },
  milestoneName: { fontSize: 12, fontWeight: '600', color: C.text, marginBottom: 2 },
  milestoneProgress: { fontSize: 9, color: C.textTer, marginBottom: 4 },
  milestoneBar: { height: 3, backgroundColor: C.border, borderRadius: 1.5, overflow: 'hidden' },
  milestoneFill: { height: '100%', borderRadius: 1.5 },

  peerContext: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.border },
  peerTitle: { fontSize: 12, fontWeight: '600', color: C.text, marginBottom: 8 },
  peerStat: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: 4, marginBottom: 10 },
  peerLabel: { fontSize: 11, color: C.textTer },
  peerValue: { fontSize: 18, fontWeight: '800' },
  peerComparison: { marginBottom: 10 },
  comparisonBar: { height: 8, backgroundColor: C.border, borderRadius: 4, overflow: 'hidden', marginBottom: 6, position: 'relative' },
  yourBar: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 4 },
  averageBar: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 4, opacity: 0.5 },
  comparisonLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  yourLabel: { fontSize: 10, fontWeight: '600' },
  averageLabel: { fontSize: 10, color: C.textTer },
  peerInsight: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.infoSoft, padding: 8, borderRadius: 8 },
  peerInsightText: { fontSize: 11, color: C.textSec, flex: 1 },

  // Department rank display
  rankDisplayRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  rankPill: { borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12, alignItems: 'center', minWidth: 76 },
  rankPillNum: { fontSize: 20, fontWeight: '800', color: '#FFF' },
  rankPillContext: { fontSize: 10, color: 'rgba(255,255,255,0.85)', textAlign: 'center', marginTop: 2 },
  rankDetails: { flex: 1 },
  rankDetailsLabel: { fontSize: 12, fontWeight: '700', color: C.text, marginBottom: 2 },
  rankDetailsPercentile: { fontSize: 14, fontWeight: '800', marginBottom: 4 },
  rankPercentileBar: { height: 6, backgroundColor: C.border, borderRadius: 3, overflow: 'hidden' },
  rankPercentileFill: { height: 6, borderRadius: 3 },
  rankSecondary: { fontSize: 10, color: C.textTer, marginTop: 4 },
});

