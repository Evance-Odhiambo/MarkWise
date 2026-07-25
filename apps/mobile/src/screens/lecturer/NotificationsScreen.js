// src/screens/lecturer/NotificationsScreen.js
import React, { useState, useEffect, useCallback, useMemo, useRef, memo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Modal,
  TextInput,
  Alert,
  Animated,
  Dimensions,
  Vibration,
  Platform,
  ActivityIndicator,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/Ionicons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import OfflineBanner from '../../components/OfflineBanner';
import useInternetStatus from '../../hooks/useInternetStatus';

import { getLecturerSession } from '../../utils/authSession';
import { fetchMyLecturerTimetable } from '../../utils/lecturerTimetableApi';
import { sendNotification, scheduleNotification, getNotificationAnalytics, fetchAdminNotifications, markAdminNotificationRead } from '../../utils/notificationApi';
import sqliteStorage from '../../storage/sqliteStorage';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useColors } from '../../theme';
import colors from '../../theme/colors';

const TEMPLATE_STORAGE_KEY = 'markwise.lecturer.templates.v1';

const { width } = Dimensions.get('window');

// Notification Types Configuration
const NOTIFICATION_TYPES = [
  { id: 'announcement', label: 'Announcement', icon: 'megaphone', color: colors.primary, bg: colors.primary.soft, defaultTitle: 'Important Announcement', placeholder: 'Share important updates with your students...' },
  { id: 'reminder', label: 'Reminder', icon: 'alarm', color: colors.warning, bg: colors.warning.soft, defaultTitle: 'Reminder', placeholder: "Don't forget about..." },
  { id: 'deadline', label: 'Deadline', icon: 'hourglass', color: colors.danger, bg: colors.danger.soft, defaultTitle: 'Deadline Approaching', placeholder: 'The deadline for...' },
  { id: 'assignment', label: 'Assignment', icon: 'document-text', color: colors.purple, bg: colors.purple.soft, defaultTitle: 'New Assignment', placeholder: 'A new assignment has been posted...' },
  { id: 'event', label: 'Event', icon: 'calendar', color: colors.teal, bg: colors.teal.soft, defaultTitle: 'Upcoming Event', placeholder: 'Join us for...' },
  { id: 'grade', label: 'Grade Update', icon: 'school', color: colors.success, bg: colors.success.soft, defaultTitle: 'Grades Released', placeholder: 'Your grades have been updated...' },
];

// Admin Notification Types (for incoming notifications)
const ADMIN_NOTIFICATION_TYPES = {
  policy: { icon: 'document-text-outline', color: colors.info, label: 'Policy Update' },
  announcement: { icon: 'megaphone-outline', color: colors.primary, label: 'Announcement' },
  deadline: { icon: 'hourglass-outline', color: colors.danger, label: 'Deadline' },
  meeting: { icon: 'people-outline', color: colors.purple, label: 'Meeting' },
  training: { icon: 'school-outline', color: colors.teal, label: 'Training' },
  alert: { icon: 'alert-circle-outline', color: colors.warning, label: 'Alert' },
};

// Priority Levels
const PRIORITY_LEVELS = [
  { id: 'urgent', label: 'Urgent', color: colors.danger, icon: 'alert-circle', order: 0 },
  { id: 'high', label: 'High', color: colors.warning, icon: 'warning', order: 1 },
  { id: 'normal', label: 'Normal', color: colors.primary, icon: 'information-circle', order: 2 },
  { id: 'low', label: 'Low', color: colors.success, icon: 'checkmark-circle', order: 3 },
];

// Template Library
const TEMPLATES = [
  { id: 'class_cancellation', name: 'Class Cancellation', title: 'Class Cancelled', body: 'Due to unforeseen circumstances, today\'s class has been cancelled. Please check the portal for rescheduling details.' },
  { id: 'assignment_reminder', name: 'Assignment Reminder', title: 'Assignment Deadline Reminder', body: 'This is a reminder that the assignment is due on [DATE]. Please submit before the deadline.' },
  { id: 'exam_preparation', name: 'Exam Preparation', title: 'Exam Preparation Tips', body: 'As we approach the exam period, here are some important preparation tips...' },
  { id: 'venue_change', name: 'Venue Change', title: 'Venue Change Notification', body: 'Please note that today\'s class has been moved to [VENUE].' },
  { id: 'guest_lecture', name: 'Guest Lecture', title: 'Special Guest Lecture', body: 'We are pleased to announce a special guest lecture on [TOPIC] by [SPEAKER].' },
];

// ── Memoized Components ───────────────────────────────────────────────────

// Animated Card Component
const AnimatedCard = memo(({ children, delay = 0, style }) => {
  const scaleAnim = useRef(new Animated.Value(0.95)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

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
    <Animated.View style={[style, { transform: [{ scale: scaleAnim }], opacity: opacityAnim }]}>
      {children}
    </Animated.View>
  );
});

// Admin Notification Card (Incoming)
const AdminNotificationCard = memo(({ notification, onPress, onMarkRead, styles }) => {
  const type = ADMIN_NOTIFICATION_TYPES[notification.type] || ADMIN_NOTIFICATION_TYPES.announcement;
  const [isExpanded, setIsExpanded] = useState(false);
  
  const formatTimeAgo = (date) => {
    if (!date) return 'Unknown';
    const seconds = Math.floor((new Date() - new Date(date)) / 1000);
    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(date).toLocaleDateString();
  };

  return (
    <TouchableOpacity 
      style={[styles.adminNotificationCard, !notification.read && styles.adminNotificationUnread]} 
      onPress={() => setIsExpanded(!isExpanded)}
      activeOpacity={0.7}
    >
      <LinearGradient colors={[`${type.color.main}08`, 'transparent']} style={styles.adminNotificationGradient}>
        <View style={styles.adminNotificationHeader}>
          <View style={[styles.adminNotificationIcon, { backgroundColor: type.color.bg || `${type.color.main}20` }]}>
            <Icon name={type.icon} size={20} color={type.color.main} />
          </View>
          <View style={styles.adminNotificationInfo}>
            <View style={styles.adminNotificationTitleRow}>
              <Text style={styles.adminNotificationType}>{type.label}</Text>
              {!notification.read && <View style={styles.unreadDot} />}
            </View>
            <Text style={styles.adminNotificationTime}>{formatTimeAgo(notification.createdAt)}</Text>
          </View>
          <TouchableOpacity onPress={() => onMarkRead?.(notification)} style={styles.adminNotificationAction}>
            <Icon name={notification.read ? 'checkmark-done-circle' : 'ellipse-outline'} size={18} color={notification.read ? colors.success.main : colors.text.tertiary} />
          </TouchableOpacity>
        </View>

        <Text style={styles.adminNotificationTitle}>{notification.title}</Text>
        <Text style={styles.adminNotificationBody} numberOfLines={isExpanded ? undefined : 2}>
          {notification.body}
        </Text>
        
        {notification.priority === 'high' && (
          <View style={styles.adminPriorityBadge}>
            <Icon name="warning" size={12} color={colors.warning.main} />
            <Text style={styles.adminPriorityText}>High Priority</Text>
          </View>
        )}
        
        {notification.attachment && (
          <View style={styles.adminAttachment}>
            <Icon name="attach-outline" size={14} color={colors.text.tertiary} />
            <Text style={styles.adminAttachmentText}>Attachment available</Text>
          </View>
        )}
        
        {notification.actionRequired && (
          <TouchableOpacity style={styles.adminActionButton} onPress={() => onPress?.(notification)}>
            <LinearGradient colors={colors.primary.gradient} style={styles.adminActionGradient}>
              <Text style={styles.adminActionText}>Take Action</Text>
              <Icon name="arrow-forward" size={14} color="#FFF" />
            </LinearGradient>
          </TouchableOpacity>
        )}
      </LinearGradient>
    </TouchableOpacity>
  );
});

