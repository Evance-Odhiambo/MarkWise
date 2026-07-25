// C:\Users\evanc\Desktop\MarkWise\src\screens\lecturer\ClassManager\AssignmentsScreen.js
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Modal,
  FlatList,
  Animated,
  Platform,
  KeyboardAvoidingView,
  ScrollView,
  Switch,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fetchAssignments, fetchSubmissions, getAssignmentDetails, createAssignment, updateAssignment, deleteAssignment, cloneAssignment, getAssignmentAnalytics, gradeSubmission } from '../../../utils/assignmentsApiV2';
import { sendNotification } from '../../../utils/notificationApi';
import { writeAuditLog } from '../../../utils/auditLogApi';
import DateTimePicker from '@react-native-community/datetimepicker';
import ReactNativeBlobUtil from 'react-native-blob-util';
import FilePicker from '../../../components/FilePicker';

import Share from 'react-native-share';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import { useAuth } from '../../../context/AuthContext';
import { fetchLecturerUnits } from '../../../utils/unitsApi';
import { useColors } from '../../../theme';

const { height } = Dimensions.get('window');

// Per-unit cache — survives remounts and back-navigation.
// Keyed by unitId; each entry holds the fully enriched list and a timestamp.
const _assignmentsCache = new Map(); // unitId → { data: Assignment[], ts: number }
const ASSIGNMENTS_STALE_MS = 3 * 60 * 1000;

const toTitleCase = (str) =>
  str.toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());


// ─── Safe date formatters ────────────────────────────────────────────────────
const fmtDate = (val, fallback = '—') => {
  if (!val) return fallback;
  const d = new Date(val);
  return isNaN(d.getTime()) ? fallback : d.toLocaleDateString();
};
const fmtDateTime = (val, fallback = '—') => {
  if (!val) return fallback;
  const d = new Date(val);
  return isNaN(d.getTime()) ? fallback : d.toLocaleString();
};
const safeDate = (val) => {
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
};

// Normalize submissions from either API shape:
//   Individual: [{ id, studentId, studentName, ... }]
//   Group:      [{ groupId, groupName, memberCount, submission: { id, ... } }]
function normalizeSubmissions(rawSubs) {
  if (!Array.isArray(rawSubs)) return [];
  return rawSubs.map(item => {
    // Group shape: nested submission object, no top-level id
    if (item.submission && !item.id) {
      return {
        ...item.submission,
        id: item.submission.id,
        groupName: item.groupName ?? item.submission?.groupName,
        memberCount: item.memberCount,
        groupId: item.groupId,
      };
    }
    return item;
  });
}

// Submission Card with controlled grade/feedback inputs
const SubmissionCard = ({ sub, idx, assignmentId, maxScore, onGraded, styles, colors }) => {
  const [grade, setGrade] = useState(sub.grade != null ? String(sub.grade) : '');
  const [feedback, setFeedback] = useState(sub.feedback || '');
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [textExpanded, setTextExpanded] = useState(false);

  const submissionId = sub.id;

  // Normalise field names from either snake_case (DB) or camelCase (API transform)
  const subType    = sub.type || 'file';
  const subText    = sub.text    || sub.content    || sub.answer    || null;
  const subLink    = sub.linkUrl || sub.link_url   || sub.link      || null;
  const subFileUrl = sub.fileUrl || sub.file_url   || sub.downloadUrl || sub.download_url || null;
  const subFileName = sub.fileName || sub.file_name || sub.originalName || sub.original_name || 'file';

  const handleSaveGrade = async () => {
    if (saving) return;
    if (!submissionId) {
      console.warn('[AssignmentsScreen] No submission ID — student/group has not submitted yet');
      Alert.alert('No Submission', 'This student or group has not submitted yet.');
      return;
    }
    const parsedGrade = parseFloat(grade);
    if (isNaN(parsedGrade)) {
      Alert.alert('Invalid Grade', 'Please enter a valid number for the grade.');
      return;
    }
    const effectiveMax = maxScore ?? 100;
    if (parsedGrade > effectiveMax) {
      Alert.alert('Grade Too High', `Grade cannot exceed the maximum score of ${effectiveMax}.`);
      return;
    }
    if (parsedGrade < 0) {
      Alert.alert('Invalid Grade', 'Grade cannot be negative.');
      return;
    }
    const payload = { grade: parsedGrade, feedback };
    console.log('[AssignmentsScreen] Grade payload:', JSON.stringify(payload), 'submissionId:', submissionId);
    setSaving(true);
    try {
      await gradeSubmission(assignmentId, submissionId, payload);
      Alert.alert('Success', 'Grade saved successfully.');
      if (onGraded) onGraded();
    } catch (err) {
      Alert.alert('Error', err?.message || 'Failed to save grade.');
    } finally {
      setSaving(false);
    }
  };

  const handleViewSubmission = async () => {
    if (subType === 'text') {
      setTextExpanded(e => !e);
    } else {
      const url = subLink || subFileUrl;
      if (!url) { Alert.alert('No content', 'No viewable content attached to this submission.'); return; }
      const canOpen = await Linking.canOpenURL(url).catch(() => false);
      if (canOpen) {
        Linking.openURL(url);
      } else {
        Alert.alert('Cannot open', `URL: ${url}`);
      }
    }
  };

  const handleDownloadFile = async () => {
    if (!subFileUrl) {
      Alert.alert('No file', 'This submission has no attached file.');
      return;
    }
    setDownloading(true);
    try {
      const dest = `${ReactNativeBlobUtil.fs.dirs.DownloadDir}/${subFileName}`;
      const res = await ReactNativeBlobUtil
        .config({ fileCache: true, path: dest, addAndroidDownloads: { useDownloadManager: true, notification: true, title: subFileName, description: 'Assignment submission' } })
        .fetch('GET', subFileUrl);
      await Share.open({ url: Platform.OS === 'android' ? `file://${res.path()}` : res.path(), type: sub.mimeType || 'application/octet-stream', filename: subFileName }).catch(() => {});
    } catch (err) {
      Alert.alert('Download failed', err.message || 'Could not download file.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <LinearGradient
      key={sub.id || idx}
      colors={[colors.surface.primary, colors.surface.secondary]}
      style={styles.submissionCard}
    >
      <View style={styles.submissionHeader}>
        <View style={styles.submissionAvatar}>
          <Text style={styles.submissionAvatarText}>
            {sub.studentName?.charAt(0) || sub.groupName?.charAt(0) || '?'}
          </Text>
        </View>
        <View style={styles.submissionInfo}>
          <Text style={styles.submissionName}>
            {sub.studentName || sub.groupName || 'Unknown'}
          </Text>
          <Text style={styles.submissionDate}>
            {fmtDateTime(sub.submittedAt)}
          </Text>
        </View>
        <View style={[
          styles.submissionVersion,
          { backgroundColor: sub.late ? colors.warning.soft : colors.success.soft }
        ]}>
          <Text style={[
            styles.submissionVersionText,
            { color: sub.late ? colors.warning.main : colors.success.main }
          ]}>
            v{sub.version}
          </Text>
        </View>
      </View>

      {/* Submission Content */}
      <View style={styles.submissionContent}>
        {subType === 'text' && subText ? (
          <>
            <View style={styles.submissionContentHeader}>
              <Icon name="text" size={14} color={colors.info.main} />
              <Text style={styles.submissionContentLabel}>Text Answer</Text>
              <TouchableOpacity onPress={() => setTextExpanded(e => !e)}>
                <Icon name={textExpanded ? 'chevron-up' : 'chevron-down'} size={16} color={colors.text.secondary} />
              </TouchableOpacity>
            </View>
            <Text style={styles.submissionContentText} numberOfLines={textExpanded ? undefined : 3}>
              {subText}
            </Text>
          </>
        ) : subType === 'link' && subLink ? (
          <View style={styles.submissionContentHeader}>
            <Icon name="link" size={14} color={colors.info.main} />
            <Text style={[styles.submissionContentLabel, { flex: 1 }]} numberOfLines={1}>{subLink}</Text>
          </View>
        ) : subFileUrl || subFileName ? (
          <View style={styles.submissionContentHeader}>
            <Icon name="file-document-outline" size={14} color={colors.info.main} />
            <Text style={[styles.submissionContentLabel, { flex: 1 }]} numberOfLines={1}>{subFileName}</Text>
          </View>
        ) : (
          <View style={styles.submissionContentHeader}>
            <Icon name="alert-circle-outline" size={14} color={colors.text.tertiary} />
            <Text style={[styles.submissionContentLabel, { color: colors.text.tertiary }]}>No content details available</Text>
          </View>
        )}
      </View>

      <View style={styles.gradingSection}>
        <TextInput
          style={styles.gradeInput}
          placeholder="Grade"
          placeholderTextColor={colors.text.tertiary}
          value={grade}
          onChangeText={setGrade}
          keyboardType="numeric"
        />
        <TextInput
          style={styles.feedbackInput}
          placeholder="Feedback"
          placeholderTextColor={colors.text.tertiary}
          value={feedback}
          onChangeText={setFeedback}
          multiline
          textAlignVertical="top"
        />

        <View style={styles.submissionActions}>
          <TouchableOpacity style={[styles.saveButton, !submissionId && { opacity: 0.4 }]} onPress={handleSaveGrade} disabled={saving || !submissionId}>
            <LinearGradient
              colors={colors.primary.gradient}
              style={styles.saveButtonGradient}
            >
              {saving
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={styles.saveButtonText}>Save Grade</Text>}
            </LinearGradient>
          </TouchableOpacity>

          <TouchableOpacity style={styles.viewButton} onPress={handleViewSubmission}>
            <LinearGradient
              colors={[colors.info.soft, 'transparent']}
              style={styles.viewButtonGradient}
            >
              <Icon name={subType === 'text' ? (textExpanded ? 'eye-off' : 'eye') : 'open-in-new'} size={20} color={colors.info.main} />
            </LinearGradient>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.downloadButton, !subFileUrl && { opacity: 0.3 }]}
            onPress={handleDownloadFile}
            disabled={!subFileUrl || downloading}
          >
            <LinearGradient
              colors={[colors.success.soft, 'transparent']}
              style={styles.downloadButtonGradient}
            >
              {downloading
                ? <ActivityIndicator size="small" color={colors.success.main} />
                : <Icon name="download" size={20} color={colors.success.main} />}
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    </LinearGradient>
  );
};

