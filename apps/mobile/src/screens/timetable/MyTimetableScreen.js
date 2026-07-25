// FILE: src/screens/timetable/MyTimetableScreen.js
import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEnrollment } from '../../context/EnrollmentContext';
import { useStudentTimetableSync } from '../../hooks/useStudentTimetableSync';

import { getLessonTypeByName } from '../../utils/constants';
import themeColors from '../../theme/colors';
import { useColors } from '../../theme';

const colors = {
  ...themeColors,
  bg:          { primary: themeColors.background.primary, secondary: themeColors.background.secondary },
  confirmed:   themeColors.success,
  pending:     themeColors.info,
  cancelled:   themeColors.danger,
  rescheduled: themeColors.warning,
  online:      themeColors.teal,
};


const statusConfig = {
  Confirmed:   { ...colors.confirmed, icon: 'check-circle',    label: 'Confirmed'   },
  Pending:     { ...colors.pending,   icon: 'clock-outline',   label: 'Pending'     },
  Cancelled:   { ...colors.cancelled, icon: 'close-circle',    label: 'Cancelled'   },
  Rescheduled: { ...colors.rescheduled, icon: 'calendar-refresh', label: 'Rescheduled' },
  Online:      { ...colors.online,    icon: 'video',           label: 'Online'      },
  default:     { main: '#64748B', light: '#94A3B8', gradient: ['#64748B','#475569'], soft: 'rgba(100,116,139,0.14)', icon: 'help-circle', label: 'Unknown' },
};

// ── Helpers (unchanged logic) ────────────────────────────────────────────────
const getLastWeekReset = () => {
  const d = new Date();
  const daysBack = d.getDay() === 6 ? 0 : d.getDay() + 1;
  d.setDate(d.getDate() - daysBack);
  d.setHours(0, 0, 0, 0);
  return d;
};

const WEEKLY_STATUSES = new Set(['Cancelled', 'Rescheduled', 'Online']);

const parseRescheduledTo = (rescheduledTo) => {
  if (!rescheduledTo) return { time: null, roomCode: null };
  const dotIdx = rescheduledTo.indexOf('·');
  if (dotIdx !== -1) {
    return {
      time: rescheduledTo.slice(0, dotIdx).trim() || null,
      roomCode: rescheduledTo.slice(dotIdx + 1).trim() || null,
    };
  }
  return { time: rescheduledTo.trim() || null, roomCode: null };
};

const getEffectiveStatus = (lesson) => {
  const stored = String(lesson?.status || 'Pending').trim() || 'Pending';
  if (!WEEKLY_STATUSES.has(stored)) return stored;
  const updatedAt = lesson?.updatedAt ? new Date(lesson.updatedAt) : null;
  if (!updatedAt || Number.isNaN(updatedAt.getTime())) return 'Pending';
  return updatedAt >= getLastWeekReset() ? stored : 'Pending';
};

