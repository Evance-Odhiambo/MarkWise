import React, { useMemo, useState, useRef, useCallback } from 'react';
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
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import LinearGradient from 'react-native-linear-gradient';
import { signInLecturerAccount } from '../../utils/lecturerAuthApi';
import { saveLecturerSession } from '../../utils/authSession';
import { hasInternetConnection } from '../../utils/connectivity';
import ConnectivityBanner from '../../components/ConnectivityBanner';
import useResponsive from '../../hooks/useResponsive';
import { useColors } from '../../theme';

export default function LecturerSignInScreen({ navigation }) {
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
    error:     colors.error?.main || '#E53935',
    success:   colors.success?.main || '#4CAF50',
  }), [colors]);
  const styles  = useMemo(() => makeStyles(C), [C]);

  // Form state
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [touchedFields, setTouchedFields] = useState({});

  // Refs
  const identifierRef = useRef(null);
  const passwordRef = useRef(null);
  const signInAbortController = useRef(null);

  // Simple validation without keyboard restrictions
  const validation = useMemo(() => {
    const trimmedIdentifier = identifier.trim();
    const isValidEmail = trimmedIdentifier.includes('@') && trimmedIdentifier.includes('.');
    const isValidPhone = trimmedIdentifier.length >= 10 && /^[\+]?[\d\s\-\(\)]+$/.test(trimmedIdentifier);
    const isValidIdentifier = trimmedIdentifier.length > 0 && (isValidEmail || isValidPhone);
    const isPasswordValid = password.length >= 6;
    
    return {
      identifierValid: isValidIdentifier,
      identifierError: !isValidIdentifier && trimmedIdentifier.length > 0 ? 
        'Please enter a valid email address or phone number' : null,
      passwordValid: isPasswordValid,
      passwordError: !isPasswordValid && password.length > 0 ? 
        'Password must be at least 6 characters' : null,
      canSubmit: isValidIdentifier && isPasswordValid,
    };
  }, [identifier, password]);

  const handleFieldBlur = useCallback((field) => {
    setTouchedFields(prev => ({ ...prev, [field]: true }));
  }, []);

  const handleSignIn = async () => {
    Keyboard.dismiss();
    
    setTouchedFields({ identifier: true, password: true });
    
    if (!validation.canSubmit) {
      Alert.alert(
        'Validation Error',
        validation.identifierError || validation.passwordError || 'Please check your inputs'
      );
      return;
    }
    
    const isConnected = await hasInternetConnection();
    if (!isConnected) {
      Alert.alert(
        'No Internet Connection',
        'Please check your connection and try again.',
        [
          { text: 'OK', style: 'cancel' },
          { 
            text: 'Open Settings', 
            onPress: () => Platform.OS === 'ios' ? Linking.openURL('app-settings:') : Linking.openSettings()
          }
        ]
      );
      return;
    }
    
    if (signInAbortController.current) {
      signInAbortController.current.abort();
    }
    signInAbortController.current = new AbortController();
    
    const timeoutId = setTimeout(() => {
      if (signInAbortController.current) {
        signInAbortController.current.abort();
        setIsSigningIn(false);
        Alert.alert('Timeout', 'Sign in is taking too long. Please try again.');
      }
    }, 30000);
    
    setIsSigningIn(true);
    const trimmedIdentifier = identifier.trim();
    
    try {
      const payload = await signInLecturerAccount({ 
        emailOrPhoneNumber: trimmedIdentifier, 
        password,
        signal: signInAbortController.current.signal 
      });
      
      clearTimeout(timeoutId);
      
      const session = await saveLecturerSession({ 
        authPayload: payload, 
        emailOrPhoneNumber: trimmedIdentifier, 
        rememberMe 
      });
      
      const profile = payload?.lecturer || payload?.profile || payload?.user || {};
      const lecturerName = profile?.fullName || profile?.name || session?.lecturerName || 'Lecturer';
      const lecturerEmail = profile?.email || session?.lecturerEmail || '';
      
      navigation.replace('LecturerApp', {
        lecturerName,
        lecturerEmail,
      });
    } catch (error) {
      clearTimeout(timeoutId);
      
      let errorMessage = 'Unable to sign in. Please try again.';
      let errorTitle = 'Sign In Failed';
      
      if (error.name === 'AbortError') {
        errorMessage = 'Request timed out. Please check your connection.';
      } else if (error.message?.includes('not found')) {
        errorMessage = 'No account found with these credentials. Please sign up first.';
        errorTitle = 'Account Not Found';
      } else if (error.message?.includes('password')) {
        errorMessage = 'Incorrect password. Please try again or reset your password.';
        errorTitle = 'Invalid Password';
      }
      
      Alert.alert(errorTitle, errorMessage, [
        { text: 'Try Again', style: 'default' },
        { text: 'Sign Up', style: 'cancel', onPress: () => navigation.navigate('LecturerSignUp') }
      ]);
    } finally {
      setIsSigningIn(false);
      signInAbortController.current = null;
    }
  };

  const identifierIcon = useMemo(() => {
    if (!identifier) return 'account-outline';
    if (identifier.includes('@')) return 'email-outline';
    if (/^[\+]?[\d\s\-\(\)]+$/.test(identifier) && identifier.length > 0) return 'phone-outline';
    return 'account-outline';
  }, [identifier]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <LinearGradient
        colors={[C.bg, C.bgSec]}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
      />

      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        <ScrollView 
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          bounces={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Hero Section */}
          <View style={styles.hero}>
            <View style={styles.brandRow}>
              <LinearGradient
                colors={[C.accentDk, C.accent]}
                style={styles.brandIcon}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              >
                <Icon name="school" size={32} color="#fff" />
              </LinearGradient>
              <View>
                <Text style={styles.appName}>MarkWise</Text>
                <Text style={styles.roleLabel}>Lecturer Portal</Text>
              </View>
            </View>

            <Text style={styles.heroTitle}>Welcome back, Educator</Text>
            <Text style={styles.heroSub}>Manage courses, attendance and student progress</Text>
          </View>

          {/* Form Card */}
          <View style={styles.card}>
            <ConnectivityBanner
              message="You're offline. Connect to sign in."
              wrapperStyle={styles.offlineWrapper}
            />

            {/* Email/Phone Input - Using default keyboard for flexibility */}
            <View style={styles.field}>
              <Text style={styles.label}>
                Email or Phone Number
                <Text style={styles.requiredStar}> *</Text>
              </Text>
              <View style={[
                styles.inputRow,
                touchedFields.identifier && validation.identifierError && styles.inputRowError
              ]}>
                <Icon
                  name={identifierIcon}
                  size={20}
                  color={touchedFields.identifier && validation.identifierError ? C.error : 
                         touchedFields.identifier && validation.identifierValid ? C.success : C.textMuted}
                />
                <TextInput
                  ref={identifierRef}
                  style={styles.textInput}
                  value={identifier}
                  onChangeText={setIdentifier}
                  onBlur={() => handleFieldBlur('identifier')}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="off"
                  keyboardType="default"
                  placeholder="Email or Phone Number"
                  placeholderTextColor={C.textMuted}
                  returnKeyType="next"
                  onSubmitEditing={() => passwordRef.current?.focus()}
                  editable={!isSigningIn}
                  blurOnSubmit={false}
                  accessibilityLabel="Email or phone number"
                  accessibilityHint="Enter your institutional email or registered phone number"
                />
                {touchedFields.identifier && validation.identifierValid && (
                  <Icon name="check-circle" size={18} color={C.success} />
                )}
              </View>
              {touchedFields.identifier && validation.identifierError && (
                <Text style={styles.errorText}>{validation.identifierError}</Text>
              )}
              <Text style={styles.hintText}>
                Use your institutional email or registered phone number
              </Text>
            </View>

            {/* Password Input */}
            <View style={styles.field}>
              <Text style={styles.label}>
                Password
                <Text style={styles.requiredStar}> *</Text>
              </Text>
              <View style={[
                styles.inputRow,
                touchedFields.password && validation.passwordError && styles.inputRowError
              ]}>
                <Icon
                  name="lock-outline"
                  size={20}
                  color={touchedFields.password && validation.passwordError ? C.error : C.textMuted}
                />
                <TextInput
                  ref={passwordRef}
                  style={styles.textInput}
                  value={password}
                  onChangeText={setPassword}
                  onBlur={() => handleFieldBlur('password')}
                  secureTextEntry={!isPasswordVisible}
                  placeholder="••••••••"
                  placeholderTextColor={C.textMuted}
                  returnKeyType="go"
                  onSubmitEditing={handleSignIn}
                  editable={!isSigningIn}
                  blurOnSubmit={false}
                  accessibilityLabel="Password"
                />
                <TouchableOpacity
                  onPress={() => setIsPasswordVisible(!isPasswordVisible)}
                  activeOpacity={0.7}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  accessibilityRole="button"
                  accessibilityLabel={isPasswordVisible ? 'Hide password' : 'Show password'}
                >
                  <Icon
                    name={isPasswordVisible ? 'eye-off-outline' : 'eye-outline'}
                    size={20}
                    color={C.textMuted}
                  />
                </TouchableOpacity>
              </View>
              {touchedFields.password && validation.passwordError && (
                <Text style={styles.errorText}>{validation.passwordError}</Text>
              )}
            </View>

            {/* Options Row */}
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
                accessibilityRole="button"
                accessibilityLabel="Forgot password"
                onPress={() => {
                Keyboard.dismiss();
                Alert.alert(
                  'Reset Password',
                  'Please contact your institution administrator to reset your password.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Email Support',
                      onPress: () => Linking.openURL('mailto:support@markwise.com?subject=Password Reset Request'),
                    },
                  ]
                );
              }}>
                <Text style={styles.forgotText}>Forgot password?</Text>
              </TouchableOpacity>
            </View>

            {/* Sign In Button */}
            <TouchableOpacity
              style={[
                styles.primaryBtn,
                (!validation.canSubmit || isSigningIn) && styles.primaryBtnDisabled,
              ]}
              onPress={handleSignIn}
              disabled={!validation.canSubmit || isSigningIn}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Sign in"
              accessibilityState={{ disabled: !validation.canSubmit || isSigningIn, busy: isSigningIn }}
            >
              <LinearGradient
                colors={!validation.canSubmit || isSigningIn ? [C.border, C.borderMed] : [C.accentDk, C.accent]}
                style={styles.primaryBtnGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
              >
                {isSigningIn ? (
                  <>
                    <ActivityIndicator color="#fff" size="small" />
                    <Text style={styles.primaryBtnText}>Signing In...</Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.primaryBtnText}>Sign In</Text>
                    <Icon name="arrow-right" size={20} color="#fff" />
                  </>
                )}
              </LinearGradient>
            </TouchableOpacity>

            {/* Sign Up Link */}
            <View style={styles.signUpRow}>
              <Text style={styles.signUpHint}>Don't have an account?</Text>
              <TouchableOpacity onPress={() => navigation.navigate('LecturerSignUp')}>
                <Text style={styles.signUpLink}>Sign Up</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (C) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg
  },
  keyboardView: { 
    flex: 1 
  },
  scrollContent: { 
    flexGrow: 1, 
    paddingBottom: 40 
  },
  hero: { 
    paddingTop: 40, 
    paddingHorizontal: 24, 
    paddingBottom: 32 
  },
  brandRow: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    gap: 14, 
    marginBottom: 24 
  },
  brandIcon: {
    width: 64, 
    height: 64, 
    borderRadius: 20,
    alignItems: 'center', 
    justifyContent: 'center',
    shadowColor: C.accentDk, 
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3, 
    shadowRadius: 12, 
    elevation: 8,
  },
  appName: {
    fontSize: 12, 
    fontWeight: '800', 
    color: C.accent,
    letterSpacing: 2, 
    textTransform: 'uppercase',
  },
  roleLabel: { 
    fontSize: 14, 
    color: C.textSec, 
    fontWeight: '600', 
    marginTop: 2 
  },
  heroTitle: { 
    fontSize: 34, 
    fontWeight: '800', 
    color: C.text, 
    letterSpacing: -0.5, 
    marginBottom: 8,
    lineHeight: 40,
  },
  heroSub: { 
    fontSize: 15, 
    color: C.textSec, 
    lineHeight: 22,
    opacity: 0.9,
  },
  card: {
    marginHorizontal: 20, 
    backgroundColor: C.surface, 
    borderRadius: 28, 
    padding: 24,
    shadowColor: '#000', 
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.25, 
    shadowRadius: 32, 
    elevation: 16,
    borderWidth: 1, 
    borderColor: C.border,
  },
  offlineWrapper: {
    marginBottom: 20, 
    borderRadius: 12, 
    overflow: 'hidden' 
  },
  field: { 
    marginBottom: 20 
  },
  label: {
    fontSize: 12, 
    fontWeight: '700', 
    color: C.textSec,
    letterSpacing: 0.8, 
    marginBottom: 8, 
    textTransform: 'uppercase',
  },
  requiredStar: {
    color: C.error,
    fontSize: 12,
  },
  inputRow: {
    flexDirection: 'row', 
    alignItems: 'center', 
    gap: 12,
    backgroundColor: C.inputBg, 
    borderRadius: 16,
    borderWidth: 1.5, 
    borderColor: C.border,
    paddingHorizontal: 16, 
    paddingVertical: 14,
  },
  inputRowError: {
    borderColor: C.error,
    backgroundColor: `${C.error}08`,
  },
  textInput: { 
    flex: 1, 
    fontSize: 16, 
    color: C.text, 
    fontWeight: '500', 
    padding: 0,
    margin: 0,
  },
  errorText: {
    fontSize: 12,
    color: C.error,
    marginTop: 6,
    marginLeft: 4,
  },
  hintText: {
    fontSize: 11,
    color: C.textMuted,
    marginTop: 6,
    marginLeft: 4,
  },
  optionsRow: {
    flexDirection: 'row', 
    justifyContent: 'space-between',
    alignItems: 'center', 
    marginTop: 8, 
    marginBottom: 28,
  },
  checkRow: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    gap: 10 
  },
  checkbox: {
    width: 20, 
    height: 20, 
    borderRadius: 6,
    borderWidth: 2, 
    borderColor: C.borderMed,
    alignItems: 'center', 
    justifyContent: 'center',
    backgroundColor: C.inputBg,
  },
  checkboxActive: { 
    backgroundColor: C.accent, 
    borderColor: C.accent 
  },
  rememberText: { 
    fontSize: 14, 
    color: C.textSec, 
    fontWeight: '500' 
  },
  forgotText: { 
    fontSize: 14, 
    color: C.accent, 
    fontWeight: '600' 
  },
  primaryBtn: {
    borderRadius: 18, 
    overflow: 'hidden', 
    marginBottom: 20,
    shadowColor: C.accentDk, 
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35, 
    shadowRadius: 16, 
    elevation: 8,
  },
  primaryBtnDisabled: { 
    shadowOpacity: 0, 
    elevation: 0 
  },
  primaryBtnGradient: {
    flexDirection: 'row', 
    alignItems: 'center',
    justifyContent: 'center', 
    gap: 10, 
    paddingVertical: 16,
  },
  primaryBtnText: { 
    color: '#fff', 
    fontSize: 17, 
    fontWeight: '700', 
    letterSpacing: 0.5 
  },
  signUpRow: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'center', 
    gap: 8,
    paddingTop: 8,
  },
  signUpHint: { 
    fontSize: 14, 
    color: C.textMuted 
  },
  signUpLink: { 
    fontSize: 14, 
    color: C.accent, 
    fontWeight: '700' 
  },
});