// Enhanced Assignment Card with More Features
const EnhancedAssignmentCard = ({ assignment, onPress, onDelete, onClone, onAnalytics, styles, colors }) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const [showMenu, setShowMenu] = useState(false);

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.98,
      useNativeDriver: true,
      tension: 150,
      friction: 3,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      tension: 150,
      friction: 3,
    }).start();
  };

  const getDueStatus = () => {
    const now = new Date();
    const due = safeDate(assignment.dueDate);
    const diffHours = due ? Math.ceil((due - now) / (1000 * 60 * 60)) : null;

    if (assignment.closed) {
      return {
        label: 'Closed',
        color: colors.text.secondary,
        icon: 'lock',
        gradient: colors.surface.gradient
      };
    }
    if (diffHours === null) return {
      label: 'No due date',
      color: colors.text.secondary,
      icon: 'clock-outline',
      gradient: colors.surface.gradient,
    };
    if (diffHours < 0) return {
      label: 'Overdue',
      color: colors.danger.main,
      icon: 'alert-circle',
      gradient: colors.danger.gradient
    };
    if (diffHours < 24) return {
      label: 'Due today',
      color: colors.warning.main,
      icon: 'clock-alert',
      gradient: colors.warning.gradient
    };
    if (diffHours < 48) return {
      label: 'Due tomorrow',
      color: colors.warning.main,
      icon: 'clock',
      gradient: colors.warning.gradient
    };
    return {
      label: `${Math.ceil(diffHours / 24)} days left`,
      color: colors.success.main,
      icon: 'clock-outline',
      gradient: colors.success.gradient
    };
  };

  const status = getDueStatus();
  const progress = ((assignment.submissions || 0) / (assignment.totalStudents || 1)) * 100;
  const gradedCount = assignment.gradedCount || 0;
  const gradingProgress = (gradedCount / (assignment.submissions || 1)) * 100;

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity
        style={styles.assignmentCard}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={0.9}
        onLongPress={() => setShowMenu(true)}
      >
        <View style={styles.assignmentHeader}>
          <View style={styles.assignmentTitleContainer}>
            <LinearGradient
              colors={[colors.primary.soft, 'transparent']}
              style={styles.courseBadge}
            >
              <Text style={styles.courseBadgeText}>{assignment.courseCode}</Text>
            </LinearGradient>
            <Text style={styles.assignmentTitle} numberOfLines={2}>{assignment.title}</Text>
          </View>

          <View style={styles.assignmentBadges}>
            <LinearGradient
              colors={[status.color + '20', 'transparent']}
              style={styles.dueBadge}
            >
              <Icon name={status.icon} size={12} color={status.color} />
              <Text style={[styles.dueText, { color: status.color }]}>{status.label}</Text>
            </LinearGradient>

            {assignment.isGroup && (
              <View style={styles.groupIndicator}>
                <Icon name="account-group" size={14} color={colors.info.main} />
                <Text style={styles.groupIndicatorText}>Group</Text>
              </View>
            )}
          </View>
        </View>

        <View style={styles.assignmentProgress}>
          <View style={styles.progressStats}>
            <View style={styles.progressStat}>
              <Icon name="account-group" size={14} color={colors.text.secondary} />
              <Text style={styles.statText}>
                {assignment.submissions || 0}/{assignment.totalStudents || 0}
              </Text>
            </View>
            <View style={styles.progressStat}>
              <Icon name="star" size={14} color={colors.warning.main} />
              <Text style={styles.statText}>{assignment.points || 100} pts</Text>
            </View>
          </View>

          <View style={styles.progressBarContainer}>
            <LinearGradient
              colors={status.gradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[styles.progressBar, { width: `${progress}%` }]}
            />
          </View>

          {/* Grading Progress */}
          {assignment.submissions > 0 && (
            <View style={styles.gradingProgressContainer}>
              <View style={styles.gradingProgressHeader}>
                <Icon name="check-circle" size={12} color={colors.success.main} />
                <Text style={styles.gradingProgressText}>
                  Graded: {gradedCount}/{assignment.submissions}
                </Text>
              </View>
              <View style={styles.gradingProgressBar}>
                <View style={[styles.gradingProgressFill, { width: `${gradingProgress}%` }]} />
              </View>
            </View>
          )}
        </View>

        {/* Quick Stats */}
        <View style={styles.quickStats}>
          <View style={styles.quickStat}>
            <Icon name="clock-outline" size={14} color={colors.text.secondary} />
            <Text style={styles.quickStatText}>
              {fmtDate(assignment.dueDate)}
            </Text>
          </View>
          {!!assignment.averageScore && (
            <View style={styles.quickStat}>
              <Icon name="chart-line" size={14} color={colors.success.main} />
              <Text style={styles.quickStatText}>Avg: {assignment.averageScore}%</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>

      {/* Context Menu Modal */}
      <Modal visible={showMenu} transparent animationType="fade">
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowMenu(false)}
        >
          <View style={styles.contextMenu}>
            <TouchableOpacity
              style={styles.contextMenuItem}
              onPress={() => {
                setShowMenu(false);
                onAnalytics(assignment);
              }}
            >
              <Icon name="chart-bar" size={20} color={colors.info.main} />
              <Text style={styles.contextMenuItemText}>View Analytics</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.contextMenuItem}
              onPress={() => {
                setShowMenu(false);
                onClone(assignment);
              }}
            >
              <Icon name="content-copy" size={20} color={colors.primary.main} />
              <Text style={styles.contextMenuItemText}>Clone Assignment</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.contextMenuItem, styles.contextMenuItemDanger]}
              onPress={() => {
                setShowMenu(false);
                onDelete(assignment.id);
              }}
            >
              <Icon name="delete" size={20} color={colors.danger.main} />
              <Text style={[styles.contextMenuItemText, { color: colors.danger.main }]}>
                Delete
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </Animated.View>
  );
};

// Analytics Modal Component
const AnalyticsModal = ({ visible, onClose, assignment, analytics, styles, colors }) => {
  if (!analytics) return null;

  const gradeDistribution = analytics.gradeDistribution || [0, 0, 0, 0, 0];
  const averageScore = analytics.averageScore || 0;
  const highestScore = analytics.highestScore || 0;
  const lowestScore = analytics.lowestScore || 0;

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContent, { maxHeight: height * 0.8 }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Assignment Analytics</Text>
            <TouchableOpacity onPress={onClose}>
              <Icon name="close" size={24} color={colors.text.secondary} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalBody}>
            <Text style={styles.analyticsTitle}>{assignment?.title}</Text>

            {/* Key Metrics */}
            <View style={styles.metricsGrid}>
              <LinearGradient
                colors={[colors.primary.soft, 'transparent']}
                style={styles.metricCard}
              >
                <Icon name="check-circle" size={24} color={colors.success.main} />
                <Text style={styles.metricValue}>{analytics.submittedCount}</Text>
                <Text style={styles.metricLabel}>Submitted</Text>
              </LinearGradient>

              <LinearGradient
                colors={[colors.warning.soft, 'transparent']}
                style={styles.metricCard}
              >
                <Icon name="clock-outline" size={24} color={colors.warning.main} />
                <Text style={styles.metricValue}>{analytics.pendingCount}</Text>
                <Text style={styles.metricLabel}>Pending</Text>
              </LinearGradient>

              <LinearGradient
                colors={[colors.danger.soft, 'transparent']}
                style={styles.metricCard}
              >
                <Icon name="close-circle" size={24} color={colors.danger.main} />
                <Text style={styles.metricValue}>{analytics.missingCount}</Text>
                <Text style={styles.metricLabel}>Missing</Text>
              </LinearGradient>
            </View>

            {/* Score Statistics */}
            <View style={styles.scoreStats}>
              <View style={styles.scoreStat}>
                <Text style={styles.scoreStatLabel}>Average Score</Text>
                <Text style={[styles.scoreStatValue, { color: colors.primary.main }]}>
                  {averageScore}%
                </Text>
              </View>
              <View style={styles.scoreStat}>
                <Text style={styles.scoreStatLabel}>Highest Score</Text>
                <Text style={[styles.scoreStatValue, { color: colors.success.main }]}>
                  {highestScore}%
                </Text>
              </View>
              <View style={styles.scoreStat}>
                <Text style={styles.scoreStatLabel}>Lowest Score</Text>
                <Text style={[styles.scoreStatValue, { color: colors.danger.main }]}>
                  {lowestScore}%
                </Text>
              </View>
            </View>

            {/* Grade Distribution Chart */}
            <Text style={styles.chartTitle}>Grade Distribution</Text>
            <View style={styles.chartContainer}>
              {gradeDistribution.map((count, index) => {
                const grades = ['A', 'B', 'C', 'D', 'F'];
                const gradeColors = [colors.success.main, colors.info.main, colors.primary.main, colors.warning.main, colors.danger.main];
                const percentage = (count / (analytics.submittedCount || 1)) * 100;

                return (
                  <View key={grades[index]} style={styles.gradeBar}>
                    <Text style={styles.gradeLabel}>{grades[index]}</Text>
                    <View style={styles.gradeBarContainer}>
                      <View
                        style={[
                          styles.gradeBarFill,
                          { width: `${percentage}%`, backgroundColor: gradeColors[index] }
                        ]}
                      />
                    </View>
                    <Text style={styles.gradeCount}>{count}</Text>
                  </View>
                );
              })}
            </View>

            {/* Submission Timeline */}
            {analytics.submissionTimeline && (
              <>
                <Text style={styles.chartTitle}>Submission Timeline</Text>
                <View style={styles.timelineContainer}>
                  {analytics.submissionTimeline.map((item, index) => (
                    <View key={index} style={styles.timelineItem}>
                      <Text style={styles.timelineDate}>{item.date}</Text>
                      <View style={styles.timelineBarContainer}>
                        <View
                          style={[
                            styles.timelineBar,
                            { width: `${(item.count / analytics.submittedCount) * 100}%` }
                          ]}
                        />
                      </View>
                      <Text style={styles.timelineCount}>{item.count}</Text>
                    </View>
                  ))}
                </View>
              </>
            )}
          </ScrollView>

          <View style={styles.modalFooter}>
            <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
              <Text style={styles.cancelButtonText}>Close</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.createButton}
              onPress={() => {
                // Export analytics as CSV
                const csv = generateAnalyticsCSV(analytics, assignment);
                shareAnalytics(csv);
              }}
            >
              <LinearGradient
                colors={colors.primary.gradient}
                style={styles.createButtonGradient}
              >
                <Icon name="export" size={20} color="#FFFFFF" />
                <Text style={styles.createButtonText}>Export Data</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const BLANK_FORM = {
    title: '',
    description: '',
    dueDate: new Date(),
    points: '100',
    isGroup: false,
    allowResub: true,
    blockLate: false,
    allowedTypes: ['file', 'link', 'text'],
    unitId: '',
    rubric: null,
    attachments: [],
    peerReview: false,
    autoGrade: false,
    plagiarismCheck: false,
    timeLimit: null,
    attemptsAllowed: 1,
  };

