import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
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
  Modal,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import LinearGradient from 'react-native-linear-gradient';
import { signUpLecturerAccount, fetchInstitutions } from '../../utils/lecturerAuthApi';
import { hasInternetConnection } from '../../utils/connectivity';
import ConnectivityBanner from '../../components/ConnectivityBanner';
import useResponsive from '../../hooks/useResponsive';
import { useColors } from '../../theme';

export default function LecturerSignUpScreen({ navigation }) {
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
    danger:    colors.danger.main,
    warning:   colors.warning.main,
  }), [colors]);
  const styles  = useMemo(() => makeStyles(C), [C]);

  // Form state
  const [institutions, setInstitutions] = useState([]);
  const [selectedInstitution, setSelectedInstitution] = useState(null);
  const [isLoadingInstitutions, setIsLoadingInstitutions] = useState(true);
  const [campuses, setCampuses] = useState([]);
  const [selectedCampus, setSelectedCampus] = useState(null);
  const [isLoadingCampuses, setIsLoadingCampuses] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isConfirmPasswordVisible, setIsConfirmPasswordVisible] = useState(false);
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);
  const [agreeToTerms, setAgreeToTerms] = useState(false);
  const [touchedFields, setTouchedFields] = useState({});
  const [isPickerModalVisible, setIsPickerModalVisible] = useState(false);
  const [isCampusPickerModalVisible, setIsCampusPickerModalVisible] = useState(false);

  // Refs
  const fullNameRef = useRef(null);
  const emailRef = useRef(null);
  const phoneRef = useRef(null);
  const passwordRef = useRef(null);
  const confirmPasswordRef = useRef(null);
  const signUpAbortController = useRef(null);
  const handleSignUpRef = useRef(null);

  // Load institutions
  useEffect(() => {
    async function loadInstitutions() {
      try {
        const data = await fetchInstitutions();
        setInstitutions(Array.isArray(data) ? data : []);
      } catch (error) {
        console.error('Failed to load institutions:', error);
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
      if (!selectedInstitution) {
        setCampuses([]);
        setSelectedCampus(null);
        return;
      }
      
      setIsLoadingCampuses(true);
      try {
        const baseUrl = await import('../../utils/unitsApi').then(m => m.resolveApiBaseUrl());
        const response = await fetch(`${baseUrl}/api/institution/${selectedInstitution.id}/campuses`);
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
  }, [selectedInstitution]);

  // Validation
  const validation = useMemo(() => {
    const isFullNameValid = fullName.trim().length >= 3;
    const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
    const isPhoneValid = phoneNumber.trim().length >= 10;
    const isPasswordValid = password.length >= 6;
    const doPasswordsMatch = password === confirmPassword;
    const isInstitutionValid = selectedInstitution !== null;
    const isCampusValid = selectedCampus !== null;

    return {
      fullNameValid: isFullNameValid,
      fullNameError: !isFullNameValid && fullName.trim().length > 0 ? 'Full name must be at least 3 characters' : null,
      emailValid: isEmailValid,
      emailError: !isEmailValid && email.trim().length > 0 ? 'Please enter a valid email address' : null,
      phoneValid: isPhoneValid,
      phoneError: !isPhoneValid && phoneNumber.trim().length > 0 ? 'Phone number must be at least 10 digits' : null,
      passwordValid: isPasswordValid,
      passwordError: !isPasswordValid && password.length > 0 ? 'Password must be at least 6 characters' : null,
      passwordsMatch: doPasswordsMatch,
      passwordsMatchError: !doPasswordsMatch && confirmPassword.length > 0 ? 'Passwords do not match' : null,
      institutionValid: isInstitutionValid,
      institutionError: !isInstitutionValid && touchedFields.institution ? 'Please select your institution' : null,
      campusValid: isCampusValid,
      campusError: !isCampusValid && touchedFields.campus ? 'Please select your campus' : null,
      canSubmit: isFullNameValid && isEmailValid && isPhoneValid && isPasswordValid && doPasswordsMatch && isInstitutionValid && isCampusValid && agreeToTerms,
    };
  }, [fullName, email, phoneNumber, password, confirmPassword, selectedInstitution, selectedCampus, agreeToTerms, touchedFields.institution, touchedFields.campus]);

  // Password strength
  const passwordStrength = useMemo(() => {
    if (password.length === 0) return null;
    if (password.length < 6) return 'weak';
    if (password.length < 10) return 'medium';
    return 'strong';
  }, [password]);

  const strengthConfig = {
    weak: { color: C.danger, label: 'Weak', width: '33%' },
    medium: { color: C.warning, label: 'Medium', width: '66%' },
    strong: { color: C.success, label: 'Strong', width: '100%' },
  };

  const handleFieldBlur = useCallback((field) => {
    setTouchedFields(prev => ({ ...prev, [field]: true }));
  }, []);

  const handleSubmitEditing = useCallback((field) => {
    switch(field) {
      case 'fullName':
        emailRef.current?.focus();
        break;
      case 'email':
        phoneRef.current?.focus();
        break;
      case 'phone':
        passwordRef.current?.focus();
        break;
      case 'password':
        confirmPasswordRef.current?.focus();
        break;
      case 'confirmPassword':
        handleSignUpRef.current?.();
        break;
    }
  }, []);

  const handleSignUp = async () => {
    Keyboard.dismiss();
    
    setTouchedFields({
      fullName: true,
      email: true,
      phone: true,
      password: true,
      confirmPassword: true,
      institution: true,
      campus: true,
      terms: true,
    });

    if (!validation.canSubmit) {
      let errorMessage = '';
      if (!validation.fullNameValid) errorMessage = 'Please enter your full name.';
      else if (!validation.emailValid) errorMessage = 'Please enter a valid email address.';
      else if (!validation.phoneValid) errorMessage = 'Please enter a valid phone number.';
      else if (!validation.passwordValid) errorMessage = 'Password must be at least 6 characters.';
      else if (!validation.passwordsMatch) errorMessage = 'Passwords do not match.';
      else if (!validation.institutionValid) errorMessage = 'Please select your institution.';
      else if (!validation.campusValid) errorMessage = 'Please select your campus.';
      else if (!agreeToTerms) errorMessage = 'Please agree to the Terms of Service.';
      
      Alert.alert('Validation Error', errorMessage);
      return;
    }

    const isConnected = await hasInternetConnection();
    if (!isConnected) {
      Alert.alert('No Internet Connection', 'Please connect to the internet to sign up.');
      return;
    }

    if (signUpAbortController.current) {
      signUpAbortController.current.abort();
    }
    signUpAbortController.current = new AbortController();

    const timeoutId = setTimeout(() => {
      if (signUpAbortController.current) {
        signUpAbortController.current.abort();
        setIsCreatingAccount(false);
        Alert.alert('Timeout', 'Sign up is taking too long. Please try again.');
      }
    }, 30000);

    setIsCreatingAccount(true);
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedPhone = phoneNumber.trim();

    try {
      await signUpLecturerAccount({ 
        fullName: fullName.trim(), 
        email: normalizedEmail, 
        phoneNumber: normalizedPhone, 
        institutionId: selectedInstitution.id,
        campusId: selectedCampus.id,
        password,
        signal: signUpAbortController.current.signal 
      });
      
      clearTimeout(timeoutId);
      
      Alert.alert(
        'Account Created! 🎉',
        'Your lecturer account is ready. Please sign in to access your portal.',
        [
          { 
            text: 'Sign In', 
            onPress: () => navigation.replace('LecturerSignIn'),
            style: 'default'
          }
        ]
      );
    } catch (error) {
      clearTimeout(timeoutId);
      
      let errorMessage = 'Unable to create lecturer account.';
      let errorTitle = 'Sign Up Failed';
      
      if (error.name === 'AbortError') {
        errorMessage = 'Request timed out. Please check your connection and try again.';
      } else if (error.message?.includes('email')) {
        errorMessage = 'An account with this email already exists. Please use a different email or sign in.';
        errorTitle = 'Email Already Exists';
      } else if (error.message?.includes('phone')) {
        errorMessage = 'An account with this phone number already exists. Please use a different number or sign in.';
        errorTitle = 'Phone Number Already Exists';
      }
      
      Alert.alert(errorTitle, errorMessage, [
        { text: 'Try Again', style: 'default' },
        { text: 'Sign In Instead', style: 'cancel', onPress: () => navigation.navigate('LecturerSignIn') }
      ]);
    } finally {
      setIsCreatingAccount(false);
      signUpAbortController.current = null;
    }
  };

  handleSignUpRef.current = handleSignUp;

  const renderInstitutionItem = ({ item }) => (
    <TouchableOpacity
      style={styles.pickerItem}
      onPress={() => {
        setSelectedInstitution(item);
        setSelectedCampus(null); // Reset campus when institution changes
        setIsPickerModalVisible(false);
        handleFieldBlur('institution');
      }}
    >
      <Text style={styles.pickerItemText}>{item.name}</Text>
      {selectedInstitution?.id === item.id && (
        <Icon name="check" size={20} color={C.accent} />
      )}
    </TouchableOpacity>
  );

  const renderCampusItem = ({ item }) => (
    <TouchableOpacity
      style={styles.pickerItem}
      onPress={() => {
        setSelectedCampus(item);
        setIsCampusPickerModalVisible(false);
        handleFieldBlur('campus');
      }}
    >
      <Text style={styles.pickerItemText}>{item.name}</Text>
      {selectedCampus?.id === item.id && (
        <Icon name="check" size={20} color={C.accent} />
      )}
    </TouchableOpacity>
  );

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

            <Text style={styles.heroTitle}>Create Account</Text>
            <Text style={styles.heroSub}>Join as an educator and manage your courses</Text>
          </View>

          {/* Form Card */}
          <View style={styles.card}>
            {/* Offline Banner */}
            <ConnectivityBanner
              message="You're offline. Connect to the internet to sign up."
              wrapperStyle={styles.offlineWrapper}
            />

            {/* Institution Dropdown */}
            <View style={styles.field}>
              <Text style={styles.label}>
                Institution <Text style={styles.requiredStar}>*</Text>
              </Text>
              <TouchableOpacity
                style={[
                  styles.inputRow,
                  styles.pickerButton,
                  touchedFields.institution && validation.institutionError && styles.inputRowError
                ]}
                onPress={() => {
                  Keyboard.dismiss();
                  setIsPickerModalVisible(true);
                }}
                disabled={isLoadingInstitutions || isCreatingAccount}
              >
                <Icon name="domain" size={20} color={validation.institutionValid ? C.success : C.textMuted} />
                <Text style={[
                  styles.pickerButtonText,
                  !selectedInstitution && styles.pickerButtonPlaceholder
                ]}>
                  {selectedInstitution ? selectedInstitution.name : 'Select your institution...'}
                </Text>
                <Icon name="chevron-down" size={20} color={C.textMuted} />
              </TouchableOpacity>
              {isLoadingInstitutions && (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator color={C.accent} size="small" />
                  <Text style={styles.loadingText}>Loading institutions...</Text>
                </View>
              )}
              {touchedFields.institution && validation.institutionError && (
                <Text style={styles.errorText}>{validation.institutionError}</Text>
              )}
            </View>

            {/* Campus Dropdown */}
            {selectedInstitution && (
              <View style={styles.field}>
                <Text style={styles.label}>
                  Campus <Text style={styles.requiredStar}>*</Text>
                </Text>
                <TouchableOpacity
                  style={[
                    styles.inputRow,
                    styles.pickerButton,
                    touchedFields.campus && validation.campusError && styles.inputRowError
                  ]}
                  onPress={() => {
                    Keyboard.dismiss();
                    setIsCampusPickerModalVisible(true);
                  }}
                  disabled={isLoadingCampuses || isCreatingAccount || campuses.length === 0}
                >
                  <Icon name="map-marker" size={20} color={validation.campusValid ? C.success : C.textMuted} />
                  <Text style={[
                    styles.pickerButtonText,
                    !selectedCampus && styles.pickerButtonPlaceholder
                  ]}>
                    {selectedCampus ? selectedCampus.name : 'Select your campus...'}
                  </Text>
                  <Icon name="chevron-down" size={20} color={C.textMuted} />
                </TouchableOpacity>
                {isLoadingCampuses && (
                  <View style={styles.loadingContainer}>
                    <ActivityIndicator color={C.accent} size="small" />
                    <Text style={styles.loadingText}>Loading campuses...</Text>
                  </View>
                )}
                {!isLoadingCampuses && campuses.length === 0 && (
                  <Text style={styles.errorText}>No campuses found. Please contact your institution administrator.</Text>
                )}
                {touchedFields.campus && validation.campusError && (
                  <Text style={styles.errorText}>{validation.campusError}</Text>
                )}
              </View>
            )}

            {/* Full Name */}
            <View style={styles.field}>
              <Text style={styles.label}>
                Full Name <Text style={styles.requiredStar}>*</Text>
              </Text>
              <View style={[styles.inputRow, touchedFields.fullName && validation.fullNameError && styles.inputRowError]}>
                <Icon name="account-outline" size={20} color={validation.fullNameValid ? C.success : C.textMuted} />
                <TextInput
                  ref={fullNameRef}
                  style={styles.textInput}
                  value={fullName}
                  onChangeText={setFullName}
                  onBlur={() => handleFieldBlur('fullName')}
                  placeholder="Dr. Jane Doe"
                  placeholderTextColor={C.textMuted}
                  returnKeyType="next"
                  onSubmitEditing={() => handleSubmitEditing('fullName')}
                  editable={!isCreatingAccount}
                  blurOnSubmit={false}
                />
                {touchedFields.fullName && validation.fullNameValid && (
                  <Icon name="check-circle" size={18} color={C.success} />
                )}
              </View>
              {touchedFields.fullName && validation.fullNameError && (
                <Text style={styles.errorText}>{validation.fullNameError}</Text>
              )}
            </View>

            {/* Email */}
            <View style={styles.field}>
              <Text style={styles.label}>
                Email Address <Text style={styles.requiredStar}>*</Text>
              </Text>
              <View style={[styles.inputRow, touchedFields.email && validation.emailError && styles.inputRowError]}>
                <Icon name="email-outline" size={20} color={validation.emailValid ? C.success : C.textMuted} />
                <TextInput
                  ref={emailRef}
                  style={styles.textInput}
                  value={email}
                  onChangeText={setEmail}
                  onBlur={() => handleFieldBlur('email')}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  placeholder="lecturer@university.edu"
                  placeholderTextColor={C.textMuted}
                  returnKeyType="next"
                  onSubmitEditing={() => handleSubmitEditing('email')}
                  editable={!isCreatingAccount}
                  blurOnSubmit={false}
                />
                {touchedFields.email && validation.emailValid && (
                  <Icon name="check-circle" size={18} color={C.success} />
                )}
              </View>
              {touchedFields.email && validation.emailError && (
                <Text style={styles.errorText}>{validation.emailError}</Text>
              )}
            </View>

            {/* Phone Number */}
            <View style={styles.field}>
              <Text style={styles.label}>
                Phone Number <Text style={styles.requiredStar}>*</Text>
              </Text>
              <View style={[styles.inputRow, touchedFields.phone && validation.phoneError && styles.inputRowError]}>
                <Icon name="phone-outline" size={20} color={validation.phoneValid ? C.success : C.textMuted} />
                <TextInput
                  ref={phoneRef}
                  style={styles.textInput}
                  value={phoneNumber}
                  onChangeText={setPhoneNumber}
                  onBlur={() => handleFieldBlur('phone')}
                  keyboardType="phone-pad"
                  placeholder="+254712345678"
                  placeholderTextColor={C.textMuted}
                  returnKeyType="next"
                  onSubmitEditing={() => handleSubmitEditing('phone')}
                  editable={!isCreatingAccount}
                  blurOnSubmit={false}
                />
                {touchedFields.phone && validation.phoneValid && (
                  <Icon name="check-circle" size={18} color={C.success} />
                )}
              </View>
              {touchedFields.phone && validation.phoneError && (
                <Text style={styles.errorText}>{validation.phoneError}</Text>
              )}
            </View>

            {/* Password */}
            <View style={styles.field}>
              <Text style={styles.label}>
                Password <Text style={styles.requiredStar}>*</Text>
              </Text>
              <View style={[styles.inputRow, touchedFields.password && validation.passwordError && styles.inputRowError]}>
                <Icon name="lock-outline" size={20} color={C.textMuted} />
                <TextInput
                  ref={passwordRef}
                  style={styles.textInput}
                  value={password}
                  onChangeText={setPassword}
                  onBlur={() => handleFieldBlur('password')}
                  secureTextEntry={!isPasswordVisible}
                  placeholder="Minimum 6 characters"
                  placeholderTextColor={C.textMuted}
                  returnKeyType="next"
                  onSubmitEditing={() => handleSubmitEditing('password')}
                  editable={!isCreatingAccount}
                  blurOnSubmit={false}
                />
                <TouchableOpacity 
                  onPress={() => setIsPasswordVisible(!isPasswordVisible)} 
                  activeOpacity={0.7}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Icon name={isPasswordVisible ? 'eye-off-outline' : 'eye-outline'} size={20} color={C.textMuted} />
                </TouchableOpacity>
              </View>
              
              {/* Password Strength */}
              {passwordStrength && (
                <View style={styles.strengthContainer}>
                  <View style={styles.strengthBarContainer}>
                    <View 
                      style={[
                        styles.strengthBar, 
                        { 
                          width: strengthConfig[passwordStrength].width,
                          backgroundColor: strengthConfig[passwordStrength].color
                        }
                      ]} 
                    />
                  </View>
                  <Text style={[styles.strengthText, { color: strengthConfig[passwordStrength].color }]}>
                    {strengthConfig[passwordStrength].label} password
                  </Text>
                </View>
              )}
              {touchedFields.password && validation.passwordError && (
                <Text style={styles.errorText}>{validation.passwordError}</Text>
              )}
            </View>

            {/* Confirm Password */}
            <View style={styles.field}>
              <Text style={styles.label}>
                Confirm Password <Text style={styles.requiredStar}>*</Text>
              </Text>
              <View style={[styles.inputRow, touchedFields.confirmPassword && validation.passwordsMatchError && styles.inputRowError]}>
                <Icon name="lock-check-outline" size={20} color={validation.passwordsMatch ? C.success : C.textMuted} />
                <TextInput
                  ref={confirmPasswordRef}
                  style={styles.textInput}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  onBlur={() => handleFieldBlur('confirmPassword')}
                  secureTextEntry={!isConfirmPasswordVisible}
                  placeholder="Repeat your password"
                  placeholderTextColor={C.textMuted}
                  returnKeyType="go"
                  onSubmitEditing={() => handleSubmitEditing('confirmPassword')}
                  editable={!isCreatingAccount}
                  blurOnSubmit={false}
                />
                <TouchableOpacity 
                  onPress={() => setIsConfirmPasswordVisible(!isConfirmPasswordVisible)} 
                  activeOpacity={0.7}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Icon 
                    name={isConfirmPasswordVisible ? 'eye-off-outline' : 'eye-outline'} 
                    size={20} 
                    color={C.textMuted} 
                  />
                </TouchableOpacity>
              </View>
              {touchedFields.confirmPassword && validation.passwordsMatch && (
                <View style={styles.successHint}>
                  <Icon name="check-circle" size={14} color={C.success} />
                  <Text style={[styles.hintText, { color: C.success }]}>Passwords match</Text>
                </View>
              )}
              {touchedFields.confirmPassword && validation.passwordsMatchError && (
                <Text style={styles.errorText}>{validation.passwordsMatchError}</Text>
              )}
            </View>

            {/* Terms & Conditions */}
            <TouchableOpacity
              style={styles.termsRow}
              onPress={() => setAgreeToTerms(!agreeToTerms)}
              activeOpacity={0.7}
              disabled={isCreatingAccount}
            >
              <View style={[styles.checkbox, agreeToTerms && styles.checkboxActive]}>
                {agreeToTerms && <Icon name="check" size={12} color="#fff" />}
              </View>
              <Text style={styles.termsText}>
                I agree to the{' '}
                <Text style={styles.termsLink}>Terms of Service</Text>{' '}
                and{' '}
                <Text style={styles.termsLink}>Privacy Policy</Text>
              </Text>
            </TouchableOpacity>

            {/* Submit Button */}
            <TouchableOpacity
              style={[
                styles.primaryBtn, 
                (!validation.canSubmit || isCreatingAccount) && styles.primaryBtnDisabled
              ]}
              onPress={handleSignUp}
              disabled={!validation.canSubmit || isCreatingAccount}
              activeOpacity={0.85}
            >
              <LinearGradient
                colors={!validation.canSubmit || isCreatingAccount ? [C.border, C.borderMed] : [C.accentDk, C.accent]}
                style={styles.primaryBtnGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
              >
                {isCreatingAccount ? (
                  <>
                    <ActivityIndicator color="#fff" size="small" />
                    <Text style={styles.primaryBtnText}>Creating Account...</Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.primaryBtnText}>Create Account</Text>
                    <Icon name="arrow-right" size={20} color="#fff" />
                  </>
                )}
              </LinearGradient>
            </TouchableOpacity>

            {/* Sign In Link */}
            <View style={styles.signInRow}>
              <Text style={styles.signInHint}>Already have an account?</Text>
              <TouchableOpacity 
                onPress={() => navigation.navigate('LecturerSignIn')} 
                activeOpacity={0.7}
                disabled={isCreatingAccount}
              >
                <Text style={styles.signInLink}>Sign In</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Custom Modal Picker */}
      <Modal
        visible={isPickerModalVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setIsPickerModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Institution</Text>
              <TouchableOpacity 
                onPress={() => setIsPickerModalVisible(false)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Icon name="close" size={24} color={C.textMuted} />
              </TouchableOpacity>
            </View>
            
            <FlatList
              data={institutions}
              keyExtractor={(item) => item.id.toString()}
              renderItem={renderInstitutionItem}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.pickerList}
              ListEmptyComponent={
                <View style={styles.emptyContainer}>
                  <Icon name="domain-off" size={48} color={C.textMuted} />
                  <Text style={styles.emptyText}>No institutions found</Text>
                </View>
              }
            />
          </View>
        </View>
      </Modal>

      {/* Campus Modal Picker */}
      <Modal
        visible={isCampusPickerModalVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setIsCampusPickerModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Campus</Text>
              <TouchableOpacity 
                onPress={() => setIsCampusPickerModalVisible(false)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Icon name="close" size={24} color={C.textMuted} />
              </TouchableOpacity>
            </View>
            
            <FlatList
              data={campuses}
              keyExtractor={(item) => item.id.toString()}
              renderItem={renderCampusItem}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.pickerList}
              ListEmptyComponent={
                <View style={styles.emptyContainer}>
                  <Icon name="map-marker-off" size={48} color={C.textMuted} />
                  <Text style={styles.emptyText}>No campuses found</Text>
                </View>
              }
            />
          </View>
        </View>
      </Modal>
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
    color: C.danger,
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
    borderColor: C.danger,
    backgroundColor: `${C.danger}08`,
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
    color: C.danger,
    marginTop: 6,
    marginLeft: 4,
  },
  successHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
    marginLeft: 4,
  },
  hintText: {
    fontSize: 12,
    fontWeight: '500',
  },
  
  // Picker Styles
  pickerButton: {
    justifyContent: 'space-between',
  },
  pickerButtonText: {
    flex: 1,
    fontSize: 16,
    color: C.text,
  },
  pickerButtonPlaceholder: {
    color: C.textMuted,
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  loadingText: {
    fontSize: 12,
    color: C.textMuted,
  },
  
  // Password Strength
  strengthContainer: {
    marginTop: 8,
    gap: 6,
  },
  strengthBarContainer: {
    height: 4,
    backgroundColor: C.border,
    borderRadius: 2,
    overflow: 'hidden',
  },
  strengthBar: {
    height: '100%',
    borderRadius: 2,
  },
  strengthText: {
    fontSize: 11,
    fontWeight: '600',
  },
  
  // Terms
  termsRow: {
    flexDirection: 'row', 
    alignItems: 'flex-start', 
    gap: 12,
    marginBottom: 24, 
    marginTop: 4,
  },
  checkbox: {
    width: 20, 
    height: 20, 
    borderRadius: 6, 
    marginTop: 1,
    borderWidth: 2, 
    borderColor: C.borderMed,
    alignItems: 'center', 
    justifyContent: 'center',
    backgroundColor: C.inputBg, 
    flexShrink: 0,
  },
  checkboxActive: { 
    backgroundColor: C.accent, 
    borderColor: C.accent 
  },
  termsText: { 
    flex: 1, 
    fontSize: 13, 
    color: C.textSec, 
    lineHeight: 20 
  },
  termsLink: { 
    color: C.accent, 
    fontWeight: '700' 
  },
  
  // Buttons
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
  
  // Sign In Link
  signInRow: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'center', 
    gap: 8,
    paddingTop: 8,
  },
  signInHint: { 
    fontSize: 14, 
    color: C.textMuted 
  },
  signInLink: { 
    fontSize: 14, 
    color: C.accent, 
    fontWeight: '700' 
  },
  
  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: C.text,
  },
  pickerList: {
    paddingVertical: 8,
  },
  pickerItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  pickerItemText: {
    fontSize: 16,
    color: C.text,
    flex: 1,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 12,
  },
  emptyText: {
    fontSize: 16,
    color: C.textMuted,
    textAlign: 'center',
  },
});