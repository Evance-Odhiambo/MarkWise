// ShareMeetingModal.js — Lecturer composes and sends a meeting invite to students
import React, { useState, useCallback } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Vibration,
} from 'react-native';
import { displayLocalNotification, CHANNELS } from '../../../utils/notificationService';
import { sendNotification } from '../../../utils/notificationApi';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { detectPlatform, postMeetingInvite } from '../../../utils/meetingInviteApi';
import themeColors from '../../../theme/colors';

// Minutes before the meeting starts — quick preset options
const QUICK_PRESETS = [
  { label: 'Now',    minutes: 0   },
  { label: '+5 min', minutes: 5   },
  { label: '+10 min',minutes: 10  },
  { label: '+15 min',minutes: 15  },
  { label: '+30 min',minutes: 30  },
  { label: '+1 hr',  minutes: 60  },
  { label: '+2 hrs', minutes: 120 },
  { label: '+3 hrs', minutes: 180 },
];

const colors = {
  primary:  themeColors.primary,
  success:  themeColors.success,
  danger:   themeColors.danger,
  warning:  themeColors.warning,
  info:     themeColors.info,
  text:     { primary: themeColors.light.text.primary, secondary: themeColors.light.text.tertiary, muted: themeColors.light.text.muted, inverse: themeColors.text.primary },
  border:   { light: themeColors.light.border.light },
  bg:       { card: themeColors.light.surface.primary, screen: themeColors.light.background.primary },
  overlay:  themeColors.overlay.light,
};

/**
 * Format an ISO scheduledAt string into a readable label that includes the
 * actual clock time so the lecturer knows exactly when students will see the
 * invite.  Example: "In 5 min  ·  Mon, 30 Apr at 10:30 AM"
 */
function formatScheduledAt(isoString) {
  const d = new Date(isoString);
  const now = new Date();
  const diffMs = d - now;
  const diffMin = Math.round(diffMs / 60000);

  const dateStr = d.toLocaleString([], {
    weekday: 'short',
    month:   'short',
    day:     'numeric',
    hour:    '2-digit',
    minute:  '2-digit',
  });

  if (diffMin <= 0) return `Now  ·  ${dateStr}`;
  if (diffMin < 60) return `In ${diffMin} min  ·  ${dateStr}`;
  const hours = Math.floor(diffMin / 60);
  const mins  = diffMin % 60;
  const label = `${hours}h${mins > 0 ? ` ${mins}m` : ''}`;
  return `In ${label}  ·  ${dateStr}`;
}

/**
 * ShareMeetingModal
 *
 * Props:
 *   visible     {boolean}  — controls modal visibility
 *   onClose     {function} — called when the modal should dismiss
 *   onSent      {function} — called with the server response after a successful send
 *   unitCode    {string}
 *   unitName    {string}
 *   meetingLink {string}
 *   passcode    {string}
 */
