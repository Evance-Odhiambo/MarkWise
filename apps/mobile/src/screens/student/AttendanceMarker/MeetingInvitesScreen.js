// MeetingInvitesScreen.js — Students see upcoming meeting invites sent by their lecturers
import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  Alert,
  Share,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Clipboard from '@react-native-clipboard/clipboard';
import { fetchStudentMeetingInvites, detectPlatform, buildJoinUrl } from '../../../utils/meetingInviteApi';
import { getStudentSession } from '../../../utils/authSession';
import useResponsive from '../../../hooks/useResponsive';
import { useEnrollment } from '../../../context/EnrollmentContext';
import themeColors from '../../../theme/colors';

const colors = {
  ...themeColors,
  bg: { screen: themeColors.background.primary, card: themeColors.surface.card },
};



/**
 * Returns a human-readable "time until" label for a scheduled meeting.
 * E.g. "Starts in 12 min", "Starts in 2h 30m", "Started 5 min ago", "Tomorrow at 2:00 PM"
 */
function buildTimeLabel(scheduledAt) {
  if (!scheduledAt) return 'Time not set';
  const d = new Date(scheduledAt);
  if (Number.isNaN(d.getTime())) return 'Time not set';

  const now = new Date();
  const diffMs = d - now;
  const diffMin = Math.round(diffMs / 60000);
  const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (diffMin <= 0 && diffMin > -120) {
    const ago = Math.abs(diffMin);
    return ago === 0 ? 'Starting now' : `Started ${ago} min ago`;
  }
  if (diffMin > 0 && diffMin < 60) return `Starts in ${diffMin} min`;
  if (diffMin >= 60 && diffMin < 24 * 60) {
    const h = Math.floor(diffMin / 60);
    const m = diffMin % 60;
    return `Starts in ${h}h${m > 0 ? ` ${m}m` : ''}`;
  }

  // More than a day away — show date + time
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isToday = d.toDateString() === now.toDateString();
  const isTomorrow = d.toDateString() === tomorrow.toDateString();
  if (isToday) return `Today at ${timeStr}`;
  if (isTomorrow) return `Tomorrow at ${timeStr}`;
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) + ` at ${timeStr}`;
}

/**
 * Urgency level for colour-coding
 * 'now'    — started or starting within 5 min
 * 'soon'   — within 30 min
 * 'later'  — more than 30 min away
 * 'past'   — more than 2 hours ago
 */
function urgency(scheduledAt) {
  const diffMin = Math.round((new Date(scheduledAt) - Date.now()) / 60000);
  if (diffMin < -120) return 'past';
  if (diffMin <= 5)   return 'now';
  if (diffMin <= 30)  return 'soon';
  return 'later';
}

const URGENCY_CONFIG = {
  now:   { color: colors.success.main,  bg: colors.success.soft,  icon: 'circle',          label: 'Live',        gradient: colors.success.gradient },
  soon:  { color: colors.warning.main,  bg: colors.warning.soft,  icon: 'clock-fast',       label: 'Soon',        gradient: ['#F59E0B', '#D97706'] },
  later: { color: colors.primary.main,  bg: colors.primary.soft,  icon: 'clock-outline',    label: 'Upcoming',    gradient: colors.primary.gradient },
  past:  { color: colors.text.muted,    bg: '#F1F5F9',            icon: 'clock-check-outline', label: 'Ended',    gradient: ['#94A3B8', '#64748B'] },
};