// Enhanced Create Assignment Modal
const EnhancedCreateAssignmentModal = ({ visible, onClose, onCreate, assignedUnits, editingAssignment, styles, colors }) => {
  const [formData, setFormData] = useState({ ...BLANK_FORM });
  const [submitting, setSubmitting] = useState(false);

  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [rubricModalVisible, setRubricModalVisible] = useState(false);
  const [rubricItems, setRubricItems] = useState([]);
  const [filePickerVisible, setFilePickerVisible] = useState(false);

  useEffect(() => {
    if (!visible) { setSubmitting(false); return; }
    if (!assignedUnits || assignedUnits.length === 0) return;
    const defaultUnitId = assignedUnits[0]?.unitId || assignedUnits[0]?.code || '';
    if (editingAssignment) {
      setFormData({
        title: editingAssignment.title || '',
        description: editingAssignment.description || '',
        dueDate: editingAssignment.dueDate ? new Date(editingAssignment.dueDate) : new Date(),
        points: (editingAssignment.maxScore ?? editingAssignment.points ?? 100).toString(),
        isGroup: !!(editingAssignment.isGroup || editingAssignment.is_group),
        allowResub: editingAssignment.allowResub ?? true,
        blockLate: editingAssignment.blockLate || false,
        allowedTypes: editingAssignment.allowedTypes || ['file', 'link', 'text'],
        unitId: editingAssignment.unitId || defaultUnitId,
        rubric: editingAssignment.rubric || null,
        attachments: editingAssignment.attachments || [],
        peerReview: editingAssignment.peerReview || false,
        autoGrade: editingAssignment.autoGrade || false,
        plagiarismCheck: editingAssignment.plagiarismCheck || false,
        timeLimit: editingAssignment.timeLimit || null,
        attemptsAllowed: editingAssignment.attemptsAllowed || 1,
      });
    } else {
      // Full reset for every new-assignment opening so stale toggles don't carry over
      setFormData({ ...BLANK_FORM, unitId: defaultUnitId });
    }
  }, [visible, assignedUnits, editingAssignment]);

  useEffect(() => {
    if (rubricModalVisible) {
      setRubricItems(
        Array.isArray(formData.rubric) && formData.rubric.length > 0
          ? formData.rubric.map(item => ({ ...item }))
          : [{ criterion: '', description: '', points: '' }]
      );
    }
  }, [rubricModalVisible]);

  const toggleAllowedType = (type) => {
    setFormData(prev => ({
      ...prev,
      allowedTypes: prev.allowedTypes.includes(type)
        ? prev.allowedTypes.filter(t => t !== type)
        : [...prev.allowedTypes, type]
    }));
  };

  const handleDateChange = (event, selectedDate) => {
    setShowDatePicker(false);
    if (selectedDate) {
      const newDate = new Date(formData.dueDate);
      newDate.setFullYear(selectedDate.getFullYear());
      newDate.setMonth(selectedDate.getMonth());
      newDate.setDate(selectedDate.getDate());
      setFormData({ ...formData, dueDate: newDate });
    }
  };

  const handleTimeChange = (event, selectedTime) => {
    setShowTimePicker(false);
    if (selectedTime) {
      const newDate = new Date(formData.dueDate);
      newDate.setHours(selectedTime.getHours());
      newDate.setMinutes(selectedTime.getMinutes());
      setFormData({ ...formData, dueDate: newDate });
    }
  };

  const handleAddAttachment = () => setFilePickerVisible(true);

  const handleCreate = async () => {
    if (!formData.title.trim()) {
      Alert.alert('Error', 'Please enter a title');
      return;
    }
    if (!formData.unitId) {
      Alert.alert('Error', 'Please select a unit');
      return;
    }
    setSubmitting(true);
    try {
      await onCreate({ ...formData, dueDate: formData.dueDate.toISOString() });
      onClose();
      Alert.alert('Success', editingAssignment ? 'Assignment updated successfully' : `Assignment "${formData.title}" created successfully`);
    } catch (err) {
      Alert.alert('Error', err.message || 'Failed to create assignment');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
    {/* Rubric Builder Modal */}
    <Modal visible={rubricModalVisible} animationType="slide" transparent onRequestClose={() => setRubricModalVisible(false)}>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContent, { maxHeight: height * 0.85 }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Grading Rubric</Text>
            <TouchableOpacity onPress={() => setRubricModalVisible(false)}>
              <Icon name="close" size={24} color={colors.text.secondary} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
            <Text style={styles.rubricHint}>
              Define criteria students will be graded on. Each criterion contributes to the total score.
            </Text>

            {rubricItems.map((item, index) => (
              <View key={index} style={styles.rubricCriterionCard}>
                <View style={styles.rubricCriterionHeader}>
                  <Text style={styles.rubricCriterionNumber}>Criterion {index + 1}</Text>
                  <TouchableOpacity
                    onPress={() => {
                      const updated = [...rubricItems];
                      updated.splice(index, 1);
                      setRubricItems(updated.length > 0 ? updated : [{ criterion: '', description: '', points: '' }]);
                    }}
                  >
                    <Icon name="close-circle" size={22} color={colors.danger.main} />
                  </TouchableOpacity>
                </View>
                <TextInput
                  style={styles.input}
                  placeholder="Criterion name (e.g. Code Quality)"
                  placeholderTextColor={colors.text.tertiary}
                  value={item.criterion}
                  onChangeText={text => {
                    const updated = [...rubricItems];
                    updated[index] = { ...updated[index], criterion: text };
                    setRubricItems(updated);
                  }}
                />
                <TextInput
                  style={[styles.input, styles.textArea, { marginBottom: 8 }]}
                  placeholder="Description (optional)"
                  placeholderTextColor={colors.text.tertiary}
                  value={item.description}
                  onChangeText={text => {
                    const updated = [...rubricItems];
                    updated[index] = { ...updated[index], description: text };
                    setRubricItems(updated);
                  }}
                  multiline
                  textAlignVertical="top"
                />
                <TextInput
                  style={[styles.input, { marginBottom: 0 }]}
                  placeholder="Max points"
                  placeholderTextColor={colors.text.tertiary}
                  value={item.points}
                  onChangeText={text => {
                    const updated = [...rubricItems];
                    updated[index] = { ...updated[index], points: text };
                    setRubricItems(updated);
                  }}
                  keyboardType="numeric"
                />
              </View>
            ))}

            <TouchableOpacity
              style={styles.addCriterionButton}
              onPress={() => setRubricItems([...rubricItems, { criterion: '', description: '', points: '' }])}
            >
              <LinearGradient colors={[colors.purple.soft, 'transparent']} style={styles.addCriterionGradient}>
                <Icon name="plus" size={20} color={colors.purple.main} />
                <Text style={styles.addCriterionText}>Add Criterion</Text>
              </LinearGradient>
            </TouchableOpacity>
          </ScrollView>

          <View style={styles.rubricTotalRow}>
            <Icon name="sigma" size={18} color={colors.text.secondary} />
            <Text style={styles.rubricTotalLabel}>Total Points:</Text>
            <Text style={styles.rubricTotalValue}>
              {rubricItems.reduce((sum, item) => sum + (parseInt(item.points) || 0), 0)}
            </Text>
          </View>

          <View style={styles.modalFooter}>
            <TouchableOpacity style={styles.cancelButton} onPress={() => setRubricModalVisible(false)}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.createButton}
              onPress={() => {
                const valid = rubricItems.filter(item => item.criterion.trim());
                setFormData(prev => ({ ...prev, rubric: valid.length > 0 ? valid : null }));
                setRubricModalVisible(false);
              }}
            >
              <LinearGradient colors={colors.success.gradient} style={styles.createButtonGradient}>
                <Icon name="check" size={20} color="#FFFFFF" />
                <Text style={styles.createButtonText}>Save Rubric</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>

    <FilePicker
      visible={filePickerVisible}
      onClose={() => setFilePickerVisible(false)}
      onSelect={(files) =>
        setFormData(prev => ({
          ...prev,
          attachments: [...prev.attachments, ...files.map(f => ({ uri: f.uri, name: f.name, type: f.type, size: f.size }))],
        }))
      }
      multiple={false}
    />
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.keyboardView}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editingAssignment ? 'Edit Assignment' : 'Create Assignment'}
              </Text>
              <TouchableOpacity onPress={onClose}>
                <Icon name="close" size={24} color={colors.text.secondary} />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.modalBody}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 24 }}
            >
              {/* Unit Selection */}
              <Text style={styles.inputLabel}>Unit <Text style={styles.requiredStar}>*</Text></Text>
              <View style={styles.unitSelector}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {assignedUnits.map((unit) => (
                    <TouchableOpacity
                      key={unit.unitId || unit.code}
                      style={[
                        styles.unitChip,
                        (unit.unitId === formData.unitId || unit.code === formData.unitId) && styles.unitChipSelected
                      ]}
                      onPress={() => setFormData({ ...formData, unitId: unit.unitId || unit.code })}
                    >
                      <LinearGradient
                        colors={(unit.unitId === formData.unitId || unit.code === formData.unitId)
                          ? colors.primary.gradient
                          : ['transparent', 'transparent']}
                        style={styles.unitChipGradient}
                      >
                        <Text style={[
                          styles.unitChipText,
                          (unit.unitId === formData.unitId || unit.code === formData.unitId) && styles.unitChipTextSelected
                        ]}>
                          {unit.code}
                        </Text>
                      </LinearGradient>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>

              {/* Basic Info */}
              <Text style={styles.inputLabel}>Title <Text style={styles.requiredStar}>*</Text></Text>
              <TextInput
                style={styles.input}
                placeholder="e.g., Algorithm Analysis Assignment"
                placeholderTextColor={colors.text.tertiary}
                value={formData.title}
                onChangeText={t => setFormData({...formData, title: t})}
              />

              <Text style={styles.inputLabel}>Description</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder="Describe the assignment..."
                placeholderTextColor={colors.text.tertiary}
                value={formData.description}
                onChangeText={t => setFormData({...formData, description: t})}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
              />

              {/* Due Date */}
              <Text style={styles.inputLabel}>Due Date & Time</Text>
              <View style={styles.dateTimeContainer}>
                <TouchableOpacity
                  style={styles.datePickerButton}
                  onPress={() => setShowDatePicker(true)}
                >
                  <Icon name="calendar" size={20} color={colors.primary.main} />
                  <Text style={styles.datePickerText}>
                    {formData.dueDate.toLocaleDateString()}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.datePickerButton}
                  onPress={() => setShowTimePicker(true)}
                >
                  <Icon name="clock-outline" size={20} color={colors.primary.main} />
                  <Text style={styles.datePickerText}>
                    {formData.dueDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </TouchableOpacity>
              </View>

              {showDatePicker && (
                <DateTimePicker
                  value={formData.dueDate}
                  mode="date"
                  display="default"
                  onChange={handleDateChange}
                />
              )}

              {showTimePicker && (
                <DateTimePicker
                  value={formData.dueDate}
                  mode="time"
                  display="default"
                  onChange={handleTimeChange}
                />
              )}

              {/* Points */}
              <Text style={styles.inputLabel}>Points</Text>
              <TextInput
                style={styles.input}
                placeholder="100"
                placeholderTextColor={colors.text.tertiary}
                value={formData.points}
                onChangeText={t => setFormData({...formData, points: t})}
                keyboardType="numeric"
              />

              {/* Submission Types */}
              <Text style={styles.inputLabel}>Allowed Submission Types</Text>
              <View style={styles.chipContainer}>
                {['file', 'link', 'text'].map(type => (
                  <TouchableOpacity
                    key={type}
                    style={[
                      styles.chip,
                      formData.allowedTypes.includes(type) && styles.chipActive
                    ]}
                    onPress={() => toggleAllowedType(type)}
                  >
                    <LinearGradient
                      colors={formData.allowedTypes.includes(type)
                        ? colors.primary.gradient
                        : ['transparent', 'transparent']
                      }
                      style={styles.chipGradient}
                    >
                      <Text style={[
                        styles.chipText,
                        formData.allowedTypes.includes(type) && styles.chipTextActive
                      ]}>
                        {type.charAt(0).toUpperCase() + type.slice(1)}
                      </Text>
                    </LinearGradient>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Advanced Settings */}
              <Text style={styles.sectionTitle}>Advanced Settings</Text>

              <View style={styles.settingItem}>
                <View style={styles.settingInfo}>
                  <Icon name="account-group" size={24} color={colors.primary.main} />
                  <View style={styles.settingText}>
                    <Text style={styles.settingTitle}>Group Assignment</Text>
                    <Text style={styles.settingDescription}>Students can submit in groups</Text>
                  </View>
                </View>
                <Switch
                  value={formData.isGroup}
                  onValueChange={(value) => setFormData({...formData, isGroup: value})}
                  trackColor={{ false: colors.surface.tertiary, true: colors.primary.main }}
                  thumbColor={colors.text.primary}
                />
              </View>

              <View style={styles.settingItem}>
                <View style={styles.settingInfo}>
                  <Icon name="refresh" size={24} color={colors.success.main} />
                  <View style={styles.settingText}>
                    <Text style={styles.settingTitle}>Allow Resubmission</Text>
                    <Text style={styles.settingDescription}>Students can resubmit their work</Text>
                  </View>
                </View>
                <Switch
                  value={formData.allowResub}
                  onValueChange={(value) => setFormData({...formData, allowResub: value})}
                  trackColor={{ false: colors.surface.tertiary, true: colors.success.main }}
                  thumbColor={colors.text.primary}
                />
              </View>

              <View style={styles.settingItem}>
                <View style={styles.settingInfo}>
                  <Icon name="clock-alert" size={24} color={colors.warning.main} />
                  <View style={styles.settingText}>
                    <Text style={styles.settingTitle}>Block Late Submissions</Text>
                    <Text style={styles.settingDescription}>Prevent submissions after due date</Text>
                  </View>
                </View>
                <Switch
                  value={formData.blockLate}
                  onValueChange={(value) => setFormData({...formData, blockLate: value})}
                  trackColor={{ false: colors.surface.tertiary, true: colors.warning.main }}
                  thumbColor={colors.text.primary}
                />
              </View>

              <View style={styles.settingItem}>
                <View style={styles.settingInfo}>
                  <Icon name="account-multiple-check" size={24} color={colors.purple.main} />
                  <View style={styles.settingText}>
                    <Text style={styles.settingTitle}>Peer Review</Text>
                    <Text style={styles.settingDescription}>Enable peer review for submissions</Text>
                  </View>
                </View>
                <Switch
                  value={formData.peerReview}
                  onValueChange={(value) => setFormData({...formData, peerReview: value})}
                  trackColor={{ false: colors.surface.tertiary, true: colors.purple.main }}
                  thumbColor={colors.text.primary}
                />
              </View>

              <View style={styles.settingItem}>
                <View style={styles.settingInfo}>
                  <Icon name="robot" size={24} color={colors.info.main} />
                  <View style={styles.settingText}>
                    <Text style={styles.settingTitle}>Auto-grading</Text>
                    <Text style={styles.settingDescription}>Automatically grade submissions</Text>
                  </View>
                </View>
                <Switch
                  value={formData.autoGrade}
                  onValueChange={(value) => setFormData({...formData, autoGrade: value})}
                  trackColor={{ false: colors.surface.tertiary, true: colors.info.main }}
                  thumbColor={colors.text.primary}
                />
              </View>

              <View style={styles.settingItem}>
                <View style={styles.settingInfo}>
                  <Icon name="shield-check" size={24} color={colors.danger.main} />
                  <View style={styles.settingText}>
                    <Text style={styles.settingTitle}>Plagiarism Check</Text>
                    <Text style={styles.settingDescription}>Check submissions for plagiarism</Text>
                  </View>
                </View>
                <Switch
                  value={formData.plagiarismCheck}
                  onValueChange={(value) => setFormData({...formData, plagiarismCheck: value})}
                  trackColor={{ false: colors.surface.tertiary, true: colors.danger.main }}
                  thumbColor={colors.text.primary}
                />
              </View>

              {/* Attempts Allowed */}
              <Text style={styles.inputLabel}>Attempts Allowed</Text>
              <View style={styles.attemptsContainer}>
                {[1, 2, 3, 5, 10].map(num => (
                  <TouchableOpacity
                    key={num}
                    style={[
                      styles.attemptButton,
                      formData.attemptsAllowed === num && styles.attemptButtonActive
                    ]}
                    onPress={() => setFormData({...formData, attemptsAllowed: num})}
                  >
                    <Text style={[
                      styles.attemptButtonText,
                      formData.attemptsAllowed === num && styles.attemptButtonTextActive
                    ]}>
                      {num}
                    </Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity
                  style={[
                    styles.attemptButton,
                    formData.attemptsAllowed === 0 && styles.attemptButtonActive
                  ]}
                  onPress={() => setFormData({...formData, attemptsAllowed: 0})}
                >
                  <Text style={[
                    styles.attemptButtonText,
                    formData.attemptsAllowed === 0 && styles.attemptButtonTextActive
                  ]}>
                    Unlimited
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Attachments */}
              <Text style={styles.inputLabel}>Attachments</Text>
              <TouchableOpacity
                style={styles.attachmentButton}
                onPress={handleAddAttachment}
              >
                <LinearGradient
                  colors={[colors.primary.soft, 'transparent']}
                  style={styles.attachmentButtonGradient}
                >
                  <Icon name="attachment" size={20} color={colors.primary.main} />
                  <Text style={styles.attachmentButtonText}>Add Attachment</Text>
                </LinearGradient>
              </TouchableOpacity>

              {formData.attachments.map((file, index) => (
                <View key={index} style={styles.attachmentItem}>
                  <Icon name="file-document" size={20} color={colors.info.main} />
                  <Text style={styles.attachmentName} numberOfLines={1}>
                    {file.name || 'Attachment'}
                  </Text>
                  <TouchableOpacity
                    onPress={() => {
                      const newAttachments = [...formData.attachments];
                      newAttachments.splice(index, 1);
                      setFormData({...formData, attachments: newAttachments});
                    }}
                  >
                    <Icon name="close-circle" size={20} color={colors.danger.main} />
                  </TouchableOpacity>
                </View>
              ))}

              {/* Rubric */}
              <TouchableOpacity
                style={styles.rubricButton}
                onPress={() => setRubricModalVisible(true)}
              >
                <LinearGradient
                  colors={[colors.purple.soft, 'transparent']}
                  style={styles.rubricButtonGradient}
                >
                  <Icon name="format-list-checkbox" size={20} color={colors.purple.main} />
                  <Text style={styles.rubricButtonText}>
                    {formData.rubric ? 'Edit Rubric' : 'Add Rubric'}
                  </Text>
                </LinearGradient>
              </TouchableOpacity>

              {formData.rubric && formData.rubric.length > 0 && (
                <View style={styles.rubricSummary}>
                  <Text style={styles.rubricSummaryMeta}>
                    {formData.rubric.length} {formData.rubric.length === 1 ? 'criterion' : 'criteria'} · {formData.rubric.reduce((s, i) => s + (parseInt(i.points) || 0), 0)} pts total
                  </Text>
                  {formData.rubric.map((item, i) => (
                    <View key={i} style={styles.rubricSummaryRow}>
                      <Text style={styles.rubricSummaryName} numberOfLines={1}>{item.criterion}</Text>
                      <Text style={styles.rubricSummaryPoints}>{item.points} pts</Text>
                    </View>
                  ))}
                </View>
              )}
            </ScrollView>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={onClose}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.createButton, submitting && { opacity: 0.7 }]}
                onPress={handleCreate}
                disabled={submitting}
              >
                <LinearGradient
                  colors={colors.success.gradient}
                  style={styles.createButtonGradient}
                >
                  {submitting
                    ? <ActivityIndicator size="small" color="#FFFFFF" />
                    : <>
                        <Text style={styles.createButtonText}>
                          {editingAssignment ? 'Save Changes' : 'Create Assignment'}
                        </Text>
                        <Icon name="check" size={20} color="#FFFFFF" />
                      </>
                  }
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
    </>
  );
};

// Main AssignmentsScreen Component
export default function AssignmentsScreen({
  route,
  selectedUnitId: propUnitId,
  assignedUnits: propUnits,
  lecturerData: propLecturerData,
  onRefresh: parentRefresh,
  refreshing: parentRefreshing = false
}) {
  const { user } = useAuth();
  const colors  = useColors();
  const C = useMemo(() => ({
    bg:               colors.background.primary,
    surfacePrimary:   colors.surface.primary,
    surfaceSecondary: colors.surface.secondary,
    surfaceTertiary:  colors.surface.tertiary,
    surfaceGradient:  colors.surface.gradient,
    textPrimary:      colors.text.primary,
    textSecondary:    colors.text.secondary,
    textTertiary:     colors.text.tertiary,
    borderLight:      colors.border.light,
    primaryMain:      colors.primary.main,
    primarySoft:      colors.primary.soft,
    primaryGradient:  colors.primary.gradient,
    successMain:      colors.success.main,
    successSoft:      colors.success.soft,
    successGradient:  colors.success.gradient,
    warningMain:      colors.warning.main,
    warningSoft:      colors.warning.soft,
    warningGradient:  colors.warning.gradient,
    dangerMain:       colors.danger.main,
    dangerSoft:       colors.danger.soft,
    dangerGradient:   colors.danger.gradient,
    infoMain:         colors.info.main,
    infoSoft:         colors.info.soft,
    purpleMain:       colors.purple.main,
    purpleSoft:       colors.purple.soft,
    overlayMedium:    colors.overlay.medium,
  }), [colors]);
  const styles = useMemo(() => makeStyles(C), [C]);

  const lecturerData = propLecturerData ?? route?.params?.lecturerData ?? null;
  const [selectedUnitId, setSelectedUnitId] = useState(propUnitId ?? route?.params?.selectedUnitId ?? '');
  const [units, setUnits] = useState(() => {
    const passed = (propUnits && propUnits.length > 0 ? propUnits : null) ?? route?.params?.assignedUnits ?? [];
    return Array.isArray(passed) ? passed : [];
  });
  const [unitDropdownVisible, setUnitDropdownVisible] = useState(false);
  const [assignments, setAssignments] = useState([]);
  const [assignmentsLoading, setAssignmentsLoading] = useState(false);
  const [selectedAssignment, setSelectedAssignment] = useState(null);
  const [createAssignmentModalVisible, setCreateAssignmentModalVisible] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState(null);
  const [analyticsModalVisible, setAnalyticsModalVisible] = useState(false);
  const [selectedAnalytics, setSelectedAnalytics] = useState(null);
  const [filterStatus, setFilterStatus] = useState('all'); // all, active, closed, overdue
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('dueDate'); // dueDate, title, submissions
  const [sortOrder, setSortOrder] = useState('asc');
  const [refreshing, setRefreshing] = useState(false);
  const [subsApiError, setSubsApiError] = useState(null);

  // Fetch lecturer units if not provided via props/route
  useEffect(() => {
    const passedUnits = (propUnits && propUnits.length > 0 ? propUnits : null) ?? route?.params?.assignedUnits ?? [];
    if ((!Array.isArray(passedUnits) || passedUnits.length === 0) && user?.lecturerId) {
      fetchLecturerUnits(user.lecturerId)
        .then(data => {
          const arr = Array.isArray(data) ? data : (data?.units || []);
          const mapped = arr.map(u => {
            // Use unit code only — never fall back to DB id (u.unitId/u.unit_id)
            const rawCode = u.unit_code || u.unitCode || u.code || '';
            const normalizedCode = String(rawCode).replace(/\s+/g, '').toUpperCase();
            return {
              unitId: normalizedCode,
              code: normalizedCode,
              name: toTitleCase(String(u.unit_name || u.unitName || u.unitTitle || u.name || '')),
              display: [rawCode, toTitleCase(String(u.unit_name || u.unitName || u.unitTitle || u.name || ''))].filter(Boolean).join(' - '),
            };
          });
          setUnits(mapped);
          if (!selectedUnitId && mapped.length > 0) {
            setSelectedUnitId(mapped[0].unitId);
          }
        })
        .catch(err => console.error('[AssignmentsScreen] fetch units error:', err));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.lecturerId]);

  // Load assignments for a unit — stale-while-revalidate via module-level cache.
  // Paint from cache immediately so the screen appears instant on re-visits.
  const loadAssignments = useCallback(async (unitId, force = false) => {
    if (!unitId) return;
    const cached = _assignmentsCache.get(unitId);
    if (cached) setAssignments(cached.data);
    if (!force && cached && Date.now() - cached.ts < ASSIGNMENTS_STALE_MS) return;
    if (!cached) setAssignmentsLoading(true);
    try {
      const data = await fetchAssignments(unitId);
      const arr = Array.isArray(data) ? data : (data.assignments || []);
      const enriched = await Promise.all(
        arr.map(async (a) => {
          try { return { ...a, ...await getAssignmentAnalytics(a.id) }; }
          catch { return a; }
        })
      );
      _assignmentsCache.set(unitId, { data: enriched, ts: Date.now() });
      setAssignments(enriched);
    } catch (err) {
      console.error('Error loading assignments:', err);
      if (!cached) {
        Alert.alert('Error', err.message || 'Failed to load assignments');
        setAssignments([]);
      }
    } finally {
      setAssignmentsLoading(false);
    }
  }, []);

  // Load data when selectedUnitId changes
  useEffect(() => {
    if (selectedUnitId) {
      loadAssignments(selectedUnitId);
    }
  }, [selectedUnitId, loadAssignments]);

  useEffect(() => {
    if (route?.params?.openCreateModal) {
      setCreateAssignmentModalVisible(true);
    }
  }, [route?.params?.openCreateModal]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    if (selectedUnitId) {
      _assignmentsCache.delete(selectedUnitId);
      await loadAssignments(selectedUnitId, true);
    }
    if (parentRefresh) await parentRefresh();
    setRefreshing(false);
  }, [selectedUnitId, loadAssignments, parentRefresh]);

  // Filter and sort assignments — memoized so it only recomputes when its inputs change,
  // not on every render (e.g. modal state toggles, animation frames).
  const getFilteredAssignments = useMemo(() => {
    let filtered = [...assignments];
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(a =>
        a.title.toLowerCase().includes(q) ||
        a.description?.toLowerCase().includes(q)
      );
    }
    if (filterStatus !== 'all') {
      const now = new Date();
      filtered = filtered.filter(a => {
        const diffHours = (new Date(a.dueDate) - now) / (1000 * 60 * 60);
        switch (filterStatus) {
          case 'active':   return !a.closed && diffHours > 0;
          case 'closed':   return a.closed;
          case 'overdue':  return !a.closed && diffHours < 0;
          default:         return true;
        }
      });
    }
    filtered.sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case 'dueDate':     cmp = new Date(a.dueDate) - new Date(b.dueDate); break;
        case 'title':       cmp = a.title.localeCompare(b.title); break;
        case 'submissions': cmp = (a.submissions || 0) - (b.submissions || 0); break;
      }
      return sortOrder === 'asc' ? cmp : -cmp;
    });
    return filtered;
  }, [assignments, searchQuery, filterStatus, sortBy, sortOrder]);

  // Assignment handlers
  const handleCreateAssignment = async (data) => {
    // Throws on API failure — the modal's handleCreate catches and shows the error Alert.
    const { unitId, ...payload } = data;
    await createAssignment(unitId, payload);

    // Side-effects are fully fire-and-forget; failures must not propagate upward.
    Promise.allSettled([
      sendNotification({
        type: 'assignment_created',
        title: 'New Assignment',
        message: `A new assignment "${data.title}" has been posted.`,
        recipients: [unitId],
        data: { assignmentTitle: data.title, dueDate: data.dueDate },
      }),
      writeAuditLog({
        action: 'create_assignment',
        actor: lecturerData?.fullName || 'Unknown Lecturer',
        target: data.title,
        details: { unitId, isGroup: data.isGroup },
      }),
    ]).then(results => {
      results.forEach(r => {
        if (r.status === 'rejected') console.warn('[Assignment side-effect]', r.reason?.message);
      });
    });

    _assignmentsCache.delete(selectedUnitId);
    loadAssignments(selectedUnitId, true);
    setEditingAssignment(null);
  };

  const handleUpdateAssignment = async (data) => {
    // Throws on API failure — the modal's handleCreate catches and shows the error Alert.
    const { unitId, ...payload } = data;
    await updateAssignment(editingAssignment.id, payload);
    _assignmentsCache.delete(selectedUnitId);
    loadAssignments(selectedUnitId, true);
    setEditingAssignment(null);
  };

  const handleDeleteAssignment = (assignmentId) => {
    Alert.alert(
      'Delete Assignment',
      'Are you sure you want to delete this assignment? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteAssignment(assignmentId);
              Alert.alert('Success', 'Assignment deleted successfully');
              _assignmentsCache.delete(selectedUnitId);
              loadAssignments(selectedUnitId, true);
            } catch (err) {
              Alert.alert('Error', err.message || 'Failed to delete assignment');
            }
          }
        }
      ]
    );
  };

  const handleCloneAssignment = async (assignment) => {
    try {
      await cloneAssignment(assignment.id);
      Alert.alert('Success', 'Assignment cloned successfully');
      _assignmentsCache.delete(selectedUnitId);
      loadAssignments(selectedUnitId, true);
    } catch (err) {
      Alert.alert('Error', err.message || 'Failed to clone assignment');
    }
  };

  const handleViewAssignmentDetails = async (assignmentId) => {
    setSubsApiError(null);
    try {
      setAssignmentsLoading(true);
      // Fetch details first, then submissions separately so a subs failure doesn't block details
      const details = await getAssignmentDetails(assignmentId);
      let subs = Array.isArray(details?.submissions) ? details.submissions : [];
      try {
        const fetched = await fetchSubmissions(assignmentId);
        subs = fetched; // dedicated endpoint wins
      } catch (subsErr) {
        const msg = subsErr?.message || 'Unknown error';
        console.warn('[AssignmentsScreen] fetchSubmissions error:', msg);
        setSubsApiError(msg);
        // fall back to whatever the details response included
      }
      setSelectedAssignment({ ...details, submissions: normalizeSubmissions(subs) });
    } catch (err) {
      Alert.alert('Error', err.message || 'Failed to load assignment details');
    } finally {
      setAssignmentsLoading(false);
    }
  };

  const handleViewAnalytics = async (assignment) => {
    try {
      const analytics = await getAssignmentAnalytics(assignment.id);
      setSelectedAnalytics({ ...assignment, ...analytics });
      setAnalyticsModalVisible(true);
    } catch (err) {
      Alert.alert('Error', err.message || 'Failed to load analytics');
    }
  };

  const handleBulkGrade = () => {
    // Implement bulk grading
  };

  const handleExportGrades = () => {
    // Implement grade export
  };

  const filteredAssignments = getFilteredAssignments;
  const activeUnitObj = units.find(u => u.unitId === selectedUnitId || u.code === selectedUnitId);
  const activeUnitDisplay = activeUnitObj?.display || activeUnitObj?.name || activeUnitObj?.code || selectedUnitId || 'Select a unit';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Unit Dropdown Modal */}
      <Modal visible={unitDropdownVisible} transparent animationType="fade" onRequestClose={() => setUnitDropdownVisible(false)}>
        <TouchableOpacity style={styles.unitDropdownOverlay} activeOpacity={1} onPress={() => setUnitDropdownVisible(false)}>
          <View style={styles.unitDropdownContent}>
            <View style={styles.unitDropdownHeader}>
              <Text style={styles.unitDropdownTitle}>Select Unit</Text>
              <TouchableOpacity onPress={() => setUnitDropdownVisible(false)}>
                <Icon name="close" size={22} color={colors.text.secondary} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={units}
              keyExtractor={item => String(item.unitId || item.code)}
              renderItem={({ item }) => {
                const isActive = item.unitId === selectedUnitId || item.code === selectedUnitId;
                return (
                  <TouchableOpacity
                    onPress={() => { setSelectedUnitId(item.unitId || item.code); setUnitDropdownVisible(false); }}
                  >
                    <LinearGradient
                      colors={isActive ? colors.primary.gradient : ['transparent', 'transparent']}
                      style={styles.unitItemGradient}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.unitItemCode, isActive && styles.unitItemTextActive]}>{item.code}</Text>
                        {!!item.name && <Text style={[styles.unitItemName, isActive && styles.unitItemSubtextActive]}>{item.name}</Text>}
                      </View>
                      {isActive && <Icon name="check-circle" size={20} color="#FFFFFF" />}
                    </LinearGradient>
                  </TouchableOpacity>
                );
              }}
              ItemSeparatorComponent={() => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border.light, marginHorizontal: 16 }} />}
              ListEmptyComponent={<Text style={styles.unitEmptyText}>No assigned units found</Text>}
              initialNumToRender={10}
              maxToRenderPerBatch={5}
            />
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Header with Filters */}
      <View style={styles.filterHeader}>
        {/* Unit Selector */}
        <TouchableOpacity style={styles.unitSelectorBar} onPress={() => setUnitDropdownVisible(true)} activeOpacity={0.7}>
          <Icon name="book-education-outline" size={16} color={colors.primary.main} />
          <Text style={styles.unitSelectorText} numberOfLines={1}>{activeUnitDisplay}</Text>
          <Icon name="chevron-down" size={20} color={colors.primary.main} />
        </TouchableOpacity>

        <View style={styles.searchContainer}>
          <Icon name="magnify" size={20} color={colors.text.secondary} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search assignments..."
            placeholderTextColor={colors.text.tertiary}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery ? (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Icon name="close" size={20} color={colors.text.secondary} />
            </TouchableOpacity>
          ) : null}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterScroll}
        >
          <TouchableOpacity
            style={[styles.filterChip, filterStatus === 'all' && styles.filterChipActive]}
            onPress={() => setFilterStatus('all')}
          >
            <Text style={[styles.filterChipText, filterStatus === 'all' && styles.filterChipTextActive]}>
              All
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.filterChip, filterStatus === 'active' && styles.filterChipActive]}
            onPress={() => setFilterStatus('active')}
          >
            <Text style={[styles.filterChipText, filterStatus === 'active' && styles.filterChipTextActive]}>
              Active
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.filterChip, filterStatus === 'closed' && styles.filterChipActive]}
            onPress={() => setFilterStatus('closed')}
          >
            <Text style={[styles.filterChipText, filterStatus === 'closed' && styles.filterChipTextActive]}>
              Closed
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.filterChip, filterStatus === 'overdue' && styles.filterChipActive]}
            onPress={() => setFilterStatus('overdue')}
          >
            <Text style={[styles.filterChipText, filterStatus === 'overdue' && styles.filterChipTextActive]}>
              Overdue
            </Text>
          </TouchableOpacity>
        </ScrollView>

        <View style={styles.sortContainer}>
          <TouchableOpacity
            style={styles.sortButton}
            onPress={() => {
              if (sortBy === 'dueDate') setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
              else setSortBy('dueDate');
            }}
          >
            <Icon name="calendar" size={16} color={sortBy === 'dueDate' ? colors.primary.main : colors.text.secondary} />
            <Text style={[styles.sortButtonText, sortBy === 'dueDate' && styles.sortButtonTextActive]}>
              Due Date
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.sortButton}
            onPress={() => {
              if (sortBy === 'title') setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
              else setSortBy('title');
            }}
          >
            <Icon name="sort-alphabetical" size={16} color={sortBy === 'title' ? colors.primary.main : colors.text.secondary} />
            <Text style={[styles.sortButtonText, sortBy === 'title' && styles.sortButtonTextActive]}>
              Title
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.sortButton}
            onPress={() => {
              if (sortBy === 'submissions') setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
              else setSortBy('submissions');
            }}
          >
            <Icon name="account-group" size={16} color={sortBy === 'submissions' ? colors.primary.main : colors.text.secondary} />
            <Text style={[styles.sortButtonText, sortBy === 'submissions' && styles.sortButtonTextActive]}>
              Submissions
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Create Button */}
      <TouchableOpacity
        style={styles.createButton}
        onPress={() => {
          setEditingAssignment(null);
          setCreateAssignmentModalVisible(true);
        }}
      >
        <LinearGradient
          colors={colors.primary.gradient}
          style={styles.createButtonGradient}
        >
          <Icon name="clipboard-list" size={20} color="#FFFFFF" />
          <Text style={styles.createButtonText}>Create Assignment</Text>
        </LinearGradient>
      </TouchableOpacity>

      {/* Bulk Actions */}
      {assignments.length > 0 && (
        <View style={styles.bulkActions}>
          <TouchableOpacity style={styles.bulkAction} onPress={handleBulkGrade}>
            <Icon name="check-all" size={20} color={colors.success.main} />
            <Text style={styles.bulkActionText}>Bulk Grade</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.bulkAction} onPress={handleExportGrades}>
            <Icon name="export" size={20} color={colors.info.main} />
            <Text style={styles.bulkActionText}>Export Grades</Text>
          </TouchableOpacity>
        </View>
      )}

      {assignmentsLoading ? (
        <View style={styles.loaderContainer}>
          <ActivityIndicator size="large" color={colors.primary.main} />
        </View>
      ) : selectedAssignment ? (
        <ScrollView
          style={styles.detailContainer}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing || parentRefreshing}
              onRefresh={handleRefresh}
              tintColor={colors.primary.main}
              colors={[colors.primary.main]}
            />
          }
        >
          <TouchableOpacity
            onPress={() => setSelectedAssignment(null)}
            style={styles.backButton}
          >
            <Icon name="arrow-left" size={20} color={colors.primary.main} />
            <Text style={styles.backButtonText}>Back to assignments</Text>
          </TouchableOpacity>

          <Text style={styles.detailTitle}>{selectedAssignment.title}</Text>
          <Text style={styles.detailDescription}>{selectedAssignment.description}</Text>

          <View style={styles.detailGrid}>
            <LinearGradient
              colors={[colors.primary.soft, 'transparent']}
              style={styles.detailItem}
            >
              <Icon name="calendar" size={20} color={colors.primary.main} />
              <Text style={styles.detailLabel}>Due Date</Text>
              <Text style={styles.detailValue}>
                {fmtDate(selectedAssignment.dueDate)}
              </Text>
            </LinearGradient>

            <LinearGradient
              colors={[colors.warning.soft, 'transparent']}
              style={styles.detailItem}
            >
              <Icon name="star" size={20} color={colors.warning.main} />
              <Text style={styles.detailLabel}>Points</Text>
              <Text style={styles.detailValue}>{selectedAssignment.points || 100}</Text>
            </LinearGradient>

            <LinearGradient
              colors={[colors.info.soft, 'transparent']}
              style={[styles.detailItem, styles.detailItemFull]}
            >
              <Icon name="account-group" size={20} color={colors.info.main} />
              <Text style={styles.detailLabel}>Type</Text>
              <Text style={styles.detailValue}>
                {selectedAssignment.isGroup ? 'Group' : 'Individual'}
              </Text>
            </LinearGradient>
          </View>

          <Text style={styles.sectionHeader}>Submissions</Text>
          {selectedAssignment.submissions?.length > 0 ? (
            selectedAssignment.submissions.map((sub, idx) => (
              <SubmissionCard
                key={sub.id || idx}
                sub={sub}
                idx={idx}
                assignmentId={selectedAssignment.id}
                maxScore={selectedAssignment.maxScore ?? selectedAssignment.points ?? 100}
                onGraded={() => handleViewAssignmentDetails(selectedAssignment.id)}
                styles={styles}
                colors={colors}
              />
            ))
          ) : (
            <View style={styles.emptySubmissions}>
              <Icon name="clipboard-text-outline" size={48} color={colors.text.tertiary} />
              <Text style={styles.emptySubmissionsText}>
                {subsApiError ? 'Could not load submissions' : 'No submissions yet'}
              </Text>
              {subsApiError ? (
                <View style={{ marginTop: 10, padding: 10, backgroundColor: 'rgba(255,68,68,0.12)', borderRadius: 8, maxWidth: '100%' }}>
                  <Text style={{ color: '#ff4444', fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>
                    {subsApiError}
                  </Text>
                </View>
              ) : null}
              <TouchableOpacity
                onPress={() => handleViewAssignmentDetails(selectedAssignment.id)}
                style={{ marginTop: 14, paddingVertical: 8, paddingHorizontal: 20, backgroundColor: colors.primary.main, borderRadius: 8 }}
              >
                <Text style={{ color: '#fff', fontSize: 13 }}>Retry</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      ) : (
        <FlatList
          data={filteredAssignments}
          keyExtractor={item => item.id}
          renderItem={({ item }) => (
            <EnhancedAssignmentCard
              assignment={item}
              onPress={() => handleViewAssignmentDetails(item.id)}
              onDelete={handleDeleteAssignment}
              onClone={handleCloneAssignment}
              onAnalytics={handleViewAnalytics}
              styles={styles}
              colors={colors}
            />
          )}
          showsVerticalScrollIndicator={false}
          initialNumToRender={10}
          maxToRenderPerBatch={5}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing || parentRefreshing}
              onRefresh={handleRefresh}
              tintColor={colors.primary.main}
              colors={[colors.primary.main]}
            />
          }
          ListEmptyComponent={
            <ScrollView
              contentContainerStyle={styles.emptyContainer}
              showsVerticalScrollIndicator={false}
            >
              <LinearGradient
                colors={[colors.primary.soft, 'transparent']}
                style={styles.emptyIconContainer}
              >
                <Icon name="clipboard-list-outline" size={64} color={colors.primary.main} />
              </LinearGradient>
              <Text style={styles.emptyTitle}>No Assignments</Text>
              <Text style={styles.emptyText}>Create your first assignment</Text>
            </ScrollView>
          }
        />
      )}

      {/* Create/Edit Assignment Modal */}
      <EnhancedCreateAssignmentModal
        visible={createAssignmentModalVisible}
        onClose={() => {
          setCreateAssignmentModalVisible(false);
          setEditingAssignment(null);
        }}
        onCreate={editingAssignment ? handleUpdateAssignment : handleCreateAssignment}
        assignedUnits={units}
        editingAssignment={editingAssignment}
        styles={styles}
        colors={colors}
      />

      {/* Analytics Modal */}
      <AnalyticsModal
        visible={analyticsModalVisible}
        onClose={() => {
          setAnalyticsModalVisible(false);
          setSelectedAnalytics(null);
        }}
        assignment={selectedAnalytics}
        analytics={selectedAnalytics}
        styles={styles}
        colors={colors}
      />
    </SafeAreaView>
  );
}

