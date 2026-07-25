// C:\Users\evanc\Desktop\MarkWise\src\screens\lecturer\ClassManager\GroupsScreen.js
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getGroups, createGroups, updateGroup, deleteGroup, getGroupAnalytics, getUnitEnrollmentCount, distributeRemainingStudents } from '../../../utils/groupsApi';

import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import * as XLSX from 'xlsx';
import RNFS from 'react-native-fs';
import Share from 'react-native-share';
import { useAuth } from '../../../context/AuthContext';
import { fetchLecturerUnits } from '../../../utils/unitsApi';
import { useColors } from '../../../theme';

const { height } = Dimensions.get('window');

// Per-unit cache — survives remounts and back-navigation.
const _groupsCache = new Map(); // unitId → { data: Group[], ts: number }
const GROUPS_STALE_MS = 3 * 60 * 1000;

const toTitleCase = (str) =>
  str.toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());


// Enhanced Study Group Card
const EnhancedStudyGroupCard = ({ group, onToggleLock, lockLoading, onAssignLeader, onEdit, onDelete, onViewAnalytics, styles, colors }) => {
  const [expanded, setExpanded] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const heightAnim = useRef(new Animated.Value(0)).current;

  const toggleExpand = () => {
    const toValue = expanded ? 0 : 1;
    Animated.parallel([
      Animated.timing(rotateAnim, {
        toValue,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(heightAnim, {
        toValue,
        duration: 300,
        useNativeDriver: false,
      }),
    ]).start();
    setExpanded(!expanded);
  };

  const rotate = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });

  const maxHeight = heightAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 300],
  });

  // Calculate group statistics
  const totalMembers = group.members?.length || 0;

  const averageGrade = group.averageGrade || 0;
  const meetingAttendance = group.meetingAttendance || 0;

  return (
    <View style={styles.groupCard}>
      <TouchableOpacity onPress={toggleExpand} activeOpacity={0.7} onLongPress={() => setShowMenu(true)}>
        <View style={styles.groupHeader}>
          <View style={styles.groupTitleContainer}>
            <LinearGradient
              colors={[colors.primary.soft, 'transparent']}
              style={styles.courseBadge}
            >
              <Text style={styles.courseBadgeText}>{group.courseCode}</Text>
            </LinearGradient>
            <Text style={styles.groupName}>{group.name}</Text>
          </View>

          <View style={styles.groupActions}>
            <TouchableOpacity
              style={styles.groupActionButton}
              onPress={onAssignLeader}
              disabled={lockLoading}
            >
              <Icon
                name="account-star"
                size={20}
                color={colors.secondary.main}
              />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.groupActionButton}
              onPress={onToggleLock}
              disabled={lockLoading}
            >
              <Icon
                name={group.locked ? 'lock' : 'lock-open-variant'}
                size={20}
                color={group.locked ? colors.danger.main : colors.success.main}
              />
            </TouchableOpacity>

            <Animated.View style={{ transform: [{ rotate }] }}>
              <Icon name="chevron-down" size={20} color={colors.text.secondary} />
            </Animated.View>
          </View>
        </View>

        <Text style={styles.groupDescription} numberOfLines={expanded ? undefined : 2}>
          {group.description || 'No description provided'}
        </Text>

        <View style={styles.groupMetaRow}>
          <View style={styles.groupMeta}>
            <Icon name="account-star" size={14} color={colors.secondary.main} />
            <Text style={styles.groupMetaText}>
              Leader: {group.leaderName || 'Not assigned'}
            </Text>
          </View>

          <View style={styles.groupMeta}>
            <Icon name="clock-outline" size={14} color={colors.text.secondary} />
            <Text style={styles.groupMetaText}>
              {group.nextMeeting || 'No meeting'}
            </Text>
          </View>
        </View>

        {/* Quick Stats */}
        <View style={styles.groupQuickStats}>
          <View style={styles.groupQuickStat}>
            <Icon name="account-group" size={14} color={colors.info.main} />
            <Text style={styles.groupQuickStatText}>{totalMembers} members</Text>
          </View>

          <View style={styles.groupQuickStat}>
            <Icon name="star" size={14} color={colors.warning.main} />
            <Text style={styles.groupQuickStatText}>Avg: {averageGrade}%</Text>
          </View>

          <View style={styles.groupQuickStat}>
            <Icon name="calendar-check" size={14} color={colors.success.main} />
            <Text style={styles.groupQuickStatText}>{meetingAttendance}% attend</Text>
          </View>
        </View>

        {/* Capacity bar (only when backend returns capacity) */}
        {!!(group.capacity && group.capacity > 0) && (() => {
          const filled = group.memberCount ?? totalMembers;
          const pct = Math.min(100, (filled / group.capacity) * 100);
          const isFull = filled >= group.capacity;
          return (
            <View style={styles.capacitySection}>
              <View style={styles.capacityRow}>
                <Text style={styles.capacityLabel}>Capacity</Text>
                <Text style={styles.capacityCount}>{filled} / {group.capacity}</Text>
                {isFull && (
                  <View style={styles.fullBadge}>
                    <Text style={styles.fullBadgeText}>FULL</Text>
                  </View>
                )}
              </View>
              <View style={styles.capacityTrack}>
                <View style={[
                  styles.capacityFill,
                  { width: `${pct}%`, backgroundColor: isFull ? colors.danger.main : colors.success.main },
                ]} />
              </View>
              <Text style={[styles.capacityHint, isFull && { color: colors.danger.main }]}>
                {isFull ? 'No spots available' : `${group.capacity - filled} spot${group.capacity - filled !== 1 ? 's' : ''} remaining`}
              </Text>
            </View>
          );
        })()}
      </TouchableOpacity>

      <Animated.View style={[styles.expandedContent, { maxHeight, opacity: heightAnim }]}>
        {/* Members Section */}
        <View style={styles.membersSection}>
          <View style={styles.sectionHeader}>
            <Text style={styles.membersTitle}>Members ({totalMembers})</Text>
            <TouchableOpacity onPress={() => onViewAnalytics(group)}>
              <Icon name="chart-line" size={20} color={colors.primary.main} />
            </TouchableOpacity>
          </View>

          <View style={styles.membersList}>
              {(group.members || []).map((member, idx) => (
                <View key={member.id ?? member.studentId ?? idx} style={styles.memberChip}>
                  <LinearGradient
                    colors={[colors.primary.main, colors.purple.main]}
                    style={styles.memberAvatar}
                  >
                    <Text style={styles.memberAvatarText}>
                      {member.name?.charAt(0) || '?'}
                    </Text>
                  </LinearGradient>
                  <View style={styles.memberInfo}>
                    <Text style={styles.memberName} numberOfLines={1}>
                      {member.name}
                      {member.role === 'leader' ? ' 👑' : ''}
                    </Text>
                    <Text style={styles.memberAdmission} numberOfLines={1}>
                      {member.admissionNumber ?? '—'}
                    </Text>
                  </View>
                  {!!member.grade && (
                    <View style={styles.memberGrade}>
                      <Text style={styles.memberGradeText}>{member.grade}%</Text>
                    </View>
                  )}
                </View>
              ))}
          </View>
        </View>

        {/* Group Activity */}
        <View style={styles.activitySection}>
          <Text style={styles.activityTitle}>Recent Activity</Text>
          {(group.recentActivity || []).map((activity, index) => (
            <View key={index} style={styles.activityItem}>
              <Icon name={activity.icon} size={16} color={colors[activity.color]?.main || colors.primary.main} />
              <Text style={styles.activityText}>{activity.text}</Text>
              <Text style={styles.activityTime}>{activity.time}</Text>
            </View>
          ))}
        </View>
      </Animated.View>

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
                onEdit(group);
              }}
            >
              <Icon name="pencil" size={20} color={colors.info.main} />
              <Text style={styles.contextMenuItemText}>Edit Group</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.contextMenuItem}
              onPress={() => {
                setShowMenu(false);
                onViewAnalytics(group);
              }}
            >
              <Icon name="chart-bar" size={20} color={colors.primary.main} />
              <Text style={styles.contextMenuItemText}>View Analytics</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.contextMenuItem, styles.contextMenuItemDanger]}
              onPress={() => {
                setShowMenu(false);
                onDelete(group.id);
              }}
            >
              <Icon name="delete" size={20} color={colors.danger.main} />
              <Text style={[styles.contextMenuItemText, { color: colors.danger.main }]}>
                Delete Group
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

