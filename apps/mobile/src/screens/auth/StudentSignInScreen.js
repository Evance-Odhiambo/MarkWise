import React, { useMemo, useState, useRef, useLayoutEffect } from 'react';
import {
  Alert,
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Keyboard,
  BackHandler,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import LinearGradient from 'react-native-linear-gradient';
import { signInStudentAccount, registerPushToken } from '../../utils/studentAuthApi';
import { saveStudentSession } from '../../utils/authSession';
import { hasInternetConnection } from '../../utils/connectivity';
import { useEnrollment } from '../../context/EnrollmentContext';
import ConnectivityBanner from '../../components/ConnectivityBanner';
import useResponsive from '../../hooks/useResponsive';
import { useColors } from '../../theme';

export default function StudentSignInScreen({ navigation }) {
  useResponsive();
  const colors  = useColors();
  const C       = useMemo(() => ({
    accent:    colors.success.main,
    accentDk:  colors.success.dark,
    accentLt:  colors.success.light,
    bg:        colors.background.primary,
    bgSec:     colors.background.secondary,
    surface:   colors.surface.primary,
    inputBg:   colors.surface.tertiary,
    text:      colors.text.primary,
    textSec:   colors.text.secondary,
    textMuted: colors.text.muted,
    border:    colors.border.light,
    borderMed: colors.border.medium,
  }), [colors]);
  const styles  = useMemo(() => makeStyles(C), [C]);

  const [admissionNumberOrEmail, setAdmissionNumberOrEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const { rehydrateFromBackend } = useEnrollment();
  
  const emailInputRef = useRef(null);
  const passwordInputRef = useRef(null);

  // Hide header back button but keep gestures enabled
  useLayoutEffect(() => {
    navigation.setOptions({
      headerLeft: () => null,
      gestureEnabled: true,
    });
  }, [navigation]);

  // Hardware back handler fallback (works even if screen was opened with replace)
  useFocusEffect(
    React.useCallback(() => {
      const onBackPress = () => {
        if (navigation.canGoBack()) {
          navigation.goBack();
        } else {
          navigation.replace('RoleSelection');
        }
        return true; // we've handled it
      };

      const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
      return () => subscription.remove();
    }, [navigation])
  );

  const canSubmit = useMemo(
    () => admissionNumberOrEmail.trim().length > 0 && password.trim().length > 0,
    [admissionNumberOrEmail, password]
  );

  const identifierIcon = useMemo(
    () => admissionNumberOrEmail.includes('@') ? 'email-outline' : 'card-account-details-outline',
    [admissionNumberOrEmail]
  );

  const handleSignIn = async () => {
    const identifier = admissionNumberOrEmail.trim();
    if (password.trim().length < 6) {
      Alert.alert('Invalid password', 'Password must be at least 6 characters.');
      return;
    }
    const isConnected = await hasInternetConnection();
    if (!isConnected) {
      Alert.alert('No internet connection', 'Connect to the internet to sign in.');
      return;
    }
    setIsSigningIn(true);
    try {
      const payload = await signInStudentAccount({ admissionNumberOrEmail: identifier, password });
      const session = await saveStudentSession({ authPayload: payload, admissionNumberOrEmail: identifier, rememberMe });
      const profile = payload?.student || payload?.profile || payload?.user || {};
      registerPushToken().catch(() => {});
      try {
        await Promise.race([
          rehydrateFromBackend(),
          new Promise(resolve => setTimeout(resolve, 4000)),
        ]);
      } catch (_) {}
      navigation.replace('MainApp', {
        role: 'student',
        studentEmail: profile?.email || session?.studentEmail || (identifier.includes('@') ? identifier.toLowerCase() : ''),
        studentName: profile?.name || profile?.fullName || session?.studentName || '',
      });
    } catch (error) {
      Alert.alert('Sign in failed', error?.message || 'Unable to sign in.');
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleForgotPassword = () => {
    Alert.alert(
      'Reset Password',
      'Please contact your institution administrator to reset your password.',
      [{ text: 'OK' }]
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={[C.bg, C.bgSec]}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
      />

      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
        style={styles.keyboardView}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        <ScrollView 
          contentContainerStyle={styles.scrollContent} 
          showsVerticalScrollIndicator={false} 
          bounces={false}
          keyboardShouldPersistTaps="handled"
        >
          <TouchableOpacity onPress={() => {
            if (navigation?.canGoBack?.()) {
              navigation.goBack();
            } else {
              navigation.replace('RoleSelection');
            }
          }} style={styles.backButton}>
            <Icon name="arrow-left" size={22} color={C.text} />
          </TouchableOpacity>

          {/* Hero */}
          <View style={styles.hero}>
            <View style={styles.brandRow}>
              <LinearGradient
                colors={[C.accentDk, C.accent]}
                style={styles.brandIcon}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              >
                <Icon name="account-school" size={30} color="#fff" />
              </LinearGradient>
              <View>
                <Text style={styles.appName}>MarkWise</Text>
                <Text style={styles.roleLabel}>Student Portal</Text>
              </View>
            </View>

            <Text style={styles.heroTitle}>Welcome back</Text>
            <Text style={styles.heroSub}>Sign in to continue your academic journey</Text>
          </View>

          {/* Form Card */}
          <View style={styles.card}>
            <ConnectivityBanner
              message="You're offline. Connect to sign in."
              wrapperStyle={styles.offlineWrapper}
            />

            {/* Admission / Email */}
            <View style={styles.field}>
              <Text style={styles.label}>Admission Number or Email</Text>
              <View style={styles.inputRow}>
                <Icon
                  name={identifierIcon}
                  size={18}
                  color={C.textMuted}
                />
                <TextInput
                  ref={emailInputRef}
                  style={styles.textInput}
                  value={admissionNumberOrEmail}
                  onChangeText={setAdmissionNumberOrEmail}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  placeholder="SCB211-0156/2025 or you@mail.com"
                  placeholderTextColor={C.textMuted}
                  returnKeyType="next"
                  onSubmitEditing={() => { passwordInputRef.current?.focus(); }}
                  accessibilityLabel="Admission number or email"
                  accessibilityHint="Enter your student admission number or email address"
                />
              </View>
            </View>

            {/* Password */}
            <View style={styles.field}>
              <Text style={styles.label}>Password</Text>
              <View style={styles.inputRow}>
                <Icon
                  name="lock-outline"
                  size={18}
                  color={C.textMuted}
                />
                <TextInput
                  ref={passwordInputRef}
                  style={styles.textInput}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!isPasswordVisible}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="••••••••"
                  placeholderTextColor={C.textMuted}
                  returnKeyType="done"
                  onSubmitEditing={() => { handleSignIn(); Keyboard.dismiss(); }}
                  accessibilityLabel="Password"
                />
                <TouchableOpacity
                  onPress={() => setIsPasswordVisible(!isPasswordVisible)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={isPasswordVisible ? 'Hide password' : 'Show password'}
                >
                  <Icon name={isPasswordVisible ? 'eye-off-outline' : 'eye-outline'} size={18} color={C.textMuted} />
                </TouchableOpacity>
              </View>
            </View>

            {/* Options row */}
            <View style={styles.optionsRow}>
              <TouchableOpacity
                style={styles.checkRow}
                onPress={() => setRememberMe(!rememberMe)}
                activeOpacity={0.7}
                accessibilityRole="checkbox"
                accessibilityLabel="Remember me"
                accessibilityState={{ checked: rememberMe }}
              >
                <View style={[styles.checkbox, rememberMe && styles.checkboxActive]}>
                  {rememberMe && <Icon name="check" size={12} color="#fff" />}
                </View>
                <Text style={styles.rememberText}>Remember me</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleForgotPassword}
                accessibilityRole="button"
                accessibilityLabel="Forgot password"
              >
                <Text style={styles.forgotText}>Forgot password?</Text>
              </TouchableOpacity>
            </View>

            {/* Sign In Button */}
            <TouchableOpacity
              style={[styles.primaryBtn, (!canSubmit || isSigningIn) && styles.primaryBtnDisabled]}
              onPress={() => { handleSignIn(); Keyboard.dismiss(); }}
              disabled={!canSubmit || isSigningIn}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Sign in"
              accessibilityState={{ disabled: !canSubmit || isSigningIn, busy: isSigningIn }}
            >
              <LinearGradient
                colors={!canSubmit || isSigningIn ? [C.border, C.borderMed] : [C.accentDk, C.accent]}
                style={styles.primaryBtnGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
              >
                {isSigningIn ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <Text style={styles.primaryBtnText}>Sign In</Text>
                    <Icon name="arrow-right" size={18} color="#fff" />
                  </>
                )}
              </LinearGradient>
            </TouchableOpacity>

            {/* Divider */}
            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>New to MarkWise?</Text>
              <View style={styles.dividerLine} />
            </View>

            {/* Create Account */}
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => navigation.navigate('StudentSignUp')}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Sign up for a new account"
            >
              <Text style={styles.secondaryBtnText}>Sign Up</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (C) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  keyboardView: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingBottom: 36 },
  backButton: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 4,
  },

  hero: { paddingTop: 16, paddingHorizontal: 24, paddingBottom: 28 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 22 },
  brandIcon: {
    width: 62, height: 62, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: C.accentDk, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45, shadowRadius: 14, elevation: 8,
  },
  appName: {
    fontSize: 11, fontWeight: '700', color: C.accent,
    letterSpacing: 1.8, textTransform: 'uppercase',
  },
  roleLabel: { fontSize: 13, color: C.textSec, fontWeight: '500', marginTop: 2 },
  heroTitle: { fontSize: 32, fontWeight: '800', color: C.text, letterSpacing: -0.5, marginBottom: 6 },
  heroSub: { fontSize: 14, color: C.textSec, lineHeight: 21 },

  card: {
    marginHorizontal: 16, backgroundColor: C.surface, borderRadius: 24, padding: 22,
    shadowColor: '#000', shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35, shadowRadius: 24, elevation: 14,
    borderWidth: 1, borderColor: C.border,
  },
  offlineWrapper: { marginBottom: 16, borderRadius: 12, overflow: 'hidden' },

  field: { marginBottom: 16 },
  label: {
    fontSize: 11, fontWeight: '700', color: C.textSec,
    letterSpacing: 0.8, marginBottom: 8, textTransform: 'uppercase',
  },
  inputRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: C.inputBg, borderRadius: 14,
    borderWidth: 1.5, borderColor: C.border,
    paddingHorizontal: 14, paddingVertical: 13,
  },
  textInput: { flex: 1, fontSize: 15, color: C.text, fontWeight: '500', padding: 0, margin: 0 },

  optionsRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginTop: 4, marginBottom: 24,
  },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkbox: {
    width: 20, height: 20, borderRadius: 6,
    borderWidth: 1.5, borderColor: C.borderMed,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.inputBg,
  },
  checkboxActive: { backgroundColor: C.accent, borderColor: C.accent },
  rememberText: { fontSize: 13, color: C.textSec, fontWeight: '500' },
  forgotText: { fontSize: 13, color: C.accent, fontWeight: '600' },

  primaryBtn: {
    borderRadius: 16, overflow: 'hidden', marginBottom: 22,
    shadowColor: C.accentDk, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45, shadowRadius: 12, elevation: 7,
  },
  primaryBtnDisabled: { shadowOpacity: 0, elevation: 0 },
  primaryBtnGradient: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 8, paddingVertical: 16,
  },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: 0.3 },

  divider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  dividerLine: { flex: 1, height: 1, backgroundColor: C.border },
  dividerText: { fontSize: 12, color: C.textMuted, fontWeight: '500' },

  secondaryBtn: {
    borderRadius: 14, borderWidth: 1.5, borderColor: C.accent,
    paddingVertical: 13, alignItems: 'center',
  },
  secondaryBtnText: { color: C.accent, fontSize: 15, fontWeight: '700' },
});
