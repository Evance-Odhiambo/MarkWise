import React, { useMemo } from 'react';
import { useNavigation } from '@react-navigation/native';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useColors, useTheme } from '../../../theme';

const ModeCard = ({ mode, onPress, styles }) => (
  <TouchableOpacity
    activeOpacity={0.85}
    onPress={onPress}
    style={[styles.card, { backgroundColor: mode.accentBg, borderColor: mode.accentBor }]}
  >
    <View style={styles.cardHeader}>
      <LinearGradient colors={mode.gradient} style={styles.iconCircle}>
        <Icon name={mode.icon} size={26} color="#FFFFFF" />
      </LinearGradient>
      <View style={{ flex: 1, marginLeft: 14 }}>
        <Text style={styles.cardTitle}>{mode.title}</Text>
        <Text style={styles.cardDescription} numberOfLines={3}>
          {mode.description}
        </Text>
      </View>
    </View>

    <View style={[styles.divider, { backgroundColor: mode.accentBor }]} />

    <View style={styles.bullets}>
      {mode.bullets.map((b, i) => (
        <View key={i} style={styles.bullet}>
          <Icon name={b.icon} size={15} color={mode.gradient[0]} style={{ marginTop: 1 }} />
          <Text style={styles.bulletText}>{b.text}</Text>
        </View>
      ))}
    </View>

    <LinearGradient colors={mode.gradient} style={styles.cta} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
      <Text style={styles.ctaText}>{mode.cta}</Text>
      <Icon name="arrow-right" size={16} color="#FFFFFF" />
    </LinearGradient>
  </TouchableOpacity>
);

export default function AttendanceTaker() {
  const navigation  = useNavigation();
  const colors      = useColors();
  const { isDark }  = useTheme();
  const C           = useMemo(() => ({
    bg:      colors.background.primary,
    primaryD: colors.primary.dark,
    border:  colors.border.light,
    textPri: colors.text.primary,
    textSec: colors.text.secondary,
    textMut: colors.text.muted,
    info:    colors.info.gradient,
    teal:    colors.teal.gradient,
  }), [colors]);
  const styles      = useMemo(() => makeStyles(C), [C]);

  const MODES = useMemo(() => [
    {
      key:         'OnlineTaker',
      icon:        'access-point-network',
      title:       'Online Session',
      gradient:    C.info,
      accentBg:    'rgba(59,130,246,0.08)',
      accentBor:   'rgba(59,130,246,0.25)',
      description:
        'Run a live, cloud-connected attendance session. Share a link or QR code, watch students join in real-time, and manage everything from the dashboard.',
      bullets: [
        { icon: 'link-variant',       text: 'Share a session link with remote or in-person students' },
        { icon: 'eye-check-outline',  text: 'Monitor who marks attendance in real-time' },
        { icon: 'clock-outline',      text: 'Auto-close the session with a configurable timer' },
      ],
      cta: 'Start Online Session',
    },
    {
      key:         'OfflineTaker',
      icon:        'qrcode-scan',
      title:       'Offline Session',
      gradient:    C.teal,
      accentBg:    'rgba(20,184,166,0.08)',
      accentBor:   'rgba(20,184,166,0.25)',
      description:
        "No internet? No problem. Use QR codes, manual PIN or Bluetooth broadcasts to take attendance anywhere. Records sync automatically when you're back online.",
      bullets: [
        { icon: 'qrcode-scan',        text: 'Generate QR codes or broadcast via Bluetooth' },
        { icon: 'wifi-off',           text: 'Works completely without an internet connection' },
        { icon: 'cloud-sync-outline', text: 'Syncs attendance records automatically when online' },
      ],
      cta: 'Start Offline Session',
    },
  ], [C]);

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={C.bg} />

      <LinearGradient colors={[C.primaryD, C.bg]} style={styles.hero}>
        <View style={styles.heroIcon}>
          <Icon name="clipboard-check-outline" size={32} color="#FFFFFF" />
        </View>
        <Text style={styles.heroTitle}>Attendance</Text>
        <Text style={styles.heroSub}>
          Start a session and track who shows up — online or in-person
        </Text>
      </LinearGradient>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.sectionLabel}>Choose a session type</Text>
        {MODES.map(m => (
          <ModeCard key={m.key} mode={m} onPress={() => navigation.navigate(m.key)} styles={styles} />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

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
    backgroundColor: 'rgba(20,184,166,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(20,184,166,0.3)',
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
