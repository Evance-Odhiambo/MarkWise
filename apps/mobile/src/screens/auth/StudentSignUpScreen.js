import React, { useEffect, useMemo, useRef, useState, useLayoutEffect } from 'react';
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
  Modal,
  Keyboard,
  BackHandler,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import LinearGradient from 'react-native-linear-gradient';
import { signUpStudentAccount, verifyStudentAdmissionNumber } from '../../utils/studentAuthApi';
import { fetchInstitutions } from '../../utils/lecturerAuthApi';
import { hasInternetConnection } from '../../utils/connectivity';
import ConnectivityBanner from '../../components/ConnectivityBanner';
import useResponsive from '../../hooks/useResponsive';
import { useColors } from '../../theme';

const ADMISSION_NUMBER_REGEX = /^[A-Z]{3}\d{3}-\d{4}\/\d{4}$/;

const formatAdmissionNumber = (text) => {
  const clean = text.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 14);
  let result = '';
  for (let i = 0; i < clean.length; i++) {
    if (i === 6) result += '-';
    if (i === 10) result += '/';
    result += clean[i];
  }
  return result;
};

export default function StudentSignUpScreen({ navigation }) {
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
    success:   colors.success.main,
    successDk: colors.success.dark,
    danger:    colors.danger.main,
    warning:   colors.warning.main,
  }), [colors]);
  const styles  = useMemo(() => makeStyles(C), [C]);

  // Hide header back button but keep gestures enabled
  useLayoutEffect(() => {
    navigation.setOptions({
      headerLeft: () => null,
      gestureEnabled: true,
    });
  }, [navigation]);

  // Hardware back handler fallback
  useFocusEffect(
    React.useCallback(() => {
      const onBackPress = () => {
        if (navigation.canGoBack()) {
          navigation.goBack();
        } else {
          navigation.replace('RoleSelection');
        }
        return true;
      };

      const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
      return () => subscription.remove();
    }, [navigation])
  );

  const [admissionNumber, setAdmissionNumber] = useState('');
  const [fullName, setFullName] = useState('');
  const [courseId, setCourseId] = useState('');
  const [courseName, setCourseName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isConfirmPasswordVisible, setIsConfirmPasswordVisible] = useState(false);
  const [isVerifyingStudent, setIsVerifyingStudent] = useState(false);
  const [isStudentVerified, setIsStudentVerified] = useState(false);
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);
  const [institutions, setInstitutions] = useState([]);
  const [institutionId, setInstitutionId] = useState('');
  const [isLoadingInstitutions, setIsLoadingInstitutions] = useState(true);
  const [campuses, setCampuses] = useState([]);
  const [campusId, setCampusId] = useState('');
  const [isLoadingCampuses, setIsLoadingCampuses] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [showCampusModal, setShowCampusModal] = useState(false);
  
  const lastVerifiedAdmissionRef = useRef('');

  // Refs
  const admissionInputRef = useRef(null);
  const emailInputRef = useRef(null);
  const passwordInputRef = useRef(null);
  const confirmPasswordInputRef = useRef(null);

  useEffect(() => {
    async function loadInstitutions() {
      try {
        const data = await fetchInstitutions();
        setInstitutions(Array.isArray(data) ? data : []);
      } catch {
        setInstitutions([]);
      } finally {
        setIsLoadingInstitutions(false);
      }
    }
    loadInstitutions();
  }, []);

  // Load campuses when institution is selected
  useEffect(() => {
    async function loadCampuses() {
      if (!institutionId) {
        setCampuses([]);
        setCampusId('');
        return;
      }
      
      setIsLoadingCampuses(true);
      try {
        const baseUrl = await import('../../utils/unitsApi').then(m => m.resolveApiBaseUrl());
        const response = await fetch(`${baseUrl}/api/institution/${institutionId}/campuses`);
        const data = await response.json();
        setCampuses(Array.isArray(data) ? data : (data.campuses || data.data || []));
      } catch (error) {
        console.error('Failed to load campuses:', error);
        setCampuses([]);
      } finally {
        setIsLoadingCampuses(false);
      }
    }
    loadCampuses();
  }, [institutionId]);

  const canSubmit = useMemo(() => (
    admissionNumber.trim().length > 0 &&
    isStudentVerified &&
    fullName.trim().length > 0 &&
    email.trim().length > 0 &&
    password.trim().length > 0 &&
    confirmPassword.trim().length > 0 &&
    institutionId.trim().length > 0 &&
    campusId.trim().length > 0
  ), [admissionNumber, isStudentVerified, fullName, email, password, confirmPassword, institutionId, campusId]);

  const handleVerifyStudent = async ({ silent = false, admissionOverride } = {}) => {
    const normalizedAdmissionNumber = String(admissionOverride ?? admissionNumber).trim().toUpperCase();
    if (normalizedAdmissionNumber === lastVerifiedAdmissionRef.current && isStudentVerified) return;
    if (!normalizedAdmissionNumber) {
      if (!silent) Alert.alert('Admission number required', 'Enter your admission number first.');
      return;
    }
    if (!institutionId) {
      if (!silent) Alert.alert('Institution required', 'Please select your institution first.');
      return;
    }
    const isConnected = await hasInternetConnection();
    if (!isConnected) {
      if (!silent) Alert.alert('No internet connection', 'Connect to the internet to verify.');
      return;
    }
    setIsVerifyingStudent(true);
    try {
      const result = await verifyStudentAdmissionNumber(normalizedAdmissionNumber, institutionId);
      setAdmissionNumber(result.admissionNumber);
      setFullName(result.fullName);
      setCourseId(result?.course?.id || '');
      setCourseName(result.courseName || '');
      setIsStudentVerified(true);
      lastVerifiedAdmissionRef.current = result.admissionNumber;
    } catch (error) {
      setIsStudentVerified(false);
      setFullName('');
      setCourseId('');
      setCourseName('');
      lastVerifiedAdmissionRef.current = '';
      if (!silent) Alert.alert('Verification failed', error?.message || 'Unable to verify student details.');
    } finally {
      setIsVerifyingStudent(false);
    }
  };

  const handleAdmissionNumberChange = (value) => {
    const formatted = formatAdmissionNumber(value);
    setAdmissionNumber(formatted);
    
    if (isStudentVerified || lastVerifiedAdmissionRef.current !== '') {
      setIsStudentVerified(false);
      setFullName('');
      setCourseId('');
      setCourseName('');
      lastVerifiedAdmissionRef.current = '';
    }
  };

  useEffect(() => {
    if (!ADMISSION_NUMBER_REGEX.test(admissionNumber)) return;
    if (!institutionId) return;
    const timer = setTimeout(() => {
      handleVerifyStudent({ silent: true, admissionOverride: admissionNumber });
    }, 700);
    return () => clearTimeout(timer);
  }, [admissionNumber, institutionId]);

  const handleSignUp = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedAdmissionNumber = admissionNumber.trim().toUpperCase();
    
    if (!ADMISSION_NUMBER_REGEX.test(normalizedAdmissionNumber)) {
      Alert.alert('Invalid admission number', 'Use format like SCB211-0156/2025.');
      return;
    }
    if (!isStudentVerified) {
      Alert.alert('Verification required', 'Verify your admission number first.');
      return;
    }
    if (!String(courseId || '').trim()) {
      Alert.alert('Course required', 'No course mapping found. Contact support or try again.');
      return;
    }
    if (fullName.trim().length < 3) {
      Alert.alert('Invalid name', 'Please enter your full name.');
      return;
    }
    if (!normalizedEmail.includes('@')) {
      Alert.alert('Invalid email', 'Please enter a valid email address.');
      return;
    }
    if (password.trim().length < 6) {
      Alert.alert('Weak password', 'Password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert('Password mismatch', 'Passwords do not match.');
      return;
    }
    const isConnected = await hasInternetConnection();
    if (!isConnected) {
      Alert.alert('No internet connection', 'Connect to the internet to sign up.');
      return;
    }
    setIsCreatingAccount(true);
    try {
      await signUpStudentAccount({ 
        admissionNumber: normalizedAdmissionNumber, 
        courseId, 
        email: normalizedEmail, 
        password, 
        institutionId,
        campusId 
      });
      Alert.alert('Account created!', 'Your student account is ready. Please sign in.', [
        { text: 'Sign In', onPress: () => navigation.replace('StudentSignIn') },
      ]);
    } catch (error) {
      Alert.alert('Sign up failed', error?.message || 'Unable to create account.');
    } finally {
      setIsCreatingAccount(false);
    }
  };

  const passwordsMatch = password && confirmPassword && password === confirmPassword;
  const passwordsMismatch = password && confirmPassword && password !== confirmPassword;
  
  const selectedInstitutionName = institutions.find(inst => inst.id === institutionId)?.name;

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

          {/* Hero */}
          <View style={styles.hero}>
            <View style={styles.brandRow}>
              <LinearGradient
                colors={[C.accentDk, C.accent]}
                style={styles.brandIcon}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              >
                <Icon name="account-school" size={28} color="#fff" />
              </LinearGradient>
              <View>
                <Text style={styles.appName}>MarkWise</Text>
                <Text style={styles.roleLabel}>Student Portal</Text>
              </View>
            </View>

            <Text style={styles.heroTitle}>Create Account</Text>
            <Text style={styles.heroSub}>Join your institution's student portal</Text>
          </View>

          {/* Offline Banner */}
          <ConnectivityBanner
            message="You're offline. Verification and sign up require internet."
            wrapperStyle={styles.offlineWrapper}
          />

          {/* Form Card */}
          <View style={styles.card}>

            {/* Institution Selector */}
            <View style={styles.field}>
              <Text style={styles.label}>Institution</Text>
              <TouchableOpacity
                style={styles.inputRow}
                onPress={() => setShowModal(true)}
                activeOpacity={0.7}
              >
                <Icon name="domain" size={18} color={institutionId ? C.accent : C.textMuted} />
                <Text style={[styles.textInput, !institutionId && { color: C.textMuted }]}>
                  {isLoadingInstitutions 
                    ? 'Loading institutions...' 
                    : (selectedInstitutionName || 'Select your institution')}
                </Text>
                <Icon name="chevron-down" size={18} color={C.textMuted} />
              </TouchableOpacity>
            </View>

            {/* Campus Selector */}
            {institutionId && (
              <View style={styles.field}>
                <Text style={styles.label}>Campus</Text>
                <TouchableOpacity
                  style={styles.inputRow}
                  onPress={() => setShowCampusModal(true)}
                  activeOpacity={0.7}
                  disabled={isLoadingCampuses || campuses.length === 0}
                >
                  <Icon name="map-marker" size={18} color={campusId ? C.accent : C.textMuted} />
                  <Text style={[styles.textInput, !campusId && { color: C.textMuted }]}>
                    {isLoadingCampuses 
                      ? 'Loading campuses...' 
                      : (campuses.find(c => c.id === campusId)?.name || 'Select your campus')}
                  </Text>
                  <Icon name="chevron-down" size={18} color={C.textMuted} />
                </TouchableOpacity>
                {!isLoadingCampuses && campuses.length === 0 && (
                  <Text style={styles.errorText}>No campuses found. Please contact your institution administrator.</Text>
                )}
              </View>
            )}

            {/* Admission Number */}
            <View style={styles.field}>
              <Text style={styles.label}>Admission Number</Text>
              
              {/* Format Guide */}
              <View style={styles.formatGuide}>
                <View style={styles.formatHeader}>
                  <Icon name="information-outline" size={13} color={C.accent} />
                  <Text style={styles.formatTitle}>Format guide</Text>
                  <View style={styles.autoCapsBadge}>
                    <Text style={styles.autoCapsText}>AUTO-CAPS</Text>
                  </View>
                </View>
                <View style={styles.formatRow}>
                  <View style={styles.formatSegment}>
                    <Text style={styles.formatSegText}>SCB</Text>
                    <Text style={styles.formatSegLabel}>Program</Text>
                  </View>
                  <View style={styles.formatSegment}>
                    <Text style={styles.formatSegText}>211</Text>
                    <Text style={styles.formatSegLabel}>Cohort</Text>
                  </View>
                  <Text style={styles.formatSep}>-</Text>
                  <View style={styles.formatSegment}>
                    <Text style={styles.formatSegText}>0156</Text>
                    <Text style={styles.formatSegLabel}>Student No.</Text>
                  </View>
                  <Text style={styles.formatSep}>/</Text>
                  <View style={styles.formatSegment}>
                    <Text style={styles.formatSegText}>2025</Text>
                    <Text style={styles.formatSegLabel}>Year</Text>
                  </View>
                </View>
              </View>

              <View style={styles.inputRow}>
                <Icon
                  name="card-account-details-outline"
                  size={18}
                  color={C.textMuted}
                />
                <TextInput
                  ref={admissionInputRef}
                  style={styles.textInput}
                  value={admissionNumber}
                  onChangeText={handleAdmissionNumberChange}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  placeholder="SCB211-0156/2025"
                  placeholderTextColor={C.textMuted}
                  returnKeyType="next"
                  onSubmitEditing={() => {
                    if (institutionId && ADMISSION_NUMBER_REGEX.test(admissionNumber)) {
                      handleVerifyStudent({ silent: false });
                    } else if (!institutionId) {
                      Alert.alert('Select institution first', 'Please choose your institution before verifying.');
                    }
                  }}
                />
                {isVerifyingStudent && <ActivityIndicator color={C.accent} size="small" />}
                {!isVerifyingStudent && isStudentVerified && (
                  <Icon name="check-circle" size={18} color={C.success} />
                )}
                {!isVerifyingStudent && !isStudentVerified && ADMISSION_NUMBER_REGEX.test(admissionNumber) && institutionId && (
                  <TouchableOpacity
                    style={styles.verifyBtn}
                    onPress={() => handleVerifyStudent({ silent: false })}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.verifyBtnText}>Verify</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Verification Status */}
              <View style={styles.verifyStatusRow}>
                <View style={[styles.verifyDot, isStudentVerified && styles.verifyDotActive]} />
                <Text style={[styles.verifyStatusText, isStudentVerified && styles.verifyStatusActive]}>
                  {isStudentVerified
                    ? '✓ Student verified'
                    : !institutionId
                      ? 'Select institution first'
                      : admissionNumber.length > 0 && !ADMISSION_NUMBER_REGEX.test(admissionNumber)
                      ? 'Enter complete admission number'
                      : 'Enter admission number to verify'}
                </Text>
              </View>
            </View>

            {/* Full Name */}
            <View style={styles.field}>
              <Text style={styles.label}>Full Name</Text>
              <View style={[styles.inputRow, isStudentVerified && styles.inputRowLocked]}>
                <Icon
                  name="account-outline"
                  size={18}
                  color={isStudentVerified ? C.success : C.textMuted}
                />
                <TextInput
                  style={styles.textInput}
                  value={fullName}
                  onChangeText={setFullName}
                  placeholder="Auto-filled after verification"
                  placeholderTextColor={C.textMuted}
                  editable={!isStudentVerified}
                  autoCorrect={false}
                  returnKeyType="next"
                  onSubmitEditing={() => {
                    emailInputRef.current?.focus();
                  }}
                />
                {isStudentVerified && <Icon name="lock" size={14} color={C.textMuted} />}
              </View>
            </View>

            {/* Course */}
            <View style={styles.field}>
              <Text style={styles.label}>Course</Text>
              <View style={[styles.inputRow, styles.inputRowLocked]}>
                <Icon name="book-open-outline" size={18} color={courseName ? C.success : C.textMuted} />
                <Text style={[styles.textInput, !courseName && { color: C.textMuted }]}>
                  {courseName || 'Auto-filled after verification'}
                </Text>
                {courseName && <Icon name="check-circle" size={16} color={C.success} />}
              </View>
            </View>

            {/* Email */}
            <View style={styles.field}>
              <Text style={styles.label}>Email Address</Text>
              <View style={styles.inputRow}>
                <Icon
                  name="email-outline"
                  size={18}
                  color={C.textMuted}
                />
                <TextInput
                  ref={emailInputRef}
                  style={styles.textInput}
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  placeholder="your.email@example.com"
                  placeholderTextColor={C.textMuted}
                  returnKeyType="next"
                  onSubmitEditing={() => {
                    passwordInputRef.current?.focus();
                  }}
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
                  placeholder="Minimum 6 characters"
                  placeholderTextColor={C.textMuted}
                  returnKeyType="next"
                  onSubmitEditing={() => {
                    confirmPasswordInputRef.current?.focus();
                  }}
                />
                <TouchableOpacity onPress={() => setIsPasswordVisible(!isPasswordVisible)} activeOpacity={0.7}>
                  <Icon name={isPasswordVisible ? 'eye-off-outline' : 'eye-outline'} size={18} color={C.textMuted} />
                </TouchableOpacity>
              </View>
            </View>

            {/* Confirm Password */}
            <View style={styles.field}>
              <Text style={styles.label}>Confirm Password</Text>
              <View style={styles.inputRow}>
                <Icon
                  name="lock-check-outline"
                  size={18}
                  color={C.textMuted}
                />
                <TextInput
                  ref={confirmPasswordInputRef}
                  style={styles.textInput}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry={!isConfirmPasswordVisible}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="Repeat password"
                  placeholderTextColor={C.textMuted}
                  returnKeyType="done"
                  onSubmitEditing={() => {
                    handleSignUp();
                    Keyboard.dismiss();
                  }}
                />
                <TouchableOpacity onPress={() => setIsConfirmPasswordVisible(!isConfirmPasswordVisible)} activeOpacity={0.7}>
                  <Icon name={isConfirmPasswordVisible ? 'eye-off-outline' : 'eye-outline'} size={18} color={C.textMuted} />
                </TouchableOpacity>
              </View>
              {(passwordsMatch || passwordsMismatch) && (
                <View style={styles.hintRow}>
                  <Icon
                    name={passwordsMatch ? 'check-circle-outline' : 'close-circle-outline'}
                    size={13}
                    color={passwordsMatch ? C.success : C.danger}
                  />
                  <Text style={[styles.hintText, { color: passwordsMatch ? C.success : C.danger }]}>
                    {passwordsMatch ? 'Passwords match' : 'Passwords do not match'}
                  </Text>
                </View>
              )}
            </View>

            {/* Create Account Button */}
            <TouchableOpacity
              style={[styles.primaryBtn, (!canSubmit || isCreatingAccount) && styles.primaryBtnDisabled]}
              onPress={() => {
                handleSignUp();
                Keyboard.dismiss();
              }}
              disabled={!canSubmit || isCreatingAccount}
              activeOpacity={0.85}
            >
              <LinearGradient
                colors={!canSubmit || isCreatingAccount ? [C.border, C.borderMed] : [C.accentDk, C.accent]}
                style={styles.primaryBtnGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
              >
                {isCreatingAccount ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <Text style={styles.primaryBtnText}>Create Account</Text>
                    <Icon name="arrow-right" size={18} color="#fff" />
                  </>
                )}
              </LinearGradient>
            </TouchableOpacity>

            {/* Sign In link */}
            <View style={styles.signInRow}>
              <Text style={styles.signInHint}>Already have an account?</Text>
              <TouchableOpacity onPress={() => navigation.navigate('StudentSignIn')} activeOpacity={0.7}>
                <Text style={styles.signInLink}>Sign In</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Institution Picker Modal */}
      <Modal
        visible={showModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Institution</Text>
              <TouchableOpacity onPress={() => setShowModal(false)}>
                <Icon name="close" size={24} color={C.text} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalList}>
              {institutions.map(inst => (
                <TouchableOpacity
                  key={inst.id}
                  style={[
                    styles.modalItem,
                    institutionId === inst.id && styles.modalItemSelected
                  ]}
                  onPress={() => {
                    setInstitutionId(inst.id);
                    setCampusId(''); // Reset campus when institution changes
                    if (isStudentVerified) {
                      setIsStudentVerified(false);
                      setFullName('');
                      setCourseId('');
                      setCourseName('');
                      lastVerifiedAdmissionRef.current = '';
                    }
                    setShowModal(false);
                  }}
                >
                  <Text style={[
                    styles.modalItemText,
                    institutionId === inst.id && styles.modalItemTextSelected
                  ]}>
                    {inst.name}
                  </Text>
                  {institutionId === inst.id && (
                    <Icon name="check" size={18} color={C.accent} />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Campus Picker Modal */}
      <Modal
        visible={showCampusModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowCampusModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Campus</Text>
              <TouchableOpacity onPress={() => setShowCampusModal(false)}>
                <Icon name="close" size={24} color={C.text} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalList}>
              {campuses.map(campus => (
                <TouchableOpacity
                  key={campus.id}
                  style={[
                    styles.modalItem,
                    campusId === campus.id && styles.modalItemSelected
                  ]}
                  onPress={() => {
                    setCampusId(campus.id);
                    setShowCampusModal(false);
                  }}
                >
                  <Text style={[
                    styles.modalItemText,
                    campusId === campus.id && styles.modalItemTextSelected
                  ]}>
                    {campus.name}
                  </Text>
                  {campusId === campus.id && (
                    <Icon name="check" size={18} color={C.accent} />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = (C) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  keyboardView: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingBottom: 36 },

  hero: { paddingTop: 16, paddingHorizontal: 24, paddingBottom: 24 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 20 },
  brandIcon: {
    width: 60, height: 60, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: C.accentDk, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45, shadowRadius: 14, elevation: 8,
  },
  appName: {
    fontSize: 11, fontWeight: '700', color: C.accent,
    letterSpacing: 1.8, textTransform: 'uppercase',
  },
  roleLabel: { fontSize: 13, color: C.textSec, fontWeight: '500', marginTop: 2 },
  heroTitle: { fontSize: 30, fontWeight: '800', color: C.text, letterSpacing: -0.5, marginBottom: 6 },
  heroSub: { fontSize: 14, color: C.textSec, lineHeight: 21 },

  offlineWrapper: { marginHorizontal: 16, marginBottom: 12, borderRadius: 12, overflow: 'hidden' },

  card: {
    marginHorizontal: 16, backgroundColor: C.surface, borderRadius: 24, padding: 22,
    shadowColor: '#000', shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35, shadowRadius: 24, elevation: 14,
    borderWidth: 1, borderColor: C.border,
  },

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
  inputRowLocked: { opacity: 0.7, backgroundColor: C.bg },
  textInput: { flex: 1, fontSize: 15, color: C.text, fontWeight: '500', padding: 0, margin: 0 },
  errorText: { fontSize: 12, color: C.danger, marginTop: 6, marginLeft: 4 },

  formatGuide: {
    backgroundColor: C.bg, borderRadius: 12, padding: 12,
    marginBottom: 10, borderWidth: 1, borderColor: C.border,
  },
  formatHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  formatTitle: { flex: 1, fontSize: 12, color: C.textSec, fontWeight: '600' },
  autoCapsBadge: {
    backgroundColor: C.accentDk, paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 4,
  },
  autoCapsText: { fontSize: 9, color: '#fff', fontWeight: '800', letterSpacing: 0.5 },
  formatRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 0, flexWrap: 'wrap' },
  formatSegment: {
    alignItems: 'center', backgroundColor: C.surface,
    borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4,
  },
  formatSegText: { fontSize: 13, fontWeight: '700', color: C.text },
  formatSegLabel: { fontSize: 9, color: C.textMuted, fontWeight: '500', marginTop: 1 },
  formatSep: { fontSize: 16, fontWeight: '700', color: C.accent, marginHorizontal: 2 },

  verifyBtn: {
    backgroundColor: C.accent, paddingHorizontal: 12,
    paddingVertical: 6, borderRadius: 8,
  },
  verifyBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  hintRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  hintText: { fontSize: 12, color: C.textMuted, fontWeight: '500', flex: 1 },

  verifyStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 8 },
  verifyDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: C.borderMed,
  },
  verifyDotActive: { backgroundColor: C.success },
  verifyStatusText: { fontSize: 12, color: C.textMuted, fontWeight: '500' },
  verifyStatusActive: { color: C.success, fontWeight: '600' },

  primaryBtn: {
    borderRadius: 16, overflow: 'hidden', marginBottom: 20, marginTop: 6,
    shadowColor: C.accentDk, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45, shadowRadius: 12, elevation: 7,
  },
  primaryBtnDisabled: { shadowOpacity: 0, elevation: 0 },
  primaryBtnGradient: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 8, paddingVertical: 16,
  },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: 0.3 },

  signInRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  signInHint: { fontSize: 13, color: C.textMuted },
  signInLink: { fontSize: 13, color: C.accent, fontWeight: '700' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: C.surface, maxHeight: '60%', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 12 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  modalTitle: { fontSize: 16, fontWeight: '700', color: C.text },
  modalList: { marginTop: 8 },
  modalItem: { paddingVertical: 12, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalItemSelected: { backgroundColor: C.inputBg, borderRadius: 8 },
  modalItemText: { fontSize: 14, color: C.text },
  modalItemTextSelected: { color: C.accent, fontWeight: '700' },
});
