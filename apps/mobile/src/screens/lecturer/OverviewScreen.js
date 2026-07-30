// src/screens/lecturer/OverviewScreen.js
// REDESIGNED — SQLite-first, minimal API calls, optimized rendering
import React, { useState, useCallback, useEffect, useMemo, useRef, memo } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Animated, RefreshControl, ActivityIndicator,
  StatusBar, Modal, KeyboardAvoidingView, TextInput, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useColors, useTheme } from '../../theme';
import LecturerHeader from '../../components/LecturerHeader';
import OfflineBanner from '../../components/OfflineBanner';
import sqliteStorage, { initDatabase } from '../../storage/sqliteStorage';
import { getLecturerSession } from '../../utils/authSession';
import useResponsive from '../../hooks/useResponsive';
import useInternetStatus from '../../hooks/useInternetStatus';
import useSyncOnReconnect from '../../hooks/useSyncOnReconnect';
import { API_BASE_URL } from '../../utils/constants';

// ─── Constants ────────────────────────────────────────────────────────────────
const SP = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 };
const FW = { regular: '400', medium: '500', semibold: '600', bold: '700', extrabold: '800' };
const LECTURER_OVERVIEW_KEY = 'lecturer_overview_cache_v2';
const STALE_MS = 5 * 60 * 1000;
const API_BATCH = '/api/lecturer/overview/batch';

