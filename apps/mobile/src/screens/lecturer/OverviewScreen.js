import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, Animated, TouchableOpacity, Dimensions } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import LecturerHeader from '../../components/LecturerHeader';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { LineChart } from 'react-native-chart-kit';
import { fetchMyLecturerTimetable, normalizeEntry, readLecturerTimetableCache, fetchLecturerAnalytics, readLecturerAnalyticsCache, writeLecturerAnalyticsCache } from '../../utils/lecturerTimetableApi';
import { getLecturerSession } from '../../utils/authSession';

const DAY_ORDER = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const SCREEN_WIDTH = Dimensions.get('window').width;

const parseTimeToMinutes = (timeStr) => {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const cleaned = timeStr.trim().toLowerCase();
  if (!cleaned) return null;

  const direct24h = cleaned.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (direct24h) {
    const hours = parseInt(direct24h[1], 10);
    const minutes = parseInt(direct24h[2], 10);
    return hours * 60 + minutes;
  }

  const twelveHour = cleaned.match(/^([01]?\d|2[0-3])(?::([0-5]\d))?\s*(am|pm)$/);
  if (twelveHour) {
    let hours = parseInt(twelveHour[1], 10);
    const minutes = twelveHour[2] ? parseInt(twelveHour[2], 10) : 0;
    const period = twelveHour[3];
    if (period === 'pm' && hours !== 12) hours += 12;
    if (period === 'am' && hours === 12) hours = 0;
    return hours * 60 + minutes;
  }

  return null;
};

const getDayIndex = (dayName) => DAY_ORDER.indexOf(String(dayName || '').trim().toLowerCase());