export default function ShareMeetingModal({
  visible,
  onClose,
  onSent,
  unitCode,
  unitName,
  meetingLink,
  passcode,
}) {
  const [selectedPreset, setSelectedPreset] = useState(1); // default: +5 min
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  const platform = detectPlatform(meetingLink);

  const computedScheduledAt = useCallback(() => {
    const mins = QUICK_PRESETS[selectedPreset]?.minutes ?? 5;
    return new Date(Date.now() + mins * 60 * 1000).toISOString();
  }, [selectedPreset]);

  const handleSend = async () => {
    if (!meetingLink.trim()) {
      Alert.alert('No meeting link', 'Please enter a meeting link before sending the invite.');
      return;
    }
    if (!unitCode) {
      Alert.alert('No unit selected', 'Please select a unit before sending the invite.');
      return;
    }

    setSending(true);
    try {
      const scheduledAt = computedScheduledAt();
      const result = await postMeetingInvite({
        unitCode,
        unitName,
        meetingLink: meetingLink.trim(),
        passcode: passcode.trim() || null,
        scheduledAt,
        message: message.trim() || null,
      });
      const presetLabel = QUICK_PRESETS[selectedPreset].label;
      const isNow = presetLabel === 'Now';

      // Push FCM notification to all students enrolled in this unit.
      // Fire-and-forget — a notification failure must never surface as a send error.
      sendNotification({
        type: 'meeting_invite',
        title: `Meeting Invite — ${unitCode}`,
        message: isNow
          ? `${platform.name} meeting is starting now. Tap to join.`
          : `${platform.name} meeting scheduled ${presetLabel}. Tap to view details.`,
        recipients: [unitCode],
        data: {
          inviteId:    String(result?.id ?? result?._id ?? ''),
          unitCode,
          unitName:    unitName || unitCode,
          meetingLink: meetingLink.trim(),
          passcode:    passcode?.trim() || null,
          scheduledAt,
          platform:    platform.name,
        },
      }).catch(() => {});

      Vibration.vibrate(100);
      displayLocalNotification({
        title: 'Invite Sent!',
        body: `Meeting invite sent to ${unitCode} students.`,
        channelId: CHANNELS.lesson,
      }).catch(() => {});
      Alert.alert(
        'Invite Sent!',
        `Students enrolled in ${unitCode} will see the meeting invite${presetLabel === 'Now' ? ' immediately' : ` scheduled for ${presetLabel}`}.`,
        [{ text: 'OK', onPress: () => { onSent?.(result); onClose(); } }],
      );
    } catch (err) {
      Alert.alert('Failed to send invite', err.message);
    } finally {
      setSending(false);
    }
  };

  const handleClose = () => {
    if (!sending) {
      setMessage('');
      setSelectedPreset(1);
      onClose();
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <TouchableOpacity
        style={styles.overlay}
        activeOpacity={1}
        onPress={handleClose}
      >
        {/* Stop tap events from propagating through the sheet */}
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.kavWrapper}
        >
          <View
            onStartShouldSetResponder={() => true}
            style={styles.sheet}
          >
            {/* Handle */}
            <View style={styles.handle} />

            {/* Header */}
            <View style={styles.header}>
              <View style={styles.headerLeft}>
                <LinearGradient colors={colors.primary.gradient} style={styles.headerIcon}>
                  <Icon name="send" size={18} color="#fff" />
                </LinearGradient>
                <View>
                  <Text style={styles.headerTitle}>Send Meeting Invite</Text>
                  <Text style={styles.headerSubtitle}>Students will be notified in-app</Text>
                </View>
              </View>
              <TouchableOpacity onPress={handleClose} disabled={sending} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Icon name="close" size={22} color={colors.text.muted} />
              </TouchableOpacity>
            </View>

            <ScrollView
              contentContainerStyle={styles.body}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {/* Meeting info (read-only) */}
              <View style={styles.infoCard}>
                {/* Unit row */}
                <View style={styles.infoRow}>
                  <View style={[styles.infoIconWrap, { backgroundColor: colors.primary.soft }]}>
                    <Icon name="school" size={15} color={colors.primary.main} />
                  </View>
                  <View style={styles.infoText}>
                    <Text style={styles.infoLabel}>Unit</Text>
                    <Text style={styles.infoValue} numberOfLines={1}>
                      {unitName && unitName !== unitCode ? `${unitCode} — ${unitName}` : unitCode || '—'}
                    </Text>
                  </View>
                </View>

                <View style={styles.infoDivider} />

                {/* Platform row */}
                <View style={styles.infoRow}>
                  <View style={[styles.infoIconWrap, { backgroundColor: `${platform.color}18` }]}>
                    <Icon name={platform.icon} size={15} color={platform.color} />
                  </View>
                  <View style={styles.infoText}>
                    <Text style={styles.infoLabel}>{platform.name}</Text>
                    <Text style={styles.infoValue} numberOfLines={1} selectable>
                      {meetingLink || 'No link entered'}
                    </Text>
                  </View>
                </View>

                {/* Passcode row (only if provided) */}
                {!!passcode && (
                  <>
                    <View style={styles.infoDivider} />
                    <View style={styles.infoRow}>
                      <View style={[styles.infoIconWrap, { backgroundColor: colors.warning.soft }]}>
                        <Icon name="lock-outline" size={15} color={colors.warning.main} />
                      </View>
                      <View style={styles.infoText}>
                        <Text style={styles.infoLabel}>Passcode</Text>
                        <Text style={styles.infoValue} selectable>{passcode}</Text>
                      </View>
                    </View>
                  </>
                )}
              </View>

              {/* Schedule: quick presets */}
              <Text style={styles.sectionLabel}>
                <Icon name="clock-outline" size={13} color={colors.text.secondary} /> {' '}
                Send when?
              </Text>
              <View style={styles.presetGrid}>
                {QUICK_PRESETS.map((preset, idx) => {
                  const active = selectedPreset === idx;
                  return (
                    <TouchableOpacity
                      key={preset.label}
                      style={[styles.presetChip, active && styles.presetChipActive]}
                      onPress={() => setSelectedPreset(idx)}
                      activeOpacity={0.75}
                    >
                      {active && (
                        <Icon name="check-circle" size={13} color={colors.primary.main} />
                      )}
                      <Text style={[styles.presetLabel, active && styles.presetLabelActive]}>
                        {preset.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Computed scheduled time preview */}
              <View style={styles.schedulePreview}>
                <Icon name="calendar-clock" size={14} color={colors.info.main} />
                <Text style={styles.schedulePreviewText}>
                  {formatScheduledAt(computedScheduledAt())}
                </Text>
              </View>

              {/* Optional message */}
              <Text style={styles.sectionLabel}>
                <Icon name="message-text-outline" size={13} color={colors.text.secondary} /> {' '}
                Message to students (optional)
              </Text>
              <View style={styles.messageInputWrap}>
                <TextInput
                  style={styles.messageInput}
                  placeholder={`e.g. "Please join 5 minutes before class starts. See you there!"`}
                  placeholderTextColor={colors.text.muted}
                  value={message}
                  onChangeText={setMessage}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                  maxLength={300}
                />
                <Text style={styles.charCount}>{message.length}/300</Text>
              </View>

              {/* Info note */}
              <View style={styles.noteRow}>
                <Icon name="information-outline" size={14} color={colors.info.main} />
                <Text style={styles.noteText}>
                  All students enrolled in <Text style={styles.noteHighlight}>{unitCode}</Text> will see this invite in their MarkWise app.
                </Text>
              </View>

              {/* Send button */}
              <TouchableOpacity
                style={[styles.sendBtn, (!meetingLink || !unitCode || sending) && styles.sendBtnDisabled]}
                onPress={handleSend}
                disabled={!meetingLink || !unitCode || sending}
                activeOpacity={0.85}
              >
                <LinearGradient
                  colors={(!meetingLink || !unitCode || sending) ? ['#9CA3AF', '#6B7280'] : colors.primary.gradient}
                  style={styles.sendBtnGradient}
                >
                  {sending ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <>
                      <Icon name="send" size={18} color="#fff" />
                      <Text style={styles.sendBtnText}>Send to Students</Text>
                    </>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  kavWrapper: {
    width: '100%',
  },
  sheet: {
    backgroundColor: colors.bg.card,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 8,
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    maxHeight: '90%',
  },

  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border.light,
    alignSelf: 'center',
    marginBottom: 16,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text.primary,
  },
  headerSubtitle: {
    fontSize: 12,
    color: colors.text.muted,
    marginTop: 1,
  },

  body: {
    paddingBottom: 8,
  },

  // Info card (meeting details, read-only)
  infoCard: {
    backgroundColor: colors.bg.screen,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border.light,
    padding: 14,
    marginBottom: 20,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 6,
  },
  infoIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  infoText: {
    flex: 1,
  },
  infoLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.text.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 1,
  },
  infoValue: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.text.primary,
  },
  infoDivider: {
    height: 1,
    backgroundColor: colors.border.light,
    marginVertical: 4,
  },

  // Section heading
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text.secondary,
    marginBottom: 10,
  },

  // Preset chips
  presetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  presetChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: colors.border.light,
    backgroundColor: colors.bg.screen,
  },
  presetChipActive: {
    borderColor: colors.primary.main,
    backgroundColor: colors.primary.soft,
  },
  presetLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.text.secondary,
  },
  presetLabelActive: {
    color: colors.primary.main,
    fontWeight: '600',
  },

  // Computed time preview
  schedulePreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.info.soft,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 20,
  },
  schedulePreviewText: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.info.main,
  },

  // Message input
  messageInputWrap: {
    borderWidth: 1.5,
    borderColor: colors.border.light,
    borderRadius: 14,
    backgroundColor: colors.bg.screen,
    padding: 12,
    marginBottom: 8,
  },
  messageInput: {
    fontSize: 14,
    color: colors.text.primary,
    minHeight: 72,
    lineHeight: 20,
    padding: 0,
  },
  charCount: {
    fontSize: 11,
    color: colors.text.muted,
    textAlign: 'right',
    marginTop: 4,
  },

  // Note
  noteRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: colors.info.soft,
    padding: 12,
    borderRadius: 12,
    marginBottom: 20,
    marginTop: 4,
  },
  noteText: {
    flex: 1,
    fontSize: 12,
    color: colors.info.main,
    lineHeight: 18,
  },
  noteHighlight: {
    fontWeight: '700',
  },

  // Send button
  sendBtn: {
    borderRadius: 14,
    overflow: 'hidden',
    elevation: 2,
    shadowColor: colors.primary.main,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  sendBtnDisabled: {
    opacity: 0.6,
  },
  sendBtnGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    gap: 10,
  },
  sendBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
});
