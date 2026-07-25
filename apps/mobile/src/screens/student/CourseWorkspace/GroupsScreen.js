// screens/student/CourseWorkspace/GroupsScreen.js
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, StatusBar,
  Alert, TextInput, RefreshControl, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import {
  getStudentGroupsByUnit, getMyGroupForUnit,
  joinStudyGroup, leaveStudyGroup,
} from '../../../utils/studentGroupsApi';
import { useEnrollment } from '../../../context/EnrollmentContext';
import useResponsive from '../../../hooks/useResponsive';
import DropdownPicker from '../../../components/DropdownPicker';
import themeColors from '../../../theme/colors';

const toTitleCase = (str) =>
  str.toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());

const colors = {
  primary: themeColors.primary,
  success: themeColors.success,
  warning: themeColors.warning,
  danger:  themeColors.danger,
  text:    themeColors.text,
  bg:      { screen: themeColors.background.primary, card: themeColors.surface.card, border: themeColors.border.light },
};

// Loading Skeleton
const GroupSkeleton = ({ r }) => (
  <View style={[styles.skeletonCard, { marginBottom: r.pad, borderRadius: r.cardRad }]}>
    <View style={[styles.skeletonHeader, { padding: r.pad }]}>
      <View style={[styles.skeletonAvatar, { width: 44, height: 44, borderRadius: 22 }]} />
      <View style={{ flex: 1, marginLeft: r.pad }}>
        <View style={[styles.skeletonLine, { width: '60%', height: 16, marginBottom: 8 }]} />
        <View style={[styles.skeletonLine, { width: '40%', height: 12 }]} />
      </View>
    </View>
  </View>
);

const MemberList = ({ members, r }) => (
  <View style={[styles.memberList, { marginTop: r.padSmall }]}>
    {(members || []).map((m, i) => (
      <View key={i} style={[styles.memberRow, { paddingVertical: r.padSmall / 2 }]}>
        <View style={[
          styles.memberAvatar, 
          { width: 28, height: 28, borderRadius: 14 },
          m.role === 'leader' && styles.memberAvatarLeader
        ]}>
          <Icon name={m.role === 'leader' ? 'crown' : 'account'} size={14} color={m.role === 'leader' ? colors.warning.main : colors.primary.main} />
        </View>
        <Text style={[styles.memberName, { fontSize: r.bodySize }]}>{m.studentName || m.studentId}</Text>
        {m.role === 'leader' && (
          <Text style={[styles.leaderTag, { fontSize: r.smallSize, paddingHorizontal: r.padSmall, paddingVertical: 2 }]}>
            Leader
          </Text>
        )}
      </View>
    ))}
  </View>
);

