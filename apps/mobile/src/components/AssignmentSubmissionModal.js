import React, { useState, useEffect } from 'react';
import {
  Modal, View, Text, TextInput, StyleSheet, TouchableOpacity,
  Platform, ActivityIndicator, ScrollView, Alert,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { pick, types, isCancel } from '@react-native-documents/picker';
import themeColors from '../theme/colors';

const colors = {
  primary: themeColors.primary,
  success: themeColors.success,
  warning: themeColors.warning,
  danger:  themeColors.danger,
  purple:  themeColors.purple,
  text:    { primary: themeColors.light.text.primary, secondary: themeColors.light.text.tertiary, muted: themeColors.text.secondary },
  bg:      { screen: themeColors.light.background.primary, card: themeColors.light.surface.primary, border: themeColors.light.border.light },
};

/**
 * AssignmentSubmissionModal
 *
 * Props:
 *   visible            {boolean}
 *   onClose            {() => void}
 *   onSubmit           {(payload) => Promise<void>}  — payload includes { type, text/linkUrl/file, groupId? }
 *   assignment         {object}
 *   submission         {object|null}  — existing individual or group submission
 *   groupId            {string|null}  — null for individual assignments
 *   groupName          {string|null}  — display name of the group
 */
const AssignmentSubmissionModal = ({
  visible,
  onClose,
  onSubmit,
  assignment,
  submission,
  groupId,
  groupName,
}) => {
  const isGroupAssignment = !!assignment?.isGroup;
  const allowedTypes = assignment?.allowedTypes?.length ? assignment.allowedTypes : ['file', 'link', 'text'];
  const blockLate  = assignment?.blockLate;
  const allowResub = assignment?.allowResub;
  const dueDate    = assignment?.dueDate ? new Date(assignment.dueDate) : null;
  const isLate     = dueDate && new Date() > dueDate;
  const isSubmitted = !!submission;
  const isGraded   = submission?.grade != null;

  // Can the student still submit / resubmit?
  const canSubmit = (!blockLate || !isLate) && (!isSubmitted || allowResub) && !isGraded
    && (!isGroupAssignment || !!groupId);

  // Show read-only view when submitted and can't change
  const showExisting = isSubmitted && (!canSubmit || isGraded);

  const [type, setType]       = useState(allowedTypes[0]);
  const [content, setContent] = useState('');
  const [link, setLink]       = useState('');
  const [file, setFile]       = useState(null);  // { uri, name, mimeType, size }
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (visible) {
      setType(allowedTypes[0]);
      setContent('');
      setLink('');
      setFile(null);
    }
  }, [visible, assignment?.id]);

  const pickFile = async () => {
    try {
      const [result] = await pick({ type: [types.allFiles] });
      setFile({
        uri: result.uri,
        name: result.name || 'file',
        mimeType: result.type || 'application/octet-stream',
        size: result.size,
      });
    } catch (e) {
      if (!isCancel(e)) {
        Alert.alert('Error', 'Failed to select file. Please try again.');
      }
    }
  };

  const handleSubmit = async () => {
    if (type === 'text' && !content.trim()) { Alert.alert('Validation', 'Enter your answer.'); return; }
    if (type === 'link' && !link.trim())    { Alert.alert('Validation', 'Enter a URL.'); return; }
    if (type === 'file' && !file)           { Alert.alert('Validation', 'Select a file first.'); return; }
    setLoading(true);
    try {
      let payload;
      if (type === 'text') payload = { type: 'text', text: content };
      if (type === 'link') payload = { type: 'link', linkUrl: link };
      if (type === 'file') payload = { type: 'file', file };
      if (groupId) payload.groupId = groupId;
      await onSubmit(payload);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          {/* Handle bar */}
          <View style={styles.handle} />

          {/* Header */}
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.headerTitle} numberOfLines={1}>
                {assignment?.title || 'Submit Assignment'}
              </Text>
              {isGroupAssignment && groupName ? (
                <Text style={styles.headerSub}>
                  <Icon name="account-group" size={12} color={colors.primary.main} />
                  {'  '}Group: {groupName}
                </Text>
              ) : null}
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Icon name="close" size={22} color={colors.text.secondary} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.body}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* ── Group banner ─────────────────────────────────────── */}
            {isGroupAssignment && (
              <LinearGradient
                colors={groupId
                  ? ['rgba(99,102,241,0.12)', 'rgba(139,92,246,0.08)']
                  : ['rgba(239,68,68,0.08)', 'rgba(239,68,68,0.02)']}
                style={styles.groupBanner}
              >
                <Icon
                  name={groupId ? 'account-group' : 'account-group-outline'}
                  size={18}
                  color={groupId ? colors.primary.main : colors.danger.main}
                />
                <Text style={[styles.groupBannerText, { color: groupId ? colors.primary.main : colors.danger.main }]}>
                  {groupId
                    ? `This is a group submission — all members of "${groupName || 'your group'}" will receive the same grade.`
                    : 'You are not in a group for this unit. Join a group before submitting.'}
                </Text>
              </LinearGradient>
            )}

            {/* ── Existing submission (read-only view) ─────────────── */}
            {showExisting ? (
              <View style={styles.existingBox}>
                <View style={styles.existingHeader}>
                  <Icon
                    name={isGraded ? 'star-circle' : 'check-circle'}
                    size={20}
                    color={isGraded ? colors.warning.main : colors.success.main}
                  />
                  <Text style={[styles.existingTitle, { color: isGraded ? colors.warning.main : colors.success.main }]}>
                    {isGraded
                      ? `Graded: ${submission.grade} / ${assignment?.maxScore || 100} pts`
                      : 'Submitted'}
                  </Text>
                </View>
                {submission.submittedByName ? (
                  <Text style={styles.existingMeta}>
                    Submitted by {submission.submittedByName}
                    {submission.submittedAt ? ` · ${new Date(submission.submittedAt).toLocaleString()}` : ''}
                  </Text>
                ) : submission.submittedAt ? (
                  <Text style={styles.existingMeta}>
                    {new Date(submission.submittedAt).toLocaleString()}
                  </Text>
                ) : null}
                {submission.type === 'text' && submission.text ? (
                  <Text style={styles.existingContent}>{submission.text}</Text>
                ) : null}
                {submission.type === 'link' && submission.linkUrl ? (
                  <Text style={[styles.existingContent, { color: colors.primary.main }]}>
                    {submission.linkUrl}
                  </Text>
                ) : null}
                {submission.type === 'file' ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                    <Icon name="file-outline" size={16} color={colors.primary.main} />
                    <Text style={[styles.existingContent, { color: colors.primary.main, marginLeft: 6 }]}>
                      {submission.fileName || 'Uploaded file'}
                    </Text>
                  </View>
                ) : null}
                {submission.feedback ? (
                  <View style={styles.feedbackBox}>
                    <Text style={styles.feedbackLabel}>Feedback</Text>
                    <Text style={styles.feedbackText}>{submission.feedback}</Text>
                  </View>
                ) : null}
              </View>

            ) : canSubmit ? (
              <>
                {/* ── Submission type selector ───────────────────────── */}
                {allowedTypes.length > 0 && (
                  <View style={styles.typeRow}>
                    {allowedTypes.map(t => (
                      <TouchableOpacity
                        key={t}
                        style={[styles.typeBtn, type === t && styles.typeBtnActive]}
                        onPress={() => setType(t)}
                        disabled={loading}
                      >
                        <Icon
                          name={t === 'text' ? 'text-long' : t === 'link' ? 'link-variant' : 'file-upload-outline'}
                          size={14}
                          color={type === t ? '#fff' : colors.primary.main}
                        />
                        <Text style={[styles.typeBtnText, type === t && styles.typeBtnTextActive]}>
                          {t.charAt(0).toUpperCase() + t.slice(1)}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {/* ── Text input ────────────────────────────────────── */}
                {type === 'text' && (
                  <TextInput
                    style={styles.textInput}
                    placeholder="Type your answer here..."
                    placeholderTextColor={colors.text.muted}
                    value={content}
                    onChangeText={setContent}
                    multiline
                    textAlignVertical="top"
                    editable={!loading}
                  />
                )}

                {/* ── Link input ────────────────────────────────────── */}
                {type === 'link' && (
                  <TextInput
                    style={styles.linkInput}
                    placeholder="https://..."
                    placeholderTextColor={colors.text.muted}
                    value={link}
                    onChangeText={setLink}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    editable={!loading}
                  />
                )}

                {/* ── File picker ───────────────────────────────────── */}
                {type === 'file' && (
                  <TouchableOpacity style={styles.filePicker} onPress={pickFile} disabled={loading}>
                    <Icon
                      name={file ? 'file-check-outline' : 'file-upload-outline'}
                      size={26}
                      color={colors.primary.main}
                    />
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={styles.filePickerTitle} numberOfLines={1}>
                        {file ? file.name : 'Tap to select a file'}
                      </Text>
                      {file?.size ? (
                        <Text style={styles.filePickerMeta}>
                          {file.size < 1024 * 1024
                            ? `${(file.size / 1024).toFixed(1)} KB`
                            : `${(file.size / (1024 * 1024)).toFixed(1)} MB`}
                        </Text>
                      ) : null}
                    </View>
                    {file ? (
                      <TouchableOpacity
                        onPress={() => setFile(null)}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      >
                        <Icon name="close-circle" size={20} color={colors.text.muted} />
                      </TouchableOpacity>
                    ) : null}
                  </TouchableOpacity>
                )}

                {/* ── Late warning ─────────────────────────────────── */}
                {isLate && !blockLate && (
                  <View style={styles.lateWarning}>
                    <Icon name="clock-alert-outline" size={14} color={colors.warning.main} />
                    <Text style={styles.lateWarningText}>This is a late submission.</Text>
                  </View>
                )}
              </>

            ) : (
              /* ── Blocked state ──────────────────────────────────── */
              <View style={styles.blockedBox}>
                <Icon name="lock-outline" size={20} color={colors.danger.main} />
                <Text style={styles.blockedText}>
                  {isGraded
                    ? 'This assignment has already been graded.'
                    : blockLate && isLate
                    ? 'Late submissions are blocked for this assignment.'
                    : isGroupAssignment && !groupId
                    ? 'Join a group before submitting this assignment.'
                    : 'Resubmission is not allowed for this assignment.'}
                </Text>
              </View>
            )}
          </ScrollView>

          {/* ── Footer ────────────────────────────────────────────── */}
          <View style={styles.footer}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose} disabled={loading}>
              <Text style={styles.cancelBtnText}>
                {showExisting ? 'Close' : 'Cancel'}
              </Text>
            </TouchableOpacity>

            {!showExisting && canSubmit && (
              <TouchableOpacity
                style={[styles.submitBtn, loading && { opacity: 0.65 }]}
                onPress={handleSubmit}
                disabled={loading}
              >
                <LinearGradient colors={colors.primary.gradient} style={styles.submitBtnGradient}>
                  {loading ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Icon name={isSubmitted ? 'refresh' : 'send'} size={16} color="#fff" />
                      <Text style={styles.submitBtnText}>
                        {isSubmitted
                          ? 'Resubmit'
                          : isGroupAssignment
                          ? 'Submit for Group'
                          : 'Submit'}
                      </Text>
                    </>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '92%',
    paddingBottom: Platform.OS === 'ios' ? 34 : 16,
  },
  handle: {
    width: 40, height: 4, backgroundColor: '#E2E8F0',
    borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 4,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  headerTitle: {
    fontSize: 17, fontWeight: '700', color: '#111827', marginBottom: 2,
  },
  headerSub: {
    fontSize: 13, color: '#6366F1', fontWeight: '600',
  },
  body: {
    padding: 20,
    maxHeight: '75%',
  },
  groupBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    gap: 10,
  },
  groupBannerText: {
    flex: 1, fontSize: 13, fontWeight: '500', lineHeight: 18,
  },
  typeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  typeBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 5, paddingVertical: 10, borderRadius: 10,
    backgroundColor: 'rgba(99,102,241,0.08)',
    borderWidth: 1, borderColor: 'rgba(99,102,241,0.2)',
  },
  typeBtnActive: {
    backgroundColor: '#6366F1', borderColor: '#6366F1',
  },
  typeBtnText: {
    fontSize: 13, fontWeight: '600', color: '#6366F1',
  },
  typeBtnTextActive: { color: '#fff' },
  textInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1, borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 14, fontSize: 14, color: '#111827',
    height: 140, textAlignVertical: 'top',
    marginBottom: 12,
  },
  linkInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1, borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 14, fontSize: 14, color: '#111827',
    marginBottom: 12,
  },
  filePicker: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(99,102,241,0.05)',
    borderWidth: 1.5,
    borderColor: 'rgba(99,102,241,0.3)',
    borderStyle: 'dashed',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  filePickerTitle: {
    fontSize: 14, fontWeight: '600', color: '#111827',
  },
  filePickerMeta: {
    fontSize: 12, color: '#64748B', marginTop: 2,
  },
  lateWarning: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(245,158,11,0.1)',
    borderRadius: 10, padding: 10, marginBottom: 8,
  },
  lateWarningText: {
    fontSize: 13, color: '#F59E0B', fontWeight: '500',
  },
  blockedBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: 'rgba(239,68,68,0.07)',
    borderRadius: 12, padding: 14, marginBottom: 12,
  },
  blockedText: {
    flex: 1, fontSize: 13, color: '#EF4444', fontWeight: '500', lineHeight: 18,
  },
  existingBox: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1, borderColor: '#E2E8F0',
    borderRadius: 14, padding: 16, marginBottom: 12,
  },
  existingHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6,
  },
  existingTitle: {
    fontSize: 15, fontWeight: '700',
  },
  existingMeta: {
    fontSize: 12, color: '#9CA3AF', marginBottom: 10,
  },
  existingContent: {
    fontSize: 14, color: '#374151', lineHeight: 20,
  },
  feedbackBox: {
    marginTop: 12, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: '#E2E8F0',
  },
  feedbackLabel: {
    fontSize: 11, fontWeight: '700', color: '#9CA3AF',
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4,
  },
  feedbackText: {
    fontSize: 14, color: '#374151', lineHeight: 20,
  },
  footer: {
    flexDirection: 'row',
    paddingHorizontal: 20, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: '#E2E8F0',
    gap: 12,
  },
  cancelBtn: {
    flex: 1, paddingVertical: 14, borderRadius: 12,
    backgroundColor: '#F1F5F9', alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: 15, fontWeight: '600', color: '#64748B',
  },
  submitBtn: {
    flex: 2, borderRadius: 12, overflow: 'hidden',
  },
  submitBtnGradient: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 14, gap: 8,
  },
  submitBtnText: {
    fontSize: 15, fontWeight: '700', color: '#fff',
  },
});

export default AssignmentSubmissionModal;