const makeStyles = (C) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  unitSelectorBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.primarySoft,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: C.primaryMain + '40',
  },
  unitSelectorText: {
    flex: 1,
    marginHorizontal: 8,
    color: C.primaryMain,
    fontWeight: '600',
    fontSize: 14,
  },
  unitDropdownOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  unitDropdownContent: {
    backgroundColor: C.surfacePrimary,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: height * 0.5,
    paddingBottom: 24,
  },
  unitDropdownHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: C.borderLight,
  },
  unitDropdownTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: C.textPrimary,
  },
  unitItemGradient: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    marginHorizontal: 8,
    marginVertical: 2,
  },
  unitItemCode: {
    fontSize: 14,
    fontWeight: '600',
    color: C.textPrimary,
  },
  unitItemName: {
    fontSize: 12,
    color: C.textSecondary,
    marginTop: 2,
  },
  unitItemTextActive: {
    color: '#FFFFFF',
  },
  unitItemSubtextActive: {
    color: 'rgba(255,255,255,0.8)',
  },
  unitEmptyText: {
    textAlign: 'center',
    padding: 24,
    color: C.textSecondary,
    fontSize: 14,
  },
  filterHeader: {
    padding: 16,
    backgroundColor: C.surfacePrimary,
    borderBottomWidth: 1,
    borderBottomColor: C.borderLight,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surfaceSecondary,
    borderRadius: 12,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 8,
    color: C.textPrimary,
    fontSize: 14,
  },
  filterScroll: {
    marginBottom: 12,
  },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: C.surfaceSecondary,
    marginRight: 8,
  },
  filterChipActive: {
    backgroundColor: C.primaryMain,
  },
  filterChipText: {
    color: C.textSecondary,
    fontSize: 13,
  },
  filterChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  sortContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  sortButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: C.surfaceSecondary,
    borderRadius: 8,
  },
  sortButtonText: {
    fontSize: 12,
    color: C.textSecondary,
  },
  sortButtonTextActive: {
    color: C.primaryMain,
    fontWeight: '600',
  },
  bulkActions: {
    flexDirection: 'row',
    padding: 16,
    gap: 12,
    backgroundColor: C.surfacePrimary,
    borderBottomWidth: 1,
    borderBottomColor: C.borderLight,
  },
  bulkAction: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    backgroundColor: C.surfaceSecondary,
    borderRadius: 8,
  },
  bulkActionText: {
    color: C.textPrimary,
    fontSize: 13,
    fontWeight: '500',
  },
  quickStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: C.borderLight,
  },
  quickStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  quickStatText: {
    fontSize: 11,
    color: C.textSecondary,
  },
  gradingProgressContainer: {
    marginTop: 8,
  },
  gradingProgressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
  },
  gradingProgressText: {
    fontSize: 11,
    color: C.textSecondary,
  },
  gradingProgressBar: {
    height: 4,
    backgroundColor: C.surfaceSecondary,
    borderRadius: 2,
    overflow: 'hidden',
  },
  gradingProgressFill: {
    height: '100%',
    backgroundColor: C.successMain,
    borderRadius: 2,
  },
  contextMenu: {
    position: 'absolute',
    top: '50%',
    left: 20,
    right: 20,
    backgroundColor: C.surfacePrimary,
    borderRadius: 16,
    padding: 8,
    borderWidth: 1,
    borderColor: C.borderLight,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  contextMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: 12,
  },
  contextMenuItemDanger: {
    borderTopWidth: 1,
    borderTopColor: C.borderLight,
  },
  contextMenuItemText: {
    fontSize: 15,
    color: C.textPrimary,
  },
  dateTimeContainer: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  datePickerButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: C.surfaceSecondary,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: C.borderLight,
  },
  datePickerText: {
    flex: 1,
    color: C.textPrimary,
    fontSize: 14,
  },
  unitSelector: {
    marginBottom: 16,
  },
  unitChip: {
    marginRight: 8,
    borderRadius: 20,
    overflow: 'hidden',
  },
  unitChipGradient: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  unitChipText: {
    color: C.textSecondary,
    fontSize: 13,
  },
  unitChipTextSelected: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  unitChipSelected: {
    borderWidth: 0,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: C.textPrimary,
    marginTop: 20,
    marginBottom: 12,
    letterSpacing: 0.3,
  },
  attemptsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  attemptButton: {
    minWidth: 60,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: C.surfaceSecondary,
    borderWidth: 1,
    borderColor: C.borderLight,
  },
  attemptButtonActive: {
    backgroundColor: C.primaryMain,
    borderColor: C.primaryMain,
  },
  attemptButtonText: {
    color: C.textSecondary,
    fontSize: 13,
    textAlign: 'center',
  },
  attemptButtonTextActive: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  attachmentButton: {
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 12,
  },
  attachmentButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 16,
    borderWidth: 2,
    borderColor: C.primaryMain,
    borderStyle: 'dashed',
  },
  attachmentButtonText: {
    color: C.primaryMain,
    fontSize: 14,
    fontWeight: '500',
  },
  attachmentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: C.surfaceSecondary,
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  attachmentName: {
    flex: 1,
    color: C.textPrimary,
    fontSize: 13,
  },
  rubricButton: {
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 16,
  },
  rubricButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 16,
  },
  rubricButtonText: {
    color: C.purpleMain,
    fontSize: 14,
    fontWeight: '500',
  },
  metricsGrid: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  metricCard: {
    flex: 1,
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    gap: 8,
  },
  metricValue: {
    fontSize: 24,
    fontWeight: '700',
    color: C.textPrimary,
  },
  metricLabel: {
    fontSize: 12,
    color: C.textSecondary,
  },
  scoreStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: C.surfaceSecondary,
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
  },
  scoreStat: {
    alignItems: 'center',
  },
  scoreStatLabel: {
    fontSize: 12,
    color: C.textSecondary,
    marginBottom: 4,
  },
  scoreStatValue: {
    fontSize: 20,
    fontWeight: '700',
  },
  chartTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: C.textPrimary,
    marginBottom: 12,
  },
  chartContainer: {
    backgroundColor: C.surfaceSecondary,
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
  },
  gradeBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  gradeLabel: {
    width: 30,
    fontSize: 14,
    fontWeight: '600',
    color: C.textPrimary,
  },
  gradeBarContainer: {
    flex: 1,
    height: 20,
    backgroundColor: C.surfaceTertiary,
    borderRadius: 10,
    marginHorizontal: 8,
    overflow: 'hidden',
  },
  gradeBarFill: {
    height: '100%',
    borderRadius: 10,
  },
  gradeCount: {
    width: 40,
    fontSize: 12,
    color: C.textSecondary,
    textAlign: 'right',
  },
  timelineContainer: {
    backgroundColor: C.surfaceSecondary,
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
  },
  timelineItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  timelineDate: {
    width: 60,
    fontSize: 12,
    color: C.textSecondary,
  },
  timelineBarContainer: {
    flex: 1,
    height: 20,
    backgroundColor: C.surfaceTertiary,
    borderRadius: 10,
    marginHorizontal: 8,
    overflow: 'hidden',
  },
  timelineBar: {
    height: '100%',
    backgroundColor: C.primaryMain,
    borderRadius: 10,
  },
  timelineCount: {
    width: 30,
    fontSize: 12,
    color: C.textSecondary,
    textAlign: 'right',
  },
  submissionActions: {
    flexDirection: 'row',
    gap: 8,
  },
  viewButton: {
    borderRadius: 8,
    overflow: 'hidden',
  },
  viewButtonGradient: {
    padding: 12,
  },
  downloadButton: {
    borderRadius: 8,
    overflow: 'hidden',
  },
  downloadButtonGradient: {
    padding: 12,
  },
  submissionContent: {
    backgroundColor: C.surfaceSecondary,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: C.borderLight,
  },
  submissionContentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  submissionContentLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: C.infoMain,
  },
  submissionContentText: {
    fontSize: 13,
    color: C.textPrimary,
    marginTop: 6,
    lineHeight: 18,
  },
  analyticsTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: C.textPrimary,
    marginBottom: 20,
  },

  tabContent: {
    flex: 1,
    padding: 16,
  },
  listContent: {
    paddingBottom: 20,
  },
  createButton: {
    borderRadius: 12,
    marginBottom: 16,
    overflow: 'hidden',
  },
  createButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    gap: 8,
  },
  createButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  loaderContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyIconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: C.textPrimary,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: C.textSecondary,
    textAlign: 'center',
  },
  assignmentCard: {
    backgroundColor: C.surfacePrimary,
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: C.borderLight,
  },
  assignmentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  assignmentTitleContainer: {
    flex: 1,
    gap: 8,
  },
  courseBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    overflow: 'hidden',
  },
  courseBadgeText: {
    color: C.primaryMain,
    fontSize: 11,
    fontWeight: '600',
  },
  assignmentTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: C.textPrimary,
  },
  assignmentBadges: {
    alignItems: 'flex-end',
    gap: 8,
  },
  dueBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    gap: 4,
  },
  dueText: {
    fontSize: 11,
    fontWeight: '600',
  },
  groupIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: C.infoSoft,
    borderRadius: 12,
  },
  groupIndicatorText: {
    fontSize: 10,
    color: C.infoMain,
    fontWeight: '600',
  },
  assignmentProgress: {
    marginTop: 12,
  },
  progressStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  progressStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statText: {
    fontSize: 12,
    color: C.textSecondary,
  },
  progressBarContainer: {
    height: 8,
    backgroundColor: C.surfaceSecondary,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    borderRadius: 4,
  },
  detailContainer: {
    flex: 1,
    padding: 16,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    gap: 8,
  },
  backButtonText: {
    color: C.primaryMain,
    fontSize: 15,
    fontWeight: '500',
  },
  detailTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: C.textPrimary,
    marginBottom: 8,
  },
  detailDescription: {
    fontSize: 14,
    color: C.textSecondary,
    lineHeight: 20,
    marginBottom: 24,
  },
  detailGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 24,
  },
  detailItem: {
    flex: 1,
    minWidth: '45%',
    borderRadius: 16,
    padding: 16,
    gap: 8,
  },
  detailItemFull: {
    minWidth: '100%',
  },
  detailLabel: {
    fontSize: 12,
    color: C.textSecondary,
  },
  detailValue: {
    fontSize: 16,
    color: C.textPrimary,
    fontWeight: '600',
  },
  sectionHeader: {
    fontSize: 18,
    fontWeight: '600',
    color: C.textPrimary,
    marginBottom: 16,
  },
  submissionCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  submissionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  submissionAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: C.primaryMain,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  submissionAvatarText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
  },
  submissionInfo: {
    flex: 1,
  },
  submissionName: {
    fontSize: 15,
    fontWeight: '600',
    color: C.textPrimary,
    marginBottom: 2,
  },
  submissionDate: {
    fontSize: 12,
    color: C.textSecondary,
  },
  submissionVersion: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  submissionVersionText: {
    fontSize: 11,
    fontWeight: '600',
  },
  gradingSection: {
    gap: 12,
  },
  gradeInput: {
    backgroundColor: C.surfaceSecondary,
    borderWidth: 1,
    borderColor: C.borderLight,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 13,
    color: C.textPrimary,
  },
  feedbackInput: {
    backgroundColor: C.surfaceSecondary,
    borderWidth: 1,
    borderColor: C.borderLight,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 13,
    color: C.textPrimary,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  saveButton: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  saveButtonGradient: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  emptySubmissions: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 12,
  },
  emptySubmissionsText: {
    fontSize: 14,
    color: C.textSecondary,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: C.overlayMedium,
    justifyContent: 'flex-end',
  },
  keyboardView: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: C.surfacePrimary,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    maxHeight: height * 0.9,
    flex: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: C.borderLight,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: C.textPrimary,
  },
  modalBody: {
    flex: 1,
    padding: 20,
  },
  modalFooter: {
    flexDirection: 'row',
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: C.borderLight,
    gap: 12,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: C.textSecondary,
    marginBottom: 6,
  },
  requiredStar: {
    color: C.dangerMain,
  },
  input: {
    backgroundColor: C.surfaceSecondary,
    borderWidth: 1,
    borderColor: C.borderLight,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 14,
    color: C.textPrimary,
    marginBottom: 16,
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top',
  },
  unitDropdown: {
    backgroundColor: C.surfacePrimary,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.borderLight,
    marginBottom: 16,
    padding: 4,
    maxHeight: 200,
  },
  unitOption: {
    padding: 12,
    borderRadius: 6,
  },
  unitOptionSelected: {
    backgroundColor: C.primarySoft,
  },
  unitOptionText: {
    fontSize: 14,
    color: C.textPrimary,
  },
  unitOptionTextSelected: {
    color: C.primaryMain,
    fontWeight: '600',
  },
  chipContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 20,
  },
  chip: {
    borderRadius: 30,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: C.borderLight,
  },
  chipGradient: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  chipText: {
    fontSize: 13,
    color: C.textSecondary,
  },
  chipTextActive: {
    color: '#FFFFFF',
  },
  chipActive: {},
  settingItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: C.surfaceSecondary,
    borderRadius: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: C.borderLight,
  },
  settingInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  settingText: {
    flex: 1,
    gap: 3,
  },
  settingTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: C.textPrimary,
  },
  settingDescription: {
    fontSize: 12,
    color: C.textSecondary,
    lineHeight: 16,
  },
  switch: {
    width: 52,
    height: 32,
    borderRadius: 16,
    backgroundColor: C.surfaceTertiary,
    padding: 2,
  },
  switchActive: {
    backgroundColor: C.primaryMain,
  },
  switchHandle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: C.textPrimary,
  },
  switchHandleActive: {
    transform: [{ translateX: 20 }],
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 16,
    backgroundColor: C.surfaceSecondary,
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: C.textSecondary,
  },
  rubricHint: {
    fontSize: 13,
    color: C.textSecondary,
    marginBottom: 16,
    lineHeight: 18,
  },
  rubricCriterionCard: {
    backgroundColor: C.surfaceSecondary,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: C.borderLight,
  },
  rubricCriterionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  rubricCriterionNumber: {
    fontSize: 13,
    fontWeight: '600',
    color: C.purpleMain,
  },
  addCriterionButton: {
    borderRadius: 12,
    overflow: 'hidden',
    marginTop: 4,
    marginBottom: 8,
  },
  addCriterionGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 14,
  },
  addCriterionText: {
    color: C.purpleMain,
    fontSize: 14,
    fontWeight: '500',
  },
  rubricTotalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: C.borderLight,
  },
  rubricTotalLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: C.textSecondary,
  },
  rubricTotalValue: {
    fontSize: 18,
    fontWeight: '700',
    color: C.purpleMain,
  },
  rubricSummary: {
    backgroundColor: C.surfaceSecondary,
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: C.borderLight,
  },
  rubricSummaryMeta: {
    fontSize: 12,
    color: C.textSecondary,
    marginBottom: 8,
  },
  rubricSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  rubricSummaryName: {
    flex: 1,
    fontSize: 13,
    color: C.textPrimary,
    marginRight: 8,
  },
  rubricSummaryPoints: {
    fontSize: 13,
    fontWeight: '600',
    color: C.purpleMain,
  },
});
