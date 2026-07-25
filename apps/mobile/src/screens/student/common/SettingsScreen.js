import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  Switch, Alert, Platform, StatusBar, ActivityIndicator,
  Modal, TextInput, KeyboardAvoidingView,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getStudentSession, clearStudentSession } from '../../../utils/authSession';
import { deleteStudentAccount } from '../../../utils/deleteStudentAccount';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useColors, useTheme } from '../../../theme';

// ─── Reusable row components ─────────────────────────────────────────────────

const SectionHeader = ({ label, styles }) => (
  <Text style={styles.sectionLabel}>{label}</Text>
);

const SettingRow = ({ icon, iconBg, label, sublabel, onPress, children, last, styles, C }) => (
  <TouchableOpacity
    onPress={onPress}
    activeOpacity={onPress ? 0.7 : 1}
    style={[styles.row, last && S.rowLast]}
  >
    <View style={[S.iconWrap, { backgroundColor: iconBg || 'rgba(99,102,241,0.15)' }]}>
      <Icon name={icon} size={19} color={C.text} />
    </View>
    <View style={S.rowContent}>
      <Text style={styles.rowLabel}>{label}</Text>
      {sublabel ? <Text style={styles.rowSub}>{sublabel}</Text> : null}
    </View>
    {children ? children : onPress ? (
      <Icon name="chevron-right" size={20} color={C.textTer} />
    ) : null}
  </TouchableOpacity>
);

const ToggleRow = ({ icon, iconBg, label, sublabel, value, onValueChange, last, styles, C }) => (
  <SettingRow icon={icon} iconBg={iconBg} label={label} sublabel={sublabel} last={last} styles={styles} C={C}>
    <Switch
      value={value}
      onValueChange={onValueChange}
      trackColor={{ false: C.surface2, true: C.primary }}
      thumbColor={value ? '#FFFFFF' : C.textTer}
      ios_backgroundColor={C.surface2}
    />
  </SettingRow>
);