const DAYS_FULL  = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const DAYS_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
// Mon-first ordered list used for display and sorting
const WEEK_ORDER = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function MyTimetableScreen() {
  const dynColors = useColors();
  const C = useMemo(() => ({
    bg:             dynColors.background.primary,
    bgSec:          dynColors.background.secondary,
    surface:        dynColors.surface.primary,
    surfaceCard:    dynColors.surface.card,
    surfaceElevated:dynColors.surface.elevated,
    border:         dynColors.border.light,
    borderMed:      dynColors.border.medium,
    primary:        dynColors.primary.main,
    primaryD:       dynColors.primary.dark,
    success:        dynColors.success.main,
    warning:        dynColors.warning.main,
    warningLight:   dynColors.warning.light,
    danger:         dynColors.danger.main,
    text:           dynColors.text.primary,
    textSec:        dynColors.text.secondary,
    textTer:        dynColors.text.muted,
  }), [dynColors]);
  const styles = useMemo(() => makeStyles(C), [C]);

  // Sub-components that depend on `styles`
  const StatusBadge = ({ status }) => {
    const cfg = statusConfig[status] || statusConfig.default;
    return (
      <View style={[styles.statusBadge, { backgroundColor: cfg.soft }]}>
        <Icon name={cfg.icon} size={11} color={cfg.main} />
        <Text style={[styles.statusBadgeText, { color: cfg.main }]}>{cfg.label}</Text>
      </View>
    );
  };

  const DayCell = ({ dayShort, date, lessonCount, isActive, isToday, onPress }) => {
    const dayNum = date.getDate();
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.75} style={styles.dayCellOuter}>
        {isActive ? (
          <LinearGradient colors={colors.primary.gradient} style={styles.dayCellActive}>
            <Text style={styles.dayCellShortActive}>{dayShort}</Text>
            <Text style={styles.dayCellNumActive}>{dayNum}</Text>
            <View style={styles.dayCellDot}>
              <Text style={styles.dayCellDotTextActive}>{lessonCount || '·'}</Text>
            </View>
          </LinearGradient>
        ) : (
          <View style={[styles.dayCellInactive, isToday && styles.dayCellToday]}>
            <Text style={[styles.dayCellShort, isToday && { color: colors.primary.light }]}>
              {dayShort}
            </Text>
            <Text style={[styles.dayCellNum, isToday && { color: colors.primary.main }]}>
              {dayNum}
            </Text>
            <View style={[
              styles.dayCellDot,
              lessonCount > 0
                ? (isToday ? { backgroundColor: `${colors.primary.main}25` } : { backgroundColor: colors.surface.elevated })
                : { backgroundColor: 'transparent' },
            ]}>
              <Text style={[
                styles.dayCellDotText,
                lessonCount > 0 && isToday && { color: colors.primary.light },
                lessonCount === 0 && { color: 'transparent' },
              ]}>
                {lessonCount || '·'}
              </Text>
            </View>
          </View>
        )}
        {isToday && !isActive && <View style={styles.todayPip} />}
      </TouchableOpacity>
    );
  };

  const FilterChip = ({ id, label, icon, color, count, active, onPress, style }) => (
    <TouchableOpacity onPress={onPress} activeOpacity={0.75} style={style}>
      {active ? (
        <LinearGradient
          colors={[color, `${color}BB`]}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={styles.filterChipActive}
        >
          <Icon name={icon} size={18} color="#FFF" />
          <Text style={styles.filterChipTextActive} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{label}</Text>
          {count > 0 && (
            <View style={styles.filterChipBadge}>
              <Text style={styles.filterChipBadgeText}>{count}</Text>
            </View>
          )}
        </LinearGradient>
      ) : (
        <View style={styles.filterChipInactive}>
          <Icon name={icon} size={18} color={colors.text.secondary} />
          <Text style={styles.filterChipTextInactive} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{label}</Text>
          {count > 0 && (
            <View style={[styles.filterChipBadgeInactive, { backgroundColor: `${color}20` }]}>
              <Text style={[styles.filterChipBadgeTextInactive, { color }]}>{count}</Text>
            </View>
          )}
        </View>
      )}
    </TouchableOpacity>
  );

  const LessonCard = ({ lesson, formatRelativeTime }) => {
    const cfg = statusConfig[lesson.status] || statusConfig.default;
    const lt = getLessonTypeByName(lesson.type);
    const unitCode = lesson.unit.split('(')[1]?.replace(')', '') || lesson.unitCode || 'N/A';
    const unitName = lesson.unit.split('(')[0].trim();

    return (
      <View style={[styles.lessonCard, { borderLeftColor: cfg.main }]}>
        {/* Top row: time + status badge */}
        <View style={styles.lessonTopRow}>
          <View style={styles.lessonTimeGroup}>
            <Icon name="clock-outline" size={12} color={colors.text.muted} />
            <Text style={[
              styles.lessonTimeText,
              lesson.status === 'Rescheduled' && styles.lessonTimeStruck,
            ]}>
              {lesson.time}
            </Text>
          </View>
          <View style={styles.lessonBadgeRow}>
            {!!lesson.isExtraSession && (
              <View style={styles.makeupBadge}>
                <Text style={styles.makeupBadgeText}>Make-Up</Text>
              </View>
            )}
            <StatusBadge status={lesson.status} />
          </View>
        </View>

        {/* Unit info */}
        <View style={styles.unitRow}>
          <Text style={[styles.unitCode, { color: cfg.main }]}>{unitCode}</Text>
          <Text style={styles.updateText}>
            <Icon name="update" size={10} color={colors.text.muted} /> {formatRelativeTime(lesson.lastUpdated)}
          </Text>
        </View>
        <Text style={styles.unitName} numberOfLines={2}>{unitName}</Text>

        {/* Details */}
        <View style={styles.detailsRow}>
          <View style={[styles.typePill, { backgroundColor: lt.color + '20', borderColor: lt.color + '50' }]}>
            <Icon name={lt.mcIcon} size={11} color={lt.color} />
            <Text style={[styles.typePillText, { color: lt.color }]}>{lt.label}</Text>
          </View>
          <View style={styles.detailDivider} />
          <Icon name="map-marker-outline" size={12} color={colors.text.muted} />
          <Text style={styles.detailText} numberOfLines={1}>
            {lesson.roomCode || lesson.venue || 'TBA'}
          </Text>
        </View>

        <View style={styles.lecturerRow}>
          <Icon name="account-outline" size={12} color={colors.text.muted} />
          <Text style={styles.lecturerText} numberOfLines={1}>{lesson.lecturer || 'Lecturer TBA'}</Text>
        </View>

        {/* Status-specific panels */}
        {lesson.status === 'Cancelled' && (
          <View style={[styles.statusPanel, { backgroundColor: colors.cancelled.soft, borderColor: 'rgba(239,68,68,0.2)' }]}>
            <Icon name="close-circle-outline" size={13} color={colors.cancelled.main} />
            <Text style={[styles.statusPanelText, { color: colors.cancelled.light }] }>
              {lesson.reason || 'This lesson has been cancelled'}
            </Text>
          </View>
        )}

        {lesson.status === 'Pending' && (
          <View style={[styles.statusPanel, { backgroundColor: colors.pending.soft, borderColor: 'rgba(59,130,246,0.2)' }]}>
            <Icon name="clock-alert-outline" size={13} color={colors.pending.main} />
            <Text style={[styles.statusPanelText, { color: colors.pending.light }]}>
              {lesson.pendingReason || 'Awaiting confirmation from lecturer'}
            </Text>
          </View>
        )}

        {lesson.status === 'Online' && (
          <View style={[styles.statusPanel, { backgroundColor: colors.online.soft, borderColor: 'rgba(20,184,166,0.2)' }]}>
            <Icon name="video-outline" size={13} color={colors.online.main} />
            <Text style={[styles.statusPanelText, { color: colors.online.light }]}>
              Online lecture — join link will be shared when the session starts
            </Text>
          </View>
        )}

        {lesson.status === 'Rescheduled' && (() => {
          const { time: newTime, roomCode: newRoom } = parseRescheduledTo(lesson.rescheduledTo);
          return (
            <View style={styles.rescheduleBanner}>
              <View style={styles.rescheduleHeader}>
                <Icon name="calendar-refresh" size={14} color={colors.rescheduled.main} />
                <Text style={styles.rescheduleHeaderText}>Rescheduled</Text>
                {lesson.reschedulePermanent != null && (
                  <View style={[
                    styles.rescheduleScopeBadge,
                    { backgroundColor: lesson.reschedulePermanent ? 'rgba(245,158,11,0.2)' : 'rgba(59,130,246,0.2)' },
                  ]}>
                    <Text style={[
                      styles.rescheduleScopeText,
                      { color: lesson.reschedulePermanent ? colors.rescheduled.main : colors.pending.main },
                    ]}>
                      {lesson.reschedulePermanent ? 'Permanent' : 'This week'}
                    </Text>
                  </View>
                )}
              </View>
              <View style={styles.rescheduleColumns}>
                <View style={styles.rescheduleCol}>
                  <View style={styles.rescheduleColLabel}>
                    <Icon name="close-circle-outline" size={11} color={colors.cancelled.main} />
                    <Text style={[styles.rescheduleColLabelText, { color: colors.cancelled.main }]}>WAS</Text>
                  </View>
                  <Text style={styles.rescheduleOldTime}>{lesson.time || 'TBA'}</Text>
                  <View style={styles.rescheduleVenueRow}>
                    <Icon name="map-marker-outline" size={11} color={colors.text.muted} />
                    <Text style={styles.rescheduleOldVenue} numberOfLines={1}>
                      {lesson.roomCode || lesson.venue || 'TBA'}
                    </Text>
                  </View>
                </View>
                <View style={styles.rescheduleArrow}>
                  <Icon name="arrow-right-bold" size={20} color={colors.rescheduled.main} />
                </View>
                <View style={styles.rescheduleCol}>
                  <View style={styles.rescheduleColLabel}>
                    <Icon name="check-circle-outline" size={11} color={colors.confirmed.main} />
                    <Text style={[styles.rescheduleColLabelText, { color: colors.confirmed.main }]}>NOW</Text>
                  </View>
                  <Text style={styles.rescheduleNewTime}>{newTime || lesson.rescheduledTo || 'TBA'}</Text>
                  <View style={styles.rescheduleVenueRow}>
                    <Icon name="map-marker" size={11} color={colors.rescheduled.main} />
                    <Text style={styles.rescheduleNewVenue} numberOfLines={1}>
                      {newRoom || lesson.rescheduledVenue || lesson.roomCode || lesson.venue || 'TBA'}
                    </Text>
                  </View>
                </View>
              </View>
            </View>
          );
        })()}
      </View>
    );
  };

  const { enrolledUnits } = useEnrollment();
  const {
    isLoading: isSyncLoading,
    error: syncError,
    timetableByDay,
    updatedAt,
    refresh: refreshTimetable,
  } = useStudentTimetableSync();
  const [refreshing, setRefreshing] = useState(false);
  const [selectedFilter, setSelectedFilter] = useState('all');
  const [activeDay, setActiveDay] = useState(null);
  const [stats, setStats] = useState({ total: 0, confirmed: 0, pending: 0, cancelled: 0, rescheduled: 0, online: 0 });

  const enhancedTimetable = useMemo(() => {
    const now = Date.now();
    return (Array.isArray(timetableByDay) ? timetableByDay : []).map((day) => ({
      ...day,
      lessons: (Array.isArray(day?.lessons) ? day.lessons : []).map((lesson) => ({
        ...lesson,
        status: getEffectiveStatus(lesson),
        lastUpdated: lesson?.updatedAt ? new Date(lesson.updatedAt) : updatedAt ? new Date(updatedAt) : new Date(now),
        updatedBy: lesson?.updatedBy || lesson?.lecturer || 'Lecturer',
      })),
    }));
  }, [timetableByDay, updatedAt]);

  const scopedEnrolledUnits = useMemo(() => {
    const backendCodes = new Set();
    enhancedTimetable.forEach((day) => {
      (day?.lessons || []).forEach((lesson) => {
        const code = String(lesson?.unitCode || '').trim().toUpperCase();
        if (code) backendCodes.add(code);
      });
    });
    return enrolledUnits.filter((unit) => backendCodes.has(String(unit || '').trim().toUpperCase()));
  }, [enrolledUnits, enhancedTimetable]);

  React.useEffect(() => {
    const todayName = DAYS_FULL[new Date().getDay()];
    setActiveDay(todayName);
  }, [scopedEnrolledUnits]);

  useEffect(() => {
    let total = 0, confirmed = 0, pending = 0, cancelled = 0, rescheduled = 0, online = 0;
    enhancedTimetable.forEach(day => {
      day.lessons.forEach(lesson => {
        if (scopedEnrolledUnits.includes(lesson.unitCode)) {
          total++;
          if (lesson.status === 'Confirmed') confirmed++;
          else if (lesson.status === 'Pending') pending++;
          else if (lesson.status === 'Cancelled') cancelled++;
          else if (lesson.status === 'Rescheduled') rescheduled++;
          else if (lesson.status === 'Online') online++;
        }
      });
    });
    setStats({ total, confirmed, pending, cancelled, rescheduled, online });
  }, [scopedEnrolledUnits, enhancedTimetable]);

  const onRefresh = () => {
    setRefreshing(true);
    refreshTimetable().finally(() => setRefreshing(false));
  };

  const formatDate = (date) => {
    const parsed = date instanceof Date ? date : new Date(date || Date.now());
    if (Number.isNaN(parsed.getTime())) return '--:--';
    return parsed.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  const formatRelativeTime = (date) => {
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const getFilteredDays = () => {
    const days = enhancedTimetable.map(day => ({
      ...day,
      lessons: day.lessons.filter(lesson => {
        if (lesson.isExtraSession) {
          return selectedFilter === 'all' || lesson.status.toLowerCase() === selectedFilter;
        }
        if (!scopedEnrolledUnits.includes(lesson.unitCode)) return false;
        return selectedFilter === 'all' || lesson.status.toLowerCase() === selectedFilter;
      }),
    })).filter(day => day.lessons.length > 0);

    // Always display Mon → Sun order (never reorder by active day)
    return days.sort((a, b) => WEEK_ORDER.indexOf(a.day) - WEEK_ORDER.indexOf(b.day));
  };

  const filteredDays = activeDay
    ? getFilteredDays().filter(day => day.day === activeDay)
    : getFilteredDays();

  const getLessonCountForDay = (dayName) => {
    const dayData = enhancedTimetable.find(d => d.day === dayName);
    return (dayData?.lessons || []).filter(l => scopedEnrolledUnits.includes(l.unitCode)).length;
  };

  const filters = [
    { id: 'all',        label: 'All',         icon: 'view-grid-outline',  color: colors.primary.main,        count: stats.total },
    { id: 'confirmed',  label: 'Confirmed',   icon: 'check-circle',       color: colors.confirmed.main,      count: stats.confirmed },
    { id: 'pending',    label: 'Pending',     icon: 'clock-outline',      color: colors.pending.main,        count: stats.pending },
    { id: 'online',     label: 'Online',      icon: 'video-outline',      color: colors.online.main,         count: stats.online },
    { id: 'rescheduled',label: 'Rescheduled', icon: 'calendar-refresh',   color: colors.rescheduled.main,    count: stats.rescheduled },
    { id: 'cancelled',  label: 'Cancelled',   icon: 'close-circle-outline', color: colors.cancelled.main,   count: stats.cancelled },
  ];

  const today = new Date();
  const todayDayName = DAYS_FULL[today.getDay()];

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      {/* ── Info bar: units + filter chips ── */}
      <View style={styles.infoBar}>
        <View style={styles.infoBarTop}>
          <Icon name="layers-outline" size={13} color={colors.text.muted} />
          <Text style={styles.infoBarText}>
            {scopedEnrolledUnits.length} unit{scopedEnrolledUnits.length !== 1 ? 's' : ''}
            {updatedAt ? `  ·  synced ${formatDate(updatedAt)}` : ''}
          </Text>
        </View>

        {scopedEnrolledUnits.length > 0 && (
          <View style={styles.filterGrid}>
            {filters.map(f => (
              <FilterChip
                key={f.id}
                {...f}
                style={styles.filterGridItem}
                active={selectedFilter === f.id}
                onPress={() => setSelectedFilter(f.id)}
              />
            ))}
          </View>
        )}
      </View>

      {/* ── Day Grid + Filters ── */}
      {scopedEnrolledUnits.length > 0 && (
        <View style={styles.controlsArea}>
          {/* Header row: context label + clear */}
          <View style={styles.dayGridHeader}>
            <Text style={styles.dayGridLabel} numberOfLines={1}>
              {activeDay
                ? `${activeDay} · ${getLessonCountForDay(activeDay)} lesson${getLessonCountForDay(activeDay) !== 1 ? 's' : ''}`
                : 'Tap a day to filter'}
            </Text>

            {activeDay && (
              <TouchableOpacity onPress={() => setActiveDay(null)} style={styles.clearDayBtn}>
                <Icon name="close-circle" size={16} color={colors.text.muted} />
              </TouchableOpacity>
            )}
          </View>

          {/* Fixed 7-column day grid — no horizontal scroll */}
          <View style={styles.dayGrid}>
            {WEEK_ORDER.map((dayName) => {
              const dayIdx   = DAYS_FULL.indexOf(dayName);
              const isActive = activeDay === dayName;
              const isToday  = dayName === todayDayName;
              const diff = dayIdx - today.getDay();
              const date = new Date(today);
              date.setDate(today.getDate() + (diff < 0 ? diff + 7 : diff));
              const count = getLessonCountForDay(dayName);
              return (
                <DayCell
                  key={dayName}
                  dayShort={DAYS_SHORT[dayIdx]}
                  date={date}
                  lessonCount={count}
                  isActive={isActive}
                  isToday={isToday}
                  onPress={() => setActiveDay(isActive ? null : dayName)}
                />
              );
            })}
          </View>

</View>
      )}

      {/* ── Lesson List ── */}
      <ScrollView
        style={styles.listArea}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary.main}
            colors={[colors.primary.main]}
          />
        }
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
      >
        {isSyncLoading ? (
          <View style={styles.stateContainer}>
            <Icon name="progress-clock" size={48} color={colors.text.muted} />
            <Text style={styles.stateTitle}>Loading Timetable</Text>
            <Text style={styles.stateSubtitle}>Fetching latest timetable data…</Text>
          </View>
        ) : syncError ? (
          <View style={styles.stateContainer}>
            <Icon name="alert-circle-outline" size={48} color={colors.rescheduled.main} />
            <Text style={styles.stateTitle}>Unavailable</Text>
            <Text style={styles.stateSubtitle}>{syncError}</Text>
          </View>
        ) : scopedEnrolledUnits.length === 0 ? (
          <View style={styles.stateContainer}>
            <LinearGradient colors={[colors.surface.elevated, colors.surface.card]} style={styles.stateIconBg}>
              <Icon name="calendar-blank-outline" size={44} color={colors.text.muted} />
            </LinearGradient>
            <Text style={styles.stateTitle}>No Timetable Yet</Text>
            <Text style={styles.stateSubtitle}>
              Enroll in units to receive timetable updates.
            </Text>
          </View>
        ) : filteredDays.length === 0 ? (
          <View style={styles.stateContainer}>
            <LinearGradient colors={[colors.surface.elevated, colors.surface.card]} style={styles.stateIconBg}>
              <Icon name="filter-off-outline" size={40} color={colors.text.muted} />
            </LinearGradient>
            <Text style={styles.stateTitle}>Nothing here</Text>
            <Text style={styles.stateSubtitle}>
              No {selectedFilter !== 'all' ? selectedFilter : ''} lessons on {activeDay || 'selected days'}
            </Text>
          </View>
        ) : (
          filteredDays.map((day) => (
            <View key={day.day} style={styles.daySection}>
              {!activeDay && (
                <View style={styles.daySectionHeader}>
                  <View style={styles.daySectionDot} />
                  <Text style={styles.daySectionName}>{day.day}</Text>
                  <View style={styles.daySectionLine} />
                  <View style={styles.daySectionCount}>
                    <Text style={styles.daySectionCountText}>{day.lessons.length}</Text>
                  </View>
                </View>
              )}
              {day.lessons.map((lesson) => (
                <LessonCard
                  key={lesson.id}
                  lesson={lesson}
                  formatRelativeTime={formatRelativeTime}
                />
              ))}
            </View>
          ))
        )}
        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const makeStyles = (C) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },

  // ── Info bar (replaces standalone header) ──
  infoBar: {
    backgroundColor: C.bgSec,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  infoBarTop: {
    flexDirection: 'row', alignItems: 'center',
    gap: 5, marginBottom: 10,
  },
  infoBarText: { fontSize: 12, color: C.textTer, fontWeight: '500' },

  filterGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  filterGridItem: {
    width: '32%',
  },

  // ── Controls ──
  controlsArea: {
    backgroundColor: C.bgSec,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },

  // Fixed 7-column day grid (no horizontal scroll)
  dayGrid: {
    flexDirection: 'row',
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 6,
    gap: 4,
  },
  dayCellOuter: { flex: 1, position: 'relative' },
  dayCellActive: {
    borderRadius: 12, alignItems: 'center',
    paddingVertical: 8, gap: 2,
  },
  dayCellInactive: {
    borderRadius: 12, alignItems: 'center',
    paddingVertical: 8, gap: 2,
    backgroundColor: C.surfaceCard,
    borderWidth: 1, borderColor: C.border,
  },
  dayCellToday: { borderColor: `${C.primary}55` },
  dayCellShortActive: { fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.8)' },
  dayCellNumActive: { fontSize: 16, fontWeight: '800', color: '#FFF' },
  dayCellShort: { fontSize: 10, fontWeight: '600', color: C.textTer },
  dayCellNum: { fontSize: 16, fontWeight: '700', color: C.text },
  dayCellDot: {
    borderRadius: 6, paddingHorizontal: 4, paddingVertical: 1,
    minWidth: 16, alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  dayCellDotTextActive: { fontSize: 9, fontWeight: '800', color: '#FFF' },
  dayCellDotText: { fontSize: 9, fontWeight: '700', color: C.textSec },
  todayPip: {
    position: 'absolute', top: 3, right: 3,
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: C.primary,
  },

  // ── "All" header row above day grid ──
  dayGridHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 10, paddingTop: 8, paddingBottom: 4, gap: 8,
  },
  dayGridLabel: { flex: 1, fontSize: 12, color: C.textSec, fontWeight: '500' },
  clearDayBtn: { padding: 2 },

  filterChipActive: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingVertical: 8, paddingHorizontal: 6, borderRadius: 12,
  },
  filterChipInactive: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingVertical: 8, paddingHorizontal: 6, borderRadius: 12,
    backgroundColor: C.surfaceCard,
    borderWidth: 1, borderColor: C.borderMed,
  },
  filterChipTextActive: { fontSize: 11, fontWeight: '700', color: '#FFF', flexShrink: 1 },
  filterChipTextInactive: { fontSize: 11, fontWeight: '600', color: C.textSec, flexShrink: 1 },
  filterChipBadge: {
    backgroundColor: 'rgba(255,255,255,0.28)',
    borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1, minWidth: 18, alignItems: 'center',
  },
  filterChipBadgeText: { fontSize: 10, fontWeight: '800', color: '#FFF' },
  filterChipBadgeInactive: {
    borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1, minWidth: 18, alignItems: 'center',
  },
  filterChipBadgeTextInactive: { fontSize: 10, fontWeight: '800' },

  // ── Lesson List ──
  listArea: { flex: 1 },
  listContent: { paddingHorizontal: 14, paddingTop: 12 },

  // Day section header
  daySection: { marginBottom: 10 },
  daySectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginBottom: 10,
  },
  daySectionDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.primary },
  daySectionName: { fontSize: 13, fontWeight: '700', color: C.textSec, letterSpacing: 0.5, textTransform: 'uppercase' },
  daySectionLine: { flex: 1, height: 1, backgroundColor: C.border },
  daySectionCount: {
    backgroundColor: C.surfaceElevated, borderRadius: 8,
    paddingHorizontal: 7, paddingVertical: 2,
  },
  daySectionCountText: { fontSize: 10, fontWeight: '700', color: C.textSec },

  // ── Lesson Card ──
  lessonCard: {
    backgroundColor: C.surfaceCard,
    borderRadius: 16, marginBottom: 10,
    borderLeftWidth: 3,
    borderWidth: 1, borderColor: C.border,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  lessonTopRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 8,
  },
  lessonTimeGroup: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  lessonTimeText: { fontSize: 13, fontWeight: '700', color: C.textSec },
  lessonTimeStruck: { textDecorationLine: 'line-through', color: C.textTer },
  lessonBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },

  statusBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8,
  },
  statusBadgeText: { fontSize: 11, fontWeight: '700' },

  makeupBadge: {
    backgroundColor: 'rgba(16,185,129,0.15)',
    borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3,
    borderWidth: 1, borderColor: 'rgba(16,185,129,0.3)',
  },
  makeupBadgeText: { fontSize: 10, fontWeight: '700', color: C.success },

  unitRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 },
  unitCode: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  updateText: { fontSize: 10, color: C.textTer },

  unitName: { fontSize: 16, fontWeight: '700', color: C.text, lineHeight: 22, marginBottom: 10 },

  detailsRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginBottom: 6, flexWrap: 'wrap',
  },
  typePill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 8, borderWidth: 1,
  },
  typePillText: { fontSize: 11, fontWeight: '700' },
  detailDivider: { width: 1, height: 12, backgroundColor: C.borderMed },
  detailText: { fontSize: 12, color: C.textSec, flex: 1 },

  lecturerRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  lecturerText: { fontSize: 12, color: C.textSec, flex: 1 },

  // Status panels
  statusPanel: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    marginTop: 10, borderRadius: 10, padding: 10, borderWidth: 1,
  },
  statusPanelText: { fontSize: 12, lineHeight: 17, flex: 1 },

  // Rescheduled banner
  rescheduleBanner: {
    marginTop: 10,
    backgroundColor: 'rgba(245,158,11,0.08)',
    borderWidth: 1, borderColor: 'rgba(245,158,11,0.25)',
    borderRadius: 12, padding: 12, gap: 10,
  },
  rescheduleHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rescheduleHeaderText: { fontSize: 13, fontWeight: '700', color: C.warning, flex: 1 },
  rescheduleScopeBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  rescheduleScopeText: { fontSize: 11, fontWeight: '700' },
  rescheduleColumns: { flexDirection: 'row', alignItems: 'center' },
  rescheduleCol: { flex: 1, gap: 4 },
  rescheduleColLabel: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rescheduleColLabelText: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8 },
  rescheduleArrow: { paddingHorizontal: 8, alignItems: 'center' },
  rescheduleOldTime: { fontSize: 15, color: C.textTer, fontWeight: '700', textDecorationLine: 'line-through' },
  rescheduleNewTime: { fontSize: 16, color: C.warningLight, fontWeight: '800' },
  rescheduleVenueRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  rescheduleOldVenue: { fontSize: 12, color: C.textTer, textDecorationLine: 'line-through', flex: 1 },
  rescheduleNewVenue: { fontSize: 12, color: C.warning, fontWeight: '600', flex: 1 },

  // ── States ──
  stateContainer: { alignItems: 'center', paddingVertical: 60, paddingHorizontal: 32 },
  stateIconBg: {
    width: 88, height: 88, borderRadius: 44,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 20, borderWidth: 1, borderColor: C.borderMed,
  },
  stateTitle: { fontSize: 18, fontWeight: '800', color: C.text, marginBottom: 8, textAlign: 'center' },
  stateSubtitle: { fontSize: 13, color: C.textTer, textAlign: 'center', lineHeight: 20 },
});
