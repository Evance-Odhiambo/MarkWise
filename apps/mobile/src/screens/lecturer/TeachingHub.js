import React, { useMemo } from 'react';
import { useNavigation } from '@react-navigation/native';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useColors, useTheme } from '../../theme';

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

    <LinearGradient colors={feature.gradient} style={styles.cta} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
      <Text style={styles.ctaText}>Open {feature.title}</Text>
      <Icon name="arrow-right" size={16} color="#FFFFFF" />
    </LinearGradient>
  </TouchableOpacity>
);

export default function TeachingHub() {
  const navigation        = useNavigation();
  const colors            = useColors();
  const { isDark }        = useTheme();
  const C                 = useMemo(() => ({
    bg:      colors.background.primary,
    primaryD: colors.primary.dark,
    border:  colors.border.light,
    textPri: colors.text.primary,
    textSec: colors.text.secondary,
    textMut: colors.text.muted,
    amber:   colors.warning.gradient,
    purple:  colors.purple.gradient,
    teal:    colors.teal.gradient,
  }), [colors]);
  const styles            = useMemo(() => makeStyles(C), [C]);

  const FEATURES = useMemo(() => [
    {
      key:         'LecturerAssignments',
      icon:        'clipboard-text',
      title:       'Assignments',
      gradient:    C.amber,
      accentBg:    'rgba(245,158,11,0.08)',
      accentBor:   'rgba(245,158,11,0.25)',
      description: 'Create, distribute and grade assignments across all your units. Track submissions and provide targeted feedback to students.',
      bullets: [
        { icon: 'plus-circle-outline', text: 'Create and publish assignments with deadlines' },
        { icon: 'upload-outline',      text: 'Review and grade student submissions' },
        { icon: 'chart-bar',           text: 'Monitor submission progress per unit' },
      ],
    },
    {
      key:         'LecturerGroups',
      icon:        'account-group',
      title:       'Study Groups',
      gradient:    C.purple,
      accentBg:    'rgba(139,92,246,0.08)',
      accentBor:   'rgba(139,92,246,0.25)',
      description: 'Organise students into structured study groups for collaborative learning. Control group capacity, membership, and focus.',
      bullets: [
        { icon: 'account-multiple-plus', text: 'Create groups and assign them to units' },
        { icon: 'account-eye-outline',   text: 'View members and manage capacity' },
        { icon: 'crown-outline',         text: 'Designate group leaders and monitor activity' },
      ],
    },
    {
      key:         'LecturerMaterials',
      icon:        'send-circle-outline',
      title:       'Share Materials',
      gradient:    C.teal,
      accentBg:    'rgba(16,185,129,0.08)',
      accentBor:   'rgba(16,185,129,0.25)',
      description: 'Deliver learning resources directly to your students — publish PDFs, links, videos, and written notes so every enrolled student can access them instantly.',
      bullets: [
        { icon: 'file-send-outline', text: 'Publish files and slides to enrolled students' },
        { icon: 'link-plus',         text: 'Share web links and video resources instantly' },
        { icon: 'eye-check-outline', text: 'See who has viewed each resource' },
      ],
    },
  ], [C]);

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={C.bg} />

      <LinearGradient colors={[C.primaryD, C.bg]} style={styles.hero}>
        <View style={styles.heroIcon}>
          <Icon name="school-outline" size={32} color="#FFFFFF" />
        </View>
        <Text style={styles.heroSub}>
          Create, organise and share everything your students need
        </Text>
      </LinearGradient>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.sectionLabel}>Manage your content</Text>
        {FEATURES.map(f => (
          <FeatureCard key={f.key} feature={f} onPress={() => navigation.navigate(f.key)} styles={styles} />
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
    backgroundColor: 'rgba(99,102,241,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(99,102,241,0.3)',
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
