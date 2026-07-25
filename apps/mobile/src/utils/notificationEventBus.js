/**
 * notificationEventBus.js
 *
 * Two-tier notification routing:
 *   Foreground  — DeviceEventEmitter (instant, in-process)
 *   Background/killed — AsyncStorage dirty flag (read on next foreground resume)
 *
 * Screens subscribe with onTimetableUpdated / onNotificationReceived and call
 * their data-load functions immediately. The dirty flag covers the case where
 * an FCM arrives while the JS engine is not running a mounted component tree.
 */
import { DeviceEventEmitter } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ── Event names ───────────────────────────────────────────────────────────────
export const EVENTS = {
  TIMETABLE_UPDATED:     'MARKWISE_TIMETABLE_UPDATED',
  NOTIFICATION_RECEIVED: 'MARKWISE_NOTIFICATION_RECEIVED',
};

const TIMETABLE_DIRTY_KEY = 'markwise.timetable.dirty';

// ── FCM type → category ───────────────────────────────────────────────────────
const TIMETABLE_FCM_TYPES = new Set([
  'LESSON_CONFIRMED', 'LESSON_CANCELLED', 'LESSON_RESCHEDULED', 'LESSON_ONLINE',
  'MERGED_LESSON', 'UNMERGED_LESSON', 'meeting_invite', 'timetable',
]);

export const isTimetableType = (type) => TIMETABLE_FCM_TYPES.has(String(type || ''));

// ── Foreground emitters ───────────────────────────────────────────────────────
export const emitTimetableUpdated = (data) =>
  DeviceEventEmitter.emit(EVENTS.TIMETABLE_UPDATED, data || {});

export const emitNotificationReceived = (data) =>
  DeviceEventEmitter.emit(EVENTS.NOTIFICATION_RECEIVED, data || {});

// ── Foreground subscribers (return a subscription with .remove()) ─────────────
export const onTimetableUpdated = (handler) =>
  DeviceEventEmitter.addListener(EVENTS.TIMETABLE_UPDATED, handler);

export const onNotificationReceived = (handler) =>
  DeviceEventEmitter.addListener(EVENTS.NOTIFICATION_RECEIVED, handler);

// ── Dirty flag (persists across background / killed state) ────────────────────
export const setTimetableDirty  = () =>
  AsyncStorage.setItem(TIMETABLE_DIRTY_KEY, '1').catch(() => {});

export const clearTimetableDirty = () =>
  AsyncStorage.removeItem(TIMETABLE_DIRTY_KEY).catch(() => {});

export const isTimetableDirty = () =>
  AsyncStorage.getItem(TIMETABLE_DIRTY_KEY).then(v => v === '1').catch(() => false);