// Group Analytics Modal
const GroupAnalyticsModal = ({ visible, onClose, group, styles, colors }) => {
  if (!group) return null;

  const memberGrades = group.members?.map(m => m.grade || 0) || [];
  const averageGrade = memberGrades.reduce((a, b) => a + b, 0) / (memberGrades.length || 1);

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContent, { maxHeight: height * 0.8 }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Group Analytics</Text>
            <TouchableOpacity onPress={onClose}>
              <Icon name="close" size={24} color={colors.text.secondary} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalBody}>
            <Text style={styles.analyticsTitle}>{group.name}</Text>

            {/* Key Metrics */}
            <View style={styles.metricsGrid}>
              <LinearGradient
                colors={[colors.primary.soft, 'transparent']}
                style={styles.metricCard}
              >
                <Icon name="account-group" size={24} color={colors.primary.main} />
                <Text style={styles.metricValue}>{group.members?.length || 0}</Text>
                <Text style={styles.metricLabel}>Members</Text>
              </LinearGradient>

              <LinearGradient
                colors={[colors.success.soft, 'transparent']}
                style={styles.metricCard}
              >
                <Icon name="star" size={24} color={colors.success.main} />
                <Text style={styles.metricValue}>{averageGrade.toFixed(1)}%</Text>
                <Text style={styles.metricLabel}>Avg Grade</Text>
              </LinearGradient>

              <LinearGradient
                colors={[colors.warning.soft, 'transparent']}
                style={styles.metricCard}
              >
                <Icon name="calendar-check" size={24} color={colors.warning.main} />
                <Text style={styles.metricValue}>{group.meetingAttendance || 0}%</Text>
                <Text style={styles.metricLabel}>Attendance</Text>
              </LinearGradient>
            </View>

            {/* Grade Distribution */}
            <Text style={styles.chartTitle}>Grade Distribution</Text>
            <View style={styles.chartContainer}>
              {['A', 'B', 'C', 'D', 'F'].map((grade, index) => {
                const count = group.gradeDistribution?.[grade] || 0;
                const percentage = (count / (group.members?.length || 1)) * 100;
                const gradeColors = [colors.success.main, colors.info.main, colors.primary.main, colors.warning.main, colors.danger.main];

                return (
                  <View key={grade} style={styles.gradeBar}>
                    <Text style={styles.gradeLabel}>{grade}</Text>
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

            {/* Member Performance */}
            <Text style={styles.chartTitle}>Member Performance</Text>
            {group.members?.map((member, index) => (
              <View key={member.id ?? member.studentId ?? index} style={styles.memberPerformance}>
                <View style={styles.memberPerformanceHeader}>
                  <View style={styles.memberPerformanceAvatar}>
                    <Text>{member.name?.charAt(0) || '?'}</Text>
                  </View>
                  <View style={styles.memberPerformanceInfo}>
                    <Text style={styles.memberPerformanceName}>{member.name}</Text>
                    <Text style={styles.memberPerformanceRole}>
                      {member.role === 'leader' ? 'Leader' : 'Member'}
                    </Text>
                  </View>
                  <Text style={styles.memberPerformanceGrade}>{member.grade || 0}%</Text>
                </View>
                <View style={styles.memberPerformanceBar}>
                  <View
                    style={[
                      styles.memberPerformanceFill,
                      { width: `${member.grade || 0}%` }
                    ]}
                  />
                </View>
              </View>
            ))}

            {/* Meeting Attendance */}
            {group.meetings && (
              <>
                <Text style={styles.chartTitle}>Meeting Attendance</Text>
                {group.meetings.map((meeting, index) => (
                  <View key={index} style={styles.meetingItem}>
                    <Text style={styles.meetingDate}>{meeting.date}</Text>
                    <View style={styles.meetingAttendanceBar}>
                      <View
                        style={[
                          styles.meetingAttendanceFill,
                          { width: `${meeting.attendance}%` }
                        ]}
                      />
                    </View>
                    <Text style={styles.meetingAttendanceText}>{meeting.attendance}%</Text>
                  </View>
                ))}
              </>
            )}
          </ScrollView>

          <View style={styles.modalFooter}>
            <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
              <Text style={styles.cancelButtonText}>Close</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.createButton}>
              <LinearGradient
                colors={colors.primary.gradient}
                style={styles.createButtonGradient}
              >
                <Icon name="export" size={20} color="#FFFFFF" />
                <Text style={styles.createButtonText}>Export Report</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

// Enhanced Group Creation Modal
const EnhancedCreateGroupModal = ({ visible, onClose, onCreate, unitCode, units = [], styles, colors }) => {
  const [formData, setFormData] = useState({
    unitCode: unitCode || '',
    groupSize: '',
    numGroups: '',
    createMode: 'size',
    groupNames: [],
    autoAssignLeaders: true,
    allowSelfEnroll: false,
    maxGroupsPerStudent: 1,
    description: '',
    tags: [],
  });
  const [unitPickerVisible, setUnitPickerVisible] = useState(false);

  // ── Enrolled count (for live preview) ──────────────────────────────
  const [enrolledCount, setEnrolledCount] = useState(0);
  const [enrolledLoading, setEnrolledLoading] = useState(false);

  // Sync the pre-selected unit whenever the modal opens or unitCode changes
  React.useEffect(() => {
    if (visible) {
      setFormData(prev => ({ ...prev, unitCode: unitCode || prev.unitCode || '' }));
    }
  }, [visible, unitCode]);

  // Fetch enrollment count whenever unitCode changes inside the modal
  React.useEffect(() => {
    if (!formData.unitCode) { setEnrolledCount(0); return; }
    let cancelled = false;
    setEnrolledLoading(true);
    getUnitEnrollmentCount(formData.unitCode)
      .then(n => { if (!cancelled) { setEnrolledCount(n); setEnrolledLoading(false); } })
      .catch(() => { if (!cancelled) { setEnrolledCount(0); setEnrolledLoading(false); } });
    return () => { cancelled = true; };
  }, [formData.unitCode]);

  // Compute live group-split preview (pure arithmetic, no API call)
  const getPreview = () => {
    if (!enrolledCount || enrolledCount <= 0) return null;
    const E = enrolledCount;
    if (formData.createMode === 'size') {
      const N = parseInt(formData.groupSize, 10);
      if (!N || N <= 0 || N > E) return null;
      const G = Math.ceil(E / N);
      const lastSize = E - (G - 1) * N;
      return (lastSize === N)
        ? { groups: G, line1: `${G} group${G !== 1 ? 's' : ''} × ${N} students each` }
        : { groups: G, line1: `${G - 1} group${G - 1 !== 1 ? 's' : ''} × ${N}, 1 group × ${lastSize}` };
    } else {
      const G = parseInt(formData.numGroups, 10);
      if (!G || G <= 0 || G > E) return null;
      const base = Math.floor(E / G);
      const big = E % G;
      return (big === 0)
        ? { groups: G, line1: `${G} group${G !== 1 ? 's' : ''} × ${base} students each` }
        : { groups: G, line1: `${big} group${big !== 1 ? 's' : ''} × ${base + 1}, ${G - big} group${G - big !== 1 ? 's' : ''} × ${base}` };
    }
  };
  const preview = getPreview();

  const [importModalVisible, setImportModalVisible] = useState(false);
  const [importData, setImportData] = useState('');

  const handleCreate = () => {
    if (!formData.unitCode) {
      Alert.alert('Error', 'Please select a unit');
      return;
    }

    const params = {
      unitCode: formData.unitCode,
      groupSize: formData.createMode === 'size' ? Number(formData.groupSize) : undefined,
      numGroups: formData.createMode === 'number' ? Number(formData.numGroups) : undefined,
      autoAssignLeaders: formData.autoAssignLeaders,
      allowSelfEnroll: formData.allowSelfEnroll,
      maxGroupsPerStudent: formData.maxGroupsPerStudent,
      description: formData.description,
      tags: formData.tags,
    };

    onCreate(params);
  };

  const handleImportFromCSV = () => {
    try {
      // Parse CSV data
      const rows = importData.split('\n').map(row => row.split(','));
      const headers = rows[0];
      const groups = rows.slice(1).map(row => {
        const group = {};
        headers.forEach((header, index) => {
          group[header.trim()] = row[index]?.trim();
        });
        return group;
      });

      setFormData(prev => ({ ...prev, groupNames: groups.map(g => g.name) }));
      setImportModalVisible(false);
      Alert.alert('Success', `Imported ${groups.length} groups`);
    } catch (err) {
      Alert.alert('Error', 'Failed to parse CSV data');
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.keyboardView}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Create Groups</Text>
              <TouchableOpacity onPress={onClose}>
                <Icon name="close" size={24} color={colors.text.secondary} />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.modalBody}
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.inputLabel}>Unit</Text>
              {units.length > 0 ? (
                <>
                  <TouchableOpacity
                    style={styles.unitPickerButton}
                    onPress={() => setUnitPickerVisible(true)}
                    activeOpacity={0.7}
                  >
                    <Icon name="book-education-outline" size={16} color={colors.primary.main} />
                    <Text style={[
                      styles.unitPickerButtonText,
                      !formData.unitCode && { color: colors.text.tertiary },
                    ]} numberOfLines={1}>
                      {formData.unitCode
                        ? (units.find(u => u.unitId === formData.unitCode || u.code === formData.unitCode)?.display
                          || units.find(u => u.unitId === formData.unitCode || u.code === formData.unitCode)?.name
                          || formData.unitCode)
                        : 'Select a unit…'}
                    </Text>
                    <Icon name="chevron-down" size={18} color={colors.primary.main} />
                  </TouchableOpacity>

                  {/* Unit picker sheet */}
                  <Modal visible={unitPickerVisible} transparent animationType="fade">
                    <TouchableOpacity
                      style={styles.unitDropdownOverlay}
                      activeOpacity={1}
                      onPress={() => setUnitPickerVisible(false)}
                    >
                      <View style={styles.unitDropdownContent}>
                        <View style={styles.unitDropdownHeader}>
                          <Text style={styles.unitDropdownTitle}>Select Unit</Text>
                          <TouchableOpacity onPress={() => setUnitPickerVisible(false)}>
                            <Icon name="close" size={22} color={colors.text.secondary} />
                          </TouchableOpacity>
                        </View>
                        <FlatList
                          data={units}
                          keyExtractor={item => String(item.unitId || item.code)}
                          renderItem={({ item }) => {
                            const isActive = item.unitId === formData.unitCode || item.code === formData.unitCode;
                            return (
                              <TouchableOpacity
                                onPress={() => {
                                  setFormData(d => ({ ...d, unitCode: item.unitId || item.code }));
                                  setUnitPickerVisible(false);
                                }}
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
                        />
                      </View>
                    </TouchableOpacity>
                  </Modal>
                </>
              ) : (
                <TextInput
                  style={styles.input}
                  placeholder="e.g., CSC301"
                  placeholderTextColor={colors.text.tertiary}
                  value={formData.unitCode}
                  onChangeText={t => setFormData(d => ({ ...d, unitCode: t }))}
                  autoCapitalize="characters"
                />
              )}

              {/* Enrollment count banner */}
              {formData.unitCode ? (
                <View style={styles.enrolledBanner}>
                  {enrolledLoading ? (
                    <ActivityIndicator size="small" color={colors.primary.main} />
                  ) : (
                    <>
                      <Icon name="account-group" size={16} color={colors.primary.main} />
                      <Text style={styles.enrolledBannerText}>
                        {enrolledCount > 0
                          ? `${enrolledCount} student${enrolledCount !== 1 ? 's' : ''} enrolled in ${formData.unitCode}`
                          : 'Enrollment count unavailable — preview disabled'}
                      </Text>
                    </>
                  )}
                </View>
              ) : null}

              <Text style={styles.inputLabel}>Description (Optional)</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder="Describe the groups..."
                placeholderTextColor={colors.text.tertiary}
                value={formData.description}
                onChangeText={t => setFormData(d => ({ ...d, description: t }))}
                multiline
                textAlignVertical="top"
              />

              <Text style={styles.inputLabel}>Creation Method</Text>
              <View style={styles.typeContainer}>
                <TouchableOpacity
                  style={[
                    styles.typeButton,
                    formData.createMode === 'size' && styles.typeButtonActive
                  ]}
                  onPress={() => setFormData(d => ({ ...d, createMode: 'size' }))}
                >
                  <LinearGradient
                    colors={formData.createMode === 'size' ? colors.primary.gradient : ['transparent', 'transparent']}
                    style={styles.typeButtonGradient}
                  >
                    <Text style={formData.createMode === 'size' ? styles.typeButtonTextActive : styles.typeButtonText}>
                      By Group Size
                    </Text>
                  </LinearGradient>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.typeButton,
                    formData.createMode === 'number' && styles.typeButtonActive
                  ]}
                  onPress={() => setFormData(d => ({ ...d, createMode: 'number' }))}
                >
                  <LinearGradient
                    colors={formData.createMode === 'number' ? colors.primary.gradient : ['transparent', 'transparent']}
                    style={styles.typeButtonGradient}
                  >
                    <Text style={formData.createMode === 'number' ? styles.typeButtonTextActive : styles.typeButtonText}>
                      By Number of Groups
                    </Text>
                  </LinearGradient>
                </TouchableOpacity>
              </View>

              {formData.createMode === 'size' ? (
                <>
                  <Text style={styles.inputLabel}>Group Size</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g., 5"
                    placeholderTextColor={colors.text.tertiary}
                    value={formData.groupSize}
                    onChangeText={t => setFormData(d => ({ ...d, groupSize: t }))}
                    keyboardType="numeric"
                  />
                </>
              ) : (
                <>
                  <Text style={styles.inputLabel}>Number of Groups</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g., 4"
                    placeholderTextColor={colors.text.tertiary}
                    value={formData.numGroups}
                    onChangeText={t => setFormData(d => ({ ...d, numGroups: t }))}
                    keyboardType="numeric"
                  />
                </>
              )}

              {/* Live group-split preview */}
              {preview ? (
                <View style={styles.previewBox}>
                  <View style={styles.previewRow}>
                    <Icon name="eye-outline" size={16} color={colors.success.main} />
                    <Text style={styles.previewTitle}>Preview</Text>
                  </View>
                  <Text style={styles.previewLine}>{preview.line1}</Text>
                  <Text style={styles.previewTotal}>
                    {enrolledCount} student{enrolledCount !== 1 ? 's' : ''} → {preview.groups} group{preview.groups !== 1 ? 's' : ''}
                  </Text>
                </View>
              ) : (enrolledCount > 0 && (formData.groupSize || formData.numGroups)) ? (
                <View style={styles.previewBoxWarn}>
                  <Icon name="alert-circle-outline" size={16} color={colors.warning.main} />
                  <Text style={styles.previewWarnText}>
                    Enter a valid {formData.createMode === 'size' ? 'group size' : 'number of groups'} (1 – {enrolledCount})
                  </Text>
                </View>
              ) : null}

              {/* Import from CSV */}
              <TouchableOpacity
                style={styles.importButton}
                onPress={() => setImportModalVisible(true)}
              >
                <LinearGradient
                  colors={[colors.info.soft, 'transparent']}
                  style={styles.importButtonGradient}
                >
                  <Icon name="file-import" size={20} color={colors.info.main} />
                  <Text style={styles.importButtonText}>Import from CSV</Text>
                </LinearGradient>
              </TouchableOpacity>

              {/* Group Names (if imported) */}
              {formData.groupNames.length > 0 && (
                <View style={styles.groupNamesContainer}>
                  <Text style={styles.groupNamesTitle}>Imported Groups:</Text>
                  {formData.groupNames.map((name, index) => (
                    <Text key={index} style={styles.groupNameItem}>• {name}</Text>
                  ))}
                </View>
              )}

              {/* Advanced Settings */}
              <Text style={styles.sectionTitle}>Advanced Settings</Text>

              <View style={styles.settingItem}>
                <View style={styles.settingInfo}>
                  <Icon name="account-star" size={24} color={colors.secondary.main} />
                  <View style={styles.settingText}>
                    <Text style={styles.settingTitle}>Auto-assign Leaders</Text>
                    <Text style={styles.settingDescription}>Automatically assign group leaders</Text>
                  </View>
                </View>
                <Switch
                  value={formData.autoAssignLeaders}
                  onValueChange={(value) => setFormData(d => ({ ...d, autoAssignLeaders: value }))}
                  trackColor={{ false: colors.surface.tertiary, true: colors.secondary.main }}
                  thumbColor={colors.text.primary}
                />
              </View>

              <View style={styles.settingItem}>
                <View style={styles.settingInfo}>
                  <Icon name="account-plus" size={24} color={colors.success.main} />
                  <View style={styles.settingText}>
                    <Text style={styles.settingTitle}>Allow Self-Enrollment</Text>
                    <Text style={styles.settingDescription}>Students can join groups themselves</Text>
                  </View>
                </View>
                <Switch
                  value={formData.allowSelfEnroll}
                  onValueChange={(value) => setFormData(d => ({ ...d, allowSelfEnroll: value }))}
                  trackColor={{ false: colors.surface.tertiary, true: colors.success.main }}
                  thumbColor={colors.text.primary}
                />
              </View>

              {formData.allowSelfEnroll && (
                <>
                  <Text style={styles.inputLabel}>Max Groups Per Student</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="1"
                    placeholderTextColor={colors.text.tertiary}
                    value={formData.maxGroupsPerStudent.toString()}
                    onChangeText={t => setFormData(d => ({ ...d, maxGroupsPerStudent: Number(t) || 1 }))}
                    keyboardType="numeric"
                  />
                </>
              )}

              {/* Tags */}
              <Text style={styles.inputLabel}>Tags (comma separated)</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g., project, lab, tutorial"
                placeholderTextColor={colors.text.tertiary}
                value={formData.tags.join(', ')}
                onChangeText={t => setFormData(d => ({ ...d, tags: t.split(',').map(s => s.trim()) }))}
              />
            </ScrollView>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={onClose}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.createButton}
                onPress={handleCreate}
              >
                <LinearGradient
                  colors={colors.success.gradient}
                  style={styles.createButtonGradient}
                >
                  <Text style={styles.createButtonText}>Create Groups</Text>
                  <Icon name="check" size={20} color="#FFFFFF" />
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>

      {/* Import CSV Modal */}
      <Modal visible={importModalVisible} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: height * 0.6 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Import Groups from CSV</Text>
              <TouchableOpacity onPress={() => setImportModalVisible(false)}>
                <Icon name="close" size={24} color={colors.text.secondary} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody}>
              <Text style={styles.importHelp}>
                Paste CSV data with columns: name, description, leader, members
              </Text>
              <TextInput
                style={[styles.input, styles.textArea, { height: 200 }]}
                placeholder="name,description,leader,members&#10;Group 1,Project Group,John Smith,john,alice,bob"
                placeholderTextColor={colors.text.tertiary}
                value={importData}
                onChangeText={setImportData}
                multiline
                textAlignVertical="top"
              />
            </ScrollView>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => setImportModalVisible(false)}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.createButton}
                onPress={handleImportFromCSV}
              >
                <LinearGradient
                  colors={colors.success.gradient}
                  style={styles.createButtonGradient}
                >
                  <Text style={styles.createButtonText}>Import</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </Modal>
  );
};

