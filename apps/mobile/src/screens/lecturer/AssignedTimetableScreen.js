import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, FlatList, InteractionManager, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, Text, TextInput, TouchableOpacity, View, Vibration } from 'react-native';
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
import { parseRescheduledInfo } from '../../utils/rescheduleInfo';

const LESSON_STATUS_OPTIONS = ['Online', 'Cancelled', 'Confirmed', 'Rescheduled'];

const STATUS_DIALOG_LABELS = {
  Online: 'Go Online',
  Cancelled: 'Cancel Lesson',
  Confirmed: 'Confirm Lesson',
  Rescheduled: 'Reschedule Lesson',
};

const STATUS_COLORS = {
  Confirmed: '#10B981',
  Pending: '#6366F1',
  Cancelled: '#EF4444',
  Rescheduled: '#F59E0B',
  Online: '#06B6D4',
};

const STATUS_COLORS_LIGHT = {
  Confirmed: '#D1FAE5',
  Pending: '#E0E7FF',
  Cancelled: '#FEE2E2',
  Rescheduled: '#FEF3C7',
  Online: '#CFFAFE',
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

const getLastWeekReset = () => {
  const d = new Date();
  const daysBack = d.getDay() === 6 ? 0 : d.getDay() + 1;
  d.setDate(d.getDate() - daysBack);
  d.setHours(0, 0, 0, 0);
  return d;
};

const WEEKLY_STATUSES = new Set(['Cancelled', 'Rescheduled', 'Online']);

const getEffectiveStatus = (entry) => {
  const hasRescheduleData = Boolean(
    entry?.rescheduleSubStatus ||
    entry?.rescheduledTo ||
    entry?.rescheduled_to ||
    entry?.rescheduledVenue ||
    entry?.rescheduled_venue
  );
  if ((entry?.rescheduleSubStatus || entry?.status === 'Rescheduled') && hasRescheduleData) {
    return 'Rescheduled';
  }

  const hasLecturerOverride = Boolean(
    entry?.statusSource === 'lecturer' ||
    entry?.updatedBy === 'Lecturer' ||
    entry?.updatedBy === 'lecturer' ||
    entry?.rescheduleSubStatus ||
    entry?.pendingReason ||
    entry?.reason ||
    entry?.onlineStartTime ||
    entry?.onlineEndTime ||
    entry?.meetingLink ||
    entry?.meetingNote
  );

  const stored = String(entry?.status || 'Pending').trim() || 'Pending';
  if (!hasLecturerOverride && (stored === 'Confirmed' || stored === 'Cancelled' || stored === 'Online')) {
    return 'Pending';
  }
  if (!WEEKLY_STATUSES.has(stored)) return stored;
  const updatedAt = entry?.updatedAt ? new Date(entry.updatedAt) : null;
  if (!updatedAt || Number.isNaN(updatedAt.getTime())) return 'Pending';
  return updatedAt >= getLastWeekReset() ? stored : 'Pending';
};

const _timetableCache = { entries: null, timestamp: 0 };
const STALE_MS = 5 * 60 * 1000;
const RESCHEDULE_CACHE_KEY = '@lec_reschedule_overrides';

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
  const [onlineModal, setOnlineModal] = useState({ visible: false, entry: null });
  const [onlineStartTime, setOnlineStartTime] = useState(null);
  const [onlineEndTime, setOnlineEndTime] = useState(null);
  const [showOnlineStartPicker, setShowOnlineStartPicker] = useState(false);
  const [showOnlineEndPicker, setShowOnlineEndPicker] = useState(false);

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
      const cache = rescheduleCacheRef.current;
      const merged = list.map((e) => {
        const id = String(e?.id || '').trim();
        const override = cache[id];
        if (!override) return e;
        return {
          ...e,
          rescheduledTo: e.rescheduledTo || override.rescheduledTo,
          reschedulePermanent: e.reschedulePermanent ?? override.reschedulePermanent,
          ...(override.rescheduleSubStatus ? { status: 'Rescheduled', rescheduleSubStatus: override.rescheduleSubStatus } : {}),
        };
      });

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
      } catch (_) { }

      const finalEntries = [...merged, ...extraMapped];
      setEntries(finalEntries);
      _timetableCache.entries = finalEntries;
      _timetableCache.timestamp = Date.now();
      setLastRefreshed(new Date());

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
      } catch (_) { }
    } catch (error) {
      if (_timetableCache.entries) return;
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

  useEffect(() => {
    const sub = onTimetableUpdated(() => { load(false, true); });
    return () => sub?.remove();
  }, [load]);

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
    if (!status) return;

    const entryId = String(entry?.id || '').trim();
    if (!entryId) {
      Alert.alert('Update failed', 'This timetable entry has no id, so status cannot be updated.');
      return;
    }

    const currentStatus = String(entry?.status || '').trim();
    if (status === currentStatus) return;

    const updateKey = `${entryId}:${status}`;
    setUpdatingEntryKey(updateKey);

    const optimisticReason = status === 'Cancelled' ? (extraPayload.reason || entry?.reason || 'Cancelled by lecturer') : entry?.reason;
    const optimisticPendingReason = status === 'Pending' ? entry?.pendingReason || 'Awaiting lecturer confirmation' : entry?.pendingReason;
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
          statusSource: 'lecturer',
          rescheduleSubStatus: optimisticSubStatus,
          reason: optimisticReason || null,
          pendingReason: optimisticPendingReason || null,
          rescheduledTo: optimisticRescheduledTo,
          reschedulePermanent: optimisticReschedulePermanent,
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

      setEntries((previous) =>
        previous.map((row) => {
          if (String(row?.id || '').trim() !== entryId) return row;
          
          if (result?.updatedEntry) {
            const merged = { ...row, ...result.updatedEntry };
            
            if (status === 'Rescheduled' || isCompound) {
              if (!merged.rescheduledTo) merged.rescheduledTo = optimisticRescheduledTo;
              if (merged.reschedulePermanent == null) merged.reschedulePermanent = optimisticReschedulePermanent;
              if (isCompound) {
                merged.status = 'Rescheduled';
                merged.rescheduleSubStatus = optimisticSubStatus;
              }
            }
            
            merged.updatedAt = merged.updatedAt || new Date().toISOString();
            merged.statusSource = merged.statusSource || 'lecturer';
            merged.updatedBy = merged.updatedBy || 'Lecturer';
            
            return merged;
          }
          
          return row;
        })
      );

      if (status === 'Rescheduled' || isCompound) {
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
        const { [entryId]: _removed, ...rest } = rescheduleCacheRef.current;
        rescheduleCacheRef.current = rest;
        saveRescheduleCache(rest);
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
    if (entry?.isMerged && entry?.mergedSessionId) {
      entries
        .filter((e) => String(e?.mergedSessionId || '') === String(entry.mergedSessionId) && String(e?.id || '') !== String(entry.id || ''))
        .forEach((sibling) => handleStatusChange(sibling, 'Cancelled', { reason }));
    }
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

      const toMinutes = (t) => {
        const [h, m] = String(t || '').split(':').map(Number);
        return (h || 0) * 60 + (m || 0);
      };
      const reqStartMin = toMinutes(reqStart);
      const reqEndMin = toMinutes(reqEnd);

      const roomData = await fetchRooms({
        institutionId: session.institutionId,
        token: session.token,
      });
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
          if (match && match[1] === rescheduleDay) {
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

        if (entryDay !== rescheduleDay) return;

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

      if (newTypeCode === 'GD') {
        handleOpenDelegate(entry);
      }
    } catch (error) {
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
      const bleUnitId = adaptiveConfig.getUnitId(unitCode) ?? Number(entry?.unitId || 0);
      const bleRoomId = adaptiveConfig.getRoomId(roomCode) ?? Number(entry?.roomId || 0);

      const payload = {
        timetableEntryId: entry.id,
        unitCode,
        unitId: bleUnitId,
        roomCode,
        roomId: bleRoomId,
        groups,
        validFrom: (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })(),
        validUntil: (() => { const d = new Date(); d.setHours(23, 59, 59, 999); return d.getTime(); })(),
      };
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
    if (entry?.isMerged && entry?.mergedSessionId) {
      entries
        .filter((e) => String(e?.mergedSessionId || '') === String(entry.mergedSessionId) && String(e?.id || '') !== String(entry.id || ''))
        .forEach((sibling) => handleStatusChange(sibling, 'Rescheduled', reschedulePayload));
    }
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
        if (e?.isMerged) return;
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
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top']}>
      {/* Modern Gradient Header */}
      <LinearGradient
        colors={['#1E1B4B', '#312E81', '#4338CA']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        className="relative overflow-hidden px-5 pb-5"
        style={{ paddingTop: Platform.OS === 'ios' ? 44 : 20 }}
      >
        {/* Decorative elements */}
        <View className="absolute -top-20 -right-20 w-64 h-64 rounded-full bg-indigo-400/5" />
        <View className="absolute top-10 -left-20 w-48 h-48 rounded-full bg-violet-400/5" />
        
        {/* Header Content */}
        <View className="flex-row items-center justify-between mb-4">
          <View>
            <Text className="text-2xl font-bold text-white tracking-tight">
              Timetable
            </Text>
            <Text className="text-sm text-indigo-200/70 font-medium mt-0.5">
              {todayLabel}
            </Text>
          </View>
          {lastRefreshed && (
            <View className="bg-white/10 backdrop-blur-sm rounded-full px-3 py-1.5 border border-white/10">
              <Text className="text-xs text-indigo-200 font-medium">
                {lastRefreshed.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
              </Text>
            </View>
          )}
        </View>

        {/* Stats Cards */}
        <View className="flex-row gap-2 mb-3">
          <View className="flex-1 bg-white/10 backdrop-blur-sm rounded-2xl p-3 border border-white/5">
            <Text className="text-2xl font-bold text-white">{weeklyStats.totalSessions}</Text>
            <Text className="text-xs text-indigo-200/60 font-medium">Total Sessions</Text>
          </View>
          <View className="flex-1 bg-white/10 backdrop-blur-sm rounded-2xl p-3 border border-white/5">
            <Text className="text-2xl font-bold text-indigo-200">{weeklyStats.todayCount}</Text>
            <Text className="text-xs text-indigo-200/60 font-medium">Today</Text>
          </View>
          <View className="flex-1 bg-white/10 backdrop-blur-sm rounded-2xl p-3 border border-white/5">
            <Text className="text-2xl font-bold text-emerald-300">{weeklyStats.pendingCount}</Text>
            <Text className="text-xs text-indigo-200/60 font-medium">Pending</Text>
          </View>
        </View>

        {/* Next Class Card */}
        {nextClass && (
          <View className="bg-white/10 backdrop-blur-md rounded-2xl p-4 border border-white/10">
            <View className="flex-row items-center justify-between">
              <View className="flex-1">
                <View className="flex-row items-center gap-2 mb-1">
                  <View className={`w-1.5 h-1.5 rounded-full ${nextClass.isNow ? 'bg-emerald-400' : 'bg-indigo-300'}`} />
                  <Text className={`text-xs font-bold tracking-wider ${nextClass.isNow ? 'text-emerald-300' : 'text-indigo-200'}`}>
                    {nextClass.isNow ? '● IN PROGRESS' : 'NEXT CLASS'}
                  </Text>
                </View>
                <Text className="text-white font-semibold text-base" numberOfLines={1}>
                  {nextClass.session.unitTitle || nextClass.session.unitCode || '—'}
                </Text>
                <Text className="text-indigo-200/60 text-xs mt-0.5" numberOfLines={1}>
                  {[
                    nextClass.session.unitCode,
                    nextClass.session.startTime,
                    nextClass.session.roomCode || nextClass.session.lectureRoom,
                    nextClass.offset > 0 ? nextClass.dayName : null,
                  ].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <View className="items-center">
                <Text className={`text-lg font-bold ${nextClass.isNow ? 'text-emerald-300' : 'text-white'}`}>
                  {nextCountdown}
                </Text>
              </View>
            </View>
          </View>
        )}
      </LinearGradient>

      {isFromCache && (
        <View className="bg-amber-50/90 border-b border-amber-200/50 px-4 py-2.5 flex-row items-center gap-2">
          <Icon name="wifi-off" size={16} color="#D97706" />
          <Text className="flex-1 text-sm font-medium text-amber-700">
            Cached — pull to refresh when online
          </Text>
        </View>
      )}

      <ScrollView
        className="flex-1"
        contentContainerClassName="px-4 pb-8 pt-3"
        contentContainerStyle={(isTablet || isDesktop) ? { maxWidth: contentMaxWidth, alignSelf: 'center', width: '100%' } : undefined}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => { setIsRefreshing(true); load(false); }}
            colors={['#6366F1']}
            tintColor="#6366F1"
          />
        }
      >
        {isLoading ? (
          <View className="flex-1 items-center justify-center py-20">
            <ActivityIndicator size="large" color="#6366F1" />
            <Text className="mt-4 text-gray-500 text-sm font-medium">Loading timetable...</Text>
          </View>
        ) : errorMessage ? (
          <View className="flex-1 items-center justify-center py-20">
            <Icon name="alert-circle-outline" size={48} color="#EF4444" />
            <Text className="mt-3 text-red-500 text-sm text-center font-medium">{errorMessage}</Text>
          </View>
        ) : groupedByDay.length === 0 ? (
          <View className="flex-1 items-center justify-center py-20">
            <Icon name="calendar-blank" size={48} color="#9CA3AF" />
            <Text className="mt-3 text-gray-500 text-sm font-medium">No timetable entries assigned yet.</Text>
          </View>
        ) : (
          groupedByDay.map((group) => {
            const isToday = group.day.toLowerCase() === todayName.toLowerCase();
            return (
              <View key={group.day} className="mb-4">
                {/* Day Header */}
                <View className="flex-row items-center justify-between mb-3 px-1">
                  <View className="flex-row items-center gap-2">
                    <Text className={`text-lg font-bold ${isToday ? 'text-indigo-600' : 'text-gray-700'}`}>
                      {group.day}
                    </Text>
                    {isToday && (
                      <View className="bg-indigo-100 px-3 py-0.5 rounded-full">
                        <Text className="text-xs font-bold text-indigo-600">Today</Text>
                      </View>
                    )}
                  </View>
                  <Text className="text-xs text-gray-400 font-medium">
                    {group.items.length} session{group.items.length !== 1 ? 's' : ''}
                  </Text>
                </View>

                {/* Session Cards */}
                {group.items.map((entry, index) => {
                  // Merged group rendering
                  if (entry.isMerged && entry.mergedSessionId) {
                    const mergedGroup = group.items.filter(
                      (e) => String(e.mergedSessionId) === String(entry.mergedSessionId),
                    );
                    if (String(mergedGroup[0]?.id) !== String(entry.id)) return null;
                    
                    const mergedStatus = getEffectiveStatus(entry);
                    const mergedStatusColor = STATUS_COLORS[mergedStatus] || '#6B7280';
                    const mergedStatusBg = STATUS_COLORS_LIGHT[mergedStatus] || '#F3F4F6';
                    
                    return (
                      <View key={`merged-${entry.mergedSessionId}`} className="bg-white rounded-2xl p-4 mb-3 shadow-sm border border-indigo-100/50">
                        <View className="flex-row items-start justify-between mb-3">
                          <View className="flex-1">
                            <View className="flex-row items-center gap-2 mb-0.5">
                              <Icon name="layers" size={18} color="#6366F1" />
                              <Text className="text-sm font-bold text-indigo-600">Merged Session</Text>
                              {entry.mergedBy === 'Admin' ? (
                                <View className="bg-purple-100 px-2 py-0.5 rounded-full">
                                  <Text className="text-xs font-bold text-purple-600">Admin</Text>
                                </View>
                              ) : (
                                <View className="bg-emerald-100 px-2 py-0.5 rounded-full">
                                  <Text className="text-xs font-bold text-emerald-600">You</Text>
                                </View>
                              )}
                            </View>
                            <Text className="text-xs text-gray-500 font-medium">
                              {mergedGroup.length} sections • Room {entry.mergedRoom || ''}
                            </Text>
                          </View>
                          <View className="items-end gap-2">
                            <TouchableOpacity
                              className="flex-row items-center px-3 py-1.5 rounded-lg border"
                              style={{ borderColor: mergedStatusColor, backgroundColor: mergedStatusBg }}
                              onPress={() => setOpenDropdownEntryId(String(entry.id))}
                            >
                              <Text className="text-xs font-bold" style={{ color: mergedStatusColor }}>
                                {mergedStatus === 'Rescheduled' && entry.rescheduleSubStatus
                                  ? `${mergedStatus} - ${entry.rescheduleSubStatus}`
                                  : mergedStatus}
                              </Text>
                            </TouchableOpacity>
                            {entry.mergedBy !== 'Admin' && (
                              <TouchableOpacity
                                className="px-3 py-1 rounded-lg bg-red-50 border border-red-200"
                                onPress={() => handleUnmerge(entry)}
                              >
                                <Text className="text-xs font-semibold text-red-500">Unmerge</Text>
                              </TouchableOpacity>
                            )}
                          </View>
                        </View>

                        {/* Merged Sections */}
                        {mergedGroup.map((e) => (
                          <View key={String(e.id)} className="border-t border-gray-100 pt-2 mt-2">
                            <Text className="text-sm font-semibold text-gray-700">{e.unitTitle || e.unitName || e.unitCode}</Text>
                          </View>
                        ))}

                        {/* Footer */}
                        <View className="mt-3 pt-3 border-t border-gray-100">
                          {!!entry.mergedStart && !!entry.mergedEnd && (
                            <Text className="text-xs text-gray-500 font-medium">
                              <Icon name="clock-outline" size={12} color="#6B7280" /> {entry.mergedStart} - {entry.mergedEnd}
                            </Text>
                          )}
                          {!!entry.mergedNote && (
                            <Text className="text-xs text-gray-400 italic mt-1">{entry.mergedNote}</Text>
                          )}
                        </View>

                        {/* Status-specific blocks */}
                        {mergedStatus === 'Rescheduled' && (() => {
                          const { time: newTime, roomCode: newRoom } = parseRescheduledInfo(entry?.rescheduledTo, entry?.rescheduledVenue);
                          return (
                            <View className="mt-3 bg-amber-50 rounded-xl p-3 border border-amber-200/50">
                              <View className="flex-row items-center justify-between mb-2">
                                <Text className="text-xs font-bold text-amber-600">Rescheduled</Text>
                                <View className="flex-row items-center gap-1">
                                  {!!entry.rescheduleSubStatus && (
                                    <View className="px-2 py-0.5 rounded-full bg-white/50">
                                      <Text className="text-xs font-bold" style={{ color: STATUS_COLORS[entry.rescheduleSubStatus] || '#6B7280' }}>
                                        {entry.rescheduleSubStatus}
                                      </Text>
                                    </View>
                                  )}
                                  <View className={`px-2 py-0.5 rounded-full ${entry?.reschedulePermanent ? 'bg-indigo-100' : 'bg-amber-100'}`}>
                                    <Text className={`text-xs font-bold ${entry?.reschedulePermanent ? 'text-indigo-600' : 'text-amber-600'}`}>
                                      {entry?.reschedulePermanent ? 'Permanent' : 'This week'}
                                    </Text>
                                  </View>
                                </View>
                              </View>
                              <View className="flex-row items-center gap-3">
                                <View className="flex-1 bg-amber-100/50 rounded-lg p-2">
                                  <Text className="text-[10px] font-bold text-amber-700/60 uppercase tracking-wider">Was</Text>
                                  <Text className="text-xs font-semibold text-amber-700 line-through">{entry?.time || ''}</Text>
                                  <Text className="text-xs text-amber-600/80">{entry?.roomCode || entry?.venue || ''}</Text>
                                </View>
                                <Icon name="arrow-right" size={20} color="#F59E0B" />
                                <View className="flex-1 bg-emerald-50 rounded-lg p-2">
                                  <Text className="text-[10px] font-bold text-emerald-700/60 uppercase tracking-wider">Now</Text>
                                  <Text className="text-xs font-bold text-emerald-600">{newTime || ''}</Text>
                                  <Text className="text-xs font-semibold text-emerald-500">{newRoom || ''}</Text>
                                </View>
                              </View>
                            </View>
                          );
                        })()}

                        {mergedStatus === 'Online' && (
                          <View className="mt-3 bg-cyan-50 rounded-xl p-3 border border-cyan-200/50">
                            <View className="flex-row items-center gap-2 mb-1">
                              <Icon name="video" size={16} color="#06B6D4" />
                              <Text className="text-xs font-bold text-cyan-600">Online Session</Text>
                            </View>
                            {!!(entry.onlineStartTime || entry.onlineEndTime) && (
                              <Text className="text-sm font-semibold text-cyan-600">
                                {entry.onlineStartTime || ''}{entry.onlineStartTime && entry.onlineEndTime ? ' - ' : ''}{entry.onlineEndTime || ''}
                              </Text>
                            )}
                            <Text className="text-xs text-cyan-500/70 mt-1">Meeting link will be shared when the session starts.</Text>
                          </View>
                        )}

                        {mergedStatus === 'Cancelled' && !!entry?.reason && (
                          <Text className="mt-2 text-xs text-gray-500 font-medium">Reason: {entry.reason}</Text>
                        )}

                        {/* Actions */}
                        <View className="flex-row flex-wrap items-center gap-2 mt-3">
                          <TouchableOpacity
                            className="flex-row items-center px-3 py-1.5 rounded-full border"
                            style={{ backgroundColor: `${getLessonTypeByName(entry?.type || entry?.lessonType).color}15`, borderColor: getLessonTypeByName(entry?.type || entry?.lessonType).color }}
                            onPress={() => setOpenLessonTypeEntryId(String(entry.id))}
                          >
                            <Text className="text-xs font-bold" style={{ color: getLessonTypeByName(entry?.type || entry?.lessonType).color }}>
                              {getLessonTypeByName(entry?.type || entry?.lessonType).label}
                            </Text>
                          </TouchableOpacity>

                          {getLessonTypeByName(entry?.type || entry?.lessonType).code === 'GD' && (
                            <TouchableOpacity
                              className="px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200"
                              onPress={() => handleOpenDelegate(entry)}
                            >
                              <Text className="text-xs font-bold text-emerald-600">Delegate</Text>
                            </TouchableOpacity>
                          )}

                          <TouchableOpacity
                            className="px-3 py-1.5 rounded-lg border border-emerald-200 border-dashed"
                            onPress={() => {
                              const mergedLessonType = getLessonTypeByName(entry?.type || entry?.lessonType);
                              setMakeupModal({ visible: true, entry });
                              setMakeupLessonType(mergedLessonType.code || 'LEC');
                            }}
                          >
                            <Text className="text-xs font-semibold text-emerald-600">+ Make-Up</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  }

                  // Regular entry rendering
                  const unitCode = String(entry?.unitCode || entry?.code || '').trim();
                  const unitName = String(entry?.unitTitle || entry?.unitName || entry?.name || '').trim() || unitCode || 'Unnamed assigned unit';
                  const time = String(entry?.time || '').trim();
                  const startTime = String(entry?.startTime || '').trim();
                  const endTime = String(entry?.endTime || '').trim();
                  const timeDisplay = time || (startTime && endTime ? `${startTime} - ${endTime}` : startTime || endTime || 'Time not set');
                  const venue = String(entry?.roomCode || entry?.room_code || entry?.venueCode || entry?.venue_code || entry?.venue || entry?.lectureRoom || entry?.room || entry?.location || '').trim();
                  const status = getEffectiveStatus(entry);
                  const statusColor = STATUS_COLORS[status] || '#6B7280';
                  const statusBg = STATUS_COLORS_LIGHT[status] || '#F3F4F6';
                  const isEntryUpdating = updatingEntryKey.startsWith(`${String(entry?.id || '').trim()}:`);
                  const lessonType = getLessonTypeByName(entry?.type || entry?.lessonType);

                  return (
                    <View key={`${unitCode || unitName}-${index}`} className="bg-white rounded-2xl p-4 mb-3 shadow-sm border border-gray-100/80">
                      {/* Header */}
                      <View className="flex-row items-start justify-between mb-2">
                        <View className="flex-1 mr-3">
                          <Text className="text-base font-bold text-gray-800 tracking-tight">{unitName}</Text>
                          {!!unitCode && (
                            <Text className="text-xs font-bold text-indigo-500 mt-0.5">{unitCode}</Text>
                          )}
                          {!!(entry.courseName || entry.department) && (
                            <Text className="text-xs text-gray-500 mt-0.5" numberOfLines={1}>
                              {[entry.courseName, entry.department].filter(Boolean).join(' - ')}
                            </Text>
                          )}
                        </View>
                        {entry.isExtraSession ? (
                          <View className="bg-emerald-100 px-3 py-1 rounded-full">
                            <Text className="text-xs font-bold text-emerald-600">Make-Up</Text>
                          </View>
                        ) : (
                          <TouchableOpacity
                            className="flex-row items-center px-3 py-1.5 rounded-lg border"
                            style={{ borderColor: statusColor, backgroundColor: statusBg }}
                            onPress={() => setOpenDropdownEntryId(String(entry?.id || index))}
                            disabled={isEntryUpdating}
                          >
                            {isEntryUpdating ? (
                              <ActivityIndicator size="small" color={statusColor} />
                            ) : (
                              <Text className="text-xs font-bold" style={{ color: statusColor }}>
                                {status === 'Rescheduled' && entry.rescheduleSubStatus 
                                  ? `${status} - ${entry.rescheduleSubStatus}` 
                                  : status}
                              </Text>
                            )}
                          </TouchableOpacity>
                        )}
                      </View>

                      {/* Lesson Type */}
                      {!entry.isExtraSession && (
                        <TouchableOpacity
                          className="self-start flex-row items-center px-3 py-1 rounded-full border mb-2"
                          style={{ backgroundColor: `${lessonType.color}15`, borderColor: lessonType.color }}
                          onPress={() => setOpenLessonTypeEntryId(String(entry?.id || index))}
                        >
                          <Text className="text-xs font-bold" style={{ color: lessonType.color }}>
                            {lessonType.label}
                          </Text>
                        </TouchableOpacity>
                      )}

                      {/* Meta Info */}
                      {entry.isExtraSession && !!entry.date && (
                        <Text className="text-xs text-gray-500 mt-0.5">
                          <Icon name="calendar" size={12} color="#6B7280" /> {formatMakeupDate(new Date(entry.date))}
                        </Text>
                      )}
                      <Text className="text-xs text-gray-500 mt-0.5">
                        <Icon name="clock-outline" size={12} color="#6B7280" /> {timeDisplay}
                      </Text>
                      {!!venue && (
                        <Text className="text-xs text-gray-500 mt-0.5">
                          <Icon name="map-marker-outline" size={12} color="#6B7280" /> {venue}
                        </Text>
                      )}

                      {/* Reschedule Block */}
                      {!entry.isExtraSession && status === 'Rescheduled' && (() => {
                        const { time: newTime, roomCode: newRoom } = parseRescheduledInfo(entry?.rescheduledTo, entry?.rescheduledVenue);
                        return (
                          <View className="mt-3 bg-amber-50 rounded-xl p-3 border border-amber-200/50">
                            <View className="flex-row items-center justify-between mb-2">
                              <Text className="text-xs font-bold text-amber-600">Rescheduled</Text>
                              <View className="flex-row items-center gap-1">
                                {!!entry.rescheduleSubStatus && (
                                  <View className="px-2 py-0.5 rounded-full bg-white/50">
                                    <Text className="text-xs font-bold" style={{ color: STATUS_COLORS[entry.rescheduleSubStatus] || '#6B7280' }}>
                                      {entry.rescheduleSubStatus}
                                    </Text>
                                  </View>
                                )}
                                <View className={`px-2 py-0.5 rounded-full ${entry?.reschedulePermanent ? 'bg-indigo-100' : 'bg-amber-100'}`}>
                                  <Text className={`text-xs font-bold ${entry?.reschedulePermanent ? 'text-indigo-600' : 'text-amber-600'}`}>
                                    {entry?.reschedulePermanent ? 'Permanent' : 'This week'}
                                  </Text>
                                </View>
                              </View>
                            </View>
                            <View className="flex-row items-center gap-3">
                              <View className="flex-1 bg-amber-100/50 rounded-lg p-2">
                                <Text className="text-[10px] font-bold text-amber-700/60 uppercase tracking-wider">Was</Text>
                                <Text className="text-xs font-semibold text-amber-700 line-through">{entry?.time || ''}</Text>
                                <Text className="text-xs text-amber-600/80">{entry?.roomCode || entry?.venue || ''}</Text>
                              </View>
                              <Icon name="arrow-right" size={20} color="#F59E0B" />
                              <View className="flex-1 bg-emerald-50 rounded-lg p-2">
                                <Text className="text-[10px] font-bold text-emerald-700/60 uppercase tracking-wider">Now</Text>
                                <Text className="text-xs font-bold text-emerald-600">{newTime || ''}</Text>
                                <Text className="text-xs font-semibold text-emerald-500">{newRoom || ''}</Text>
                              </View>
                            </View>
                          </View>
                        );
                      })()}

                      {/* Online Block */}
                      {!entry.isExtraSession && status === 'Online' && (
                        <View className="mt-3 bg-cyan-50 rounded-xl p-3 border border-cyan-200/50">
                          <View className="flex-row items-center gap-2 mb-1">
                            <Icon name="video" size={16} color="#06B6D4" />
                            <Text className="text-xs font-bold text-cyan-600">Online Session</Text>
                          </View>
                          {!!(entry.onlineStartTime || entry.onlineEndTime) && (
                            <Text className="text-sm font-semibold text-cyan-600">
                              {entry.onlineStartTime || ''}{entry.onlineStartTime && entry.onlineEndTime ? ' - ' : ''}{entry.onlineEndTime || ''}
                            </Text>
                          )}
                          <Text className="text-xs text-cyan-500/70 mt-1">Meeting link will be shared when the session starts.</Text>
                        </View>
                      )}

                      {/* Cancelled Reason */}
                      {!entry.isExtraSession && status === 'Cancelled' && !!entry?.reason && (
                        <Text className="mt-2 text-xs text-gray-500 font-medium">
                          <Icon name="info-outline" size={12} color="#6B7280" /> Reason: {entry.reason}
                        </Text>
                      )}

                      {/* Pending Reason */}
                      {!entry.isExtraSession && status === 'Pending' && !!entry?.pendingReason && (
                        <Text className="mt-2 text-xs text-gray-500 font-medium">
                          <Icon name="info-outline" size={12} color="#6B7280" /> {entry.pendingReason}
                        </Text>
                      )}

                      {/* Actions */}
                      <View className="flex-row flex-wrap items-center gap-2 mt-3 pt-3 border-t border-gray-100">
                        {!entry.isExtraSession && (
                          <TouchableOpacity
                            className="px-3 py-1.5 rounded-lg border border-emerald-200 border-dashed"
                            onPress={() => {
                              setMakeupModal({ visible: true, entry });
                              setMakeupLessonType(lessonType.code || 'LEC');
                            }}
                          >
                            <Text className="text-xs font-semibold text-emerald-600">+ Make-Up Session</Text>
                          </TouchableOpacity>
                        )}

                        {!entry.isExtraSession && !entry.isMerged && !!mergeCandidatesMap[String(entry.id)] && (
                          <TouchableOpacity
                            className="px-3 py-1.5 rounded-lg bg-indigo-50 border border-indigo-200"
                            onPress={() => handleOpenMerge(entry)}
                          >
                            <Text className="text-xs font-semibold text-indigo-600">Merge Classes</Text>
                          </TouchableOpacity>
                        )}

                        {!entry.isExtraSession && entry.isMerged && (
                          <View className="flex-row items-center gap-2 bg-indigo-50 rounded-lg px-3 py-1.5 border border-indigo-200">
                            <Icon name="layers" size={14} color="#6366F1" />
                            <Text className="text-xs font-medium text-indigo-600 flex-1">Merged - Room {entry.mergedRoom}</Text>
                            <TouchableOpacity
                              className="px-2 py-0.5 rounded bg-red-50 border border-red-200"
                              onPress={() => handleUnmerge(entry)}
                            >
                              <Text className="text-xs font-semibold text-red-500">Unmerge</Text>
                            </TouchableOpacity>
                          </View>
                        )}

                        {!entry.isExtraSession && lessonType.code === 'GD' && (
                          <TouchableOpacity
                            className="px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200"
                            onPress={() => handleOpenDelegate(entry)}
                          >
                            <Text className="text-xs font-bold text-emerald-600">Delegate</Text>
                          </TouchableOpacity>
                        )}

                        {entry.isExtraSession && (
                          <TouchableOpacity
                            className="px-3 py-1.5 rounded-lg bg-red-50 border border-red-200"
                            onPress={() => {
                              Alert.alert(
                                'Remove Make-Up Session',
                                'This will permanently remove this make-up session.',
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
                          >
                            <Text className="text-xs font-semibold text-red-500">Remove</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                  );
                })}
              </View>
            );
          })
        )}
      </ScrollView>

      {/* Modals (maintained from original) */}
      <Modal
        visible={!!openLessonTypeEntryId}
        transparent
        animationType="fade"
        onRequestClose={() => setOpenLessonTypeEntryId('')}
      >
        <Pressable className="flex-1 bg-black/50 justify-end" onPress={() => setOpenLessonTypeEntryId('')}>
          <View className="bg-white rounded-t-3xl px-5 pt-5 pb-8">
            <View className="w-12 h-1 bg-gray-300 rounded-full self-center mb-4" />
            <Text className="text-lg font-bold text-gray-800 mb-1">Set Lesson Type</Text>
            {LESSON_TYPES.map((lt) => {
              const activeEntry = entries.find((e) => String(e?.id || '') === openLessonTypeEntryId);
              const currentCode = getLessonTypeByName(activeEntry?.type || activeEntry?.lessonType).code;
              const isSelected = lt.code === currentCode;
              return (
                <TouchableOpacity
                  key={lt.code}
                  className={`flex-row items-center gap-3 py-3 px-4 rounded-xl border mb-2 ${isSelected ? 'border' : 'border-gray-100'}`}
                  style={isSelected ? { backgroundColor: `${lt.color}15`, borderColor: lt.color } : { backgroundColor: '#F9FAFB' }}
                  onPress={() => {
                    setOpenLessonTypeEntryId('');
                    if (!activeEntry) return;
                    handleLessonTypeChange(activeEntry, lt.code);
                  }}
                >
                  <View className="w-3 h-3 rounded-sm" style={{ backgroundColor: lt.color }} />
                  <Text className={`flex-1 text-base font-semibold ${isSelected ? 'font-bold' : 'text-gray-700'}`} style={isSelected ? { color: lt.color } : undefined}>
                    {lt.label}
                  </Text>
                  <Text className="text-sm font-semibold text-gray-400">{lt.code}</Text>
                  {isSelected && <Icon name="check" size={18} color={lt.color} />}
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
        <Pressable className="flex-1 bg-black/50 justify-end" onPress={() => setOpenDropdownEntryId('')}>
          <View className="bg-white rounded-t-3xl px-5 pt-5 pb-8">
            <View className="w-12 h-1 bg-gray-300 rounded-full self-center mb-4" />
            <Text className="text-lg font-bold text-gray-800 mb-1">Set Lesson Status</Text>
            <Text className="text-sm text-gray-500 mb-4">Pending is set automatically until you choose a status below.</Text>
            {LESSON_STATUS_OPTIONS.map((option) => {
              const optionColor = STATUS_COLORS[option] || '#6B7280';
              const optionBg = STATUS_COLORS_LIGHT[option] || '#F3F4F6';
              const activeEntry = entries.find((e) => String(e?.id || '') === openDropdownEntryId);
              const isSelected = option === getEffectiveStatus(activeEntry);
              const actionKey = `${openDropdownEntryId}:${option}`;
              const isUpdatingThisAction = updatingEntryKey === actionKey;
              return (
                <TouchableOpacity
                  key={option}
                  className={`flex-row items-center gap-3 py-3 px-4 rounded-xl border mb-2 ${isSelected ? 'border' : 'border-gray-100'}`}
                  style={isSelected ? { backgroundColor: `${optionColor}15`, borderColor: optionColor } : { backgroundColor: '#F9FAFB' }}
                  onPress={() => {
                    setOpenDropdownEntryId('');
                    if (!activeEntry) return;
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
                        const day = String(activeEntry?.day || '').trim();
                        const time = String(activeEntry?.startTime || activeEntry?.time || '').trim();
                        const venue = String(activeEntry?.venue || activeEntry?.lectureRoom || activeEntry?.roomCode || '').trim();
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
                >
                  {isUpdatingThisAction ? (
                    <ActivityIndicator size="small" color={optionColor} />
                  ) : (
                    <>
                      <View className="w-3 h-3 rounded-sm" style={{ backgroundColor: optionColor }} />
                      <Text className={`flex-1 text-base font-semibold ${isSelected ? 'font-bold' : 'text-gray-700'}`} style={isSelected ? { color: optionColor } : undefined}>
                        {STATUS_DIALOG_LABELS[option] || option}
                      </Text>
                      {isSelected && <Icon name="check" size={18} color={optionColor} />}
                    </>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </Pressable>
      </Modal>

      {/* Cancel Modal */}
      <Modal
        visible={cancelModal.visible}
        transparent
        animationType="slide"
        onRequestClose={() => { setCancelModal({ visible: false, entry: null }); setCancelReason(''); }}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} className="flex-1">
          <Pressable className="flex-1 bg-black/50 justify-end" onPress={() => { setCancelModal({ visible: false, entry: null }); setCancelReason(''); }}>
            <Pressable onPress={() => {}} className="bg-white rounded-t-3xl px-5 pt-5 pb-8">
              <View className="w-12 h-1 bg-gray-300 rounded-full self-center mb-4" />
              <Text className="text-lg font-bold text-gray-800 mb-1">Cancel Lecture</Text>
              <Text className="text-sm text-gray-500 mb-4">
                Please provide a reason for cancelling this lecture. Students will be notified.
              </Text>
              <TextInput
                className="border border-gray-200 rounded-xl p-3 text-gray-800 bg-gray-50 min-h-[100px] text-base"
                placeholder="e.g. Lecturer is unwell, room unavailable..."
                placeholderTextColor="#9CA3AF"
                multiline
                numberOfLines={4}
                value={cancelReason}
                onChangeText={setCancelReason}
                maxLength={300}
              />
              <Text className="text-xs text-gray-400 text-right mt-1">{cancelReason.length}/300</Text>
              <TouchableOpacity
                className="bg-red-500 rounded-xl py-3.5 items-center mt-3"
                onPress={handleCancelConfirm}
              >
                <Text className="text-white text-base font-bold">Confirm Cancellation</Text>
              </TouchableOpacity>
              <TouchableOpacity
                className="border border-gray-200 rounded-xl py-3 items-center mt-2"
                onPress={() => { setCancelModal({ visible: false, entry: null }); setCancelReason(''); }}
              >
                <Text className="text-gray-600 text-base font-semibold">Go Back</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      {/* Delegate Modal */}
      <Modal
        visible={delegateModal.visible}
        transparent
        animationType="slide"
        onRequestClose={() => setDelegateModal({ visible: false, entry: null })}
      >
        <Pressable className="flex-1 bg-black/50 justify-end" onPress={() => setDelegateModal({ visible: false, entry: null })}>
          <Pressable onPress={() => {}} className="bg-white rounded-t-3xl px-5 pt-5 pb-8">
            <View className="w-12 h-1 bg-gray-300 rounded-full self-center mb-4" />
            <Text className="text-lg font-bold text-gray-800 mb-1">Delegate Group Discussion</Text>
            <Text className="text-sm text-gray-500 mb-4">
              Each group leader will receive a notification to host BLE attendance for their group.
            </Text>
            {loadingGroups ? (
              <ActivityIndicator color="#10B981" className="py-6" />
            ) : delegateGroups.length === 0 ? (
              <View className="items-center py-4">
                <Text className="text-base font-semibold text-gray-600">No groups found for this unit.</Text>
                <Text className="mt-1 text-sm text-gray-400">Create groups first from the Groups screen.</Text>
              </View>
            ) : (
              <>
                <Text className="text-base font-semibold text-gray-600 mb-2 mt-1">Groups ({delegateGroups.length})</Text>
                {delegateGroups.map((g) => {
                  const num = g.groupNumber ?? g.number ?? '?';
                  const name = g.name || `Group ${num}`;
                  const leader = g.leaderName || g.leader?.name || g.leader?.fullName || 'No leader assigned';
                  return (
                    <View key={String(g.id || g._id || num)} className="border border-emerald-200 rounded-xl p-3 mb-2 bg-emerald-50/50">
                      <Text className="text-base font-bold text-emerald-600">{name}</Text>
                      <Text className="text-sm text-emerald-500 mt-0.5">Leader: {leader}</Text>
                    </View>
                  );
                })}
              </>
            )}
            {!!delegateError && <Text className="text-red-500 text-sm mt-2 mb-1">{delegateError}</Text>}
            {delegateGroups.length > 0 && (
              <TouchableOpacity
                className="bg-emerald-500 rounded-xl py-3.5 items-center mt-3"
                style={{ opacity: (delegating || loadingGroups) ? 0.6 : 1 }}
                onPress={handleConfirmDelegate}
                disabled={delegating || loadingGroups}
              >
                {delegating ? (
                  <ActivityIndicator color="#FFF" size="small" />
                ) : (
                  <Text className="text-white text-base font-bold">Notify All Leaders</Text>
                )}
              </TouchableOpacity>
            )}
            <TouchableOpacity
              className="border border-gray-200 rounded-xl py-3 items-center mt-2"
              onPress={() => setDelegateModal({ visible: false, entry: null })}
            >
              <Text className="text-gray-600 text-base font-semibold">Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Reschedule Modal */}
      <Modal
        visible={rescheduleModal.visible}
        transparent
        animationType="slide"
        onRequestClose={closeRescheduleModal}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} className="flex-1">
          <Pressable className="flex-1 bg-black/50 justify-end" onPress={closeRescheduleModal}>
            <Pressable onPress={() => {}} className="bg-white rounded-t-3xl px-5 pt-5 pb-8">
              <View className="w-12 h-1 bg-gray-300 rounded-full self-center mb-4" />
              <Text className="text-lg font-bold text-gray-800 mb-4">Reschedule Lecture</Text>

              {/* Step indicator */}
              <View className="flex-row items-center justify-center mb-5">
                <View className={`w-3 h-3 rounded-full ${rescheduleStep >= 1 ? 'bg-indigo-500' : 'bg-gray-200'}`} />
                <View className={`w-12 h-0.5 mx-1 ${rescheduleStep >= 2 ? 'bg-indigo-500' : 'bg-gray-200'}`} />
                <View className={`w-3 h-3 rounded-full ${rescheduleStep >= 2 ? 'bg-indigo-500' : 'bg-gray-200'}`} />
              </View>

              {rescheduleStep === 1 ? (
                <>
                  <View className="flex-row gap-2 mb-3">
                    <TouchableOpacity
                      className={`flex-1 rounded-xl py-2.5 items-center border ${rescheduleType === 'temporary' ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 bg-gray-50'}`}
                      onPress={() => setRescheduleType('temporary')}
                    >
                      <Text className={`text-base font-semibold ${rescheduleType === 'temporary' ? 'text-indigo-600' : 'text-gray-600'}`}>Temporary</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      className={`flex-1 rounded-xl py-2.5 items-center border ${rescheduleType === 'permanent' ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 bg-gray-50'}`}
                      onPress={() => setRescheduleType('permanent')}
                    >
                      <Text className={`text-base font-semibold ${rescheduleType === 'permanent' ? 'text-indigo-600' : 'text-gray-600'}`}>Permanent</Text>
                    </TouchableOpacity>
                  </View>
                  <Text className="text-sm text-gray-500 mb-4">
                    {rescheduleType === 'temporary'
                      ? 'Applies this week only. Reverts to original slot on Friday night.'
                      : 'Applies for the rest of the semester.'}
                  </Text>

                  <Text className="text-base font-semibold text-gray-700 mb-1.5">New Day</Text>
                  <View className="flex-row flex-wrap gap-1.5 mb-3">
                    {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d) => (
                      <TouchableOpacity
                        key={d}
                        className={`rounded-lg py-1.5 px-3 border ${rescheduleDay === d ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 bg-gray-50'}`}
                        onPress={() => setRescheduleDay(d)}
                      >
                        <Text className={`text-sm font-semibold ${rescheduleDay === d ? 'text-indigo-600' : 'text-gray-600'}`}>{d.slice(0, 3)}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <Text className="text-base font-semibold text-gray-700 mb-1.5">Start Time</Text>
                  <TouchableOpacity className="border border-gray-200 rounded-xl py-3 px-4 bg-gray-50 mb-3" onPress={() => setShowStartPicker(true)}>
                    <Text className={rescheduleStartTime ? 'text-base font-semibold text-gray-800' : 'text-base text-gray-400'}>
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

                  <Text className="text-base font-semibold text-gray-700 mb-1.5">End Time</Text>
                  <TouchableOpacity className="border border-gray-200 rounded-xl py-3 px-4 bg-gray-50 mb-3" onPress={() => setShowEndPicker(true)}>
                    <Text className={rescheduleEndTime ? 'text-base font-semibold text-gray-800' : 'text-base text-gray-400'}>
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

                  {!!roomSearchError && <Text className="text-red-500 text-sm mt-2 text-center">{roomSearchError}</Text>}

                  <TouchableOpacity
                    className="bg-indigo-500 rounded-xl py-3.5 items-center mt-3"
                    onPress={handleFindRooms}
                    disabled={searchingRooms}
                  >
                    {searchingRooms ? (
                      <ActivityIndicator color="#FFF" size="small" />
                    ) : (
                      <Text className="text-white text-base font-bold">Find Available Rooms</Text>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity className="border border-gray-200 rounded-xl py-3 items-center mt-2" onPress={closeRescheduleModal}>
                    <Text className="text-gray-600 text-base font-semibold">Cancel</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <Text className="text-lg font-semibold text-indigo-600 mb-3 text-center">
                    {rescheduleDay} - {formatTime(rescheduleStartTime)} to {formatTime(rescheduleEndTime)}
                  </Text>

                  {availableRooms.length === 0 ? (
                    <View className="items-center py-6">
                      <Text className="text-base font-semibold text-gray-600">No rooms available for this time slot.</Text>
                      <Text className="mt-1 text-sm text-gray-400">Try a different day or time window.</Text>
                    </View>
                  ) : (
                    <>
                      <TextInput
                        className="border border-gray-200 rounded-xl py-2.5 px-3 text-base text-gray-800 bg-gray-50 mb-2"
                        placeholder="Search rooms..."
                        placeholderTextColor="#9CA3AF"
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
                        className="max-h-60"
                        renderItem={({ item }) => {
                          const code = item.roomCode || item.room_code || item.name || item.code || 'Unknown';
                          const capacity = item.capacity || item.seats || null;
                          const building = item.building || item.block || '';
                          const isSelected = (selectedRoom?.id || selectedRoom?._id) === (item.id || item._id);
                          return (
                            <TouchableOpacity
                              className={`flex-row items-center justify-between border rounded-xl p-3 mb-2 ${isSelected ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 bg-gray-50'}`}
                              onPress={() => setSelectedRoom(item)}
                            >
                              <View className="flex-1">
                                <Text className={`text-base font-bold ${isSelected ? 'text-indigo-600' : 'text-gray-800'}`}>{code}</Text>
                                <Text className="text-sm text-gray-500 mt-0.5">
                                  {building ? `${building} - ` : ''}{capacity ? `${capacity} seats` : ''}
                                </Text>
                              </View>
                              {isSelected && <Icon name="check-circle" size={20} color="#6366F1" />}
                            </TouchableOpacity>
                          );
                        }}
                      />
                    </>
                  )}

                  <TouchableOpacity
                    className={`rounded-xl py-3.5 items-center mt-3 ${selectedRoom ? 'bg-amber-500' : 'bg-gray-300'}`}
                    onPress={handleRescheduleConfirm}
                    disabled={!selectedRoom}
                  >
                    <Text className="text-white text-base font-bold">Confirm Reschedule</Text>
                  </TouchableOpacity>
                  <TouchableOpacity className="border border-gray-200 rounded-xl py-3 items-center mt-2" onPress={() => { setRescheduleStep(1); setSelectedRoom(null); }}>
                    <Text className="text-gray-600 text-base font-semibold">Back</Text>
                  </TouchableOpacity>
                </>
              )}
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      {/* Make-Up Modal */}
      <Modal
        visible={makeupModal.visible}
        transparent
        animationType="slide"
        onRequestClose={closeMakeupModal}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} className="flex-1">
          <Pressable className="flex-1 bg-black/50 justify-end" onPress={closeMakeupModal}>
            <Pressable onPress={() => {}} className="bg-white rounded-t-3xl px-5 pt-5 pb-8">
              <View className="w-12 h-1 bg-gray-300 rounded-full self-center mb-4" />
              <Text className="text-lg font-bold text-gray-800 mb-1">Add Make-Up Session</Text>
              {!!makeupModal.entry && (
                <Text className="text-sm text-gray-500 mb-4">
                  For: {String(makeupModal.entry?.unitCode || '').trim()}{makeupModal.entry?.unitTitle || makeupModal.entry?.unitName ? ` - ${makeupModal.entry.unitTitle || makeupModal.entry?.unitName}` : ''}
                </Text>
              )}

              <View className="flex-row items-center justify-center mb-5">
                <View className={`w-3 h-3 rounded-full ${makeupStep >= 1 ? 'bg-emerald-500' : 'bg-gray-200'}`} />
                <View className={`w-12 h-0.5 mx-1 ${makeupStep >= 2 ? 'bg-emerald-500' : 'bg-gray-200'}`} />
                <View className={`w-3 h-3 rounded-full ${makeupStep >= 2 ? 'bg-emerald-500' : 'bg-gray-200'}`} />
              </View>

              {makeupStep === 1 ? (
                <>
                  <Text className="text-base font-semibold text-gray-700 mb-1.5">Date</Text>
                  <TouchableOpacity className="border border-gray-200 rounded-xl py-3 px-4 bg-gray-50 mb-3" onPress={() => setShowMakeupDatePicker(true)}>
                    <Text className={makeupDate ? 'text-base font-semibold text-gray-800' : 'text-base text-gray-400'}>
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

                  <Text className="text-base font-semibold text-gray-700 mb-1.5">Start Time</Text>
                  <TouchableOpacity className="border border-gray-200 rounded-xl py-3 px-4 bg-gray-50 mb-3" onPress={() => setShowMakeupStartPicker(true)}>
                    <Text className={makeupStartTime ? 'text-base font-semibold text-gray-800' : 'text-base text-gray-400'}>
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

                  <Text className="text-base font-semibold text-gray-700 mb-1.5">End Time</Text>
                  <TouchableOpacity className="border border-gray-200 rounded-xl py-3 px-4 bg-gray-50 mb-3" onPress={() => setShowMakeupEndPicker(true)}>
                    <Text className={makeupEndTime ? 'text-base font-semibold text-gray-800' : 'text-base text-gray-400'}>
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

                  <Text className="text-base font-semibold text-gray-700 mb-1.5">Lesson Type</Text>
                  <View className="flex-row flex-wrap gap-1.5 mb-3">
                    {LESSON_TYPES.filter((lt) => ['LEC', 'TUT', 'LAB', 'SEM', 'WRK', 'CAT', 'RAT', 'PRE'].includes(lt.code)).map((lt) => (
                      <TouchableOpacity
                        key={lt.code}
                        className={`rounded-lg py-1.5 px-3 border ${makeupLessonType === lt.code ? 'border-emerald-500 bg-emerald-50' : 'border-gray-200 bg-gray-50'}`}
                        onPress={() => setMakeupLessonType(lt.code)}
                      >
                        <Text className={`text-sm font-semibold ${makeupLessonType === lt.code ? 'text-emerald-600' : 'text-gray-600'}`}>{lt.code}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {!!makeupRoomError && <Text className="text-red-500 text-sm mt-2 text-center">{makeupRoomError}</Text>}

                  <TouchableOpacity
                    className="bg-emerald-500 rounded-xl py-3.5 items-center mt-3"
                    onPress={handleFindRoomsForMakeup}
                    disabled={makeupSearchingRooms}
                  >
                    {makeupSearchingRooms ? (
                      <ActivityIndicator color="#FFF" size="small" />
                    ) : (
                      <Text className="text-white text-base font-bold">Find Available Rooms</Text>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity className="border border-gray-200 rounded-xl py-3 items-center mt-2" onPress={closeMakeupModal}>
                    <Text className="text-gray-600 text-base font-semibold">Cancel</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <Text className="text-lg font-semibold text-emerald-600 mb-3 text-center">
                    {makeupDate?.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} - {formatTime(makeupStartTime)} to {formatTime(makeupEndTime)}
                  </Text>

                  {makeupAvailableRooms.length === 0 ? (
                    <View className="items-center py-6">
                      <Text className="text-base font-semibold text-gray-600">No rooms available for this time slot.</Text>
                      <Text className="mt-1 text-sm text-gray-400">Try a different date or time window.</Text>
                    </View>
                  ) : (
                    <>
                      <TextInput
                        className="border border-gray-200 rounded-xl py-2.5 px-3 text-base text-gray-800 bg-gray-50 mb-2"
                        placeholder="Search rooms..."
                        placeholderTextColor="#9CA3AF"
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
                        className="max-h-60"
                        renderItem={({ item }) => {
                          const code = item.roomCode || item.room_code || item.name || item.code || 'Unknown';
                          const capacity = item.capacity || item.seats || null;
                          const building = item.building || item.block || '';
                          const isSelected = (makeupSelectedRoom?.id || makeupSelectedRoom?._id) === (item.id || item._id);
                          return (
                            <TouchableOpacity
                              className={`flex-row items-center justify-between border rounded-xl p-3 mb-2 ${isSelected ? 'border-emerald-500 bg-emerald-50' : 'border-gray-200 bg-gray-50'}`}
                              onPress={() => setMakeupSelectedRoom(item)}
                            >
                              <View className="flex-1">
                                <Text className={`text-base font-bold ${isSelected ? 'text-emerald-600' : 'text-gray-800'}`}>{code}</Text>
                                <Text className="text-sm text-gray-500 mt-0.5">
                                  {building ? `${building} - ` : ''}{capacity ? `${capacity} seats` : ''}
                                </Text>
                              </View>
                              {isSelected && <Icon name="check-circle" size={20} color="#10B981" />}
                            </TouchableOpacity>
                          );
                        }}
                      />
                    </>
                  )}

                  <TouchableOpacity
                    className={`rounded-xl py-3.5 items-center mt-3 ${(!makeupSelectedRoom || savingMakeup) ? 'bg-gray-300' : 'bg-emerald-500'}`}
                    onPress={handleSaveMakeup}
                    disabled={!makeupSelectedRoom || savingMakeup}
                  >
                    {savingMakeup ? (
                      <ActivityIndicator color="#FFF" size="small" />
                    ) : (
                      <Text className="text-white text-base font-bold">Save Make-Up Session</Text>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity className="border border-gray-200 rounded-xl py-3 items-center mt-2" onPress={() => { setMakeupStep(1); setMakeupSelectedRoom(null); }}>
                    <Text className="text-gray-600 text-base font-semibold">Back</Text>
                  </TouchableOpacity>
                </>
              )}
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      {/* Online Modal */}
      <Modal
        visible={onlineModal.visible}
        transparent
        animationType="slide"
        onRequestClose={() => setOnlineModal({ visible: false, entry: null })}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} className="flex-1">
          <Pressable className="flex-1 bg-black/50 justify-end" onPress={() => setOnlineModal({ visible: false, entry: null })}>
            <Pressable onPress={() => {}} className="bg-white rounded-t-3xl px-5 pt-5 pb-8">
              <View className="w-12 h-1 bg-gray-300 rounded-full self-center mb-4" />
              <Text className="text-lg font-bold text-gray-800 mb-1">Mark as Online</Text>
              <Text className="text-sm text-gray-500 mb-4">
                Set the scheduled online time. Students will be notified and the room will be freed.
              </Text>

              <Text className="text-base font-semibold text-gray-700 mb-1.5">Start Time</Text>
              <TouchableOpacity className="border border-gray-200 rounded-xl py-3 px-4 bg-gray-50 mb-3" onPress={() => setShowOnlineStartPicker(true)}>
                <Text className={onlineStartTime ? 'text-base font-semibold text-gray-800' : 'text-base text-gray-400'}>
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

              <Text className="text-base font-semibold text-gray-700 mb-1.5">End Time <Text className="font-normal text-gray-400">(optional)</Text></Text>
              <TouchableOpacity className="border border-gray-200 rounded-xl py-3 px-4 bg-gray-50 mb-4" onPress={() => setShowOnlineEndPicker(true)}>
                <Text className={onlineEndTime ? 'text-base font-semibold text-gray-800' : 'text-base text-gray-400'}>
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
                className="bg-cyan-500 rounded-xl py-3.5 items-center mt-2"
                onPress={() => {
                  const { entry } = onlineModal;
                  const onlinePayload = {
                    onlineStartTime: onlineStartTime ? formatTime(onlineStartTime) : null,
                    onlineEndTime: onlineEndTime ? formatTime(onlineEndTime) : null,
                  };
                  setOnlineModal({ visible: false, entry: null });
                  handleStatusChange(entry, 'Online', onlinePayload);
                  if (entry?.isMerged && entry?.mergedSessionId) {
                    entries
                      .filter((e) => String(e?.mergedSessionId || '') === String(entry.mergedSessionId) && String(e?.id || '') !== String(entry.id || ''))
                      .forEach((sibling) => handleStatusChange(sibling, 'Online', onlinePayload));
                  }
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
              >
                <Text className="text-white text-base font-bold">Confirm Online Session</Text>
              </TouchableOpacity>
              <TouchableOpacity className="border border-gray-200 rounded-xl py-3 items-center mt-2" onPress={() => setOnlineModal({ visible: false, entry: null })}>
                <Text className="text-gray-600 text-base font-semibold">Cancel</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      {/* Merge Modal */}
      <Modal
        visible={mergeModal.visible}
        transparent
        animationType="slide"
        onRequestClose={closeMergeModal}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} className="flex-1">
          <Pressable className="flex-1 bg-black/50 justify-end" onPress={closeMergeModal}>
            <Pressable onPress={() => {}} className="bg-white rounded-t-3xl px-5 pt-5 pb-8">
              <View className="w-12 h-1 bg-gray-300 rounded-full self-center mb-4" />
              <Text className="text-lg font-bold text-gray-800 mb-1">Merge Lessons</Text>
              <Text className="text-sm text-gray-500 mb-4">
                Combine multiple class sections for the same unit into one shared lecture room.
              </Text>

              <View className="flex-row items-center justify-center mb-5">
                <View className={`w-3 h-3 rounded-full ${mergeStep >= 1 ? 'bg-indigo-500' : 'bg-gray-200'}`} />
                <View className={`w-12 h-0.5 mx-1 ${mergeStep >= 2 ? 'bg-indigo-500' : 'bg-gray-200'}`} />
                <View className={`w-3 h-3 rounded-full ${mergeStep >= 2 ? 'bg-indigo-500' : 'bg-gray-200'}`} />
              </View>

              {mergeStep === 1 ? (
                <>
                  <Text className="text-base font-semibold text-gray-700 mb-1">
                    Select sections to merge ({mergeSelectedIds.size} selected)
                  </Text>
                  <Text className="text-xs text-gray-400 mb-3 font-medium">
                    Tap a section to select or deselect it. At least 2 must be selected.
                  </Text>

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
                        className={`flex-row items-center justify-between border rounded-xl p-3 mb-2 ${isSelected ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 bg-gray-50'}`}
                        onPress={() => {
                          setMergeSelectedIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(String(e.id))) {
                              if (next.size <= 2) return prev;
                              next.delete(String(e.id));
                            } else {
                              next.add(String(e.id));
                            }
                            return next;
                          });
                        }}
                      >
                        <View className="flex-1 mr-2">
                          <Text className={`text-sm font-semibold ${isSelected ? 'text-indigo-600' : 'text-gray-700'}`}>
                            {e.unitTitle || e.unitName || e.unitCode}{isOwn ? ' (this)' : ''}
                          </Text>
                          {!!courseInfo && (
                            <Text className="text-xs text-gray-500" numberOfLines={1}>{courseInfo}</Text>
                          )}
                          <Text className="text-xs text-gray-400">{eTime} - {eRoom}</Text>
                        </View>
                        <View className={`w-6 h-6 rounded-md border-2 items-center justify-center ${isSelected ? 'border-indigo-500 bg-indigo-500' : 'border-gray-300 bg-white'}`}>
                          {isSelected && <Icon name="check" size={14} color="#FFF" />}
                        </View>
                      </TouchableOpacity>
                    );
                  })}

                  <Text className="text-base font-semibold text-gray-700 mt-3 mb-1">
                    Announcement note <Text className="font-normal text-gray-400">(optional)</Text>
                  </Text>
                  <TextInput
                    className="border border-gray-200 rounded-xl p-3 text-gray-800 bg-gray-50 min-h-[80px] text-base"
                    placeholder="e.g. All BSc CS and BSc IT students - same room, same time."
                    placeholderTextColor="#9CA3AF"
                    multiline
                    numberOfLines={3}
                    value={mergeNote}
                    onChangeText={setMergeNote}
                    maxLength={200}
                  />
                  <Text className="text-xs text-gray-400 text-right mt-1">{mergeNote.length}/200</Text>

                  {!!mergeRoomError && <Text className="text-red-500 text-sm mt-2 text-center">{mergeRoomError}</Text>}

                  <TouchableOpacity
                    className="bg-indigo-500 rounded-xl py-3.5 items-center mt-3"
                    onPress={handleFindRoomsForMerge}
                    disabled={mergeSearchingRooms}
                  >
                    {mergeSearchingRooms ? (
                      <ActivityIndicator color="#FFF" size="small" />
                    ) : (
                      <Text className="text-white text-base font-bold">Find Available Room</Text>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity className="border border-gray-200 rounded-xl py-3 items-center mt-2" onPress={closeMergeModal}>
                    <Text className="text-gray-600 text-base font-semibold">Cancel</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <Text className="text-lg font-semibold text-indigo-600 mb-3 text-center">
                    {mergeModal.entry?.day} - {String(mergeModal.entry?.startTime || mergeModal.entry?.time || '').replace(/\s*[-].*$/, '').trim()} to {mergeModal.entry?.endTime || ''}
                  </Text>

                  {mergeAvailableRooms.length === 0 ? (
                    <View className="items-center py-6">
                      <Text className="text-base font-semibold text-gray-600">No rooms available for this slot.</Text>
                      <Text className="mt-1 text-sm text-gray-400">Consider rescheduling one of the sections first.</Text>
                    </View>
                  ) : (
                    <>
                      <TextInput
                        className="border border-gray-200 rounded-xl py-2.5 px-3 text-base text-gray-800 bg-gray-50 mb-2"
                        placeholder="Search rooms..."
                        placeholderTextColor="#9CA3AF"
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
                        className="max-h-60"
                        renderItem={({ item }) => {
                          const code = item.roomCode || item.room_code || item.name || item.code || 'Unknown';
                          const capacity = item.capacity || item.seats || null;
                          const building = item.building || item.block || '';
                          const isSelected = (mergeSelectedRoom?.id || mergeSelectedRoom?._id) === (item.id || item._id);
                          return (
                            <TouchableOpacity
                              className={`flex-row items-center justify-between border rounded-xl p-3 mb-2 ${isSelected ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 bg-gray-50'}`}
                              onPress={() => setMergeSelectedRoom(item)}
                            >
                              <View className="flex-1">
                                <Text className={`text-base font-bold ${isSelected ? 'text-indigo-600' : 'text-gray-800'}`}>{code}</Text>
                                <Text className="text-sm text-gray-500 mt-0.5">
                                  {building ? `${building} - ` : ''}{capacity ? `${capacity} seats` : ''}
                                </Text>
                              </View>
                              {isSelected && <Icon name="check-circle" size={20} color="#6366F1" />}
                            </TouchableOpacity>
                          );
                        }}
                      />
                    </>
                  )}

                  {!!mergeError && <Text className="text-red-500 text-sm mt-2 text-center">{mergeError}</Text>}

                  <TouchableOpacity
                    className={`rounded-xl py-3.5 items-center mt-3 ${(!mergeSelectedRoom || savingMerge) ? 'bg-gray-300' : 'bg-indigo-500'}`}
                    onPress={handleConfirmMerge}
                    disabled={!mergeSelectedRoom || savingMerge}
                  >
                    {savingMerge ? (
                      <ActivityIndicator color="#FFF" size="small" />
                    ) : (
                      <Text className="text-white text-base font-bold">Confirm Merge & Notify</Text>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity className="border border-gray-200 rounded-xl py-3 items-center mt-2" onPress={() => { setMergeStep(1); setMergeSelectedRoom(null); }}>
                    <Text className="text-gray-600 text-base font-semibold">Back</Text>
                  </TouchableOpacity>
                </>
              )}
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}