// Sent Notification Card Component
const SentNotificationCard = memo(({ notification, onPress, onDelete, onResend, onViewAnalytics, styles }) => {
  const type = NOTIFICATION_TYPES.find(t => t.id === notification.type) || NOTIFICATION_TYPES[0];
  const priority = PRIORITY_LEVELS.find(p => p.id === notification.priority) || PRIORITY_LEVELS[2];
  const [showAnalytics, setShowAnalytics] = useState(false);
  
  const formatTimeAgo = (date) => {
    if (!date) return 'Unknown';
    const seconds = Math.floor((new Date() - new Date(date)) / 1000);
    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(date).toLocaleDateString();
  };

  const getReadPercentage = () => {
    if (!notification.analytics) return 0;
    const { read = 0, delivered = 0 } = notification.analytics;
    if (delivered === 0) return 0;
    return Math.round((read / delivered) * 100);
  };

  return (
    <TouchableOpacity style={styles.sentNotificationCard} onPress={() => setShowAnalytics(!showAnalytics)} activeOpacity={0.7}>
      <LinearGradient colors={[`${type.color.main}08`, 'transparent']} style={styles.sentNotificationGradient}>
        <View style={styles.sentNotificationHeader}>
          <View style={[styles.sentNotificationIcon, { backgroundColor: type.bg }]}>
            <Icon name={type.icon} size={18} color={type.color.main} />
          </View>
          <View style={styles.sentNotificationHeaderInfo}>
            <View style={styles.sentNotificationTitleRow}>
              <Text style={styles.sentNotificationType}>{type.label}</Text>
              <View style={[styles.sentPriorityBadge, { backgroundColor: `${priority.color.main}20` }]}>
                <Icon name={priority.icon} size={10} color={priority.color.main} />
                <Text style={[styles.sentPriorityText, { color: priority.color.main }]}>{priority.label}</Text>
              </View>
            </View>
            <Text style={styles.sentNotificationTime}>{formatTimeAgo(notification.sentAt)}</Text>
          </View>
          <TouchableOpacity onPress={() => onDelete?.(notification)} style={styles.sentNotificationAction}>
            <Icon name="trash-outline" size={18} color={colors.text.tertiary} />
          </TouchableOpacity>
        </View>

        <Text style={styles.sentNotificationTitle}>{notification.title}</Text>
        <Text style={styles.sentNotificationBody} numberOfLines={showAnalytics ? undefined : 2}>{notification.body}</Text>

        <View style={styles.sentNotificationFooter}>
          <View style={styles.recipientChips}>
            <Icon name="people-outline" size={12} color={colors.text.tertiary} />
            <Text style={styles.recipientCount}>{notification.recipients?.length || 0} units</Text>
          </View>
          
          {notification.scheduledFor && (
            <View style={styles.scheduledBadge}>
              <Icon name="time-outline" size={10} color={colors.warning.main} />
              <Text style={styles.scheduledText}>Scheduled</Text>
            </View>
          )}

          {notification.analytics && (
            <TouchableOpacity onPress={() => onViewAnalytics?.(notification)} style={styles.analyticsBadge}>
              <Icon name="stats-chart-outline" size={10} color={colors.info.main} />
              <Text style={styles.analyticsText}>{getReadPercentage()}% read</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity onPress={() => onResend?.(notification)} style={styles.resendButton}>
            <Icon name="refresh-outline" size={14} color={colors.primary.main} />
            <Text style={styles.resendText}>Resend</Text>
          </TouchableOpacity>
        </View>
        
        {showAnalytics && notification.analytics && (
          <View style={styles.analyticsExpanded}>
            <View style={styles.analyticsRow}>
              <View style={styles.analyticsItem}>
                <Text style={styles.analyticsItemValue}>{notification.analytics.delivered || 0}</Text>
                <Text style={styles.analyticsItemLabel}>Delivered</Text>
              </View>
              <View style={styles.analyticsItem}>
                <Text style={styles.analyticsItemValue}>{notification.analytics.read || 0}</Text>
                <Text style={styles.analyticsItemLabel}>Read</Text>
              </View>
              <View style={styles.analyticsItem}>
                <Text style={styles.analyticsItemValue}>{notification.analytics.clicked || 0}</Text>
                <Text style={styles.analyticsItemLabel}>Clicked</Text>
              </View>
              <View style={styles.analyticsItem}>
                <Text style={styles.analyticsItemValue}>{getReadPercentage()}%</Text>
                <Text style={styles.analyticsItemLabel}>Rate</Text>
              </View>
            </View>
          </View>
        )}
      </LinearGradient>
    </TouchableOpacity>
  );
});

// Template Card Component
const TemplateCard = memo(({ template, onSelect, onDelete, onEdit, styles }) => (
  <TouchableOpacity style={styles.templateCard} onPress={() => onSelect(template)} activeOpacity={0.7}>
    <LinearGradient colors={[colors.surface.primary, 'transparent']} style={styles.templateGradient}>
      <View style={styles.templateHeader}>
        <Icon name="document-text-outline" size={20} color={colors.primary.main} />
        <View style={styles.templateActions}>
          <TouchableOpacity onPress={() => onEdit?.(template)} style={styles.templateAction}>
            <Icon name="create-outline" size={16} color={colors.text.secondary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => onDelete?.(template)} style={styles.templateAction}>
            <Icon name="trash-outline" size={16} color={colors.text.tertiary} />
          </TouchableOpacity>
        </View>
      </View>
      <Text style={styles.templateName}>{template.name}</Text>
      <Text style={styles.templatePreview} numberOfLines={2}>{template.body}</Text>
      <View style={styles.templateFooter}>
        <Text style={styles.templateUse}>Tap to use</Text>
        <Icon name="arrow-forward" size={12} color={colors.primary.main} />
      </View>
    </LinearGradient>
  </TouchableOpacity>
));

// Filter Chip Component
const FilterChip = memo(({ label, active, onPress, color = colors.primary.main, count, styles }) => (
  <TouchableOpacity
    style={[styles.filterChip, active && { backgroundColor: color, borderColor: color }]}
    onPress={onPress}
  >
    <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{label}</Text>
    {(count > 0) && !active && (
      <View style={styles.filterChipBadge}>
        <Text style={styles.filterChipBadgeText}>{count}</Text>
      </View>
    )}
  </TouchableOpacity>
));

// ── Main Component ─────────────────────────────────────────────────────────
export default function NotificationScreen() {
  const colorTheme = useColors();
  const C = useMemo(() => ({
    bg: colorTheme.background.secondary,
    bgSec: colorTheme.background.tertiary,
    surface: colorTheme.surface.primary,
    border: colorTheme.border.light,
    borderMedium: colorTheme.border.medium,
    primary: colorTheme.primary.main,
    primaryD: colorTheme.primary.dark,
    success: colorTheme.success.main,
    warning: colorTheme.warning.main,
    danger: colorTheme.danger.main,
    text: colorTheme.text.primary,
    textSec: colorTheme.text.secondary,
    textTer: colorTheme.text.muted,
  }), [colorTheme]);
  const styles = useMemo(() => makeStyles(C), [C]);

  const navigation = useNavigation();
  const { isOnline } = useInternetStatus();

  // State Management
  const [activeTab, setActiveTab] = useState('inbox');
  const [session, setSession] = useState(null);
  const [units, setUnits] = useState([]);
  const [unitsLoading, setUnitsLoading] = useState(true);
  const [selectedUnits, setSelectedUnits] = useState([]);
  const [messageType, setMessageType] = useState(NOTIFICATION_TYPES[0]);
  const [priority, setPriority] = useState(PRIORITY_LEVELS[2]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sentNotifications, setSentNotifications] = useState([]);
  const [adminNotifications, setAdminNotifications] = useState([]);
  const [statusReminders, setStatusReminders] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [analytics, setAnalytics] = useState(null);
  const [showSchedulePicker, setShowSchedulePicker] = useState(false);
  const [scheduledDate, setScheduledDate] = useState(null);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [templates, setTemplates] = useState(TEMPLATES);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [templateTitle, setTemplateTitle] = useState('');
  const [templateBody, setTemplateBody] = useState('');
  const [showComposeModal, setShowComposeModal] = useState(false);
  const [selectedNotification, setSelectedNotification] = useState(null);
  const [showNotificationDetail, setShowNotificationDetail] = useState(false);

  // Refs
  const scrollY = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(50)).current;

  // Header animation
  const headerOpacity = scrollY.interpolate({
    inputRange: [0, 100],
    outputRange: [1, 0.95],
    extrapolate: 'clamp',
  });

  // Animation on mount
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, friction: 8, tension: 40, useNativeDriver: true }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  // Load units
  const loadUnits = useCallback(async () => {
    setUnitsLoading(true);
    try {
      const s = await getLecturerSession();
      setSession(s);
      if (s?.token) {
        const tt = await fetchMyLecturerTimetable(s.token);
        const seen = new Set();
        const uniq = [];
        for (const e of (tt || [])) {
          const code = e.unitCode || e.unit_code || '';
          const name = e.unitName || e.unit_name || code;
          if (code && !seen.has(code)) {
            seen.add(code);
            uniq.push({ code, name });
          }
        }
        setUnits(uniq);
      }
    } catch (err) {
      console.warn('Failed to load units', err);
    } finally {
      setUnitsLoading(false);
    }
  }, []);

  // Load lesson status reminders written by AssignedTimetableScreen
  const loadStatusReminders = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem('markwise.lecturer.status_reminders.v1');
      if (raw) {
        const parsed = JSON.parse(raw);
        setStatusReminders(Array.isArray(parsed) ? parsed : []);
      } else {
        setStatusReminders([]);
      }
    } catch (_) {
      setStatusReminders([]);
    }
  }, []);

  // Load admin notifications
  const loadAdminNotifications = useCallback(async () => {
    try {
      const notifications = await fetchAdminNotifications();
      const adminNotifs = Array.isArray(notifications) ? notifications : [];
      setAdminNotifications(adminNotifs);
      const unread = adminNotifs.filter(n => !n.read).length;
      setUnreadCount(unread);
    } catch (err) {
      console.warn('Failed to load admin notifications', err);
      setAdminNotifications([]);
    }
  }, []);

  // Load sent notifications and analytics
  const loadData = useCallback(async () => {
    try {
      const cached = await sqliteStorage.getSentNotifications();
      if (cached?.length) setSentNotifications(cached);

      if (isOnline) {
        const analyticsData = await getNotificationAnalytics();
        setAnalytics(analyticsData);
        await loadAdminNotifications();
      }
    } catch (err) {
      console.error('Failed to load notifications', err);
    }
  }, [isOnline, loadAdminNotifications]);

  // Load saved templates from AsyncStorage on mount
  useEffect(() => {
    const loadTemplates = async () => {
      try {
        const raw = await AsyncStorage.getItem(TEMPLATE_STORAGE_KEY);
        if (raw) {
          const saved = JSON.parse(raw);
          if (Array.isArray(saved) && saved.length) setTemplates(saved);
        }
      } catch (_) {}
    };
    loadTemplates();
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadUnits();
      loadData();
      loadAdminNotifications();
      loadStatusReminders();
    }, [loadUnits, loadData, loadAdminNotifications, loadStatusReminders]),
  );

  // Mark admin notification as read
  const markAsRead = useCallback(async (notification) => {
    if (notification.read) return;
    try {
      await markAdminNotificationRead(notification.id);
      setAdminNotifications(prev =>
        prev.map(n => n.id === notification.id ? { ...n, read: true } : n)
      );
      setUnreadCount(prev => Math.max(0, prev - 1));
      Vibration.vibrate(50);
    } catch (_) {}
  }, []);

  // Template management
  const saveTemplate = useCallback(async (template) => {
    let updated;
    if (editingTemplate) {
      updated = templates.map(t => t.id === editingTemplate.id ? { ...template, id: editingTemplate.id } : t);
      setEditingTemplate(null);
    } else {
      updated = [...templates, { ...template, id: Date.now().toString() }];
    }
    setTemplates(updated);
    try {
      await AsyncStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(updated));
    } catch (_) {}
    Vibration.vibrate(50);
  }, [templates, editingTemplate]);

  const deleteTemplate = useCallback(async (template) => {
    Alert.alert('Delete Template', `Delete "${template.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const updated = templates.filter(t => t.id !== template.id);
          setTemplates(updated);
          try {
            await AsyncStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(updated));
          } catch (_) {}
          Vibration.vibrate(50);
        },
      },
    ]);
  }, [templates]);

  // Send notification
  const handleSend = useCallback(async () => {
    if (!title.trim()) {
      Alert.alert('Missing Title', 'Please enter a notification title.');
      return;
    }
    if (!body.trim()) {
      Alert.alert('Missing Message', 'Please write the message body.');
      return;
    }
    if (selectedUnits.length === 0) {
      Alert.alert('No Recipients', 'Select at least one unit to notify.');
      return;
    }

    setSending(true);
    try {
      const notificationData = {
        type: messageType.id,
        priority: priority.id,
        title: title.trim(),
        body: body.trim(),
        recipients: selectedUnits,
        data: {
          category: 'notification',
          severity: priority.id,
          sentBy: session?.name || session?.lecturerId || 'Lecturer',
        },
      };

      if (scheduledDate) {
        await scheduleNotification({
          ...notificationData,
          scheduledFor: scheduledDate.toISOString(),
        });
        Alert.alert('Scheduled', `Notification scheduled for ${scheduledDate.toLocaleString()}`);
      } else {
        await sendNotification(notificationData);
        Alert.alert('Sent', `Notification delivered to ${selectedUnits.length} unit${selectedUnits.length !== 1 ? 's' : ''}.`);
      }

      const record = {
        id: Date.now().toString(),
        ...notificationData,
        sentAt: new Date().toISOString(),
        scheduledFor: scheduledDate?.toISOString(),
        analytics: { delivered: selectedUnits.length, read: 0, clicked: 0 }
      };
      const updated = [record, ...sentNotifications].slice(0, 100);
      setSentNotifications(updated);
      await sqliteStorage.saveSentNotifications(updated);

      setTitle('');
      setBody('');
      setSelectedUnits([]);
      setScheduledDate(null);
      setMessageType(NOTIFICATION_TYPES[0]);
      setPriority(PRIORITY_LEVELS[2]);
      setShowComposeModal(false);
      Vibration.vibrate(100);
      
      // Confirm send with a local notification sound
      try {
        const { displayLocalNotification, CHANNELS } = require('../../utils/notificationService');
        const unitWord = selectedUnits.length !== 1 ? 'units' : 'unit';
        await displayLocalNotification({
          title: 'Notification Sent',
          body: `"${title.trim()}" delivered to ${selectedUnits.length} ${unitWord}.`,
          channelId: CHANNELS.lesson,
        });
      } catch (_) {}
    } catch (err) {
      Alert.alert('Send Failed', err?.message || 'Could not deliver the notification.');
    } finally {
      setSending(false);
    }
  }, [title, body, selectedUnits, messageType, priority, scheduledDate, session, sentNotifications]);

  // Filter sent notifications
  const filteredSentNotifications = useMemo(() => {
    let filtered = sentNotifications;
    if (filterType !== 'all') {
      filtered = filtered.filter(n => n.type === filterType);
    }
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(n =>
        n.title?.toLowerCase().includes(query) ||
        n.body?.toLowerCase().includes(query)
      );
    }
    return filtered;
  }, [sentNotifications, filterType, searchQuery]);

  // Filter admin notifications
  const filteredAdminNotifications = useMemo(() => {
    let filtered = adminNotifications;
    if (filterType === 'unread') {
      filtered = filtered.filter(n => !n.read);
    } else if (filterType !== 'all') {
      filtered = filtered.filter(n => n.type === filterType);
    }
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(n =>
        n.title?.toLowerCase().includes(query) ||
        n.body?.toLowerCase().includes(query)
      );
    }
    return filtered;
  }, [adminNotifications, filterType, searchQuery]);

  // Calculate dashboard stats
  const stats = useMemo(() => ({
    total: sentNotifications.length,
    scheduled: sentNotifications.filter(n => n.scheduledFor).length,
    readRate: analytics?.readRate || 0,
    engagement: analytics?.engagementRate || 0,
    unreadAdmin: unreadCount,
  }), [sentNotifications, analytics, unreadCount]);

  const adminFilterOptions = useMemo(() => [
    { id: 'all', label: 'All' },
    { id: 'unread', label: 'Unread', count: unreadCount },
    ...Object.entries(ADMIN_NOTIFICATION_TYPES).map(([key, value]) => ({
      id: key,
      label: value.label,
    })),
  ], [unreadCount]);

  return (
    <SafeAreaView style={styles.container}>
      <OfflineBanner />
      
      <Animated.ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={async () => {
              setIsRefreshing(true);
              await Promise.allSettled([loadData(), loadUnits(), loadAdminNotifications()]);
              setIsRefreshing(false);
            }}
            tintColor={colorTheme.primary.main}
            colors={[colorTheme.primary.main]}
          />
        }
      >
        {/* Header */}
        <Animated.View style={[styles.header, { opacity: headerOpacity }]}>
          <LinearGradient colors={colorTheme.primary.gradient} style={styles.headerGradient}>
            <View style={styles.headerContent}>
              <View>
                <Text style={styles.headerTitle}>Notification Center</Text>
                <Text style={styles.headerSubtitle}>Manage communications</Text>
              </View>
              <View style={styles.headerStats}>
                <View style={styles.headerStat}>
                  <Text style={styles.headerStatValue}>{stats.total}</Text>
                  <Text style={styles.headerStatLabel}>Sent</Text>
                </View>
                <View style={styles.headerDivider} />
                <View style={styles.headerStat}>
                  <Text style={styles.headerStatValue}>{stats.readRate}%</Text>
                  <Text style={styles.headerStatLabel}>Read Rate</Text>
                </View>
                <View style={styles.headerDivider} />
                <View style={styles.headerStat}>
                  <Text style={styles.headerStatValue}>{stats.unreadAdmin}</Text>
                  <Text style={styles.headerStatLabel}>Unread</Text>
                </View>
              </View>
            </View>
          </LinearGradient>
        </Animated.View>

        {/* Tab Bar */}
        <View style={styles.tabBar}>
          {[
            { id: 'inbox', label: 'Inbox', icon: 'mail-outline', badge: stats.unreadAdmin },
            { id: 'compose', label: 'Compose', icon: 'create-outline' },
            { id: 'sent', label: 'Sent', icon: 'paper-plane-outline', badge: stats.total },
            { id: 'templates', label: 'Templates', icon: 'albums-outline' },
          ].map(tab => (
            <TouchableOpacity
              key={tab.id}
              style={[styles.tab, activeTab === tab.id && styles.tabActive]}
              onPress={() => { setActiveTab(tab.id); setFilterType('all'); setSearchQuery(''); }}
            >
              <Icon name={tab.icon} size={18} color={activeTab === tab.id ? colorTheme.primary.main : colorTheme.text.tertiary} />
              <Text style={[styles.tabLabel, activeTab === tab.id && styles.tabLabelActive]}>{tab.label}</Text>
              {(tab.badge > 0) && (
                <View style={styles.tabBadge}>
                  <Text style={styles.tabBadgeText}>{tab.badge}</Text>
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>

        {/* Inbox Tab - Admin Notifications */}
        {activeTab === 'inbox' && (
          <>
            {/* Search and Filter */}
            <View style={styles.searchContainer}>
              <View style={styles.searchBox}>
                <Icon name="search" size={18} color={colorTheme.text.tertiary} />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search notifications..."
                  placeholderTextColor={colorTheme.text.tertiary}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                />
                {searchQuery !== '' && (
                  <TouchableOpacity onPress={() => setSearchQuery('')}>
                    <Icon name="close-circle" size={18} color={colorTheme.text.tertiary} />
                  </TouchableOpacity>
                )}
              </View>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll}>
              <View style={styles.filterRow}>
                {adminFilterOptions.map(option => (
                  <FilterChip
                    key={option.id}
                    label={option.label}
                    active={filterType === option.id}
                    onPress={() => setFilterType(option.id)}
                    count={option.count}
                    styles={styles}
                  />
                ))}
              </View>
            </ScrollView>

            {/* Lesson Status Reminder Cards */}
            {statusReminders.length > 0 && (
              <View style={styles.reminderSection}>
                <View style={styles.reminderSectionHeader}>
                  <Icon name="warning" size={16} color={colorTheme.warning.main} />
                  <Text style={styles.reminderSectionTitle}>Action Required</Text>
                </View>
                {statusReminders.map(reminder => (
                  <TouchableOpacity
                    key={reminder.id}
                    style={styles.reminderCard}
                    activeOpacity={0.8}
                    onPress={() => navigation.navigate('Timetable')}
                  >
                    <LinearGradient
                      colors={[colorTheme.warning.soft, 'transparent']}
                      style={styles.reminderGradient}
                    >
                      <View style={styles.reminderIconRow}>
                        <View style={styles.reminderIconBadge}>
                          <Icon name="alarm" size={20} color={colorTheme.warning.main} />
                        </View>
                        <View style={styles.reminderUrgencyBadge}>
                          <Text style={[
                            styles.reminderUrgencyText,
                            reminder.urgency === 'today' && styles.reminderUrgencyToday,
                          ]}>
                            {reminder.urgency === 'today' ? 'TODAY' : 'TOMORROW'}
                          </Text>
                        </View>
                      </View>
                      <Text style={styles.reminderTitle}>
                        {reminder.unitCode} - {reminder.unitName}
                      </Text>
                      <Text style={styles.reminderBody}>
                        This lesson is still Pending. Please Confirm, Cancel, or Reschedule it so students can be informed in time.
                      </Text>
                      {reminder.time ? (
                        <View style={styles.reminderTimeRow}>
                          <Icon name="time-outline" size={13} color={colorTheme.text.tertiary} />
                          <Text style={styles.reminderTime}>{reminder.day}  {reminder.time}</Text>
                        </View>
                      ) : null}
                      <View style={styles.reminderCTA}>
                        <Text style={styles.reminderCTAText}>Tap to update status</Text>
                        <Icon name="arrow-forward" size={14} color={colorTheme.warning.main} />
                      </View>
                    </LinearGradient>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {filteredAdminNotifications.length === 0 && statusReminders.length === 0 ? (
              <View style={styles.emptyState}>
                <Icon name="mail-outline" size={48} color={colorTheme.text.tertiary} />
                <Text style={styles.emptyTitle}>No messages</Text>
                <Text style={styles.emptyText}>Your inbox is empty</Text>
              </View>
            ) : filteredAdminNotifications.length === 0 ? null : (
              filteredAdminNotifications.map(notification => (
                <AdminNotificationCard
                  key={notification.id}
                  notification={notification}
                  onMarkRead={markAsRead}
                  styles={styles}
                  onPress={() => {
                    setSelectedNotification(notification);
                    setShowNotificationDetail(true);
                  }}
                />
              ))
            )}
          </>
        )}

        {/* Compose Tab - Quick Compose Button */}
        {activeTab === 'compose' && (
          <AnimatedCard delay={100} style={styles.composeCard}>
            <LinearGradient colors={[colorTheme.surface.primary, 'transparent']} style={styles.composeGradient}>
              <TouchableOpacity
                style={styles.composeButton}
                onPress={() => setShowComposeModal(true)}
              >
                <LinearGradient colors={colorTheme.primary.gradient} style={styles.composeButtonGradient}>
                  <Icon name="create-outline" size={24} color="#FFF" />
                  <Text style={styles.composeButtonText}>Create New Notification</Text>
                  <Icon name="arrow-forward" size={20} color="#FFF" />
                </LinearGradient>
              </TouchableOpacity>
              
              <View style={styles.composeTips}>
                <Text style={styles.composeTipsTitle}>💡 Pro Tips</Text>
                <View style={styles.composeTipItem}>
                  <Icon name="checkbox-outline" size={14} color={colorTheme.success.main} />
                  <Text style={styles.composeTipText}>Use templates for frequent announcements</Text>
                </View>
                <View style={styles.composeTipItem}>
                  <Icon name="time-outline" size={14} color={colorTheme.warning.main} />
                  <Text style={styles.composeTipText}>Schedule notifications for optimal timing</Text>
                </View>
                <View style={styles.composeTipItem}>
                  <Icon name="stats-chart-outline" size={14} color={colorTheme.info.main} />
                  <Text style={styles.composeTipText}>Track read rates to improve engagement</Text>
                </View>
              </View>
            </LinearGradient>
          </AnimatedCard>
        )}

        {/* Sent Notifications Tab */}
        {activeTab === 'sent' && (
          <>
            {/* Search and Filter */}
            <View style={styles.searchContainer}>
              <View style={styles.searchBox}>
                <Icon name="search" size={18} color={colorTheme.text.tertiary} />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search sent notifications..."
                  placeholderTextColor={colorTheme.text.tertiary}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                />
                {searchQuery !== '' && (
                  <TouchableOpacity onPress={() => setSearchQuery('')}>
                    <Icon name="close-circle" size={18} color={colorTheme.text.tertiary} />
                  </TouchableOpacity>
                )}
              </View>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll}>
              <View style={styles.filterRow}>
                <FilterChip label="All" active={filterType === 'all'} onPress={() => setFilterType('all')} styles={styles} />
                {NOTIFICATION_TYPES.slice(0, 3).map(type => (
                  <FilterChip
                    key={type.id}
                    label={type.label}
                    active={filterType === type.id}
                    onPress={() => setFilterType(type.id)}
                    color={type.color.main}
                    styles={styles}
                  />
                ))}
              </View>
            </ScrollView>

            {filteredSentNotifications.length === 0 ? (
              <View style={styles.emptyState}>
                <Icon name="send-outline" size={48} color={colorTheme.text.tertiary} />
                <Text style={styles.emptyTitle}>No notifications sent</Text>
                <Text style={styles.emptyText}>Your sent notifications will appear here</Text>
                <TouchableOpacity style={styles.emptyButton} onPress={() => setShowComposeModal(true)}>
                  <Text style={styles.emptyButtonText}>Compose First</Text>
                </TouchableOpacity>
              </View>
            ) : (
              filteredSentNotifications.map(notification => (
                <SentNotificationCard
                  key={notification.id}
                  notification={notification}
                  styles={styles}
                  onDelete={() => {
                    const updated = sentNotifications.filter(n => n.id !== notification.id);
                    setSentNotifications(updated);
                    sqliteStorage.saveSentNotifications(updated);
                  }}
                  onResend={() => {
                    setTitle(notification.title || '');
                    setBody(notification.body || '');
                    setMessageType(NOTIFICATION_TYPES.find(t => t.id === notification.type) || NOTIFICATION_TYPES[0]);
                    setPriority(PRIORITY_LEVELS.find(p => p.id === notification.priority) || PRIORITY_LEVELS[2]);
                    setSelectedUnits(Array.isArray(notification.recipients) ? notification.recipients : []);
                    setShowComposeModal(true);
                  }}
                  onViewAnalytics={(notif) => {
                    setSelectedNotification(notif);
                    setShowNotificationDetail(true);
                  }}
                />
              ))
            )}
          </>
        )}

        {/* Templates Tab */}
        {activeTab === 'templates' && (
          <>
            <TouchableOpacity style={styles.addTemplateButton} onPress={() => {
              setEditingTemplate(null);
              setTemplateTitle('');
              setTemplateBody('');
              setShowTemplateModal(true);
            }}>
              <LinearGradient colors={colorTheme.primary.gradient} style={styles.addTemplateGradient}>
                <Icon name="add" size={20} color="#FFF" />
                <Text style={styles.addTemplateText}>Create New Template</Text>
              </LinearGradient>
            </TouchableOpacity>

            {templates.length === 0 ? (
              <View style={styles.emptyState}>
                <Icon name="albums-outline" size={48} color={colorTheme.text.tertiary} />
                <Text style={styles.emptyTitle}>No templates yet</Text>
                <Text style={styles.emptyText}>Create templates to save time</Text>
              </View>
            ) : (
              <View style={styles.templatesGrid}>
                {templates.map(template => (
                  <TemplateCard
                    key={template.id}
                    template={template}
                    styles={styles}
                    onSelect={(t) => {
                      setTitle(t.title || '');
                      setBody(t.body || '');
                      setActiveTab('compose');
                      setFilterType('all');
                      setSearchQuery('');
                      setShowComposeModal(true);
                      Vibration.vibrate(50);
                    }}
                    onEdit={(t) => {
                      setEditingTemplate(t);
                      setTemplateTitle(t.name);
                      setTemplateBody(t.body);
                      setShowTemplateModal(true);
                    }}
                    onDelete={deleteTemplate}
                  />
                ))}
              </View>
            )}
          </>
        )}
      </Animated.ScrollView>

      {/* Compose Modal */}
      <Modal visible={showComposeModal} transparent animationType="slide" onRequestClose={() => setShowComposeModal(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={styles.composeModalContent}>
            <LinearGradient colors={colorTheme.primary.gradient} style={styles.composeModalHeader}>
              <Text style={styles.composeModalTitle}>New Notification</Text>
              <TouchableOpacity onPress={() => setShowComposeModal(false)}>
                <Icon name="close" size={24} color="#FFF" />
              </TouchableOpacity>
            </LinearGradient>
            
            <ScrollView style={styles.composeModalBody} showsVerticalScrollIndicator={false}>
              {/* Message Type Selection */}
              <Text style={styles.sectionLabel}>Message Type</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.typeScroll}>
                <View style={styles.typeRow}>
                  {NOTIFICATION_TYPES.map(type => (
                    <TouchableOpacity
                      key={type.id}
                      style={[styles.typeChip, messageType.id === type.id && { backgroundColor: type.color.main, borderColor: type.color.main }]}
                      onPress={() => setMessageType(type)}
                    >
                      <Icon name={type.icon} size={14} color={messageType.id === type.id ? '#FFF' : type.color.main} />
                      <Text style={[styles.typeChipText, messageType.id === type.id && { color: '#FFF' }]}>{type.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>

              {/* Priority Selection */}
              <Text style={styles.sectionLabel}>Priority Level</Text>
              <View style={styles.priorityRow}>
                {PRIORITY_LEVELS.map(p => (
                  <TouchableOpacity
                    key={p.id}
                    style={[styles.priorityChip, priority.id === p.id && { backgroundColor: p.color.main, borderColor: p.color.main }]}
                    onPress={() => setPriority(p)}
                  >
                    <Icon name={p.icon} size={12} color={priority.id === p.id ? '#FFF' : p.color.main} />
                    <Text style={[styles.priorityChipText, priority.id === p.id && { color: '#FFF' }]}>{p.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Unit Selection */}
              <Text style={styles.sectionLabel}>Recipients</Text>
              {unitsLoading ? (
                <ActivityIndicator color={colorTheme.primary.main} style={styles.loader} />
              ) : units.length === 0 ? (
                <Text style={styles.hintText}>No units found. Ensure you have timetable entries.</Text>
              ) : (
                <>
                  <View style={styles.unitActions}>
                    <TouchableOpacity onPress={() => setSelectedUnits(units.map(u => u.code))}>
                      <Text style={styles.unitActionText}>Select All</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setSelectedUnits([])}>
                      <Text style={styles.unitActionText}>Clear</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={styles.unitGrid}>
                    {units.map(unit => (
                      <TouchableOpacity
                        key={unit.code}
                        style={[styles.unitChip, selectedUnits.includes(unit.code) && styles.unitChipSelected]}
                        onPress={() => setSelectedUnits(prev =>
                          prev.includes(unit.code) ? prev.filter(c => c !== unit.code) : [...prev, unit.code]
                        )}
                      >
                        <Icon name={selectedUnits.includes(unit.code) ? 'checkbox' : 'square-outline'} size={16} color={selectedUnits.includes(unit.code) ? colorTheme.primary.main : colorTheme.text.tertiary} />
                        <Text style={[styles.unitCode, selectedUnits.includes(unit.code) && styles.unitCodeSelected]}>{unit.code}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}

              {/* Title Input */}
              <Text style={styles.sectionLabel}>Title</Text>
              <TextInput
                style={styles.input}
                placeholder={messageType.defaultTitle}
                placeholderTextColor={colorTheme.text.tertiary}
                value={title}
                onChangeText={setTitle}
                maxLength={100}
              />

              {/* Body Input */}
              <Text style={styles.sectionLabel}>Message</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder={messageType.placeholder}
                placeholderTextColor={colorTheme.text.tertiary}
                value={body}
                onChangeText={setBody}
                multiline
                numberOfLines={5}
                maxLength={500}
                textAlignVertical="top"
              />
              <Text style={styles.charCount}>{body.length}/500</Text>

              {/* Schedule Option */}
              <View style={styles.scheduleRow}>
                <TouchableOpacity style={styles.scheduleButton} onPress={() => setShowSchedulePicker(true)}>
                  <Icon name="calendar-outline" size={18} color={colorTheme.primary.main} />
                  <Text style={styles.scheduleButtonText}>
                    {scheduledDate ? `Scheduled: ${scheduledDate.toLocaleString()}` : 'Schedule for later'}
                  </Text>
                </TouchableOpacity>
                {scheduledDate && (
                  <TouchableOpacity onPress={() => setScheduledDate(null)}>
                    <Icon name="close-circle" size={18} color={colorTheme.danger.main} />
                  </TouchableOpacity>
                )}
              </View>

              {/* Send Button */}
              <TouchableOpacity
                style={[styles.sendButton, (!isOnline || sending) && styles.sendButtonDisabled]}
                onPress={handleSend}
                disabled={sending || !isOnline}
              >
                <LinearGradient colors={sending || !isOnline ? ['#374151', '#374151'] : colorTheme.success.gradient} style={styles.sendGradient}>
                  {sending ? (
                    <ActivityIndicator color="#FFF" size="small" />
                  ) : (
                    <>
                      <Icon name={scheduledDate ? "calendar" : "send"} size={18} color="#FFF" />
                      <Text style={styles.sendButtonText}>
                        {sending ? 'Sending...' : scheduledDate ? 'Schedule Notification' : 'Send Notification'}
                      </Text>
                    </>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Schedule Date Picker Modal */}
      {showSchedulePicker && (
        <DateTimePicker
          value={scheduledDate || new Date()}
          mode="datetime"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(event, selectedDate) => {
            setShowSchedulePicker(false);
            if (selectedDate && selectedDate > new Date()) {
              setScheduledDate(selectedDate);
            }
          }}
        />
      )}

      {/* Template Creation/Edit Modal */}
      <Modal visible={showTemplateModal} transparent animationType="slide" onRequestClose={() => setShowTemplateModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <LinearGradient colors={colorTheme.primary.gradient} style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editingTemplate ? 'Edit Template' : 'Create Template'}</Text>
              <TouchableOpacity onPress={() => setShowTemplateModal(false)}>
                <Icon name="close" size={24} color="#FFF" />
              </TouchableOpacity>
            </LinearGradient>
            
            <View style={styles.modalBody}>
              <Text style={styles.modalLabel}>Template Name</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="e.g., Assignment Reminder"
                placeholderTextColor={colorTheme.text.tertiary}
                value={templateTitle}
                onChangeText={setTemplateTitle}
              />

              <Text style={styles.modalLabel}>Template Content</Text>
              <TextInput
                style={[styles.modalInput, styles.modalTextArea]}
                placeholder="Write your template content..."
                placeholderTextColor={colorTheme.text.tertiary}
                value={templateBody}
                onChangeText={setTemplateBody}
                multiline
                numberOfLines={4}
              />

              <TouchableOpacity
                style={styles.modalButton}
                onPress={() => {
                  if (templateTitle && templateBody) {
                    saveTemplate({ name: templateTitle, title: templateTitle, body: templateBody });
                    setShowTemplateModal(false);
                    setTemplateTitle('');
                    setTemplateBody('');
                    setEditingTemplate(null);
                  } else {
                    Alert.alert('Missing Info', 'Please enter both name and content.');
                  }
                }}
              >
                <LinearGradient colors={colorTheme.success.gradient} style={styles.modalButtonGradient}>
                  <Text style={styles.modalButtonText}>{editingTemplate ? 'Update Template' : 'Save Template'}</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Notification Detail Modal */}
      <Modal visible={showNotificationDetail} transparent animationType="slide" onRequestClose={() => setShowNotificationDetail(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.detailModalContent}>
            <LinearGradient colors={colorTheme.primary.gradient} style={styles.detailModalHeader}>
              <Text style={styles.detailModalTitle}>Notification Details</Text>
              <TouchableOpacity onPress={() => setShowNotificationDetail(false)}>
                <Icon name="close" size={24} color="#FFF" />
              </TouchableOpacity>
            </LinearGradient>
            
            {selectedNotification && (
              <ScrollView style={styles.detailModalBody}>
                <View style={styles.detailTypeBadge}>
                  <Icon name={selectedNotification.type === 'admin' ? 'business-outline' : 'megaphone-outline'} size={16} color={colorTheme.primary.main} />
                  <Text style={styles.detailTypeText}>
                    {selectedNotification.type === 'admin' ? 'Admin Message' : 'Sent Notification'}
                  </Text>
                </View>
                
                <Text style={styles.detailTitle}>{selectedNotification.title}</Text>
                <Text style={styles.detailDate}>
                  {new Date(selectedNotification.sentAt || selectedNotification.createdAt).toLocaleString()}
                </Text>
                <Text style={styles.detailBody}>{selectedNotification.body}</Text>
                
                {selectedNotification.recipients && selectedNotification.recipients.length > 0 && (
                  <View style={styles.detailRecipients}>
                    <Text style={styles.detailRecipientsTitle}>Recipients</Text>
                    <View style={styles.detailRecipientsList}>
                      {selectedNotification.recipients.map(code => (
                        <View key={code} style={styles.detailRecipientChip}>
                          <Text style={styles.detailRecipientText}>{code}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                )}
                
                {selectedNotification.analytics && (
                  <View style={styles.detailAnalytics}>
                    <Text style={styles.detailAnalyticsTitle}>Performance</Text>
                    <View style={styles.detailAnalyticsGrid}>
                      <View style={styles.detailAnalyticsItem}>
                        <Text style={styles.detailAnalyticsValue}>{selectedNotification.analytics.delivered || 0}</Text>
                        <Text style={styles.detailAnalyticsLabel}>Delivered</Text>
                      </View>
                      <View style={styles.detailAnalyticsItem}>
                        <Text style={styles.detailAnalyticsValue}>{selectedNotification.analytics.read || 0}</Text>
                        <Text style={styles.detailAnalyticsLabel}>Read</Text>
                      </View>
                      <View style={styles.detailAnalyticsItem}>
                        <Text style={styles.detailAnalyticsValue}>{selectedNotification.analytics.clicked || 0}</Text>
                        <Text style={styles.detailAnalyticsLabel}>Clicked</Text>
                      </View>
                    </View>
                  </View>
                )}
                
                <TouchableOpacity style={styles.detailCloseButton} onPress={() => setShowNotificationDetail(false)}>
                  <Text style={styles.detailCloseText}>Close</Text>
                </TouchableOpacity>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = (C) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  scrollView: { flex: 1 },
  content: { paddingBottom: 24 },
  
  // Header
  header: { marginHorizontal: 16, marginTop: 8, marginBottom: 16 },
  headerGradient: { borderRadius: 20, padding: 20 },
  headerContent: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerTitle: { fontSize: 24, fontWeight: '800', color: '#FFF', marginBottom: 4 },
  headerSubtitle: { fontSize: 12, color: 'rgba(255,255,255,0.8)' },
  headerStats: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerStat: { alignItems: 'center' },
  headerStatValue: { fontSize: 20, fontWeight: '800', color: '#FFF' },
  headerStatLabel: { fontSize: 10, color: 'rgba(255,255,255,0.7)' },
  headerDivider: { width: 1, height: 30, backgroundColor: 'rgba(255,255,255,0.2)' },
  
  // Tab Bar
  tabBar: { flexDirection: 'row', backgroundColor: C.surface, marginHorizontal: 16, marginBottom: 16, borderRadius: 12, padding: 4, borderWidth: 1, borderColor: C.borderMedium, elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4 },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 8 },
  tabActive: { backgroundColor: C.bgSec },
  tabLabel: { fontSize: 13, fontWeight: '500', color: C.textTer },
  tabLabelActive: { color: C.primary, fontWeight: '600' },
  tabBadge: { backgroundColor: C.primary, borderRadius: 10, paddingHorizontal: 5, paddingVertical: 1, marginLeft: 4 },
  tabBadgeText: { fontSize: 10, fontWeight: '700', color: '#FFF' },
  
  // Search & Filters
  searchContainer: { marginHorizontal: 16, marginBottom: 12 },
  searchBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: C.border },
  searchInput: { flex: 1, marginLeft: 8, fontSize: 14, color: C.text, padding: 0 },
  filterScroll: { marginHorizontal: 16, marginBottom: 12 },
  filterRow: { flexDirection: 'row', gap: 8, paddingVertical: 4 },
  filterChip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: colors.border.medium, backgroundColor: C.surface },
  filterChipText: { fontSize: 12, fontWeight: '600', color: C.textSec },
  filterChipTextActive: { color: '#FFF' },
  filterChipBadge: { backgroundColor: colors.danger.main, borderRadius: 10, paddingHorizontal: 4, paddingVertical: 1, marginLeft: 6 },
  filterChipBadgeText: { fontSize: 9, fontWeight: '700', color: '#FFF' },
  
  // Compose Card
  composeCard: { marginHorizontal: 16, marginBottom: 16, borderRadius: 16, overflow: 'hidden', backgroundColor: C.surface, borderWidth: 1, borderColor: C.borderMedium, elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 4 },
  composeGradient: { padding: 24, alignItems: 'center' },
  composeButton: { width: '100%', borderRadius: 12, overflow: 'hidden' },
  composeButtonGradient: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 18 },
  composeButtonText: { fontSize: 16, fontWeight: '700', color: '#FFF' },
  composeTips: { marginTop: 24, width: '100%' },
  composeTipsTitle: { fontSize: 14, fontWeight: '600', color: C.text, marginBottom: 12 },
  composeTipItem: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  composeTipText: { fontSize: 12, color: C.textSec, flex: 1 },
  
  // Compose Modal
  composeModalContent: { width: width - 32, backgroundColor: C.surface, borderRadius: 20, overflow: 'hidden', maxHeight: '85%' },
  composeModalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20 },
  composeModalTitle: { fontSize: 20, fontWeight: '700', color: '#FFF' },
  composeModalBody: { padding: 20 },
  
  // Admin Notification Card
  adminNotificationCard: { marginHorizontal: 16, marginBottom: 12, borderRadius: 12, overflow: 'hidden', backgroundColor: C.surface, borderWidth: 1, borderColor: C.borderMedium, elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 4 },
  adminNotificationUnread: { borderLeftWidth: 4, borderLeftColor: C.primary },
  adminNotificationGradient: { padding: 14 },
  adminNotificationHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  adminNotificationIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  adminNotificationInfo: { flex: 1 },
  adminNotificationTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  adminNotificationType: { fontSize: 13, fontWeight: '700', color: C.text },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.primary },
  adminNotificationTime: { fontSize: 11, color: C.textTer },
  adminNotificationAction: { padding: 4 },
  adminNotificationTitle: { fontSize: 16, fontWeight: '700', color: C.text, marginBottom: 6 },
  adminNotificationBody: { fontSize: 13, color: C.textSec, lineHeight: 18, marginBottom: 10 },
  adminPriorityBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.warning.soft, alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, marginBottom: 8 },
  adminPriorityText: { fontSize: 11, fontWeight: '600', color: colors.warning.main },
  adminAttachment: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  adminAttachmentText: { fontSize: 11, color: C.textTer },
  adminActionButton: { borderRadius: 8, overflow: 'hidden', marginTop: 6 },
  adminActionGradient: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 10 },
  adminActionText: { fontSize: 13, fontWeight: '600', color: '#FFF' },
  
  // Sent Notification Card
  sentNotificationCard: { marginHorizontal: 16, marginBottom: 12, borderRadius: 12, overflow: 'hidden', backgroundColor: C.surface, borderWidth: 1, borderColor: C.borderMedium, elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 4 },
  sentNotificationGradient: { padding: 14 },
  sentNotificationHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  sentNotificationIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  sentNotificationHeaderInfo: { flex: 1 },
  sentNotificationTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  sentNotificationType: { fontSize: 13, fontWeight: '700', color: C.text },
  sentPriorityBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  sentPriorityText: { fontSize: 9, fontWeight: '700' },
  sentNotificationTime: { fontSize: 11, color: C.textTer },
  sentNotificationAction: { padding: 4 },
  sentNotificationTitle: { fontSize: 15, fontWeight: '700', color: C.text, marginBottom: 4 },
  sentNotificationBody: { fontSize: 13, color: C.textSec, lineHeight: 18, marginBottom: 10 },
  sentNotificationFooter: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  recipientChips: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  recipientCount: { fontSize: 11, color: C.textTer },
  scheduledBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.warning.soft, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  scheduledText: { fontSize: 10, color: colors.warning.main, fontWeight: '600' },
  analyticsBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.info.soft, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  analyticsText: { fontSize: 10, color: colors.info.main, fontWeight: '600' },
  resendButton: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 2 },
  resendText: { fontSize: 10, color: C.primary, fontWeight: '600' },
  
  // Analytics Expanded
  analyticsExpanded: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.border },
  analyticsRow: { flexDirection: 'row', justifyContent: 'space-around' },
  analyticsItem: { alignItems: 'center' },
  analyticsItemValue: { fontSize: 18, fontWeight: '800', color: C.text },
  analyticsItemLabel: { fontSize: 10, color: C.textTer, marginTop: 2 },
  
  // Templates
  addTemplateButton: { marginHorizontal: 16, marginBottom: 16, borderRadius: 12, overflow: 'hidden' },
  addTemplateGradient: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12 },
  addTemplateText: { fontSize: 14, fontWeight: '600', color: '#FFF' },
  templatesGrid: { paddingHorizontal: 16, flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  templateCard: { width: (width - 44) / 2, backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.borderMedium, overflow: 'hidden', elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 4 },
  templateGradient: { padding: 12 },
  templateHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  templateActions: { flexDirection: 'row', gap: 8 },
  templateAction: { padding: 4 },
  templateName: { fontSize: 14, fontWeight: '700', color: C.text, marginBottom: 4 },
  templatePreview: { fontSize: 12, color: C.textSec, marginBottom: 8, lineHeight: 16 },
  templateFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  templateUse: { fontSize: 11, color: C.primary, fontWeight: '600' },
  
  // Compose Form Elements
  sectionLabel: { fontSize: 12, fontWeight: '700', color: C.textSec, textTransform: 'uppercase', marginBottom: 8, marginTop: 12 },
  typeScroll: { marginBottom: 4 },
  typeRow: { flexDirection: 'row', gap: 8, paddingVertical: 4 },
  typeChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: colors.border.medium, backgroundColor: C.bgSec },
  typeChipText: { fontSize: 13, fontWeight: '600', color: C.textSec },
  priorityRow: { flexDirection: 'row', gap: 8, marginBottom: 8, flexWrap: 'wrap' },
  priorityChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: colors.border.medium, backgroundColor: C.bgSec },
  priorityChipText: { fontSize: 12, fontWeight: '600', color: C.textSec },
  
  // Unit Selection
  unitActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginBottom: 8 },
  unitActionText: { fontSize: 12, color: C.primary, fontWeight: '600' },
  unitGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  unitChip: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: colors.border.medium, backgroundColor: C.bgSec },
  unitChipSelected: { borderColor: C.primary, backgroundColor: `${C.primary}20` },
  unitCode: { fontSize: 13, fontWeight: '600', color: C.textSec },
  unitCodeSelected: { color: C.primary },
  
  // Inputs
  input: { backgroundColor: C.bgSec, borderWidth: 1, borderColor: colors.border.medium, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, color: C.text, fontSize: 14, marginBottom: 8 },
  textArea: { minHeight: 100, textAlignVertical: 'top' },
  charCount: { fontSize: 11, color: C.textTer, textAlign: 'right', marginBottom: 8 },
  
  // Schedule
  scheduleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  scheduleButton: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  scheduleButtonText: { fontSize: 13, color: C.primary, fontWeight: '500' },
  
  // Send Button
  sendButton: { borderRadius: 12, overflow: 'hidden', marginTop: 8 },
  sendButtonDisabled: { opacity: 0.6 },
  sendGradient: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14 },
  sendButtonText: { fontSize: 15, fontWeight: '700', color: '#FFF' },
  
  // Empty State
  emptyState: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: C.text, marginTop: 12 },
  emptyText: { fontSize: 13, color: C.textTer, textAlign: 'center', marginTop: 4 },
  emptyButton: { marginTop: 20, backgroundColor: C.primary, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
  emptyButtonText: { fontSize: 14, fontWeight: '600', color: '#FFF' },
  
  // Modals
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { width: width - 32, backgroundColor: C.surface, borderRadius: 20, overflow: 'hidden' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#FFF' },
  modalBody: { padding: 20 },
  modalLabel: { fontSize: 13, fontWeight: '600', color: C.textSec, marginBottom: 6 },
  modalInput: { backgroundColor: C.bgSec, borderWidth: 1, borderColor: colors.border.medium, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: C.text, fontSize: 14, marginBottom: 16 },
  modalTextArea: { minHeight: 100, textAlignVertical: 'top' },
  modalButton: { borderRadius: 10, overflow: 'hidden', marginTop: 8 },
  modalButtonGradient: { paddingVertical: 12, alignItems: 'center' },
  modalButtonText: { fontSize: 14, fontWeight: '700', color: '#FFF' },
  
  // Detail Modal
  detailModalContent: { width: width - 32, backgroundColor: C.surface, borderRadius: 20, overflow: 'hidden', maxHeight: '80%' },
  detailModalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20 },
  detailModalTitle: { fontSize: 18, fontWeight: '700', color: '#FFF' },
  detailModalBody: { padding: 20 },
  detailTypeBadge: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, backgroundColor: `${C.primary}20`, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, marginBottom: 16 },
  detailTypeText: { fontSize: 12, fontWeight: '600', color: C.primary },
  detailTitle: { fontSize: 20, fontWeight: '700', color: C.text, marginBottom: 8 },
  detailDate: { fontSize: 12, color: C.textTer, marginBottom: 16 },
  detailBody: { fontSize: 14, color: C.textSec, lineHeight: 20, marginBottom: 20 },
  detailRecipients: { marginBottom: 20 },
  detailRecipientsTitle: { fontSize: 14, fontWeight: '600', color: C.text, marginBottom: 12 },
  detailRecipientsList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  detailRecipientChip: { backgroundColor: C.bgSec, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: C.border },
  detailRecipientText: { fontSize: 12, fontWeight: '600', color: C.textSec },
  detailAnalytics: { marginBottom: 20 },
  detailAnalyticsTitle: { fontSize: 14, fontWeight: '600', color: C.text, marginBottom: 12 },
  detailAnalyticsGrid: { flexDirection: 'row', justifyContent: 'space-around', backgroundColor: C.bgSec, padding: 16, borderRadius: 12 },
  detailAnalyticsItem: { alignItems: 'center' },
  detailAnalyticsValue: { fontSize: 24, fontWeight: '800', color: C.primary },
  detailAnalyticsLabel: { fontSize: 11, color: C.textTer, marginTop: 4 },
  detailCloseButton: { backgroundColor: C.bgSec, paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginTop: 8 },
  detailCloseText: { fontSize: 14, fontWeight: '600', color: C.textSec },
  
  // Helpers
  loader: { marginVertical: 20 },
  hintText: { fontSize: 13, color: C.textTer, fontStyle: 'italic', marginVertical: 8 },

  // Lesson status reminder cards
  reminderSection: { marginBottom: 8 },
  reminderSectionHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, marginBottom: 8, gap: 6 },
  reminderSectionTitle: { fontSize: 13, fontWeight: '700', color: colors.warning.main, textTransform: 'uppercase', letterSpacing: 0.5 },
  reminderCard: { borderRadius: 14, marginBottom: 10, borderWidth: 1, borderColor: `${colors.warning.main}40`, overflow: 'hidden' },
  reminderGradient: { padding: 14 },
  reminderIconRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 8 },
  reminderIconBadge: { width: 36, height: 36, borderRadius: 18, backgroundColor: `${colors.warning.main}20`, justifyContent: 'center', alignItems: 'center' },
  reminderUrgencyBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: `${colors.warning.main}25` },
  reminderUrgencyText: { fontSize: 11, fontWeight: '800', color: colors.warning.main, letterSpacing: 0.8 },
  reminderUrgencyToday: { color: colors.danger.main },
  reminderTitle: { fontSize: 15, fontWeight: '700', color: C.text, marginBottom: 4 },
  reminderBody: { fontSize: 13, color: C.textSec, lineHeight: 18, marginBottom: 8 },
  reminderTimeRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 10 },
  reminderTime: { fontSize: 12, color: C.textTer },
  reminderCTA: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  reminderCTAText: { fontSize: 13, fontWeight: '600', color: colors.warning.main },
});