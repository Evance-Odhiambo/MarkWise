import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Animatable from 'react-native-animatable';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import ConnectivityBanner from '../../components/ConnectivityBanner';
import { useColors } from '../../theme';

// Reusable Feature Chip Component
const FeatureChip = ({ text, accentMain, accentSoft }) => (
  <View style={[S.chip, { backgroundColor: accentSoft }]}>
    <Icon name="check" size={13} color={accentMain} />
    <Text style={[S.chipText, { color: accentMain }]}>{text}</Text>
  </View>
);

// Reusable Role Card Component
const RoleCard = ({ role, isSelected, onSelect, styles }) => (
  <Animatable.View animation="fadeInUp" duration={450} useNativeDriver>
    <TouchableOpacity
      activeOpacity={0.88}
      onPress={onSelect}
      accessibilityRole="button"
      accessibilityLabel={role.actionLabel}
      accessibilityState={{ selected: isSelected }}
    >
      <View style={[
        styles.card,
        isSelected && { borderColor: role.accentMain, borderWidth: 2 }
      ]}>
        {/* Header */}
        <View style={S.cardHeader}>
          <LinearGradient
            colors={role.gradient}
            style={S.roleIcon}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <Icon name={role.icon} size={28} color="#fff" />
          </LinearGradient>

          <View style={S.cardTitleBlock}>
            <Text style={styles.roleTitle}>{role.title}</Text>
            <Text style={styles.roleSub}>{role.subtitle}</Text>
          </View>

          {isSelected && (
            <View style={[S.selectedBadge, { backgroundColor: role.accentSoft }]}>
              <Icon name="check-circle" size={22} color={role.accentMain} />
            </View>
          )}
        </View>

        {/* Features */}
        <View style={S.chips}>
          {role.features.map((feature, idx) => (
            <FeatureChip
              key={idx}
              text={feature}
              accentMain={role.accentMain}
              accentSoft={role.accentSoft}
            />
          ))}
        </View>

        {/* Action Button */}
        <LinearGradient
          colors={[role.accentDk, role.accentMain]}
          style={S.actionBtn}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
        >
          <Text style={S.actionBtnText}>{role.actionLabel}</Text>
          <Icon name="arrow-right" size={18} color="#fff" />
        </LinearGradient>
      </View>
    </TouchableOpacity>
  </Animatable.View>
);

export default function RoleSelectionScreen({ navigation }) {
  const colors  = useColors();
  const [selectedRole, setSelectedRole] = useState(null);
  const timeoutRef = useRef(null);

  const C = useMemo(() => ({
    accent:    colors.primary.main,
    accentDk:  colors.primary.dark,
    bg:        colors.background.primary,
    bgSec:     colors.background.secondary,
    surface:   colors.surface.primary,
    text:      colors.text.primary,
    textSec:   colors.text.secondary,
    textMuted: colors.text.muted,
    border:    colors.border.light,
  }), [colors]);

  const ROLES = useMemo(() => [
    {
      id: 'student',
      title: 'Student',
      subtitle: 'Mark attendance instantly, track your progress, and stay on top of your academic life.',
      icon: 'account-school',
      accentMain: colors.success.main,
      accentDk:   colors.success.dark,
      accentSoft: colors.success.soft,
      gradient:   colors.success.gradient,
      features: [
        'Mark attendance in a split second — via QR or BLE.',
        'Track your attendance progress in real time.',
        'Get alerts for class sessions and academic updates.',
        'Access study groups and shared learning materials.',
      ],
      actionLabel: 'Continue as Student',
      navigate:    'StudentSignIn',
    },
    {
      id: 'lecturer',
      title: 'Lecturer',
      subtitle: 'Run attendance sessions, manage your classes, and track student progress — all in one place.',
      icon: 'teach',
      accentMain: colors.purple.main,
      accentDk:   colors.purple.dark,
      accentSoft: colors.purple.soft,
      gradient:   colors.purple.gradient,
      features: [
        'Start QR or BLE attendance sessions instantly.',
        'Manage classes, rosters, and student study groups.',
        'Share learning materials with your students.',
        'View analytics and generate detailed attendance reports.',
      ],
      actionLabel: 'Continue as Lecturer',
      navigate:    'LecturerSignIn',
    },
  ], [colors]);

  const styles = useMemo(() => makeStyles(C), [C]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const handleRoleSelect = useCallback((role) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setSelectedRole(role.id);
    timeoutRef.current = setTimeout(() => {
      navigation.replace(role.navigate);
    }, 200);
  }, [navigation]);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle={colors.text.primary === '#0F172A' ? 'dark-content' : 'light-content'} backgroundColor={C.bg} />
      <LinearGradient
        colors={[C.bg, C.bgSec]}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
      />

      <ScrollView
        contentContainerStyle={S.scrollContent}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        <ConnectivityBanner
          message="You're offline — sign-in requires internet."
          wrapperStyle={S.offlineBanner}
        />

        {/* Hero Section */}
        <Animatable.View animation="fadeInDown" duration={500} style={S.hero}>
          <LinearGradient
            colors={[C.accentDk, C.accent]}
            style={styles.brandIcon}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <Icon name="check-decagram" size={34} color="#fff" />
          </LinearGradient>
          <Text style={styles.appName}>MarkWise</Text>
          <Text style={styles.heroTitle}>Choose your role</Text>
          <Text style={styles.heroSub}>Select how you'll be using MarkWise</Text>
        </Animatable.View>

        {/* Role Cards */}
        <View style={S.cards}>
          {ROLES.map((role) => (
            <RoleCard
              key={role.id}
              role={role}
              isSelected={selectedRole === role.id}
              onSelect={() => handleRoleSelect(role)}
              styles={styles}
            />
          ))}
        </View>

        {/* Footer */}
        <Animatable.View animation="fadeIn" duration={500} delay={360} style={S.footer}>
          <Text style={styles.footerMeta}>
            By continuing you agree to our{' '}
            <Text style={styles.footerLink}>Terms</Text>
            {' '}and{' '}
            <Text style={styles.footerLink}>Privacy Policy</Text>
          </Text>
        </Animatable.View>
      </ScrollView>
    </SafeAreaView>
  );
}

