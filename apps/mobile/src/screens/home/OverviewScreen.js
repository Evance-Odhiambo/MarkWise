import React, { useCallback, useMemo, useState, useEffect } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Animated,
  Dimensions,
  StatusBar,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useEnrollment } from '../../context/EnrollmentContext';
import { fetchUnitsByYearSemester } from '../../utils/unitsApi';
import { fetchStudentTimetableSnapshot } from '../../utils/studentTimetableApi';
import { getStudentSession } from '../../utils/authSession';
import sqliteStorage from '../../storage/sqliteStorage';

import { fetchConductedSessionCounts, getCachedConductedCounts } from '../../utils/offlineAttendanceApi';
import useInternetStatus from '../../hooks/useInternetStatus';
import { normalizeUnitCode } from '../../utils/constants';
import colors from '../../theme/colors';
import { useColors } from '../../theme';

const { width } = Dimensions.get('window');
const TARGET_ATTENDANCE_PERCENT = 75;


// Inspirational quotes collection
const INSPIRATIONAL_QUOTES = [
  {
    id: 1,
    quote: "The beautiful thing about learning is that no one can take it away from you.",
    author: "B.B. King",
    category: "education"
  },
  {
    id: 2,
    quote: "Education is the most powerful weapon which you can use to change the world.",
    author: "Nelson Mandela",
    category: "education"
  },
  {
    id: 3,
    quote: "Success is not final, failure is not fatal: it is the courage to continue that counts.",
    author: "Winston Churchill",
    category: "motivation"
  },
  {
    id: 4,
    quote: "Your time is limited, don't waste it living someone else's life.",
    author: "Steve Jobs",
    category: "motivation"
  },
  {
    id: 5,
    quote: "The future belongs to those who believe in the beauty of their dreams.",
    author: "Eleanor Roosevelt",
    category: "inspiration"
  },
  {
    id: 6,
    quote: "Don't watch the clock; do what it does. Keep going.",
    author: "Sam Levenson",
    category: "perseverance"
  },
  {
    id: 7,
    quote: "The expert in anything was once a beginner.",
    author: "Helen Hayes",
    category: "learning"
  },
  {
    id: 8,
    quote: "It always seems impossible until it's done.",
    author: "Nelson Mandela",
    category: "perseverance"
  },
  {
    id: 9,
    quote: "Education is not preparation for life; education is life itself.",
    author: "John Dewey",
    category: "education"
  },
  {
    id: 10,
    quote: "The more that you read, the more things you will know. The more that you learn, the more places you'll go.",
    author: "Dr. Seuss",
    category: "learning"
  },
  {
    id: 11,
    quote: "Strive for progress, not perfection.",
    author: "Unknown",
    category: "motivation"
  },
  {
    id: 12,
    quote: "Every expert was once a beginner. Every champion was once a contender.",
    author: "Unknown",
    category: "inspiration"
  },
  {
    id: 13,
    quote: "The only way to do great work is to love what you do.",
    author: "Steve Jobs",
    category: "passion"
  },
  {
    id: 14,
    quote: "Believe you can and you're halfway there.",
    author: "Theodore Roosevelt",
    category: "motivation"
  },
  {
    id: 15,
    quote: "Learning is a treasure that will follow its owner everywhere.",
    author: "Chinese Proverb",
    category: "education"
  },
];


const parseUnit = (unitValue) => {
  if (typeof unitValue !== 'string') {
    return { name: '', code: '' };
  }

  const trimmed = unitValue.trim();
  if (!trimmed) {
    return { name: '', code: '' };
  }

  const match = trimmed.match(/\(([^)]+)\)\s*$/);
  if (!match || !match[1]) {
    return { name: trimmed, code: trimmed.toUpperCase() };
  }

  return {
    name: trimmed.slice(0, match.index).trim(),
    code: match[1].trim().toUpperCase(),
  };
};

// Canonical unit code normalizer — imported from constants.js
const normalizeComparableUnitCode = normalizeUnitCode;