// ─── Main screen ─────────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const navigation = useNavigation();
  const colors     = useColors();
  const { isDark, toggleTheme, preference } = useTheme();

  const C = useMemo(() => ({
    bg:       colors.background.primary,
    bgAlt:    colors.background.secondary,
    surface:  colors.surface.primary,
    surface2: colors.surface.secondary,
    border:   colors.border.light,
    primary:  colors.primary.main,
    primaryD: colors.primary.dark,
    danger:   colors.danger.main,
    dangerD:  colors.danger.dark,
    success:  colors.success.main,
    warning:  colors.warning.main,
    text:     colors.text.primary,
    textSec:  colors.text.secondary,
    textTer:  colors.text.muted,
  }), [colors]);

  const styles = useMemo(() => makeStyles(C), [C]);

  const [session, setSession]             = useState(null);
  const [notifPush, setNotifPush]         = useState(true);
  const [notifEmail, setNotifEmail]       = useState(false);
  const [notifTimetable, setNotifTimetable] = useState(true);
  const [biometric, setBiometric]         = useState(false);
  const [deleting, setDeleting]           = useState(false);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText]   = useState('');

  useEffect(() => {
    (async () => {
      const s = await getStudentSession();
      setSession(s);
      const saved = await AsyncStorage.getItem('markwise.student.prefs').catch(() => null);
      if (saved) {
        const p = JSON.parse(saved);
        if (p.notifPush      !== undefined) setNotifPush(p.notifPush);
        if (p.notifEmail     !== undefined) setNotifEmail(p.notifEmail);
        if (p.notifTimetable !== undefined) setNotifTimetable(p.notifTimetable);
        if (p.biometric      !== undefined) setBiometric(p.biometric);
      }
    })();
  }, []);

  const savePrefs = useCallback(async (patch) => {
    const saved = await AsyncStorage.getItem('markwise.student.prefs').catch(() => null);
    const prev  = saved ? JSON.parse(saved) : {};
    await AsyncStorage.setItem('markwise.student.prefs', JSON.stringify({ ...prev, ...patch }));
  }, []);

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          await clearStudentSession();
          navigation.reset({ index: 0, routes: [{ name: 'RoleSelection' }] });
        },
      },
    ]);
  };

  const handleDeleteAccount = () => {
    setDeleteConfirmText('');
    setDeleteModalVisible(true);
  };

  const handleConfirmDelete = async () => {
    setDeleting(true);
    try {
      await deleteStudentAccount();
      setDeleteModalVisible(false);
      navigation.reset({ index: 0, routes: [{ name: 'RoleSelection' }] });
    } catch (err) {
      Alert.alert('Error', err?.message || 'Failed to delete account. Try again.');
    } finally {
      setDeleting(false);
    }
  };

  const initials = session?.studentName
    ? session.studentName.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
    : '?';

  const themeLabel = { system: 'System', light: 'Light', dark: 'Dark' }[preference] ?? 'System';

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={C.bg} />

      {/* Header */}
      <LinearGradient colors={[C.bg, C.bgAlt]} style={styles.header}>
        <Text style={styles.headerTitle}>Settings</Text>
        <Text style={styles.headerSub}>Manage your account & preferences</Text>
      </LinearGradient>

      <ScrollView contentContainerStyle={S.scroll} showsVerticalScrollIndicator={false}>

        {/* Profile card */}
        <LinearGradient
          colors={colors.primary.gradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={S.profileCard}
        >
          <View style={S.avatar}>
            <Text style={S.avatarText}>{initials}</Text>
          </View>
          <View style={S.profileInfo}>
            <Text style={S.profileName}>{session?.studentName || '—'}</Text>
            <Text style={S.profileEmail}>{session?.studentEmail || '—'}</Text>
            <View style={S.profileBadge}>
              <Text style={S.profileBadgeText}>{session?.courseName || 'Unknown Course'}</Text>
            </View>
          </View>
          <Icon name="shield-account-outline" size={30} color="rgba(255,255,255,0.25)" />
        </LinearGradient>

        {/* Account */}
        <SectionHeader label="Account" styles={styles} />
        <View style={styles.card}>
          <SettingRow icon="lock-reset" iconBg="rgba(99,102,241,0.18)" label="Change Password" sublabel="Update your login password" onPress={() => Alert.alert('Coming Soon', 'Change password will be available soon.')} styles={styles} C={C} />
          <SettingRow icon="card-account-details-outline" iconBg="rgba(59,130,246,0.18)" label="Admission Number" sublabel={session?.admissionNumber || '—'} last styles={styles} C={C} />
        </View>

        {/* Appearance */}
        <SectionHeader label="Appearance" styles={styles} />
        <View style={styles.card}>
          <SettingRow
            icon={isDark ? 'weather-night' : 'white-balance-sunny'}
            iconBg="rgba(99,102,241,0.18)"
            label="Theme"
            sublabel={themeLabel}
            onPress={toggleTheme}
            last
            styles={styles} C={C}
          />
        </View>

        {/* Notifications */}
        <SectionHeader label="Notifications" styles={styles} />
        <View style={styles.card}>
          <ToggleRow icon="bell-ring-outline" iconBg="rgba(245,158,11,0.18)" label="Push Notifications" sublabel="Assignment & attendance alerts" value={notifPush} onValueChange={v => { setNotifPush(v); savePrefs({ notifPush: v }); }} styles={styles} C={C} />
          <ToggleRow icon="calendar-clock-outline" iconBg="rgba(16,185,129,0.18)" label="Timetable Reminders" sublabel="Class start-time reminders" value={notifTimetable} onValueChange={v => { setNotifTimetable(v); savePrefs({ notifTimetable: v }); }} styles={styles} C={C} />
          <ToggleRow icon="email-outline" iconBg="rgba(139,92,246,0.18)" label="Email Notifications" sublabel="Grade & feedback via email" value={notifEmail} onValueChange={v => { setNotifEmail(v); savePrefs({ notifEmail: v }); }} last styles={styles} C={C} />
        </View>

        {/* Security */}
        <SectionHeader label="Security" styles={styles} />
        <View style={styles.card}>
          <ToggleRow icon="fingerprint" iconBg="rgba(20,184,166,0.18)" label="Biometric Login" sublabel="Use fingerprint or Face ID" value={biometric} onValueChange={v => { setBiometric(v); savePrefs({ biometric: v }); }} last styles={styles} C={C} />
        </View>

        {/* Support */}
        <SectionHeader label="Support" styles={styles} />
        <View style={styles.card}>
          <SettingRow icon="help-circle-outline" iconBg="rgba(59,130,246,0.18)" label="Help & FAQ" onPress={() => Alert.alert('Help', 'Visit markwise.app/help for documentation.')} styles={styles} C={C} />
          <SettingRow icon="message-alert-outline" iconBg="rgba(245,158,11,0.18)" label="Send Feedback" onPress={() => Alert.alert('Feedback', 'Feedback form coming soon.')} styles={styles} C={C} />
          <SettingRow icon="file-document-outline" iconBg="rgba(16,185,129,0.18)" label="Privacy Policy" onPress={() => Alert.alert('Privacy', 'Visit markwise.app/privacy.')} last styles={styles} C={C} />
        </View>

        {/* About */}
        <SectionHeader label="About" styles={styles} />
        <View style={styles.card}>
          <SettingRow icon="information-outline" iconBg="rgba(99,102,241,0.18)" label="App Version" sublabel="MarkWise v1.0.0" last styles={styles} C={C} />
        </View>

        {/* Danger Zone */}
        <SectionHeader label="Danger Zone" styles={styles} />
        <View style={styles.card}>
          <TouchableOpacity style={styles.row} onPress={handleSignOut}>
            <View style={[S.iconWrap, { backgroundColor: 'rgba(239,68,68,0.15)' }]}>
              <Icon name="logout" size={19} color={C.danger} />
            </View>
            <View style={S.rowContent}>
              <Text style={[styles.rowLabel, { color: C.danger }]}>Sign Out</Text>
            </View>
            <Icon name="chevron-right" size={20} color={C.danger} />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.row, S.rowLast]} onPress={handleDeleteAccount} disabled={deleting}>
            <View style={[S.iconWrap, { backgroundColor: 'rgba(239,68,68,0.15)' }]}>
              {deleting ? <ActivityIndicator size="small" color={C.danger} /> : <Icon name="account-remove-outline" size={19} color={C.danger} />}
            </View>
            <View style={S.rowContent}>
              <Text style={[styles.rowLabel, { color: C.danger }]}>Delete Account</Text>
              <Text style={[styles.rowSub, { color: 'rgba(239,68,68,0.7)' }]}>Permanently removes all your data</Text>
            </View>
            <Icon name="chevron-right" size={20} color={C.danger} />
          </TouchableOpacity>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Delete confirmation modal */}
      <Modal visible={deleteModalVisible} transparent animationType="fade" onRequestClose={() => !deleting && setDeleteModalVisible(false)}>
        <KeyboardAvoidingView style={S.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalSheet}>
            <View style={S.modalIconWrap}>
              <Icon name="alert-circle-outline" size={32} color={C.danger} />
            </View>
            <Text style={styles.modalTitle}>Delete Account</Text>
            <Text style={styles.modalBody}>
              This will permanently delete your account and{' '}
              <Text style={{ fontWeight: '700', color: C.text }}>all your data</Text>
              {' — attendance records, badges, assignments and materials.\n\n'}
              {'This action '}
              <Text style={{ fontWeight: '700', color: C.danger }}>cannot be undone</Text>.
            </Text>
            <Text style={styles.modalHint}>
              Type{' '}<Text style={{ fontWeight: '800', color: C.danger }}>DELETE</Text>{' '}to confirm:
            </Text>
            <TextInput
              style={[styles.modalInput, deleteConfirmText === 'DELETE' && styles.modalInputActive]}
              value={deleteConfirmText}
              onChangeText={setDeleteConfirmText}
              placeholder="Type DELETE here"
              placeholderTextColor={C.textTer}
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!deleting}
            />
            <TouchableOpacity
              style={[styles.modalDeleteBtn, deleteConfirmText !== 'DELETE' && styles.modalDeleteBtnDisabled]}
              onPress={handleConfirmDelete}
              disabled={deleteConfirmText !== 'DELETE' || deleting}
              activeOpacity={0.8}
            >
              {deleting ? <ActivityIndicator size="small" color="#fff" /> : <Text style={S.modalDeleteBtnText}>Delete My Account</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={S.modalCancelBtn} onPress={() => setDeleteModalVisible(false)} disabled={deleting}>
              <Text style={styles.modalCancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

// Static layout styles
const S = StyleSheet.create({
  scroll:            { paddingHorizontal: 16, paddingTop: 20 },
  profileCard:       { flexDirection: 'row', alignItems: 'center', borderRadius: 18, padding: 18, marginBottom: 24, gap: 14 },
  avatar:            { width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center' },
  avatarText:        { fontSize: 20, fontWeight: '700', color: '#FFFFFF' },
  profileInfo:       { flex: 1 },
  profileName:       { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  profileEmail:      { fontSize: 12, color: 'rgba(255,255,255,0.75)', marginTop: 2 },
  profileBadge:      { backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3, alignSelf: 'flex-start', marginTop: 6 },
  profileBadgeText:  { fontSize: 11, fontWeight: '600', color: '#FFFFFF' },
  iconWrap:          { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowContent:        { flex: 1 },
  rowLast:           { borderBottomWidth: 0 },
  modalOverlay:      { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalIconWrap:     { width: 60, height: 60, borderRadius: 30, backgroundColor: 'rgba(239,68,68,0.12)', justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  modalDeleteBtnText:{ fontSize: 15, fontWeight: '700', color: '#fff' },
  modalCancelBtn:    { width: '100%', paddingVertical: 12, alignItems: 'center' },
});

// Theme-sensitive factory
const makeStyles = (C) => StyleSheet.create({
  screen:               { flex: 1, backgroundColor: C.bg },
  header:               { paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight + 16 : 56, paddingBottom: 20, paddingHorizontal: 24 },
  headerTitle:          { fontSize: 28, fontWeight: '800', color: C.text, letterSpacing: 0.3 },
  headerSub:            { fontSize: 13, color: C.textTer, marginTop: 3 },
  sectionLabel:         { fontSize: 11, fontWeight: '700', color: C.textTer, letterSpacing: 1.1, textTransform: 'uppercase', marginBottom: 8, marginLeft: 4, marginTop: 6 },
  card:                 { backgroundColor: C.surface, borderRadius: 16, borderWidth: 1, borderColor: C.border, marginBottom: 18, overflow: 'hidden' },
  row:                  { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: C.border, gap: 12 },
  rowLabel:             { fontSize: 14, fontWeight: '600', color: C.text },
  rowSub:               { fontSize: 11, color: C.textTer, marginTop: 2 },
  modalSheet:           { width: '100%', backgroundColor: C.surface, borderRadius: 20, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(239,68,68,0.25)' },
  modalTitle:           { fontSize: 20, fontWeight: '800', color: C.text, marginBottom: 10 },
  modalBody:            { fontSize: 13, color: C.textSec, textAlign: 'center', lineHeight: 20, marginBottom: 20 },
  modalHint:            { fontSize: 13, color: C.textSec, alignSelf: 'flex-start', marginBottom: 8 },
  modalInput:           { width: '100%', backgroundColor: C.surface2, borderWidth: 1.5, borderColor: C.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, fontWeight: '700', color: C.text, letterSpacing: 2, marginBottom: 16 },
  modalInputActive:     { borderColor: C.danger },
  modalDeleteBtn:       { width: '100%', backgroundColor: C.danger, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginBottom: 10 },
  modalDeleteBtnDisabled:{ backgroundColor: 'rgba(239,68,68,0.3)' },
  modalCancelBtnText:   { fontSize: 14, color: C.textSec, fontWeight: '600' },
});