function InviteCard({ invite, onCopyLink, onShare, onJoin, copiedId }) {
  const platform = detectPlatform(invite.meetingLink || '');
  const u = urgency(invite.scheduledAt);
  const uc = URGENCY_CONFIG[u];
  const timeLabel = buildTimeLabel(invite.scheduledAt);
  const isPast = u === 'past';

  return (
    <View style={[styles.card, isPast && styles.cardPast]}>
      {/* Coloured left ribbon */}
      <View style={[styles.cardRibbon, { backgroundColor: uc.color }]} />

      <View style={styles.cardInner}>
        {/* Top row: unit + status badge */}
        <View style={styles.cardTopRow}>
          <View style={styles.unitBadge}>
            <Icon name="school" size={12} color={colors.primary.main} />
            <Text style={styles.unitBadgeText} numberOfLines={1}>{invite.unitCode}</Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: uc.bg }]}>
            <Icon name={uc.icon} size={11} color={uc.color} />
            <Text style={[styles.statusBadgeText, { color: uc.color }]}>{uc.label}</Text>
          </View>
        </View>

        {/* Unit name — always shown when available */}
        {!!invite.unitName && (
          <Text style={styles.unitName} numberOfLines={1}>{invite.unitName}</Text>
        )}

        {/* Platform + relative time */}
        <View style={styles.metaRow}>
          <View style={[styles.platformChip, { backgroundColor: `${platform.color}18` }]}>
            <Icon name={platform.icon} size={13} color={platform.color} />
            <Text style={[styles.platformName, { color: platform.color }]}>{platform.name}</Text>
          </View>
          <View style={styles.timePill}>
            <Icon name="clock-outline" size={12} color={colors.text.muted} />
            <Text style={styles.timeText}>{timeLabel}</Text>
          </View>
        </View>

        {/* Full date + time so the student always knows the exact slot */}
        {!!invite.scheduledAt && !Number.isNaN(new Date(invite.scheduledAt).getTime()) && (
          <View style={styles.fullDateRow}>
            <Icon name="calendar-month-outline" size={13} color={colors.primary.main} />
            <Text style={styles.fullDateText}>
              {new Date(invite.scheduledAt).toLocaleString([], {
                weekday: 'short',
                day:     'numeric',
                month:   'short',
                year:    'numeric',
                hour:    '2-digit',
                minute:  '2-digit',
              })}
            </Text>
          </View>
        )}

        {/* Lecturer */}
        {!!invite.lecturerName && (
          <View style={styles.lecturerRow}>
            <Icon name="account-tie" size={13} color={colors.text.muted} />
            <Text style={styles.lecturerText} numberOfLines={1}>{invite.lecturerName}</Text>
          </View>
        )}

        {/* Optional message from lecturer */}
        {!!invite.message && (
          <View style={styles.messageBox}>
            <Icon name="message-text-outline" size={13} color={colors.info.main} />
            <Text style={styles.messageText} numberOfLines={3}>{invite.message}</Text>
          </View>
        )}

        {/* Passcode row */}
        {!!invite.passcode && (
          <View style={styles.passcodeRow}>
            <Icon name="lock-outline" size={13} color={colors.warning.main} />
            <Text style={styles.passcodeLabel}>Passcode: </Text>
            <Text style={styles.passcodeValue} selectable>{invite.passcode}</Text>
          </View>
        )}

        {/* Action buttons */}
        {!isPast && (
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={styles.copyBtn}
              onPress={() => onCopyLink(invite)}
              activeOpacity={0.75}
            >
              <Icon
                name={copiedId === invite.id ? 'check-circle' : 'content-copy'}
                size={16}
                color={copiedId === invite.id ? colors.success.main : colors.primary.main}
              />
              <Text style={[styles.copyBtnText, copiedId === invite.id && { color: colors.success.main }]}>
                {copiedId === invite.id ? 'Copied!' : 'Copy Link'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.shareBtn}
              onPress={() => onShare(invite)}
              activeOpacity={0.75}
            >
              <Icon name="share-variant" size={16} color={colors.primary.main} />
              <Text style={styles.shareBtnText}>Share</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.joinBtn}
              onPress={() => onJoin(invite)}
              activeOpacity={0.85}
              disabled={!invite.meetingLink}
            >
              <LinearGradient
                colors={u === 'now' ? colors.success.gradient : colors.primary.gradient}
                style={styles.joinBtnGradient}
              >
                <Icon name="video" size={15} color="#fff" />
                <Text style={styles.joinBtnText}>{u === 'now' ? 'Join Now' : 'Join'}</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

export default function MeetingInvitesScreen() {
  const navigation = useNavigation();
  const { isTablet, contentMaxWidth } = useResponsive();
  const { enrolledUnits, isHydrated } = useEnrollment();

  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [autoJoinMsg, setAutoJoinMsg] = useState('');

  const loadInvites = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const data = await fetchStudentMeetingInvites(enrolledUnits);
      // Sort: now/soon first, then upcoming, then past
      const sorted = [...data].sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
      setInvites(sorted);
    } catch (err) {
      setError(err.message || 'Could not load meeting invites.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [enrolledUnits]);

  useFocusEffect(useCallback(() => {
    loadInvites();
  }, [loadInvites]));

  // Re-fetch silently once enrollment context finishes hydrating from SQLite,
  // in case the screen focused before enrolledUnits was populated (race condition
  // on first launch where useFocusEffect fires with enrolledUnits = []).
  useEffect(() => {
    if (isHydrated && enrolledUnits.length > 0) {
      loadInvites(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHydrated, enrolledUnits.join(',')]);  // join produces a stable string dep

  const handleRefresh = () => {
    setRefreshing(true);
    loadInvites(true);
  };

  const handleCopyLink = (invite) => {
    const text = invite.passcode
      ? `${invite.meetingLink}\nPasscode: ${invite.passcode}`
      : invite.meetingLink;
    Clipboard.setString(text);
    setCopiedId(invite.id);
    setTimeout(() => setCopiedId(null), 2500);
  };

  const handleShare = async (invite) => {
    const platform = detectPlatform(invite.meetingLink || '');
    const passcodeLine = invite.passcode ? `\nPasscode: ${invite.passcode}` : '';
    const messageLine = invite.message ? `\n\n${invite.message}` : '';
    try {
      await Share.share({
        message: `${invite.lecturerName || 'Your lecturer'} invited you to ${invite.unitCode} on ${platform.name}.\n\nJoin: ${invite.meetingLink}${passcodeLine}${messageLine}`,
        url: invite.meetingLink,
        title: `${invite.unitCode} — ${platform.name}`,
      });
    } catch (err) {
      console.warn('[MeetingInvites] Share error:', err.message);
    }
  };

  const handleJoin = async (invite) => {
    if (!invite.meetingLink) return;

    // Get student name to pre-fill in the meeting platform
    let displayName = '';
    try {
      const stuSession = await getStudentSession();
      displayName = stuSession?.studentName || stuSession?.admissionNumber || '';
    } catch (_) { /* non-critical */ }

    // Build the best URL — embeds passcode for Zoom + name where platform supports it
    const joinUrl = buildJoinUrl(invite.meetingLink, invite.passcode, displayName);

    // Determine what was auto-filled to show in the toast
    const platform  = detectPlatform(invite.meetingLink);
    const hasName   = displayName && ['Zoom', 'Jitsi', 'Whereby', 'MiroTalk'].includes(platform.name);
    const needsPaste = invite.passcode && !['Zoom'].includes(platform.name);

    if (needsPaste) {
      Clipboard.setString(invite.passcode);
    }

    if (hasName && needsPaste) {
      setAutoJoinMsg(`Name pre-filled · Passcode copied`);
    } else if (hasName) {
      setAutoJoinMsg(`Joining as ${displayName}`);
    } else if (needsPaste) {
      setAutoJoinMsg('Passcode copied — paste when prompted');
    }

    if (autoJoinMsg || hasName || needsPaste) {
      setTimeout(() => setAutoJoinMsg(''), 4000);
    }

    Linking.canOpenURL(joinUrl)
      .then((supported) => {
        if (supported) {
          Linking.openURL(joinUrl);
        } else {
          Alert.alert(
            'Cannot open link',
            `Please copy the link and open it in your browser:\n\n${joinUrl}`,
            [
              { text: 'Copy', onPress: () => handleCopyLink(invite) },
              { text: 'OK', style: 'cancel' },
            ],
          );
        }
      })
      .catch(() => Linking.openURL(joinUrl));
  };

  const liveInvites    = invites.filter(i => urgency(i.scheduledAt) === 'now');
  const upcomingInvites = invites.filter(i => ['soon', 'later'].includes(urgency(i.scheduledAt)));
  const pastInvites    = invites.filter(i => urgency(i.scheduledAt) === 'past');

  const sections = [
    ...(liveInvites.length    ? [{ key: 'live',     label: 'Live Now',  icon: 'circle',       color: colors.success.main, data: liveInvites }]    : []),
    ...(upcomingInvites.length ? [{ key: 'upcoming', label: 'Upcoming', icon: 'clock-outline', color: colors.primary.main, data: upcomingInvites }] : []),
    ...(pastInvites.length     ? [{ key: 'past',     label: 'Past',     icon: 'history',       color: colors.text.muted,   data: pastInvites }]     : []),
  ];

  const flatData = sections.flatMap(s => [
    { _type: 'header', ...s },
    ...s.data.map(invite => ({ _type: 'invite', ...invite })),
  ]);

  const renderItem = ({ item }) => {
    if (item._type === 'header') {
      return (
        <View style={styles.sectionHeader}>
          <Icon name={item.icon} size={14} color={item.color} />
          <Text style={[styles.sectionHeaderText, { color: item.color }]}>{item.label}</Text>
          <View style={[styles.sectionHeaderLine, { backgroundColor: item.color + '30' }]} />
        </View>
      );
    }
    return (
      <InviteCard
        invite={item}
        onCopyLink={handleCopyLink}
        onShare={handleShare}
        onJoin={handleJoin}
        copiedId={copiedId}
      />
    );
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      {/* Header */}
      <LinearGradient colors={colors.primary.gradient} style={styles.headerGradient}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Icon name="arrow-left" size={22} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Meeting Invites</Text>
          <Text style={styles.headerSubtitle}>Sent by your lecturers</Text>
        </View>
        <TouchableOpacity onPress={handleRefresh} style={styles.backBtn} disabled={refreshing}>
          <Icon name="refresh" size={22} color="#fff" style={refreshing ? styles.spinning : null} />
        </TouchableOpacity>
      </LinearGradient>

      {/* Body */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary.main} />
          <Text style={styles.loadingText}>Loading invites…</Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Icon name="wifi-off" size={48} color={colors.text.muted} />
          <Text style={styles.errorTitle}>Could not load invites</Text>
          <Text style={styles.errorMsg}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => loadInvites()}>
            <Text style={styles.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : invites.length === 0 ? (
        <View style={styles.center}>
          <LinearGradient colors={[colors.primary.soft, 'transparent']} style={styles.emptyIconWrap}>
            <Icon name="video-off-outline" size={48} color={colors.primary.main} />
          </LinearGradient>
          <Text style={styles.emptyTitle}>No Invites Yet</Text>
          <Text style={styles.emptyDesc}>
            When your lecturers share a meeting link, it will appear here before class.
          </Text>
        </View>
      ) : (
        <FlatList
          data={flatData}
          keyExtractor={(item, idx) => item._type === 'header' ? `hdr-${item.key}` : String(item.id ?? idx)}
          renderItem={renderItem}
          contentContainerStyle={[
            styles.listContent,
            isTablet && { alignSelf: 'center', width: '100%', maxWidth: contentMaxWidth },
          ]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              colors={[colors.primary.main]}
              tintColor={colors.primary.main}
            />
          }
        />
      )}

      {/* Passcode auto-copied toast */}
      {!!autoJoinMsg && (
        <View style={styles.toast} pointerEvents="none">
          <Icon name="content-paste" size={16} color="#fff" />
          <Text style={styles.toastText}>{autoJoinMsg}</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg.screen,
  },

  // Header
  headerGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 14,
    gap: 4,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
  },
  headerSubtitle: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.75)',
    marginTop: 1,
  },

  // List
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 40,
  },

  // Section header
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
    marginTop: 4,
  },
  sectionHeaderText: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  sectionHeaderLine: {
    flex: 1,
    height: 1,
  },

  // Card
  card: {
    backgroundColor: colors.bg.card,
    borderRadius: 18,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border.light,
    flexDirection: 'row',
    overflow: 'hidden',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
  },
  cardPast: {
    opacity: 0.65,
  },
  cardRibbon: {
    width: 4,
  },
  cardInner: {
    flex: 1,
    padding: 14,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  unitBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary.soft,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  unitBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary.main,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  unitName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text.primary,
    marginBottom: 8,
    marginTop: 2,
  },

  // Meta row
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
    flexWrap: 'wrap',
  },
  platformChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  platformName: {
    fontSize: 12,
    fontWeight: '600',
  },
  timePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  timeText: {
    fontSize: 12,
    color: colors.text.muted,
    fontWeight: '500',
  },

  // Full date row
  fullDateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 8,
    marginTop: -2,
  },
  fullDateText: {
    fontSize: 12,
    color: colors.primary.main,
    fontWeight: '600',
  },

  // Lecturer
  lecturerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 8,
  },
  lecturerText: {
    fontSize: 12,
    color: colors.text.secondary,
  },

  // Message
  messageBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: colors.info.soft,
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
  },
  messageText: {
    flex: 1,
    fontSize: 13,
    color: colors.info.main,
    lineHeight: 18,
  },

  // Passcode
  passcodeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 10,
  },
  passcodeLabel: {
    fontSize: 12,
    color: colors.warning.main,
    fontWeight: '600',
  },
  passcodeValue: {
    fontSize: 12,
    color: colors.warning.main,
    fontWeight: '700',
    letterSpacing: 1,
  },

  // Action row
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  copyBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.primary.main,
    backgroundColor: colors.primary.soft,
  },
  copyBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary.main,
  },
  shareBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.border.light,
    backgroundColor: colors.bg.screen,
  },
  shareBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text.secondary,
  },
  joinBtn: {
    flex: 1.4,
    borderRadius: 10,
    overflow: 'hidden',
  },
  joinBtnGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    gap: 5,
  },
  joinBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
  },

  // Auto-join passcode toast
  toast: {
    position: 'absolute',
    bottom: 28,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(28,28,36,0.93)',
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    zIndex: 100,
    elevation: 8,
  },
  toastText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },

  // Loading / error / empty
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: colors.text.muted,
  },
  errorTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text.primary,
    marginTop: 16,
    marginBottom: 6,
  },
  errorMsg: {
    fontSize: 13,
    color: colors.text.secondary,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20,
  },
  retryBtn: {
    paddingHorizontal: 24,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: colors.primary.soft,
    borderWidth: 1.5,
    borderColor: colors.primary.main,
  },
  retryBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary.main,
  },
  emptyIconWrap: {
    width: 100,
    height: 100,
    borderRadius: 50,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text.primary,
    marginBottom: 8,
  },
  emptyDesc: {
    fontSize: 13,
    color: colors.text.secondary,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 280,
  },
  spinning: {
    transform: [{ rotate: '45deg' }],
  },
});