// ─── Utilities ────────────────────────────────────────────────────────────────
const toKey = (code) => String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const formatTime = (t) => {
  if (!t) return '--:--';
  const [h, m] = t.split(':').map(Number);
  if (isNaN(h)) return t;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(m || 0).padStart(2, '0')} ${ampm}`;
};
const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

// ─── SQLite-first data hook ───────────────────────────────────────────────────
const useLecturerOverview = ({ isOnline }) => {
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [lastSynced, setLastSynced] = useState(null);
  const abortRef = useRef(null);
  const didInitRef = useRef(false);
  const isOnlineRef = useRef(isOnline);
  useEffect(() => { isOnlineRef.current = isOnline; }, [isOnline]);

  const loadCache = useCallback(async () => {
    try {
      await initDatabase();
      const raw = await sqliteStorage.getSetting(LECTURER_OVERVIEW_KEY, null);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return { ...parsed, _cachedAt: parsed.fetchedAt ? new Date(parsed.fetchedAt).getTime() : 0 };
    } catch (_) { return null; }
  }, []);

  const saveCache = useCallback(async (data) => {
    try {
      await initDatabase();
      const payload = { ...data, fetchedAt: new Date().toISOString() };
      await sqliteStorage.upsertSetting(LECTURER_OVERVIEW_KEY, JSON.stringify(payload));
    } catch (_) {}
  }, []);

  const syncFromApi = useCallback(async (isRefresh = false) => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;

    if (!isOnlineRef.current) {
      if (isRefresh) setError('No internet connection');
      setRefreshing(false);
      return;
    }

    if (isRefresh) setRefreshing(true);
    setError(null);

    try {
      const s = await getLecturerSession();
      if (signal.aborted || !s?.token) return;

      // Single batch request — replaces 6+ individual API calls
      const res = await fetch(`${API_BASE_URL}${API_BATCH}`, {
        headers: { Authorization: `Bearer ${s.token}`, Accept: 'application/json' },
        signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data || typeof data !== 'object') throw new Error('Invalid response');

      const now = Date.now();
      const cachedData = {
        timetable: data.timetable ?? [],
        units: data.units ?? [],
        stats: data.stats ?? {},
        sparklines: data.sparklines ?? {},
        atRiskCounts: data.atRiskCounts ?? {},
        upcomingDeadlines: (data.upcomingDeadlines ?? []).map(d => ({
          ...d, dueAt: d.dueAt ? new Date(d.dueAt) : null,
        })).filter(d => d.dueAt && !isNaN(d.dueAt.getTime())),
        activeSession: data.activeSession ?? null,
        fetchedAt: now,
      };

      await saveCache(cachedData);
      setSnapshot(cachedData);
      setLastSynced(now);
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (!signal.aborted) setError(err.message || 'Failed to sync');
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, [saveCache]);

  // Initial load: cache first, then background sync
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadCache().then((cached) => {
      if (cancelled) return;
      if (cached) {
        setSnapshot(cached);
        setLastSynced(cached._cachedAt);
      }
      setLoading(false);
      didInitRef.current = true;
      // Background sync if online and stale
      if (isOnlineRef.current && (!cached || Date.now() - cached._cachedAt > STALE_MS)) {
        syncFromApi(false);
      }
    });
    return () => { cancelled = true; };
  }, [loadCache, syncFromApi]);

  // Refresh on focus
  useFocusEffect(useCallback(() => {
    if (!didInitRef.current) return;
    const cached = snapshot?._cachedAt ? snapshot : null;
    if (!cached || Date.now() - cached._cachedAt > STALE_MS) {
      syncFromApi(false);
    }
  }, [syncFromApi, snapshot]));

  // Sync on reconnect
  useSyncOnReconnect(() => {
    if (didInitRef.current) syncFromApi(false);
  });

  const refresh = useCallback(() => syncFromApi(true), [syncFromApi]);

  return {
    data: snapshot,
    loading,
    refreshing,
    error,
    lastSynced,
    refresh,
  };
};

// ─── Memoized section components ─────────────────────────────────────────────
const LiveSessionWidget = memo(({ session, onPress, C, styles }) => {
  const pulse = useRef(new Animated.Value(1)).current;
  const [elapsed, setElapsed] = useState('');
  useEffect(() => {
    const anim = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 0.2, duration: 700, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
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
      <LinearGradient colors={[`${C.success}20`, `${C.success}08`]} style={StyleSheet.absoluteFill} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} />
      <View style={styles.livePulseWrap}>
        <Animated.View style={[styles.livePulseDot, { opacity: pulse, backgroundColor: C.success }]} />
        <View style={[styles.liveDotInner, { backgroundColor: C.success }]} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.liveLabel, { color: C.success }]}>LIVE SESSION</Text>
        <Text style={[styles.liveUnit, { color: C.textPrimary }]} numberOfLines={1}>
          {session.unitName || session.unitCode || 'Active session'}
          {session.lectureRoom ? `  ·  ${session.lectureRoom}` : ''}
        </Text>
        <Text style={[styles.liveElapsed, { color: C.textMuted }]}>{elapsed} elapsed</Text>
      </View>
      <View style={[styles.liveResumeBtn, { backgroundColor: C.success }]}>
        <Icon name="play-circle-outline" size={14} color="#fff" />
        <Text style={styles.liveResumeTxt}>Resume</Text>
      </View>
    </TouchableOpacity>
  );
});

const LessonCard = memo(({ entry, index, onStart, C, styles }) => {
  const ACCENTS = [
    [C.primary, C.primaryDark],
    [C.secondary, '#D97706'],
    [C.info, C.infoDark],
    [C.success, C.successDark],
    [C.warning, C.warningDark],
    [C.purple, C.purpleDark],
  ];
  const accent = ACCENTS[index % ACCENTS.length];
  const lessonType = entry.lessonType || 'Lecture';
  const venue = entry.venue || entry.roomCode || 'TBA';
  const unitName = entry.unitName || entry.unitTitle || entry.unitCode || '—';
  const unitCode = entry.unitCode || '';

  return (
    <TouchableOpacity activeOpacity={0.88} onPress={onStart} style={[styles.lessonCard, { backgroundColor: C.surface, borderColor: C.border }]}>
      <LinearGradient colors={accent} style={styles.lessonBar} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} />
      <View style={styles.lessonTimeCol}>
        <Text style={[styles.lessonTimeStart, { color: C.textPrimary }]}>{formatTime(entry.startTime)}</Text>
        {!!entry.endTime && <Text style={[styles.lessonTimeEnd, { color: C.textMuted }]}>{formatTime(entry.endTime)}</Text>}
      </View>
      <View style={[styles.lessonSep, { backgroundColor: C.border }]} />
      <View style={styles.lessonInfo}>
        <View style={styles.lessonInfoTop}>
          <Text style={[styles.lessonUnit, { color: C.textPrimary }]} numberOfLines={1}>{unitName}</Text>
          <View style={[styles.lessonTypePill, { backgroundColor: `${accent[0]}18` }]}>
            <Text style={[styles.lessonTypeTxt, { color: accent[0] }]}>{lessonType}</Text>
          </View>
        </View>
        {!!unitCode && <Text style={[styles.lessonCode, { color: C.textMuted }]}>{unitCode}</Text>}
        <View style={styles.lessonMeta}>
          <Icon name="map-marker-outline" size={11} color={C.textMuted} />
          <Text style={[styles.lessonMetaTxt, { color: C.textMuted }]}>{venue}</Text>
        </View>
      </View>
      <TouchableOpacity style={[styles.lessonStartChip, { backgroundColor: accent[0] }]} onPress={onStart} activeOpacity={0.82}>
        <Icon name="play-circle-outline" size={12} color="#fff" />
        <Text style={styles.lessonStartTxt}>Start</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );
});

const UnitCard = memo(({ unit, sparkline, atRisk, onPress, C, styles }) => {
  const grade = useMemo(() => {
    const rate = unit.attendanceRate || 0;
    if (rate >= 80) return { color: C.success, bg: `${C.success}18`, label: 'Excellent' };
    if (rate >= 70) return { color: C.warning, bg: `${C.warning}18`, label: 'At Risk' };
    if (rate > 0) return { color: C.error, bg: `${C.error}18`, label: 'Critical' };
    return { color: C.textMuted, bg: `${C.textMuted}18`, label: 'No Data' };
  }, [unit.attendanceRate, C]);

  return (
    <TouchableOpacity style={[styles.unitCard, { borderColor: `${grade.color}30`, backgroundColor: C.surface }]} onPress={onPress} activeOpacity={0.82}>
      <LinearGradient colors={[`${grade.color}12`, `${grade.color}06`]} style={StyleSheet.absoluteFill} />
      <View style={styles.unitCardLeft}>
        <View style={styles.unitCardTop}>
          <View style={[styles.unitCardDot, { backgroundColor: grade.color }]} />
          <Text style={[styles.unitCardCode, { color: C.textPrimary }]} numberOfLines={1}>{unit.code}</Text>
          <View style={[styles.unitGradePill, { backgroundColor: grade.bg }]}>
            <Text style={[styles.unitGradeTxt, { color: grade.color }]}>{grade.label}</Text>
          </View>
        </View>
        <Text style={[styles.unitSessions, { color: C.textMuted }]}>
          {unit.conductedSessions > 0 ? `${unit.conductedSessions} session${unit.conductedSessions !== 1 ? 's' : ''}` : 'No sessions yet'}
        </Text>
        {atRisk > 0 && (
          <View style={styles.unitAtRisk}>
            <Icon name="account-alert-outline" size={10} color={C.warning} />
            <Text style={[styles.unitAtRiskTxt, { color: C.warning }]}>{atRisk} at risk</Text>
          </View>
        )}
      </View>
      <View style={styles.unitCardRight}>
        {sparkline && sparkline.length > 1 && (
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2 }}>
            {sparkline.slice(-8).map((val, i) => {
              const max = Math.max(...sparkline.slice(-8), 1);
              const barH = Math.max(3, Math.round((val / max) * 18));
              const isLatest = i === sparkline.slice(-8).length - 1;
              return <View key={i} style={{ width: 3, height: barH, borderRadius: 1, backgroundColor: isLatest ? grade.color : `${grade.color}50` }} />;
            })}
          </View>
        )}
        <Text style={[styles.unitRate, { color: grade.color }]}>
          {unit.attendanceRate > 0 ? `${unit.attendanceRate}%` : '—'}
        </Text>
        <Text style={[styles.unitRateLbl, { color: C.textMuted }]}>attendance</Text>
      </View>
    </TouchableOpacity>
  );
});

const QuickActionsGrid = memo(({ onStartAttendance, onTeachingHub, onAnalytics, onReports, onTimetable, onAnnounce, C, styles }) => {
  const ACTIONS = [
    { icon: 'qrcode-scan', label: 'Attendance', grad: [C.primary, C.primaryDark], onPress: onStartAttendance },
    { icon: 'book-open-variant', label: 'Library', grad: [C.success, C.successDark], onPress: onTeachingHub },
    { icon: 'chart-bar', label: 'Analytics', grad: [C.secondary, '#D97706'], onPress: onAnalytics },
    { icon: 'calendar-month', label: 'Timetable', grad: [C.warning, C.warningDark], onPress: onTimetable },
    { icon: 'file-chart', label: 'Reports', grad: [C.info, C.infoDark], onPress: onReports },
    { icon: 'bullhorn-outline', label: 'Announce', grad: [C.purple, C.purpleDark], onPress: onAnnounce },
  ];
  return (
    <View style={styles.qaGrid}>
      {ACTIONS.map((a, i) => (
        <TouchableOpacity key={i} style={styles.qaCell} onPress={a.onPress} activeOpacity={0.78}>
          <LinearGradient colors={a.grad} style={styles.qaIcon} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
            <Icon name={a.icon} size={20} color="#fff" />
          </LinearGradient>
          <Text style={[styles.qaLabel, { color: C.textSecondary }]} numberOfLines={1}>{a.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
});

const SmartInsightCard = memo(({ units, atRiskCounts, upcomingDeadlines, sparklines, C, styles }) => {
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
  }, [units, atRiskCounts, upcomingDeadlines, sparklines, C]);

  if (insights.length === 0) return null;
  return (
    <View style={[styles.insightCard, { backgroundColor: C.surface, borderColor: C.border }]}>
      <View style={[styles.insightHeader, { borderBottomColor: C.border }]}>
        <View style={[styles.insightBulb, { backgroundColor: `${C.warning}18` }]}>
          <Icon name="lightbulb-on-outline" size={14} color={C.warning} />
        </View>
        <Text style={[styles.insightTitle, { color: C.textPrimary }]}>Smart Insights</Text>
      </View>
      {insights.map((item, i) => (
        <View key={item.key} style={[styles.insightRow, i < insights.length - 1 && { borderBottomWidth: 1, borderBottomColor: C.border }]}>
          <View style={[styles.insightRowIcon, { backgroundColor: `${item.color}15` }]}>
            <Icon name={item.icon} size={15} color={item.color} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.insightRowTitle, { color: C.textPrimary }]}>{item.title}</Text>
            <Text style={[styles.insightRowBody, { color: C.textSecondary }]} numberOfLines={2}>{item.body}</Text>
          </View>
        </View>
      ))}
    </View>
  );
});

const DeadlineCard = memo(({ deadlines, C, styles }) => {
  if (!deadlines || deadlines.length === 0) return null;
  return (
    <View style={[styles.deadlineCard, { backgroundColor: C.surface, borderColor: `${C.error}25` }]}>
      <View style={[styles.deadlineCardHeader, { borderBottomColor: `${C.error}15` }]}>
        <LinearGradient colors={[C.error, '#F87171']} style={styles.deadlineCardIcon}>
          <Icon name="clock-alert-outline" size={16} color="#fff" />
        </LinearGradient>
        <View style={{ flex: 1 }}>
          <Text style={[styles.deadlineCardTitle, { color: C.textPrimary }]}>Upcoming Deadlines</Text>
          <Text style={[styles.deadlineCardSub, { color: C.textMuted }]}>{deadlines.length} assignment{deadlines.length !== 1 ? 's' : ''} in the next 2 weeks</Text>
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
              <Text style={[styles.deadlineTitle, { color: C.textPrimary }]} numberOfLines={1}>{item.title}</Text>
              <Text style={[styles.deadlineUnit, { color: C.textMuted }]}>{item.unitCode || item.unitName}</Text>
            </View>
            <View style={[styles.deadlineBadge, { backgroundColor: `${accent}22` }]}>
              <Text style={[styles.deadlineDaysTxt, { color: accent }]}>{daysText}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
});

const QuickResponseModal = memo(({ visible, onClose, units, onSend, C, styles }) => {
  const [selectedUnit, setSelectedUnit] = useState('ALL');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const TEMPLATES = useMemo(() => [
    { label: 'Class rescheduled', icon: 'calendar-refresh', text: "Today's class has been rescheduled. You'll be notified of the new time shortly." },
    { label: 'Room change', icon: 'map-marker-outline', text: "The venue for today's class has changed. Please check the updated location." },
    { label: 'Deadline reminder', icon: 'clock-alert-outline', text: 'Reminder: ensure your assignment submission is completed before the deadline.' },
    { label: 'No class today', icon: 'calendar-remove', text: "There will be no class today. A makeup session will be announced shortly." },
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
        <View style={[styles.modalSheet, { backgroundColor: C.surface }]}>
          <View style={[styles.modalDrag, { backgroundColor: C.surfaceHover }]} />
          <View style={styles.modalTitleRow}>
            <LinearGradient colors={[C.primary, C.secondary]} style={styles.modalTitleIcon}>
              <Icon name="bullhorn-outline" size={16} color="#fff" />
            </LinearGradient>
            <View style={{ flex: 1 }}>
              <Text style={[styles.modalTitle, { color: C.textPrimary }]}>Quick Announce</Text>
              <Text style={[styles.modalSub, { color: C.textMuted }]}>Send a message to your students</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={[styles.modalClose, { backgroundColor: `${C.surfaceEl}40` }]} activeOpacity={0.7}>
              <Icon name="close" size={18} color={C.textMuted} />
            </TouchableOpacity>
          </View>
          <View style={styles.modalSection}>
            <Text style={[styles.modalLabel, { color: C.textMuted }]}>Send to</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.unitChips}>
              <TouchableOpacity style={[styles.unitChip, { backgroundColor: C.surfaceEl, borderColor: C.border }, selectedUnit === 'ALL' && { backgroundColor: `${C.primary}20`, borderColor: C.primary }]} onPress={() => setSelectedUnit('ALL')}>
                <Text style={[styles.unitChipTxt, { color: C.textSecondary }, selectedUnit === 'ALL' && { color: C.primary, fontWeight: FW.semibold }]}>All units</Text>
              </TouchableOpacity>
              {units.map(u => (
                <TouchableOpacity key={u.code} style={[styles.unitChip, { backgroundColor: C.surfaceEl, borderColor: C.border }, selectedUnit === u.code && { backgroundColor: `${C.primary}20`, borderColor: C.primary }]} onPress={() => setSelectedUnit(u.code)}>
                  <Text style={[styles.unitChipTxt, { color: C.textSecondary }, selectedUnit === u.code && { color: C.primary, fontWeight: FW.semibold }]}>{u.code}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
          <View style={styles.modalSection}>
            <Text style={[styles.modalLabel, { color: C.textMuted }]}>Quick templates</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SP.sm, paddingHorizontal: SP.lg }}>
              {TEMPLATES.map(tpl => (
                <TouchableOpacity key={tpl.label} style={[styles.templateChip, { backgroundColor: `${C.primary}12`, borderColor: `${C.primary}25` }]} onPress={() => setMessage(tpl.text)} activeOpacity={0.78}>
                  <Icon name={tpl.icon} size={13} color={C.primary} />
                  <Text style={[styles.templateChipTxt, { color: C.primary }]}>{tpl.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
          <View style={styles.modalSection}>
            <Text style={[styles.modalLabel, { color: C.textMuted }]}>Message</Text>
            <TextInput
              style={[styles.messageInput, { backgroundColor: C.surfaceEl, borderColor: C.border, color: C.textPrimary }]}
              value={message}
              onChangeText={setMessage}
              placeholder="Type your message…"
              placeholderTextColor={C.textMuted}
              multiline
              numberOfLines={4}
              maxLength={500}
            />
            <Text style={[styles.charCount, { color: C.textMuted }]}>{message.length}/500</Text>
          </View>
          <TouchableOpacity style={[styles.sendBtn, !canSend && styles.sendBtnDisabled]} onPress={handleSend} activeOpacity={0.82} disabled={!canSend}>
            <LinearGradient colors={canSend ? [C.primary, C.secondary] : [C.surfaceHover, C.surfaceHover]} style={styles.sendBtnGrad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
              {sending ? <Text style={[styles.sendBtnTxt, { color: C.textMuted }]}>Sending…</Text> : <><Icon name="send" size={15} color="#fff" /><Text style={[styles.sendBtnTxt, { color: '#fff' }]}>Send Announcement</Text></>}
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
});

// ─── Main screen ─────────────────────────────────────────────────────────────
export default function OverviewScreen({ navigation }) {
  const { isTablet, isDesktop, contentMaxWidth } = useResponsive();
  const colors = useColors();
  const { isDark } = useTheme();
  const { isOnline } = useInternetStatus();
  const [showAnnounce, setShowAnnounce] = useState(false);

  const C = useMemo(() => ({
    primary: colors.primary.main, primaryDark: colors.primary.dark, primaryLight: colors.primary.light,
    secondary: colors.warning.main, secondaryDark: colors.warning.dark,
    success: colors.success.main, successDark: colors.success.dark,
    warning: colors.warning.main, warningDark: colors.warning.dark,
    error: colors.danger.main, info: colors.info.main, infoDark: colors.info.dark,
    bg: colors.background.primary, surface: colors.surface.primary,
    surfaceEl: colors.surface.secondary, surfaceHover: colors.surface.tertiary,
    textPrimary: colors.text.primary, textSecondary: colors.text.secondary, textMuted: colors.text.muted,
    border: colors.border.light, borderLight: colors.border.light,
    purple: colors.purple.main, purpleDark: colors.purple.dark,
  }), [colors]);

  const styles = useMemo(() => makeStyles(C), [C]);

  const { data, loading, refreshing, error, lastSynced, refresh } = useLecturerOverview({ isOnline });

  const [tick, setTick] = useState(() => new Date());
  useEffect(() => { const id = setInterval(() => setTick(new Date()), 30000); return () => clearInterval(id); }, []);

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

  const handleStartAttendance = useCallback((session) => {
    navigation.navigate('Attendance', {
      unitCode: session?.unitCode,
      unitName: session?.unitName || session?.unitTitle || session?.unitCode,
      lessonType: session?.lessonType || 'Lecture',
    });
  }, [navigation]);

  // Derived data — memoized to prevent recalculation
  const { timetable, units, stats, sparklines, atRiskCounts, upcomingDeadlines, activeSession } = data || {};

  const daySchedule = useMemo(() => {
    if (!timetable || timetable.length === 0) return [];
    const today = new Date().getDay();
    const todayName = DAYS[today];
    return timetable
      .filter(e => e.day?.toLowerCase() === todayName.toLowerCase())
      .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timetable, tick]);

  const nextClass = useMemo(() => {
    if (!timetable || timetable.length === 0) return null;
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const todayIdx = now.getDay();
    for (let offset = 0; offset < 7; offset++) {
      const dayIdx = (todayIdx + offset) % 7;
      const dayName = DAYS[dayIdx];
      const sessions = timetable
        .filter(e => e.day?.toLowerCase() === dayName.toLowerCase())
        .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
      for (const session of sessions) {
        const [h, m] = (session.startTime || '').split(':').map(Number);
        const startMin = Number.isFinite(h) ? h * 60 + (Number.isFinite(m) ? m : 0) : null;
        const endMin = session.endTime ? (() => { const [eh, em] = session.endTime.split(':').map(Number); return Number.isFinite(eh) ? eh * 60 + (Number.isFinite(em) ? em : 0) : null; })() : (startMin != null ? startMin + 60 : null);
        if (startMin == null) continue;
        const isInProgress = nowMin >= startMin && (endMin == null || nowMin <= endMin);
        if (offset > 0 || nowMin < endMin || isInProgress) {
          return { session, startMin, endMin, isInProgress, offset, dayName };
        }
      }
    }
    return null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timetable, tick]);

  const atRiskTotal = useMemo(() => Object.values(atRiskCounts || {}).reduce((s, n) => s + n, 0), [atRiskCounts]);

  // Render section header
  const renderSectionHeader = useCallback(({ icon, title, count, onAction, actionLabel }) => (
    <View style={styles.secHeader}>
      <View style={styles.secHeaderLeft}>
        <Icon name={icon} size={14} color={C.textMuted} />
        <Text style={[styles.secTitle, { color: C.textPrimary }]}>{title}</Text>
        {count != null && <View style={[styles.secCountBadge, { backgroundColor: `${C.surfaceEl}40` }]}><Text style={[styles.secCountTxt, { color: C.textSecondary }]}>{count}</Text></View>}
      </View>
      {onAction && (
        <TouchableOpacity onPress={onAction} style={styles.secAction} activeOpacity={0.7}>
          <Text style={[styles.secActionTxt, { color: C.primary }]}>{actionLabel || 'See all'}</Text>
          <Icon name="chevron-right" size={14} color={C.primary} />
        </TouchableOpacity>
      )}
    </View>
  ), [C, styles]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={C.bg} />
      <LecturerHeader navigation={navigation} />
      <OfflineBanner />

      {!!activeSession && (
        <LiveSessionWidget session={activeSession} onPress={() => navigation.navigate('Attendance')} C={C} styles={styles} />
      )}

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[
          styles.scrollContent,
          (isTablet || isDesktop) && { maxWidth: contentMaxWidth, alignSelf: 'center', width: '100%' },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[C.primary]} tintColor={C.primary} />}
      >
        {/* Status indicators */}
        {refreshing && (
          <View style={[styles.bgUpdatePill, { backgroundColor: `${C.primary}15`, borderColor: `${C.primary}30` }]}>
            <ActivityIndicator size="small" color={C.primary} />
            <Text style={[styles.bgUpdateTxt, { color: C.primary }]}>Updating…</Text>
          </View>
        )}
        {lastSynced && !error && (
          <Text style={[styles.lastRefreshed, { color: C.textMuted }]}>
            Updated {new Date(lastSynced).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
        )}
        {!isOnline && (
          <View style={[styles.offlinePill, { backgroundColor: `${C.warning}15`, borderColor: `${C.warning}30` }]}>
            <Icon name="wifi-off" size={14} color={C.warning} />
            <Text style={[styles.offlineTxt, { color: C.warning }]}>Offline — showing cached data</Text>
          </View>
        )}

        {/* Loading state */}
        {loading && !data && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={C.primary} />
            <Text style={[styles.loadingText, { color: C.textMuted }]}>Loading dashboard…</Text>
          </View>
        )}

        {/* Hero stats */}
        {data && (
          <>
            <View style={styles.heroSection}>
              <View style={styles.heroHeader}>
                <View>
                  <Text style={[styles.heroTitle, { color: C.textPrimary }]}>Welcome back</Text>
                  <Text style={[styles.heroSubtitle, { color: C.textSecondary }]}>
                    {stats?.units || 0} units · {stats?.uniqueStudents || stats?.students || 0} students · {stats?.totalSessions || 0} sessions
                  </Text>
                </View>
                <View style={[styles.heroAttendancePill, { backgroundColor: (stats?.avgAttendance || 0) >= 70 ? `${C.success}15` : `${C.warning}15` }]}>
                  <Text style={[styles.heroAttendanceValue, { color: (stats?.avgAttendance || 0) >= 70 ? C.success : C.warning }]}>
                    {stats?.avgAttendance != null ? `${stats.avgAttendance}%` : '—'}
                  </Text>
                  <Text style={[styles.heroAttendanceLabel, { color: C.textMuted }]}>Avg Attend.</Text>
                </View>
              </View>
              <View style={styles.heroActionsRow}>
                <TouchableOpacity style={[styles.heroPrimaryBtn, { backgroundColor: C.primary }]} onPress={() => navigation.navigate('Attendance')} activeOpacity={0.85}>
                  <Icon name="qrcode-scan" size={16} color="#fff" />
                  <Text style={styles.heroPrimaryBtnText}>Start Attendance</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.heroSecondaryBtn, { borderColor: C.border }]} onPress={() => setShowAnnounce(true)} activeOpacity={0.85}>
                  <Icon name="bullhorn-outline" size={16} color={C.textSecondary} />
                  <Text style={[styles.heroSecondaryBtnText, { color: C.textSecondary }]}>Announce</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Quick actions */}
            <View style={styles.section}>
              {renderSectionHeader({ icon: 'gesture-tap', title: 'Quick Actions', C, styles })}
              <QuickActionsGrid
                onStartAttendance={() => navigation.navigate('Attendance')}
                onTeachingHub={() => navigation.navigate('Teaching Hub')}
                onAnalytics={() => navigation.navigate('Analytics')}
                onTimetable={() => navigation.navigate('Timetable')}
                onReports={() => navigation.navigate('Reports')}
                onAnnounce={() => setShowAnnounce(true)}
                C={C}
                styles={styles}
              />
            </View>

            {/* At-risk alert */}
            {atRiskTotal > 0 && (
              <View style={styles.section}>
                <TouchableOpacity style={[styles.atRiskBanner, { borderColor: `${C.error}30` }]} onPress={() => navigation.navigate('Analytics')} activeOpacity={0.85}>
                  <LinearGradient colors={[`${C.error}15`, `${C.error}06`]} style={StyleSheet.absoluteFill} />
                  <View style={[styles.atRiskIconWrap, { backgroundColor: `${C.error}20` }]}>
                    <Icon name="account-alert-outline" size={16} color={C.error} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.atRiskTitle, { color: C.error }]}>{atRiskTotal} student{atRiskTotal !== 1 ? 's' : ''} need attention</Text>
                    <Text style={[styles.atRiskSub, { color: C.textMuted }]}>Below attendance threshold · Tap for details</Text>
                  </View>
                  <Icon name="chevron-right" size={16} color={C.error} />
                </TouchableOpacity>
              </View>
            )}

            {/* Next class */}
            {nextClass && (
              <View style={styles.section}>
                {renderSectionHeader({ icon: 'clock-fast', title: 'Up Next', count: nextClass.isInProgress ? 1 : undefined, C, styles })}
                <TouchableOpacity activeOpacity={0.88} onPress={() => handleStartAttendance(nextClass.session)} style={[styles.nextCard, { borderColor: `${C.primary}30`, backgroundColor: C.surface }]}>
                  <LinearGradient colors={[`${C.primary}10`, `${C.primary}05`]} style={StyleSheet.absoluteFill} />
                  <View style={styles.nextBody}>
                    <View style={styles.nextTopRow}>
                      <View style={[styles.nextWhenTag, { backgroundColor: `${C.primary}15` }]}>
                        {nextClass.isInProgress && <View style={[styles.nextLiveDot, { backgroundColor: C.success }]} />}
                        <Text style={[styles.nextWhenTxt, { color: C.primary }]}>
                          {nextClass.isInProgress ? 'NOW' : nextClass.offset === 0 ? 'TODAY' : nextClass.offset === 1 ? 'TOMORROW' : nextClass.dayName.toUpperCase()}
                        </Text>
                      </View>
                      <Text style={[styles.nextCd, { color: C.primary }]}>
                        {nextClass.isInProgress ? 'In progress' : `${formatTime(nextClass.session.startTime)}${nextClass.session.endTime ? ` – ${formatTime(nextClass.session.endTime)}` : ''}`}
                      </Text>
                    </View>
                    <Text style={[styles.nextUnitName, { color: C.textPrimary }]} numberOfLines={2}>
                      {nextClass.session.unitName || nextClass.session.unitTitle || nextClass.session.unitCode || '—'}
                    </Text>
                    {!!nextClass.session.unitCode && <Text style={[styles.nextUnitCode, { color: C.textMuted }]}>{nextClass.session.unitCode}</Text>}
                    <View style={styles.nextMeta}>
                      <Icon name="map-marker-outline" size={11} color={C.textMuted} />
                      <Text style={[styles.nextMetaTxt, { color: C.textMuted }]}>
                        {nextClass.session.venue || nextClass.session.roomCode || 'TBA'}
                      </Text>
                    </View>
                  </View>
                  {nextClass.offset === 0 && (
                    <TouchableOpacity style={[styles.nextStartBtn, { backgroundColor: C.primary }]} onPress={() => handleStartAttendance(nextClass.session)} activeOpacity={0.82}>
                      <Icon name={nextClass.isInProgress ? 'play-circle' : 'qrcode-scan'} size={16} color="#fff" />
                      <Text style={styles.nextStartTxt}>{nextClass.isInProgress ? 'Resume' : 'Start'}</Text>
                    </TouchableOpacity>
                  )}
                </TouchableOpacity>
              </View>
            )}

            {/* Today's schedule */}
            <View style={styles.section}>
              {renderSectionHeader({ icon: 'calendar-today', title: `Today's Classes`, count: daySchedule.length || undefined, C, styles })}
              {daySchedule.length > 0 ? (
                daySchedule.map((entry, i) => (
                  <LessonCard
                    key={`${entry.unitCode}-${i}`}
                    entry={entry}
                    index={i}
                    onStart={() => handleStartAttendance(entry)}
                    C={C}
                    styles={styles}
                  />
                ))
              ) : (
                <View style={styles.emptySchedule}>
                  <View style={[styles.emptyScheduleIcon, { backgroundColor: `${C.surfaceEl}40` }]}>
                    <Icon name="calendar-blank-outline" size={32} color={C.textMuted} />
                  </View>
                  <Text style={[styles.emptyTitle, { color: C.textPrimary }]}>No classes today</Text>
                  <Text style={[styles.emptyBody, { color: C.textMuted }]}>Enjoy your break — next scheduled classes shown above.</Text>
                </View>
              )}
            </View>

            {/* Unit performance */}
            {units.length > 0 && (
              <View style={styles.section}>
                {renderSectionHeader({ icon: 'chart-bar', title: 'Unit Performance', onAction: () => navigation.navigate('Analytics'), actionLabel: 'View all', C, styles })}
                <View style={styles.unitCardsList}>
                  {units.map((unit) => (
                    <UnitCard
                      key={unit.code}
                      unit={unit}
                      sparkline={sparklines[toKey(unit.code)]}
                      atRisk={atRiskCounts[toKey(unit.code)] ?? 0}
                      onPress={() => navigation.navigate('Analytics', { unitCode: unit.code })}
                      C={C}
                      styles={styles}
                    />
                  ))}
                </View>
              </View>
            )}

            {/* Smart insights */}
            <View style={styles.section}>
              <SmartInsightCard
                units={units}
                atRiskCounts={atRiskCounts}
                upcomingDeadlines={upcomingDeadlines || []}
                sparklines={sparklines || {}}
                C={C}
                styles={styles}
              />
            </View>

            {/* Deadlines */}
            <View style={styles.section}>
              <DeadlineCard deadlines={upcomingDeadlines || []} C={C} styles={styles} />
            </View>

            {/* Error state */}
            {!!error && (
              <View style={styles.section}>
                <View style={[styles.errorBanner, { borderColor: `${C.error}30` }]}>
                  <Icon name="alert-circle-outline" size={15} color={C.error} />
                  <Text style={[styles.errorTxt, { color: C.error }]} numberOfLines={2}>{error}</Text>
                  <TouchableOpacity onPress={refresh} style={styles.retryBtn}>
                    <Text style={[styles.retryTxt, { color: C.error }]}>Retry</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Empty state */}
            {!loading && !error && units.length === 0 && timetable.length === 0 && (
              <View style={styles.fullEmpty}>
                <LinearGradient colors={[`${C.surfaceEl}40`, C.surface]} style={styles.fullEmptyIcon}>
                  <Icon name="calendar-blank" size={48} color={C.textMuted} />
                </LinearGradient>
                <Text style={[styles.fullEmptyTitle, { color: C.textPrimary }]}>No timetable yet</Text>
                <Text style={[styles.fullEmptyBody, { color: C.textMuted }]}>Your timetable hasn't been published yet. Pull down to refresh.</Text>
              </View>
            )}

            <View style={{ height: SP.xxxl + 24 }} />
          </>
        )}
      </ScrollView>

      <QuickResponseModal
        visible={showAnnounce}
        onClose={() => setShowAnnounce(false)}
        units={units || []}
        onSend={handleSendAnnouncement}
        C={C}
        styles={styles}
      />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const makeStyles = (C) => StyleSheet.create({
  scrollContent: { paddingBottom: SP.xxxl },
  loadingContainer: { alignItems: 'center', padding: SP.xxxl },
  loadingText: { fontSize: 14, marginTop: SP.md },

  // Hero
  heroSection: { marginHorizontal: SP.lg, marginTop: SP.lg, borderRadius: 24, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  heroHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', padding: SP.lg, paddingRight: SP.xl },
  heroTitle: { fontSize: 22, fontWeight: FW.extrabold, marginBottom: 4 },
  heroSubtitle: { fontSize: 13, lineHeight: 18 },
  heroAttendancePill: { paddingHorizontal: SP.md, paddingVertical: SP.sm, borderRadius: 16, alignItems: 'center' },
  heroAttendanceValue: { fontSize: 18, fontWeight: FW.extrabold },
  heroAttendanceLabel: { fontSize: 10, fontWeight: FW.medium, marginTop: 2 },
  heroActionsRow: { flexDirection: 'row', gap: SP.sm, paddingHorizontal: SP.lg, paddingBottom: SP.lg },
  heroPrimaryBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.sm, paddingVertical: SP.md, borderRadius: 16 },
  heroPrimaryBtnText: { fontSize: 14, fontWeight: FW.bold, color: '#fff' },
  heroSecondaryBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.sm, paddingVertical: SP.md, borderRadius: 16, borderWidth: 1 },
  heroSecondaryBtnText: { fontSize: 14, fontWeight: FW.bold },

  // Sections
  section: { marginTop: SP.xl },
  secHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.lg, marginBottom: SP.md },
  secHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  secTitle: { fontSize: 15, fontWeight: FW.bold },
  secCountBadge: { borderRadius: 10, paddingHorizontal: 7, paddingVertical: 1 },
  secCountTxt: { fontSize: 11, fontWeight: FW.semibold },
  secAction: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  secActionTxt: { fontSize: 13, fontWeight: FW.medium },

  // Quick actions
  qaGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: SP.lg, gap: SP.md },
  qaCell: { width: '29%', flexGrow: 1, alignItems: 'center', gap: 8 },
  qaIcon: { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  qaLabel: { fontSize: 12, fontWeight: FW.medium, textAlign: 'center' },

  // At-risk
  atRiskBanner: { flexDirection: 'row', alignItems: 'center', marginHorizontal: SP.lg, borderRadius: 16, padding: SP.md, overflow: 'hidden', borderWidth: 1, gap: SP.md },
  atRiskIconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  atRiskTitle: { fontSize: 13, fontWeight: FW.semibold, marginBottom: 2 },
  atRiskSub: { fontSize: 11 },

  // Next class
  nextCard: { marginHorizontal: SP.lg, borderRadius: 20, borderWidth: 1, overflow: 'hidden', flexDirection: 'row', alignItems: 'center' },
  nextBody: { flex: 1, padding: SP.lg },
  nextTopRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.sm },
  nextWhenTag: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: SP.sm, paddingVertical: 3, borderRadius: 8 },
  nextLiveDot: { width: 6, height: 6, borderRadius: 3 },
  nextWhenTxt: { fontSize: 11, fontWeight: FW.bold, letterSpacing: 0.8 },
  nextCd: { fontSize: 13, fontWeight: FW.semibold },
  nextUnitName: { fontSize: 16, fontWeight: FW.bold, marginBottom: 3 },
  nextUnitCode: { fontSize: 12, marginBottom: SP.sm, fontWeight: FW.medium },
  nextMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  nextMetaTxt: { fontSize: 11 },
  nextStartBtn: { margin: SP.lg, paddingHorizontal: SP.lg, paddingVertical: SP.md, borderRadius: 16, alignItems: 'center', gap: 4 },
  nextStartTxt: { fontSize: 13, fontWeight: FW.bold, color: '#fff' },

  // Lesson card
  lessonCard: { flexDirection: 'row', alignItems: 'center', marginHorizontal: SP.lg, marginBottom: SP.sm, borderRadius: 14, borderWidth: 1, overflow: 'hidden', minHeight: 70 },
  lessonBar: { width: 4, alignSelf: 'stretch' },
  lessonTimeCol: { width: 58, paddingLeft: SP.md, alignItems: 'flex-start' },
  lessonTimeStart: { fontSize: 13, fontWeight: FW.bold },
  lessonTimeEnd: { fontSize: 11, marginTop: 2 },
  lessonSep: { width: 1, height: '60%', marginHorizontal: SP.sm },
  lessonInfo: { flex: 1, paddingVertical: SP.md },
  lessonInfoTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SP.sm },
  lessonUnit: { fontSize: 14, fontWeight: FW.semibold, flex: 1 },
  lessonTypePill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  lessonTypeTxt: { fontSize: 10, fontWeight: FW.bold, letterSpacing: 0.3 },
  lessonCode: { fontSize: 11, marginTop: 2 },
  lessonMeta: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 4 },
  lessonMetaTxt: { fontSize: 11 },
  lessonStartChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: SP.md, paddingVertical: SP.sm, margin: SP.md, borderRadius: 12 },
  lessonStartTxt: { fontSize: 12, fontWeight: FW.semibold, color: '#fff' },

  // Unit cards
  unitCardsList: { paddingHorizontal: SP.lg, gap: SP.sm },
  unitCard: { flexDirection: 'row', alignItems: 'center', borderRadius: 16, borderWidth: 1, paddingVertical: SP.md, paddingHorizontal: SP.lg, overflow: 'hidden' },
  unitCardLeft: { flex: 1, gap: SP.xs },
  unitCardTop: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  unitCardDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  unitCardCode: { flex: 1, fontSize: 13, fontWeight: FW.bold },
  unitGradePill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  unitGradeTxt: { fontSize: 9, fontWeight: FW.bold, letterSpacing: 0.3 },
  unitCardRight: { alignItems: 'flex-end', gap: 2 },
  unitRate: { fontSize: 24, fontWeight: FW.extrabold, letterSpacing: -0.5 },
  unitRateLbl: { fontSize: 10, fontWeight: FW.medium },
  unitAtRisk: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  unitAtRiskTxt: { fontSize: 11, fontWeight: FW.semibold },
  unitSessions: { fontSize: 11, fontWeight: FW.medium },

  // Insights
  insightCard: { marginHorizontal: SP.lg, borderRadius: 18, overflow: 'hidden' },
  insightHeader: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, padding: SP.lg, borderBottomWidth: 1 },
  insightBulb: { width: 28, height: 28, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  insightTitle: { fontSize: 14, fontWeight: FW.bold },
  insightRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.md, padding: SP.lg },
  insightRowIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  insightRowTitle: { fontSize: 13, fontWeight: FW.semibold, marginBottom: 3 },
  insightRowBody: { fontSize: 12, lineHeight: 17 },

  // Deadlines
  deadlineCard: { marginHorizontal: SP.lg, borderRadius: 18, overflow: 'hidden' },
  deadlineCardHeader: { flexDirection: 'row', alignItems: 'center', gap: SP.md, padding: SP.lg, borderBottomWidth: 1 },
  deadlineCardIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  deadlineCardTitle: { fontSize: 14, fontWeight: FW.bold },
  deadlineCardSub: { fontSize: 12, marginTop: 2 },
  deadlineRow: { flexDirection: 'row', alignItems: 'center', padding: SP.lg, borderLeftWidth: 3, gap: SP.md },
  deadlineTitle: { fontSize: 13, fontWeight: FW.semibold },
  deadlineUnit: { fontSize: 11, marginTop: 2 },
  deadlineBadge: { paddingHorizontal: SP.sm, paddingVertical: 3, borderRadius: 10, alignSelf: 'flex-start' },
  deadlineDaysTxt: { fontSize: 11, fontWeight: FW.bold },

  // Status pills
  bgUpdatePill: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginHorizontal: SP.lg, marginTop: SP.md, paddingHorizontal: SP.md, paddingVertical: SP.xs, borderRadius: 999, borderWidth: 1, alignSelf: 'flex-start' },
  bgUpdateTxt: { fontSize: 12, fontWeight: FW.medium },
  lastRefreshed: { fontSize: 11, textAlign: 'right', marginHorizontal: SP.lg, marginTop: SP.xs },
  offlinePill: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginHorizontal: SP.lg, marginTop: SP.sm, paddingHorizontal: SP.md, paddingVertical: SP.xs, borderRadius: 999, borderWidth: 1, alignSelf: 'flex-start' },
  offlineTxt: { fontSize: 12, fontWeight: FW.medium },

  // Empty states
  emptySchedule: { alignItems: 'center', padding: SP.xxl, marginHorizontal: SP.lg },
  emptyScheduleIcon: { width: 60, height: 60, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginBottom: SP.lg },
  emptyTitle: { fontSize: 15, fontWeight: FW.bold, marginBottom: SP.xs },
  emptyBody: { fontSize: 13, textAlign: 'center', lineHeight: 19 },
  fullEmpty: { alignItems: 'center', padding: SP.xxxl },
  fullEmptyIcon: { width: 84, height: 84, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: SP.xl },
  fullEmptyTitle: { fontSize: 18, fontWeight: FW.bold, marginBottom: SP.sm },
  fullEmptyBody: { fontSize: 14, textAlign: 'center', lineHeight: 21, paddingHorizontal: SP.xxl },

  // Error
  errorBanner: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, padding: SP.md, borderRadius: 14, borderWidth: 1 },
  errorTxt: { flex: 1, fontSize: 13 },
  retryBtn: { paddingHorizontal: SP.md, paddingVertical: SP.xs, borderRadius: 10 },
  retryTxt: { fontSize: 12, fontWeight: FW.semibold },

  // Modal
  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)' },
  modalSheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingBottom: 34, maxHeight: '85%' },
  modalDrag: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: SP.md, marginBottom: SP.lg },
  modalTitleRow: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: SP.xl, paddingBottom: SP.lg, gap: SP.md },
  modalTitleIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  modalTitle: { fontSize: 18, fontWeight: FW.bold },
  modalSub: { fontSize: 13, marginTop: 3 },
  modalClose: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  modalSection: { marginBottom: SP.lg },
  modalLabel: { fontSize: 12, fontWeight: FW.semibold, letterSpacing: 0.5, textTransform: 'uppercase', marginHorizontal: SP.xl, marginBottom: SP.sm },
  unitChips: { paddingHorizontal: SP.xl, gap: SP.sm },
  unitChip: { paddingHorizontal: SP.md, paddingVertical: SP.xs, borderRadius: 20, borderWidth: 1 },
  unitChipTxt: { fontSize: 13, fontWeight: FW.medium },
  templateChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: SP.md, paddingVertical: SP.sm, borderRadius: 20, borderWidth: 1 },
  templateChipTxt: { fontSize: 12, fontWeight: FW.medium },
  messageInput: { marginHorizontal: SP.xl, borderRadius: 16, padding: SP.md, fontSize: 14, minHeight: 100, textAlignVertical: 'top', borderWidth: 1 },
  charCount: { fontSize: 11, textAlign: 'right', marginHorizontal: SP.xl, marginTop: 4 },
  sendBtn: { marginHorizontal: SP.xl, marginTop: SP.lg },
  sendBtnDisabled: { opacity: 0.5 },
  sendBtnGrad: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.sm, paddingVertical: SP.md, borderRadius: 16 },
  sendBtnTxt: { fontSize: 15, fontWeight: FW.bold, color: '#fff' },
});
