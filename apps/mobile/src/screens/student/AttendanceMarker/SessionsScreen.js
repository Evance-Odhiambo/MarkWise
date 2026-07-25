import React, { useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, StatusBar,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import useResponsive from '../../../hooks/useResponsive';
import { useColors, useTheme } from '../../../theme';

const FeatureCard = ({ feature, onPress, styles }) => (
  <TouchableOpacity
    activeOpacity={0.85}
    onPress={onPress}
    style={[styles.card, { backgroundColor: feature.accentBg, borderColor: feature.accentBor }]}
  >
    <View style={styles.cardHeader}>
      <LinearGradient colors={feature.gradient} style={styles.iconCircle}>
        <Icon name={feature.icon} size={26} color="#FFFFFF" />
      </LinearGradient>
      <View style={{ flex: 1, marginLeft: 14 }}>
        <Text style={styles.cardTitle}>{feature.title}</Text>
        <Text style={styles.cardDescription} numberOfLines={3}>
          {feature.description}
        </Text>
      </View>
    </View>

    <View style={[styles.divider, { backgroundColor: feature.accentBor }]} />

    <View style={styles.bullets}>
      {feature.bullets.map((b, i) => (
        <View key={i} style={styles.bullet}>
          <Icon name={b.icon} size={15} color={feature.gradient[0]} style={{ marginTop: 1 }} />
          <Text style={styles.bulletText}>{b.text}</Text>
        </View>
      ))}
    </View>

    <LinearGradient
      colors={feature.gradient}
      style={styles.cta}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
    >
      <Text style={styles.ctaText}>{feature.cta}</Text>
      <Icon name="arrow-right" size={16} color="#FFFFFF" />
    </LinearGradient>
  </TouchableOpacity>
);

const SessionsScreen = () => {
  const { isTablet, contentMaxWidth } = useResponsive();
  const navigation  = useNavigation();
  const colors      = useColors();
  const { isDark }  = useTheme();
  const C           = useMemo(() => ({
    bg:      colors.background.primary,
    primaryD: colors.primary.dark,
    textPri: colors.text.primary,
    textSec: colors.text.secondary,
    textMut: colors.text.muted,
    pGrad:   colors.primary.gradient,
    sGrad:   colors.success.gradient,
    amber:   colors.warning.gradient,
    purple:  colors.purple.gradient,
  }), [colors]);
  const styles      = useMemo(() => makeStyles(C), [C]);

  const FEATURES = useMemo(() => [
    {
      key:         'OfflineMarker',
      icon:        'qrcode-scan',
      title:       'Offline Attendance',
      gradient:    C.amber,
      accentBg:    'rgba(245,158,11,0.08)',
      accentBor:   'rgba(245,158,11,0.25)',
      description: 'Mark attendance in person using a QR code scan, Bluetooth proximity detection, or a manual PIN — works even without internet.',
      bullets: [
        { icon: 'qrcode-scan',      text: 'Scan the QR code displayed in your lecture hall' },
        { icon: 'bluetooth',        text: 'Auto-detect nearby BLE beacons in the room' },
        { icon: 'keyboard-outline', text: 'Enter the manual PIN code as a fallback option' },
      ],
      cta: 'Mark Offline',
    },
    {
      key:         'OnlineMarker',
      icon:        'link-variant',
      title:       'Online Attendance',
      gradient:    C.pGrad,
      accentBg:    'rgba(99,102,241,0.08)',
      accentBor:   'rgba(99,102,241,0.25)',
      description: 'Mark your attendance for an online session using a secure, time-limited link shared by your lecturer.',
      bullets: [
        { icon: 'shield-check-outline', text: 'Secure and time-limited verification link' },
        { icon: 'check-circle-outline', text: 'Submit your attendance record in seconds' },
        { icon: 'wifi-check',           text: 'Works over any internet connection' },
      ],
      cta: 'Mark Online',
    },
    {
      key:         'LeadSession',
      icon:        'account-group',
      title:       'Lead GD Session',
      gradient:    C.sGrad,
      accentBg:    'rgba(16,185,129,0.08)',
      accentBor:   'rgba(16,185,129,0.25)',
      description: 'Host a collaborative group discussion and track student participation with a live Bluetooth attendance beacon.',
      bullets: [
        { icon: 'access-point',          text: 'Broadcast a BLE beacon to nearby participants' },
        { icon: 'clock-outline',         text: 'Monitor session duration and check-ins in real time' },
        { icon: 'account-check-outline', text: 'Students auto-check in when they enter range' },
      ],
      cta: 'Start GD Session',
    },
    {
      key:         'MeetingInvites',
      icon:        'video-outline',
      title:       'Meeting Invites',
      gradient:    C.purple,
      accentBg:    'rgba(139,92,246,0.08)',
      accentBor:   'rgba(139,92,246,0.25)',
      description: "Access online class links and meeting invitations shared by your lecturers for live virtual sessions.",
      bullets: [
        { icon: 'link-variant', text: "Join your lecturer's virtual class instantly" },
        { icon: 'bell-outline', text: 'Receive invites as soon as they are shared' },
        { icon: 'history',      text: 'Browse past and upcoming meeting links' },
      ],
      cta: 'View Invites',
    },
  ], [C]);

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={C.bg} />

      <LinearGradient colors={[C.primaryD, C.bg]} style={styles.hero}>
        <View style={styles.heroIcon}>
          <Icon name="calendar-check-outline" size={32} color="#FFFFFF" />
        </View>
        <Text style={styles.heroTitle}>Sessions</Text>
        <Text style={styles.heroSub}>
          Mark attendance, join online sessions, and lead group discussions
        </Text>
      </LinearGradient>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[
          styles.scroll,
          isTablet && { maxWidth: contentMaxWidth, alignSelf: 'center', width: '100%' },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.sectionLabel}>Choose an option</Text>
        {FEATURES.map(f => (
          <FeatureCard
            key={f.key}
            feature={f}
            onPress={() => navigation.navigate(f.key)}
            styles={styles}
          />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
};

const makeStyles = (C) => StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.bg,
  },
  hero: {
    alignItems: 'center',
    paddingTop: 20,
    paddingBottom: 28,
    paddingHorizontal: 24,
  },
  heroIcon: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: 'rgba(99,102,241,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(99,102,241,0.3)',
  },
  heroTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: C.textPri,
    letterSpacing: 0.3,
    marginBottom: 6,
  },
  heroSub: {
    fontSize: 14,
    color: C.textSec,
    textAlign: 'center',
    lineHeight: 20,
  },
  scroll: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: C.textMut,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 14,
    marginTop: 4,
  },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 18,
    marginBottom: 16,
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  iconCircle: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: C.textPri,
    marginBottom: 5,
  },
  cardDescription: {
    fontSize: 13,
    color: C.textSec,
    lineHeight: 19,
  },
  divider: {
    height: 1,
    marginBottom: 14,
  },
  bullets: {
    gap: 10,
    marginBottom: 16,
  },
  bullet: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  bulletText: {
    flex: 1,
    fontSize: 13,
    color: C.textSec,
    lineHeight: 18,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    borderRadius: 13,
  },
  ctaText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});

export default SessionsScreen;
