// screens/student/CourseWorkspace/AssignmentsScreen.js
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, Alert, StatusBar,
  TouchableOpacity, TextInput, RefreshControl, ScrollView, Modal,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import {
  fetchAssignments, submitAssignment,
  fetchGroupSubmission, uploadAssignmentFile,
} from '../../../utils/assignmentsApiV2';
import { fetchStudentSubmission } from '../../../utils/studentAssignmentApi';
import { getMyGroupForUnit } from '../../../utils/studentGroupsApi';
import { useEnrollment } from '../../../context/EnrollmentContext';
import AssignmentSubmissionModal from '../../../components/AssignmentSubmissionModal';
import useResponsive from '../../../hooks/useResponsive';
import themeColors from '../../../theme/colors';

function extractUnitCode(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/\(([^)]+)\)/);
  if (m) return m[1].replace(/\s+/g, '').toUpperCase();
  return s.replace(/\s+/g, '').toUpperCase();
}

const toTitleCase = (str) =>
  str.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

const fmt = (dateVal) => {
  try {
    return new Date(dateVal).toLocaleDateString(undefined, {
      day: 'numeric', month: 'short', year: 'numeric',
    });
  } catch { return '—'; }
};

const fmtFull = (dateVal) => {
  try {
    return new Date(dateVal).toLocaleString(undefined, {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return '—'; }
};

const C = {
  primary:  themeColors.primary,
  success:  themeColors.success,
  warning:  themeColors.warning,
  danger:   themeColors.danger,
  info:     themeColors.info,
  purple:   themeColors.purple,
  text:     themeColors.text,
  bg:       { screen: themeColors.background.primary, card: themeColors.surface.card, raised: themeColors.surface.elevated, border: themeColors.border.light },
};

const FILTERS = [
  { key: 'all',       label: 'All',       icon: 'view-list-outline' },
  { key: 'pending',   label: 'Pending',   icon: 'clock-outline' },
  { key: 'submitted', label: 'Submitted', icon: 'check-circle-outline' },
  { key: 'graded',    label: 'Graded',    icon: 'star-circle-outline' },
  { key: 'overdue',   label: 'Overdue',   icon: 'alert-circle-outline' },
];

const getDueInfo = (dueDate) => {
  const now = new Date();
  const due = new Date(dueDate);
  const diffMs = due - now;
  const diffHours = Math.ceil(diffMs / 3600000);
  const diffDays = Math.ceil(diffHours / 24);
  if (diffMs < 0) return { label: 'Overdue', color: C.danger.main, bg: C.danger.soft, icon: 'alert-circle' };
  if (diffHours < 24) return { label: 'Due today', color: C.warning.main, bg: C.warning.soft, icon: 'clock-alert' };
  if (diffHours < 48) return { label: 'Due tomorrow', color: C.warning.main, bg: C.warning.soft, icon: 'clock' };
  return { label: `${diffDays}d left`, color: C.success.main, bg: C.success.soft, icon: 'clock-outline' };
};

// ─── Skeleton ────────────────────────────────────────────────────────────────
const Skeleton = () => (
  <View style={styles.skeletonCard}>
    <View style={styles.skeletonAccent} />
    <View style={{ flex: 1, padding: 14 }}>
      <View style={[styles.skeletonLine, { width: '35%', height: 11, marginBottom: 10 }]} />
      <View style={[styles.skeletonLine, { width: '75%', height: 17, marginBottom: 14 }]} />
      <View style={[styles.skeletonLine, { width: '55%', height: 12, marginBottom: 14 }]} />
      <View style={[styles.skeletonBlock, { height: 64 }]} />
      <View style={[styles.skeletonLine, { width: '100%', height: 40, marginTop: 14, borderRadius: 12 }]} />
    </View>
  </View>
);

// ─── Rubric modal ─────────────────────────────────────────────────────────────
const RubricModal = ({ visible, rubric, onClose }) => (
  <Modal visible={visible} animationType="slide" transparent>
    <View style={styles.modalOverlay}>
      <View style={styles.modalSheet}>
        <View style={styles.modalHandle} />
        <View style={styles.modalHeaderRow}>
          <Icon name="format-list-checks" size={20} color={C.primary.main} />
          <Text style={styles.modalTitle}>Grading Rubric</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Icon name="close" size={22} color={C.text.secondary} />
          </TouchableOpacity>
        </View>
        <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
          {(rubric || []).map((item, i) => (
            <View key={i} style={styles.rubricRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rubricCriterion}>{item.criterion}</Text>
                {item.description ? (
                  <Text style={styles.rubricDesc}>{item.description}</Text>
                ) : null}
              </View>
              <View style={styles.rubricWeightPill}>
                <Text style={styles.rubricWeightText}>{item.weight}%</Text>
              </View>
            </View>
          ))}
        </ScrollView>
      </View>
    </View>
  </Modal>
);

// ─── Assignment Card ──────────────────────────────────────────────────────────
const AssignmentCard = ({ assignment, submission, onSubmit, groupId, unitNamesMap }) => {
  const [showDetails, setShowDetails] = useState(false);
  const [rubricVisible, setRubricVisible] = useState(false);

  const dueInfo        = getDueInfo(assignment.dueDate);
  const isOverdue      = new Date(assignment.dueDate) < new Date();
  const isSubmitted    = !!submission;
  const isGraded       = submission?.grade != null;
  const canResubmit    = isSubmitted && !isOverdue && !isGraded;
  const isGroupAssign  = !!assignment.isGroup;

  // Left accent + status panel colour follow submission state
  const accentColor = isGraded   ? C.info.main
    : isSubmitted                 ? C.success.main
    : isOverdue                   ? C.danger.main
    : C.warning.main;

  const unitLabel = (() => {
    const nm = unitNamesMap?.[assignment._unitCode] || unitNamesMap?.[assignment.courseCode];
    return nm ? toTitleCase(String(nm)) : (assignment._unitCode || assignment.courseCode || '');
  })();

  return (
    <View style={[styles.card, { borderLeftColor: accentColor }]}>

      {/* ── Top: unit + type badges ── */}
      <View style={styles.cardTopBadges}>
        <View style={styles.unitBadge}>
          <Text style={styles.unitBadgeText}>{unitLabel}</Text>
        </View>
        <View style={[
          styles.typeBadge,
          { backgroundColor: isGroupAssign ? C.purple.soft : C.info.soft },
        ]}>
          <Icon
            name={isGroupAssign ? 'account-group' : 'account'}
            size={11}
            color={isGroupAssign ? C.purple.main : C.info.main}
          />
          <Text style={[styles.typeBadgeText, { color: isGroupAssign ? C.purple.main : C.info.main }]}>
            {isGroupAssign ? 'Group' : 'Individual'}
          </Text>
        </View>
      </View>

      {/* ── Title ── */}
      <Text style={styles.cardTitle}>{assignment.title}</Text>

      {/* ── Due date + points row ── */}
      <View style={styles.metaStrip}>
        <View style={styles.metaItem}>
          <Icon name="calendar-clock" size={13} color={C.text.muted} />
          <Text style={styles.metaText}>{fmtFull(assignment.dueDate)}</Text>
        </View>
        <View style={[styles.duePill, { backgroundColor: dueInfo.bg }]}>
          <Icon name={dueInfo.icon} size={11} color={dueInfo.color} />
          <Text style={[styles.duePillText, { color: dueInfo.color }]}>{dueInfo.label}</Text>
        </View>
        <View style={styles.metaItem}>
          <Icon name="star" size={13} color={C.warning.main} />
          <Text style={styles.metaText}>{assignment.maxScore || 100} pts</Text>
        </View>
      </View>

      {/* ── Submission status panel ── */}
      <View style={[styles.statusPanel, {
        borderColor: accentColor + '40',
        backgroundColor: accentColor + '0D',
      }]}>
        {isGraded ? (
          /* Graded — show score prominently */
          <View style={styles.statusRow}>
            <View style={[styles.gradeCircle, { borderColor: C.info.main }]}>
              <Text style={[styles.gradeNumber, { color: C.info.main }]}>{submission.grade}</Text>
              <Text style={[styles.gradeMax, { color: C.text.muted }]}>/{assignment.maxScore || 100}</Text>
            </View>
            <View style={{ flex: 1, marginLeft: 14 }}>
              <View style={styles.statusLabelRow}>
                <Icon name="star-circle" size={16} color={C.info.main} />
                <Text style={[styles.statusLabel, { color: C.info.main }]}>Graded</Text>
              </View>
              {submission.submittedAt && (
                <Text style={styles.statusMeta}>Submitted {fmt(submission.submittedAt)}</Text>
              )}
              {submission.feedback ? (
                <View style={styles.feedbackBox}>
                  <Icon name="message-text-outline" size={13} color={C.text.secondary} />
                  <Text style={styles.feedbackText}>{submission.feedback}</Text>
                </View>
              ) : null}
            </View>
          </View>
        ) : isSubmitted ? (
          /* Submitted, awaiting grade */
          <View style={styles.statusRow}>
            <View style={[styles.statusIcon, { backgroundColor: C.success.soft }]}>
              <Icon name="check-circle" size={26} color={C.success.main} />
            </View>
            <View style={{ flex: 1, marginLeft: 14 }}>
              <View style={styles.statusLabelRow}>
                <Text style={[styles.statusLabel, { color: C.success.main }]}>Submitted</Text>
                {submission.late && (
                  <View style={styles.latePill}>
                    <Text style={styles.latePillText}>Late</Text>
                  </View>
                )}
              </View>
              {submission.submittedAt && (
                <Text style={styles.statusMeta}>on {fmtFull(submission.submittedAt)}</Text>
              )}
              {submission.version != null && (
                <Text style={styles.statusMeta}>Version {submission.version}</Text>
              )}
              {submission.feedback ? (
                <View style={styles.feedbackBox}>
                  <Icon name="message-text-outline" size={13} color={C.text.secondary} />
                  <Text style={styles.feedbackText}>{submission.feedback}</Text>
                </View>
              ) : (
                <Text style={[styles.statusMeta, { marginTop: 4 }]}>Awaiting grade from lecturer</Text>
              )}
            </View>
          </View>
        ) : (
          /* Not submitted */
          <View style={styles.statusRow}>
            <View style={[styles.statusIcon, { backgroundColor: isOverdue ? C.danger.soft : C.warning.soft }]}>
              <Icon
                name={isOverdue ? 'alert-circle' : 'clock-outline'}
                size={26}
                color={isOverdue ? C.danger.main : C.warning.main}
              />
            </View>
            <View style={{ flex: 1, marginLeft: 14 }}>
              <Text style={[styles.statusLabel, { color: isOverdue ? C.danger.main : C.warning.main }]}>
                {isOverdue ? 'Not Submitted — Overdue' : 'Not Yet Submitted'}
              </Text>
              <Text style={styles.statusMeta}>
                {isOverdue
                  ? `Deadline was ${fmt(assignment.dueDate)}`
                  : `Due ${fmtFull(assignment.dueDate)}`}
              </Text>
              {isGroupAssign && !groupId && (
                <Text style={[styles.statusMeta, { color: C.warning.main, marginTop: 4 }]}>
                  ⚠ Join a group first to submit
                </Text>
              )}
            </View>
          </View>
        )}
      </View>

      {/* ── Action buttons ── */}
      <View style={styles.actionsRow}>
        {!isGraded && (
          <TouchableOpacity
            style={[
              styles.submitBtn,
              canResubmit && { backgroundColor: C.info.main },
              isGroupAssign && !groupId && styles.submitBtnDisabled,
            ]}
            onPress={() => onSubmit(assignment, groupId)}
            disabled={isGroupAssign && !groupId}
            activeOpacity={0.85}
          >
            <LinearGradient
              colors={canResubmit ? [C.info.main, C.primary.main] : C.primary.gradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.submitBtnGradient}
            >
              <Icon name={canResubmit ? 'refresh' : 'upload'} size={17} color="#fff" />
              <Text style={styles.submitBtnText}>
                {canResubmit ? 'Resubmit' : isGroupAssign ? 'Submit for Group' : 'Submit Assignment'}
              </Text>
            </LinearGradient>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={styles.detailsBtn}
          onPress={() => setShowDetails((v) => !v)}
          activeOpacity={0.8}
        >
          <Text style={styles.detailsBtnText}>{showDetails ? 'Less' : 'Details'}</Text>
          <Icon name={showDetails ? 'chevron-up' : 'chevron-down'} size={15} color={C.text.muted} />
        </TouchableOpacity>
      </View>

      {/* ── Expandable details ── */}
      {showDetails && (
        <View style={styles.detailsBody}>
          {assignment.description ? (
            <Text style={styles.descriptionText}>{assignment.description}</Text>
          ) : null}

          <View style={[styles.typeBanner, { backgroundColor: isGroupAssign ? C.purple.soft : C.info.soft }]}>
            <Icon
              name={isGroupAssign ? 'account-group' : 'account'}
              size={14}
              color={isGroupAssign ? C.purple.main : C.info.main}
            />
            <Text style={[styles.typeBannerText, { color: isGroupAssign ? C.purple.main : C.info.main }]}>
              {isGroupAssign
                ? 'Group assignment — submit once on behalf of your group'
                : 'Individual assignment — each student submits separately'}
            </Text>
          </View>

          {assignment.allowResub && (
            <View style={styles.detailFlag}>
              <Icon name="refresh-circle" size={15} color={C.success.main} />
              <Text style={[styles.detailFlagText, { color: C.success.main }]}>Resubmission allowed</Text>
            </View>
          )}
          {assignment.blockLate && (
            <View style={styles.detailFlag}>
              <Icon name="clock-alert" size={15} color={C.danger.main} />
              <Text style={[styles.detailFlagText, { color: C.danger.main }]}>Late submissions blocked</Text>
            </View>
          )}

          {assignment.rubric?.length > 0 && (
            <TouchableOpacity style={styles.rubricBtn} onPress={() => setRubricVisible(true)} activeOpacity={0.8}>
              <Icon name="format-list-checks" size={15} color={C.primary.main} />
              <Text style={styles.rubricBtnText}>View Rubric ({assignment.rubric.length} criteria)</Text>
              <Icon name="chevron-right" size={15} color={C.primary.main} />
            </TouchableOpacity>
          )}
        </View>
      )}

      <RubricModal
        visible={rubricVisible}
        rubric={assignment.rubric}
        onClose={() => setRubricVisible(false)}
      />
    </View>
  );
};

// ─── Summary strip ────────────────────────────────────────────────────────────
const SummaryStrip = ({ assignments, submissions }) => {
  const now = new Date();
  const total     = assignments.length;
  const pending   = assignments.filter(a => !submissions[a.id] && new Date(a.dueDate) >= now).length;
  const submitted = assignments.filter(a => submissions[a.id] && submissions[a.id].grade == null).length;
  const graded    = assignments.filter(a => submissions[a.id]?.grade != null).length;
  const overdue   = assignments.filter(a => !submissions[a.id] && new Date(a.dueDate) < now).length;

  const tiles = [
    { label: 'Total',     value: total,     color: C.primary.main },
    { label: 'Pending',   value: pending,   color: C.warning.main },
    { label: 'Submitted', value: submitted, color: C.success.main },
    { label: 'Graded',    value: graded,    color: C.info.main },
    { label: 'Overdue',   value: overdue,   color: C.danger.main },
  ];

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.summaryScroll} contentContainerStyle={styles.summaryContent}>
      {tiles.map((t) => (
        <View key={t.label} style={[styles.summaryTile, { borderColor: t.color + '40' }]}>
          <Text style={[styles.summaryValue, { color: t.color }]}>{t.value}</Text>
          <Text style={styles.summaryLabel}>{t.label}</Text>
        </View>
      ))}
    </ScrollView>
  );
};

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function AssignmentsScreen({ route }) {
  const navigation = useNavigation();
  const { isTablet, contentMaxWidth } = useResponsive();

  useEffect(() => { navigation.setOptions({ headerShown: false }); }, [navigation]);

  const paramUnitId = route?.params?.selectedUnitId;
  const { enrolledUnits, unitNamesMap } = useEnrollment();
  const [assignments,           setAssignments]           = useState([]);
  const [submissions,           setSubmissions]           = useState({});
  const [loading,               setLoading]               = useState(false);
  const [refreshing,            setRefreshing]            = useState(false);
  const [search,                setSearch]                = useState('');
  const [activeFilter,          setActiveFilter]          = useState('all');
  const [submissionModalVisible,setSubmissionModalVisible]= useState(false);
  const [selectedAssignment,    setSelectedAssignment]    = useState(null);
  const [selectedGroupId,       setSelectedGroupId]       = useState(null);
  const [myGroups,              setMyGroups]              = useState({});

  const unitIds = useMemo(() => {
    if (paramUnitId) return [paramUnitId];
    return [...new Set((enrolledUnits || []).map(u => {
      const s = String(u || '').trim();
      const m = s.match(/\(([^)]+)\)/);
      return m ? m[1].replace(/\s+/g, '').toUpperCase() : s.toUpperCase();
    }).filter(Boolean))];
  }, [paramUnitId, enrolledUnits]);

  const loadAssignments = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    let all = [];
    try {
      const results = await Promise.all(
        unitIds.map(uid =>
          fetchAssignments(uid)
            .then(data => Array.isArray(data) ? data.map(a => ({ ...a, _unitCode: uid })) : [])
            .catch(() => [])
        )
      );
      all = results.flat();
      setAssignments(all);
    } catch {
      Alert.alert('Error', 'Failed to load assignments');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }

    if (all.length === 0) return;

    try {
      const unitSet = [...new Set(all.map(a => a._unitCode || extractUnitCode(a.courseCode || a.unitId)))];
      const groupEntries = await Promise.all(
        unitSet.map(code =>
          getMyGroupForUnit(code).then(g => (g?.id ? [code, g] : null)).catch(() => null)
        )
      );
      const groupMap = Object.fromEntries(groupEntries.filter(Boolean));
      setMyGroups(groupMap);

      const subEntries = await Promise.all(
        all.map(async a => {
          const unitCode = a._unitCode || extractUnitCode(a.courseCode || a.unitId);
          const myGroup  = groupMap[unitCode];
          try {
            if (a.isGroup && myGroup?.id) {
              const sub = await fetchGroupSubmission(a.id, myGroup.id);
              return sub ? [a.id, sub] : null;
            } else if (!a.isGroup) {
              const sub = await fetchStudentSubmission(a.id);
              return sub ? [a.id, sub] : null;
            }
          } catch (_) {}
          return null;
        })
      );
      setSubmissions(Object.fromEntries(subEntries.filter(Boolean)));
    } catch (_) {}
  }, [unitIds]);

  useFocusEffect(useCallback(() => { loadAssignments(); }, [loadAssignments]));

  const filtered = useMemo(() => {
    let list = assignments;
    if (search) list = list.filter(a => a.title?.toLowerCase().includes(search.toLowerCase()));
    const now = new Date();
    switch (activeFilter) {
      case 'pending':   list = list.filter(a => !submissions[a.id] && new Date(a.dueDate) >= now); break;
      case 'submitted': list = list.filter(a => submissions[a.id] && submissions[a.id].grade == null); break;
      case 'graded':    list = list.filter(a => submissions[a.id]?.grade != null); break;
      case 'overdue':   list = list.filter(a => !submissions[a.id] && new Date(a.dueDate) < now); break;
    }
    return list.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
  }, [assignments, submissions, search, activeFilter]);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg.screen} />

      {/* ── Header ── */}
      <LinearGradient colors={['#1A1040', C.bg.screen]} style={styles.screenHeader}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Icon name="arrow-left" size={22} color="#F1F5F9" />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.screenHeaderTitle}>Assignments</Text>
          <Text style={styles.screenHeaderSub}>View and submit your course assignments</Text>
        </View>
        <View style={styles.screenHeaderIcon}>
          <Icon name="clipboard-text" size={22} color="#F59E0B" />
        </View>
      </LinearGradient>

      {/* ── Summary strip ── */}
      {assignments.length > 0 && (
        <SummaryStrip assignments={assignments} submissions={submissions} />
      )}

      {/* ── Search ── */}
      <View style={styles.searchWrap}>
        <View style={styles.searchRow}>
          <Icon name="magnify" size={18} color={C.text.muted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search assignments…"
            placeholderTextColor={C.text.muted}
            value={search}
            onChangeText={setSearch}
          />
          {search ? (
            <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Icon name="close-circle" size={18} color={C.text.muted} />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {/* ── Filters ── */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll} contentContainerStyle={styles.filterContent}>
        {FILTERS.map(f => (
          <TouchableOpacity
            key={f.key}
            style={[styles.filterChip, activeFilter === f.key && styles.filterChipActive]}
            onPress={() => setActiveFilter(f.key)}
            activeOpacity={0.8}
          >
            <Icon name={f.icon} size={13} color={activeFilter === f.key ? '#fff' : C.text.secondary} />
            <Text style={[styles.filterLabel, activeFilter === f.key && styles.filterLabelActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* ── List ── */}
      {loading && !refreshing ? (
        <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
          {[1, 2, 3].map((_, i) => <Skeleton key={i} />)}
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => String(item.id)}
          contentContainerStyle={[
            styles.listContent,
            isTablet && { alignSelf: 'center', width: '100%', maxWidth: contentMaxWidth },
          ]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => loadAssignments(true)}
              colors={[C.primary.main]}
              tintColor={C.primary.main}
            />
          }
          renderItem={({ item }) => {
            const unitCode = item._unitCode || extractUnitCode(item.courseCode || item.unitId);
            const groupId  = item.isGroup ? (myGroups[unitCode]?.id || null) : null;
            return (
              <AssignmentCard
                assignment={item}
                submission={submissions[item.id]}
                onSubmit={(a, gId) => {
                  setSelectedAssignment(a);
                  setSelectedGroupId(gId || null);
                  setSubmissionModalVisible(true);
                }}
                groupId={groupId}
                unitNamesMap={unitNamesMap}
              />
            );
          }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Icon name="clipboard-text-outline" size={56} color={C.bg.border} />
              <Text style={styles.emptyTitle}>No assignments found</Text>
              <Text style={styles.emptyText}>Try a different filter or check back later</Text>
            </View>
          }
        />
      )}

      <AssignmentSubmissionModal
        visible={submissionModalVisible}
        onClose={() => {
          setSubmissionModalVisible(false);
          setSelectedAssignment(null);
          setSelectedGroupId(null);
        }}
        assignment={selectedAssignment}
        submission={selectedAssignment ? submissions[selectedAssignment.id] : null}
        groupId={selectedGroupId}
        groupName={selectedGroupId
          ? (myGroups[selectedAssignment?._unitCode || extractUnitCode(selectedAssignment?.courseCode || selectedAssignment?.unitId)]?.name || 'Your Group')
          : null}
        onSubmit={async (payload) => {
          try {
            if (payload.type === 'file') {
              await uploadAssignmentFile(
                selectedAssignment.id,
                payload.file.uri,
                payload.file.name,
                payload.file.mimeType || 'application/octet-stream',
                selectedGroupId || undefined,
              );
            } else {
              const body = { ...payload };
              if (selectedGroupId) body.groupId = selectedGroupId;
              await submitAssignment(selectedAssignment.id, body);
            }
            setSubmissionModalVisible(false);
            setSelectedAssignment(null);
            setSelectedGroupId(null);
            loadAssignments(true);
            Alert.alert('Success', 'Assignment submitted successfully!');
          } catch (err) {
            Alert.alert('Error', err.message || 'Failed to submit assignment');
          }
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen:            { flex: 1, backgroundColor: C.bg.screen },

  // Header
  screenHeader:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16 },
  backBtn:           { width: 38, height: 38, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.07)', alignItems: 'center', justifyContent: 'center' },
  screenHeaderTitle: { fontSize: 18, fontWeight: '700', color: '#F1F5F9', marginBottom: 2 },
  screenHeaderSub:   { fontSize: 12, color: '#94A3B8' },
  screenHeaderIcon:  { width: 42, height: 42, borderRadius: 13, backgroundColor: 'rgba(245,158,11,0.12)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(245,158,11,0.2)' },

  // Summary strip
  summaryScroll:     { flexGrow: 0 },
  summaryContent:    { paddingHorizontal: 16, paddingBottom: 12, gap: 8 },
  summaryTile:       { alignItems: 'center', backgroundColor: C.bg.card, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 14, borderWidth: 1, minWidth: 68 },
  summaryValue:      { fontSize: 22, fontWeight: '800', lineHeight: 26 },
  summaryLabel:      { fontSize: 10, fontWeight: '600', color: C.text.muted, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.5 },

  // Search
  searchWrap:        { paddingHorizontal: 16, paddingBottom: 10 },
  searchRow:         { flexDirection: 'row', alignItems: 'center', backgroundColor: C.bg.card, borderRadius: 12, paddingHorizontal: 12, paddingVertical: Platform.OS === 'ios' ? 10 : 6, borderWidth: 1, borderColor: C.bg.border, gap: 8 },
  searchInput:       { flex: 1, color: C.text.primary, fontSize: 14 },

  // Filters
  filterScroll:      { flexGrow: 0 },
  filterContent:     { paddingHorizontal: 16, paddingBottom: 12, gap: 8 },
  filterChip:        { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 13, paddingVertical: 7, borderRadius: 20, backgroundColor: C.bg.card, borderWidth: 1, borderColor: C.bg.border },
  filterChipActive:  { backgroundColor: C.primary.main, borderColor: C.primary.main },
  filterLabel:       { fontSize: 13, fontWeight: '600', color: C.text.secondary },
  filterLabelActive: { color: '#fff' },

  // List
  listContent: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 32 },

  // Card
  card: {
    backgroundColor: C.bg.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.bg.border,
    borderLeftWidth: 4,
    marginBottom: 14,
    overflow: 'hidden',
    padding: 14,
  },
  cardTopBadges: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  unitBadge:     { backgroundColor: C.primary.soft, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 8 },
  unitBadgeText: { fontSize: 11, fontWeight: '700', color: C.primary.main },
  typeBadge:     { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  typeBadgeText: { fontSize: 11, fontWeight: '600' },
  cardTitle:     { fontSize: 16, fontWeight: '700', color: C.text.primary, marginBottom: 10, lineHeight: 22 },

  // Meta strip
  metaStrip: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
  metaItem:  { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText:  { fontSize: 12, color: C.text.secondary },
  duePill:   { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  duePillText: { fontSize: 11, fontWeight: '700' },

  // Submission status panel
  statusPanel: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 12 },
  statusRow:   { flexDirection: 'row', alignItems: 'flex-start' },
  statusIcon:  { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },

  // Grade circle
  gradeCircle:    { width: 56, height: 56, borderRadius: 28, borderWidth: 2.5, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', flexShrink: 0 },
  gradeNumber:    { fontSize: 22, fontWeight: '800' },
  gradeMax:       { fontSize: 12, fontWeight: '600', marginTop: 4 },

  statusLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 },
  statusLabel:    { fontSize: 14, fontWeight: '700' },
  statusMeta:     { fontSize: 12, color: C.text.muted, lineHeight: 18 },

  latePill:       { backgroundColor: C.danger.soft, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  latePillText:   { fontSize: 10, fontWeight: '700', color: C.danger.main },

  feedbackBox:    { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 8, backgroundColor: C.bg.raised, borderRadius: 8, padding: 8 },
  feedbackText:   { flex: 1, fontSize: 12, color: C.text.secondary, lineHeight: 18 },

  // Actions
  actionsRow:          { flexDirection: 'row', alignItems: 'center', gap: 10 },
  submitBtn:           { flex: 1, borderRadius: 12, overflow: 'hidden' },
  submitBtnGradient:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12 },
  submitBtnText:       { fontSize: 14, fontWeight: '700', color: '#fff' },
  submitBtnDisabled:   { opacity: 0.45 },
  detailsBtn:          { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12, backgroundColor: C.bg.raised, borderWidth: 1, borderColor: C.bg.border },
  detailsBtnText:      { fontSize: 13, fontWeight: '600', color: C.text.secondary },

  // Expandable details
  detailsBody:     { marginTop: 12, borderTopWidth: 1, borderTopColor: C.bg.border, paddingTop: 12, gap: 10 },
  descriptionText: { fontSize: 13, color: C.text.secondary, lineHeight: 20 },
  typeBanner:      { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  typeBannerText:  { fontSize: 12, fontWeight: '600', flex: 1 },
  detailFlag:      { flexDirection: 'row', alignItems: 'center', gap: 7 },
  detailFlagText:  { fontSize: 12, fontWeight: '600' },
  rubricBtn:       { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.primary.soft, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  rubricBtnText:   { flex: 1, fontSize: 13, fontWeight: '600', color: C.primary.main },

  // Skeleton
  skeletonCard:    { flexDirection: 'row', backgroundColor: C.bg.card, borderRadius: 16, borderWidth: 1, borderColor: C.bg.border, marginBottom: 14, overflow: 'hidden' },
  skeletonAccent:  { width: 4, backgroundColor: C.bg.border },
  skeletonLine:    { backgroundColor: C.bg.border, borderRadius: 4, marginBottom: 4 },
  skeletonBlock:   { backgroundColor: C.bg.border, borderRadius: 10 },

  // Empty
  empty:      { alignItems: 'center', paddingTop: 60 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: C.text.secondary, marginTop: 16 },
  emptyText:  { fontSize: 13, color: C.text.muted, marginTop: 6, textAlign: 'center' },

  // Rubric modal
  modalOverlay:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  modalSheet:      { backgroundColor: C.bg.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36 },
  modalHandle:     { width: 40, height: 4, backgroundColor: C.bg.border, borderRadius: 2, alignSelf: 'center', marginBottom: 18 },
  modalHeaderRow:  { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  modalTitle:      { flex: 1, fontSize: 17, fontWeight: '700', color: C.text.primary },
  rubricRow:       { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.bg.border },
  rubricCriterion: { fontSize: 14, fontWeight: '600', color: C.text.primary, marginBottom: 3 },
  rubricDesc:      { fontSize: 12, color: C.text.secondary, lineHeight: 17 },
  rubricWeightPill: { backgroundColor: C.primary.soft, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, marginLeft: 12, alignSelf: 'flex-start' },
  rubricWeightText: { fontSize: 12, fontWeight: '700', color: C.primary.main },
});
