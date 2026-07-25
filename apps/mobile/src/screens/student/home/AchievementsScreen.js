import React, {
  useState,
  useMemo,
  useRef,
  useEffect,
  useCallback,
  memo,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  Animated,
  Share,
  Modal,
  Alert,
  Vibration,
  ActivityIndicator,
  InteractionManager,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/Ionicons';
import OfflineBanner from '../../../components/OfflineBanner';
import useInternetStatus from '../../../hooks/useInternetStatus';
import useResponsive from '../../../hooks/useResponsive';
import {
  fetchStudentAchievements,
  getCachedAchievements,
} from '../../../utils/achievementsApi';
import AsyncStorage from '@react-native-async-storage/async-storage';
import sqliteStorage from '../../../storage/sqliteStorage';
import { emitNotificationReceived } from '../../../utils/notificationEventBus';
import DropdownPicker from '../../../components/DropdownPicker';
import { useColors } from '../../../theme';

const { width } = Dimensions.get('window');

const _achievementsCache = { data: null, timestamp: 0 };
const STALE_MS = 5 * 60 * 1000;

// Badge IDs that have already been notified
const NOTIFIED_IDS_KEY = 'markwise.achievement_notified_ids.v1';
const _notifiedAchievementIds = new Set();
let _loadPromise = null;

function _loadPersistedIds() {
  if (_loadPromise) return _loadPromise;
  _loadPromise = AsyncStorage.getItem(NOTIFIED_IDS_KEY)
    .then(raw => {
      if (raw) {
        try {
          JSON.parse(raw).forEach(id => _notifiedAchievementIds.add(id));
        } catch (_) {}
      }
    })
    .catch(() => {});
  return _loadPromise;
}

function _markIdNotified(id) {
  _notifiedAchievementIds.add(id);
  AsyncStorage.setItem(
    NOTIFIED_IDS_KEY,
    JSON.stringify([..._notifiedAchievementIds]),
  ).catch(() => {});
}

// ── Points Scoring Engine ────────────────────────────────────────────────
const POINTS_RULES = [
  {
    id: 'attend',
    label: 'Attend a Session',
    points: 10,
    icon: 'checkmark-circle',
    color: '#10B981',
    description: 'Earned each time you are marked present in a session.',
  },
  {
    id: 'daily_bonus',
    label: 'Daily Perfect',
    points: 5,
    icon: 'sunny',
    color: '#F59E0B',
    description: 'Attend all scheduled classes in a single day.',
  },
  {
    id: 'ontime',
    label: 'On-Time Bonus',
    points: 3,
    icon: 'timer',
    color: '#3B82F6',
    description: 'Mark attendance within the first 5 minutes of a session.',
  },
  {
    id: 'early_bird',
    label: 'Early Bird',
    points: 2,
    icon: 'sunny-outline',
    color: '#F59E0B',
    description: 'Be among first 10% to mark attendance.',
  },
  {
    id: 'weekly_100',
    label: 'Weekly 100%',
    points: 25,
    icon: 'calendar',
    color: '#4F46E5',
    description: 'Attend every session for a full week.',
  },
  {
    id: 'monthly_100',
    label: 'Monthly 100%',
    points: 100,
    icon: 'ribbon',
    color: '#8B5CF6',
    description: 'Attend every session for a full month.',
  },
  {
    id: 'streak_7',
    label: '7-Day Streak',
    points: 50,
    icon: 'flame',
    color: '#EF4444',
    description: '7 consecutive days with 100% attendance.',
  },
  {
    id: 'streak_30',
    label: '30-Day Streak',
    points: 200,
    icon: 'bonfire',
    color: '#EC4899',
    description: '30 consecutive days with 100% attendance.',
  },
  {
    id: 'streak_100',
    label: '100-Day Streak',
    points: 500,
    icon: 'infinite',
    color: '#FFD700',
    description: '100 consecutive days with 100% attendance. Legendary!',
  },
  {
    id: 'unit_90',
    label: 'Unit Above 90%',
    points: 30,
    icon: 'school',
    color: '#14B8A6',
    description: 'Maintain above 90% attendance in a unit for the month.',
  },
  {
    id: 'comeback',
    label: 'Comeback',
    points: 20,
    icon: 'arrow-undo',
    color: '#F59E0B',
    description: 'Attend a session after missing 3 or more in a row.',
  },
  {
    id: 'first',
    label: 'First Session',
    points: 10,
    icon: 'rocket',
    color: '#10B981',
    description: 'One-time bonus for your very first attendance.',
  },
  {
    id: 'group_leader',
    label: 'Group Leader',
    points: 15,
    icon: 'people',
    color: '#8B5CF6',
    description: 'Be the first in your class to attend.',
  },
  {
    id: 'perfect_month_all',
    label: 'All Units Perfect',
    points: 250,
    icon: 'trophy',
    color: '#FFD700',
    description: '100% attendance across ALL units for a month.',
  },
];

// ── Badge Definitions ────────────────────────────────────────────────────
const BADGES = [
  {
    id: 'perfect_week',
    name: 'Perfect Week',
    emoji: '✅',
    category: 'attendance',
    rarity: 'common',
    threshold: 'weekly_100',
    thresholdCount: 1,
    gradient: ['#34D399', '#10B981'],
    points: 50,
    description: 'Attend all sessions for a full week.',
  },
  {
    id: 'perfect_month',
    name: 'Month Master',
    emoji: '📅',
    category: 'attendance',
    rarity: 'rare',
    threshold: 'monthly_100',
    thresholdCount: 1,
    gradient: ['#A78BFA', '#8B5CF6'],
    points: 200,
    description: 'Attend all sessions for a full month.',
  },
  {
    id: 'perfect_semester',
    name: 'Semester Champion',
    emoji: '🏆',
    category: 'attendance',
    rarity: 'legendary',
    threshold: 'monthly_100',
    thresholdCount: 4,
    gradient: ['#FBBF24', '#F59E0B'],
    points: 500,
    description: 'Perfect attendance for an entire semester.',
  },
  {
    id: 'perfect_year',
    name: 'Academic Year God',
    emoji: '👑',
    category: 'attendance',
    rarity: 'mythic',
    threshold: 'monthly_100',
    thresholdCount: 8,
    gradient: ['#FFD700', '#FFA500'],
    points: 1000,
    description: 'Perfect attendance for an entire academic year.',
  },
  {
    id: 'week_warrior',
    name: 'Week Warrior',
    emoji: '🔥',
    category: 'streaks',
    rarity: 'common',
    threshold: 'streak_7',
    thresholdCount: 1,
    gradient: ['#F87171', '#EF4444'],
    points: 50,
    description: 'Maintain a 7-day attendance streak.',
  },
  {
    id: 'fortnight_phenom',
    name: 'Fortnight Phenom',
    emoji: '💪',
    category: 'streaks',
    rarity: 'rare',
    threshold: 'streak_7',
    thresholdCount: 2,
    gradient: ['#60A5FA', '#3B82F6'],
    points: 100,
    description: 'Maintain a 14-day attendance streak.',
  },
  {
    id: 'iron_will',
    name: 'Iron Will',
    emoji: '🛡️',
    category: 'streaks',
    rarity: 'epic',
    threshold: 'streak_30',
    thresholdCount: 1,
    gradient: ['#A78BFA', '#7C3AED'],
    points: 300,
    description: 'Maintain a 30-day attendance streak.',
  },
  {
    id: 'unyielding',
    name: 'Unyielding',
    emoji: '⚔️',
    category: 'streaks',
    rarity: 'legendary',
    threshold: 'streak_30',
    thresholdCount: 3,
    gradient: ['#F59E0B', '#FBBF24'],
    points: 600,
    description: 'Maintain a 90-day attendance streak.',
  },
  {
    id: 'immortal',
    name: 'Immortal',
    emoji: '♾️',
    category: 'streaks',
    rarity: 'mythic',
    threshold: 'streak_100',
    thresholdCount: 1,
    gradient: ['#FFD700', '#FF69B4'],
    points: 1000,
    description: 'Maintain a 100-day attendance streak.',
  },
  {
    id: 'early_bird_badge',
    name: 'Early Bird',
    emoji: '🐦',
    category: 'punctuality',
    rarity: 'common',
    threshold: 'ontime',
    thresholdCount: 10,
    gradient: ['#60A5FA', '#3B82F6'],
    points: 30,
    description: 'Be on time for 10 sessions.',
  },
  {
    id: 'always_first',
    name: 'Always First',
    emoji: '⚡',
    category: 'punctuality',
    rarity: 'epic',
    threshold: 'ontime',
    thresholdCount: 50,
    gradient: ['#FBBF24', '#D97706'],
    points: 150,
    description: 'Be on time for 50 sessions.',
  },
  {
    id: 'time_master',
    name: 'Time Master',
    emoji: '⏰',
    category: 'punctuality',
    rarity: 'legendary',
    threshold: 'ontime',
    thresholdCount: 100,
    gradient: ['#8B5CF6', '#6D28D9'],
    points: 400,
    description: 'Be on time for 100 sessions.',
  },
  {
    id: 'chronos',
    name: 'Chronos',
    emoji: '⌛',
    category: 'punctuality',
    rarity: 'mythic',
    threshold: 'early_bird',
    thresholdCount: 50,
    gradient: ['#FFD700', '#FF8C00'],
    points: 750,
    description: 'Be among the first 10% to mark attendance 50 times.',
  },
  {
    id: 'club_75',
    name: '75% Club',
    emoji: '📊',
    category: 'consistency',
    rarity: 'common',
    threshold: 'unit_90',
    thresholdCount: 0,
    gradient: ['#2DD4BF', '#14B8A6'],
    points: 25,
    description: 'Maintain 75%+ overall attendance.',
  },
  {
    id: 'elite_90',
    name: '90% Elite',
    emoji: '⭐',
    category: 'consistency',
    rarity: 'rare',
    threshold: 'unit_90',
    thresholdCount: 3,
    gradient: ['#818CF8', '#6366F1'],
    points: 75,
    description: 'Maintain 90%+ attendance in 3 units.',
  },
  {
    id: 'perfectionist',
    name: 'Perfectionist',
    emoji: '🎯',
    category: 'consistency',
    rarity: 'epic',
    threshold: 'unit_90',
    thresholdCount: 6,
    gradient: ['#F472B6', '#EC4899'],
    points: 200,
    description: 'Maintain 90%+ attendance in 6 units.',
  },
  {
    id: 'academic_legend',
    name: 'Academic Legend',
    emoji: '📚',
    category: 'consistency',
    rarity: 'legendary',
    threshold: 'perfect_month_all',
    thresholdCount: 1,
    gradient: ['#FFD700', '#FFA500'],
    points: 500,
    description: '100% attendance across ALL units for a month.',
  },
  {
    id: 'first_step',
    name: 'First Step',
    emoji: '🎓',
    category: 'milestones',
    rarity: 'common',
    threshold: 'first',
    thresholdCount: 1,
    gradient: ['#F472B6', '#EC4899'],
    points: 10,
    description: 'Complete your first session.',
  },
  {
    id: 'comeback_king',
    name: 'Comeback King',
    emoji: '👑',
    category: 'milestones',
    rarity: 'rare',
    threshold: 'comeback',
    thresholdCount: 3,
    gradient: ['#F59E0B', '#D97706'],
    points: 60,
    description: 'Make a comeback after missing 3+ sessions.',
  },
  {
    id: 'century',
    name: 'Century',
    emoji: '💯',
    category: 'milestones',
    rarity: 'epic',
    threshold: 'attend',
    thresholdCount: 100,
    gradient: ['#34D399', '#059669'],
    points: 200,
    description: 'Attend 100 sessions.',
  },
  {
    id: 'double_century',
    name: 'Double Century',
    emoji: '🎯',
    category: 'milestones',
    rarity: 'legendary',
    threshold: 'attend',
    thresholdCount: 200,
    gradient: ['#818CF8', '#4F46E5'],
    points: 450,
    description: 'Attend 200 sessions.',
  },
  {
    id: 'half_k',
    name: '500 Club',
    emoji: '🏅',
    category: 'milestones',
    rarity: 'legendary',
    threshold: 'attend',
    thresholdCount: 500,
    gradient: ['#FBBF24', '#F59E0B'],
    points: 800,
    description: 'Attend 500 sessions.',
  },
  {
    id: 'millennium',
    name: 'Millennium',
    emoji: '🌟',
    category: 'milestones',
    rarity: 'mythic',
    threshold: 'attend',
    thresholdCount: 1000,
    gradient: ['#FFD700', '#FF69B4'],
    points: 1500,
    description: 'Attend 1000 sessions.',
  },
  {
    id: 'social_butterfly',
    name: 'Social Butterfly',
    emoji: '🦋',
    category: 'social',
    rarity: 'common',
    threshold: 'group_leader',
    thresholdCount: 5,
    gradient: ['#F472B6', '#EC4899'],
    points: 40,
    description: 'Be group leader 5 times.',
  },
  {
    id: 'influencer',
    name: 'Influencer',
    emoji: '📢',
    category: 'social',
    rarity: 'rare',
    threshold: 'group_leader',
    thresholdCount: 15,
    gradient: ['#60A5FA', '#3B82F6'],
    points: 120,
    description: 'Be group leader 15 times.',
  },
  {
    id: 'legend',
    name: 'Living Legend',
    emoji: '🏆',
    category: 'social',
    rarity: 'epic',
    threshold: 'group_leader',
    thresholdCount: 30,
    gradient: ['#8B5CF6', '#6D28D9'],
    points: 300,
    description: 'Be group leader 30 times.',
  },
];

const BADGE_CATEGORY_OPTIONS = [
  { value: 'all', label: 'All Badges', icon: 'view-grid-outline' },
  { value: 'attendance', label: 'Attendance', icon: 'calendar-check' },
  { value: 'streaks', label: 'Streaks', icon: 'fire' },
  { value: 'punctuality', label: 'Punctuality', icon: 'clock-outline' },
  { value: 'consistency', label: 'Consistency', icon: 'trending-up' },
  { value: 'milestones', label: 'Milestones', icon: 'flag-outline' },
  { value: 'social', label: 'Social', icon: 'account-group-outline' },
];

const RARITY_CONFIG = {
  common: { label: 'Common', color: '#10B981', multiplier: 1 },
  rare: { label: 'Rare', color: '#3B82F6', multiplier: 2 },
  epic: { label: 'Epic', color: '#8B5CF6', multiplier: 3 },
  legendary: { label: 'Legendary', color: '#F59E0B', multiplier: 5 },
  mythic: { label: 'Mythic', color: '#FFD700', multiplier: 10 },
};

const getRarityConfig = rarity => RARITY_CONFIG[rarity] ?? RARITY_CONFIG.common;

// ── Progress Bar Component ───────────────────────────────────────────────
const ProgressBar = memo(({ progress, color, height = 6 }) => {
  const safeProgress = Math.min(Math.max(progress || 0, 0), 100);

  return (
    <View
      style={{
        height,
        backgroundColor: `${color}25`,
        borderRadius: 3,
        overflow: 'hidden',
      }}
    >
      <LinearGradient
        colors={[color, `${color}CC`]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{ width: `${safeProgress}%`, height }}
      />
    </View>
  );
});

// ── Daily Challenge Card ─────────────────────────────────────────────────
const DailyChallengeCard = memo(({ challenges = [], onComplete, styles }) => {
  const [expanded, setExpanded] = useState(false);

  if (!challenges || challenges.length === 0) return null;

  return (
    <TouchableOpacity
      style={styles.dailyCard}
      activeOpacity={0.9}
      onPress={() => setExpanded(!expanded)}
    >
      <LinearGradient
        colors={['#2D3A4F', '#1E293B']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.dailyGradient}
      >
        <View style={styles.dailyHeader}>
          <View style={styles.dailyTitleContainer}>
            <Icon name="today" size={20} color="#F59E0B" />
            <Text style={styles.dailyTitle}>Daily Challenges</Text>
          </View>
          <View style={styles.dailyTimer}>
            <Icon name="time" size={14} color="#9CA3AF" />
            <Text style={styles.dailyTimerText}>11:59 PM</Text>
          </View>
        </View>

        {challenges.map((challenge, index) => (
          <View key={challenge.id || index} style={styles.dailyChallengeItem}>
            <View style={styles.dailyChallengeLeft}>
              <View
                style={[
                  styles.dailyChallengeIcon,
                  {
                    backgroundColor: challenge.color
                      ? `${challenge.color}25`
                      : '#4F46E525',
                  },
                ]}
              >
                <Icon
                  name={challenge.icon || 'star'}
                  size={16}
                  color={challenge.color || '#4F46E5'}
                />
              </View>
              <View style={styles.dailyChallengeInfo}>
                <Text style={styles.dailyChallengeTitle}>
                  {challenge.title || 'Complete Challenge'}
                </Text>
                <Text style={styles.dailyChallengeDesc}>
                  {challenge.description || 'Earn points daily'}
                </Text>
              </View>
            </View>
            <View style={styles.dailyChallengeRight}>
              <Text
                style={[
                  styles.dailyChallengePoints,
                  { color: challenge.color || '#4F46E5' },
                ]}
              >
                +{challenge.points || 10}
              </Text>
              {challenge.completed ? (
                <Icon name="checkmark-circle" size={20} color="#10B981" />
              ) : (
                <TouchableOpacity
                  style={[
                    styles.dailyChallengeBtn,
                    { backgroundColor: challenge.color || '#4F46E5' },
                  ]}
                  onPress={() => onComplete && onComplete(challenge)}
                >
                  <Text style={styles.dailyChallengeBtnText}>Do</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        ))}
      </LinearGradient>
    </TouchableOpacity>
  );
});

// ── Leaderboard Preview Component ───────────────────────────────────────
const LeaderboardPreview = memo(
  ({ userRank, topStudents = [], onViewAll, styles }) => {
    if (!topStudents || topStudents.length === 0) return null;

    return (
      <View style={styles.leaderboardCard}>
        <View style={styles.leaderboardHeader}>
          <View style={styles.leaderboardTitleContainer}>
            <Icon name="trophy" size={20} color="#F59E0B" />
            <Text style={styles.leaderboardTitle}>Class Leaderboard</Text>
          </View>
          <TouchableOpacity onPress={onViewAll}>
            <Text style={styles.leaderboardViewAll}>View All</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.leaderboardPodium}>
          {topStudents.slice(0, 3).map((student, index) => (
            <View
              key={student.id || index}
              style={[styles.podiumItem, index === 0 && styles.podiumFirst]}
            >
              <LinearGradient
                colors={
                  index === 0
                    ? ['#FFD700', '#FFA500']
                    : index === 1
                    ? ['#C0C0C0', '#A0A0A0']
                    : ['#CD7F32', '#B87333']
                }
                style={styles.podiumBadge}
              >
                <Text style={styles.podiumRank}>#{index + 1}</Text>
              </LinearGradient>
              <View style={styles.podiumAvatar}>
                <Text style={styles.podiumAvatarText}>
                  {student.name?.charAt(0) || '?'}
                </Text>
              </View>
              <Text style={styles.podiumName} numberOfLines={1}>
                {student.name || 'Student'}
              </Text>
              <Text style={styles.podiumPoints}>{student.points || 0} pts</Text>
            </View>
          ))}
        </View>

        {userRank && (
          <View style={styles.userRankContainer}>
            <View style={styles.userRankLeft}>
              <Text style={styles.userRankLabel}>Your Rank</Text>
              <Text style={styles.userRankValue}>#{userRank}</Text>
            </View>
            <View style={styles.userRankDivider} />
            <View style={styles.userRankRight}>
              <Text style={styles.userRankLabel}>Next Rank</Text>
              <Text style={styles.userRankNext}>
                {topStudents[userRank - 2]?.name || 'Top Spot'}
              </Text>
              <Text style={styles.userRankGap}>
                {topStudents[userRank - 2]?.points && userRank
                  ? `${
                      topStudents[userRank - 2].points -
                      (topStudents[userRank - 1]?.points || 0)
                    } pts needed`
                  : 'Keep going!'}
              </Text>
            </View>
          </View>
        )}
      </View>
    );
  },
);

// ── Weekly Quest Card ───────────────────────────────────────────────────
const WeeklyQuestCard = memo(({ quests = [], styles }) => {
  if (!quests || quests.length === 0) return null;

  return (
    <View style={styles.questCard}>
      <LinearGradient
        colors={['rgba(99,102,241,0.2)', 'rgba(139,92,246,0.2)']}
        style={styles.questGradient}
      >
        <View style={styles.questHeader}>
          <Icon name="calendar" size={20} color="#8B5CF6" />
          <Text style={styles.questTitle}>Weekly Quests</Text>
          <View style={styles.questTimer}>
            <Icon name="time" size={14} color="#9CA3AF" />
            <Text style={styles.questTimerText}>6d left</Text>
          </View>
        </View>

        {quests.map((quest, index) => (
          <View key={quest.id || index} style={styles.questItem}>
            <View style={styles.questInfo}>
              <Text style={styles.questName}>{quest.name || 'Quest'}</Text>
              <Text style={styles.questDesc}>
                {quest.description || 'Complete to earn points'}
              </Text>
            </View>
            <View style={styles.questProgress}>
              <Text style={styles.questProgressText}>
                {quest.progress || 0}/{quest.target || 1}
              </Text>
              <View style={styles.questProgressBar}>
                <View
                  style={[
                    styles.questProgressFill,
                    {
                      width: `${
                        ((quest.progress || 0) / (quest.target || 1)) * 100
                      }%`,
                    },
                  ]}
                />
              </View>
            </View>
            <Text style={styles.questPoints}>+{quest.points || 0}</Text>
          </View>
        ))}
      </LinearGradient>
    </View>
  );
});

// ── Achievement Unlock Animation ────────────────────────────────────────
const UnlockAnimation = memo(({ visible, badge, onComplete, styles }) => {
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let timeoutId;

    if (visible && badge) {
      Vibration.vibrate([0, 100, 50, 100]);

      Animated.parallel([
        Animated.spring(scaleAnim, {
          toValue: 1,
          friction: 4,
          tension: 100,
          useNativeDriver: true,
        }),
        Animated.timing(rotateAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ]).start();

      timeoutId = setTimeout(() => onComplete && onComplete(), 3000);
    }

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      scaleAnim.stopAnimation();
      rotateAnim.stopAnimation();
    };
  }, [visible, badge, scaleAnim, rotateAnim, onComplete]);

  const rotate = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  if (!visible || !badge) return null;

  return (
    <Modal transparent visible={visible} animationType="fade">
      <View style={styles.unlockOverlay}>
        <Animated.View
          style={[
            styles.unlockContainer,
            { transform: [{ scale: scaleAnim }] },
          ]}
        >
          <LinearGradient
            colors={badge.gradient || ['#6366F1', '#8B5CF6']}
            style={styles.unlockBadge}
          >
            <Animated.Text
              style={[styles.unlockEmoji, { transform: [{ rotate }] }]}
            >
              {badge.emoji || '🏆'}
            </Animated.Text>
          </LinearGradient>
          <Text style={styles.unlockTitle}>Achievement Unlocked!</Text>
          <Text style={styles.unlockName}>{badge.name || 'Achievement'}</Text>
          <Text style={styles.unlockPoints}>+{badge.points || 0} pts</Text>
          <View style={styles.unlockRarity}>
            <Text
              style={[
                styles.unlockRarityText,
                { color: getRarityConfig(badge.rarity).color },
              ]}
            >
              {getRarityConfig(badge.rarity).label}
            </Text>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
});

// ── Streak Protection Card ──────────────────────────────────────────────
const StreakProtectionCard = memo(
  ({ active = false, onActivate, currentStreak = 0, styles }) => {
    if (currentStreak < 7) return null;

    return (
      <TouchableOpacity
        style={[styles.protectionCard, active && styles.protectionCardActive]}
        onPress={onActivate}
        disabled={active}
      >
        <Icon
          name={active ? 'shield-checkmark' : 'shield-outline'}
          size={24}
          color={active ? '#10B981' : '#9CA3AF'}
        />
        <View style={styles.protectionInfo}>
          <Text style={styles.protectionTitle}>Streak Protection</Text>
          <Text style={styles.protectionDesc}>
            {active ? 'Active for 24h' : 'Use 50 pts to protect streak'}
          </Text>
        </View>
        {!active && (
          <View style={styles.protectionCost}>
            <Text style={styles.protectionCostText}>50</Text>
            <Icon name="flash" size={12} color="#F59E0B" />
          </View>
        )}
      </TouchableOpacity>
    );
  },
);

// ── Department Rank Card ────────────────────────────────────────────────
const DepartmentRankCard = memo(
  ({ deptRank, deptTotal, weeklyRankChange, styles }) => {
    if (!deptRank && weeklyRankChange === 0) return null;
    const percentile =
      deptRank && deptTotal > 0
        ? Math.round((1 - (deptRank - 1) / deptTotal) * 100)
        : null;
    const rankColor = !percentile
      ? '#F59E0B'
      : percentile >= 80
      ? '#10B981'
      : percentile >= 50
      ? '#4F46E5'
      : '#F59E0B';

    return (
      <View style={styles.deptRankCard}>
        <LinearGradient
          colors={['#1E293B', '#2D3A4F']}
          style={styles.deptRankGradient}
        >
          <View style={styles.deptRankHeader}>
            <Icon name="podium" size={18} color="#F59E0B" />
            <Text style={styles.deptRankTitle}>Department Ranking</Text>
            {!!weeklyRankChange && (
              <View
                style={[
                  styles.weekChangePill,
                  {
                    backgroundColor:
                      weeklyRankChange > 0 ? '#10B98125' : '#EF444425',
                  },
                ]}
              >
                <Icon
                  name={weeklyRankChange > 0 ? 'trending-up' : 'trending-down'}
                  size={11}
                  color={weeklyRankChange > 0 ? '#10B981' : '#EF4444'}
                />
                <Text
                  style={[
                    styles.weekChangeText,
                    { color: weeklyRankChange > 0 ? '#10B981' : '#EF4444' },
                  ]}
                >
                  {weeklyRankChange > 0
                    ? `+${weeklyRankChange}`
                    : weeklyRankChange}{' '}
                  this week
                </Text>
              </View>
            )}
          </View>

          {deptRank ? (
            <View style={styles.deptRankBody}>
              <LinearGradient
                colors={
                  percentile >= 80
                    ? ['#10B981', '#059669']
                    : percentile >= 50
                    ? ['#4F46E5', '#6366F1']
                    : ['#F59E0B', '#D97706']
                }
                style={styles.deptRankBigBadge}
              >
                <Text style={styles.deptRankBigNum}>#{deptRank}</Text>
                {deptTotal > 0 && (
                  <Text style={styles.deptRankBigSub}>of {deptTotal}</Text>
                )}
              </LinearGradient>
              <View style={styles.deptRankRight}>
                {percentile !== null && (
                  <Text
                    style={[styles.deptPercentileValue, { color: rankColor }]}
                  >
                    Top {percentile}%
                  </Text>
                )}
                <Text style={styles.deptPercentileLabel}>
                  of your department
                </Text>
                {percentile !== null && (
                  <View style={styles.deptPercentileBar}>
                    <View
                      style={[
                        styles.deptPercentileFill,
                        { width: `${percentile}%`, backgroundColor: rankColor },
                      ]}
                    />
                  </View>
                )}
                <Text style={[styles.deptRankMotivation, { color: rankColor }]}>
                  {!percentile
                    ? 'Keep climbing!'
                    : percentile >= 90
                    ? 'Outstanding! Elite performer 🏆'
                    : percentile >= 75
                    ? 'Top quarter — push harder!'
                    : percentile >= 50
                    ? 'Above average — aim higher!'
                    : percentile >= 25
                    ? 'Move up — you have got this!'
                    : 'Big gains ahead — push hard!'}
                </Text>
              </View>
            </View>
          ) : (
            <Text style={styles.deptRankNoData}>
              Department rank not available yet
            </Text>
          )}
        </LinearGradient>
      </View>
    );
  },
);

// ── Rivalry Card ────────────────────────────────────────────────────────
const RivalryCard = memo(
  ({ rivalAbove, rivalBelow, myPoints, myRank, styles }) => {
    if (!rivalAbove && !rivalBelow) return null;

    return (
      <View style={styles.rivalryCard}>
        <View style={styles.rivalryHeader}>
          <Icon name="swap-vertical" size={18} color="#8B5CF6" />
          <Text style={styles.rivalryTitle}>Your Rivals</Text>
          <Text style={styles.rivalrySubtitle}>Stay competitive</Text>
        </View>

        {rivalAbove && (
          <View style={styles.rivalRow}>
            <View
              style={[styles.rivalAvatar, { backgroundColor: '#F59E0B25' }]}
            >
              <Text style={[styles.rivalAvatarText, { color: '#F59E0B' }]}>
                {rivalAbove.name?.charAt(0) ?? '?'}
              </Text>
            </View>
            <View style={styles.rivalInfo}>
              <View style={styles.rivalNameRow}>
                <Text style={styles.rivalName} numberOfLines={1}>
                  {rivalAbove.name ?? 'Student'}
                </Text>
                {myRank && (
                  <View
                    style={[
                      styles.rivalRankPill,
                      { backgroundColor: '#F59E0B25' },
                    ]}
                  >
                    <Text style={[styles.rivalRankText, { color: '#F59E0B' }]}>
                      #{myRank - 1}
                    </Text>
                  </View>
                )}
              </View>
              <Text style={styles.rivalMeta}>
                {rivalAbove.points != null && myPoints != null
                  ? `${rivalAbove.points - myPoints} pts ahead — close the gap!`
                  : 'Just ahead of you'}
              </Text>
            </View>
            <Icon name="arrow-up-circle-outline" size={26} color="#F59E0B" />
          </View>
        )}

        {rivalAbove && rivalBelow && <View style={styles.rivalDivider} />}

        {rivalBelow && (
          <View style={styles.rivalRow}>
            <View
              style={[styles.rivalAvatar, { backgroundColor: '#3B82F625' }]}
            >
              <Text style={[styles.rivalAvatarText, { color: '#3B82F6' }]}>
                {rivalBelow.name?.charAt(0) ?? '?'}
              </Text>
            </View>
            <View style={styles.rivalInfo}>
              <View style={styles.rivalNameRow}>
                <Text style={styles.rivalName} numberOfLines={1}>
                  {rivalBelow.name ?? 'Student'}
                </Text>
                {myRank && (
                  <View
                    style={[
                      styles.rivalRankPill,
                      { backgroundColor: '#3B82F625' },
                    ]}
                  >
                    <Text style={[styles.rivalRankText, { color: '#3B82F6' }]}>
                      #{myRank + 1}
                    </Text>
                  </View>
                )}
              </View>
              <Text style={styles.rivalMeta}>
                {rivalBelow.points != null && myPoints != null
                  ? `${
                      myPoints - rivalBelow.points
                    } pts ahead — defend your spot!`
                  : 'Just behind you'}
              </Text>
            </View>
            <Icon name="shield-checkmark-outline" size={26} color="#3B82F6" />
          </View>
        )}
      </View>
    );
  },
);

const EMPTY_ATTENDANCE = {
  totalSessions: 0,
  attended: 0,
  missed: 0,
  percent: 0,
  currentStreak: 0,
  longestStreak: 0,
  perfectWeeks: 0,
  perfectMonths: 0,
  ontimeCount: 0,
  earlyBirdCount: 0,
  comebacks: 0,
  firstSessionDone: false,
  unitsAbove90: [],
  groupLeaderCount: 0,
  rank: null,
  totalStudents: 0,
  deptRank: null,
  deptTotal: 0,
};

// ── Main Component ───────────────────────────────────────────────────────
export default function AchievementsScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { contentMaxWidth } = useResponsive();
  const { isOnline } = useInternetStatus();

  const [selectedFilter, setSelectedFilter] = useState('all');
  const [selectedBadge, setSelectedBadge] = useState(null);
  const [justUnlocked, setJustUnlocked] = useState(null);
  const [streakProtected, setStreakProtected] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(() => !_achievementsCache.data);
  const [isBackgroundUpdate, setIsBackgroundUpdate] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const [attendanceData, setAttendanceData] = useState(EMPTY_ATTENDANCE);
  const [dailyChallenges, setDailyChallenges] = useState([]);
  const [weeklyQuests, setWeeklyQuests] = useState([]);
  const [leaderboardData, setLeaderboardData] = useState({
    userRank: null,
    topStudents: [],
  });
  const [rivalAbove, setRivalAbove] = useState(null);
  const [rivalBelow, setRivalBelow] = useState(null);
  const [weeklyRankChange, setWeeklyRankChange] = useState(0);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const badgeModalAnim = useRef(new Animated.Value(0.3)).current;
  const hasLoadedRef = useRef(false);
  const isMountedRef = useRef(true);
  const justUnlockedRef = useRef(null);

  // Persist newly-unlocked badge
  useEffect(() => {
    if (!justUnlocked) return;
    if (_notifiedAchievementIds.has(justUnlocked.id)) return;
    _markIdNotified(justUnlocked.id);
    sqliteStorage
      .savePushNotification({
        id: `achievement-${justUnlocked.id}`,
        type: 'achievement',
        title: 'Achievement Unlocked! 🏆',
        body: `${justUnlocked.name || 'Achievement'} — +${
          justUnlocked.points || 0
        } pts`,
        data: {
          badgeId: justUnlocked.id,
          badgeName: justUnlocked.name,
          points: justUnlocked.points,
        },
      })
      .then(wasNew => {
        if (wasNew) emitNotificationReceived({ type: 'achievement' });
      })
      .catch(() => {});
  }, [justUnlocked]);

  // ── Animation Effects ───────────────────────────────────────────────────
  useEffect(() => {
    isMountedRef.current = true;

    const animations = Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 600,
        useNativeDriver: true,
      }),
    ]);

    animations.start();

    return () => {
      isMountedRef.current = false;
      animations.stop();
      fadeAnim.stopAnimation();
      slideAnim.stopAnimation();
      badgeModalAnim.stopAnimation();
    };
  }, [fadeAnim, slideAnim, badgeModalAnim]);

  useEffect(() => {
    if (selectedBadge) {
      badgeModalAnim.setValue(0.1);
      Animated.spring(badgeModalAnim, {
        toValue: 1,
        friction: 5,
        tension: 180,
        useNativeDriver: true,
      }).start();
    }
  }, [selectedBadge, badgeModalAnim]);

  // ── Data Mapping ────────────────────────────────────────────────────────
  const mapToState = useCallback(
    data => {
      if (!data || !isMountedRef.current) return;

      setAttendanceData(prev => ({
        totalSessions: data.totalSessions ?? prev.totalSessions,
        attended: data.attended ?? prev.attended,
        missed:
          (data.totalSessions ?? prev.totalSessions) -
          (data.attended ?? prev.attended),
        percent: data.percent ?? prev.percent,
        currentStreak: data.currentStreak ?? prev.currentStreak,
        longestStreak: data.longestStreak ?? prev.longestStreak,
        perfectWeeks: data.perfectWeeks ?? prev.perfectWeeks,
        perfectMonths: data.perfectMonths ?? prev.perfectMonths,
        ontimeCount: data.ontimeCount ?? prev.ontimeCount,
        earlyBirdCount: data.earlyBirdCount ?? prev.earlyBirdCount,
        comebacks: data.comebacks ?? prev.comebacks,
        firstSessionDone: data.firstSessionDone ?? prev.firstSessionDone,
        unitsAbove90: Array.isArray(data.unitsAbove90)
          ? data.unitsAbove90
          : prev.unitsAbove90,
        groupLeaderCount: data.groupLeaderCount ?? prev.groupLeaderCount,
        rank: data.rank ?? prev.rank,
        totalStudents: data.totalStudents ?? prev.totalStudents,
        deptRank: data.deptRank ?? prev.deptRank,
        deptTotal: data.deptTotal ?? prev.deptTotal,
      }));
      if (data.rivalAbove !== undefined) setRivalAbove(data.rivalAbove);
      if (data.rivalBelow !== undefined) setRivalBelow(data.rivalBelow);
      if (data.weeklyRankChange !== undefined)
        setWeeklyRankChange(data.weeklyRankChange ?? 0);

      const CHALLENGE_COLORS = [
        '#F59E0B',
        '#3B82F6',
        '#EF4444',
        '#10B981',
        '#8B5CF6',
      ];
      if (Array.isArray(data.dailyChallenges) && data.dailyChallenges.length) {
        setDailyChallenges(
          data.dailyChallenges.map((c, i) => ({
            ...c,
            color: c.color || CHALLENGE_COLORS[i % CHALLENGE_COLORS.length],
          })),
        );
      }

      if (Array.isArray(data.weeklyQuests) && data.weeklyQuests.length) {
        setWeeklyQuests(data.weeklyQuests);
      }

      if (data.leaderboard || data.rank != null) {
        setLeaderboardData({
          userRank: data.rank ?? leaderboardData.userRank,
          topStudents: (Array.isArray(data.leaderboard)
            ? data.leaderboard
            : leaderboardData.topStudents
          ).map(s => ({
            ...s,
            avatar: s.avatar ?? s.name?.charAt(0) ?? '?',
          })),
        });
      }

      if (
        data.newlyUnlockedBadge &&
        !justUnlockedRef.current &&
        !_notifiedAchievementIds.has(data.newlyUnlockedBadge.id)
      ) {
        const localDef = BADGES.find(b => b.id === data.newlyUnlockedBadge.id);
        const badge = localDef
          ? { ...localDef, ...data.newlyUnlockedBadge }
          : null;
        justUnlockedRef.current = badge;
        setJustUnlocked(badge);
      }
    },
    [leaderboardData.userRank, leaderboardData.topStudents],
  );

  // ── Data Loading ────────────────────────────────────────────────────────
  const loadData = useCallback(
    async (forceRefresh = false, isBackground = false) => {
      if (isBackground) {
        setIsBackgroundUpdate(true);
      } else if (!_achievementsCache.data) {
        setIsLoading(true);
      }
      setError(null);

      try {
        await _loadPersistedIds();
        if (!hasLoadedRef.current) {
          if (_achievementsCache.data) {
            if (isMountedRef.current) mapToState(_achievementsCache.data);
            hasLoadedRef.current = true;
          } else {
            const cached = await getCachedAchievements();
            if (cached && isMountedRef.current) {
              mapToState(cached);
              _achievementsCache.data = cached;
              _achievementsCache.timestamp = Date.now();
              setLastRefreshed(new Date());
              hasLoadedRef.current = true;
            }
          }
        }

        if (
          isOnline &&
          (!hasLoadedRef.current || forceRefresh || isBackground)
        ) {
          const fresh = await fetchStudentAchievements();
          if (fresh && isMountedRef.current) {
            mapToState(fresh);
            _achievementsCache.data = fresh;
            _achievementsCache.timestamp = Date.now();
            setLastRefreshed(new Date());
            hasLoadedRef.current = true;
          }
        } else if (!isOnline && !hasLoadedRef.current) {
          setError('You are offline. Showing cached data if available.');
        }
      } catch (err) {
        console.error('Error loading achievements:', err);
        if (!hasLoadedRef.current) {
          setError('Failed to load achievements. Please try again.');
        }
        if (_achievementsCache.data) return;
      } finally {
        if (isMountedRef.current) {
          if (isBackground) setIsBackgroundUpdate(false);
          else setIsLoading(false);
        }
      }
    },
    [mapToState, isOnline],
  );

  useFocusEffect(
    useCallback(() => {
      let task;
      const age = Date.now() - _achievementsCache.timestamp;
      if (!_achievementsCache.data || age > STALE_MS) {
        loadData(false, false);
      } else {
        task = InteractionManager.runAfterInteractions(() =>
          loadData(false, true),
        );
      }
      return () => task?.cancel();
    }, [loadData]),
  );

  const handleRefresh = useCallback(() => {
    hasLoadedRef.current = false;
    loadData(true, false);
  }, [loadData]);

  // ── Memoized Calculations ──────────────────────────────────────────────
  const pointsBreakdown = useMemo(() => {
    const d = attendanceData;
    return [
      { rule: 'attend', count: d.attended, pts: d.attended * 10 },
      {
        rule: 'daily_bonus',
        count: d.perfectWeeks * 5,
        pts: d.perfectWeeks * 25,
      },
      { rule: 'ontime', count: d.ontimeCount, pts: d.ontimeCount * 3 },
      {
        rule: 'early_bird',
        count: d.earlyBirdCount,
        pts: d.earlyBirdCount * 2,
      },
      { rule: 'weekly_100', count: d.perfectWeeks, pts: d.perfectWeeks * 25 },
      {
        rule: 'monthly_100',
        count: d.perfectMonths,
        pts: d.perfectMonths * 100,
      },
      {
        rule: 'streak_7',
        count: Math.floor(d.longestStreak / 7),
        pts: Math.floor(d.longestStreak / 7) * 50,
      },
      {
        rule: 'streak_30',
        count: Math.floor(d.longestStreak / 30),
        pts: Math.floor(d.longestStreak / 30) * 200,
      },
      {
        rule: 'unit_90',
        count: d.unitsAbove90.length,
        pts: d.unitsAbove90.length * 30,
      },
      { rule: 'comeback', count: d.comebacks, pts: d.comebacks * 20 },
      {
        rule: 'first',
        count: d.firstSessionDone ? 1 : 0,
        pts: d.firstSessionDone ? 10 : 0,
      },
      {
        rule: 'group_leader',
        count: d.groupLeaderCount,
        pts: d.groupLeaderCount * 15,
      },
    ].filter(r => r.pts > 0);
  }, [attendanceData]);

  const totalPoints = useMemo(
    () => pointsBreakdown.reduce((sum, r) => sum + r.pts, 0),
    [pointsBreakdown],
  );

  const badgeStatus = useMemo(() => {
    const d = attendanceData;
    const counts = {
      attend: d.attended,
      weekly_100: d.perfectWeeks,
      monthly_100: d.perfectMonths,
      streak_7: Math.floor(d.longestStreak / 7),
      streak_30: Math.floor(d.longestStreak / 30),
      streak_100: Math.floor(d.longestStreak / 100),
      ontime: d.ontimeCount,
      early_bird: d.earlyBirdCount,
      unit_90: d.unitsAbove90.length,
      first: d.firstSessionDone ? 1 : 0,
      comeback: d.comebacks,
      group_leader: d.groupLeaderCount,
      perfect_month_all: d.perfectMonths >= 1 ? 1 : 0,
    };

    return BADGES.map(b => {
      const current = counts[b.threshold] || 0;
      const needed = b.thresholdCount || 1;
      const unlocked = current >= needed;
      const progress =
        needed > 0
          ? Math.min((current / needed) * 100, 100)
          : d.percent >= 75
          ? 100
          : (d.percent / 75) * 100;
      return {
        ...b,
        unlocked,
        progress: Math.round(progress),
        current,
        needed,
      };
    });
  }, [attendanceData]);

  const unlockedCount = useMemo(
    () => badgeStatus.filter(b => b.unlocked).length,
    [badgeStatus],
  );
  const nextBadge = useMemo(
    () =>
      badgeStatus
        .filter(b => !b.unlocked)
        .sort((a, b) => b.progress - a.progress)[0],
    [badgeStatus],
  );
  const filteredBadges = useMemo(
    () =>
      selectedFilter === 'all'
        ? badgeStatus
        : badgeStatus.filter(b => b.category === selectedFilter),
    [selectedFilter, badgeStatus],
  );

  // ── Handlers ────────────────────────────────────────────────────────────
  const handleChallengeComplete = useCallback(challenge => {
    Alert.alert(
      '🎯 Challenge Complete!',
      `You earned ${challenge.points} points! Keep up the great work!`,
      [{ text: 'Awesome!', style: 'default' }],
    );
    setDailyChallenges(prev =>
      prev.map(c => (c.id === challenge.id ? { ...c, completed: true } : c)),
    );
    Vibration.vibrate(100);
  }, []);

  const handleStreakProtection = useCallback(() => {
    Alert.alert(
      '🛡️ Activate Streak Protection?',
      `Spend 50 points to protect your ${attendanceData.currentStreak}-day streak for 24 hours?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Activate',
          onPress: () => {
            setStreakProtected(true);
            Alert.alert('✅ Protected!', 'Your streak is safe for 24 hours!');
          },
        },
      ],
    );
  }, [attendanceData.currentStreak]);

  const handleShare = useCallback(
    async badge => {
      try {
        await Share.share({
          message: `I just earned the "${badge.name}" badge on MarkWise! ${badge.emoji}\nTotal points: ${totalPoints}\nRank: #${attendanceData.rank} in my class!\nJoin me on my academic journey! 🎓`,
          title: 'Achievement Unlocked!',
        });
      } catch (err) {
        console.error('Error sharing:', err);
      }
    },
    [totalPoints, attendanceData.rank],
  );

  const handleViewLeaderboard = useCallback(() => setShowLeaderboard(true), []);
  const handleCloseLeaderboard = useCallback(
    () => setShowLeaderboard(false),
    [],
  );
  const handleBadgeSelect = useCallback(setSelectedBadge, []);
  const handleBadgeClose = useCallback(() => setSelectedBadge(null), []);
  const handleUnlockComplete = useCallback(() => {
    justUnlockedRef.current = null;
    setJustUnlocked(null);
  }, []);

  // ── Memoized Header Component ──────────────────────────────────────────
  const HeaderComponent = useMemo(
    () => (
      <Animated.View
        style={[
          styles.stickyHeader,
          { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
        ]}
      >
        <LinearGradient colors={['#4F46E5', '#6366F1']} style={styles.hero}>
          <View style={styles.heroTopRow}>
            <View style={styles.heroRankPill}>
              <Icon name="trophy" size={14} color="#F59E0B" />
              <Text style={styles.heroRankPillText}>
                #{attendanceData.rank || '?'} of{' '}
                {attendanceData.totalStudents || 0}
              </Text>
            </View>
            <View style={styles.heroStreakBadge}>
              <Icon name="flame" size={14} color="#FF6B6B" />
              <Text style={styles.heroStreakBadgeText}>
                {attendanceData.currentStreak || 0} day streak
              </Text>
            </View>
          </View>
          {(isBackgroundUpdate || lastRefreshed) && (
            <View style={styles.heroBgRow}>
              {isBackgroundUpdate ? (
                <View style={styles.heroBgDot} />
              ) : (
                <Text style={styles.heroRefreshedAt}>
                  Updated{' '}
                  {lastRefreshed.toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Text>
              )}
            </View>
          )}

          <Text style={styles.heroLabel}>TOTAL POINTS</Text>
          <Text style={styles.heroPoints}>{totalPoints.toLocaleString()}</Text>

          <View style={styles.heroStatsRow}>
            <View style={styles.heroStat}>
              <Icon name="ribbon" size={16} color="rgba(255,255,255,0.9)" />
              <Text style={styles.heroStatValue}>
                {unlockedCount}/{BADGES.length}
              </Text>
              <Text style={styles.heroStatLabel}>Badges</Text>
            </View>
            <View style={styles.heroDivider} />
            <View style={styles.heroStat}>
              <Icon
                name="trending-up"
                size={16}
                color="rgba(255,255,255,0.9)"
              />
              <Text style={styles.heroStatValue}>
                {attendanceData.percent}%
              </Text>
              <Text style={styles.heroStatLabel}>Attendance</Text>
            </View>
            <View style={styles.heroDivider} />
            <View style={styles.heroStat}>
              <Icon name="people" size={16} color="rgba(255,255,255,0.9)" />
              <View style={styles.heroRankRow}>
                <Text style={styles.heroStatValue}>
                  {leaderboardData.userRank || '?'}
                </Text>
                {!!weeklyRankChange && (
                  <Text
                    style={[
                      styles.heroRankChange,
                      { color: weeklyRankChange > 0 ? '#34D399' : '#F87171' },
                    ]}
                  >
                    {weeklyRankChange > 0
                      ? `+${weeklyRankChange}`
                      : weeklyRankChange}
                  </Text>
                )}
              </View>
              <Text style={styles.heroStatLabel}>Rank</Text>
            </View>
          </View>

          {nextBadge && (
            <TouchableOpacity
              style={styles.heroChallengeBtn}
              onPress={() => handleBadgeSelect(nextBadge)}
            >
              <LinearGradient
                colors={['rgba(255,255,255,0.1)', 'rgba(255,255,255,0.05)']}
                style={styles.heroChallengeBtnInner}
              >
                <Icon name="flag" size={14} color="#F59E0B" />
                <Text style={styles.heroChallengeBtnText}>
                  Next: {nextBadge.name} ({nextBadge.progress}%)
                </Text>
                <Icon name="chevron-forward" size={14} color="#F59E0B" />
              </LinearGradient>
            </TouchableOpacity>
          )}
        </LinearGradient>
      </Animated.View>
    ),
    [
      fadeAnim,
      slideAnim,
      attendanceData,
      totalPoints,
      unlockedCount,
      leaderboardData.userRank,
      nextBadge,
      handleBadgeSelect,
      isBackgroundUpdate,
      lastRefreshed,
      weeklyRankChange,
    ],
  );

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container}>
      <OfflineBanner />

      {isLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#4F46E5" />
        </View>
      )}

      {error && !isLoading && (
        <View style={styles.errorBanner}>
          <Icon name="alert-circle" size={20} color="#F59E0B" />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={handleRefresh}>
            <Text style={styles.errorRetry}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        style={{ maxWidth: contentMaxWidth, alignSelf: 'center' }}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={handleRefresh}
            colors={['#4F46E5']}
            tintColor="#4F46E5"
          />
        }
      >
        {HeaderComponent}

        <DailyChallengeCard
          challenges={dailyChallenges}
          onComplete={handleChallengeComplete}
          styles={styles}
        />

        <LeaderboardPreview
          userRank={attendanceData.rank}
          topStudents={leaderboardData.topStudents}
          onViewAll={handleViewLeaderboard}
          styles={styles}
        />

        <DepartmentRankCard
          deptRank={attendanceData.deptRank}
          deptTotal={attendanceData.deptTotal}
          weeklyRankChange={weeklyRankChange}
          styles={styles}
        />

        <RivalryCard
          rivalAbove={rivalAbove}
          rivalBelow={rivalBelow}
          myPoints={totalPoints}
          myRank={attendanceData.rank}
          styles={styles}
        />

        <WeeklyQuestCard quests={weeklyQuests} styles={styles} />

        <StreakProtectionCard
          active={streakProtected}
          onActivate={handleStreakProtection}
          currentStreak={attendanceData.currentStreak}
          styles={styles}
        />

        {/* Badge Collection */}
        <View style={styles.badgeSection}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleContainer}>
              <Icon name="grid" size={20} color="#8B5CF6" />
              <Text style={styles.sectionTitle}>Badge Collection</Text>
            </View>
            <Text style={styles.sectionCount}>
              {unlockedCount}/{BADGES.length}
            </Text>
          </View>

          <DropdownPicker
            value={selectedFilter}
            options={BADGE_CATEGORY_OPTIONS}
            onChange={setSelectedFilter}
            placeholder="All Badges"
            accentColor="#8B5CF6"
            style={{ marginBottom: 12 }}
          />

          <View style={styles.badgeGrid}>
            {filteredBadges.map(badge => (
              <TouchableOpacity
                key={badge.id}
                style={[
                  styles.badgeItem,
                  !badge.unlocked &&
                    badge.progress >= 70 &&
                    styles.badgeItemNearUnlock,
                  badge.unlocked && styles.badgeItemUnlocked,
                ]}
                onPress={() => handleBadgeSelect(badge)}
                activeOpacity={0.7}
              >
                <LinearGradient
                  colors={
                    badge.unlocked ? badge.gradient : ['#4B5563', '#374151']
                  }
                  style={[
                    styles.badgeCircle,
                    !badge.unlocked && { opacity: 0.5 },
                  ]}
                >
                  <Text style={styles.badgeEmoji}>{badge.emoji}</Text>
                </LinearGradient>
                <Text style={styles.badgeName} numberOfLines={1}>
                  {badge.name}
                </Text>

                {badge.unlocked ? (
                  <View
                    style={[
                      styles.badgeRarityTag,
                      {
                        backgroundColor: `${
                          getRarityConfig(badge.rarity).color
                        }25`,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.badgeRarityText,
                        { color: getRarityConfig(badge.rarity).color },
                      ]}
                    >
                      {getRarityConfig(badge.rarity).label}
                    </Text>
                  </View>
                ) : (
                  <View style={styles.badgeProgressMini}>
                    <ProgressBar
                      progress={badge.progress}
                      color={badge.progress >= 70 ? '#F59E0B' : '#4F46E5'}
                      height={3}
                    />
                    <Text
                      style={[
                        styles.badgeProgressText,
                        badge.progress >= 70 && {
                          color: '#F59E0B',
                          fontWeight: '700',
                        },
                      ]}
                    >
                      {badge.progress >= 70
                        ? `🔥 ${badge.progress}%`
                        : `${badge.progress}%`}
                    </Text>
                  </View>
                )}

                {!badge.unlocked && (
                  <View style={styles.lockIcon}>
                    <Icon name="lock-closed" size={10} color="#FFF" />
                  </View>
                )}
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Points Breakdown */}
        <TouchableOpacity style={styles.breakdownHeader}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleContainer}>
              <Icon name="bar-chart" size={20} color="#10B981" />
              <Text style={styles.sectionTitle}>Points Breakdown</Text>
            </View>
            <Icon name="chevron-down" size={18} color="#6B7280" />
          </View>
        </TouchableOpacity>

        <View style={styles.breakdownContainer}>
          {pointsBreakdown.map(row => {
            const rule = POINTS_RULES.find(r => r.id === row.rule);
            if (!rule) return null;
            return (
              <View key={row.rule} style={styles.breakdownRow}>
                <View style={styles.breakdownLeft}>
                  <Icon name={rule.icon} size={14} color={rule.color} />
                  <Text style={styles.breakdownLabel}>{rule.label}</Text>
                </View>
                <Text style={styles.breakdownCount}>x{row.count}</Text>
                <Text style={[styles.breakdownPts, { color: rule.color }]}>
                  +{row.pts}
                </Text>
              </View>
            );
          })}
          <View style={styles.breakdownTotal}>
            <Text style={styles.breakdownTotalLabel}>Total Points</Text>
            <Text style={styles.breakdownTotalValue}>
              {totalPoints.toLocaleString()}
            </Text>
          </View>
        </View>

        {/* Rarity Distribution */}
        <View style={styles.raritySection}>
          <Text style={styles.raritySectionTitle}>Rarity Distribution</Text>
          <View style={styles.rarityGrid}>
            {Object.entries(RARITY_CONFIG).map(([key, cfg]) => {
              const total = BADGES.filter(b => b.rarity === key).length;
              const earned = badgeStatus.filter(
                b => b.unlocked && b.rarity === key,
              ).length;
              return (
                <View key={key} style={styles.rarityItem}>
                  <Text style={[styles.rarityItemLabel, { color: cfg.color }]}>
                    {cfg.label}
                  </Text>
                  <Text style={styles.rarityItemCount}>
                    {earned}/{total}
                  </Text>
                  <ProgressBar
                    progress={(earned / total) * 100}
                    color={cfg.color}
                    height={4}
                  />
                </View>
              );
            })}
          </View>
        </View>
        <View style={{ height: 24 }} />
      </ScrollView>

      {/* Badge Modal */}
      <Modal
        visible={!!selectedBadge}
        transparent
        animationType="fade"
        onRequestClose={handleBadgeClose}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            {selectedBadge && (
              <>
                <LinearGradient
                  colors={
                    selectedBadge.unlocked
                      ? selectedBadge.gradient
                      : ['#4B5563', '#374151']
                  }
                  style={styles.modalTop}
                >
                  <Animated.Text
                    style={{
                      fontSize: 56,
                      transform: [{ scale: badgeModalAnim }],
                    }}
                  >
                    {selectedBadge.emoji}
                  </Animated.Text>
                  <TouchableOpacity
                    style={styles.modalClose}
                    onPress={handleBadgeClose}
                  >
                    <Icon name="close" size={22} color="#FFF" />
                  </TouchableOpacity>
                  {selectedBadge.unlocked && (
                    <View style={styles.modalUnlockedBanner}>
                      <Icon name="checkmark-circle" size={13} color="#10B981" />
                      <Text style={styles.modalUnlockedText}>UNLOCKED</Text>
                    </View>
                  )}
                </LinearGradient>
                <View style={styles.modalBody}>
                  <Text style={styles.modalBadgeName}>
                    {selectedBadge.name}
                  </Text>
                  <View
                    style={[
                      styles.badgeRarityTag,
                      {
                        backgroundColor: `${
                          getRarityConfig(selectedBadge.rarity).color
                        }25`,
                        alignSelf: 'center',
                        marginBottom: 12,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.badgeRarityText,
                        { color: getRarityConfig(selectedBadge.rarity).color },
                      ]}
                    >
                      {getRarityConfig(selectedBadge.rarity).label}
                    </Text>
                  </View>
                  <View style={styles.modalStatRow}>
                    <View style={styles.modalStatItem}>
                      <Text style={styles.modalStatLabel}>Status</Text>
                      <Text
                        style={[
                          styles.modalStatValue,
                          {
                            color: selectedBadge.unlocked
                              ? '#10B981'
                              : '#EF4444',
                          },
                        ]}
                      >
                        {selectedBadge.unlocked ? 'Unlocked' : 'Locked'}
                      </Text>
                    </View>
                    <View style={styles.modalStatItem}>
                      <Text style={styles.modalStatLabel}>Points</Text>
                      <Text style={styles.modalStatValue}>
                        +{selectedBadge.points}
                      </Text>
                    </View>
                    <View style={styles.modalStatItem}>
                      <Text style={styles.modalStatLabel}>Progress</Text>
                      <Text style={styles.modalStatValue}>
                        {selectedBadge.current}/{selectedBadge.needed}
                      </Text>
                    </View>
                  </View>
                  {!selectedBadge.unlocked && (
                    <View style={{ marginVertical: 12 }}>
                      <ProgressBar
                        progress={selectedBadge.progress}
                        color="#4F46E5"
                        height={8}
                      />
                      <Text style={styles.modalProgressLabel}>
                        {selectedBadge.progress}% complete
                      </Text>
                    </View>
                  )}
                  <Text style={styles.modalReqTitle}>Requirement</Text>
                  <Text style={styles.modalReqText}>
                    {selectedBadge.description ||
                      `Reach ${selectedBadge.needed}x "${
                        POINTS_RULES.find(r => r.id === selectedBadge.threshold)
                          ?.label || selectedBadge.threshold
                      }"`}
                  </Text>
                  {selectedBadge.unlocked && (
                    <TouchableOpacity
                      style={styles.modalShareBtn}
                      onPress={() => handleShare(selectedBadge)}
                    >
                      <LinearGradient
                        colors={['#4F46E5', '#6366F1']}
                        style={styles.modalShareGradient}
                      >
                        <Icon name="share-social" size={18} color="#FFF" />
                        <Text style={styles.modalShareText}>
                          Share Achievement
                        </Text>
                      </LinearGradient>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={styles.modalDismiss}
                    onPress={handleBadgeClose}
                  >
                    <Text style={styles.modalDismissText}>Close</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      <UnlockAnimation
        visible={!!justUnlocked}
        badge={justUnlocked}
        onComplete={handleUnlockComplete}
        styles={styles}
      />

      <Modal
        visible={showLeaderboard}
        transparent
        animationType="slide"
        onRequestClose={handleCloseLeaderboard}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { maxHeight: '80%' }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalHeaderTitle}>Class Leaderboard</Text>
              <TouchableOpacity onPress={handleCloseLeaderboard}>
                <Icon name="close" size={24} color="#111827" />
              </TouchableOpacity>
            </View>
            <ScrollView>
              {leaderboardData.topStudents.map((student, index) => (
                <View
                  key={student.id || index}
                  style={[
                    styles.leaderboardRow,
                    attendanceData.rank === index + 1 && styles.currentUserRow,
                  ]}
                >
                  <Text style={styles.leaderboardRank}>#{index + 1}</Text>
                  <View style={styles.leaderboardAvatar}>
                    <Text style={styles.leaderboardAvatarText}>
                      {student.avatar}
                    </Text>
                  </View>
                  <Text style={styles.leaderboardName}>{student.name}</Text>
                  <Text style={styles.leaderboardPoints}>
                    {student.points} pts
                  </Text>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────
const makeStyles = C =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: C.background.primary },
    content: { paddingBottom: 24 },
    loadingOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 10,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(11,17,32,0.6)',
    },
    errorBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: C.danger.soft,
      margin: 16,
      padding: 12,
      borderRadius: 8,
      gap: 8,
    },
    errorText: { flex: 1, fontSize: 12, color: C.danger.main },
    errorRetry: { fontSize: 12, fontWeight: '600', color: C.primary.main },
    stickyHeader: {
      backgroundColor: C.background.primary,
      paddingHorizontal: 12,
      paddingTop: 4,
      paddingBottom: 4,
    },
    heroBgRow: { alignItems: 'flex-start', marginTop: 4, marginBottom: -4 },
    heroBgDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: 'rgba(255,255,255,0.6)',
    },
    heroRefreshedAt: { fontSize: 11, color: 'rgba(255,255,255,0.7)' },
    hero: {
      borderRadius: 14,
      padding: 10,
      alignItems: 'center',
      marginBottom: 2,
    },
    heroTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      width: '100%',
      marginBottom: 4,
    },
    heroRankPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      backgroundColor: 'rgba(245,158,11,0.2)',
      borderRadius: 20,
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderWidth: 1,
      borderColor: 'rgba(245,158,11,0.4)',
    },
    heroRankPillText: { fontSize: 9, fontWeight: '700', color: C.warning.main },
    heroStreakBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      backgroundColor: 'rgba(239,68,68,0.2)',
      borderRadius: 20,
      paddingHorizontal: 7,
      paddingVertical: 2,
    },
    heroStreakBadgeText: { fontSize: 9, fontWeight: '700', color: '#FF6B6B' },
    heroLabel: {
      fontSize: 9,
      fontWeight: '600',
      color: 'rgba(255,255,255,0.7)',
      letterSpacing: 0.8,
    },
    heroPoints: {
      fontSize: 24,
      fontWeight: '800',
      color: '#FFF',
      marginVertical: 1,
    },
    heroStatsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 6,
      gap: 12,
    },
    heroStat: { alignItems: 'center', gap: 1 },
    heroStatValue: { fontSize: 12, fontWeight: '700', color: '#FFF' },
    heroStatLabel: { fontSize: 9, color: 'rgba(255,255,255,0.7)' },
    heroDivider: {
      width: 1,
      height: 18,
      backgroundColor: 'rgba(255,255,255,0.2)',
    },
    heroChallengeBtn: {
      marginTop: 7,
      borderRadius: 8,
      overflow: 'hidden',
      width: '100%',
    },
    heroChallengeBtnInner: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 10,
      paddingVertical: 5,
      gap: 5,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: 'rgba(245,158,11,0.35)',
    },
    heroChallengeBtnText: {
      fontSize: 10,
      fontWeight: '600',
      color: C.warning.main,
      flex: 1,
      textAlign: 'center',
    },

    // Card styles
    dailyCard: {
      marginHorizontal: 16,
      marginBottom: 16,
      borderRadius: 16,
      overflow: 'hidden',
    },
    dailyGradient: { padding: 16 },
    dailyHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 12,
    },
    dailyTitleContainer: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    dailyTitle: { fontSize: 16, fontWeight: '700', color: C.text.primary },
    dailyTimer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: C.surface.tertiary,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 12,
    },
    dailyTimerText: { fontSize: 10, color: C.text.tertiary },
    dailyChallengeItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 12,
    },
    dailyChallengeLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      flex: 1,
    },
    dailyChallengeIcon: {
      width: 36,
      height: 36,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dailyChallengeInfo: { flex: 1 },
    dailyChallengeTitle: {
      fontSize: 13,
      fontWeight: '600',
      color: C.text.primary,
    },
    dailyChallengeDesc: { fontSize: 10, color: C.text.tertiary },
    dailyChallengeRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    dailyChallengePoints: { fontSize: 14, fontWeight: '700' },
    dailyChallengeBtn: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 12,
    },
    dailyChallengeBtnText: { color: '#FFF', fontSize: 11, fontWeight: '600' },

    leaderboardCard: {
      backgroundColor: C.surface.primary,
      marginHorizontal: 16,
      marginBottom: 16,
      borderRadius: 16,
      padding: 16,
      borderWidth: 1,
      borderColor: C.border.light,
    },
    leaderboardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 16,
    },
    leaderboardTitleContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    leaderboardTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: C.text.primary,
    },
    leaderboardViewAll: {
      fontSize: 12,
      color: C.primary.main,
      fontWeight: '600',
    },
    leaderboardPodium: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      marginBottom: 20,
    },
    podiumItem: { alignItems: 'center', gap: 6 },
    podiumFirst: { transform: [{ scale: 1.1 }] },
    podiumBadge: {
      width: 30,
      height: 30,
      borderRadius: 15,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 4,
    },
    podiumRank: { fontSize: 12, fontWeight: '800', color: '#FFF' },
    podiumAvatar: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: C.surface.tertiary,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: C.primary.main,
    },
    podiumAvatarText: {
      fontSize: 20,
      fontWeight: '600',
      color: C.text.primary,
    },
    podiumName: {
      fontSize: 12,
      fontWeight: '600',
      color: C.text.primary,
      maxWidth: 80,
    },
    podiumPoints: { fontSize: 11, color: C.success.main, fontWeight: '600' },
    userRankContainer: {
      flexDirection: 'row',
      backgroundColor: C.surface.secondary,
      borderRadius: 12,
      padding: 12,
    },
    userRankLeft: { flex: 1, alignItems: 'center' },
    userRankLabel: { fontSize: 10, color: C.text.tertiary },
    userRankValue: { fontSize: 20, fontWeight: '800', color: C.primary.main },
    userRankDivider: { width: 1, backgroundColor: C.border.medium },
    userRankRight: { flex: 1, alignItems: 'center' },
    userRankNext: { fontSize: 13, fontWeight: '600', color: C.text.primary },
    userRankGap: { fontSize: 10, color: C.warning.main },

    questCard: {
      marginHorizontal: 16,
      marginBottom: 16,
      borderRadius: 16,
      overflow: 'hidden',
    },
    questGradient: { padding: 16 },
    questHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 16,
    },
    questTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: C.text.primary,
      flex: 1,
    },
    questTimer: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    questTimerText: { fontSize: 11, color: C.text.tertiary },
    questItem: { marginBottom: 16 },
    questInfo: { marginBottom: 8 },
    questName: { fontSize: 14, fontWeight: '600', color: C.text.primary },
    questDesc: { fontSize: 11, color: C.text.tertiary },
    questProgress: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    questProgressText: { fontSize: 11, color: C.text.secondary, width: 40 },
    questProgressBar: {
      flex: 1,
      height: 4,
      backgroundColor: C.surface.tertiary,
      borderRadius: 2,
    },
    questProgressFill: {
      height: '100%',
      backgroundColor: C.purple.main,
      borderRadius: 2,
    },
    questPoints: {
      fontSize: 13,
      fontWeight: '700',
      color: C.success.main,
      marginTop: 4,
      textAlign: 'right',
    },

    protectionCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: C.surface.primary,
      marginHorizontal: 16,
      marginBottom: 16,
      padding: 16,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: C.border.light,
      gap: 12,
    },
    protectionCardActive: {
      borderColor: C.success.main,
      backgroundColor: C.success.soft,
    },
    protectionInfo: { flex: 1 },
    protectionTitle: { fontSize: 14, fontWeight: '600', color: C.text.primary },
    protectionDesc: { fontSize: 11, color: C.text.tertiary },
    protectionCost: { flexDirection: 'row', alignItems: 'center', gap: 2 },
    protectionCostText: {
      fontSize: 14,
      fontWeight: '700',
      color: C.warning.main,
    },

    badgeSection: { paddingHorizontal: 16, marginBottom: 16 },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 12,
    },
    sectionTitleContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    sectionTitle: { fontSize: 16, fontWeight: '700', color: C.text.primary },
    sectionCount: { fontSize: 14, color: C.text.secondary, fontWeight: '600' },

    badgeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    badgeItem: {
      width: (width - 32 - 20) / 3,
      alignItems: 'center',
      padding: 10,
      borderRadius: 14,
      backgroundColor: C.surface.secondary,
      borderWidth: 1,
      borderColor: C.border.light,
      position: 'relative',
    },
    badgeCircle: {
      width: 48,
      height: 48,
      borderRadius: 24,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 6,
    },
    badgeEmoji: { fontSize: 22 },
    badgeName: {
      fontSize: 11,
      fontWeight: '600',
      color: C.text.primary,
      textAlign: 'center',
      marginBottom: 4,
    },
    badgeRarityTag: {
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 8,
      alignSelf: 'center',
    },
    badgeRarityText: { fontSize: 9, fontWeight: '700' },
    badgeProgressMini: { width: '100%', gap: 2 },
    badgeProgressText: {
      fontSize: 9,
      color: C.text.tertiary,
      textAlign: 'center',
    },
    lockIcon: {
      position: 'absolute',
      top: 4,
      right: 4,
      backgroundColor: 'rgba(0,0,0,0.5)',
      borderRadius: 8,
      padding: 2,
    },
    badgeItemNearUnlock: {
      borderColor: C.warning.main,
      borderWidth: 1.5,
      shadowColor: C.warning.main,
      shadowRadius: 6,
      shadowOpacity: 0.45,
      elevation: 5,
    },
    badgeItemUnlocked: { borderColor: C.success.main + '60' },

    breakdownHeader: { paddingHorizontal: 16, marginBottom: 8 },
    breakdownContainer: {
      backgroundColor: C.surface.primary,
      marginHorizontal: 16,
      marginBottom: 16,
      padding: 16,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: C.border.light,
    },
    breakdownRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 8,
      gap: 8,
    },
    breakdownLeft: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    breakdownLabel: { fontSize: 12, color: C.text.secondary },
    breakdownCount: {
      fontSize: 12,
      color: C.text.tertiary,
      width: 32,
      textAlign: 'center',
    },
    breakdownPts: {
      fontSize: 13,
      fontWeight: '700',
      width: 50,
      textAlign: 'right',
    },
    breakdownTotal: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      borderTopWidth: 1,
      borderTopColor: C.border.medium,
      marginTop: 8,
      paddingTop: 10,
    },
    breakdownTotalLabel: {
      fontSize: 14,
      fontWeight: '700',
      color: C.text.primary,
    },
    breakdownTotalValue: {
      fontSize: 14,
      fontWeight: '800',
      color: C.success.main,
    },

    raritySection: { paddingHorizontal: 16, marginBottom: 16 },
    raritySectionTitle: {
      fontSize: 14,
      fontWeight: '600',
      color: C.text.secondary,
      marginBottom: 12,
    },
    rarityGrid: { gap: 12 },
    rarityItem: { gap: 4 },
    rarityItemLabel: { fontSize: 12, fontWeight: '600' },
    rarityItemCount: { fontSize: 11, color: C.text.tertiary },

    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.7)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 24,
    },
    modalCard: {
      width: '100%',
      maxWidth: 380,
      backgroundColor: C.surface.primary,
      borderRadius: 24,
      overflow: 'hidden',
    },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: 16,
      borderBottomWidth: 1,
      borderBottomColor: C.border.light,
    },
    modalHeaderTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: C.text.primary,
    },
    modalTop: { padding: 28, alignItems: 'center', position: 'relative' },
    modalClose: {
      position: 'absolute',
      top: 14,
      right: 14,
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: 'rgba(0,0,0,0.3)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    modalBody: { padding: 20 },
    modalBadgeName: {
      fontSize: 20,
      fontWeight: '700',
      color: C.text.primary,
      textAlign: 'center',
      marginBottom: 6,
    },
    modalStatRow: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 20,
      marginBottom: 8,
    },
    modalStatItem: { alignItems: 'center' },
    modalStatLabel: { fontSize: 10, color: C.text.tertiary, marginBottom: 2 },
    modalStatValue: { fontSize: 15, fontWeight: '700', color: C.text.primary },
    modalProgressLabel: {
      fontSize: 11,
      color: C.text.tertiary,
      textAlign: 'center',
      marginTop: 4,
    },
    modalReqTitle: {
      fontSize: 13,
      fontWeight: '600',
      color: C.text.primary,
      marginTop: 10,
      marginBottom: 4,
    },
    modalReqText: {
      fontSize: 12,
      color: C.text.secondary,
      lineHeight: 18,
      marginBottom: 16,
    },
    modalShareBtn: { borderRadius: 12, overflow: 'hidden', marginBottom: 8 },
    modalShareGradient: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 12,
      gap: 8,
    },
    modalShareText: { fontSize: 14, fontWeight: '600', color: '#FFF' },
    modalDismiss: { paddingVertical: 10, alignItems: 'center' },
    modalDismissText: { fontSize: 13, color: C.text.tertiary },
    modalUnlockedBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: 'rgba(16,185,129,0.2)',
      borderRadius: 12,
      paddingHorizontal: 10,
      paddingVertical: 4,
      marginTop: 8,
      borderWidth: 1,
      borderColor: 'rgba(16,185,129,0.4)',
    },
    modalUnlockedText: {
      fontSize: 10,
      fontWeight: '800',
      color: C.success.main,
      letterSpacing: 0.8,
    },

    leaderboardRow: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 12,
      borderBottomWidth: 1,
      borderBottomColor: C.border.light,
    },
    currentUserRow: { backgroundColor: C.primary.soft },
    leaderboardRank: {
      width: 40,
      fontSize: 14,
      fontWeight: '600',
      color: C.text.secondary,
    },
    leaderboardAvatar: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: C.surface.tertiary,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 12,
    },
    leaderboardAvatarText: {
      fontSize: 14,
      fontWeight: '600',
      color: C.text.primary,
    },
    leaderboardName: {
      flex: 1,
      fontSize: 14,
      fontWeight: '500',
      color: C.text.primary,
    },
    leaderboardPoints: {
      fontSize: 14,
      fontWeight: '700',
      color: C.success.main,
    },

    unlockOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.8)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    unlockContainer: {
      alignItems: 'center',
      backgroundColor: C.surface.primary,
      borderRadius: 32,
      padding: 24,
      borderWidth: 2,
      borderColor: C.premium.gold,
    },
    unlockBadge: {
      width: 100,
      height: 100,
      borderRadius: 50,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 16,
    },
    unlockEmoji: { fontSize: 48 },
    unlockTitle: { fontSize: 18, fontWeight: '600', color: C.text.secondary },
    unlockName: {
      fontSize: 24,
      fontWeight: '800',
      color: C.text.primary,
      marginBottom: 8,
    },
    unlockPoints: {
      fontSize: 20,
      fontWeight: '700',
      color: C.success.main,
      marginBottom: 12,
    },
    unlockRarity: {
      paddingHorizontal: 12,
      paddingVertical: 4,
      borderRadius: 16,
      backgroundColor: 'rgba(0,0,0,0.3)',
    },
    unlockRarityText: { fontSize: 12, fontWeight: '700' },

    // Hero rank row
    heroRankRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    heroRankChange: { fontSize: 10, fontWeight: '700' },

    // Department Rank Card
    deptRankCard: {
      marginHorizontal: 16,
      marginBottom: 16,
      borderRadius: 16,
      overflow: 'hidden',
    },
    deptRankGradient: { padding: 16 },
    deptRankHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 14,
    },
    deptRankTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: C.text.primary,
      flex: 1,
    },
    weekChangePill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      borderRadius: 20,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    weekChangeText: { fontSize: 10, fontWeight: '700' },
    deptRankBody: { flexDirection: 'row', alignItems: 'center', gap: 16 },
    deptRankBigBadge: {
      borderRadius: 14,
      paddingVertical: 14,
      paddingHorizontal: 16,
      alignItems: 'center',
      minWidth: 80,
    },
    deptRankBigNum: { fontSize: 28, fontWeight: '900', color: '#FFF' },
    deptRankBigSub: {
      fontSize: 11,
      color: 'rgba(255,255,255,0.85)',
      marginTop: 2,
    },
    deptRankRight: { flex: 1 },
    deptPercentileValue: { fontSize: 20, fontWeight: '800', marginBottom: 2 },
    deptPercentileLabel: {
      fontSize: 11,
      color: C.text.tertiary,
      marginBottom: 6,
    },
    deptPercentileBar: {
      height: 6,
      backgroundColor: C.border.medium,
      borderRadius: 3,
      overflow: 'hidden',
      marginBottom: 6,
    },
    deptPercentileFill: { height: 6, borderRadius: 3 },
    deptRankMotivation: { fontSize: 12, fontWeight: '600' },
    deptRankNoData: {
      fontSize: 12,
      color: C.text.tertiary,
      textAlign: 'center',
      paddingVertical: 8,
    },

    // Rivalry Card
    rivalryCard: {
      backgroundColor: C.surface.primary,
      marginHorizontal: 16,
      marginBottom: 16,
      borderRadius: 16,
      padding: 16,
      borderWidth: 1,
      borderColor: C.border.light,
    },
    rivalryHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 14,
    },
    rivalryTitle: { fontSize: 15, fontWeight: '700', color: C.text.primary },
    rivalrySubtitle: {
      fontSize: 11,
      color: C.text.tertiary,
      marginLeft: 'auto',
    },
    rivalRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 4,
    },
    rivalAvatar: {
      width: 42,
      height: 42,
      borderRadius: 21,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rivalAvatarText: { fontSize: 18, fontWeight: '700' },
    rivalInfo: { flex: 1 },
    rivalNameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 2,
    },
    rivalName: {
      fontSize: 14,
      fontWeight: '600',
      color: C.text.primary,
      flex: 1,
    },
    rivalRankPill: {
      borderRadius: 20,
      paddingHorizontal: 7,
      paddingVertical: 2,
    },
    rivalRankText: { fontSize: 10, fontWeight: '700' },
    rivalMeta: { fontSize: 11, color: C.text.tertiary },
    rivalDivider: {
      height: 1,
      backgroundColor: C.border.light,
      marginVertical: 10,
    },
  });