const parseLessonTimeRange = (timeRange) => {
  if (typeof timeRange !== 'string') {
    return { startMinutes: null, endMinutes: null };
  }

  const [startRaw, endRaw] = timeRange.split('-').map((value) => String(value || '').trim());
  const parseOne = (value) => {
    const match = value.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) {
      return null;
    }
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
      return null;
    }
    return (hour * 60) + minute;
  };

  return {
    startMinutes: parseOne(startRaw),
    endMinutes: parseOne(endRaw),
  };
};

const nowMinutes = () => {
  const now = new Date();
  return (now.getHours() * 60) + now.getMinutes();
};

const formatTimestamp = (timestamp) => {
  const safeTs = Number(timestamp);
  if (!Number.isFinite(safeTs)) {
    return 'N/A';
  }
  return new Date(safeTs).toLocaleString();
};

// Animated Quote Card Component
const QuoteCard = ({ quote, onRefresh }) => {
  const [fadeAnim] = useState(new Animated.Value(0));

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 800,
      useNativeDriver: true,
    }).start();
  }, [quote]);

  return (
    <Animated.View style={{ opacity: fadeAnim }}>
      <LinearGradient
        colors={['rgba(99, 102, 241, 0.1)', 'rgba(139, 92, 246, 0.05)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.quoteCard}
      >
        <View style={styles.quoteIconContainer}>
          <Icon name="format-quote-open" size={24} color={colors.primary.main} />
        </View>
        
        <Text style={styles.quoteText}>"{quote.quote}"</Text>
        
        <View style={styles.quoteFooter}>
          <View style={styles.quoteAuthorContainer}>
            <Icon name="account" size={14} color={colors.text.secondary} />
            <Text style={styles.quoteAuthor}>— {quote.author}</Text>
          </View>
          
          <TouchableOpacity onPress={onRefresh} style={styles.refreshQuoteButton}>
            <Icon name="sync" size={18} color={colors.primary.main} />
          </TouchableOpacity>
        </View>

        <View style={styles.quoteCategoryBadge}>
          <Text style={styles.quoteCategoryText}>{quote.category}</Text>
        </View>
      </LinearGradient>
    </Animated.View>
  );
};

// Progress Ring Component
const ProgressRing = ({ percentage, size = 80, strokeWidth = 8 }) => {

  return (
    <View style={styles.progressRingContainer}>
      <View style={[styles.progressRing, { width: size, height: size }]}>
        <View style={[styles.progressRingBackground, { width: size, height: size }]} />
        <View style={[styles.progressRingFill, { 
          width: size, 
          height: size,
          borderRadius: size / 2,
          borderWidth: strokeWidth,
          borderColor: colors.success.main,
        }]} />
        <View style={styles.progressRingContent}>
          <Text style={styles.progressRingPercentage}>{percentage}%</Text>
        </View>
      </View>
    </View>
  );
};

// Stat Card Component
const StatCard = ({ icon, title, value, subtitle, color, onPress }) => (
  <TouchableOpacity style={styles.statCard} onPress={onPress} activeOpacity={0.7}>
    <LinearGradient
      colors={[color + '20', 'transparent']}
      style={styles.statCardGradient}
    >
      <View style={[styles.statCardIcon, { backgroundColor: color + '20' }]}>
        <Icon name={icon} size={24} color={color} />
      </View>
      <View style={styles.statCardContent}>
        <Text style={styles.statCardValue}>{value}</Text>
        <Text style={styles.statCardTitle}>{title}</Text>
        {subtitle && <Text style={styles.statCardSubtitle}>{subtitle}</Text>}
      </View>
    </LinearGradient>
  </TouchableOpacity>
);

// Action Button Component
const ActionButton = ({ icon, title, onPress, color = colors.primary.main, variant = 'primary' }) => (
  <TouchableOpacity style={[styles.actionButton, variant === 'primary' && styles.primaryAction]} onPress={onPress}>
    <LinearGradient
      colors={variant === 'primary' ? [color, color + 'CC'] : ['transparent', 'transparent']}
      style={[styles.actionButtonGradient, variant !== 'primary' && styles.secondaryActionGradient]}
    >
      <Icon name={icon} size={20} color={variant === 'primary' ? '#fff' : color} />
      <Text style={[styles.actionButtonText, { color: variant === 'primary' ? '#fff' : color }]}>
        {title}
      </Text>
    </LinearGradient>
  </TouchableOpacity>
);

// Main Component
export default function OverviewScreen() {
  const colors = useColors();
  const C = useMemo(() => ({
    bg:        colors.background.primary,
    bgSec:     colors.background.secondary,
    surface:   colors.surface.primary,
    surfaceSec:colors.surface.secondary,
    successSoft:colors.success.soft,
    primarySoft:colors.primary.soft,
    border:    colors.border.light,
    primary:   colors.primary.main,
    primaryD:  colors.primary.dark,
    success:   colors.success.main,
    warning:   colors.warning.main,
    danger:    colors.danger.main,
    text:      colors.text.primary,
    textSec:   colors.text.secondary,
    textTer:   colors.text.tertiary,
  }), [colors]);
  const styles = useMemo(() => makeStyles(C), [C]);

  const navigation = useNavigation();
  const { enrolledUnits } = useEnrollment();
  const { isOnline } = useInternetStatus();
  const [, setUnits] = useState([]);
  const [timetable, setTimetable] = useState([]);
  const [records, setRecords] = useState([]);
  const [conductedCounts, setConductedCounts] = useState({});
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [currentQuote, setCurrentQuote] = useState(INSPIRATIONAL_QUOTES[0]);

  // Get random quote
  const getRandomQuote = useCallback(() => {
    const randomIndex = Math.floor(Math.random() * INSPIRATIONAL_QUOTES.length);
    setCurrentQuote(INSPIRATIONAL_QUOTES[randomIndex]);
  }, []);

  // Set initial quote
  useEffect(() => {
    getRandomQuote();
  }, []);

  const loadOverviewData = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const fetchedUnits = await fetchUnitsByYearSemester();
      setUnits(Array.isArray(fetchedUnits) ? fetchedUnits : []);

      const session = await getStudentSession();
      const accessToken = session?.token ?? null;
      let fetchedTimetable = [];
      if (accessToken) {
        const timetableResult = await fetchStudentTimetableSnapshot({ accessToken }).catch(() => null);
        if (timetableResult?.snapshot) {
          fetchedTimetable = timetableResult.snapshot.timetableByDay ??
            (Array.isArray(timetableResult.snapshot) ? timetableResult.snapshot : []);
        }
      }
      setTimetable(Array.isArray(fetchedTimetable) ? fetchedTimetable : []);

      await sqliteStorage.backfillConductedSessionsFromAttendance();

      const parsedCodes = (enrolledUnits || []).map(u => {
        if (typeof u === 'string') return u;
        return u?.unitCode ?? u?.code ?? '';
      }).filter(Boolean);

      // Phase 1: local SQLite + previously cached remote counts in parallel
      const [attendanceRecords, localConducted, cachedRemote] = await Promise.all([
        sqliteStorage.getAttendanceLightRecords(500),
        sqliteStorage.getConductedSessionCounts(),
        getCachedConductedCounts().catch(() => ({})),
      ]);

      const merged1 = { ...localConducted };
      Object.entries(cachedRemote || {}).forEach(([code, cnt]) => {
        merged1[code] = Math.max(merged1[code] ?? 0, Number(cnt) || 0);
      });

      setRecords(Array.isArray(attendanceRecords) ? attendanceRecords : []);
      setConductedCounts(merged1);

      // Phase 2: fetch live remote counts without blocking UI
      if (isOnline && parsedCodes.length > 0) {
        fetchConductedSessionCounts(parsedCodes)
          .then(remote => {
            if (!remote || typeof remote !== 'object') return;
            setConductedCounts(prev => {
              const updated = { ...prev };
              Object.entries(remote).forEach(([code, cnt]) => {
                updated[code] = Math.max(updated[code] ?? 0, Number(cnt) || 0);
              });
              return updated;
            });
          })
          .catch(() => {});
      }
    } catch (error) {
      console.error('Failed to load overview data', error);
      setRecords([]);
      setConductedCounts({});
      setUnits([]);
      setTimetable([]);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadOverviewData();
    }, [loadOverviewData]),
  );

  const enrolledCodes = useMemo(
    () => (enrolledUnits || []).map((unit) => parseUnit(unit).code).filter(Boolean),
    [enrolledUnits],
  );

  const statsByUnit = useMemo(() => {
    const attendanceByCode = records.reduce((accumulator, record) => {
      const code = normalizeComparableUnitCode(record?.unitCode);
      const sessionStart = Number(record?.sessionStart);
      if (!code || !Number.isFinite(sessionStart)) {
        return accumulator;
      }

      if (!accumulator[code]) {
        accumulator[code] = new Set();
      }
      accumulator[code].add(sessionStart);
      return accumulator;
    }, {});

    const conductedByCode = Object.entries(conductedCounts || {}).reduce((accumulator, [rawCode, total]) => {
      const code = normalizeComparableUnitCode(rawCode);
      if (!code) {
        return accumulator;
      }
      accumulator[code] = (accumulator[code] || 0) + (Number(total) || 0);
      return accumulator;
    }, {});

    return enrolledCodes.map((code) => {
      const normalizedCode = normalizeComparableUnitCode(code);
      const attendedCount = attendanceByCode[normalizedCode]?.size || 0;
      const conductedCount = conductedByCode[normalizedCode] || 0;
      const missedCount = Math.max(0, conductedCount - attendedCount);
      const percentage = conductedCount > 0
        ? Math.round((attendedCount / conductedCount) * 100)
        : 0;

      return {
        code,
        attendedCount,
        conductedCount,
        missedCount,
        percentage,
      };
    });
  }, [records, conductedCounts, enrolledCodes]);

  const attendanceSnapshot = useMemo(() => {
    const totalAttended = statsByUnit.reduce((sum, item) => sum + item.attendedCount, 0);
    const totalConducted = statsByUnit.reduce((sum, item) => sum + item.conductedCount, 0);
    const totalMissed = statsByUnit.reduce((sum, item) => sum + item.missedCount, 0);
    const percentage = totalConducted > 0 ? Math.round((totalAttended / totalConducted) * 100) : 0;
    return {
      totalAttended,
      totalConducted,
      totalMissed,
      percentage,
    };
  }, [statsByUnit]);

  const atRiskUnits = useMemo(
    () => statsByUnit
      .filter((item) => item.conductedCount > 0 && item.percentage < TARGET_ATTENDANCE_PERCENT)
      .sort((left, right) => left.percentage - right.percentage)
      .slice(0, 3),
    [statsByUnit],
  );

  const latestRecord = records.length > 0 ? records[0] : null;

  const todayStatus = useMemo(() => {
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const todayName = dayNames[new Date().getDay()];
    const todaysLessons = (timetable || [])
      .find((day) => day.day === todayName)
      ?.lessons || [];

    const enrolledCodeSet = new Set(enrolledCodes.map((code) => normalizeComparableUnitCode(code)));
    const eligibleLessons = todaysLessons.filter((lesson) => {
      const lessonCode = parseUnit(lesson.unit).code;
      return enrolledCodeSet.has(normalizeComparableUnitCode(lessonCode));
    });

    if (eligibleLessons.length === 0) {
      return { 
        text: '📚 No classes scheduled today', 
        detail: 'Use this time to catch up on studies',
        icon: 'book-open-variant',
        color: colors.info.main 
      };
    }

    const currentMinute = nowMinutes();
    const parsed = eligibleLessons.map((lesson) => ({
      lesson,
      ...parseLessonTimeRange(lesson.time),
      code: parseUnit(lesson.unit).code,
    }));

    const active = parsed.find((item) => (
      Number.isFinite(item.startMinutes)
      && Number.isFinite(item.endMinutes)
      && currentMinute >= item.startMinutes
      && currentMinute <= item.endMinutes
    ));

    if (active) {
      return {
        text: '🎯 Class in Progress',
        detail: `${active.code} • ${active.lesson.venue} • ${active.lesson.time}`,
        icon: 'clock-outline',
        color: colors.success.main,
      };
    }

    const upcoming = parsed
      .filter((item) => Number.isFinite(item.startMinutes) && item.startMinutes > currentMinute)
      .sort((left, right) => left.startMinutes - right.startMinutes)[0];

    if (upcoming) {
      return {
        text: '⏰ Next Class Today',
        detail: `${upcoming.code} • ${upcoming.lesson.venue} • ${upcoming.lesson.time}`,
        icon: 'calendar-clock',
        color: colors.warning.main,
      };
    }

    return {
      text: '✅ All Classes Completed',
      detail: `${eligibleLessons.length} class(es) today - well done!`,
      icon: 'check-circle',
      color: colors.success.main,
    };
  }, [enrolledCodes, timetable]);

  const pendingActions = useMemo(() => {
    const items = [];
    if (enrolledCodes.length === 0) {
      items.push({ text: 'Enroll in units to start tracking', icon: 'book-plus', color: colors.warning.main });
    }
    if (attendanceSnapshot.totalConducted === 0 && enrolledCodes.length > 0) {
      items.push({ text: 'No attendance sessions yet', icon: 'calendar-blank', color: colors.info.main });
    }
    if (atRiskUnits.length > 0) {
      items.push({ 
        text: `${atRiskUnits.length} unit(s) below ${TARGET_ATTENDANCE_PERCENT}% target`, 
        icon: 'alert-circle', 
        color: colors.danger.main 
      });
    }
    if (!latestRecord && enrolledCodes.length > 0) {
      items.push({ text: 'No recent attendance', icon: 'clock-outline', color: colors.warning.main });
    }
    return items.slice(0, 3);
  }, [enrolledCodes, attendanceSnapshot.totalConducted, atRiskUnits.length, latestRecord]);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.primary.dark} />
      
      {/* Header */}
      <LinearGradient
        colors={colors.primary.gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.header}
      >
        <View style={styles.headerContent}>
          <View>
            <Text style={styles.greeting}>Hello, Student</Text>
            <Text style={styles.headerTitle}>Your Academic Dashboard</Text>
          </View>
          <TouchableOpacity style={styles.profileButton}>
            <Icon name="account-circle" size={40} color="#fff" />
          </TouchableOpacity>
        </View>
      </LinearGradient>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl 
            refreshing={isRefreshing} 
            onRefresh={loadOverviewData} 
            tintColor={colors.primary.main}
            colors={[colors.primary.main]}
          />
        }
      >
        {/* Today's Status Card */}
        <LinearGradient
          colors={[colors.surface.primary, colors.surface.secondary]}
          style={styles.statusCard}
        >
          <View style={styles.statusCardHeader}>
            <View style={[styles.statusIcon, { backgroundColor: todayStatus.color + '20' }]}>
              <Icon name={todayStatus.icon || 'calendar'} size={24} color={todayStatus.color} />
            </View>
            <View style={styles.statusTextContainer}>
              <Text style={styles.statusTitle}>{todayStatus.text}</Text>
              {todayStatus.detail && (
                <Text style={styles.statusDetail}>{todayStatus.detail}</Text>
              )}
            </View>
          </View>
        </LinearGradient>

        {/* Attendance Overview */}
        <View style={styles.attendanceOverview}>
          <View style={styles.attendanceRingContainer}>
            <ProgressRing percentage={attendanceSnapshot.percentage} />
          </View>
          <View style={styles.attendanceStats}>
            <View style={styles.attendanceStat}>
              <Text style={styles.attendanceStatValue}>{attendanceSnapshot.totalAttended}</Text>
              <Text style={styles.attendanceStatLabel}>Attended</Text>
            </View>
            <View style={styles.attendanceStatDivider} />
            <View style={styles.attendanceStat}>
              <Text style={styles.attendanceStatValue}>{attendanceSnapshot.totalConducted}</Text>
              <Text style={styles.attendanceStatLabel}>Conducted</Text>
            </View>
            <View style={styles.attendanceStatDivider} />
            <View style={styles.attendanceStat}>
              <Text style={styles.attendanceStatValue}>{attendanceSnapshot.totalMissed}</Text>
              <Text style={styles.attendanceStatLabel}>Missed</Text>
            </View>
          </View>
        </View>

        {/* Stats Grid */}
        <View style={styles.statsGrid}>
          <StatCard
            icon="book-open-variant"
            title="Enrolled Units"
            value={enrolledCodes.length}
            color={colors.primary.main}
            onPress={() => navigation.navigate('Units')}
          />
          <StatCard
            icon="calendar-check"
            title="Today's Classes"
            value={timetable.filter(day => day.lessons?.length).length || 0}
            color={colors.success.main}
            onPress={() => navigation.navigate('Schedule')}
          />
          <StatCard
            icon="clock-outline"
            title="Study Hours"
            value="24"
            subtitle="this week"
            color={colors.purple.main}
            onPress={() => navigation.navigate('Progress')}
          />
          <StatCard
            icon="trophy"
            title="Achievements"
            value="3"
            color={colors.warning.main}
            onPress={() => navigation.navigate('Achievements')}
          />
        </View>

        {/* At-Risk Units */}
        {atRiskUnits.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>⚠️ Units Needing Attention</Text>
              <TouchableOpacity onPress={() => navigation.navigate('Progress')}>
                <Text style={styles.sectionAction}>View All</Text>
              </TouchableOpacity>
            </View>
            {atRiskUnits.map((item) => (
              <TouchableOpacity key={item.code} style={styles.riskItem}>
                <View style={styles.riskItemContent}>
                  <Text style={styles.riskItemCode}>{item.code}</Text>
                  <View style={styles.riskItemProgress}>
                    <View style={styles.riskItemProgressBar}>
                      <View 
                        style={[
                          styles.riskItemProgressFill, 
                          { width: `${item.percentage}%` },
                          item.percentage < 50 ? styles.riskLow : styles.riskMedium
                        ]} 
                      />
                    </View>
                    <Text style={styles.riskItemPercentage}>{item.percentage}%</Text>
                  </View>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Recent Activity */}
        {latestRecord && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>🕒 Recent Activity</Text>
            </View>
            <LinearGradient
              colors={[colors.surface.primary, colors.surface.secondary]}
              style={styles.activityCard}
            >
              <View style={styles.activityIcon}>
                <Icon name="check-circle" size={24} color={colors.success.main} />
              </View>
              <View style={styles.activityDetails}>
                <Text style={styles.activityTitle}>Attendance Marked</Text>
                <Text style={styles.activityUnit}>{latestRecord.unitCode}</Text>
                <Text style={styles.activityMeta}>
                  {latestRecord.lectureRoom} • {formatTimestamp(latestRecord.scannedAt)}
                </Text>
              </View>
            </LinearGradient>
          </View>
        )}

        {/* Quick Actions */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🚀 Quick Actions</Text>
          <View style={styles.actionsGrid}>
            <ActionButton
              icon="qrcode-scan"
              title="Scan QR"
              onPress={() => navigation.navigate('Sessions')}
              color={colors.primary.main}
            />
            <ActionButton
              icon="chart-line"
              title="Progress"
              onPress={() => navigation.navigate('Progress')}
              color={colors.success.main}
            />
            <ActionButton
              icon="calendar"
              title="Timetable"
              onPress={() => navigation.navigate('Schedule')}
              color={colors.purple.main}
            />
            <ActionButton
              icon="video"
              title="Join Live"
              onPress={() => navigation.navigate('StudentAttendanceSessions')}
              color={colors.danger.main}
            />
          </View>
        </View>

        {/* Pending Actions */}
        {pendingActions.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>📋 Pending Actions</Text>
            {pendingActions.map((item, index) => (
              <View key={index} style={styles.pendingItem}>
                <Icon name={item.icon} size={18} color={item.color} />
                <Text style={[styles.pendingText, { color: item.color }]}>{item.text}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Inspirational Quote Section */}
        <View style={styles.quoteSection}>
          <QuoteCard quote={currentQuote} onRefresh={getRandomQuote} />
        </View>

        {/* Bottom Spacing */}
        <View style={{ height: 20 }} />
      </ScrollView>
    </View>
  );
}

const makeStyles = (C) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 30,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  headerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  greeting: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
    marginBottom: 4,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  profileButton: {
    padding: 4,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 20,
  },
  statusCard: {
    borderRadius: 20,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: C.border,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  statusCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  statusIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusTextContainer: {
    flex: 1,
  },
  statusTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: C.text,
    marginBottom: 4,
  },
  statusDetail: {
    fontSize: 13,
    color: C.textSec,
  },
  attendanceOverview: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
    borderRadius: 20,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: C.border,
  },
  attendanceRingContainer: {
    marginRight: 16,
  },
  progressRingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressRing: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressRingBackground: {
    position: 'absolute',
    borderRadius: 999,
    backgroundColor: C.surfaceSec,
  },
  progressRingFill: {
    position: 'absolute',
    borderRadius: 999,
    borderColor: C.success,
  },
  progressRingContent: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressRingPercentage: {
    fontSize: 18,
    fontWeight: '700',
    color: C.text,
  },
  attendanceStats: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  attendanceStat: {
    alignItems: 'center',
  },
  attendanceStatValue: {
    fontSize: 20,
    fontWeight: '700',
    color: C.text,
    marginBottom: 4,
  },
  attendanceStatLabel: {
    fontSize: 11,
    color: C.textSec,
  },
  attendanceStatDivider: {
    width: 1,
    backgroundColor: C.border,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 20,
  },
  statCard: {
    width: (width - 44) / 2,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: C.border,
  },
  statCardGradient: {
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  statCardIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statCardContent: {
    flex: 1,
  },
  statCardValue: {
    fontSize: 18,
    fontWeight: '700',
    color: C.text,
    marginBottom: 2,
  },
  statCardTitle: {
    fontSize: 12,
    color: C.textSec,
  },
  statCardSubtitle: {
    fontSize: 10,
    color: C.textTer,
    marginTop: 2,
  },
  section: {
    marginBottom: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: C.text,
  },
  sectionAction: {
    fontSize: 13,
    color: C.primary,
    fontWeight: '500',
  },
  riskItem: {
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: C.border,
  },
  riskItemContent: {
    gap: 8,
  },
  riskItemCode: {
    fontSize: 14,
    fontWeight: '600',
    color: C.text,
  },
  riskItemProgress: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  riskItemProgressBar: {
    flex: 1,
    height: 6,
    backgroundColor: C.surfaceSec,
    borderRadius: 3,
    overflow: 'hidden',
  },
  riskItemProgressFill: {
    height: '100%',
    borderRadius: 3,
  },
  riskLow: {
    backgroundColor: C.danger,
  },
  riskMedium: {
    backgroundColor: C.warning,
  },
  riskItemPercentage: {
    fontSize: 12,
    fontWeight: '600',
    color: C.text,
    width: 40,
    textAlign: 'right',
  },
  activityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
  },
  activityIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: C.successSoft,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  activityDetails: {
    flex: 1,
  },
  activityTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: C.text,
    marginBottom: 2,
  },
  activityUnit: {
    fontSize: 13,
    color: C.textSec,
    marginBottom: 2,
  },
  activityMeta: {
    fontSize: 11,
    color: C.textTer,
  },
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  actionButton: {
    flex: 1,
    minWidth: '47%',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: C.border,
  },
  primaryAction: {
    borderWidth: 0,
  },
  actionButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    gap: 8,
  },
  secondaryActionGradient: {
    backgroundColor: C.surfaceSec,
  },
  actionButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
  pendingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: C.surface,
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: C.border,
  },
  pendingText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
  },
  quoteSection: {
    marginTop: 8,
    marginBottom: 8,
  },
  quoteCard: {
    padding: 20,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.primarySoft,
    position: 'relative',
  },
  quoteIconContainer: {
    marginBottom: 12,
  },
  quoteText: {
    fontSize: 16,
    fontWeight: '500',
    color: C.text,
    lineHeight: 24,
    marginBottom: 16,
    fontStyle: 'italic',
  },
  quoteFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  quoteAuthorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  quoteAuthor: {
    fontSize: 13,
    color: C.textSec,
    fontWeight: '500',
  },
  refreshQuoteButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: C.primarySoft,
    justifyContent: 'center',
    alignItems: 'center',
  },
  quoteCategoryBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: C.primarySoft,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  quoteCategoryText: {
    fontSize: 10,
    color: C.primary,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
});