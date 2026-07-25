import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, FlatList, InteractionManager, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, Vibration } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useFocusEffect } from '@react-navigation/native';
import { getLecturerSession } from '../../utils/authSession';
import { LESSON_TYPES, getLessonTypeByName } from '../../utils/constants';
import {
  fetchMyLecturerTimetable,
  wasLastTimetableFetchFromCache,
  updateLecturerTimetableEntryStatus,
  mergeLessons,
  unmergeLessons,
} from '../../utils/lecturerTimetableApi';
import { sendNotification } from '../../utils/notificationApi';
import { displayLocalNotification, CHANNELS } from '../../utils/notificationService';
import { onTimetableUpdated, isTimetableDirty, clearTimetableDirty } from '../../utils/notificationEventBus';
import { fetchRooms } from '../../utils/lecturerRoomsApi';
import { createDelegation } from '../../utils/delegationApi';
import { createExtraSession, fetchMyExtraSessions, deleteExtraSession } from '../../utils/extraSessionsApi';
import { getGroups } from '../../utils/groupsApi';
import { adaptiveConfig } from '../../utils/adaptiveAttendanceConfig';
import useResponsive from '../../hooks/useResponsive';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useColors } from '../../theme';


const LESSON_STATUS_OPTIONS = ['Online', 'Cancelled', 'Confirmed', 'Rescheduled'];

const STATUS_DIALOG_LABELS = {
  Online: 'Go Online',
  Cancelled: 'Cancel Lesson',
  Confirmed: 'Confirm Lesson',
  Rescheduled: 'Reschedule Lesson',
};

const STATUS_COLORS = {
  Confirmed: '#15803D',
  Pending: '#1D4ED8',
  Cancelled: '#B91C1C',
  Rescheduled: '#C2410C',
  Online: '#0891B2',
};

const DAY_ORDER = {
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
  Sunday: 7,
};

const daySortValue = (value) => {
  const key = String(value || '').trim();
  return DAY_ORDER[key] || 99;
};

// Returns the most recent Saturday 00:00:00 (= Friday midnight / weekly reset point)
const getLastWeekReset = () => {
  const d = new Date();
  // getDay(): 0=Sun,1=Mon,...,5=Fri,6=Sat
  // Days back to reach the most recent Saturday
  const daysBack = d.getDay() === 6 ? 0 : d.getDay() + 1;
  d.setDate(d.getDate() - daysBack);
  d.setHours(0, 0, 0, 0);
  return d;
};

// Statuses that auto-revert to Pending after Friday midnight each week
const WEEKLY_STATUSES = new Set(['Cancelled', 'Rescheduled', 'Online']);

const getEffectiveStatus = (entry) => {
  // Compound state: Rescheduled + sub-status (e.g. Rescheduled + Confirmed).
  // Always treat as 'Rescheduled' so the reschedule block remains visible.
  if (entry?.rescheduleSubStatus && entry?.rescheduledTo) return 'Rescheduled';
  const stored = String(entry?.status || 'Pending').trim() || 'Pending';
  if (!WEEKLY_STATUSES.has(stored)) return stored;
  const updatedAt = entry?.updatedAt ? new Date(entry.updatedAt) : null;
  if (!updatedAt || Number.isNaN(updatedAt.getTime())) return 'Pending';
  return updatedAt >= getLastWeekReset() ? stored : 'Pending';
};


//  Module-level cache  survives unmount/remount across tab navigation 
const _timetableCache = { entries: null, timestamp: 0 };
const STALE_MS = 5 * 60 * 1000;

const RESCHEDULE_CACHE_KEY = '@lec_reschedule_overrides';