const GroupCard = ({ group, isMyGroup, onJoin, onLeave, r }) => {
  const [expanded, setExpanded] = useState(false);
  const memberCount = group.memberCount ?? (group.members || []).length;
  const isFull = group.capacity > 0 && memberCount >= group.capacity;
  return (
    <View style={[
      styles.card, 
      { 
        marginBottom: r.pad, 
        borderRadius: r.cardRad,
        borderWidth: isMyGroup ? 2 : 1,
        borderColor: isMyGroup ? colors.success.main : colors.bg.border,
      }
    ]}>
      {isMyGroup && (
        <LinearGradient colors={[colors.success.main, '#059669']} style={[styles.myGroupBadge, { padding: r.padSmall / 2 }]}>
          <Icon name="check-decagram" size={12} color="#fff" />
          <Text style={[styles.myGroupBadgeText, { fontSize: r.smallSize, marginLeft: 4 }]}>My Group</Text>
        </LinearGradient>
      )}
      
      <TouchableOpacity activeOpacity={0.8} onPress={() => setExpanded(e => !e)}>
        <View style={[styles.cardHeader, { padding: r.pad }]}>
          <View style={[
            styles.groupAvatar, 
            { width: 44, height: 44, borderRadius: 22, backgroundColor: isMyGroup ? colors.primary.main : colors.primary.soft }
          ]}>
            <Icon name="account-group" size={22} color={isMyGroup ? '#fff' : colors.primary.main} />
          </View>
          <View style={{ flex: 1, marginLeft: r.pad }}>
            <Text style={[styles.groupName, { fontSize: r.bodySize }]}>{group.name}</Text>
            <View style={styles.groupMeta}>
              <Icon name="account-multiple" size={13} color={colors.text.muted} />
              <Text style={[styles.groupMetaText, { fontSize: r.smallSize, marginLeft: 4 }]}>
                {memberCount} member{memberCount !== 1 ? 's' : ''}
                {group.capacity > 0 ? ` / ${group.capacity}` : ''}
              </Text>
              {isFull && (
                <View style={[styles.fullBadge, { marginLeft: 8 }]}>
                  <Text style={[styles.fullBadgeText, { fontSize: r.smallSize - 1 }]}>FULL</Text>
                </View>
              )}
              {group.locked && (
                <>
                  <Icon name="lock" size={13} color={colors.warning.main} style={{ marginLeft: 8 }} />
                  <Text style={[styles.groupMetaText, { color: colors.warning.main, fontSize: r.smallSize, marginLeft: 4 }]}>
                    Locked
                  </Text>
                </>
              )}
            </View>
          </View>
          <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={r.iconSize} color={colors.text.muted} />
        </View>
      </TouchableOpacity>

      {expanded && (
        <View style={[styles.expandedBody, { padding: r.pad, paddingTop: 0 }]}>
          {(group.members || []).length > 0 && <MemberList members={group.members} r={r} />}

          {/* Capacity bar */}
          {group.capacity > 0 && (
            <View style={[styles.capacitySection, { marginTop: r.padSmall }]}>
              <View style={styles.capacityTrack}>
                <View style={[
                  styles.capacityFill,
                  {
                    width: `${Math.min(100, (memberCount / group.capacity) * 100)}%`,
                    backgroundColor: isFull ? colors.danger.main : colors.success.main,
                  },
                ]} />
              </View>
              <Text style={[styles.capacityHint, { fontSize: r.smallSize, marginTop: 4 }, isFull && { color: colors.danger.main }]}>
                {isFull ? 'Group is full' : `${group.capacity - memberCount} spot${group.capacity - memberCount !== 1 ? 's' : ''} remaining`}
              </Text>
            </View>
          )}
        </View>
      )}

      {/* Join / Leave always visible */}
      <View style={{ paddingHorizontal: r.pad, paddingBottom: r.pad }}>
        {!isMyGroup && !group.locked && (
          <TouchableOpacity 
            style={[styles.actionBtn, { 
              borderRadius: r.cardRad / 2, 
              paddingVertical: 10,
              opacity: isFull ? 0.55 : 1,
            }]}
            onPress={() => !isFull && onJoin(group.id)}
            disabled={isFull}
          >
            <Icon name={isFull ? 'lock-outline' : 'account-plus'} size={16} color="#fff" />
            <Text style={[styles.actionBtnText, { fontSize: r.bodySize, marginLeft: 6 }]}>
              {isFull ? 'Group Full' : 'Join Group'}
            </Text>
          </TouchableOpacity>
        )}

        {isMyGroup && (
          <TouchableOpacity 
            style={[styles.leaveBtn, { 
              borderRadius: r.cardRad / 2, 
              paddingVertical: 10,
              borderWidth: 1,
            }]}
            onPress={() => onLeave(group.id)}
          >
            <Icon name="account-minus" size={16} color={colors.danger.main} />
            <Text style={[styles.leaveBtnText, { fontSize: r.bodySize, marginLeft: 6, color: colors.danger.main }]}>
              Leave Group
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

export default function GroupsScreen({ route }) {
  const navigation = useNavigation();
  const { r, isTablet, contentMaxWidth } = useResponsive();

  useEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);
  const paramUnitId = route?.params?.selectedUnitId;
  const { enrolledUnits, unitNamesMap } = useEnrollment();
  const [groups, setGroups] = useState([]);
  const [myGroups, setMyGroups] = useState({});
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedUnit, setSelectedUnit] = useState(paramUnitId || '');
  const groupCacheRef = useRef({});

  const unitIds = useMemo(() => {
    if (paramUnitId) return [paramUnitId];
    return [...new Set((enrolledUnits || []).map(u => {
      const s = String(u || '').trim();
      const m = s.match(/\(([^)]+)\)/);
      return m ? m[1].replace(/\s+/g, '').toUpperCase() : s.toUpperCase();
    }).filter(Boolean))];
  }, [paramUnitId, enrolledUnits]);

  const unitOptions = useMemo(() =>
    unitIds.map(u => ({
      value: u,
      label: unitNamesMap?.[u] ? toTitleCase(String(unitNamesMap[u])) : u,
      icon: 'book-open-variant',
    })),
  [unitIds, unitNamesMap]);

  const activeUnit = selectedUnit || unitIds[0] || '';

  const loadGroups = useCallback(async (isRefresh = false) => {
    if (!activeUnit) return;
    // Instant render from cache when switching unit tabs (no spinner)
    const cached = groupCacheRef.current[activeUnit];
    if (cached && !isRefresh) {
      setGroups(cached.groups);
      setMyGroups(prev => ({ ...prev, [activeUnit]: cached.myGroupId }));
    } else {
      if (isRefresh) setRefreshing(true); else setLoading(true);
    }
    try {
      const [allGroups, myGroup] = await Promise.all([
        getStudentGroupsByUnit(activeUnit).catch(() => []),
        getMyGroupForUnit(activeUnit).catch(() => null),
      ]);
      const groups = Array.isArray(allGroups) ? allGroups : [];
      const myGroupId = myGroup?.id || null;
      groupCacheRef.current[activeUnit] = { groups, myGroupId };
      setGroups(groups);
      setMyGroups(prev => ({ ...prev, [activeUnit]: myGroupId }));
    } catch (err) {
      if (!cached) Alert.alert('Error', 'Failed to load groups');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [activeUnit]);

  useFocusEffect(
    useCallback(() => { loadGroups(); }, [loadGroups]),
  );

  const handleJoin = async (groupId) => {
    Alert.alert('Join Group', 'Are you sure you want to join this group?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Join', onPress: async () => {
        try {
          await joinStudyGroup(groupId);
          Alert.alert('Success', 'You joined the group!');
          loadGroups(true);
        } catch (err) {
          Alert.alert('Error', err.message || 'Failed to join group');
        }
      }},
    ]);
  };

  const handleLeave = async (groupId) => {
    Alert.alert('Leave Group', 'Are you sure you want to leave this group?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: async () => {
        try {
          await leaveStudyGroup(groupId);
          Alert.alert('Success', 'You left the group');
          loadGroups(true);
        } catch (err) {
          Alert.alert('Error', err.message || 'Failed to leave group');
        }
      }},
    ]);
  };

  const filtered = useMemo(() => {
    if (!search) return groups;
    return groups.filter(g => g.name?.toLowerCase().includes(search.toLowerCase()));
  }, [groups, search]);

  const myGroupId = myGroups[activeUnit];

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.bg.screen }]} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg.screen} />

      {/* ── Header ── */}
      <LinearGradient colors={['#1A1040', colors.bg.screen]} style={styles.screenHeader}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Icon name="arrow-left" size={22} color="#F1F5F9" />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.screenHeaderTitle}>Study Groups</Text>
          <Text style={styles.screenHeaderSub}>Join groups for your enrolled units</Text>
        </View>
        <View style={styles.screenHeaderIcon}>
          <Icon name="account-group" size={22} color="#6366F1" />
        </View>
      </LinearGradient>

      {/* Unit selector + Search */}
      <View style={{ paddingHorizontal: r.pad, paddingTop: r.padSmall }}>
        <Text style={{ fontSize: r.smallSize, color: colors.text.secondary, marginBottom: r.padSmall }}>
          Join or view study groups created for your units.
        </Text>
        {!paramUnitId && unitIds.length > 1 && (
          <DropdownPicker
            value={activeUnit}
            options={unitOptions}
            onChange={(u) => setSelectedUnit(u)}
            placeholder="Select unit..."
            accentColor={colors.primary.main}
            style={{ marginBottom: r.padSmall }}
          />
        )}
        <View style={[styles.searchRow, { 
          paddingHorizontal: r.pad,
          paddingVertical: Platform.OS === 'ios' ? 10 : 6,
          borderRadius: r.cardRad / 2,
          marginBottom: r.padSmall,
        }]}>
          <Icon name="magnify" size={r.iconSize} color={colors.text.muted} />
          <TextInput
            style={[styles.searchInput, { fontSize: r.bodySize, paddingVertical: 0 }]}
            placeholder="Search groups..."
            placeholderTextColor={colors.text.muted}
            value={search}
            onChangeText={setSearch}
          />
          {search ? (
            <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Icon name="close-circle" size={r.iconSize} color={colors.text.muted} />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {loading && !refreshing ? (
        <View style={{ padding: r.pad }}>
          {[1, 2, 3].map((_, i) => (
            <GroupSkeleton key={i} r={r} />
          ))}
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => String(item.id)}
          contentContainerStyle={[
            styles.listContent, 
            { 
              paddingHorizontal: r.pad, 
              paddingTop: r.padSmall,
              paddingBottom: r.pad * 3,
            },
            isTablet && { alignSelf: 'center', width: '100%', maxWidth: contentMaxWidth }
          ]}
          refreshControl={
            <RefreshControl 
              refreshing={refreshing} 
              onRefresh={() => loadGroups(true)} 
              colors={[colors.primary.main]}
              tintColor={colors.primary.main}
            />
          }
          renderItem={({ item }) => (
            <GroupCard
              group={item}
              isMyGroup={item.id === myGroupId}
              onJoin={handleJoin}
              onLeave={handleLeave}
              r={r}
            />
          )}
          ListEmptyComponent={
            <View style={[styles.empty, { paddingTop: r.pad * 4 }]}>
              <Icon name="account-group-outline" size={r.heroSize} color={colors.bg.border} />
              <Text style={[styles.emptyTitle, { fontSize: r.titleSize, marginTop: r.pad }]}>
                {activeUnit ? 'No groups for this unit' : 'Select a unit'}
              </Text>
              <Text style={[styles.emptyText, { fontSize: r.bodySize, marginTop: r.padSmall }]}>
                Groups created by your lecturer will appear here
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  screenHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.07)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  screenHeaderTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F1F5F9',
    marginBottom: 2,
  },
  screenHeaderSub: {
    fontSize: 12,
    color: '#94A3B8',
  },
  screenHeaderIcon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: 'rgba(99,102,241,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(99,102,241,0.2)',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.bg.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.bg.border,
  },
  headerTitle: { fontWeight: '700', color: colors.text.primary },
  headerSubtitle: { color: colors.text.secondary, fontWeight: '500' },
  unitRow: { marginVertical: 8 },
  unitChip: { backgroundColor: colors.bg.card, borderWidth: 1, borderColor: colors.bg.border },
  unitChipActive: { backgroundColor: colors.primary.main, borderColor: colors.primary.main },
  unitChipText: { fontWeight: '600', color: colors.text.secondary },
  unitChipTextActive: { color: '#fff' },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg.card,
    borderWidth: 1,
    borderColor: colors.bg.border,
  },
  searchInput: { flex: 1, color: colors.text.primary },
  listContent: {},
  card: { backgroundColor: colors.bg.card, overflow: 'hidden' },
  myGroupBadge: { flexDirection: 'row', alignItems: 'center' },
  myGroupBadgeText: { color: '#fff', fontWeight: '700' },
  cardHeader: { flexDirection: 'row', alignItems: 'center' },
  groupAvatar: { justifyContent: 'center', alignItems: 'center' },
  groupName: { fontWeight: '700', color: colors.text.primary, marginBottom: 2 },
  groupMeta: { flexDirection: 'row', alignItems: 'center' },
  groupMetaText: { color: colors.text.muted },
  expandedBody: { borderTopWidth: 1, borderTopColor: colors.bg.border },
  memberList: {},
  memberRow: { flexDirection: 'row', alignItems: 'center' },
  memberAvatar: { justifyContent: 'center', alignItems: 'center', marginRight: 10 },
  memberAvatarLeader: { backgroundColor: colors.warning.soft },
  memberName: { flex: 1, color: colors.text.primary },
  leaderTag: { backgroundColor: colors.warning.soft, borderRadius: 8, color: colors.warning.main, fontWeight: '700' },
  actionBtn: { backgroundColor: colors.primary.main, alignItems: 'center', flexDirection: 'row', justifyContent: 'center' },
  leaveBtn: { backgroundColor: colors.danger.soft, borderColor: colors.danger.main, alignItems: 'center', flexDirection: 'row', justifyContent: 'center' },
  leaveBtnText: { fontWeight: '700' },
  actionBtnText: { color: '#fff', fontWeight: '700' },
  skeletonCard: { backgroundColor: colors.bg.card, borderWidth: 1, borderColor: colors.bg.border },
  skeletonHeader: { flexDirection: 'row' },
  skeletonAvatar: { backgroundColor: colors.bg.border },
  skeletonLine: { backgroundColor: colors.bg.border, borderRadius: 4 },
  empty: { alignItems: 'center' },
  emptyTitle: { fontWeight: '700', color: colors.text.secondary },
  emptyText: { color: colors.text.muted, textAlign: 'center' },
  // ── Capacity bar ──────────────────────────────────────────────────
  capacitySection: {},
  capacityTrack: {
    height: 5,
    backgroundColor: colors.bg.border,
    borderRadius: 3,
    overflow: 'hidden',
  },
  capacityFill: { height: '100%', borderRadius: 3 },
  capacityHint: { color: colors.text.muted },
  fullBadge: {
    backgroundColor: colors.danger.soft,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
  },
  fullBadgeText: {
    color: colors.danger.main,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});