// Main GroupsScreen Component
export default function GroupsScreen({
  route,
  selectedUnitId: propUnitId,
  assignedUnits: propUnits,
  lecturerData: propLecturerData,
  onRefresh: parentRefresh,
  refreshing: parentRefreshing = false
}) {
  const { user } = useAuth();
  const colors = useColors();
  const C = useMemo(() => ({
    bg:               colors.background.primary,
    surfacePrimary:   colors.surface.primary,
    surfaceSecondary: colors.surface.secondary,
    surfaceTertiary:  colors.surface.tertiary,
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
    dangerMain:       colors.danger.main,
    dangerSoft:       colors.danger.soft,
    infoMain:         colors.info.main,
    infoSoft:         colors.info.soft,
    secondaryMain:    colors.secondary.main,
    overlayMedium:    colors.overlay.medium,
  }), [colors]);
  const styles = useMemo(() => makeStyles(C), [C]);

  const [selectedUnitId, setSelectedUnitId] = useState(propUnitId ?? route?.params?.selectedUnitId ?? '');
  const [units, setUnits] = useState(() => {
    const passed = propUnits ?? route?.params?.assignedUnits ?? [];
    return Array.isArray(passed) ? passed : [];
  });
  const [unitDropdownVisible, setUnitDropdownVisible] = useState(false);
  const [studyGroups, setStudyGroups] = useState([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [createGroupModalVisible, setCreateGroupModalVisible] = useState(false);
  const [editingGroup, setEditingGroup] = useState(null);
  const [analyticsModalVisible, setAnalyticsModalVisible] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [filterStatus, setFilterStatus] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Leader Assignment State
  const [leaderModalVisible, setLeaderModalVisible] = useState(false);
  const [leaderGroup, setLeaderGroup] = useState(null);
  const [leaderLoading, setLeaderLoading] = useState(false);
  const [selectedLeaderId, setSelectedLeaderId] = useState(null);

  // Fetch lecturer units if not provided via props/route
  useEffect(() => {
    const passedUnits = propUnits ?? route?.params?.assignedUnits ?? [];
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
        .catch(err => console.error('[GroupsScreen] fetch units error:', err));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.lecturerId]);

  // Normalise a raw member object from the backend into a consistent shape
  const normaliseMember = (m) => {
    // Backend returns: { studentId, studentName, role }
    const name =
      m.studentName ||
      m.name ||
      m.full_name ||
      m.student_name ||
      m.fullName ||
      (m.first_name || m.last_name
        ? `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim()
        : null) ||
      null;

    const admissionNumber =
      m.admissionNumber ||
      m.admission_number ||
      m.admission_no ||
      m.admissionNo ||
      m.reg_no ||
      m.regNo ||
      m.reg_number ||
      m.registration_number ||
      m.registration_no ||
      m.student_reg ||
      m.student_no ||
      m.student_number ||
      m.matric ||
      m.matric_no ||
      m.matric_number ||
      m.index_no ||
      m.enrollment_no ||
      null;

    const id = m.id ?? m.studentId ?? m.student_id;
    const role = m.role ?? 'member';

    return {
      ...m,
      id,
      name,
      admissionNumber,
      role,
    };
  };

  // Fetch groups for selected unit — stale-while-revalidate via module-level cache.
  const loadGroups = useCallback(async (unitCode, force = false) => {
    if (!unitCode) return;
    const cached = _groupsCache.get(unitCode);
    if (cached) setStudyGroups(cached.data);
    if (!force && cached && Date.now() - cached.ts < GROUPS_STALE_MS) return;
    if (!cached) setGroupsLoading(true);
    try {
      const data = await getGroups(unitCode);
      const enriched = await Promise.all(
        (Array.isArray(data) ? data : []).map(async (group) => {
          try {
            const analytics = await getGroupAnalytics(group.id);
            const merged = { ...group, ...analytics };
            if (Array.isArray(merged.members)) merged.members = merged.members.map(normaliseMember);
            return merged;
          } catch {
            const g = { ...group };
            if (Array.isArray(g.members)) g.members = g.members.map(normaliseMember);
            return g;
          }
        })
      );
      _groupsCache.set(unitCode, { data: enriched, ts: Date.now() });
      setStudyGroups(enriched);
    } catch (err) {
      console.error('Error loading groups:', err);
      if (!cached && err?.message && !err.message.includes('404') && !err.message.includes('not yet')) {
        Alert.alert('Error', err.message || 'Failed to load groups');
      }
      if (!cached) setStudyGroups([]);
    } finally {
      setGroupsLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load data when selectedUnitId changes
  useEffect(() => {
    if (selectedUnitId) {
      loadGroups(selectedUnitId);
    }
  }, [selectedUnitId, loadGroups]);

  useEffect(() => {
    if (route?.params?.openCreateModal) {
      setCreateGroupModalVisible(true);
    }
  }, [route?.params?.openCreateModal]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    if (selectedUnitId) {
      _groupsCache.delete(selectedUnitId);
      await loadGroups(selectedUnitId, true);
    }
    if (parentRefresh) await parentRefresh();
    setRefreshing(false);
  }, [selectedUnitId, loadGroups, parentRefresh]);

  // Filter groups — memoized to avoid recomputing on every render.
  const getFilteredGroups = useMemo(() => {
    let filtered = [...studyGroups];
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(g =>
        (g.name || '').toLowerCase().includes(q) ||
        (g.description || '').toLowerCase().includes(q) ||
        (g.courseCode || g.unitCode || '').toLowerCase().includes(q)
      );
    }
    if (filterStatus !== 'all') {
      filtered = filtered.filter(g => {
        if (filterStatus === 'locked')     return g.locked;
        if (filterStatus === 'active')     return !g.locked;
        if (filterStatus === 'hasLeader')  return g.leaderId;
        return true;
      });
    }
    return filtered;
  }, [studyGroups, searchQuery, filterStatus]);

  // Group handlers
  const handleToggleLock = async (groupId, currentLocked, courseCode) => {
    const unitKey = courseCode || selectedUnitId;
    try {
      setGroupsLoading(true);
      await updateGroup({ groupId, data: { locked: !currentLocked } });
      _groupsCache.delete(unitKey);
      loadGroups(unitKey, true);
      Alert.alert('Success', `Group ${currentLocked ? 'unlocked' : 'locked'} successfully`);
    } catch (e) {
      Alert.alert('Error', e.message || 'Failed to update group lock');
    } finally {
      setGroupsLoading(false);
    }
  };

  const handleDeleteGroup = (groupId) => {
    Alert.alert(
      'Delete Group',
      'Are you sure you want to delete this group? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteGroup(groupId);
              Alert.alert('Success', 'Group deleted successfully');
              _groupsCache.delete(selectedUnitId);
              loadGroups(selectedUnitId, true);
            } catch (err) {
              Alert.alert('Error', err.message || 'Failed to delete group');
            }
          }
        }
      ]
    );
  };

  const handleEditGroup = (group) => {
    setEditingGroup(group);
    setCreateGroupModalVisible(true);
  };

  const handleViewAnalytics = (group) => {
    setSelectedGroup(group);
    setAnalyticsModalVisible(true);
  };

  const openLeaderModal = (group) => {
    setLeaderGroup(group);
    setSelectedLeaderId(group.leaderId || null);
    setLeaderModalVisible(true);
  };

  const handleAssignLeader = async () => {
    if (!leaderGroup || !selectedLeaderId) {
      Alert.alert('Error', 'Please select a leader');
      return;
    }

    setLeaderLoading(true);
    try {
      await updateGroup({ groupId: leaderGroup.id, data: { leaderId: selectedLeaderId } });
      Alert.alert('Success', 'Group leader assigned successfully');
      setLeaderModalVisible(false);
      setLeaderGroup(null);
      setSelectedLeaderId(null);
      const unitKey = leaderGroup.courseCode || leaderGroup.unitCode || selectedUnitId;
      _groupsCache.delete(unitKey);
      loadGroups(unitKey, true);
    } catch (e) {
      Alert.alert('Error', e.message || 'Failed to assign leader');
    } finally {
      setLeaderLoading(false);
    }
  };

  // Create group handler
  const handleCreateGroups = async (params) => {
    try {
      await createGroups(params);
      setCreateGroupModalVisible(false);
      setEditingGroup(null);
      _groupsCache.delete(params.unitCode);
      loadGroups(params.unitCode, true);
      Alert.alert('Success', 'Groups created successfully');
    } catch (e) {
      Alert.alert('Error', e.message || 'Failed to create groups');
    }
  };

  // Distribute remaining (unjoined) students across available groups
  const handleDistributeRemaining = () => {
    Alert.alert(
      'Distribute Remaining Students',
      'Students not yet in any group will be automatically assigned to groups with available capacity.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Distribute',
          onPress: async () => {
            try {
              await distributeRemainingStudents(selectedUnitId);
              Alert.alert('Success', 'Students distributed successfully');
              _groupsCache.delete(selectedUnitId);
              loadGroups(selectedUnitId, true);
            } catch (e) {
              Alert.alert('Error', e.message || 'Failed to distribute students');
            }
          },
        },
      ],
    );
  };

  const handleUpdateGroup = async (params) => {
    try {
      await updateGroup({ groupId: editingGroup.id, data: params });
      setCreateGroupModalVisible(false);
      setEditingGroup(null);
      const unitKey = editingGroup.courseCode || editingGroup.unitCode || selectedUnitId;
      _groupsCache.delete(unitKey);
      loadGroups(unitKey, true);
      Alert.alert('Success', 'Group updated successfully');
    } catch (e) {
      Alert.alert('Error', e.message || 'Failed to update group');
    }
  };

  const handleExportGroups = async () => {
    try {
      const ws = XLSX.utils.json_to_sheet(studyGroups);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Groups');
      const wbout = XLSX.write(wb, { type: 'binary', bookType: 'xlsx' });

      const filePath = RNFS.DocumentDirectoryPath + '/groups.xlsx';
      await RNFS.writeFile(filePath, wbout, 'ascii');

      await Share.open({
        url: 'file://' + filePath,
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
    } catch (err) {
      Alert.alert('Error', 'Failed to export groups');
    }
  };

  const filteredGroups = getFilteredGroups;
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
            placeholder="Search groups..."
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
            style={[styles.filterChip, filterStatus === 'locked' && styles.filterChipActive]}
            onPress={() => setFilterStatus('locked')}
          >
            <Text style={[styles.filterChipText, filterStatus === 'locked' && styles.filterChipTextActive]}>
              Locked
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.filterChip, filterStatus === 'hasLeader' && styles.filterChipActive]}
            onPress={() => setFilterStatus('hasLeader')}
          >
            <Text style={[styles.filterChipText, filterStatus === 'hasLeader' && styles.filterChipTextActive]}>
              Has Leader
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </View>

      {/* Action Buttons */}
      <View style={styles.actionButtons}>
        <TouchableOpacity
          style={styles.createButton}
          onPress={() => {
            setEditingGroup(null);
            setCreateGroupModalVisible(true);
          }}
        >
          <LinearGradient
            colors={colors.primary.gradient}
            style={styles.createButtonGradient}
          >
            <Icon name="account-group" size={20} color="#FFFFFF" />
            <Text style={styles.createButtonText}>Create Groups</Text>
          </LinearGradient>
        </TouchableOpacity>

        {studyGroups.length > 0 && (
          <TouchableOpacity
            style={styles.exportButton}
            onPress={handleExportGroups}
          >
            <LinearGradient
              colors={[colors.info.soft, 'transparent']}
              style={styles.exportButtonGradient}
            >
              <Icon name="export" size={20} color={colors.info.main} />
              <Text style={styles.exportButtonText}>Export</Text>
            </LinearGradient>
          </TouchableOpacity>
        )}

        {studyGroups.length > 0 && (
          <TouchableOpacity
            style={styles.distributeButton}
            onPress={handleDistributeRemaining}
          >
            <LinearGradient
              colors={[colors.warning.soft, 'transparent']}
              style={styles.exportButtonGradient}
            >
              <Icon name="account-arrow-right" size={20} color={colors.warning.main} />
              <Text style={[styles.exportButtonText, { color: colors.warning.main }]}>Distribute</Text>
            </LinearGradient>
          </TouchableOpacity>
        )}
      </View>

      {groupsLoading ? (
        <View style={styles.loaderContainer}>
          <ActivityIndicator size="large" color={colors.primary.main} />
        </View>
      ) : filteredGroups.length === 0 ? (
        <ScrollView
          contentContainerStyle={styles.emptyContainer}
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
          <LinearGradient
            colors={[colors.primary.soft, 'transparent']}
            style={styles.emptyIconContainer}
          >
            <Icon name="account-group-outline" size={64} color={colors.primary.main} />
          </LinearGradient>
          <Text style={styles.emptyTitle}>No Groups Found</Text>
          <Text style={styles.emptyText}>Create your first study group to get started</Text>
        </ScrollView>
      ) : (
        <FlatList
          data={filteredGroups}
          keyExtractor={item => String(item.id ?? item.groupId ?? item.group_id ?? item.name ?? Math.random())}
          renderItem={({ item }) => (
            <EnhancedStudyGroupCard
              group={item}
              onToggleLock={() => handleToggleLock(item.id, item.locked, item.courseCode || item.unitCode || selectedUnitId)}
              lockLoading={groupsLoading}
              onAssignLeader={() => openLeaderModal(item)}
              onEdit={handleEditGroup}
              onDelete={handleDeleteGroup}
              onViewAnalytics={handleViewAnalytics}
              styles={styles}
              colors={colors}
            />
          )}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing || parentRefreshing}
              onRefresh={handleRefresh}
              tintColor={colors.primary.main}
              colors={[colors.primary.main]}
            />
          }
        />
      )}

      {/* Create/Edit Group Modal */}
      <EnhancedCreateGroupModal
        visible={createGroupModalVisible}
        onClose={() => {
          setCreateGroupModalVisible(false);
          setEditingGroup(null);
        }}
        onCreate={editingGroup ? handleUpdateGroup : handleCreateGroups}
        unitCode={selectedUnitId}
        units={units}
        styles={styles}
        colors={colors}
      />

      {/* Assign Leader Modal */}
      <Modal visible={leaderModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.keyboardView}
          >
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Assign Group Leader</Text>
                <TouchableOpacity onPress={() => {
                  setLeaderModalVisible(false);
                  setLeaderGroup(null);
                  setSelectedLeaderId(null);
                }}>
                  <Icon name="close" size={24} color={colors.text.secondary} />
                </TouchableOpacity>
              </View>

              <ScrollView
                style={styles.modalBody}
                showsVerticalScrollIndicator={false}
              >
                <Text style={styles.modalDescription}>
                  Select a member to assign as group leader for {leaderGroup?.name}
                </Text>

                {leaderGroup?.members?.map((member, idx) => (
                  <TouchableOpacity
                    key={member.id ?? member.studentId ?? idx}
                    style={[
                      styles.memberOption,
                      selectedLeaderId === member.id && styles.memberOptionSelected
                    ]}
                    onPress={() => setSelectedLeaderId(member.id)}
                  >
                    <LinearGradient
                      colors={selectedLeaderId === member.id ? colors.primary.gradient : [colors.surface.secondary, colors.surface.tertiary]}
                      style={styles.memberOptionAvatar}
                    >
                      <Text style={styles.memberOptionAvatarText}>
                        {member.name?.charAt(0) || '?'}
                      </Text>
                    </LinearGradient>
                    <View style={styles.memberOptionInfo}>
                      <Text style={[
                        styles.memberOptionName,
                        selectedLeaderId === member.id && styles.memberOptionNameSelected
                      ]}>
                        {member.name}
                      </Text>
                      {!!member.grade && (
                        <Text style={styles.memberOptionGrade}>{member.grade}%</Text>
                      )}
                    </View>
                    {member.role === 'leader' && (
                      <View style={styles.currentLeaderBadge}>
                        <Text style={styles.currentLeaderBadgeText}>Current</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <View style={styles.modalFooter}>
                <TouchableOpacity
                  style={styles.cancelButton}
                  onPress={() => {
                    setLeaderModalVisible(false);
                    setLeaderGroup(null);
                    setSelectedLeaderId(null);
                  }}
                  disabled={leaderLoading}
                >
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.createButton, leaderLoading && styles.disabledButton]}
                  onPress={handleAssignLeader}
                  disabled={leaderLoading || !selectedLeaderId}
                >
                  <LinearGradient
                    colors={leaderLoading ? ['#6B7280', '#4B5563'] : colors.success.gradient}
                    style={styles.createButtonGradient}
                  >
                    <Text style={styles.createButtonText}>
                      {leaderLoading ? 'Assigning...' : 'Assign Leader'}
                    </Text>
                    {!leaderLoading && <Icon name="check" size={20} color="#FFFFFF" />}
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* Analytics Modal */}
      <GroupAnalyticsModal
        visible={analyticsModalVisible}
        onClose={() => {
          setAnalyticsModalVisible(false);
          setSelectedGroup(null);
        }}
        group={selectedGroup}
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
  unitPickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.primarySoft,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: C.primaryMain + '40',
    gap: 8,
  },
  unitPickerButtonText: {
    flex: 1,
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
  actionButtons: {
    flexDirection: 'row',
    padding: 16,
    gap: 12,
  },
  exportButton: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  exportButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  exportButtonText: {
    color: C.infoMain,
    fontSize: 15,
    fontWeight: '600',
  },
  groupQuickStats: {
    flexDirection: 'row',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: C.borderLight,
    gap: 16,
  },
  groupQuickStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  groupQuickStatText: {
    fontSize: 11,
    color: C.textSecondary,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  activitySection: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: C.borderLight,
  },
  activityTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: C.textPrimary,
    marginBottom: 12,
  },
  activityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  activityText: {
    flex: 1,
    fontSize: 13,
    color: C.textPrimary,
  },
  activityTime: {
    fontSize: 11,
    color: C.textSecondary,
  },
  memberGrade: {
    backgroundColor: C.successSoft,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    marginLeft: 4,
  },
  memberGradeText: {
    color: C.successMain,
    fontSize: 10,
    fontWeight: '600',
  },
  importButton: {
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 16,
  },
  importButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 16,
  },
  importButtonText: {
    color: C.infoMain,
    fontSize: 14,
    fontWeight: '500',
  },
  importHelp: {
    color: C.textSecondary,
    fontSize: 13,
    marginBottom: 12,
  },
  groupNamesContainer: {
    backgroundColor: C.surfaceSecondary,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  groupNamesTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: C.textPrimary,
    marginBottom: 8,
  },
  groupNameItem: {
    fontSize: 13,
    color: C.textSecondary,
    marginBottom: 4,
  },
  memberOptionInfo: {
    flex: 1,
  },
  memberOptionGrade: {
    fontSize: 12,
    color: C.successMain,
    marginTop: 2,
  },
  memberPerformance: {
    marginBottom: 16,
  },
  memberPerformanceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  memberPerformanceAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: C.primaryMain,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  memberPerformanceInfo: {
    flex: 1,
  },
  memberPerformanceName: {
    fontSize: 14,
    fontWeight: '500',
    color: C.textPrimary,
  },
  memberPerformanceRole: {
    fontSize: 12,
    color: C.textSecondary,
  },
  memberPerformanceGrade: {
    fontSize: 16,
    fontWeight: '600',
    color: C.successMain,
  },
  memberPerformanceBar: {
    height: 6,
    backgroundColor: C.surfaceTertiary,
    borderRadius: 3,
    overflow: 'hidden',
  },
  memberPerformanceFill: {
    height: '100%',
    backgroundColor: C.successMain,
    borderRadius: 3,
  },
  meetingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  meetingDate: {
    width: 80,
    fontSize: 12,
    color: C.textSecondary,
  },
  meetingAttendanceBar: {
    flex: 1,
    height: 20,
    backgroundColor: C.surfaceTertiary,
    borderRadius: 10,
    marginHorizontal: 8,
    overflow: 'hidden',
  },
  meetingAttendanceFill: {
    height: '100%',
    backgroundColor: C.primaryMain,
    borderRadius: 10,
  },
  meetingAttendanceText: {
    width: 40,
    fontSize: 12,
    color: C.textSecondary,
    textAlign: 'right',
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
  groupCard: {
    backgroundColor: C.surfacePrimary,
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: C.borderLight,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  groupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  groupTitleContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
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
  groupName: {
    fontSize: 16,
    fontWeight: '600',
    color: C.textPrimary,
    flex: 1,
  },
  groupActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  groupActionButton: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: C.surfaceSecondary,
  },
  groupDescription: {
    fontSize: 13,
    color: C.textSecondary,
    marginBottom: 12,
    lineHeight: 18,
  },
  groupMetaRow: {
    flexDirection: 'row',
    gap: 16,
  },
  groupMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  groupMetaText: {
    fontSize: 12,
    color: C.textSecondary,
  },
  expandedContent: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: C.borderLight,
    overflow: 'hidden',
  },
  membersSection: {
    gap: 12,
  },
  membersTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: C.textPrimary,
  },
  membersList: {
    flexDirection: 'column',
    gap: 8,
  },
  memberChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surfaceSecondary,
    borderRadius: 16,
    padding: 4,
    paddingRight: 12,
    gap: 8,
  },
  memberAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  memberAvatarText: {
    color: C.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  memberInfo: {
    flexDirection: 'column',
    justifyContent: 'center',
  },
  memberName: {
    color: C.textPrimary,
    fontSize: 13,
    fontWeight: '600',
    maxWidth: 110,
  },
  memberAdmission: {
    color: C.textSecondary,
    fontSize: 11,
    maxWidth: 110,
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
    padding: 20,
    maxHeight: height * 0.6,
  },
  modalDescription: {
    fontSize: 14,
    color: C.textSecondary,
    marginBottom: 16,
    lineHeight: 20,
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
  typeContainer: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  typeButton: {
    flex: 1,
    borderRadius: 30,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: C.borderLight,
  },
  typeButtonGradient: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  typeButtonText: {
    fontSize: 13,
    color: C.textSecondary,
  },
  typeButtonTextActive: {
    color: '#FFFFFF',
    fontWeight: '600',
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
  createButton: {
    flex: 2,
    borderRadius: 16,
    overflow: 'hidden',
  },
  createButtonGradient: {
    flexDirection: 'row',
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  disabledButton: {
    opacity: 0.5,
  },
  memberOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: C.surfaceSecondary,
    borderRadius: 16,
    marginBottom: 8,
  },
  memberOptionSelected: {
    borderWidth: 2,
    borderColor: C.primaryMain,
  },
  memberOptionAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  memberOptionAvatarText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
  },
  memberOptionName: {
    flex: 1,
    fontSize: 15,
    color: C.textPrimary,
  },
  memberOptionNameSelected: {
    color: C.primaryMain,
    fontWeight: '600',
  },
  currentLeaderBadge: {
    backgroundColor: C.warningSoft,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  currentLeaderBadgeText: {
    color: C.warningMain,
    fontSize: 11,
    fontWeight: '600',
  },

  // ── Analytics modal ────────────────────────────────────────────────
  analyticsTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: C.textPrimary,
    marginBottom: 20,
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

  // ── Capacity bar (lecturer group card) ────────────────────────────
  capacitySection: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: C.borderLight,
  },
  capacityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    gap: 8,
  },
  capacityLabel: {
    fontSize: 11,
    color: C.textSecondary,
    fontWeight: '600',
    flex: 1,
  },
  capacityCount: {
    fontSize: 11,
    color: C.textPrimary,
    fontWeight: '700',
  },
  fullBadge: {
    backgroundColor: C.dangerSoft,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
  },
  fullBadgeText: {
    color: C.dangerMain,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  capacityTrack: {
    height: 6,
    backgroundColor: C.surfaceTertiary,
    borderRadius: 3,
    overflow: 'hidden',
  },
  capacityFill: {
    height: '100%',
    borderRadius: 3,
  },
  capacityHint: {
    fontSize: 11,
    color: C.textSecondary,
    marginTop: 4,
  },

  // ── Enrolled count banner + live preview (create modal) ───────────
  enrolledBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.primarySoft,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 16,
    gap: 8,
  },
  enrolledBannerText: {
    flex: 1,
    fontSize: 13,
    color: C.primaryMain,
    fontWeight: '600',
  },
  previewBox: {
    backgroundColor: C.successSoft,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: C.successMain,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  previewTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: C.successMain,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  previewLine: {
    fontSize: 14,
    color: C.textPrimary,
    fontWeight: '600',
    marginBottom: 4,
  },
  previewTotal: {
    fontSize: 12,
    color: C.textSecondary,
  },
  previewBoxWarn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.warningSoft,
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    gap: 8,
  },
  previewWarnText: {
    flex: 1,
    fontSize: 13,
    color: C.warningMain,
    fontWeight: '500',
  },

  // ── Advanced Settings ──────────────────────────────────────────────
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: C.textPrimary,
    marginTop: 20,
    marginBottom: 12,
    letterSpacing: 0.3,
  },
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

  // ── Distribute button ──────────────────────────────────────────────
  distributeButton: {
    borderRadius: 12,
    overflow: 'hidden',
  },

  // ── Context menu ───────────────────────────────────────────────────
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
});