// Persist { [entryId]: { rescheduledTo, reschedulePermanent } } so the card
// survives refreshes while the backend hasn't stored the fields yet.
const loadRescheduleCache = async () => {
  try {
    const raw = await AsyncStorage.getItem(RESCHEDULE_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
};
const saveRescheduleCache = async (cache) => {
  try { await AsyncStorage.setItem(RESCHEDULE_CACHE_KEY, JSON.stringify(cache)); } catch { }
};

export default function AssignedTimetableScreen() {
  const { isTablet, isDesktop, contentMaxWidth } = useResponsive();
  const colors = useColors();
  const C = useMemo(() => ({
    primary:     colors.primary.main,
    primaryLt:   colors.primary.light,
    primaryDk:   colors.primary.dark,
    purpleLt:    colors.purple.light,
    purpleDk:    colors.purple.dark,
    success:     colors.success.main,
    successLt:   colors.success.light,
    dangerLt:    colors.danger.light,
    warning:     colors.warning.main,
    infoLt:      colors.info.light,
    tealLt:      colors.teal.light,
    tealDk:      colors.teal.dark,
    bg:          colors.background.primary,
    bgSec:       colors.background.secondary,
    bgTert:      colors.background.tertiary,
    primarySoft: colors.primary.soft,
    surface:     colors.surface.primary,
    textPri:     colors.text.primary,
    textSec:     colors.text.secondary,
    textMuted:   colors.text.muted,
    textDarkSec: colors.light.text.secondary,
    textMid:     colors.light.text.tertiary,
    border:      colors.border.light,
    borderMed:   colors.border.medium,
  }), [colors]);
  const S = useMemo(() => makeStyles(C), [C]);
  const rescheduleCacheRef = useRef({});
  const [isLoading, setIsLoading] = useState(() => !_timetableCache.entries);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isFromCache, setIsFromCache] = useState(false);
  const [isBackgroundUpdate, setIsBackgroundUpdate] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const [entries, setEntries] = useState(() => _timetableCache.entries ?? []);
  const [updatingEntryKey, setUpdatingEntryKey] = useState('');
  const [openDropdownEntryId, setOpenDropdownEntryId] = useState('');
  const [cancelModal, setCancelModal] = useState({ visible: false, entry: null });
  const [cancelReason, setCancelReason] = useState('');
  const [rescheduleModal, setRescheduleModal] = useState({ visible: false, entry: null });
  const [rescheduleType, setRescheduleType] = useState('temporary');
  const [rescheduleDay, setRescheduleDay] = useState('');
  const [rescheduleStartTime, setRescheduleStartTime] = useState(null);
  const [rescheduleEndTime, setRescheduleEndTime] = useState(null);
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);
  const [rescheduleStep, setRescheduleStep] = useState(1);
  const [availableRooms, setAvailableRooms] = useState([]);
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [searchingRooms, setSearchingRooms] = useState(false);
  const [roomSearchError, setRoomSearchError] = useState('');
  const [roomFilterQuery, setRoomFilterQuery] = useState('');
  const [openLessonTypeEntryId, setOpenLessonTypeEntryId] = useState('');
  const [delegateModal, setDelegateModal] = useState({ visible: false, entry: null });
  const [delegateGroups, setDelegateGroups] = useState([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [delegateError, setDelegateError] = useState('');
  const [delegating, setDelegating] = useState(false);

  //  Make-up session state 
  const [makeupModal, setMakeupModal] = useState({ visible: false, entry: null });
  const [makeupDate, setMakeupDate] = useState(null);
  const [makeupStartTime, setMakeupStartTime] = useState(null);
  const [makeupEndTime, setMakeupEndTime] = useState(null);
  const [makeupLessonType, setMakeupLessonType] = useState('LEC');
  const [makeupStep, setMakeupStep] = useState(1);
  const [makeupAvailableRooms, setMakeupAvailableRooms] = useState([]);
  const [makeupSelectedRoom, setMakeupSelectedRoom] = useState(null);
  const [makeupSearchingRooms, setMakeupSearchingRooms] = useState(false);
  const [makeupRoomError, setMakeupRoomError] = useState('');
  const [makeupRoomFilter, setMakeupRoomFilter] = useState('');
  const [savingMakeup, setSavingMakeup] = useState(false);
  const [showMakeupDatePicker, setShowMakeupDatePicker] = useState(false);
  const [showMakeupStartPicker, setShowMakeupStartPicker] = useState(false);
  const [showMakeupEndPicker, setShowMakeupEndPicker] = useState(false);

  //  Merge lessons state 
  const [mergeModal, setMergeModal] = useState({ visible: false, entry: null });
  const [mergeSelectedIds, setMergeSelectedIds] = useState(new Set());
  const [mergeNote, setMergeNote] = useState('');
  const [mergeStep, setMergeStep] = useState(1);
  const [mergeAvailableRooms, setMergeAvailableRooms] = useState([]);
  const [mergeSelectedRoom, setMergeSelectedRoom] = useState(null);
  const [mergeSearchingRooms, setMergeSearchingRooms] = useState(false);
  const [mergeRoomError, setMergeRoomError] = useState('');
  const [mergeRoomFilter, setMergeRoomFilter] = useState('');
  const [savingMerge, setSavingMerge] = useState(false);
  const [mergeError, setMergeError] = useState('');

  //  Online status modal state 
  const [onlineModal, setOnlineModal] = useState({ visible: false, entry: null });
  const [onlineStartTime, setOnlineStartTime] = useState(null);
  const [onlineEndTime, setOnlineEndTime] = useState(null);
  const [showOnlineStartPicker, setShowOnlineStartPicker] = useState(false);
  const [showOnlineEndPicker, setShowOnlineEndPicker] = useState(false);

  // Load the cache once on mount
  useEffect(() => {
    loadRescheduleCache().then((c) => { rescheduleCacheRef.current = c; });
  }, []);

  const load = useCallback(async (showSpinner = true, isBackground = false) => {
    if (isBackground) {
      setIsBackgroundUpdate(true);
    } else if (showSpinner && !_timetableCache.entries) {
      setIsLoading(true);
    }
    if (!isBackground) setErrorMessage('');

    try {
      const session = await getLecturerSession();
      if (!session?.token) {
        throw new Error('No lecturer session found. Please sign in again.');
      }

      const assigned = await fetchMyLecturerTimetable(session.token);
      setIsFromCache(wasLastTimetableFetchFromCache());
      const list = Array.isArray(assigned) ? assigned : [];
      // Re-apply any locally-cached reschedule data the backend hasn't stored yet
      const cache = rescheduleCacheRef.current;
      const merged = list.map((e) => {
        const id = String(e?.id || '').trim();
        const override = cache[id];
        if (!override) return e;
        // Only apply if the backend still hasn't returned the value
        return {
          ...e,
          rescheduledTo: e.rescheduledTo || override.rescheduledTo,
          reschedulePermanent: e.reschedulePermanent ?? override.reschedulePermanent,
          // Restore compound sub-status (e.g. Rescheduled + Confirmed) from local cache
          ...(override.rescheduleSubStatus ? { status: 'Rescheduled', rescheduleSubStatus: override.rescheduleSubStatus } : {}),
        };
      });

      // Also load make-up / extra sessions and merge them in
      let extraMapped = [];
      try {
        const extraSessions = await fetchMyExtraSessions(session.token);
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        extraMapped = extraSessions.map((s) => {
          const d = s.date ? new Date(s.date) : null;
          const dayName = d && !isNaN(d.getTime()) ? dayNames[d.getDay()] : 'Unspecified';
          const start = s.startTime || '';
          const end = s.endTime || '';
          return {
            id: `extra-${s.id || s._id || s.sessionId || Date.now()}`,
            isExtraSession: true,
            unitCode: s.unitCode || '',
            unitTitle: s.unitName || s.unitTitle || '',
            day: dayName,
            date: s.date || '',
            time: start && end ? `${start} - ${end}` : start || end || '',
            startTime: start,
            endTime: end,
            roomCode: s.roomCode || '',
            type: s.lessonType || 'LEC',
            status: 'Confirmed',
            sessionId: s.id || s._id || s.sessionId || '',
          };
        });
      } catch (_) { /* extra sessions are non-critical */ }

      const finalEntries = [...merged, ...extraMapped];
      setEntries(finalEntries);
      _timetableCache.entries = finalEntries;
      _timetableCache.timestamp = Date.now();
      setLastRefreshed(new Date());

      // Write pending-lesson reminders for today and tomorrow
      try {
        const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
        const todayIdx = new Date().getDay();
        const todayStr = dayNames[todayIdx].toLowerCase();
        const tomorrowStr = dayNames[(todayIdx + 1) % 7].toLowerCase();
        const pendingReminders = finalEntries
          .filter(e => !e.isExtraSession && getEffectiveStatus(e) === 'Pending')
          .filter(e => {
            const d = String(e.day || '').trim().toLowerCase();
            return d === todayStr || d === tomorrowStr;
          })
          .map(e => ({
            id: `pending-${e.id}`,
            unitCode: e.unitCode || e.code || '',
            unitName: e.unitTitle || e.unitName || '',
            day: e.day,
            time: e.time || e.startTime || '',
            urgency: String(e.day || '').trim().toLowerCase() === todayStr ? 'today' : 'tomorrow',
            createdAt: new Date().toISOString(),
          }));
        await AsyncStorage.setItem('markwise.lecturer.status_reminders.v1', JSON.stringify(pendingReminders));

        // Play notification sound — rate-limited to once every 4 hours
        if (pendingReminders.length > 0) {
          const COOLDOWN_KEY = 'markwise.lecturer.reminder_notif_last.v1';
          const lastRaw = await AsyncStorage.getItem(COOLDOWN_KEY);
          const hoursSinceLast = lastRaw
            ? (Date.now() - new Date(lastRaw).getTime()) / 3_600_000
            : 999;
          if (hoursSinceLast >= 4) {
            await AsyncStorage.setItem(COOLDOWN_KEY, new Date().toISOString());
            const todayCount    = pendingReminders.filter(r => r.urgency === 'today').length;
            const tomorrowCount = pendingReminders.filter(r => r.urgency === 'tomorrow').length;
            const parts = [];
            if (todayCount)    parts.push(`${todayCount} lesson${todayCount !== 1 ? 's' : ''} today`);
            if (tomorrowCount) parts.push(`${tomorrowCount} tomorrow`);
            await displayLocalNotification({
              title:     'Lesson Status Update Required',
              body:      `You have ${parts.join(' and ')} still Pending. Tap to confirm, cancel, or reschedule.`,
              channelId: CHANNELS.reminder,
            });
          }
        }
      } catch (_) { /* reminders are non-critical */ }
    } catch (error) {
      if (_timetableCache.entries) return; // silently keep cached data on error
      setEntries([]);
      setIsFromCache(false);
      setErrorMessage(error?.message || 'Unable to load timetable.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
      if (isBackground) setIsBackgroundUpdate(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let task;
      const age = Date.now() - _timetableCache.timestamp;
      if (!_timetableCache.entries || age > STALE_MS) {
        load(true, false);
      } else {
        task = InteractionManager.runAfterInteractions(() => load(false, true));
      }
      return () => task?.cancel();
    }, [load]),
  );

  // Refresh immediately when a foreground FCM timetable event arrives
  useEffect(() => {
    const sub = onTimetableUpdated(() => { load(false, true); });
    return () => sub?.remove();
  }, [load]);

  // Refresh when app returns to foreground; honour the dirty flag set by background FCM
  useEffect(() => {
    const appStateRef = { current: AppState.currentState };
    const sub = AppState.addEventListener('change', async (nextState) => {
      if (appStateRef.current.match(/inactive|background/) && nextState === 'active') {
        const dirty = await isTimetableDirty();
        if (dirty) await clearTimetableDirty();
        load(false, true);
      }
      appStateRef.current = nextState;
    });
    return () => sub.remove();
  }, [load]);

  const groupedByDay = useMemo(() => {
    const grouped = entries.reduce((acc, entry) => {
      const day = String(entry?.day || 'Unspecified').trim();
      if (!acc[day]) {
        acc[day] = [];
      }
      acc[day].push(entry);
      return acc;
    }, {});

    return Object.entries(grouped)
      .sort((left, right) => daySortValue(left[0]) - daySortValue(right[0]))
      .map(([day, dayEntries]) => ({
        day,
        items: dayEntries,
      }));
  }, [entries]);

  // Map from entry.id → array of entries eligible to merge with it.
  // Only requires the same normalised unit code — cross-day and cross-time merges
  // are allowed since the lecturer may combine sections from different schedules.
  const mergeCandidatesMap = useMemo(() => {
    const nc = (c) => String(c || '').toUpperCase().replace(/\s+/g, '');
    const map = {};
    const normal = entries.filter((e) => !e.isExtraSession);
    for (const entry of normal) {
      if (entry.isMerged) continue;
      const code = nc(entry.unitCode);
      if (!code) continue;
      const candidates = normal.filter((other) => {
        if (String(other.id) === String(entry.id)) return false;
        if (other.isMerged) return false;
        return nc(other.unitCode) === code;
      });
      if (candidates.length > 0) {
        map[String(entry.id)] = candidates;
      }
    }
    return map;
  }, [entries]);

  const handleStatusChange = useCallback(async (entry, nextStatus, extraPayload = {}) => {
    const status = String(nextStatus || '').trim();
    if (!status) {
      return;
    }

    const entryId = String(entry?.id || '').trim();
    if (!entryId) {
      Alert.alert('Update failed', 'This timetable entry has no id, so status cannot be updated.');
      return;
    }

    const currentStatus = String(entry?.status || '').trim();
    if (status === currentStatus) {
      return;
    }

    const updateKey = `${entryId}:${status}`;
    setUpdatingEntryKey(updateKey);

    const optimisticReason = status === 'Cancelled' ? (extraPayload.reason || entry?.reason || 'Cancelled by lecturer') : entry?.reason;
    const optimisticPendingReason = status === 'Pending' ? entry?.pendingReason || 'Awaiting lecturer confirmation' : entry?.pendingReason;
    // Compound transition: entry is Rescheduled and lecturer picks Confirmed/Cancelled/Online
    //  keep displaying as 'Rescheduled' but add a rescheduleSubStatus
    const isCompound = entry?.status === 'Rescheduled' && status !== 'Rescheduled';
    const optimisticRescheduledTo = (status === 'Rescheduled' || isCompound) ? (extraPayload.rescheduledTo || entry?.rescheduledTo || 'To be announced') : null;
    const optimisticReschedulePermanent = (status === 'Rescheduled' || isCompound) ? (extraPayload.reschedulePermanent ?? entry?.reschedulePermanent ?? false) : entry?.reschedulePermanent;
    const optimisticSubStatus = isCompound ? status : null;

    setEntries((previous) =>
      previous.map((row) => {
        if (String(row?.id || '').trim() !== entryId) {
          return row;
        }
        return {
          ...row,
          status: isCompound ? 'Rescheduled' : status,
          rescheduleSubStatus: optimisticSubStatus,
          reason: optimisticReason || null,
          pendingReason: optimisticPendingReason || null,
          rescheduledTo: optimisticRescheduledTo,
          reschedulePermanent: optimisticReschedulePermanent,
          // Free the room only when directly switching to Online (not a compound rescheduledonline)
          venue: (status === 'Online' && !isCompound) ? null : row.venue,
          roomCode: (status === 'Online' && !isCompound) ? null : row.roomCode,
          lectureRoom: (status === 'Online' && !isCompound) ? null : row.lectureRoom,
          onlineStartTime: (status === 'Online' && !isCompound) ? (extraPayload.onlineStartTime || null) : row.onlineStartTime,
          onlineEndTime: (status === 'Online' && !isCompound) ? (extraPayload.onlineEndTime || null) : row.onlineEndTime,
          updatedAt: new Date().toISOString(),
          updatedBy: 'Lecturer',
        };
      })
    );

    try {
      const session = await getLecturerSession();
      if (!session?.token) {
        throw new Error('Your lecturer session expired. Please sign in again.');
      }

      const payload = {
        accessToken: session.token,
        entryId,
        status,
      };

      if (status === 'Cancelled') {
        payload.reason = optimisticReason;
      }
      if (status === 'Pending') {
        payload.pendingReason = optimisticPendingReason;
      }
      if (status === 'Rescheduled') {
        payload.rescheduledTo = optimisticRescheduledTo;
        payload.reschedulePermanent = optimisticReschedulePermanent ?? null;
      }
      if (status === 'Online') {
        payload.clearVenue = true;
        if (extraPayload.onlineStartTime) payload.onlineStartTime = extraPayload.onlineStartTime;
        if (extraPayload.onlineEndTime) payload.onlineEndTime = extraPayload.onlineEndTime;
      }

      const result = await updateLecturerTimetableEntryStatus(payload);

      if (status === 'Rescheduled' || isCompound) {
        // Persist locally so the card survives refreshes until the backend stores it
        const updatedCache = {
          ...rescheduleCacheRef.current,
          [entryId]: {
            rescheduledTo: optimisticRescheduledTo,
            reschedulePermanent: optimisticReschedulePermanent,
            rescheduleSubStatus: optimisticSubStatus,
          },
        };
        rescheduleCacheRef.current = updatedCache;
        saveRescheduleCache(updatedCache);
      } else {
        // Remove the cache entry if status changed away from Rescheduled
        const { [entryId]: _removed, ...rest } = rescheduleCacheRef.current;
        rescheduleCacheRef.current = rest;
        saveRescheduleCache(rest);
      }

      if (result?.updatedEntry) {
        setEntries((previous) =>
          previous.map((row) => {
            if (String(row?.id || '').trim() !== entryId) return row;
            const merged = { ...row, ...result.updatedEntry };
            // If the server response omits rescheduled fields, preserve the
            // optimistic values we already set so the card doesn't go blank.
            if (status === 'Rescheduled' || isCompound) {
              if (!merged.rescheduledTo) merged.rescheduledTo = optimisticRescheduledTo;
              if (merged.reschedulePermanent == null) merged.reschedulePermanent = optimisticReschedulePermanent;
              if (isCompound) {
                merged.status = 'Rescheduled';
                merged.rescheduleSubStatus = optimisticSubStatus;
              }
            }
            return merged;
          })
        );
      }
    } catch (error) {
      setEntries((previous) =>
        previous.map((row) => (String(row?.id || '').trim() === entryId ? entry : row))
      );
      Alert.alert('Status update failed', error?.message || 'Unable to update lesson status.');
    } finally {
      setUpdatingEntryKey('');
    }
  }, []);

  const handleCancelConfirm = useCallback(() => {
    const reason = cancelReason.trim();
    if (!reason) {
      Alert.alert('Reason required', 'Please provide a reason for cancelling this lecture.');
      return;
    }
    const { entry } = cancelModal;
    setCancelModal({ visible: false, entry: null });
    setCancelReason('');
    handleStatusChange(entry, 'Cancelled', { reason });
    // Propagate cancel to all sibling entries in the same merged group
    if (entry?.isMerged && entry?.mergedSessionId) {
      entries
        .filter((e) => String(e?.mergedSessionId || '') === String(entry.mergedSessionId) && String(e?.id || '') !== String(entry.id || ''))
        .forEach((sibling) => handleStatusChange(sibling, 'Cancelled', { reason }));
    }
    // Notify students  one notification covering all merged sections
    {
      const unitCode = String(entry?.unitCode || entry?.code || '').trim();
      const allSiblings = (entry?.isMerged && entry?.mergedSessionId)
        ? entries.filter((e) => String(e?.mergedSessionId || '') === String(entry.mergedSessionId))
        : [entry];
      const notifRecipients = [...new Set(allSiblings.map((e) => String(e?.unitCode || e?.code || '').trim()).filter(Boolean))];
      const sectionLabel = allSiblings.length > 1 ? ` (${allSiblings.length} merged sections)` : '';
      sendNotification({
        type: 'LESSON_CANCELLED',
        title: `${unitCode} - Lesson Cancelled`,
        message: `Your ${unitCode} lesson${sectionLabel} on ${String(entry?.day || '').trim() || 'the scheduled day'} has been cancelled. Reason: ${reason}`,
        recipients: notifRecipients.length > 0 ? notifRecipients : [unitCode],
        data: { unitCode, reason, isMerged: !!entry?.isMerged },
      }).catch(() => {});
      Vibration.vibrate(100);
      displayLocalNotification({
        title: 'Lesson Cancelled',
        body: `${unitCode} students have been notified about the cancellation.`,
        channelId: CHANNELS.lesson,
      }).catch(() => {});
    }
  }, [cancelModal, cancelReason, handleStatusChange, entries]);

  const formatTime = useCallback((date) => {
    if (!date) return '';
    const h = date.getHours().toString().padStart(2, '0');
    const m = date.getMinutes().toString().padStart(2, '0');
    return `${h}:${m}`;
  }, []);

  const closeRescheduleModal = useCallback(() => {
    setRescheduleModal({ visible: false, entry: null });
    setRescheduleDay('');
    setRescheduleStartTime(null);
    setRescheduleEndTime(null);
    setRescheduleStep(1);
    setAvailableRooms([]);
    setSelectedRoom(null);
    setSearchingRooms(false);
    setRoomSearchError('');
    setRoomFilterQuery('');
  }, []);

  const handleFindRooms = useCallback(async () => {
    if (!rescheduleDay) {
      Alert.alert('Day required', 'Please select a day for the rescheduled lecture.');
      return;
    }
    if (!rescheduleStartTime) {
      Alert.alert('Start time required', 'Please set the start time.');
      return;
    }
    if (!rescheduleEndTime) {
      Alert.alert('End time required', 'Please set the end time.');
      return;
    }
    if (rescheduleEndTime <= rescheduleStartTime) {
      Alert.alert('Invalid time', 'End time must be after start time.');
      return;
    }

    setSearchingRooms(true);
    setRoomSearchError('');
    setAvailableRooms([]);
    setSelectedRoom(null);

    try {
      const session = await getLecturerSession();
      if (!session?.token) throw new Error('Session expired. Please sign in again.');

      const reqStart = formatTime(rescheduleStartTime);
      const reqEnd = formatTime(rescheduleEndTime);

      // Helper: convert "HH:mm" to minutes since midnight for easy overlap check
      const toMinutes = (t) => {
        const [h, m] = String(t || '').split(':').map(Number);
        return (h || 0) * 60 + (m || 0);
      };
      const reqStartMin = toMinutes(reqStart);
      const reqEndMin = toMinutes(reqEnd);

      // 1. Fetch all rooms for the institution
      const roomData = await fetchRooms({
        institutionId: session.institutionId,
        token: session.token,
      });
      const allRooms = roomData?.data?.rooms || roomData?.rooms || (Array.isArray(roomData) ? roomData : []);

      // 2. Build a set of busy room IDs by checking existing timetable entries
      const busyRoomIds = new Set();

      // Check timetable entries (already loaded in `entries` state)
      entries.forEach((entry) => {
        const entryDay = String(entry?.day || '').trim();
        const entryStatus = String(entry?.status || '').trim();
        // Skip cancelled and merged entries  their room is free
        if (entryStatus === 'Cancelled') return;
        if (entry?.isMerged) return;

        // For rescheduled entries: the ORIGINAL slot is free, but check if
        // they were rescheduled TO the requested day/time
        if (entryStatus === 'Rescheduled') {
          const rTo = String(entry?.rescheduledTo || '').trim();
          // rescheduledTo format: "Day HH:mm - HH:mm - RoomCode"
          const match = rTo.match(/^(\w+)\s+(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/);
          if (match && match[1] === rescheduleDay) {
            const rStart = toMinutes(match[2]);
            const rEnd = toMinutes(match[3]);
            if (rStart < reqEndMin && rEnd > reqStartMin) {
              // Overlaps  the rescheduled room is busy
              const rRoom = rTo.split('|').pop()?.trim();
              if (rRoom) {
                allRooms.forEach((room) => {
                  const code = room.roomCode || room.room_code || room.name || room.code || '';
                  if (code.trim().toLowerCase() === rRoom.toLowerCase()) {
                    busyRoomIds.add(String(room.id || room._id));
                  }
                });
              }
            }
          }
          return; // Original slot is free  don't block the original room
        }

        // Normal active entry: check if it overlaps on the same day
        if (entryDay !== rescheduleDay) return;

        const timeStr = String(entry?.time || '').trim();
        const eStart = String(entry?.startTime || '').trim();
        const eEnd = String(entry?.endTime || '').trim();
        let entryStartMin, entryEndMin;

        if (eStart && eEnd) {
          entryStartMin = toMinutes(eStart);
          entryEndMin = toMinutes(eEnd);
        } else if (timeStr) {
          // time format: "08:00 - 10:00"
          const parts = timeStr.split('-').map((s) => s.trim());
          entryStartMin = toMinutes(parts[0]);
          entryEndMin = parts[1] ? toMinutes(parts[1]) : entryStartMin + 60;
        } else {
          return;
        }

        // Overlap check
        if (entryStartMin < reqEndMin && entryEndMin > reqStartMin) {
          const roomId = String(entry?.roomId || entry?.room_id || '');
          const roomCode = String(entry?.roomCode || entry?.room_code || entry?.venueCode || entry?.venue_code || entry?.venue || entry?.lectureRoom || entry?.room || entry?.location || '').trim();
          if (roomId) {
            busyRoomIds.add(roomId);
          } else if (roomCode) {
            allRooms.forEach((room) => {
              const code = room.roomCode || room.room_code || room.name || room.code || '';
              if (code.trim().toLowerCase() === roomCode.toLowerCase()) {
                busyRoomIds.add(String(room.id || room._id));
              }
            });
          }
        }
      });

      // 3. Also exclude rooms that have active bookings overlapping the slot
      allRooms.forEach((room) => {
        const bookings = Array.isArray(room.bookings) ? room.bookings : [];
        bookings.forEach((bk) => {
          const bkStatus = String(bk?.status || '').toLowerCase();
          if (bkStatus === 'cancelled') return;
          const bkStart = bk?.startAt || bk?.start_at || '';
          const bkEnd = bk?.endAt || bk?.end_at || '';
          if (!bkStart) return;
          const bkDate = new Date(bkStart);
          const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
          const bkDay = dayNames[bkDate.getDay()];
          if (bkDay !== rescheduleDay) return;
          const bkStartMin = bkDate.getHours() * 60 + bkDate.getMinutes();
          const bkEndDate = new Date(bkEnd);
          const bkEndMin = bkEndDate.getHours() * 60 + bkEndDate.getMinutes();
          if (bkStartMin < reqEndMin && bkEndMin > reqStartMin) {
            busyRoomIds.add(String(room.id || room._id));
          }
        });
      });

      // 4. Filter to only free rooms
      const freeRooms = allRooms.filter((room) => {
        const id = String(room.id || room._id);
        return !busyRoomIds.has(id);
      });

      freeRooms.sort((a, b) => {
        const cA = (a.roomCode || a.room_code || a.name || '').toLowerCase();
        const cB = (b.roomCode || b.room_code || b.name || '').toLowerCase();
        return cA.localeCompare(cB);
      });

      setAvailableRooms(freeRooms);
      setRescheduleStep(2);
    } catch (err) {
      setRoomSearchError(err?.message || 'Unable to search for available rooms.');
    } finally {
      setSearchingRooms(false);
    }
  }, [rescheduleDay, rescheduleStartTime, rescheduleEndTime, formatTime, entries]);

  const handleLessonTypeChange = useCallback(async (entry, newTypeCode) => {
    const entryId = String(entry?.id || '').trim();
    if (!entryId) return;
    const currentCode = getLessonTypeByName(entry?.type || entry?.lessonType).code;
    if (newTypeCode === currentCode) return;

    // Collect all entry IDs to update: just this entry, or all merged siblings too
    const siblingIds = (entry?.isMerged && entry?.mergedSessionId)
      ? entries
          .filter((e) => String(e?.mergedSessionId || '') === String(entry.mergedSessionId))
          .map((e) => String(e?.id || '').trim())
          .filter(Boolean)
      : [entryId];

    setEntries((prev) =>
      prev.map((row) =>
        siblingIds.includes(String(row?.id || '').trim())
          ? { ...row, type: newTypeCode, updatedAt: new Date().toISOString() }
          : row,
      ),
    );

    try {
      const session = await getLecturerSession();
      if (!session?.token) throw new Error('Session expired. Please sign in again.');
      // Fire update for every entry in the group (individual entries only fire once)
      await Promise.all(
        siblingIds.map((id) =>
          updateLecturerTimetableEntryStatus({
            accessToken: session.token,
            entryId: id,
            status: getEffectiveStatus(entries.find((e) => String(e?.id || '') === id) || entry),
            lessonType: newTypeCode,
          }),
        ),
      );
    } catch (error) {
      // Roll back all affected entries
      setEntries((prev) =>
        prev.map((row) => {
          if (!siblingIds.includes(String(row?.id || '').trim())) return row;
          const original = entries.find((e) => String(e?.id || '') === String(row?.id || ''));
          return original || row;
        }),
      );
      Alert.alert('Update failed', error?.message || 'Unable to update lesson type.');
    }
  }, [entries]);

  const handleOpenDelegate = useCallback(async (entry) => {
    setDelegateError('');
    setDelegateGroups([]);
    setDelegateModal({ visible: true, entry });
    setLoadingGroups(true);
    try {
      const unitCode = String(entry?.unitCode || entry?.code || '').trim();
      const groups = await getGroups(unitCode);
      setDelegateGroups(Array.isArray(groups) ? groups : []);
    } catch (err) {
      setDelegateError(err.message || 'Could not load groups');
    } finally {
      setLoadingGroups(false);
    }
  }, []);

  const handleConfirmDelegate = useCallback(async () => {
    const { entry } = delegateModal;
    if (!entry) return;
    const unitCode = String(entry?.unitCode || entry?.code || '').trim();
    const roomCode = String(entry?.roomCode || entry?.venueCode || entry?.venue || '').trim();

    // Ensure adaptiveConfig has institution mappings loaded before resolving BLE IDs.
    // On the lecturer's device these may not be cached yet, so we sync from the backend
    // if the mappings are absent.
    try {
      const lecSession = await getLecturerSession();
      if (lecSession?.institutionId) {
        await adaptiveConfig.initialize(lecSession.institutionId);
        if (!adaptiveConfig.mappings) {
          await adaptiveConfig.syncInstitutionMappingsFromBackend(
            lecSession.institutionId,
            lecSession.token,
          ).catch(() => {});
        }
      }
    } catch (_) {}

    const allGroups = delegateGroups.map((g) => ({
      groupId: g.id || g._id,
      groupNumber: g.groupNumber ?? g.number ?? 1,
      groupName: g.name || `Group ${g.groupNumber ?? g.number ?? 1}`,
      leaderStudentId: g.leaderId || g.leader?.id || g.leader?._id || null,
    }));

    // Only send groups that have a leader assigned  backend cannot notify leaderless groups
    const groups = allGroups.filter((g) => g.leaderStudentId);
    const skipped = allGroups.length - groups.length;

    if (groups.length === 0) {
      setDelegateError(
        `No group leaders are assigned. Open the Groups screen and assign a leader to each group before delegating.`
      );
      return;
    }

    setDelegating(true);
    setDelegateError('');
    try {
      // Resolve BLE numeric IDs from the code-string mappings.
      // entry.unitId / entry.roomId are DB FKs (small integers), NOT the
      // BLE packet IDs (units 0-7999, rooms 8000-9999). Always prefer the
      // adaptiveConfig lookup which returns the correct BLE-range value.
      const bleUnitId = adaptiveConfig.getUnitId(unitCode) ?? Number(entry?.unitId || 0);
      const bleRoomId = adaptiveConfig.getRoomId(roomCode) ?? Number(entry?.roomId || 0);
      console.log(
        `[Delegation] BLE IDs resolved: unit=${unitCode}${bleUnitId}, room=${roomCode}${bleRoomId}`,
      );

      const payload = {
        timetableEntryId: entry.id,
        unitCode,
        unitId: bleUnitId,
        roomCode,
        roomId: bleRoomId,
        groups,
        // Day-scoped window: any group can meet at any time today.
        // The exact meeting time is controlled by when the leader taps Start,
        // not by a tight pre-set window.
        validFrom: (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })(),
        validUntil: (() => { const d = new Date(); d.setHours(23, 59, 59, 999); return d.getTime(); })(),
      };
      console.log('[Delegation] createDelegation payload:', JSON.stringify(payload, null, 2));
      await createDelegation(payload);
      setDelegateModal({ visible: false, entry: null });
      const skippedMsg = skipped > 0 ? ` (${skipped} group${skipped > 1 ? 's' : ''} skipped - no leader assigned)` : '';
      Alert.alert(
        'Delegated',
        `${groups.length} group leader${groups.length > 1 ? 's have' : ' has'} been notified and can now host attendance for their group.${skippedMsg}`
      );
    } catch (err) {
      setDelegateError(err.message || 'Failed to delegate session');
    } finally {
      setDelegating(false);
    }
  }, [delegateModal, delegateGroups]);

  const handleRescheduleConfirm = useCallback(() => {
    if (!selectedRoom) {
      Alert.alert('Room required', 'Please select a room for the rescheduled lecture.');
      return;
    }
    const startStr = formatTime(rescheduleStartTime);
    const endStr = formatTime(rescheduleEndTime);
    const roomCode = selectedRoom.roomCode || selectedRoom.room_code || selectedRoom.name || selectedRoom.code || '';
    const rescheduledTo = `${rescheduleDay} ${startStr} - ${endStr} | ${roomCode}`;
    const { entry } = rescheduleModal;
    closeRescheduleModal();
    const reschedulePayload = {
      rescheduledTo,
      reschedulePermanent: rescheduleType === 'permanent',
      roomId: selectedRoom.id || selectedRoom._id || null,
    };
    handleStatusChange(entry, 'Rescheduled', reschedulePayload);
    // Propagate reschedule to all sibling entries in the same merged group
    if (entry?.isMerged && entry?.mergedSessionId) {
      entries
        .filter((e) => String(e?.mergedSessionId || '') === String(entry.mergedSessionId) && String(e?.id || '') !== String(entry.id || ''))
        .forEach((sibling) => handleStatusChange(sibling, 'Rescheduled', reschedulePayload));
    }
    // Notify students  one notification covering all merged sections
    {
      const unitCode = String(entry?.unitCode || entry?.code || '').trim();
      const allSiblings = (entry?.isMerged && entry?.mergedSessionId)
        ? entries.filter((e) => String(e?.mergedSessionId || '') === String(entry.mergedSessionId))
        : [entry];
      const notifRecipients = [...new Set(allSiblings.map((e) => String(e?.unitCode || e?.code || '').trim()).filter(Boolean))];
      const sectionLabel = allSiblings.length > 1 ? ` (${allSiblings.length} merged sections)` : '';
      sendNotification({
        type: 'LESSON_RESCHEDULED',
        title: `${unitCode} - Lesson Rescheduled`,
        message: `Your ${unitCode} lesson${sectionLabel} has been rescheduled to ${rescheduleDay} ${startStr} - ${endStr}, Room ${roomCode}.${rescheduleType === 'permanent' ? ' This is a permanent change.' : ''}`,
        recipients: notifRecipients.length > 0 ? notifRecipients : [unitCode],
        data: { unitCode, rescheduledTo, reschedulePermanent: rescheduleType === 'permanent', isMerged: !!entry?.isMerged },
      }).catch(() => {});
      Vibration.vibrate(100);
      displayLocalNotification({
        title: 'Lesson Rescheduled',
        body: `${unitCode} students have been notified about the new schedule.`,
        channelId: CHANNELS.lesson,
      }).catch(() => {});
    }
  }, [rescheduleModal, rescheduleStartTime, rescheduleEndTime, rescheduleType, selectedRoom, rescheduleDay, formatTime, closeRescheduleModal, handleStatusChange, entries]);

  const closeMakeupModal = useCallback(() => {
    setMakeupModal({ visible: false, entry: null });
    setMakeupDate(null);
    setMakeupStartTime(null);
    setMakeupEndTime(null);
    setMakeupLessonType('LEC');
    setMakeupStep(1);
    setMakeupAvailableRooms([]);
    setMakeupSelectedRoom(null);
    setMakeupSearchingRooms(false);
    setMakeupRoomError('');
    setMakeupRoomFilter('');
  }, []);

  const formatMakeupDate = useCallback((date) => {
    if (!date || isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  }, []);

  const handleFindRoomsForMakeup = useCallback(async () => {
    if (!makeupDate) {
      Alert.alert('Date required', 'Please select a date for the make-up session.');
      return;
    }
    if (!makeupStartTime) {
      Alert.alert('Start time required', 'Please set the start time.');
      return;
    }
    if (!makeupEndTime) {
      Alert.alert('End time required', 'Please set the end time.');
      return;
    }
    if (makeupEndTime <= makeupStartTime) {
      Alert.alert('Invalid time', 'End time must be after start time.');
      return;
    }

    setMakeupSearchingRooms(true);
    setMakeupRoomError('');
    setMakeupAvailableRooms([]);
    setMakeupSelectedRoom(null);

    try {
      const session = await getLecturerSession();
      if (!session?.token) throw new Error('Session expired. Please sign in again.');

      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const makeupDay = dayNames[makeupDate.getDay()];
      const reqStart = formatTime(makeupStartTime);
      const reqEnd = formatTime(makeupEndTime);

      const toMinutes = (t) => {
        const [h, m] = String(t || '').split(':').map(Number);
        return (h || 0) * 60 + (m || 0);
      };
      const reqStartMin = toMinutes(reqStart);
      const reqEndMin = toMinutes(reqEnd);

      const roomData = await fetchRooms({ institutionId: session.institutionId, token: session.token });
      const allRooms = roomData?.data?.rooms || roomData?.rooms || (Array.isArray(roomData) ? roomData : []);

      const busyRoomIds = new Set();

      entries.forEach((entry) => {
        const entryDay = String(entry?.day || '').trim();
        const entryStatus = String(entry?.status || '').trim();
        if (entryStatus === 'Cancelled') return;
        if (entry?.isMerged) return;
        if (entryStatus === 'Rescheduled') {
          const rTo = String(entry?.rescheduledTo || '').trim();
          const match = rTo.match(/^(\w+)\s+(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/);
          if (match && match[1] === makeupDay) {
            const rStart = toMinutes(match[2]);
            const rEnd = toMinutes(match[3]);
            if (rStart < reqEndMin && rEnd > reqStartMin) {
              const rRoom = rTo.split('|').pop()?.trim();
              if (rRoom) {
                allRooms.forEach((room) => {
                  const code = room.roomCode || room.room_code || room.name || room.code || '';
                  if (code.trim().toLowerCase() === rRoom.toLowerCase()) {
                    busyRoomIds.add(String(room.id || room._id));
                  }
                });
              }
            }
          }
          return;
        }
        if (entryDay !== makeupDay) return;
        const timeStr = String(entry?.time || '').trim();
        const eStart = String(entry?.startTime || '').trim();
        const eEnd = String(entry?.endTime || '').trim();
        let entryStartMin, entryEndMin;
        if (eStart && eEnd) {
          entryStartMin = toMinutes(eStart);
          entryEndMin = toMinutes(eEnd);
        } else if (timeStr) {
          const parts = timeStr.split('-').map((s) => s.trim());
          entryStartMin = toMinutes(parts[0]);
          entryEndMin = parts[1] ? toMinutes(parts[1]) : entryStartMin + 60;
        } else {
          return;
        }
        if (entryStartMin < reqEndMin && entryEndMin > reqStartMin) {
          const roomId = String(entry?.roomId || entry?.room_id || '');
          const roomCode = String(entry?.roomCode || entry?.room_code || entry?.venue || entry?.lectureRoom || '').trim();
          if (roomId) {
            busyRoomIds.add(roomId);
          } else if (roomCode) {
            allRooms.forEach((room) => {
              const code = room.roomCode || room.room_code || room.name || room.code || '';
              if (code.trim().toLowerCase() === roomCode.toLowerCase()) {
                busyRoomIds.add(String(room.id || room._id));
              }
            });
          }
        }
      });

      allRooms.forEach((room) => {
        const bookings = Array.isArray(room.bookings) ? room.bookings : [];
        bookings.forEach((bk) => {
          const bkStatus = String(bk?.status || '').toLowerCase();
          if (bkStatus === 'cancelled') return;
          const bkStart = bk?.startAt || bk?.start_at || '';
          const bkEnd = bk?.endAt || bk?.end_at || '';
          if (!bkStart) return;
          const bkDate = new Date(bkStart);
          const bkDay = dayNames[bkDate.getDay()];
          if (bkDay !== makeupDay) return;
          const bkStartMin = bkDate.getHours() * 60 + bkDate.getMinutes();
          const bkEndDate = new Date(bkEnd);
          const bkEndMin = bkEndDate.getHours() * 60 + bkEndDate.getMinutes();
          if (bkStartMin < reqEndMin && bkEndMin > reqStartMin) {
            busyRoomIds.add(String(room.id || room._id));
          }
        });
      });

      const freeRooms = allRooms.filter((room) => !busyRoomIds.has(String(room.id || room._id)));
      freeRooms.sort((a, b) => {
        const cA = (a.roomCode || a.room_code || a.name || '').toLowerCase();
        const cB = (b.roomCode || b.room_code || b.name || '').toLowerCase();
        return cA.localeCompare(cB);
      });

      setMakeupAvailableRooms(freeRooms);
      setMakeupStep(2);
    } catch (err) {
      setMakeupRoomError(err?.message || 'Unable to search for available rooms.');
    } finally {
      setMakeupSearchingRooms(false);
    }
  }, [makeupDate, makeupStartTime, makeupEndTime, formatTime, entries]);

  const handleSaveMakeup = useCallback(async () => {
    if (!makeupSelectedRoom) {
      Alert.alert('Room required', 'Please select a room.');
      return;
    }
    setSavingMakeup(true);
    try {
      const session = await getLecturerSession();
      if (!session?.token) throw new Error('Session expired. Please sign in again.');

      const dateStr = makeupDate.toISOString().split('T')[0];
      const startStr = formatTime(makeupStartTime);
      const endStr = formatTime(makeupEndTime);
      const roomCode = makeupSelectedRoom.roomCode || makeupSelectedRoom.room_code || makeupSelectedRoom.name || makeupSelectedRoom.code || '';
      const roomId = makeupSelectedRoom.id || makeupSelectedRoom._id || null;
      const { entry } = makeupModal;
      const unitCode = String(entry?.unitCode || entry?.code || '').trim();

      const serverEntry = await createExtraSession({
        unitCode,
        date: dateStr,
        startTime: startStr,
        endTime: endStr,
        roomCode,
        roomId,
        lessonType: makeupLessonType,
        lecturerId: session.lecturerId,
        token: session.token,
      });

      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const dayName = dayNames[makeupDate.getDay()];
      const newEntry = {
        id: `extra-${serverEntry?.id || serverEntry?.sessionId || Date.now()}`,
        isExtraSession: true,
        unitCode,
        unitTitle: entry.unitTitle || entry.unitName || entry.name || unitCode,
        day: dayName,
        date: dateStr,
        time: `${startStr} - ${endStr}`,
        startTime: startStr,
        endTime: endStr,
        roomCode,
        type: makeupLessonType,
        status: 'Confirmed',
        sessionId: serverEntry?.id || serverEntry?.sessionId || '',
        courseName: entry.courseName || null,
        department: entry.department || null,
      };

      setEntries((prev) => [...prev, newEntry]);
      closeMakeupModal();
      sendNotification({
        type: 'timetable',
        title: `${unitCode} - Make-Up Session Added`,
        message: `A make-up ${makeupLessonType} session has been scheduled for ${dayName}, ${dateStr} at ${startStr} - ${endStr}, Room ${roomCode}.`,
        recipients: [unitCode],
        data: { unitCode, date: dateStr, startTime: startStr, endTime: endStr, roomCode },
      }).catch(() => {});
      Vibration.vibrate(100);
      displayLocalNotification({
        title: 'Make-Up Session Added',
        body: `${unitCode} students have been notified about the session on ${dayName}, ${dateStr}.`,
        channelId: CHANNELS.lesson,
      }).catch(() => {});
      Alert.alert(
        'Make-Up Session Added',
        `Session added for ${unitCode} on ${dayName}, ${dateStr}.\nEnrolled students will be notified.`,
      );
    } catch (err) {
      Alert.alert('Failed to save', err.message || 'Could not create make-up session.');
    } finally {
      setSavingMakeup(false);
    }
  }, [makeupModal, makeupDate, makeupStartTime, makeupEndTime, makeupSelectedRoom, makeupLessonType, formatTime, closeMakeupModal]);

  //  Merge lessons handlers 

  const closeMergeModal = useCallback(() => {
    setMergeModal({ visible: false, entry: null });
    setMergeSelectedIds(new Set());
    setMergeNote('');
    setMergeStep(1);
    setMergeAvailableRooms([]);
    setMergeSelectedRoom(null);
    setMergeSearchingRooms(false);
    setMergeRoomError('');
    setMergeRoomFilter('');
    setMergeError('');
  }, []);

  const handleOpenMerge = useCallback((entry) => {
    const candidates = mergeCandidatesMap[String(entry.id)] || [];
    const allCandidates = [entry, ...candidates];
    const ids = new Set(allCandidates.map((c) => String(c.id)));
    setMergeModal({ visible: true, entry, allCandidates });
    setMergeSelectedIds(ids);
    setMergeNote('');
    setMergeStep(1);
    setMergeAvailableRooms([]);
    setMergeSelectedRoom(null);
    setMergeRoomError('');
    setMergeRoomFilter('');
    setMergeError('');
  }, [mergeCandidatesMap]);

  const handleFindRoomsForMerge = useCallback(async () => {
    const { entry } = mergeModal;
    if (!entry) return;
    setMergeSearchingRooms(true);
    setMergeRoomError('');
    setMergeAvailableRooms([]);
    setMergeSelectedRoom(null);
    try {
      const session = await getLecturerSession();
      if (!session?.token) throw new Error('Session expired. Please sign in again.');
      const day = String(entry.day || '').trim();
      const rawStart = String(entry.startTime || entry.time || '').replace(/\s*[-\u2013].*$/, '').trim();
      const rawEnd = String(entry.endTime || '').trim();
      const toMinutes = (t) => {
        const [h, m] = String(t || '').split(':').map(Number);
        return (h || 0) * 60 + (m || 0);
      };
      const reqStartMin = toMinutes(rawStart);
      const reqEndMin = rawEnd ? toMinutes(rawEnd) : reqStartMin + 120;
      const roomData = await fetchRooms({ institutionId: session.institutionId, token: session.token });
      const allRooms = roomData?.data?.rooms || roomData?.rooms || (Array.isArray(roomData) ? roomData : []);
      const busyRoomIds = new Set();
      entries.forEach((e) => {
        if (mergeSelectedIds.has(String(e.id))) return;
        if (e?.isMerged) return; // merged entries have vacated their original room
        const entryDay = String(e?.day || '').trim();
        const entryStatus = String(e?.status || '').trim();
        if (entryStatus === 'Cancelled') return;
        if (entryDay !== day) return;
        const eStart = String(e?.startTime || '').trim();
        const eEnd = String(e?.endTime || '').trim();
        const timeStr = String(e?.time || '').trim();
        let entryStartMin, entryEndMin;
        if (eStart && eEnd) {
          entryStartMin = toMinutes(eStart);
          entryEndMin = toMinutes(eEnd);
        } else if (timeStr) {
          const parts = timeStr.split('-').map((s) => s.trim());
          entryStartMin = toMinutes(parts[0]);
          entryEndMin = parts[1] ? toMinutes(parts[1]) : entryStartMin + 60;
        } else {
          return;
        }
        if (!entryStartMin) return;
        if (entryStartMin < reqEndMin && entryEndMin > reqStartMin) {
          const roomId = String(e?.roomId || e?.room_id || '');
          const roomCode = String(e?.roomCode || e?.room_code || e?.venue || e?.lectureRoom || '').trim();
          if (roomId) {
            busyRoomIds.add(roomId);
          } else if (roomCode) {
            allRooms.forEach((room) => {
              const code = room.roomCode || room.room_code || room.name || room.code || '';
              if (code.trim().toLowerCase() === roomCode.toLowerCase()) {
                busyRoomIds.add(String(room.id || room._id));
              }
            });
          }
        }
      });
      const freeRooms = allRooms.filter((room) => !busyRoomIds.has(String(room.id || room._id)));
      freeRooms.sort((a, b) =>
        (a.roomCode || a.room_code || a.name || '').toLowerCase().localeCompare(
          (b.roomCode || b.room_code || b.name || '').toLowerCase(),
        ),
      );
      setMergeAvailableRooms(freeRooms);
      setMergeStep(2);
    } catch (err) {
      setMergeRoomError(err?.message || 'Unable to search for available rooms.');
    } finally {
      setMergeSearchingRooms(false);
    }
  }, [mergeModal, mergeSelectedIds, entries]);

  const handleConfirmMerge = useCallback(async () => {
    if (!mergeSelectedRoom) {
      Alert.alert('Room required', 'Please select a room for the merged lecture.');
      return;
    }
    setSavingMerge(true);
    setMergeError('');
    try {
      const session = await getLecturerSession();
      if (!session?.token) throw new Error('Session expired. Please sign in again.');
      const { entry } = mergeModal;
      const unitCode = String(entry?.unitCode || entry?.code || '').trim();
      const roomCode = mergeSelectedRoom.roomCode || mergeSelectedRoom.room_code || mergeSelectedRoom.name || mergeSelectedRoom.code || '';
      const roomId = mergeSelectedRoom.id || mergeSelectedRoom._id || null;
      const entryIds = [...mergeSelectedIds];
      const mergedEntries = entries.filter((e) => mergeSelectedIds.has(String(e.id)));
      const courseLabels = mergedEntries
        .map((e) => [e.courseCode, e.courseName, e.department].filter(Boolean).join(' \u00b7 '))
        .filter(Boolean);
      const sessionDay = String(entry?.day || '').trim();
      const startStr = String(entry?.startTime || entry?.time || '').replace(/\s*[-].*$/, '').trim();
      const endStr = String(entry?.endTime || '').trim();
      const displayTime = startStr && endStr ? `${startStr} - ${endStr}` : startStr || '';
      const mergeResult = await mergeLessons({
        token: session.token,
        entryIds,
        unitCode,
        roomCode,
        roomId,
        note: mergeNote.trim() || null,
        day: sessionDay,
        startTime: startStr,
        endTime: endStr,
      });
      const mergedSessionId =
        mergeResult?.mergedSessionId ||
        mergeResult?.data?.mergedSessionId ||
        mergeResult?.session?.id ||
        mergeResult?.id ||
        null;
      const courseStr = courseLabels.length > 0 ? ` (${courseLabels.join(', ')})` : '';
      await sendNotification({
        type: 'MERGED_LESSON',
        title: `${unitCode} - Lessons Merged`,
        message: `Your ${unitCode} lecture${courseStr} has been combined into one session. Venue: ${roomCode}${sessionDay ? `, ${sessionDay}` : ''}${displayTime ? ` ${displayTime}` : ''}.${mergeNote.trim() ? ` Note: ${mergeNote.trim()}` : ''}`,
        recipients: [unitCode],
        data: { unitCode, roomCode, roomId, entryIds, day: sessionDay, startTime: startStr, endTime: endStr },
      }).catch(() => {});
      Vibration.vibrate(100);
      displayLocalNotification({
        title: 'Lessons Merged',
        body: `${unitCode} students have been notified about the merged session.`,
        channelId: CHANNELS.lesson,
      }).catch(() => {});
      setEntries((prev) =>
        prev.map((e) => {
          if (!mergeSelectedIds.has(String(e.id))) return e;
          return {
            ...e,
            isMerged: true,
            mergedRoom: roomCode,
            mergedDay: sessionDay,
            mergedStart: startStr,
            mergedEnd: endStr,
            mergedNote: mergeNote.trim() || null,
            mergedSessionId: mergedSessionId || null,
          };
        }),
      );
      closeMergeModal();
      Alert.alert(
        'Lessons Merged',
        `${mergedEntries.length} sections of ${unitCode} have been combined in Room ${roomCode}${sessionDay ? ` (${sessionDay}${displayTime ? `, ${displayTime}` : ''})` : ''}. All enrolled students have been notified.`,
      );
    } catch (err) {
      setMergeError(err?.message || 'Could not merge lessons. Please try again.');
    } finally {
      setSavingMerge(false);
    }
  }, [mergeModal, mergeSelectedIds, mergeSelectedRoom, mergeNote, entries, closeMergeModal]);

  const handleUnmerge = useCallback(async (entry) => {
    Alert.alert(
      'Unmerge Lessons',
      'This will unmerge the combined session. Each class section will return to its original schedule and students will be notified.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unmerge',
          style: 'destructive',
          onPress: async () => {
            try {
              const session = await getLecturerSession();
              if (!session?.token) throw new Error('Session expired. Please sign in again.');
              const unitCode = String(entry?.unitCode || entry?.code || '').trim();
              await unmergeLessons({ token: session.token, mergedSessionId: entry.mergedSessionId, unitCode });
              await sendNotification({
                type: 'UNMERGED_LESSON',
                title: `${unitCode} - Merge Cancelled`,
                message: `The merged ${unitCode} session has been cancelled. Each class section returns to its original schedule and venue.`,
                recipients: [unitCode],
                data: { unitCode },
              }).catch(() => {});
              setEntries((prev) =>
                prev.map((e) =>
                  String(e.unitCode || e.code || '').toUpperCase().replace(/\s+/g, '') ===
                  String(unitCode).toUpperCase().replace(/\s+/g, '') && e.isMerged
                    ? { ...e, isMerged: false, mergedRoom: null, mergedDay: null, mergedStart: null, mergedEnd: null, mergedNote: null, mergedSessionId: null }
                    : e,
                ),
              );
              Vibration.vibrate(100);
              displayLocalNotification({
                title: 'Merge Cancelled',
                body: `${unitCode} students have been notified — sessions return to original schedule.`,
                channelId: CHANNELS.lesson,
              }).catch(() => {});
            } catch (err) {
              Alert.alert('Unmerge failed', err?.message || 'Could not unmerge. Please try again.');
            }
          },
        },
      ],
    );
  }, []);

  //  Design helpers 
  const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const todayName = DAYS_OF_WEEK[new Date().getDay()];

  const [tick, setTick] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setTick(new Date()), 30000);
    return () => clearInterval(id);
  }, []);

  const parseToMin = (t) => {
    if (!t) return null;
    const clean = String(t).replace(/\s*[-].*$/, '').trim();
    const [h, m] = clean.split(':').map(Number);
    return isNaN(h) ? null : h * 60 + (m || 0);
  };

  const weeklyStats = useMemo(() => {
    const unitSet = new Set();
    let todayCount = 0;
    let pendingCount = 0;
    for (const e of entries) {
      const c = String(e.unitCode || e.code || '').trim().toUpperCase();
      if (c) unitSet.add(c);
      if (String(e.day || '').trim().toLowerCase() === todayName.toLowerCase()) todayCount++;
      if (!e.isExtraSession && getEffectiveStatus(e) === 'Pending') pendingCount++;
    }
    return { totalSessions: entries.length, todayCount, unitCount: unitSet.size, pendingCount };
  }, [entries, todayName]);

  const nextClass = useMemo(() => {
    const now = tick;
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const todayIdx = now.getDay();
    for (let offset = 0; offset < 7; offset++) {
      const dayName = DAYS_OF_WEEK[(todayIdx + offset) % 7];
      const daySessions = entries
        .filter((e) => String(e.day || '').trim().toLowerCase() === dayName.toLowerCase())
        .sort((a, b) => (parseToMin(a.startTime) ?? 999) - (parseToMin(b.startTime) ?? 999));
      for (const s of daySessions) {
        const startMin = parseToMin(s.startTime);
        if (startMin == null) continue;
        const endMin = parseToMin(s.endTime) ?? startMin + 60;
        if (offset === 0 && nowMin > endMin) continue;
        const isNow = offset === 0 && nowMin >= startMin && nowMin <= endMin;
        return { session: s, offset, dayName, isNow, minsUntil: offset === 0 ? Math.max(0, startMin - nowMin) : null };
      }
    }
    return null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, tick]);


  const todayLabel = tick.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  const nextCountdown = useMemo(() => {
    if (!nextClass) return null;
    if (nextClass.isNow) return 'In progress';
    if (nextClass.offset === 0 && nextClass.minsUntil != null) {
      if (nextClass.minsUntil < 1) return 'Starting now';
      if (nextClass.minsUntil < 60) return `${nextClass.minsUntil}m`;
      const h = Math.floor(nextClass.minsUntil / 60);
      const m = nextClass.minsUntil % 60;
      return m > 0 ? `${h}h ${m}m` : `${h}h`;
    }
    if (nextClass.offset === 1) return 'Tomorrow';
    return nextClass.dayName;
  }, [nextClass]);



  return (
    <SafeAreaView style={S.screen} edges={['top']}>

      {/*  Header  */}
      <LinearGradient
        colors={['#1E1B4B', '#3730A3', C.primaryDk]}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={S.header}
      >
        {/* Decorative glow orb */}
        <View style={S.headerOrb} />

        {/* Title row */}
        <View style={S.headerTitleRow}>
          <View style={{ flex: 1 }}>
            <Text style={S.headerTitle}>My Timetable</Text>
            <Text style={S.headerDate}>{todayLabel}</Text>
          </View>
          <View style={S.headerTopRight}>
            {isBackgroundUpdate
              ? <View style={S.bgDot} />
              : lastRefreshed
                ? (
                  <View style={S.syncBadge}>
                    <Icon name="check-circle-outline" size={10} color="#6EE7B7" />
                    <Text style={S.syncBadgeText}>
                      {lastRefreshed.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                  </View>
                )
                : null
            }
          </View>
        </View>

        {/* Stats strip — full width, 4 cells */}
        <View style={S.statStrip}>
          <View style={S.statCell}>
            <View style={S.statIconWrap}>
              <Icon name="calendar-week" size={13} color="rgba(255,255,255,0.75)" />
            </View>
            <Text style={S.statValue}>{weeklyStats.totalSessions}</Text>
            <Text style={S.statLabel}>Sessions</Text>
          </View>
          <View style={S.statDiv} />
          <View style={S.statCell}>
            <View style={[S.statIconWrap, { backgroundColor: 'rgba(165,180,252,0.18)' }]}>
              <Icon name="calendar-today" size={13} color="#A5B4FC" />
            </View>
            <Text style={S.statValue}>{weeklyStats.todayCount}</Text>
            <Text style={S.statLabel}>Today</Text>
          </View>
          <View style={S.statDiv} />
          <View style={S.statCell}>
            <View style={[S.statIconWrap, { backgroundColor: 'rgba(110,231,183,0.18)' }]}>
              <Icon name="book-open-variant" size={13} color="#6EE7B7" />
            </View>
            <Text style={S.statValue}>{weeklyStats.unitCount}</Text>
            <Text style={S.statLabel}>Units</Text>
          </View>
          <View style={S.statDiv} />
          <View style={S.statCell}>
            <View style={[S.statIconWrap, { backgroundColor: weeklyStats.pendingCount > 0 ? 'rgba(252,211,77,0.18)' : 'rgba(255,255,255,0.07)' }]}>
              <Icon name="clock-alert-outline" size={13} color={weeklyStats.pendingCount > 0 ? '#FCD34D' : 'rgba(255,255,255,0.35)'} />
            </View>
            <Text style={[S.statValue, weeklyStats.pendingCount > 0 && { color: '#FCD34D' }]}>
              {weeklyStats.pendingCount}
            </Text>
            <Text style={S.statLabel}>Pending</Text>
          </View>
        </View>

        {/* Next class card */}
        {nextClass && (
          <View style={S.nextCard}>
            <View style={S.nextCardLeft}>
              <View style={S.nextCardBadge}>
                <Icon
                  name={nextClass.isNow ? 'play-circle-outline' : 'clock-fast'}
                  size={10}
                  color={nextClass.isNow ? '#6EE7B7' : '#A5B4FC'}
                />
                <Text style={[S.nextCardBadgeText, { color: nextClass.isNow ? '#6EE7B7' : '#A5B4FC' }]}>
                  {nextClass.isNow ? 'IN PROGRESS' : 'NEXT CLASS'}
                </Text>
              </View>
              <Text style={S.nextCardName} numberOfLines={1}>
                {nextClass.session.unitTitle || nextClass.session.unitCode || '—'}
              </Text>
              <Text style={S.nextCardMeta} numberOfLines={1}>
                {[
                  nextClass.session.unitCode,
                  nextClass.session.startTime,
                  nextClass.session.roomCode || nextClass.session.lectureRoom,
                  nextClass.offset > 0 ? nextClass.dayName : null,
                ].filter(Boolean).join(' · ')}
              </Text>
            </View>
            <View style={S.nextCardRight}>
              <Text style={[S.nextCardCountdown, nextClass.isNow && { color: '#6EE7B7' }]}>
                {nextCountdown}
              </Text>
              <Icon
                name={nextClass.isNow ? 'broadcast' : 'chevron-right'}
                size={14}
                color={nextClass.isNow ? '#6EE7B7' : 'rgba(255,255,255,0.35)'}
              />
            </View>
          </View>
        )}
      </LinearGradient>

      {isFromCache && (
        <View style={S.offlineBanner}>
          <Icon name="wifi-off" size={13} color="#F59E0B" />
          <Text style={S.offlineBannerText}>Cached — pull to refresh when online</Text>
        </View>
      )}

      {/*  Scrollable content  */}
      <ScrollView
        style={S.scroll}
        contentContainerStyle={[S.scrollContent, (isTablet || isDesktop) && { maxWidth: contentMaxWidth, alignSelf: 'center', width: '100%' }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => { setIsRefreshing(true); load(false); }}
            colors={[C.primary]} tintColor="#6366F1"
          />
        }
      >
      {isLoading ? (
        <View style={S.centerState}>
          <ActivityIndicator size="large" color="#7C3AED" />
          <Text style={S.stateText}>Loading assigned timetable...</Text>
        </View>
      ) : errorMessage ? (
        <View style={S.centerState}>
          <Text style={S.errorText}>{errorMessage}</Text>
        </View>
      ) : groupedByDay.length === 0 ? (
        <View style={S.centerState}>
          <Text style={S.stateText}>No timetable entries assigned yet.</Text>
        </View>
      ) : (
        groupedByDay.map((group) => {
          const isToday = group.day.toLowerCase() === todayName.toLowerCase();
          return (
          <View key={group.day} style={[S.dayCard, isToday && S.dayCardToday]}>
            <View style={S.dayTitleRow}>
              <Text style={[S.dayTitle, isToday && S.dayTitleToday]}>{group.day}</Text>
              {isToday && <View style={S.todayPill}><Text style={S.todayPillText}>Today</Text></View>}
            </View>
            {group.items.map((entry, index) => {
              //  Merged group: render a single combined card for the first entry 
              if (entry.isMerged && entry.mergedSessionId) {
                const mergedGroup = group.items.filter(
                  (e) => String(e.mergedSessionId) === String(entry.mergedSessionId),
                );
                if (String(mergedGroup[0]?.id) !== String(entry.id)) return null;
                const totalStudents = mergedGroup.reduce(
                  (sum, e) => sum + (parseInt(e.studentCount || e.students || 0, 10)),
                  0,
                );
                const mergedStatus = getEffectiveStatus(entry);
                const mergedStatusColor = STATUS_COLORS[mergedStatus] || C.textDarkSec;
                const anyMergedUpdating = mergedGroup.some((e) =>
                  updatingEntryKey.startsWith(`${String(e?.id || '')}:`),
                );
                return (
                  <View key={`merged-${entry.mergedSessionId}`} style={S.mergedGroupCard}>
                    <View style={S.mergedGroupHeader}>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                          <Text style={S.mergedGroupTitle}>Merged Session</Text>
                          {entry.mergedBy === 'Admin' ? (
                            <View style={S.mergedByAdminBadge}>
                              <Text style={S.mergedByAdminBadgeText}>Admin</Text>
                            </View>
                          ) : (
                            <View style={S.mergedByLecturerBadge}>
                              <Text style={S.mergedByLecturerBadgeText}>You</Text>
                            </View>
                          )}
                        </View>
                        <Text style={S.mergedGroupSubtitle}>
                          {mergedGroup.length} sections combined, Room {entry.mergedRoom || ''}
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end', gap: 6 }}>
                        <TouchableOpacity
                          style={[S.statusDropdownBtn, { borderColor: mergedStatusColor, backgroundColor: mergedStatusColor + '12' }]}
                          onPress={() => setOpenDropdownEntryId(String(entry.id))}
                          disabled={anyMergedUpdating}
                          activeOpacity={0.85}
                        >
                          {anyMergedUpdating ? (
                            <ActivityIndicator size="small" color={mergedStatusColor} />
                          ) : (
                            <>
                              <Text style={[S.statusDropdownBtnText, { color: mergedStatusColor }]}>
                                {mergedStatus === 'Rescheduled' && entry.rescheduleSubStatus
                                  ? `${mergedStatus} - ${entry.rescheduleSubStatus}`
                                  : mergedStatus}
                              </Text>
                              <Text style={[S.statusDropdownChevron, { color: mergedStatusColor }]}>{'-'}</Text>
                            </>
                          )}
                        </TouchableOpacity>
                        {entry.mergedBy !== 'Admin' && (
                          <TouchableOpacity
                            style={S.unmergeBtn}
                            onPress={() => handleUnmerge(entry)}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            activeOpacity={0.7}
                          >
                            <Text style={S.unmergeBtnText}>Unmerge</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                    {mergedGroup.map((e) => (
                      <View key={String(e.id)} style={S.mergedGroupSectionRow}>
                        <Text style={S.mergedGroupSectionUnit}>
                          {e.unitTitle || e.unitName || e.unitCode}
                        </Text>
                      </View>
                    ))}
                    <View style={S.mergedGroupFooter}>
                      {!!entry.mergedStart && !!entry.mergedEnd && (
                        <Text style={S.mergedGroupMeta}>
                          {entry.mergedStart} - {entry.mergedEnd}
                        </Text>
                      )}
                      {!!totalStudents && (
                        <Text style={S.mergedGroupMeta}>{totalStudents} students combined</Text>
                      )}
                      {!!entry.mergedNote && (
                        <Text style={S.mergedGroupNote}>{entry.mergedNote}</Text>
                      )}
                    </View>
                    {mergedStatus === 'Rescheduled' && (() => {
                      const raw = String(entry?.rescheduledTo || '').trim();
                      const dotIdx = raw.indexOf('|');
                      const newTime = dotIdx !== -1 ? raw.slice(0, dotIdx).trim() : raw;
                      const newRoom = dotIdx !== -1 ? raw.slice(dotIdx + 1).trim() : '';
                      return (
                        <View style={S.rescheduleInfoBlock}>
                          <View style={S.rescheduleInfoHeader}>
                            <Text style={S.rescheduleInfoTitle}>Lesson Rescheduled</Text>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                              {!!entry.rescheduleSubStatus && (
                                <View style={[S.rescheduleBadge, { backgroundColor: (STATUS_COLORS[entry.rescheduleSubStatus] || C.textMid) + '22', borderWidth: 1, borderColor: STATUS_COLORS[entry.rescheduleSubStatus] || C.textMid }]}>
                                  <Text style={[S.rescheduleBadgeText, { color: STATUS_COLORS[entry.rescheduleSubStatus] || C.textMid }]}>
                                    {entry.rescheduleSubStatus === 'Confirmed' ? 'Confirmed' : entry.rescheduleSubStatus === 'Cancelled' ? 'Cancelled' : entry.rescheduleSubStatus === 'Online' ? 'Online' : entry.rescheduleSubStatus}
                                  </Text>
                                </View>
                              )}
                              <View style={[S.rescheduleBadge, entry?.reschedulePermanent ? S.permanentBadge : S.temporaryBadge]}>
                                <Text style={[S.rescheduleBadgeText, entry?.reschedulePermanent ? S.permanentText : S.temporaryText]}>
                                  {entry?.reschedulePermanent ? 'Permanent' : 'This week only'}
                                </Text>
                              </View>
                            </View>
                          </View>
                          <View style={S.rescheduleWasNowRow}>
                            <View style={S.rescheduleWasCol}>
                              <Text style={S.rescheduleWasLabel}>WAS</Text>
                              <Text style={S.rescheduleWasTime} numberOfLines={1}>{entry?.time || ''}</Text>
                              <Text style={S.rescheduleWasRoom} numberOfLines={1}>{entry?.mergedRoom || entry?.roomCode || entry?.venue || ''}</Text>
                            </View>
                            <Text style={S.rescheduleArrowLec}>{'>'}</Text>
                            <View style={S.rescheduleNowCol}>
                              <Text style={S.rescheduleNowLabel}>NOW</Text>
                              <Text style={S.rescheduleNowTime} numberOfLines={1}>{newTime || ''}</Text>
                              <Text style={S.rescheduleNowRoom} numberOfLines={1}>{newRoom || ''}</Text>
                            </View>
                          </View>
                        </View>
                      );
                    })()}
                    {mergedStatus === 'Online' && (
                      <View style={S.onlineInfoBlock}>
                        <View style={S.onlineBadge}>
                          <Text style={S.onlineBadgeText}>Online Lecture</Text>
                        </View>
                        {!!(entry.onlineStartTime || entry.onlineEndTime) && (
                          <Text style={S.onlineTimeText}>
                            {entry.onlineStartTime || ''}{entry.onlineStartTime && entry.onlineEndTime ? ' - ' : ''}{entry.onlineEndTime || ''}
                          </Text>
                        )}
                        <Text style={S.onlineLinkText}>Meeting link will be shared via Online Taker when the session starts.</Text>
                      </View>
                    )}
                    {mergedStatus === 'Cancelled' && !!entry?.reason && (
                      <Text style={S.statusMetaText}>Reason: {entry.reason}</Text>
                    )}
                    {mergedStatus === 'Pending' && !!entry?.pendingReason && (
                      <Text style={S.statusMetaText}>Pending: {entry.pendingReason}</Text>
                    )}
                    {(() => {
                      const mergedLessonType = getLessonTypeByName(entry?.type || entry?.lessonType);
                      return (
                        <>
                          <TouchableOpacity
                            style={[S.lessonTypePill, { backgroundColor: mergedLessonType.color + '22', borderColor: mergedLessonType.color, marginTop: 8 }]}
                            onPress={() => setOpenLessonTypeEntryId(String(entry.id))}
                            activeOpacity={0.75}
                          >
                            <Text style={[S.lessonTypePillText, { color: mergedLessonType.color }]}>{mergedLessonType.label}</Text>
                            <Text style={[S.lessonTypePillChevron, { color: mergedLessonType.color }]}>{'-'}</Text>
                          </TouchableOpacity>
                          {mergedLessonType.code === 'GD' && (
                            <TouchableOpacity
                              style={S.delegateBtn}
                              onPress={() => handleOpenDelegate(entry)}
                              disabled={anyMergedUpdating}
                              activeOpacity={0.8}
                            >
                              <Text style={S.delegateBtnText}>Delegate to Groups</Text>
                            </TouchableOpacity>
                          )}
                        </>
                      );
                    })()}
                    <TouchableOpacity
                      style={S.addMakeupBtn}
                      onPress={() => {
                        const mergedLessonType = getLessonTypeByName(entry?.type || entry?.lessonType);
                        setMakeupModal({ visible: true, entry });
                        setMakeupLessonType(mergedLessonType.code || 'LEC');
                      }}
                      activeOpacity={0.8}
                    >
                      <Text style={S.addMakeupBtnText}>+ Add Make-Up Session</Text>
                    </TouchableOpacity>
                  </View>
                );
              }

              const unitCode = String(entry?.unitCode || entry?.code || '').trim();
              const unitName = String(entry?.unitTitle || entry?.unitName || entry?.name || '').trim() || unitCode || 'Unnamed assigned unit';
              const time = String(entry?.time || '').trim();
              const startTime = String(entry?.startTime || '').trim();
              const endTime = String(entry?.endTime || '').trim();
              const timeDisplay = time || (startTime && endTime ? `${startTime} - ${endTime}` : startTime || endTime || 'Time not set');
              const venue = String(entry?.roomCode || entry?.room_code || entry?.venueCode || entry?.venue_code || entry?.venue || entry?.lectureRoom || entry?.room || entry?.location || '').trim();
              const status = getEffectiveStatus(entry);
              const statusColor = STATUS_COLORS[status] || C.textDarkSec;
              const isEntryUpdating = updatingEntryKey.startsWith(`${String(entry?.id || '').trim()}:`);
              const lessonType = getLessonTypeByName(entry?.type || entry?.lessonType);

              return (
                <View key={`${unitCode || unitName}-${index}`} style={S.entryRow}>
                  <View style={S.entryHeader}>
                    <View style={S.entryHeaderLeft}>
                      <Text style={S.unitName}>{unitName}</Text>
                      {!!unitCode && <Text style={S.unitCode}>{unitCode}</Text>}
                      {!!(entry.courseName || entry.department) && (
                        <Text style={S.unitCourse} numberOfLines={1}>
                          {[entry.courseName, entry.department].filter(Boolean).join(' - ')}
                        </Text>
                      )}
                    </View>
                    {entry.isExtraSession ? (
                      <View style={S.makeupBadge}>
                        <Text style={S.makeupBadgeText}>Make-Up</Text>
                      </View>
                    ) : (
                      <TouchableOpacity
                        style={[S.statusDropdownBtn, { borderColor: statusColor, backgroundColor: `${statusColor}12` }]}
                        onPress={() => setOpenDropdownEntryId(String(entry?.id || index))}
                        disabled={isEntryUpdating}
                        activeOpacity={0.85}
                      >
                        {isEntryUpdating ? (
                          <ActivityIndicator size="small" color={statusColor} />
                        ) : (
                          <>
                            <Text style={[S.statusDropdownBtnText, { color: statusColor }]}>{status === 'Rescheduled' && entry.rescheduleSubStatus ? `${status} - ${entry.rescheduleSubStatus}` : status}</Text>
                            <Text style={[S.statusDropdownChevron, { color: statusColor }]}>{'-'}</Text>
                          </>
                        )}
                      </TouchableOpacity>
                    )}
                  </View>
                  {!entry.isExtraSession && (
                    <TouchableOpacity
                      style={[S.lessonTypePill, { backgroundColor: lessonType.color + '22', borderColor: lessonType.color }]}
                      onPress={() => setOpenLessonTypeEntryId(String(entry?.id || index))}
                      activeOpacity={0.75}
                    >
                      <Text style={[S.lessonTypePillText, { color: lessonType.color }]}>{lessonType.label}</Text>
                      <Text style={[S.lessonTypePillChevron, { color: lessonType.color }]}>{'-'}</Text>
                    </TouchableOpacity>
                  )}
                  {!entry.isExtraSession && lessonType.code === 'GD' && (
                    <TouchableOpacity
                      style={S.delegateBtn}
                      onPress={() => handleOpenDelegate(entry)}
                      disabled={isEntryUpdating}
                      activeOpacity={0.8}
                    >
                      <Text style={S.delegateBtnText}>  Delegate to Groups</Text>
                    </TouchableOpacity>
                  )}
                  {entry.isExtraSession && !!entry.date && (
                    <Text style={S.metaText}> {formatMakeupDate(new Date(entry.date))}</Text>
                  )}
                  <Text style={S.metaText}>{timeDisplay}</Text>
                  {!!venue && <Text style={S.metaText}>Venue: {venue}</Text>}
                  {!entry.isExtraSession && status === 'Rescheduled' && (() => {
                    const raw = String(entry?.rescheduledTo || '').trim();
                    const dotIdx = raw.indexOf('-');
                    const newTime = dotIdx !== -1 ? raw.slice(0, dotIdx).trim() : raw;
                    const newRoom = dotIdx !== -1 ? raw.slice(dotIdx + 1).trim() : '';
                    return (
                      <View style={S.rescheduleInfoBlock}>
                        {/* Header */}
                        <View style={S.rescheduleInfoHeader}>
                          <Text style={S.rescheduleInfoTitle}>Lesson Rescheduled</Text>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                            {!!entry.rescheduleSubStatus && (
                              <View style={[S.rescheduleBadge, { backgroundColor: (STATUS_COLORS[entry.rescheduleSubStatus] || C.textMid) + '22', borderWidth: 1, borderColor: STATUS_COLORS[entry.rescheduleSubStatus] || C.textMid }]}>
                                <Text style={[S.rescheduleBadgeText, { color: STATUS_COLORS[entry.rescheduleSubStatus] || C.textMid }]}>
                                  {entry.rescheduleSubStatus === 'Confirmed' ? 'Confirmed' : entry.rescheduleSubStatus === 'Cancelled' ? 'Cancelled' : entry.rescheduleSubStatus === 'Online' ? 'Online' : entry.rescheduleSubStatus}
                                </Text>
                              </View>
                            )}
                            <View style={[S.rescheduleBadge, entry?.reschedulePermanent ? S.permanentBadge : S.temporaryBadge]}>
                              <Text style={[S.rescheduleBadgeText, entry?.reschedulePermanent ? S.permanentText : S.temporaryText]}>
                                {entry?.reschedulePermanent ? ' Permanent' : ' This week only'}
                              </Text>
                            </View>
                          </View>
                        </View>
                        {/* WAS  NOW row */}
                        <View style={S.rescheduleWasNowRow}>
                          <View style={S.rescheduleWasCol}>
                            <Text style={S.rescheduleWasLabel}>WAS</Text>
                            <Text style={S.rescheduleWasTime} numberOfLines={1}>{entry?.time || ''}</Text>
                            <Text style={S.rescheduleWasRoom} numberOfLines={1}>{entry?.roomCode || entry?.venue || ''}</Text>
                          </View>
                          <Text style={S.rescheduleArrowLec}></Text>
                          <View style={S.rescheduleNowCol}>
                            <Text style={S.rescheduleNowLabel}>NOW</Text>
                            <Text style={S.rescheduleNowTime} numberOfLines={1}>{newTime || ''}</Text>
                            <Text style={S.rescheduleNowRoom} numberOfLines={1}>{newRoom || entry?.rescheduledVenue || ''}</Text>
                          </View>
                        </View>
                      </View>
                    );
                  })()}
                  {!entry.isExtraSession && status === 'Online' && (
                    <View style={S.onlineInfoBlock}>
                      <View style={S.onlineBadge}>
                        <Text style={S.onlineBadgeText}>Online Lecture</Text>
                      </View>
                      {!!(entry.onlineStartTime || entry.onlineEndTime) && (
                        <Text style={S.onlineTimeText}>
                          {entry.onlineStartTime || ''}{entry.onlineStartTime && entry.onlineEndTime ? ' - ' : ''}{entry.onlineEndTime || ''}
                        </Text>
                      )}
                      <Text style={S.onlineLinkText}>Meeting link will be shared via Online Taker when the session starts.</Text>
                    </View>
                  )}
                  {!entry.isExtraSession && status === 'Cancelled' && !!entry?.reason && (
                    <Text style={S.statusMetaText}>Reason: {entry.reason}</Text>
                  )}
                  {!entry.isExtraSession && status === 'Pending' && !!entry?.pendingReason && (
                    <Text style={S.statusMetaText}>Pending: {entry.pendingReason}</Text>
                  )}
                  {!entry.isExtraSession && (
                    <TouchableOpacity
                      style={S.addMakeupBtn}
                      onPress={() => {
                        setMakeupModal({ visible: true, entry });
                        setMakeupLessonType(lessonType.code || 'LEC');
                      }}
                      activeOpacity={0.8}
                    >
                      <Text style={S.addMakeupBtnText}>+ Add Make-Up Session</Text>
                    </TouchableOpacity>
                  )}
                  {!entry.isExtraSession && !!mergeCandidatesMap[String(entry.id)] && !entry.isMerged && (
                    <TouchableOpacity
                      style={S.mergeLessonsBtn}
                      onPress={() => handleOpenMerge(entry)}
                      activeOpacity={0.8}
                    >
                      <Text style={S.mergeLessonsBtnText}>Merge with Other Classes</Text>
                    </TouchableOpacity>
                  )}
                  {!entry.isExtraSession && !!entry.isMerged && (
                    <View style={S.mergedBadge}>
                      <View style={S.mergedBadgeRow}>
                        <Text style={S.mergedBadgeText}>Merged - Room {entry.mergedRoom}</Text>
                        <TouchableOpacity
                          style={S.unmergeBtn}
                          onPress={() => handleUnmerge(entry)}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          activeOpacity={0.7}
                        >
                          <Text style={S.unmergeBtnText}>Unmerge</Text>
                        </TouchableOpacity>
                      </View>
                      {!!entry.mergedNote && <Text style={S.mergedNoteText}>{entry.mergedNote}</Text>}
                    </View>
                  )}
                  {entry.isExtraSession && (
                    <TouchableOpacity
                      style={S.deleteExtraBtn}
                      onPress={() => {
                        Alert.alert(
                          'Remove Make-Up Session',
                          'This will permanently remove this make-up session. Students will no longer see it.',
                          [
                            { text: 'Cancel', style: 'cancel' },
                            {
                              text: 'Remove',
                              style: 'destructive',
                              onPress: async () => {
                                try {
                                  const session = await getLecturerSession();
                                  await deleteExtraSession(entry.sessionId, session.token);
                                  setEntries((prev) => prev.filter((e) => e.id !== entry.id));
                                } catch (err) {
                                  Alert.alert('Error', err.message || 'Could not remove session.');
                                }
                              },
                            },
                          ],
                        );
                      }}
                      activeOpacity={0.8}
                    >
                      <Text style={S.deleteExtraBtnText}>Remove Session</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
          </View>
          );
        })
      )}
      <Modal
        visible={!!openLessonTypeEntryId}
        transparent
        animationType="fade"
        onRequestClose={() => setOpenLessonTypeEntryId('')}
      >
        <Pressable style={S.dropdownOverlay} onPress={() => setOpenLessonTypeEntryId('')}>
          <View style={S.dropdownSheet}>
            <Text style={S.dropdownSheetTitle}>Set Lesson Type</Text>
            {LESSON_TYPES.map((lt) => {
              const activeEntry = entries.find((e) => String(e?.id || '') === openLessonTypeEntryId);
              const currentCode = getLessonTypeByName(activeEntry?.type || activeEntry?.lessonType).code;
              const isSelected = lt.code === currentCode;
              return (
                <TouchableOpacity
                  key={lt.code}
                  style={[S.dropdownOption, isSelected && { backgroundColor: `${lt.color}15`, borderColor: lt.color }]}
                  onPress={() => {
                    setOpenLessonTypeEntryId('');
                    if (!activeEntry) return;
                    handleLessonTypeChange(activeEntry, lt.code);
                  }}
                  activeOpacity={0.8}
                >
                  <View style={[S.dropdownOptionDot, { backgroundColor: lt.color }]} />
                  <Text style={[S.dropdownOptionText, isSelected && { color: lt.color, fontWeight: '700' }]}>{lt.label}</Text>
                  <Text style={S.lessonTypeCodeLabel}>{lt.code}</Text>
                  {isSelected && <Text style={[S.dropdownOptionCheck, { color: lt.color }]}></Text>}
                </TouchableOpacity>
              );
            })}
          </View>
        </Pressable>
      </Modal>

      <Modal
        visible={!!openDropdownEntryId}
        transparent
        animationType="fade"
        onRequestClose={() => setOpenDropdownEntryId('')}
      >
        <Pressable style={S.dropdownOverlay} onPress={() => setOpenDropdownEntryId('')}>
          <View style={S.dropdownSheet}>
            <Text style={S.dropdownSheetTitle}>Set Lesson Status</Text>
            <Text style={S.dropdownSheetSubtitle}>Pending is set automatically until you choose a status below.</Text>
            {LESSON_STATUS_OPTIONS.map((option) => {
              const optionColor = STATUS_COLORS[option] || C.textDarkSec;
              const activeEntry = entries.find((e) => String(e?.id || '') === openDropdownEntryId);
              const isSelected = option === getEffectiveStatus(activeEntry);
              const actionKey = `${openDropdownEntryId}:${option}`;
              const isUpdatingThisAction = updatingEntryKey === actionKey;
              return (
                <TouchableOpacity
                  key={option}
                  style={[
                    S.dropdownOption,
                    isSelected && { backgroundColor: `${optionColor}15`, borderColor: optionColor },
                  ]}
                  onPress={() => {
                    setOpenDropdownEntryId('');
                    if (!activeEntry) { return; }
                    if (option === 'Cancelled') {
                      setCancelReason('');
                      setCancelModal({ visible: true, entry: activeEntry });
                    } else if (option === 'Rescheduled') {
                      setRescheduleDay('');
                      setRescheduleStartTime(null);
                      setRescheduleEndTime(null);
                      setRescheduleType('temporary');
                      setRescheduleStep(1);
                      setAvailableRooms([]);
                      setSelectedRoom(null);
                      setRoomSearchError('');
                      setRescheduleModal({ visible: true, entry: activeEntry });
                    } else if (option === 'Online') {
                      const parseEntryTime = (str) => {
                        const clean = String(str || '').replace(/\s*[-\u2013].*$/, '').trim();
                        if (!clean) return null;
                        const [h, m] = clean.split(':').map(Number);
                        const d = new Date();
                        d.setHours(h || 8, m || 0, 0, 0);
                        return d;
                      };
                      setOnlineStartTime(parseEntryTime(activeEntry.startTime || activeEntry.time));
                      setOnlineEndTime(parseEntryTime(activeEntry.endTime));
                      setOnlineModal({ visible: true, entry: activeEntry });
                    } else {
                      handleStatusChange(activeEntry, option);
                      if (option === 'Confirmed') {
                        const unitCode = String(activeEntry?.unitCode || activeEntry?.code || '').trim();
                        const day      = String(activeEntry?.day || '').trim();
                        const time     = String(activeEntry?.startTime || activeEntry?.time || '').trim();
                        const venue    = String(activeEntry?.venue || activeEntry?.lectureRoom || activeEntry?.roomCode || '').trim();
                        const venueLabel = venue ? `, Room ${venue}` : '';
                        sendNotification({
                          type: 'LESSON_CONFIRMED',
                          title: `${unitCode} - Lesson Confirmed`,
                          message: `Your ${unitCode} lesson on ${day}${time ? ` at ${time}` : ''}${venueLabel} will proceed as scheduled.`,
                          recipients: [unitCode],
                          data: { unitCode, day, time, venue },
                        }).catch(() => {});
                        Vibration.vibrate(100);
                        displayLocalNotification({
                          title: 'Lesson Confirmed',
                          body: `${unitCode} students have been notified the lesson is confirmed.`,
                          channelId: CHANNELS.lesson,
                        }).catch(() => {});
                      }
                    }
                  }}
                  activeOpacity={0.8}
                >
                  {isUpdatingThisAction ? (
                    <ActivityIndicator size="small" color={optionColor} />
                  ) : (
                    <>
                      <View style={[S.dropdownOptionDot, { backgroundColor: optionColor }]} />
                      <Text style={[S.dropdownOptionText, isSelected && { color: optionColor, fontWeight: '700' }]}>
                        {STATUS_DIALOG_LABELS[option] || option}
                      </Text>
                      {isSelected && <Text style={[S.dropdownOptionCheck, { color: optionColor }]}></Text>}
                    </>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </Pressable>
      </Modal>

      {/* Cancel Lecture Modal */}
      <Modal
        visible={cancelModal.visible}
        transparent
        animationType="slide"
        onRequestClose={() => { setCancelModal({ visible: false, entry: null }); setCancelReason(''); }}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <Pressable style={S.modalOverlay} onPress={() => { setCancelModal({ visible: false, entry: null }); setCancelReason(''); }}>
            <Pressable onPress={() => {}} style={S.actionSheet}>
              <View style={S.actionSheetHandle} />
              <Text style={S.actionSheetTitle}>Cancel Lecture</Text>
              <Text style={S.actionSheetSubtitle}>
                Please provide a reason for cancelling this lecture. Students will be notified.
              </Text>
              <TextInput
                style={S.reasonInput}
                placeholder="e.g. Lecturer is unwell, room unavailable..."
                placeholderTextColor="#94A3B8"
                multiline
                numberOfLines={4}
                value={cancelReason}
                onChangeText={setCancelReason}
                maxLength={300}
              />
              <Text style={S.charCount}>{cancelReason.length}/300</Text>
              <TouchableOpacity
                style={[S.confirmBtn, { backgroundColor: '#B91C1C' }]}
                onPress={handleCancelConfirm}
                activeOpacity={0.85}
              >
                <Text style={S.confirmBtnText}>Confirm Cancellation</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={S.backBtn}
                onPress={() => { setCancelModal({ visible: false, entry: null }); setCancelReason(''); }}
                activeOpacity={0.85}
              >
                <Text style={S.backBtnText}>Go Back</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      {/* Delegate GD Session Modal */}
      <Modal
        visible={delegateModal.visible}
        transparent
        animationType="slide"
        onRequestClose={() => setDelegateModal({ visible: false, entry: null })}
      >
        <Pressable style={S.modalOverlay} onPress={() => setDelegateModal({ visible: false, entry: null })}>
          <Pressable onPress={() => {}} style={S.actionSheet}>
            <View style={S.actionSheetHandle} />
            <Text style={S.actionSheetTitle}>Delegate Group Discussion</Text>
            <Text style={S.actionSheetSubtitle}>
              Each group leader will receive a notification to host BLE attendance for their group.
            </Text>
            {loadingGroups ? (
              <ActivityIndicator color="#10B981" style={{ marginVertical: 20 }} />
            ) : delegateGroups.length === 0 ? (
              <View style={S.noGroupsWrap}>
                <Text style={S.noGroupsText}>No groups found for this unit.</Text>
                <Text style={S.noGroupsHint}>Create groups first from the Groups screen.</Text>
              </View>
            ) : (
              <>
                <Text style={S.fieldLabel}>Groups ({delegateGroups.length})</Text>
                {delegateGroups.map((g) => {
                  const num = g.groupNumber ?? g.number ?? '?';
                  const name = g.name || `Group ${num}`;
                  const leader = g.leaderName || g.leader?.name || g.leader?.fullName || 'No leader assigned';
                  return (
                    <View key={String(g.id || g._id || num)} style={S.delegateGroupRow}>
                      <Text style={S.delegateGroupName}>{name}</Text>
                      <Text style={S.delegateGroupLeader}>Leader: {leader}</Text>
                    </View>
                  );
                })}
              </>
            )}
            {!!delegateError && <Text style={S.delegateError}>{delegateError}</Text>}
            {delegateGroups.length > 0 && (
              <TouchableOpacity
                style={[S.confirmBtn, { backgroundColor: C.success, marginTop: 12 }, (delegating || loadingGroups) && { opacity: 0.6 }]}
                onPress={handleConfirmDelegate}
                disabled={delegating || loadingGroups}
                activeOpacity={0.85}
              >
                {delegating ? (
                  <ActivityIndicator color="#FFF" size="small" />
                ) : (
                  <Text style={S.confirmBtnText}>Notify All Leaders</Text>
                )}
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={S.backBtn}
              onPress={() => setDelegateModal({ visible: false, entry: null })}
              activeOpacity={0.85}
            >
              <Text style={S.backBtnText}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Reschedule Lecture Modal */}
      <Modal
        visible={rescheduleModal.visible}
        transparent
        animationType="slide"
        onRequestClose={closeRescheduleModal}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <Pressable style={S.modalOverlay} onPress={closeRescheduleModal}>
            <Pressable onPress={() => {}} style={S.actionSheet}>
              <View style={S.actionSheetHandle} />
              <Text style={S.actionSheetTitle}>Reschedule Lecture</Text>

              {/* Step indicator */}
              <View style={S.stepRow}>
                <View style={[S.stepDot, rescheduleStep >= 1 && S.stepDotActive]} />
                <View style={[S.stepLine, rescheduleStep >= 2 && S.stepLineActive]} />
                <View style={[S.stepDot, rescheduleStep >= 2 && S.stepDotActive]} />
              </View>

              {rescheduleStep === 1 ? (
                <>
                  {/*  Step 1: Day, time & type  */}
                  <View style={S.rescheduleTypeRow}>
                    <TouchableOpacity
                      style={[S.rescheduleTypeBtn, rescheduleType === 'temporary' && S.rescheduleTypeBtnActive]}
                      onPress={() => setRescheduleType('temporary')}
                    >
                      <Text style={[S.rescheduleTypeBtnText, rescheduleType === 'temporary' && S.rescheduleTypeBtnTextActive]}>Temporary</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[S.rescheduleTypeBtn, rescheduleType === 'permanent' && S.rescheduleTypeBtnActive]}
                      onPress={() => setRescheduleType('permanent')}
                    >
                      <Text style={[S.rescheduleTypeBtnText, rescheduleType === 'permanent' && S.rescheduleTypeBtnTextActive]}>Permanent</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={S.rescheduleTypeNote}>
                    {rescheduleType === 'temporary'
                      ? 'Applies this week only. Reverts to original slot on Friday night.'
                      : 'Applies for the rest of the semester.'}
                  </Text>

                  <Text style={S.fieldLabel}>New Day</Text>
                  <View style={S.dayPickerRow}>
                    {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d) => (
                      <TouchableOpacity
                        key={d}
                        style={[S.dayPill, rescheduleDay === d && S.dayPillActive]}
                        onPress={() => setRescheduleDay(d)}
                      >
                        <Text style={[S.dayPillText, rescheduleDay === d && S.dayPillTextActive]}>{d.slice(0, 3)}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <Text style={S.fieldLabel}>Start Time</Text>
                  <TouchableOpacity style={S.timeInput} onPress={() => setShowStartPicker(true)} activeOpacity={0.8}>
                    <Text style={rescheduleStartTime ? S.timeInputText : S.timeInputPlaceholder}>
                      {rescheduleStartTime ? formatTime(rescheduleStartTime) : 'Tap to select start time'}
                    </Text>
                  </TouchableOpacity>
                  {showStartPicker && (
                    <DateTimePicker
                      mode="time"
                      is24Hour
                      minuteInterval={5}
                      value={rescheduleStartTime || new Date(2026, 0, 1, 8, 0)}
                      onChange={(e, date) => {
                        setShowStartPicker(Platform.OS === 'ios');
                        if (date) setRescheduleStartTime(date);
                      }}
                    />
                  )}

                  <Text style={S.fieldLabel}>End Time</Text>
                  <TouchableOpacity style={S.timeInput} onPress={() => setShowEndPicker(true)} activeOpacity={0.8}>
                    <Text style={rescheduleEndTime ? S.timeInputText : S.timeInputPlaceholder}>
                      {rescheduleEndTime ? formatTime(rescheduleEndTime) : 'Tap to select end time'}
                    </Text>
                  </TouchableOpacity>
                  {showEndPicker && (
                    <DateTimePicker
                      mode="time"
                      is24Hour
                      minuteInterval={5}
                      value={rescheduleEndTime || rescheduleStartTime || new Date(2026, 0, 1, 10, 0)}
                      onChange={(e, date) => {
                        setShowEndPicker(Platform.OS === 'ios');
                        if (date) setRescheduleEndTime(date);
                      }}
                    />
                  )}

                  {!!roomSearchError && <Text style={S.roomSearchError}>{roomSearchError}</Text>}

                  <TouchableOpacity
                    style={[S.confirmBtn, { backgroundColor: C.purpleDk, marginTop: 12 }]}
                    onPress={handleFindRooms}
                    disabled={searchingRooms}
                    activeOpacity={0.85}
                  >
                    {searchingRooms ? (
                      <ActivityIndicator color="#FFF" size="small" />
                    ) : (
                      <Text style={S.confirmBtnText}>Find Available Rooms</Text>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity style={S.backBtn} onPress={closeRescheduleModal} activeOpacity={0.85}>
                    <Text style={S.backBtnText}>Cancel</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  {/*  Step 2: Room selection  */}
                  <Text style={S.roomSummaryText}>
                    {rescheduleDay} - {formatTime(rescheduleStartTime)} to {formatTime(rescheduleEndTime)}
                  </Text>

                  {availableRooms.length === 0 ? (
                    <View style={S.noRoomsWrap}>
                      <Text style={S.noRoomsText}>No rooms available for this time slot.</Text>
                      <Text style={S.noRoomsHint}>Try a different day or time window.</Text>
                    </View>
                  ) : (
                    <>
                    <TextInput
                      style={S.roomSearchInput}
                      placeholder="Search rooms..."
                      placeholderTextColor="#94A3B8"
                      value={roomFilterQuery}
                      onChangeText={setRoomFilterQuery}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                    <FlatList
                      data={availableRooms.filter((r) => {
                        if (!roomFilterQuery.trim()) return true;
                        const q = roomFilterQuery.trim().toLowerCase();
                        const code = (r.roomCode || r.room_code || r.name || r.code || '').toLowerCase();
                        const bldg = (r.building || r.block || '').toLowerCase();
                        return code.includes(q) || bldg.includes(q);
                      })}
                      keyExtractor={(item) => String(item.id || item._id || item.roomCode || item.name)}
                      style={S.roomList}
                      renderItem={({ item }) => {
                        const code = item.roomCode || item.room_code || item.name || item.code || 'Unknown';
                        const capacity = item.capacity || item.seats || null;
                        const building = item.building || item.block || '';
                        const isSelected = (selectedRoom?.id || selectedRoom?._id) === (item.id || item._id);
                        return (
                          <TouchableOpacity
                            style={[S.roomItem, isSelected && S.roomItemSelected]}
                            onPress={() => setSelectedRoom(item)}
                            activeOpacity={0.8}
                          >
                            <View style={S.roomItemLeft}>
                              <Text style={[S.roomCode, isSelected && S.roomCodeSelected]}>{code}</Text>
                              <Text style={S.roomMeta}>
                                {building ? `${building} - ` : ''}{capacity ? `${capacity} seats` : ''}
                              </Text>
                            </View>
                            {isSelected && <Text style={S.roomCheck}></Text>}
                          </TouchableOpacity>
                        );
                      }}
                    />
                    </>
                  )}

                  <TouchableOpacity
                    style={[S.confirmBtn, { backgroundColor: '#C2410C', marginTop: 12 }, !selectedRoom && { opacity: 0.5 }]}
                    onPress={handleRescheduleConfirm}
                    disabled={!selectedRoom}
                    activeOpacity={0.85}
                  >
                    <Text style={S.confirmBtnText}>Confirm Reschedule</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={S.backBtn}
                    onPress={() => { setRescheduleStep(1); setSelectedRoom(null); }}
                    activeOpacity={0.85}
                  >
                    <Text style={S.backBtnText}>Back to Time Selection</Text>
                  </TouchableOpacity>
                </>
              )}
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      {/*  Make-Up Session Modal  */}
      <Modal
        visible={makeupModal.visible}
        transparent
        animationType="slide"
        onRequestClose={closeMakeupModal}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <Pressable style={S.modalOverlay} onPress={closeMakeupModal}>
            <Pressable onPress={() => {}} style={S.actionSheet}>
              <View style={S.actionSheetHandle} />
              <Text style={S.actionSheetTitle}>Add Make-Up Session</Text>
              {!!makeupModal.entry && (
                <Text style={S.actionSheetSubtitle}>
                  For: {String(makeupModal.entry?.unitCode || '').trim()}{makeupModal.entry?.unitTitle || makeupModal.entry?.unitName ? ` - ${makeupModal.entry.unitTitle || makeupModal.entry.unitName}` : ''}
                </Text>
              )}

              {/* Step indicator */}
              <View style={S.stepRow}>
                <View style={[S.stepDot, makeupStep >= 1 && S.stepDotActive]} />
                <View style={[S.stepLine, makeupStep >= 2 && S.stepLineActive]} />
                <View style={[S.stepDot, makeupStep >= 2 && S.stepDotActive]} />
              </View>

              {makeupStep === 1 ? (
                <>
                  {/* Step 1: Date, start/end time, lesson type */}
                  <Text style={S.fieldLabel}>Date</Text>
                  <TouchableOpacity style={S.timeInput} onPress={() => setShowMakeupDatePicker(true)} activeOpacity={0.8}>
                    <Text style={makeupDate ? S.timeInputText : S.timeInputPlaceholder}>
                      {makeupDate
                        ? makeupDate.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
                        : 'Tap to select date'}
                    </Text>
                  </TouchableOpacity>
                  {showMakeupDatePicker && (
                    <DateTimePicker
                      mode="date"
                      value={makeupDate || new Date()}
                      minimumDate={new Date()}
                      onChange={(e, date) => {
                        setShowMakeupDatePicker(Platform.OS === 'ios');
                        if (date) setMakeupDate(date);
                      }}
                    />
                  )}

                  <Text style={S.fieldLabel}>Start Time</Text>
                  <TouchableOpacity style={S.timeInput} onPress={() => setShowMakeupStartPicker(true)} activeOpacity={0.8}>
                    <Text style={makeupStartTime ? S.timeInputText : S.timeInputPlaceholder}>
                      {makeupStartTime ? formatTime(makeupStartTime) : 'Tap to select start time'}
                    </Text>
                  </TouchableOpacity>
                  {showMakeupStartPicker && (
                    <DateTimePicker
                      mode="time"
                      is24Hour
                      minuteInterval={5}
                      value={makeupStartTime || new Date(2026, 0, 1, 8, 0)}
                      onChange={(e, date) => {
                        setShowMakeupStartPicker(Platform.OS === 'ios');
                        if (date) setMakeupStartTime(date);
                      }}
                    />
                  )}

                  <Text style={S.fieldLabel}>End Time</Text>
                  <TouchableOpacity style={S.timeInput} onPress={() => setShowMakeupEndPicker(true)} activeOpacity={0.8}>
                    <Text style={makeupEndTime ? S.timeInputText : S.timeInputPlaceholder}>
                      {makeupEndTime ? formatTime(makeupEndTime) : 'Tap to select end time'}
                    </Text>
                  </TouchableOpacity>
                  {showMakeupEndPicker && (
                    <DateTimePicker
                      mode="time"
                      is24Hour
                      minuteInterval={5}
                      value={makeupEndTime || makeupStartTime || new Date(2026, 0, 1, 10, 0)}
                      onChange={(e, date) => {
                        setShowMakeupEndPicker(Platform.OS === 'ios');
                        if (date) setMakeupEndTime(date);
                      }}
                    />
                  )}

                  <Text style={S.fieldLabel}>Lesson Type</Text>
                  <View style={S.dayPickerRow}>
                    {LESSON_TYPES.filter((lt) => ['LEC', 'TUT', 'LAB', 'SEM', 'WRK', 'CAT', 'RAT', 'PRE'].includes(lt.code)).map((lt) => (
                      <TouchableOpacity
                        key={lt.code}
                        style={[S.dayPill, makeupLessonType === lt.code && S.dayPillActive]}
                        onPress={() => setMakeupLessonType(lt.code)}
                      >
                        <Text style={[S.dayPillText, makeupLessonType === lt.code && S.dayPillTextActive]}>{lt.code}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {!!makeupRoomError && <Text style={S.roomSearchError}>{makeupRoomError}</Text>}

                  <TouchableOpacity
                    style={[S.confirmBtn, { backgroundColor: '#15803D', marginTop: 12 }]}
                    onPress={handleFindRoomsForMakeup}
                    disabled={makeupSearchingRooms}
                    activeOpacity={0.85}
                  >
                    {makeupSearchingRooms ? (
                      <ActivityIndicator color="#FFF" size="small" />
                    ) : (
                      <Text style={S.confirmBtnText}>Find Available Rooms</Text>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity style={S.backBtn} onPress={closeMakeupModal} activeOpacity={0.85}>
                    <Text style={S.backBtnText}>Cancel</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  {/* Step 2: Room selection + save */}
                  <Text style={S.roomSummaryText}>
                    {makeupDate?.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} - {formatTime(makeupStartTime)} to {formatTime(makeupEndTime)}
                  </Text>

                  {makeupAvailableRooms.length === 0 ? (
                    <View style={S.noRoomsWrap}>
                      <Text style={S.noRoomsText}>No rooms available for this time slot.</Text>
                      <Text style={S.noRoomsHint}>Try a different date or time window.</Text>
                    </View>
                  ) : (
                    <>
                      <TextInput
                        style={S.roomSearchInput}
                        placeholder="Search rooms..."
                        placeholderTextColor="#94A3B8"
                        value={makeupRoomFilter}
                        onChangeText={setMakeupRoomFilter}
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                      <FlatList
                        data={makeupAvailableRooms.filter((r) => {
                          if (!makeupRoomFilter.trim()) return true;
                          const q = makeupRoomFilter.trim().toLowerCase();
                          const code = (r.roomCode || r.room_code || r.name || r.code || '').toLowerCase();
                          const bldg = (r.building || r.block || '').toLowerCase();
                          return code.includes(q) || bldg.includes(q);
                        })}
                        keyExtractor={(item) => String(item.id || item._id || item.roomCode || item.name)}
                        style={S.roomList}
                        renderItem={({ item }) => {
                          const code = item.roomCode || item.room_code || item.name || item.code || 'Unknown';
                          const capacity = item.capacity || item.seats || null;
                          const building = item.building || item.block || '';
                          const isSelected = (makeupSelectedRoom?.id || makeupSelectedRoom?._id) === (item.id || item._id);
                          return (
                            <TouchableOpacity
                              style={[S.roomItem, isSelected && S.roomItemSelected]}
                              onPress={() => setMakeupSelectedRoom(item)}
                              activeOpacity={0.8}
                            >
                              <View style={S.roomItemLeft}>
                                <Text style={[S.roomCode, isSelected && S.roomCodeSelected]}>{code}</Text>
                                <Text style={S.roomMeta}>
                                  {building ? `${building} - ` : ''}{capacity ? `${capacity} seats` : ''}
                                </Text>
                              </View>
                              {isSelected && <Text style={S.roomCheck}></Text>}
                            </TouchableOpacity>
                          );
                        }}
                      />
                    </>
                  )}

                  <TouchableOpacity
                    style={[
                      S.confirmBtn,
                      { backgroundColor: '#15803D', marginTop: 12 },
                      (!makeupSelectedRoom || savingMakeup) && { opacity: 0.5 },
                    ]}
                    onPress={handleSaveMakeup}
                    disabled={!makeupSelectedRoom || savingMakeup}
                    activeOpacity={0.85}
                  >
                    {savingMakeup ? (
                      <ActivityIndicator color="#FFF" size="small" />
                    ) : (
                      <Text style={S.confirmBtnText}>Save Make-Up Session</Text>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={S.backBtn}
                    onPress={() => { setMakeupStep(1); setMakeupSelectedRoom(null); }}
                    activeOpacity={0.85}
                  >
                    <Text style={S.backBtnText}>Back to Date & Time</Text>
                  </TouchableOpacity>
                </>
              )}
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      {/*  Online Lesson Modal  */}
      <Modal
        visible={onlineModal.visible}
        transparent
        animationType="slide"
        onRequestClose={() => setOnlineModal({ visible: false, entry: null })}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <Pressable style={S.modalOverlay} onPress={() => setOnlineModal({ visible: false, entry: null })}>
            <Pressable onPress={() => {}} style={S.actionSheet}>
              <View style={S.actionSheetHandle} />
              <Text style={S.actionSheetTitle}>Mark as Online</Text>
              <Text style={S.actionSheetSubtitle}>
                Set the scheduled online time. Students will be notified and the room will be freed. Share the meeting link via the Online Attendance Screen when you start.
              </Text>

              <Text style={S.fieldLabel}>Start Time</Text>
              <TouchableOpacity style={S.timeInput} onPress={() => setShowOnlineStartPicker(true)} activeOpacity={0.8}>
                <Text style={onlineStartTime ? S.timeInputText : S.timeInputPlaceholder}>
                  {onlineStartTime ? formatTime(onlineStartTime) : 'Tap to select start time'}
                </Text>
              </TouchableOpacity>
              {showOnlineStartPicker && (
                <DateTimePicker
                  mode="time"
                  is24Hour
                  minuteInterval={5}
                  value={onlineStartTime || new Date(2026, 0, 1, 8, 0)}
                  onChange={(ev, date) => {
                    setShowOnlineStartPicker(Platform.OS === 'ios');
                    if (date) setOnlineStartTime(date);
                  }}
                />
              )}

              <Text style={S.fieldLabel}>End Time <Text style={S.optionalLabel}>(optional)</Text></Text>
              <TouchableOpacity style={S.timeInput} onPress={() => setShowOnlineEndPicker(true)} activeOpacity={0.8}>
                <Text style={onlineEndTime ? S.timeInputText : S.timeInputPlaceholder}>
                  {onlineEndTime ? formatTime(onlineEndTime) : 'Tap to select end time'}
                </Text>
              </TouchableOpacity>
              {showOnlineEndPicker && (
                <DateTimePicker
                  mode="time"
                  is24Hour
                  minuteInterval={5}
                  value={onlineEndTime || onlineStartTime || new Date(2026, 0, 1, 10, 0)}
                  onChange={(ev, date) => {
                    setShowOnlineEndPicker(Platform.OS === 'ios');
                    if (date) setOnlineEndTime(date);
                  }}
                />
              )}

              <TouchableOpacity
                style={[S.confirmBtn, { backgroundColor: '#0891B2', marginTop: 16 }]}
                onPress={() => {
                  const { entry } = onlineModal;
                  const onlinePayload = {
                    onlineStartTime: onlineStartTime ? formatTime(onlineStartTime) : null,
                    onlineEndTime: onlineEndTime ? formatTime(onlineEndTime) : null,
                  };
                  setOnlineModal({ visible: false, entry: null });
                  handleStatusChange(entry, 'Online', onlinePayload);
                  // Propagate online status to all sibling entries in the same merged group
                  if (entry?.isMerged && entry?.mergedSessionId) {
                    entries
                      .filter((e) => String(e?.mergedSessionId || '') === String(entry.mergedSessionId) && String(e?.id || '') !== String(entry.id || ''))
                      .forEach((sibling) => handleStatusChange(sibling, 'Online', onlinePayload));
                  }
                  // Notify students  one notification covering all merged sections
                  {
                    const unitCode = String(entry?.unitCode || entry?.code || '').trim();
                    const allSiblings = (entry?.isMerged && entry?.mergedSessionId)
                      ? entries.filter((e) => String(e?.mergedSessionId || '') === String(entry.mergedSessionId))
                      : [entry];
                    const notifRecipients = [...new Set(allSiblings.map((e) => String(e?.unitCode || e?.code || '').trim()).filter(Boolean))];
                    const sectionLabel = allSiblings.length > 1 ? ` (${allSiblings.length} merged sections)` : '';
                    const timeLabel = (onlinePayload.onlineStartTime && onlinePayload.onlineEndTime)
                      ? ` at ${onlinePayload.onlineStartTime} - ${onlinePayload.onlineEndTime}` : '';
                    sendNotification({
                      type: 'LESSON_ONLINE',
                      title: `${unitCode} - Session Moving Online`,
                      message: `Your ${unitCode} lesson${sectionLabel}${timeLabel} will be held online. Check the Online Attendance screen for the meeting link.`,
                      recipients: notifRecipients.length > 0 ? notifRecipients : [unitCode],
                      data: { unitCode, isMerged: !!entry?.isMerged, ...onlinePayload },
                    }).catch(() => {});
                    Vibration.vibrate(100);
                    displayLocalNotification({
                      title: 'Session Moving Online',
                      body: `${unitCode} students have been notified to join online.`,
                      channelId: CHANNELS.lesson,
                    }).catch(() => {});
                  }
                }}
                activeOpacity={0.85}
              >
                <Text style={S.confirmBtnText}>Confirm Online Session</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={S.backBtn}
                onPress={() => setOnlineModal({ visible: false, entry: null })}
                activeOpacity={0.85}
              >
                <Text style={S.backBtnText}>Cancel</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      {/*  Merge Lessons Modal  */}
      <Modal
        visible={mergeModal.visible}
        transparent
        animationType="slide"
        onRequestClose={closeMergeModal}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <Pressable style={S.modalOverlay} onPress={closeMergeModal}>
            <Pressable onPress={() => {}} style={S.actionSheet}>
              <View style={S.actionSheetHandle} />
              <Text style={S.actionSheetTitle}>Merge Lessons</Text>
              <Text style={S.actionSheetSubtitle}>
                Combine multiple class sections for the same unit into one shared lecture room. All enrolled students will be notified.
              </Text>

              {/* Step indicator */}
              <View style={S.stepRow}>
                <View style={[S.stepDot, mergeStep >= 1 && S.stepDotActive]} />
                <View style={[S.stepLine, mergeStep >= 2 && S.stepLineActive]} />
                <View style={[S.stepDot, mergeStep >= 2 && S.stepDotActive]} />
              </View>

              {mergeStep === 1 ? (
                <>
                  {/*  Step 1: Review sections + note  */}
                  <Text style={S.fieldLabel}>Select sections to merge ({mergeSelectedIds.size} selected)</Text>
                  <Text style={S.mergeSelectionHint}>Tap a section to select or deselect it. At least 2 must be selected.</Text>
                  {(mergeModal.allCandidates || []).map((e) => {
                    const isSelected = mergeSelectedIds.has(String(e.id));
                    const isOwn = String(e.id) === String(mergeModal.entry?.id);
                    const eTime = e.startTime && e.endTime
                      ? `${e.startTime} - ${e.endTime}`
                      : e.time || 'Time not set';
                    const eRoom = e.roomCode || e.venue || e.lectureRoom || '';
                    const courseInfo = [e.courseCode, e.courseName, e.department].filter(Boolean).join(' - ');
                    return (
                      <TouchableOpacity
                        key={String(e.id)}
                        style={[S.mergeSectionRow, isSelected && S.mergeSectionRowSelected]}
                        onPress={() => {
                          setMergeSelectedIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(String(e.id))) {
                              if (next.size <= 2) return prev; // keep at least 2
                              next.delete(String(e.id));
                            } else {
                              next.add(String(e.id));
                            }
                            return next;
                          });
                        }}
                        activeOpacity={0.75}
                      >
                        <View style={S.mergeSectionLeft}>
                          <Text style={[S.mergeSectionUnit, !isSelected && S.mergeSectionUnitDimmed]}>
                            {e.unitTitle || e.unitName || e.unitCode}{isOwn ? ' (this lesson)' : ''}
                          </Text>
                          {!!courseInfo && (
                            <Text style={S.mergeSectionCourse} numberOfLines={1}>{courseInfo}</Text>
                          )}
                          <Text style={S.mergeSectionMeta}>{eTime} - {eRoom}</Text>
                        </View>
                        <View style={[S.mergeCheckbox, isSelected && S.mergeCheckboxSelected]}>
                          {isSelected && <Text style={S.mergeCheckboxCheck}></Text>}
                        </View>
                      </TouchableOpacity>
                    );
                  })}

                  <Text style={[S.fieldLabel, { marginTop: 12 }]}>
                    Announcement note <Text style={S.optionalLabel}>(optional)</Text>
                  </Text>
                  <TextInput
                    style={S.reasonInput}
                    placeholder="e.g. All BSc CS and BSc IT students  same room, same time."
                    placeholderTextColor="#94A3B8"
                    multiline
                    numberOfLines={3}
                    value={mergeNote}
                    onChangeText={setMergeNote}
                    maxLength={200}
                  />
                  <Text style={S.charCount}>{mergeNote.length}/200</Text>

                  {!!mergeRoomError && <Text style={S.roomSearchError}>{mergeRoomError}</Text>}

                  <TouchableOpacity
                    style={[S.confirmBtn, { backgroundColor: '#0F766E', marginTop: 4 }]}
                    onPress={handleFindRoomsForMerge}
                    disabled={mergeSearchingRooms}
                    activeOpacity={0.85}
                  >
                    {mergeSearchingRooms ? (
                      <ActivityIndicator color="#FFF" size="small" />
                    ) : (
                      <Text style={S.confirmBtnText}>Find Available Rooms</Text>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity style={S.backBtn} onPress={closeMergeModal} activeOpacity={0.85}>
                    <Text style={S.backBtnText}>Cancel</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  {/*  Step 2: Room selection  */}
                  <Text style={S.roomSummaryText}>
                    {mergeModal.entry?.day} - {String(mergeModal.entry?.startTime || mergeModal.entry?.time || '').replace(/\s*[-].*$/, '').trim()} to {mergeModal.entry?.endTime || ''}
                  </Text>

                  {mergeAvailableRooms.length === 0 ? (
                    <View style={S.noRoomsWrap}>
                      <Text style={S.noRoomsText}>No rooms available for this slot.</Text>
                      <Text style={S.noRoomsHint}>Consider rescheduling one of the sections first.</Text>
                    </View>
                  ) : (
                    <>
                      <TextInput
                        style={S.roomSearchInput}
                        placeholder="Search rooms..."
                        placeholderTextColor="#94A3B8"
                        value={mergeRoomFilter}
                        onChangeText={setMergeRoomFilter}
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                      <FlatList
                        data={mergeAvailableRooms.filter((r) => {
                          if (!mergeRoomFilter.trim()) return true;
                          const q = mergeRoomFilter.trim().toLowerCase();
                          const code = (r.roomCode || r.room_code || r.name || r.code || '').toLowerCase();
                          const bldg = (r.building || r.block || '').toLowerCase();
                          return code.includes(q) || bldg.includes(q);
                        })}
                        keyExtractor={(item) => String(item.id || item._id || item.roomCode || item.name)}
                        style={S.roomList}
                        renderItem={({ item }) => {
                          const code = item.roomCode || item.room_code || item.name || item.code || 'Unknown';
                          const capacity = item.capacity || item.seats || null;
                          const building = item.building || item.block || '';
                          const isSelected = (mergeSelectedRoom?.id || mergeSelectedRoom?._id) === (item.id || item._id);
                          return (
                            <TouchableOpacity
                              style={[S.roomItem, isSelected && S.roomItemSelected]}
                              onPress={() => setMergeSelectedRoom(item)}
                              activeOpacity={0.8}
                            >
                              <View style={S.roomItemLeft}>
                                <Text style={[S.roomCode, isSelected && S.roomCodeSelected]}>{code}</Text>
                                <Text style={S.roomMeta}>
                                  {building ? `${building} - ` : ''}{capacity ? `${capacity} seats` : ''}
                                </Text>
                              </View>
                              {isSelected && <Text style={S.roomCheck}></Text>}
                            </TouchableOpacity>
                          );
                        }}
                      />
                    </>
                  )}

                  {!!mergeError && <Text style={S.roomSearchError}>{mergeError}</Text>}

                  <TouchableOpacity
                    style={[
                      S.confirmBtn,
                      { backgroundColor: '#0F766E', marginTop: 12 },
                      (!mergeSelectedRoom || savingMerge) && { opacity: 0.5 },
                    ]}
                    onPress={handleConfirmMerge}
                    disabled={!mergeSelectedRoom || savingMerge}
                    activeOpacity={0.85}
                  >
                    {savingMerge ? (
                      <ActivityIndicator color="#FFF" size="small" />
                    ) : (
                      <Text style={S.confirmBtnText}>Confirm Merge & Notify Students</Text>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={S.backBtn}
                    onPress={() => { setMergeStep(1); setMergeSelectedRoom(null); }}
                    activeOpacity={0.85}
                  >
                    <Text style={S.backBtnText}>Back</Text>
                  </TouchableOpacity>
                </>
              )}
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (C) => StyleSheet.create({
  //  Outer shell 
  screen: { flex: 1, backgroundColor: C.bg },

  //  Gradient header
  header: {
    paddingTop: Platform.OS === 'ios' ? 20 : 16,
    paddingBottom: 16,
    paddingHorizontal: 18,
    overflow: 'hidden',
    position: 'relative',
  },
  headerOrb: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: 'rgba(165,180,252,0.08)',
    top: -60,
    right: -40,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  headerDate: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.55)',
    marginTop: 3,
    fontWeight: '500',
  },
  headerTopRight: {
    alignItems: 'flex-end',
    paddingTop: 4,
  },
  bgDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#A5B4FC',
  },
  syncBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(110,231,183,0.12)',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: 'rgba(110,231,183,0.25)',
  },
  syncBadgeText: {
    fontSize: 10,
    color: '#6EE7B7',
    fontWeight: '600',
  },

  /* Stats strip */
  statStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.bgSec,
    borderRadius: 16,
    paddingVertical: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: C.border,
  },
  statCell: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  statIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: C.bgTert,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 2,
  },
  statValue: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
  statLabel: {
    fontSize: 9,
    color: 'rgba(255,255,255,0.45)',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  statDiv: {
    width: 1,
    height: 38,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },

  /* Next class card */
  nextCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.28)',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    gap: 10,
  },
  nextCardLeft: {
    flex: 1,
    gap: 3,
  },
  nextCardBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 2,
  },
  nextCardBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  nextCardName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  nextCardMeta: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.45)',
    fontWeight: '500',
  },
  nextCardRight: {
    alignItems: 'center',
    gap: 2,
  },
  nextCardCountdown: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
    textAlign: 'right',
  },

  //  Offline banner (above scroll) 
  offlineBanner: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(245,158,11,0.12)', borderBottomWidth: 1, borderBottomColor: 'rgba(245,158,11,0.25)', paddingVertical: 6, paddingHorizontal: 16 },
  offlineBannerText: { fontSize: 11, color: C.warning, fontWeight: '600', flex: 1 },

  //  Scroll container 
  scroll: { flex: 1 },
  scrollContent: { padding: 14, paddingBottom: 30 },

  //  Center state (loading / error / empty) 
  centerState: { marginTop: 40, alignItems: 'center', justifyContent: 'center' },
  stateText: { marginTop: 10, color: C.textMuted, fontSize: 14, textAlign: 'center' },
  errorText: { color: C.dangerLt, fontSize: 14, textAlign: 'center' },

  //  Day group card 
  dayCard: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 14, marginBottom: 12, padding: 12 },
  dayCardToday: { borderColor: `${C.primary}55`, backgroundColor: C.primarySoft },
  dayTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  dayTitle: { fontSize: 15, fontWeight: '700', color: C.textSec },
  dayTitleToday: { color: C.primaryDk },
  todayPill: { backgroundColor: C.primarySoft, borderWidth: 1, borderColor: `${C.primary}55`, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  todayPillText: { fontSize: 10, fontWeight: '700', color: C.primaryDk },

  //  Regular lesson entry row 
  entryRow: { borderTopWidth: 1, borderTopColor: C.border, paddingTop: 10, marginTop: 8 },
  entryHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 },
  entryHeaderLeft: { flex: 1, marginRight: 8 },
  unitName: { fontSize: 14, fontWeight: '700', color: C.textPri },
  unitCode: { marginTop: 2, marginBottom: 3, fontSize: 11, fontWeight: '700', color: C.primaryLt },
  unitCourse: { marginTop: 1, marginBottom: 2, fontSize: 11, fontWeight: '500', color: C.textMuted },
  metaText: { color: C.textSec, fontSize: 12, marginTop: 2 },
  statusMetaText: { marginTop: 6, color: C.textSec, fontSize: 12 },

  //  Status dropdown button 
  statusDropdownBtn: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderRadius: 10, paddingVertical: 4, paddingHorizontal: 9, gap: 4, alignSelf: 'flex-start' },
  statusDropdownBtnText: { fontSize: 12, fontWeight: '700' },
  statusDropdownChevron: { fontSize: 13, fontWeight: '700' },

  //  Lesson type pill 
  lessonTypePill: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, marginBottom: 4, gap: 3 },
  lessonTypePillText: { fontSize: 11, fontWeight: '700' },
  lessonTypePillChevron: { fontSize: 10, fontWeight: '700' },

  //  Action chips 
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, marginRight: 6, marginTop: 4 },
  chipText: { fontSize: 11, fontWeight: '600' },

  //  Make-up badge 
  makeupBadge: { backgroundColor: 'rgba(21,128,61,0.18)', borderWidth: 1, borderColor: '#15803D', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  makeupBadgeText: { fontSize: 11, fontWeight: '700', color: '#4ADE80' },

  //  Text action buttons (makeup, delete, merge, delegate) 
  addMakeupBtn: { alignSelf: 'flex-start', marginTop: 7, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: '#15803D', borderStyle: 'dashed' },
  addMakeupBtnText: { fontSize: 11, fontWeight: '600', color: '#4ADE80' },
  deleteExtraBtn: { alignSelf: 'flex-start', marginTop: 7, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: 'rgba(185,28,28,0.15)', borderWidth: 1, borderColor: 'rgba(185,28,28,0.4)' },
  deleteExtraBtnText: { fontSize: 11, fontWeight: '600', color: C.dangerLt },
  mergeLessonsBtn: { alignSelf: 'flex-start', marginTop: 7, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(13,148,136,0.5)', backgroundColor: 'rgba(13,148,136,0.12)' },
  mergeLessonsBtnText: { fontSize: 11, fontWeight: '600', color: C.tealLt },
  delegateBtn: { alignSelf: 'flex-start', marginTop: 6, marginBottom: 2, borderWidth: 1, borderColor: 'rgba(16,185,129,0.4)', borderRadius: 10, paddingVertical: 5, paddingHorizontal: 12, backgroundColor: 'rgba(16,185,129,0.12)' },
  delegateBtnText: { fontSize: 13, fontWeight: '700', color: C.successLt },

  //  Merged badge (inline on regular card) 
  mergedBadge: { marginTop: 8, backgroundColor: 'rgba(13,148,136,0.15)', borderWidth: 1, borderColor: 'rgba(45,212,191,0.4)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  mergedBadgeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  mergedBadgeText: { fontSize: 12, fontWeight: '700', color: C.tealLt, flexShrink: 1 },
  unmergeBtn: { marginLeft: 8, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: 'rgba(185,28,28,0.15)', borderWidth: 1, borderColor: 'rgba(185,28,28,0.4)' },
  unmergeBtnText: { fontSize: 11, fontWeight: '600', color: C.dangerLt },
  mergedNoteText: { fontSize: 11, color: C.tealLt, marginTop: 2, fontStyle: 'italic' },

  //  Reschedule info block 
  rescheduleInfoBlock: { marginTop: 8, backgroundColor: 'rgba(194,65,12,0.12)', borderRadius: 10, borderWidth: 1, borderColor: 'rgba(194,65,12,0.35)', padding: 10 },
  rescheduleInfoHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  rescheduleInfoTitle: { fontSize: 12, fontWeight: '700', color: '#FB923C' },
  rescheduleBadge: { alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  permanentBadge: { backgroundColor: 'rgba(29,78,216,0.18)' },
  temporaryBadge: { backgroundColor: 'rgba(194,65,12,0.18)', borderWidth: 1, borderColor: 'rgba(194,65,12,0.35)' },
  rescheduleBadgeText: { fontSize: 11, fontWeight: '700' },
  permanentText: { color: C.infoLt },
  temporaryText: { color: '#FB923C' },
  rescheduleWasNowRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rescheduleWasCol: { flex: 1, backgroundColor: 'rgba(120,53,15,0.35)', borderRadius: 8, padding: 7 },
  rescheduleWasLabel: { fontSize: 10, fontWeight: '700', color: '#FCA5A5', marginBottom: 2, letterSpacing: 0.5 },
  rescheduleWasTime: { fontSize: 12, fontWeight: '600', color: '#FCA5A5', textDecorationLine: 'line-through' },
  rescheduleWasRoom: { fontSize: 11, color: C.dangerLt, textDecorationLine: 'line-through', marginTop: 1 },
  rescheduleArrowLec: { fontSize: 22, color: '#FB923C', fontWeight: '700' },
  rescheduleNowCol: { flex: 1, backgroundColor: 'rgba(5,46,22,0.5)', borderRadius: 8, padding: 7 },
  rescheduleNowLabel: { fontSize: 10, fontWeight: '700', color: '#6EE7B7', marginBottom: 2, letterSpacing: 0.5 },
  rescheduleNowTime: { fontSize: 12, fontWeight: '700', color: '#4ADE80' },
  rescheduleNowRoom: { fontSize: 11, fontWeight: '600', color: C.successLt, marginTop: 1 },

  //  Online info block 
  onlineInfoBlock: { marginTop: 8, backgroundColor: 'rgba(8,145,178,0.12)', borderRadius: 8, padding: 10, borderWidth: 1, borderColor: 'rgba(8,145,178,0.35)' },
  onlineBadge: { alignSelf: 'flex-start', backgroundColor: '#0891B2', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, marginBottom: 6 },
  onlineBadgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  onlineTimeText: { fontSize: 13, fontWeight: '600', color: '#38BDF8', marginBottom: 4 },
  onlineLinkText: { fontSize: 12, color: '#7DD3FC', fontStyle: 'italic' },

  //  Merged group card 
  mergedGroupCard: { borderTopWidth: 1, borderTopColor: C.border, paddingTop: 10, marginTop: 8, backgroundColor: 'rgba(13,148,136,0.10)', borderWidth: 1, borderColor: 'rgba(45,212,191,0.3)', borderRadius: 10, padding: 12 },
  mergedGroupHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 },
  mergedGroupTitle: { fontSize: 13, fontWeight: '700', color: C.tealLt },
  mergedGroupSubtitle: { fontSize: 12, color: '#5EEAD4', marginTop: 2 },
  mergedGroupSectionRow: { borderTopWidth: 1, borderTopColor: 'rgba(45,212,191,0.2)', paddingTop: 6, marginTop: 6 },
  mergedGroupSectionUnit: { fontSize: 13, fontWeight: '600', color: '#D1D5DB' },
  mergedGroupFooter: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: 'rgba(45,212,191,0.2)', gap: 3 },
  mergedGroupMeta: { fontSize: 12, color: '#5EEAD4', fontWeight: '500' },
  mergedGroupNote: { fontSize: 11, color: C.tealLt, fontStyle: 'italic' },
  mergedByAdminBadge: { backgroundColor: 'rgba(124,58,237,0.2)', borderWidth: 1, borderColor: 'rgba(124,58,237,0.5)', borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  mergedByAdminBadgeText: { fontSize: 10, fontWeight: '700', color: C.purpleLt },
  mergedByLecturerBadge: { backgroundColor: 'rgba(21,128,61,0.2)', borderWidth: 1, borderColor: 'rgba(21,128,61,0.5)', borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  mergedByLecturerBadgeText: { fontSize: 10, fontWeight: '700', color: '#4ADE80' },

  //  Dropdown sheet (lesson type & status) 
  dropdownOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  dropdownSheet: { backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 36, borderTopWidth: 1, borderColor: C.border },
  dropdownSheetTitle: { fontSize: 15, fontWeight: '700', color: C.textPri, marginBottom: 4 },
  dropdownSheetSubtitle: { fontSize: 12, color: C.textMuted, marginBottom: 14 },
  dropdownOption: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: C.border, marginBottom: 8, backgroundColor: C.bgSec },
  dropdownOptionDot: { width: 10, height: 10, borderRadius: 5 },
  dropdownOptionText: { flex: 1, fontSize: 14, fontWeight: '600', color: C.textPri },
  dropdownOptionCheck: { fontSize: 16, fontWeight: '700' },
  lessonTypeCodeLabel: { fontSize: 11, fontWeight: '600', color: C.textMuted, marginRight: 2 },

  //  Bottom sheet modal 
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' },
  actionSheet: { backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 36, borderTopWidth: 1, borderColor: C.border, maxHeight: '85%' },
  actionSheetHandle: { width: 40, height: 4, backgroundColor: C.borderMed, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  actionSheetTitle: { fontSize: 17, fontWeight: '700', color: C.textPri, marginBottom: 6 },
  actionSheetSubtitle: { fontSize: 13, color: C.textMuted, marginBottom: 14, lineHeight: 18 },

  //  Text inputs 
  reasonInput: { borderWidth: 1, borderColor: C.borderMed, borderRadius: 10, padding: 12, fontSize: 14, color: C.textPri, backgroundColor: C.bg, textAlignVertical: 'top', minHeight: 100, marginBottom: 4 },
  charCount: { fontSize: 11, color: C.textMuted, textAlign: 'right', marginBottom: 16 },
  timeInput: { borderWidth: 1, borderColor: C.borderMed, borderRadius: 10, padding: 12, backgroundColor: C.bg, marginBottom: 4 },
  timeInputText: { fontSize: 14, color: C.textPri, fontWeight: '600' },
  timeInputPlaceholder: { fontSize: 14, color: C.textMuted },
  roomSearchInput: { borderWidth: 1, borderColor: C.borderMed, borderRadius: 10, padding: 10, fontSize: 14, color: C.textPri, backgroundColor: C.bg, marginBottom: 8 },

  //  Confirm / back buttons 
  confirmBtn: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginBottom: 10 },
  confirmBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  backBtn: { borderWidth: 1, borderColor: C.borderMed, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  backBtnText: { color: C.textSec, fontSize: 14, fontWeight: '600' },

  //  Form fields 
  fieldLabel: { fontSize: 13, fontWeight: '600', color: C.textSec, marginBottom: 6, marginTop: 8 },
  optionalLabel: { fontWeight: '400', color: C.textMuted },

  //  Reschedule type row 
  rescheduleTypeRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  rescheduleTypeBtn: { flex: 1, borderWidth: 1.5, borderColor: C.borderMed, borderRadius: 10, paddingVertical: 10, alignItems: 'center', backgroundColor: C.bgSec },
  rescheduleTypeBtnActive: { borderColor: C.primary, backgroundColor: 'rgba(99,102,241,0.15)' },
  rescheduleTypeBtnText: { fontSize: 14, fontWeight: '600', color: C.textSec },
  rescheduleTypeBtnTextActive: { color: C.primaryLt },
  rescheduleTypeNote: { fontSize: 12, color: C.textMuted, marginBottom: 14, lineHeight: 17 },

  //  Day picker 
  dayPickerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 4 },
  dayPill: { borderWidth: 1, borderColor: C.borderMed, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10, backgroundColor: C.bgSec },
  dayPillActive: { borderColor: C.primary, backgroundColor: 'rgba(99,102,241,0.15)' },
  dayPillText: { fontSize: 13, fontWeight: '600', color: C.textSec },
  dayPillTextActive: { color: C.primaryLt },

  //  Step indicator 
  stepRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  stepDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.borderMed },
  stepDotActive: { backgroundColor: C.primary },
  stepLine: { width: 40, height: 2, backgroundColor: C.border, marginHorizontal: 4 },
  stepLineActive: { backgroundColor: C.primary },

  //  Room picker 
  roomSummaryText: { fontSize: 14, fontWeight: '600', color: C.primaryLt, marginBottom: 12, textAlign: 'center' },
  roomList: { maxHeight: 240 },
  roomItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 12, marginBottom: 8, backgroundColor: C.bgSec },
  roomItemSelected: { borderColor: C.primary, backgroundColor: 'rgba(99,102,241,0.12)' },
  roomItemLeft: { flex: 1 },
  roomCode: { fontSize: 14, fontWeight: '700', color: C.textPri },
  roomCodeSelected: { color: C.primaryLt },
  roomMeta: { fontSize: 12, color: C.textMuted, marginTop: 2 },
  roomCheck: { fontSize: 18, fontWeight: '700', color: C.primary },
  noRoomsWrap: { alignItems: 'center', paddingVertical: 24 },
  noRoomsText: { fontSize: 14, fontWeight: '600', color: C.textSec },
  noRoomsHint: { fontSize: 12, color: C.textMuted, marginTop: 4 },
  roomSearchError: { color: C.dangerLt, fontSize: 12, marginTop: 8, textAlign: 'center' },

  //  Delegate modal 
  noGroupsWrap: { alignItems: 'center', paddingVertical: 16 },
  noGroupsText: { fontSize: 14, fontWeight: '600', color: C.textSec },
  noGroupsHint: { marginTop: 4, fontSize: 12, color: C.textMuted },
  delegateGroupRow: { borderWidth: 1, borderColor: 'rgba(16,185,129,0.25)', borderRadius: 10, padding: 10, marginBottom: 6, backgroundColor: 'rgba(16,185,129,0.08)' },
  delegateGroupName: { fontSize: 14, fontWeight: '700', color: '#4ADE80' },
  delegateGroupLeader: { fontSize: 12, color: C.successLt, marginTop: 2 },
  delegateError: { color: C.dangerLt, fontSize: 13, marginTop: 8, marginBottom: 4 },

  //  Merge modal 
  mergeSelectionHint: { fontSize: 11, color: C.textMuted, marginBottom: 8, fontStyle: 'italic' },
  mergeSectionRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', borderWidth: 1, borderColor: 'rgba(45,212,191,0.2)', borderRadius: 10, padding: 10, marginBottom: 6, backgroundColor: 'rgba(13,148,136,0.08)' },
  mergeSectionRowSelected: { borderColor: 'rgba(13,148,136,0.6)', backgroundColor: 'rgba(13,148,136,0.18)' },
  mergeSectionLeft: { flex: 1, marginRight: 8 },
  mergeSectionUnit: { fontSize: 13, fontWeight: '700', color: '#F0F0F5' },
  mergeSectionUnitDimmed: { color: C.textMuted },
  mergeSectionCourse: { fontSize: 11, color: C.tealLt, marginTop: 1, fontWeight: '500' },
  mergeSectionMeta: { fontSize: 11, color: C.textMuted, marginTop: 2 },
  mergeCheckbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)', backgroundColor: '#1C1C2E', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  mergeCheckboxSelected: { borderColor: C.tealDk, backgroundColor: C.tealDk },
  mergeCheckboxCheck: { fontSize: 13, fontWeight: '700', color: '#FFFFFF' },
});