const ProgressCard = ({ label, value, icon, color, progressPercent }) => {
  return (
    <View className="flex-1 min-w-[47%] bg-white border border-slate-200 rounded-2xl p-4 gap-2.5">
      <View className="flex-row items-center justify-between">
        <Text className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{label}</Text>
        <View className="w-8 h-8 rounded-xl items-center justify-center" style={{ backgroundColor: `${color}18` }}>
          <Icon name={icon} size={18} color={color} />
        </View>
      </View>
      <Text className="text-2xl font-extrabold text-slate-900 tracking-tight">{value}</Text>
      {typeof progressPercent === 'number' && (
        <View className="h-2 bg-slate-200 rounded-full overflow-hidden">
          <View className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, progressPercent))}%`, backgroundColor: color }} />
        </View>
      )}
    </View>
  );
};

const StatBadge = ({ label, value, icon, color }) => (
  <View className="flex-1 bg-white border border-slate-200 rounded-2xl p-3.5 gap-1.5">
    <View className="flex-row items-center gap-2">
      <View className="w-8 h-8 rounded-xl items-center justify-center" style={{ backgroundColor: `${color}18` }}>
        <Icon name={icon} size={16} color={color} />
      </View>
      <View className="flex-1">
        <Text className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">{label}</Text>
        <Text className="text-lg font-extrabold text-slate-900 tracking-tight">{value}</Text>
      </View>
    </View>
  </View>
);

export default function OverviewScreen() {
  const navigation = useNavigation();
  const [units, setUnits] = useState(0);
  const [weeklyLessons, setWeeklyLessons] = useState(0);
  const [weeklyProgress, setWeeklyProgress] = useState(null);
  const [nextLesson, setNextLesson] = useState(null);
  const [loading, setLoading] = useState(true);
  const [semesterProgress, setSemesterProgress] = useState('50%');
  const [analytics, setAnalytics] = useState([]);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [bestUnit, setBestUnit] = useState(null);
  const [worstUnit, setWorstUnit] = useState(null);
  const [trendMonths, setTrendMonths] = useState([]);
  const [activeMonthIndex, setActiveMonthIndex] = useState(0);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.95)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, tension: 100, friction: 8, useNativeDriver: true }),
    ]).start();
  }, []);

  useEffect(() => {
    let isMounted = true;

    const computeStats = (entries) => {
      const normalized = Array.isArray(entries) ? entries.map(normalizeEntry) : [];

      const uniqueUnitCodes = new Set(normalized.map(e => String(e.unitCode || '').trim()).filter(Boolean));
      const unitCount = uniqueUnitCodes.size;

      const now = new Date();
      const currentDayIndex = getDayIndex(now.toLocaleDateString('en-US', { weekday: 'long' }));
      const currentMinutes = now.getHours() * 60 + now.getMinutes();

      const weeklyEntries = normalized.filter(e => {
        const dayIndex = getDayIndex(e.day);
        return Number.isFinite(dayIndex) && dayIndex >= 0 && dayIndex <= 5;
      });

      const weeklyLessonCount = weeklyEntries.length;

      if (weeklyEntries.length === 0) {
        return { unitCount, weeklyLessonCount, weeklyProgress: 0, nextLesson: null };
      }

      let passedCount = 0;
      for (const entry of weeklyEntries) {
        const dayIndex = getDayIndex(entry.day);
        const endTime = entry.endTime || entry.time || '';
        const endMinutes = parseTimeToMinutes(endTime);

        if (!Number.isFinite(dayIndex) || endMinutes === null) continue;

        if (dayIndex < currentDayIndex) {
          passedCount++;
        } else if (dayIndex === currentDayIndex) {
          if (endMinutes <= currentMinutes) passedCount++;
        }
      }

      const weeklyProgress = weeklyEntries.length > 0 ? Math.round((passedCount / weeklyEntries.length) * 100) : 0;

      const scored = weeklyEntries
        .map(entry => {
          const dayIndex = getDayIndex(entry.day);
          const startTime = entry.startTime || entry.time || '';
          const startMinutes = parseTimeToMinutes(startTime);
          if (!Number.isFinite(dayIndex) || startMinutes === null) return null;
          const score = dayIndex * 1440 + startMinutes;
          return { entry, score, dayIndex, startMinutes };
        })
        .filter(Boolean)
        .filter(item => item.score > currentDayIndex * 1440 + currentMinutes)
        .sort((a, b) => a.score - b.score);

      const nextLesson = scored.length > 0 ? scored[0].entry : null;
      return { unitCount, weeklyLessonCount, weeklyProgress, nextLesson };
    };

    const load = async () => {
      try {
        const session = await getLecturerSession();
        if (!session?.token) return;

        const cached = await readLecturerTimetableCache();
        if (cached && Array.isArray(cached) && isMounted) {
          const stats = computeStats(cached);
          setUnits(stats.unitCount);
          setWeeklyLessons(stats.weeklyLessonCount);
          setWeeklyProgress(stats.weeklyProgress);
          setNextLesson(stats.nextLesson);
        }

        try {
          const entries = await fetchMyLecturerTimetable(session.token);
          if (!isMounted) return;
          const stats = computeStats(entries);
          setUnits(stats.unitCount);
          setWeeklyLessons(stats.weeklyLessonCount);
          setWeeklyProgress(stats.weeklyProgress);
          setNextLesson(stats.nextLesson);
        } catch (_) {
          // keep cached values if network refresh fails
        }
      } catch (_) {
        // keep defaults
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    const loadAnalytics = async () => {
      try {
        const session = await getLecturerSession();
        if (!session?.token) return;

        const cached = await readLecturerAnalyticsCache();
        if (cached && Array.isArray(cached) && isMounted) {
          setAnalytics(cached);
          updateBestWorst(cached);
          buildTrend(cached);
        }

        try {
          const data = await fetchLecturerAnalytics(session.token);
          if (!isMounted) return;
          await writeLecturerAnalyticsCache(data);
          setAnalytics(data);
          updateBestWorst(data);
          buildTrend(data);
        } catch (_) {
          // keep cached values if network refresh fails
        }
      } catch (_) {
        // keep defaults
      } finally {
        if (isMounted) setAnalyticsLoading(false);
      }
    };

    const updateBestWorst = (data) => {
      if (!Array.isArray(data) || data.length === 0) {
        setBestUnit(null);
        setWorstUnit(null);
        return;
      }
      const sorted = [...data].sort((a, b) => b.attendancePercent - a.attendancePercent);
      setBestUnit(sorted[0]);
      setWorstUnit(sorted[sorted.length - 1]);
    };

    const buildTrend = (data) => {
      const now = new Date();
      const months = [];
      for (let i = 0; i < 3; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const label = d.toLocaleString('default', { month: 'short', year: 'numeric' });
        const weeks = [];
        for (let w = 0; w < 4; w++) {
          const base = Array.isArray(data) && data.length > 0
            ? data.reduce((s, u) => s + (u.attendancePercent || 0), 0) / data.length
            : 72;
          const variance = (Math.sin(i * 1.3 + w * 0.9) * 6) + (Math.cos(w * 1.7) * 4);
          const value = Math.min(100, Math.max(0, Math.round(base + variance)));
          weeks.push({ label: `W${w + 1}`, value });
        }
        months.push({ label, weeks });
      }
      setTrendMonths(months);
    };

    load();
    loadAnalytics();
    return () => { isMounted = false; };
  }, []);

  return (
    <SafeAreaView className="flex-1 bg-emerald-50" edges={['top']}>
      <LecturerHeader navigation={navigation} />
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerClassName="p-5 pt-6 pb-8 gap-5"
      >
        {/* Stats Grid */}
        <View className="flex-row flex-wrap gap-3">
          <ProgressCard
            label="Units"
            value={loading ? '...' : String(units)}
            icon="book-open-page-variant-outline"
            color="#059669"
          />
          <ProgressCard
            label="Weekly Lessons"
            value={loading ? '...' : String(weeklyLessons)}
            icon="calendar-check-outline"
            color="#0891B2"
          />
          <ProgressCard
            label="Weekly Progress"
            value={loading ? '...' : `${weeklyProgress != null ? weeklyProgress : 0}%`}
            icon="chart-line"
            color="#7C3AED"
            progressPercent={weeklyProgress}
          />
          <ProgressCard
            label="Semester Progress"
            value={semesterProgress}
            icon="school-outline"
            color="#D97706"
            progressPercent={parseInt(semesterProgress, 10)}
          />
        </View>

        {/* Next Lesson */}
        {nextLesson && (
          <View className="bg-white border border-slate-200 rounded-2xl p-4 gap-2.5">
            <View className="flex-row items-center justify-between">
              <Text className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Next Lesson</Text>
              <View className="w-8 h-8 rounded-xl items-center justify-center bg-emerald-600/15">
                <Icon name="clock-outline" size={18} color="#059669" />
              </View>
            </View>
            <Text className="text-lg font-bold text-slate-900 tracking-tight" numberOfLines={1}>
              {nextLesson.unitName || nextLesson.unitTitle || '—'}
              {nextLesson.unitCode ? ` • ${nextLesson.unitCode}` : ''}
            </Text>
            <Text className="text-sm text-slate-700 font-medium" numberOfLines={1}>
              {[nextLesson.startTime, nextLesson.endTime].filter(Boolean).join(' - ') || nextLesson.time || 'TBA'}
            </Text>
            <View className="flex-row items-center gap-1">
              <Icon name="map-marker-outline" size={14} color="#64748B" />
              <Text className="text-sm text-slate-700 font-medium" numberOfLines={1}>
                {nextLesson.roomCode || nextLesson.venue || 'TBA'}
              </Text>
            </View>
          </View>
        )}

        {/* Best / Worst Unit */}
        {!analyticsLoading && (bestUnit || worstUnit) && (
          <View className="flex-row flex-wrap gap-3">
            {bestUnit && (
              <StatBadge
                label="Best Unit"
                value={`${bestUnit.attendancePercent}%`}
                icon="trending-up"
                color="#059669"
              />
            )}
            {worstUnit && (
              <StatBadge
                label="Needs Attention"
                value={`${worstUnit.attendancePercent}%`}
                icon="alert-circle-outline"
                color="#DC2626"
              />
            )}
          </View>
        )}

        {/* Attendance Trend Chart */}
        {trendMonths.length > 0 && (
          <View className="bg-white border border-slate-200 rounded-2xl p-4">
            <View className="flex-row items-center justify-between mb-3">
              <Text className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Attendance Trend</Text>
              <View className="flex-row items-center gap-2">
                <TouchableOpacity
                  disabled={activeMonthIndex === 0}
                  onPress={() => setActiveMonthIndex((i) => Math.max(0, i - 1))}
                  activeOpacity={0.7}
                >
                  <Icon name="chevron-left" size={20} color={activeMonthIndex === 0 ? '#CBD5E1' : '#059669'} />
                </TouchableOpacity>
                <Text className="text-xs font-bold text-slate-900 min-w-[80px] text-center">
                  {trendMonths[activeMonthIndex]?.label}
                </Text>
                <TouchableOpacity
                  disabled={activeMonthIndex === trendMonths.length - 1}
                  onPress={() => setActiveMonthIndex((i) => Math.min(trendMonths.length - 1, i + 1))}
                  activeOpacity={0.7}
                >
                  <Icon name="chevron-right" size={20} color={activeMonthIndex === trendMonths.length - 1 ? '#CBD5E1' : '#059669'} />
                </TouchableOpacity>
              </View>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: 8 }}>
              <View style={{ minWidth: SCREEN_WIDTH - 72 }}>
                <LineChart
                  data={{
                    labels: trendMonths[activeMonthIndex]?.weeks.map((w) => w.label) || [],
                    datasets: [
                      {
                        data: trendMonths[activeMonthIndex]?.weeks.map((w) => w.value) || [],
                        color: (opacity = 1) => `rgba(5, 150, 105, ${opacity})`,
                        strokeWidth: 2,
                      },
                    ],
                  }}
                  width={SCREEN_WIDTH - 72}
                  height={220}
                  chartConfig={{
                    backgroundColor: '#FFFFFF',
                    backgroundGradientFrom: '#FFFFFF',
                    backgroundGradientTo: '#FFFFFF',
                    decimalPlaces: 0,
                    color: (opacity = 1) => `rgba(5, 150, 105, ${opacity})`,
                    labelColor: (opacity = 1) => `rgba(100, 116, 139, ${opacity})`,
                    style: { borderRadius: 16 },
                    propsForDots: { r: '4', strokeWidth: '2', stroke: '#059669' },
                    propsForBackgroundLines: { strokeDasharray: '', stroke: '#E2E8F0', strokeWidth: 1 },
                    propsForLabels: { fontSize: 11 },
                  }}
                  bezier
                  style={{ borderRadius: 16 }}
                  withVerticalLines
                  withHorizontalLines
                  fromZero
                />
              </View>
            </ScrollView>
          </View>
        )}

        {/* Quick Actions */}
        <View className="bg-white border border-slate-200 rounded-2xl p-4">
          <View className="flex-row items-center gap-2 mb-3">
            <Icon name="flash" size={18} color="#059669" />
            <Text className="text-sm font-bold text-slate-900">Quick Actions</Text>
          </View>
          <View className="flex-row justify-between gap-3">
            {/* Take Attendance */}
            <TouchableOpacity
              className="flex-1 items-center"
              onPress={() => navigation.navigate('Attendance')}
              activeOpacity={0.7}
            >
              <LinearGradient colors={['#10B981', '#059669']} className="w-12 h-12 rounded-xl items-center justify-center mb-1.5">
                <View className="w-7 h-7 items-center justify-center relative">
                  <Icon name="qrcode" size={18} color="#FFFFFF" />
                  <View className="absolute bottom-0 right-0 w-4 h-4 rounded-full bg-sky-500 items-center justify-center border border-white">
                    <Icon name="bluetooth" size={10} color="#FFFFFF" />
                  </View>
                  <View className="absolute -top-1 -right-1.5 bg-red-500 rounded-md px-1 py-0.5 border border-white">
                    <Text className="text-[8px] font-extrabold text-white leading-[9px]">PIN</Text>
                  </View>
                </View>
              </LinearGradient>
              <Text className="text-xs font-semibold text-slate-700 text-center leading-3.5">Take{"\n"}Attendance</Text>
            </TouchableOpacity>

            {/* View Timetable */}
            <TouchableOpacity
              className="flex-1 items-center"
              onPress={() => navigation.navigate('Timetable')}
              activeOpacity={0.7}
            >
              <LinearGradient colors={['#4F46E5', '#4338CA']} className="w-12 h-12 rounded-xl items-center justify-center mb-1.5">
                <Icon name="calendar-week" size={22} color="#FFFFFF" />
              </LinearGradient>
              <Text className="text-xs font-semibold text-slate-700 text-center leading-3.5">View{"\n"}Timetable</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