// Static layout styles (no color dependency — defined once at module level)
const S = StyleSheet.create({
  scrollContent:  { flexGrow: 1, paddingBottom: 36 },
  offlineBanner:  { marginHorizontal: 20, marginTop: 12, borderRadius: 12, overflow: 'hidden' },
  hero:           { paddingTop: 36, paddingHorizontal: 24, paddingBottom: 28, alignItems: 'center' },
  cardHeader:     { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  roleIcon:       { width: 58, height: 58, borderRadius: 18, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 5, marginRight: 14 },
  cardTitleBlock: { flex: 1 },
  selectedBadge:  { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  chips:          { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 18 },
  chip:           { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20 },
  chipText:       { fontSize: 12, fontWeight: '600' },
  actionBtn:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 16 },
  actionBtnText:  { color: '#fff', fontSize: 15, fontWeight: '700', letterSpacing: 0.2 },
  cards:          { paddingHorizontal: 16, gap: 14 },
  footer:         {},
});

// Theme-sensitive styles factory — called via useMemo when colors change
const makeStyles = (C) => StyleSheet.create({
  container:  { flex: 1, backgroundColor: C.bg },
  brandIcon:  { width: 76, height: 76, borderRadius: 26, alignItems: 'center', justifyContent: 'center', shadowColor: C.accentDk, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.5, shadowRadius: 18, elevation: 12, marginBottom: 22 },
  appName:    { fontSize: 11, fontWeight: '700', color: C.accent, letterSpacing: 2.2, textTransform: 'uppercase', marginBottom: 12 },
  heroTitle:  { fontSize: 36, fontWeight: '800', color: C.text, textAlign: 'center', letterSpacing: -0.5, marginBottom: 10 },
  heroSub:    { fontSize: 15, color: C.textSec, textAlign: 'center', lineHeight: 22 },
  card:       { backgroundColor: C.surface, borderRadius: 24, padding: 20, borderWidth: 1, borderColor: C.border, shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.28, shadowRadius: 20, elevation: 10 },
  roleTitle:  { fontSize: 22, fontWeight: '800', color: C.text, letterSpacing: -0.3, marginBottom: 4 },
  roleSub:    { fontSize: 13, color: C.textSec, lineHeight: 18 },
  footerMeta: { fontSize: 11, color: C.textMuted, textAlign: 'center', lineHeight: 17, marginTop: 24 },
  footerLink: { color: C.accent, fontWeight: '600' },
});
