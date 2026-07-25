// screens/student/OfflineMarker.js - FULLY FIXED
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
    View,
    StyleSheet,
    Text,
    StatusBar,
    Alert,
    Linking,
    NativeModules,
    NativeEventEmitter,
    Platform,
    Modal,
    Pressable,
    TouchableOpacity,
    Switch,
    PermissionsAndroid,
    ScrollView,
    TextInput,
    Animated,
    Easing,
    Dimensions,
    Vibration,
    AppState,
    ActivityIndicator,
    KeyboardAvoidingView,
    Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/Ionicons';
import { Picker } from '@react-native-picker/picker';
import { accelerometer, SensorTypes, setUpdateIntervalForType } from 'react-native-sensors';
import { toByteArray as atob, fromByteArray as btoa } from 'base64-js';
import MLKitCamera from '../../../components/MLKitCamera';
import QRCodeGenerator from '../../../components/QRCodeGenerator';
import usePermissions from '../../../hooks/usePermissions';
import getBleManager from '../../../utils/bleManager';
import {
    QR_ROTATION_MS,
    TIMESTAMP_TOLERANCE_MS,
    SESSION_DURATION_MS,
    GD_SESSION_DURATION_MS,
    MANUAL_TOKEN_ROTATION_MS,
    RELAY_TARGET_COUNT,
    RELAY_RSSI_MIN,
    RELAY_RSSI_MAX,
    RELAY_STAGGER_MS,
    SYNC_JITTER_MS,
    normalizeUnitCode,
} from '../../../utils/constants';
import sessionManager from '../../../utils/sessionManager';
import sqliteStorage from '../../../storage/sqliteStorage';
import { useEnrollment } from '../../../context/EnrollmentContext';
import OfflineBanner from '../../../components/OfflineBanner';

import {
    validateManualAttendanceToken,
    normalizeManualAttendanceTokenInput,
} from '../../../utils/manualAttendanceToken';
import { decodeQrPayload } from '../../../utils/qrSigning';
import { decodeBLEBeacon, encodeBLEBeacon, deriveCounter, QR_WINDOW_SECONDS } from '../../../utils/sessionCrypto';
import { adaptiveConfig, useAdaptiveAttendance } from '../../../utils/adaptiveAttendanceConfig';
import { getStudentSession } from '../../../utils/authSession';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { syncPendingAttendance } from '../../../utils/offlineAttendanceApi';
import { getMyGroupForUnit } from '../../../utils/studentGroupsApi';
import useResponsive from '../../../hooks/useResponsive';
import colors from '../../../theme/colors';
import { useColors, useTheme } from '../../../theme';

const MY_GROUPS_CACHE_KEY = '@markwise_my_groups_v1';

const { width, height } = Dimensions.get('window');
const { BLEAdvertiserModule, BLEScanner } = NativeModules;
// NativeEventEmitter on newer RN versions emits a warning if the native module doesn't
// expose addListener / removeListeners. Rather than skipping the emitter (which breaks
// BLE event delivery), we patch the module object with no-op stubs so the warning is
// silenced while all real events continue to flow through the native bridge normally.
const bleScannerEmitter = (() => {
  if (Platform.OS !== 'android' || !BLEScanner) return null;
  if (typeof BLEScanner.addListener !== 'function') {
    BLEScanner.addListener = () => {};
  }
  if (typeof BLEScanner.removeListeners !== 'function') {
    BLEScanner.removeListeners = () => {};
  }
  return new NativeEventEmitter(BLEScanner);
})();
const SERVICE_UUID = "00001101-0000-1000-8000-00805F9B34FB";
const manager = getBleManager();
const MOTION_DELTA_THRESHOLD = 0.45;
const MOTION_WINDOW_MS = 8000;

// FASTER auto-marking constants
const SCAN_COOLDOWN_MS = 100; // Reduced from 2000ms to 100ms for near-instant BLE marking


// ===== ENHANCED ENROLLMENT UTILITIES =====

/**
 * Normalize any unit code to a consistent format for comparison
 * Removed: now imported from constants.js
 */

/**
 * Extract unit code from various possible formats in enrollment data
 */
const extractUnitCodeFromEnrollment = (enrollmentItem) => {
    if (!enrollmentItem) return null;
    
    // Case 1: It's already a string
    if (typeof enrollmentItem === 'string') {
        const trimmed = enrollmentItem.trim();
        if (!trimmed) return null;
        
        // Try to extract from formats like "Organic Chemistry (SCH2170)" or "SCH 2170"
        const parenMatch = trimmed.match(/\(([^)]+)\)/);
        if (parenMatch && parenMatch[1]) {
            return parenMatch[1].trim();
        }
        return trimmed;
    }
    
    // Case 2: It's an object with various possible properties
    if (typeof enrollmentItem === 'object') {
        // Try common property names
        const possibleProps = ['code', 'unitCode', 'rawCode', 'displayName', 'name', 'id'];
        for (const prop of possibleProps) {
            if (enrollmentItem[prop] && typeof enrollmentItem[prop] === 'string') {
                return enrollmentItem[prop];
            }
        }
        
        // Try to stringify the object as fallback
        try {
            return JSON.stringify(enrollmentItem);
        } catch {
            return null;
        }
    }
    
    return null;
};

const formatRemaining = (ms) => {
    if (ms == null) return '';
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

const formatId = (id) => {
    if (id === undefined || id === null) return 'Unknown';
    return `0x${id.toString(16).toUpperCase().padStart(4, '0')}`;
};


const formatManualRoomInput = (value) => {
    const compact = String(value || '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');
    if (!compact) return '';
    const firstDigitIndex = compact.search(/\d/);
    return firstDigitIndex > 0 ? `${compact.slice(0, firstDigitIndex)} ${compact.slice(firstDigitIndex)}` : compact;
};

const persistAttendance = async ({ unitCode, lectureRoom, sessionStart, rawPayload, deviceId, synced = 0, lessonType = null }) => {
    // UI-level deduplication: block if already marked for this session (any method/device)
    const alreadyMarked = await sqliteStorage.hasAttendanceForSession({ unitCode, lectureRoom, sessionStart });
    if (alreadyMarked) {
        return { saved: false, duplicate: true, reason: 'already_marked' };
    }
    try {
        const scannedAt = Date.now();
        const result = await sqliteStorage.addAttendanceRecord({
            unitCode,
            lectureRoom,
            sessionStart,
            scannedAt,
            rawPayload,
            deviceId,
            synced,
            lessonType,
        });
        if (!result?.saved) return result || { saved: false, duplicate: false };
        // Fire-and-forget with random jitter — spreads concurrent sync calls from large
        // cohorts (e.g. 1000 students) across SYNC_JITTER_MS to prevent server stampede.
        // Attendance is already saved locally so the student sees confirmation instantly.
        setTimeout(() => syncPendingAttendance().catch(() => {}), Math.random() * SYNC_JITTER_MS);
        return { saved: true, duplicate: false };
    } catch (error) {
        console.error('Failed to persist attendance record', error);
        return { saved: false, duplicate: false };
    }
};


// Animated Components
const PulseView = ({ children }) => {
    const scaleAnim = useRef(new Animated.Value(1)).current;

    useEffect(() => {
        const pulse = Animated.sequence([
            Animated.timing(scaleAnim, {
                toValue: 1.1,
                duration: 800,
                useNativeDriver: true,
                easing: Easing.inOut(Easing.ease),
            }),
            Animated.timing(scaleAnim, {
                toValue: 1,
                duration: 800,
                useNativeDriver: true,
                easing: Easing.inOut(Easing.ease),
            }),
        ]);
        Animated.loop(pulse).start();
    }, [scaleAnim]);

    return (
        <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
            {children}
        </Animated.View>
    );
};

const GlassCard = ({ children, style, styles }) => {
    return (
        <View style={[styles.glassCard, style]}>
            <View style={styles.glassCardInner}>{children}</View>
        </View>
    );
};

const ProgressSteps = ({ current, total, styles }) => {
    return (
        <View style={styles.progressStepsContainer}>
            {Array.from({ length: total }).map((_, index) => (
                <View
                    key={index}
                    style={[
                        styles.progressStep,
                        index < current && styles.progressStepCompleted,
                        index === current && styles.progressStepCurrent,
                    ]}
                >
                    {index < current && (
                        <Icon name="checkmark" size={12} color="#FFFFFF" />
                    )}
                </View>
            ))}
        </View>
    );
};

const StatusChip = ({ type, message, icon, styles }) => {
    const colorMap = {
        success: colors.success,
        warning: colors.warning,
        error: colors.danger,
        info: colors.info,
        primary: colors.primary,
    };
    
    const theme = colorMap[type] || colors.info;

    return (
        <LinearGradient
            colors={[theme.soft, 'transparent']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.statusChip, { borderColor: theme.main }]}
        >
            <Icon name={icon} size={16} color={theme.main} />
            <Text style={[styles.statusChipText, { color: theme.main }]}>{message}</Text>
        </LinearGradient>
    );
};

const AutoProgressIndicator = ({ progress, message, styles }) => {
    const animatedWidth = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        Animated.timing(animatedWidth, {
            toValue: progress,
            duration: 300,
            useNativeDriver: false,
        }).start();
    }, [progress, animatedWidth]);

    return (
        <View style={styles.autoProgressContainer}>
            <View style={styles.autoProgressBar}>
                <Animated.View 
                    style={[
                        styles.autoProgressFill,
                        {
                            width: animatedWidth.interpolate({
                                inputRange: [0, 100],
                                outputRange: ['0%', '100%']
                            })
                        }
                    ]} 
                />
            </View>
            <Text style={styles.autoProgressText}>{message}</Text>
        </View>
    );
};

// Manual PIN Dialog Component
const ManualPinDialog = ({
    visible,
    onClose,
    onSubmit,
    manualTokenInput,
    setManualTokenInput,
    manualUnitCodeInput,
    setManualUnitCodeInput,
    manualLectureRoomInput,
    setManualLectureRoomInput,
    manualTokenError,
    manualTokenRemainingSec,
    isSubmitting,
    enrolledUnits,
    getUnitDisplayName,
    styles,
    colors,
}) => {
    const [keyboardVisible, setKeyboardVisible] = useState(false);

    useEffect(() => {
        const keyboardDidShowListener = Keyboard.addListener(
            'keyboardDidShow',
            () => setKeyboardVisible(true)
        );
        const keyboardDidHideListener = Keyboard.addListener(
            'keyboardDidHide',
            () => setKeyboardVisible(false)
        );

        return () => {
            keyboardDidShowListener.remove();
            keyboardDidHideListener.remove();
        };
    }, []);

    if (!visible) return null;

    return (
        <Modal
            visible={visible}
            transparent
            animationType="slide"
            onRequestClose={onClose}
        >
            <KeyboardAvoidingView 
                behavior={Platform.OS === "ios" ? "padding" : "height"}
                style={styles.dialogOverlay}
            >
                <Pressable style={styles.dialogOverlay} onPress={onClose}>
                    <View style={[
                        styles.dialogContainer,
                        keyboardVisible && styles.dialogContainerKeyboard
                    ]}>
                        <Pressable onPress={(e) => e.stopPropagation()}>
                            <LinearGradient
                                colors={colors.primary.gradient}
                                style={styles.dialogHeader}
                            >
                                <Icon name="key-outline" size={32} color="#FFFFFF" />
                                <Text style={styles.dialogTitle}>Manual Attendance PIN</Text>
                                <TouchableOpacity onPress={onClose} style={styles.dialogCloseButton}>
                                    <Icon name="close" size={24} color="#FFFFFF" />
                                </TouchableOpacity>
                            </LinearGradient>

                            <View style={styles.dialogContent}>
                                <View style={styles.pinTimer}>
                                    <Icon name="time-outline" size={16} color={colors.warning.main} />
                                    <Text style={styles.pinTimerText}>
                                        PIN expires in {manualTokenRemainingSec}s
                                    </Text>
                                </View>


                                <Text style={styles.inputLabel}>Unit Code</Text>
                                <View style={{ borderWidth: 1, borderColor: colors.border.medium, borderRadius: 8, marginBottom: 12 }}>
                                    <Picker
                                        selectedValue={manualUnitCodeInput}
                                        onValueChange={setManualUnitCodeInput}
                                        style={{ color: colors.text.primary }}
                                    >
                                        <Picker.Item label="Select your enrolled unit" value="" />
                                        {Array.isArray(enrolledUnits) && enrolledUnits.map((unitCode) => (
                                            <Picker.Item key={unitCode} label={getUnitDisplayName ? getUnitDisplayName(unitCode) : unitCode} value={unitCode} />
                                        ))}
                                    </Picker>
                                </View>

                                <Text style={styles.inputLabel}>Lecture Room</Text>
                                <TextInput
                                    value={manualLectureRoomInput}
                                    onChangeText={text => setManualLectureRoomInput(formatManualRoomInput(text))}
                                    placeholder="e.g., CTC 001 (letters+space+numbers)"
                                    placeholderTextColor={colors.text.tertiary}
                                    autoCapitalize="characters"
                                    autoCorrect={false}
                                    maxLength={8}
                                    style={styles.dialogInput}
                                />

                                <Text style={styles.inputLabel}>6-Digit PIN</Text>
                                <TextInput
                                    value={manualTokenInput}
                                    onChangeText={setManualTokenInput}
                                    placeholder="Enter 6-digit PIN"
                                    placeholderTextColor={colors.text.tertiary}
                                    keyboardType="number-pad"
                                    maxLength={6}
                                    autoCorrect={false}
                                    style={styles.dialogInput}
                                />

                                {manualTokenError ? (
                                    <StatusChip type="error" message={manualTokenError} icon="alert-circle" styles={styles} />
                                ) : null}

                                <View style={styles.dialogButtons}>
                                    <TouchableOpacity
                                        style={styles.dialogCancelButton}
                                        onPress={onClose}
                                    >
                                        <Text style={styles.dialogCancelText}>Cancel</Text>
                                    </TouchableOpacity>

                                    <TouchableOpacity
                                        onPress={onSubmit}
                                        disabled={isSubmitting || !manualTokenInput.trim() || !manualUnitCodeInput || !manualLectureRoomInput}
                                    >
                                        <LinearGradient
                                            colors={manualTokenInput.trim() && manualUnitCodeInput && manualLectureRoomInput
                                                ? colors.success.gradient
                                                : [colors.surface.tertiary, colors.surface.tertiary]}
                                            style={styles.dialogSubmitButton}
                                        >
                                            {isSubmitting ? (
                                                <ActivityIndicator size="small" color="#FFFFFF" />
                                            ) : (
                                                <>
                                                    <Icon name="checkmark-circle" size={20} color="#FFFFFF" />
                                                    <Text style={styles.dialogSubmitText}>Submit PIN</Text>
                                                </>
                                            )}
                                        </LinearGradient>
                                    </TouchableOpacity>
                                </View>
                            </View>
                        </Pressable>
                    </View>
                </Pressable>
            </KeyboardAvoidingView>
        </Modal>
    );
};

// Main Component
const OfflineMarker = () => {
    const colors = useColors();
    const { isDark } = useTheme();
    const C = useMemo(() => ({
        bgPrimary:        colors.background.primary,
        bgSecondary:      colors.background.secondary,
        textPrimary:      colors.text.primary,
        textSecondary:    colors.text.secondary,
        textTertiary:     colors.text.tertiary,
        primaryMain:      colors.primary.main,
        primarySoft:      colors.primary.soft,
        primaryGradient:  colors.primary.gradient,
        successMain:      colors.success.main,
        successGradient:  colors.success.gradient,
        warningMain:      colors.warning.main,
        warningSoft:      colors.warning.soft,
        infoMain:         colors.info.main,
        purpleMain:       colors.purple.main,
        purpleSoft:       colors.purple.soft,
        purpleGradient:   colors.purple.gradient,
        surfacePrimary:   colors.surface.primary,
        surfaceSecondary: colors.surface.secondary,
        surfaceTertiary:  colors.surface.tertiary,
        borderLight:      colors.border.light,
        borderMedium:     colors.border.medium,
        overlayHeavy:     colors.overlay.heavy,
    }), [colors]);
    const styles = useMemo(() => makeStyles(C), [C]);

    // Sync institution mappings from backend on mount
    useEffect(() => {
        (async () => {
            try {
                const session = await getStudentSession();
                if (session?.institutionId && session?.token) {
                    adaptiveConfig.setInstitution(session.institutionId);
                    await adaptiveConfig.syncInstitutionMappingsFromBackend(session.institutionId, session.token);
                } else {
                    console.warn('[OfflineMarker] No institutionId or token in session');
                }
            } catch (err) {
                // Network failures are expected offline; OfflineBanner already signals this to the user.
                const isNetworkError = err && err.message && (
                    err.message.includes('Network request failed') ||
                    err.message.includes('fetch') ||
                    err.message.includes('network')
                );
                if (isNetworkError) {
                    console.warn('[OfflineMarker] Sync skipped (offline):', err.message);
                } else {
                    console.error('[OfflineMarker] Failed to sync institution mappings:', err);
                }
            }
        })();
    }, []);

    const { enrolledUnits } = useEnrollment();
    const {
        isLoading: isConfigLoading,
        getUnitDisplayName,
    } = useAdaptiveAttendance();

    // Responsive helpers — react to window size changes (tablet, desktop)
    const { width: windowWidth, height: windowHeight, isTablet, contentMaxWidth, r } = useResponsive();

    const [scannedData, setScannedData] = useState(null);
    const [scanCount, setScanCount] = useState(0);
    const [, setLastScanned] = useState('');
    const [, setFirstScannedData] = useState(null);

    // Refs that mirror the above for use inside handleScan — native events arrive faster
    // than React re-renders, so reading state from a closure gives stale values.
    const scannedDataRef = useRef(null);
    const scanCountRef = useRef(0);
    const lastScannedRef = useRef('');
    const firstScannedDataRef = useRef(null);
    const handlingScanRef = useRef(false); // prevent re-entrant async execution
    const receivedQrDataRef = useRef(null);       // stores MWQR0x01 string for QR relay
    const relayPinRef = useRef(null);             // stores 6-digit PIN for PIN relay
    const receivedSessionNonceRef = useRef(null); // stores sessionNonce from BLE/QR mark (null for PIN-only)
    const [regeneratedQrData, setRegeneratedQrData] = useState('');
    const [feedbackMessage, setFeedbackMessage] = useState('');
    const [bleFeedbackMessage, setBleFeedbackMessage] = useState('');
    const [isAdvertising, setIsAdvertising] = useState(false);
    const [isAdvertisingSupported, setIsAdvertisingSupported] = useState(false);
    const [isBluetoothOn, setIsBluetoothOn] = useState(false);
    const [bleScanError, setBleScanError] = useState('');
    const [bleAdvertisingError, setBleAdvertisingError] = useState('');
    const { hasPermission, openSettings } = usePermissions();
    const [sessionRemainingMs, setSessionRemainingMs] = useState(null);
    const [sessionActive, setSessionActive] = useState(false);
    const [showInfoModal, setShowInfoModal] = useState(false);
    const [isToggleBusy, setIsToggleBusy] = useState(false);
    const [showToast, setShowToast] = useState(false);
    const [toastMessage, setToastMessage] = useState('');
    const [manualTokenInput, setManualTokenInput] = useState('');
    const [manualTokenError, setManualTokenError] = useState('');
    const [attendanceDeviceId, setAttendanceDeviceId] = useState('');
    const [manualUnitCodeInput, setManualUnitCodeInput] = useState('');
    const [manualLectureRoomInput, setManualLectureRoomInput] = useState('');
    const [relayManualPin, setRelayManualPin] = useState('');
    const [manualTokenRemainingSec, setManualTokenRemainingSec] = useState(
        Math.ceil(MANUAL_TOKEN_ROTATION_MS / 1000),
    );
    const [isMotionVerified, setIsMotionVerified] = useState(false);
    const [activeTab, setActiveTab] = useState('scan');
    const [isCameraReady, setIsCameraReady] = useState(false);
    const [showHelp, setShowHelp] = useState(false);
    const [detectedBleId, setDetectedBleId] = useState(null);
    const [isManualDialogVisible, setIsManualDialogVisible] = useState(false);
    const [isManualSubmitting, setIsManualSubmitting] = useState(false);
    
    // Auto-marking states
    const [isAutoMarking, setIsAutoMarking] = useState(false);
    const [autoMarkProgress, setAutoMarkProgress] = useState(0);
    const [detectedSession, setDetectedSession] = useState(null);
    const [pendingMotionSession, setPendingMotionSession] = useState(null);
    const [isScanCooldown, setIsScanCooldown] = useState(false);
    // Mirrors receivedSessionNonceRef for PIN-marked students; triggers relay useEffect re-run
    const [peerSessionNonce, setPeerSessionNonce] = useState(null);

    // Animation refs
    const fadeAnim = useRef(new Animated.Value(0)).current;
    const slideAnim = useRef(new Animated.Value(50)).current;
    const pulseAnim = useRef(new Animated.Value(1)).current;
    const rotateAnim = useRef(new Animated.Value(0)).current;
    
    const lastScanTimeRef = useRef(0);
    const lastManualTokenWindowRef = useRef(Math.floor(Date.now() / MANUAL_TOKEN_ROTATION_MS));
    const lastMotionDetectedAtRef = useRef(0);
    const previousAccelerationMagnitudeRef = useRef(null);
    const qrTimerRef = useRef(null);
    const appStateRef = useRef(AppState.currentState);
    const autoMarkTimerRef = useRef(null);
    const scanCooldownTimerRef = useRef(null);
    const progressIntervalRef = useRef(null);
    const seenSessionsRef = useRef(new Set());
    // Relay: refs only (no state) — zero re-renders, pure background process
    const isRelayingRef = useRef(false);
    const relayTimerRef = useRef(null);
    // Latest raw BLE payload seen; used for fresh re-election instead of stale original packet
    const relayPayloadRef = useRef(null);

    // Group membership cache: { [normalizedUnitCode]: groupNumber }
    // Populated on mount from AsyncStorage, refreshed from API when online.
    const myGroupsRef = useRef({});

    // Active delegation cache — used to resolve unitCode/roomCode for GD packets without
    // relying on institution mappings (resilient to DB-FK roomId bug in older delegations).
    const activeDelegationsRef = useRef([]);

    // Reset BLE scan state on screen focus
    useFocusEffect(
        useCallback(() => {
            resetScan();
            setBleScanError('');
            setBleFeedbackMessage('');
            setIsAutoMarking(false);
            setIsScanCooldown(false);
            seenSessionsRef.current.clear();
            return () => {
                // Stop relay advertising when screen loses focus
                if (isRelayingRef.current) {
                    BLEAdvertiserModule?.stopAdvertising?.().catch(() => {});
                    isRelayingRef.current = false;
                }
                if (relayTimerRef.current) {
                    clearTimeout(relayTimerRef.current);
                    relayTimerRef.current = null;
                }
            };
        // eslint-disable-next-line react-hooks/exhaustive-deps
        }, []) // resetScan only calls stable state setters + refs; adding it would re-setup BLE on every render
    );

    // Initialize adaptive config and proactively sync mappings on every focus.
    // Running this BEFORE any scan event fires prevents the inline sync-on-scan path,
    // which blocks the handlingScanRef lock and drops all camera frames during the fetch.
    useEffect(() => {
        adaptiveConfig.initialize().catch(console.error);
    }, []);

    useFocusEffect(
        useCallback(() => {
            let cancelled = false;
            (async () => {
                try {
                    const s = await getStudentSession();
                    if (!cancelled && s?.institutionId && s?.token) {
                        adaptiveConfig.setInstitution(s.institutionId);
                        await adaptiveConfig.syncInstitutionMappingsFromBackend(s.institutionId, s.token);
                    }
                } catch { /* network failures are fine — cached data still works */ }
            })();
            return () => { cancelled = true; };
        }, [])
    );

    // Pre-load delegation cache from SQLite at mount so the ref is ready before the
    // very first BLE packet arrives (useFocusEffect fires async and may be too late).
    useEffect(() => {
        let isMounted = true;
        sqliteStorage.getActiveDelegations().then((rows) => {
            if (isMounted && rows && rows.length > 0) {
                activeDelegationsRef.current = rows;
            }
        }).catch(() => {});
        return () => { isMounted = false; };
    }, []);

    // Load group membership cache — used for GD delegation checks (groupId != 0x00)
    // Step 1: restore from AsyncStorage immediately (works offline)
    useEffect(() => {
        let isMounted = true;
        (async () => {
            try {
                const cached = await AsyncStorage.getItem(MY_GROUPS_CACHE_KEY);
                if (cached && isMounted) {
                    myGroupsRef.current = JSON.parse(cached);
                }
            } catch (_) {}
        })();
        return () => { isMounted = false; };
    }, []);

    // Step 2: refresh group membership from API whenever enrolled units are available.
    // Stores { [NORMALIZEDUNITCODE]: groupNumber } so the BLE group check has fresh data.
    useEffect(() => {
        if (!enrolledUnits || enrolledUnits.length === 0) return;
        let isMounted = true;
        (async () => {
            try {
                const updates = {};
                await Promise.all(enrolledUnits.map(async (unit) => {
                    const code = normalizeUnitCode(extractUnitCodeFromEnrollment(unit));
                    if (!code) return;
                    try {
                        const myGroup = await getMyGroupForUnit(code);
                        const num = myGroup?.groupNumber ?? myGroup?.number ?? null;
                        if (num != null) updates[code] = Number(num);
                    } catch (_) {}
                }));
                if (isMounted && Object.keys(updates).length > 0) {
                    const merged = { ...myGroupsRef.current, ...updates };
                    myGroupsRef.current = merged;
                    AsyncStorage.setItem(MY_GROUPS_CACHE_KEY, JSON.stringify(merged)).catch(() => {});
                }
            } catch (_) {}
        })();
        return () => { isMounted = false; };
    }, [enrolledUnits]);

    // Refresh active delegation cache on focus so parseBinaryPayload can resolve GD
    // unitCode/roomCode directly from the delegation object without needing BLE-range
    // mappings (works even when the BLE packet carries a DB-FK roomId instead of a
    // real BLE-range ID).
    useFocusEffect(
        useCallback(() => {
            let isMounted = true;
            (async () => {
                try {
                    const { fetchMyDelegations } = require('../../../utils/delegationApi');
                    const remote = await fetchMyDelegations().catch(() => []);
                    if (Array.isArray(remote) && remote.length > 0) {
                        sqliteStorage.saveDelegations(remote).catch(() => {});
                    }
                    const active = await sqliteStorage.getActiveDelegations().catch(() => []);
                    if (isMounted) {
                        activeDelegationsRef.current = active || [];
                    }
                } catch (_) {}
            })();
            return () => { isMounted = false; };
        }, [])
    );

    // Create a Set of normalized enrolled unit codes for fast lookup
    const enrolledNormalizedSet = useMemo(() => {
        const set = new Set();
        if (!enrolledUnits || enrolledUnits.length === 0) return set;
        for (const unit of enrolledUnits) {
            const extracted = extractUnitCodeFromEnrollment(unit);
            if (extracted) set.add(normalizeUnitCode(extracted));
        }
        return set;
    }, [enrolledUnits]);

    // Enhanced enrollment check — hot path, no logging in production
    const checkEnrollment = useCallback((unitCode) => {
        if (!unitCode) return false;
        return enrolledNormalizedSet.has(normalizeUnitCode(unitCode));
    }, [enrolledNormalizedSet]);

    const enrolledUnitsPreview = useMemo(() => {
        if (enrolledNormalizedSet.size === 0) return 'No enrolled units yet';
        const preview = Array.from(enrolledNormalizedSet).slice(0, 3).join(', ');
        const remaining = enrolledNormalizedSet.size - 3;
        return remaining > 0 ? `${preview} +${remaining}` : preview;
    }, [enrolledNormalizedSet]);

    const hasRecentMotion = useCallback(
        () => Date.now() - lastMotionDetectedAtRef.current <= MOTION_WINDOW_MS,
        []
    );

    const resetAutoMark = useCallback((triggerCooldown = false) => {
        if (progressIntervalRef.current) {
            clearInterval(progressIntervalRef.current);
            progressIntervalRef.current = null;
        }
        
        if (autoMarkTimerRef.current) {
            clearTimeout(autoMarkTimerRef.current);
            autoMarkTimerRef.current = null;
        }
        
        setIsAutoMarking(false);
        setAutoMarkProgress(0);
        setDetectedSession(null);
        
        if (triggerCooldown) {
            setIsScanCooldown(true);
            if (scanCooldownTimerRef.current) {
                clearTimeout(scanCooldownTimerRef.current);
            }
            scanCooldownTimerRef.current = setTimeout(() => {
                setIsScanCooldown(false);
                scanCooldownTimerRef.current = null;
            }, SCAN_COOLDOWN_MS);
        }
    }, []);

    // Parse binary BLE payload — supports both new secure format (v0x02) and legacy format
    const parseBinaryPayload = useCallback(async (base64Payload) => {
        try {
            if (typeof base64Payload !== 'string' || base64Payload.length < 8) {
                return null;
            }

            // Ensure institution is set
            if (!adaptiveConfig.currentInstitutionId) {
                let session = null;
                try {
                    const sessionStr = await AsyncStorage.getItem('studentSession');
                    session = sessionStr ? JSON.parse(sessionStr) : null;
                } catch (e) {
                    session = null;
                }
                if (session?.institutionId) {
                    adaptiveConfig.setInstitution(session.institutionId);
                }
            }

            // toByteArray (aliased as atob) from base64-js returns a Uint8Array.
            const buf = atob(base64Payload);
            if (buf.length !== 9 && buf.length !== 10) return null;

            // ── New secure format (version byte 0x01) ────────────────────────────
            // Layout: [sessionNonce 2B BE][counter 2B BE][unitId 2B BE][roomId 2B BE][lessonType 1B][0x01]
            // Produced by OfflineTaker. BEACON_VERSION in sessionCrypto.js is 0x01.
            if (buf.length === 10 && buf[9] === 0x01) {
                const decoded = decodeBLEBeacon(buf);
                if (!decoded) return null;

                const { sessionNonce, counter, unitId, roomId, lessonTypeId } = decoded;
                setDetectedBleId({ unitId, roomId, sessionCounter: counter });

                let unitCode    = adaptiveConfig.getUnitCodeFromId(unitId);
                let lectureRoom = adaptiveConfig.getRoomCodeFromId(roomId);

                if (!unitCode || !lectureRoom) {
                    try {
                        const s = await getStudentSession();
                        if (s?.institutionId && s?.token) {
                            adaptiveConfig.setInstitution(s.institutionId);
                            await adaptiveConfig.syncInstitutionMappingsFromBackend(s.institutionId, s.token);
                        }
                    } catch { /* network failures ok */ }
                    unitCode    = adaptiveConfig.getUnitCodeFromId(unitId);
                    lectureRoom = adaptiveConfig.getRoomCodeFromId(roomId);
                }

                if (!unitCode || !lectureRoom) {
                    if (__DEV__) console.warn('[BLE] Secure v0x01: cannot resolve unitId/roomId', { unitId, roomId });
                    return null;
                }

                // Stable epoch sessionStart — same approach as PIN for dedup consistency
                const sessionDurationSec = Math.floor(SESSION_DURATION_MS / 1000);
                const nowS = Math.floor(Date.now() / 1000);
                const sessionStart = Math.floor(nowS / sessionDurationSec) * sessionDurationSec * 1000;

                return {
                    unitCode,
                    lectureRoom,
                    sessionStart,
                    sessionCounter: counter,
                    groupId: 0,
                    rawPayload: `MWBLE:v1:${sessionNonce}:${counter}:${unitId}:${roomId}`,
                    raw: { sessionNonce, counter, unitId, roomId, lessonTypeId, version: 0x01 },
                };
            }

            // ── Legacy format ────────────────────────────────────────────────────
            // Layout: [unitId Hi][unitId Lo][roomId Hi][roomId Lo][ts B3-B0][groupId][counter]
            // Backward compat: 9-byte packets (pre-delegation) treated as groupId=0.
            const unitId = (buf[0] << 8) | buf[1];
            const roomId = (buf[2] << 8) | buf[3];
            const timestampSec = (buf[4] << 24) | (buf[5] << 16) | (buf[6] << 8) | buf[7];
            const groupId      = buf.length === 10 ? buf[8] : 0;
            const sessionCounter = buf.length === 10 ? buf[9] : buf[8];

            setDetectedBleId({ unitId, roomId, sessionCounter });

            let unitCode    = adaptiveConfig.getUnitCodeFromId(unitId);
            let lectureRoom = adaptiveConfig.getRoomCodeFromId(roomId);

            // GD fallback: for delegated group packets the BLE roomId may be a database FK
            // (small integer, not in the 8000-9999 BLE range). Use the cached delegation object.
            if (groupId !== 0 && (!lectureRoom || !unitCode)) {
                const del = activeDelegationsRef.current.find(
                    (d) => Number(d.groupNumber) === Number(groupId),
                );
                if (del) {
                    lectureRoom = lectureRoom || del.roomCode;
                    unitCode    = unitCode    || del.unitCode;
                }
            }

            if (!lectureRoom) {
                console.warn('[BLE] Ignoring: roomId', roomId, 'not in mappings and no delegation cache match.');
                return null;
            }

            return {
                unitCode,
                lectureRoom,
                sessionStart: timestampSec * 1000,
                sessionCounter,
                groupId,
                rawPayload: JSON.stringify({ unitCode, lectureRoom, sessionStart: timestampSec * 1000, groupId, sessionCounter }),
                raw: { unitId, roomId, timestampSec, groupId, sessionCounter },
            };
        } catch (error) {
            console.error('Error parsing BLE payload:', error);
            return null;
        }
    }, []);

    // Entrance animation
    useEffect(() => {
        Animated.parallel([
            Animated.timing(fadeAnim, {
                toValue: 1,
                duration: 600,
                useNativeDriver: true,
            }),
            Animated.timing(slideAnim, {
                toValue: 0,
                duration: 600,
                useNativeDriver: true,
                easing: Easing.out(Easing.ease),
            }),
        ]).start();
    }, [fadeAnim, slideAnim]);

    // Pulse animation
    useEffect(() => {
        if (!scannedData && scanCount === 0 && !isAutoMarking) {
            const pulse = Animated.sequence([
                Animated.timing(pulseAnim, {
                    toValue: 1.2,
                    duration: 1000,
                    useNativeDriver: true,
                    easing: Easing.inOut(Easing.ease),
                }),
                Animated.timing(pulseAnim, {
                    toValue: 1,
                    duration: 1000,
                    useNativeDriver: true,
                    easing: Easing.inOut(Easing.ease),
                }),
            ]);
            Animated.loop(pulse).start();
        } else {
            pulseAnim.setValue(1);
        }
    }, [scannedData, scanCount, pulseAnim, isAutoMarking]);

    // Rotation animation
    useEffect(() => {
        if (!isCameraReady) {
            Animated.loop(
                Animated.timing(rotateAnim, {
                    toValue: 1,
                    duration: 1000,
                    useNativeDriver: true,
                    easing: Easing.linear,
                })
            ).start();
        } else {
            rotateAnim.setValue(0);
        }
    }, [isCameraReady, rotateAnim]);

    const spin = rotateAnim.interpolate({
        inputRange: [0, 1],
        outputRange: ['0deg', '360deg'],
    });

    // App state handler — starts/stops background BLE scan task
    useEffect(() => {
        const subscription = AppState.addEventListener('change', async (nextAppState) => {
            const wasBackground = appStateRef.current.match(/inactive|background/);
            appStateRef.current = nextAppState;

            if (wasBackground && nextAppState === 'active') {
                // Stop any running background task
                try {
                    const BackgroundActions = require('react-native-background-actions').default;
                    if (BackgroundActions.isRunning()) await BackgroundActions.stop();
                } catch {}

                if (scannedDataRef.current) {
                    generateNewQrData();
                } else {
                    // Check for attendance marked while backgrounded
                    try {
                        const { BG_STUDENT_RESULT_KEY } = require('../../../services/backgroundBLEService');
                        const raw = await AsyncStorage.getItem(BG_STUDENT_RESULT_KEY);
                        if (raw) {
                            await AsyncStorage.removeItem(BG_STUDENT_RESULT_KEY);
                            const bgResult = JSON.parse(raw);
                            receivedSessionNonceRef.current = bgResult.sessionNonce ?? null;
                            setScannedData({
                                data: JSON.stringify(bgResult),
                                details: {
                                    unitCode:     bgResult.unitCode,
                                    lectureRoom:  bgResult.lectureRoom,
                                    sessionStart: bgResult.sessionStart,
                                },
                            });
                        }
                    } catch {}
                }
            } else if (nextAppState.match(/inactive|background/)) {
                // Start background BLE scan if attendance not yet marked
                if (!scannedDataRef.current && isBluetoothOn) {
                    try {
                        const BackgroundActions = require('react-native-background-actions').default;
                        const { studentBackgroundTask } = require('../../../services/backgroundBLEService');
                        await BackgroundActions.start(studentBackgroundTask, {
                            taskName:             'studentBLEScan',
                            taskTitle:            'Scanning for attendance...',
                            taskDesc:             'MarkWise will mark your attendance automatically',
                            taskIcon:             { name: 'ic_launcher', type: 'mipmap' },
                            color:                '#4F46E5',
                            foregroundServiceType: ['connectedDevice'],
                            parameters:           {},
                        });
                    } catch {}
                }
            }
        });

        return () => subscription.remove();
    }, [isBluetoothOn, generateNewQrData]);

    // Bluetooth state
    useEffect(() => {
        const subscription = manager.onStateChange((state) => {
            const newIsBluetoothOn = state === 'PoweredOn';
            setIsBluetoothOn(newIsBluetoothOn);
            if (!newIsBluetoothOn) setIsAdvertisingSupported(false);
        }, true);
        return () => subscription.remove();
    }, []);

    // Motion detection
    useEffect(() => {
        setUpdateIntervalForType(SensorTypes.accelerometer, 250);
        const motionSubscription = accelerometer.subscribe(({ x, y, z }) => {
            const currentMagnitude = Math.sqrt((x * x) + (y * y) + (z * z));
            const previousMagnitude = previousAccelerationMagnitudeRef.current;
            if (previousMagnitude != null) {
                const delta = Math.abs(currentMagnitude - previousMagnitude);
                if (delta >= MOTION_DELTA_THRESHOLD) {
                    const wasVerified = hasRecentMotion();
                    lastMotionDetectedAtRef.current = Date.now();
                    // Vibrate only once when transitioning from "not verified" → "verified"
                    // to avoid continuous buzzing while walking (4Hz accelerometer = many events)
                    if (!wasVerified) {
                        setIsMotionVerified(true);
                        Vibration.vibrate(50);
                    } else {
                        lastMotionDetectedAtRef.current = Date.now(); // refresh window silently
                    }
                }
            }
            previousAccelerationMagnitudeRef.current = currentMagnitude;
        });

        const freshnessTimer = setInterval(() => {
            setIsMotionVerified(hasRecentMotion());
        }, 500);

        return () => {
            motionSubscription.unsubscribe();
            clearInterval(freshnessTimer);
        };
    }, [hasRecentMotion]);

    // Session countdown
    useEffect(() => {
        let intervalId = null;
        const update = () => {
            const end = sessionManager.getSessionEnd();
            if (end && Date.now() < end) {
                const rem = Math.max(0, end - Date.now());
                setSessionRemainingMs(rem);
                setSessionActive(true);
            } else {
                setSessionRemainingMs(null);
                setSessionActive(false);
            }
        };

        update();
        intervalId = setInterval(update, 500);
        const listener = sessionManager.onSessionEnd(() => update());

        return () => {
            clearInterval(intervalId);
            sessionManager.removeListener(listener);
        };
    }, []);

    // Check advertising support
    useEffect(() => {
        if (!isBluetoothOn || !BLEAdvertiserModule) return;

        let cancelled = false;
        const MAX_ATTEMPTS = 4;
        const RETRY_DELAY_MS = 500;

        const check = async (attempt = 1) => {
            try {
                const supported = await BLEAdvertiserModule?.isAdvertisingSupported?.();
                if (cancelled) return;
                if (!supported && attempt < MAX_ATTEMPTS) {
                    setTimeout(() => { if (!cancelled) check(attempt + 1); }, RETRY_DELAY_MS);
                    return;
                }
                setIsAdvertisingSupported(!!supported);
            } catch (e) {
                if (cancelled) return;
                console.error('Failed to check BLE advertising support', e);
                setIsAdvertisingSupported(false);
            }
        };

        check();
        return () => { cancelled = true; };
    }, [isBluetoothOn]);

    // Load device ID
    useEffect(() => {
        let isMounted = true;
        const loadAttendanceDeviceId = async () => {
            try {
                const deviceId = await sqliteStorage.getOrCreateAttendanceDeviceId();
                if (isMounted) setAttendanceDeviceId(deviceId || '');
            } catch (error) {
                console.error('Failed to resolve attendance device id', error);
                if (isMounted) setAttendanceDeviceId('');
            }
        };
        loadAttendanceDeviceId();
        return () => { isMounted = false; };
    }, []);

    // Manual token timer
    useEffect(() => {
        const updateRemaining = () => {
            const now = Date.now();
            const currentWindow = Math.floor(now / MANUAL_TOKEN_ROTATION_MS);
            if (lastManualTokenWindowRef.current !== currentWindow) {
                lastManualTokenWindowRef.current = currentWindow;
                setManualTokenInput('');
                setManualTokenError('PIN rotated');
                setTimeout(() => setManualTokenError(''), 2000);
            }
            const remainingMs = MANUAL_TOKEN_ROTATION_MS - (now % MANUAL_TOKEN_ROTATION_MS);
            setManualTokenRemainingSec(Math.max(1, Math.ceil(remainingMs / 1000)));
        };

        updateRemaining();
        const intervalId = setInterval(updateRemaining, 250);
        return () => clearInterval(intervalId);
    }, []);

    // When attendance is marked, re-advertise the secure v0x01 beacon so peers can auto-mark.
    // PIN marks re-advertise once they capture a session nonce from a nearby peer beacon.
    useEffect(() => {
        let stopRequested = false;
        let rotationInterval = null;

        const stopAdvertising = async () => {
            if (rotationInterval) { clearInterval(rotationInterval); rotationInterval = null; }
            // Reset state synchronously so the UI is never stuck showing "Broadcasting"
            // if the native stop call throws or returns a non-Promise.
            setIsAdvertising(false);
            try {
                await BLEAdvertiserModule?.stopAdvertising?.();
            } catch (e) {
                if (!stopRequested) console.warn('[BLE] Failed to stop peer advertising:', e.message || e);
            }
        };

        // receivedSessionNonceRef.current is set before setScannedData in BLE/QR success paths.
        // For PIN marks it starts null and is populated once a peer beacon nonce is captured.
        const sessionNonce = receivedSessionNonceRef.current;

        if (scannedData && sessionActive && isBluetoothOn && isAdvertisingSupported &&
                scannedData.details && sessionNonce !== null) {

            const requestAdvertisePermission = async () => {
                if (Platform.OS === 'android' && Platform.Version >= 31) {
                    const granted = await PermissionsAndroid.request(
                        PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
                        {
                            title: 'Bluetooth Advertise Permission',
                            message: 'Required to broadcast attendance for peer-to-peer marking.',
                            buttonNeutral: 'Ask Me Later',
                            buttonNegative: 'Cancel',
                            buttonPositive: 'OK',
                        }
                    );
                    if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
                        setBleAdvertisingError('Bluetooth advertise permission denied');
                        return false;
                    }
                }
                return true;
            };

            const buildAndAdvertise = () => {
                const { unitCode, lectureRoom, sessionStart } = scannedData.details;
                const unitId = adaptiveConfig.getUnitId(unitCode);
                const roomId = adaptiveConfig.getRoomId(lectureRoom);
                if (unitId == null || roomId == null) {
                    setBleAdvertisingError('Cannot broadcast: mapping error');
                    return;
                }
                const sessionStartSec = Math.floor(sessionStart / 1000);
                const counter = deriveCounter(sessionStartSec, QR_WINDOW_SECONDS, Date.now());
                // Encode using the same secure 10-byte v0x01 format as the lecturer beacon.
                // Peers who receive this will validate it through the same attendanceValidator pipeline.
                const bytes = encodeBLEBeacon({
                    sessionNonce: sessionNonce & 0xFFFF,
                    counter,
                    unitId,
                    roomId,
                    lessonTypeId: 0,
                });
                const base64Payload = btoa(bytes);
                BLEAdvertiserModule?.startAdvertising?.(base64Payload)
                    ?.then(() => {
                        setIsAdvertising(true);
                        setBleAdvertisingError('');
                    })
                    ?.catch((e) => {
                        setBleAdvertisingError('Failed to advertise');
                        setIsAdvertising(false);
                        console.error('[BLE] Failed to start peer advertising:', e);
                    });
            };

            (async () => {
                try {
                    const hasPermission = await requestAdvertisePermission();
                    if (!hasPermission) return;
                    buildAndAdvertise();
                    // Rotate beacon every QR window so the time-based counter stays current.
                    // Peers validate counter drift within ±MAX_COUNTER_DRIFT windows.
                    rotationInterval = setInterval(buildAndAdvertise, QR_ROTATION_MS);
                } catch (e) {
                    setBleAdvertisingError('Failed to prepare BLE payload');
                    setIsAdvertising(false);
                    console.error('[BLE] Peer-to-peer advertising error:', e);
                }
            })();
        } else {
            stopAdvertising();
        }

        return () => {
            stopRequested = true;
            stopAdvertising();
        };
    }, [scannedData, sessionActive, isBluetoothOn, isAdvertisingSupported, peerSessionNonce]);

    // ===== OPTIMIZED BLE AUTO-MARKING WITH RAF AND FAST DEDUPLICATION =====
    const handleBLEDetection = useCallback((parsed) => {
        if (scannedDataRef.current || isScanCooldown) return;

        // Group restriction check (delegated GD sessions)
        const { groupId = 0 } = parsed;
        if (groupId !== 0) {
            // Use the same normalisation as the cache key (strips spaces + non-alphanumeric)
            const normalizedUnit = normalizeUnitCode(parsed.unitCode || '');
            const myGroupNumber = myGroupsRef.current[normalizedUnit];
            if (myGroupNumber == null || Number(myGroupNumber) !== Number(groupId)) {
                setBleFeedbackMessage('You are not in this group');
                return;
            }
        }
        
        // Set detected session for UI
        setDetectedSession(parsed);
        
        setIsAutoMarking(true);
        setAutoMarkProgress(30);
        const { unitCode, lectureRoom, sessionStart } = parsed;
        const sessionKey = `${unitCode}|${lectureRoom}|${sessionStart}`;
        // If all checks except motion pass, do NOT block on 'Already detected' -- allow pending motion
        if (seenSessionsRef.current.has(sessionKey)) {
            // If we are missing motion, allow pending motion session
            if (!hasRecentMotion()) {
                setBleFeedbackMessage('Almost there! Move your phone to mark attendance.');
                setPendingMotionSession({ parsed });
                setIsAutoMarking(false);
                return;
            } else {
                setBleFeedbackMessage('Already detected');
                setIsAutoMarking(false);
                return;
            }
        }
        // Schedule the rest of the logic in requestAnimationFrame for instant UI update
        requestAnimationFrame(async () => {
            let codeToCheck = unitCode;
            if (adaptiveConfig && adaptiveConfig.mappings) {
                const normalizedInput = adaptiveConfig.normalizeCode(unitCode);
                let foundCode = null;
                for (const [, mapping] of adaptiveConfig.mappings.unitMappings.entries()) {
                    if (
                        mapping.displayName &&
                        adaptiveConfig.normalizeCode(mapping.displayName) === normalizedInput
                    ) {
                        foundCode = mapping.rawCode;
                        break;
                    }
                }
                if (foundCode) codeToCheck = foundCode;
            }
            if (!checkEnrollment(codeToCheck)) {
                setBleFeedbackMessage('Not enrolled');
                setIsAutoMarking(false);
                return;
            }
            if (!sessionManager.isSessionActive()) sessionManager.startSessionAt(sessionStart, groupId !== 0 ? GD_SESSION_DURATION_MS : SESSION_DURATION_MS);
            if (!sessionManager.isSessionActive()) {
                setBleFeedbackMessage('Session expired');
                setIsAutoMarking(false);
                return;
            }
            if (!hasRecentMotion()) {
                setBleFeedbackMessage('Almost there! Move your phone to mark attendance.');
                setPendingMotionSession({ parsed });
                setIsAutoMarking(false);
                return;
            }
            
            if (!attendanceDeviceId) {
                setBleFeedbackMessage('Device error');
                setIsAutoMarking(false);
                return;
            }
            setAutoMarkProgress(60);
            // UI-level deduplication now in persistAttendance
            setAutoMarkProgress(90);
            const saveResult = await persistAttendance({
                unitCode,
                lectureRoom,
                sessionStart,
                rawPayload: parsed.rawPayload ?? JSON.stringify(parsed),
                deviceId: attendanceDeviceId,
                // GD group records are submitted to the backend by the leader via
                // endDelegatedSession — pre-mark synced so offline/submit is skipped.
                synced: groupId !== 0 ? 1 : 0,
                lessonType: groupId !== 0 ? 'GRD' : null,
            });
            if (saveResult?.duplicate) {
                setBleFeedbackMessage('Already marked');
                setIsAutoMarking(false);
                return;
            }
            if (saveResult?.saved) {
                seenSessionsRef.current.add(sessionKey);
                setAutoMarkProgress(100);
                setFeedbackMessage('✓ Auto-marked!');
                receivedSessionNonceRef.current = parsed.raw?.sessionNonce ?? null; // nonce for secure peer re-advertising
                setScannedData({
                    data: JSON.stringify(parsed),
                    details: { unitCode, lectureRoom, sessionStart },
                });
                Vibration.vibrate([0, 100, 50, 100]);
                resetAutoMark(true);
            } else {
                setBleFeedbackMessage('Save failed');
                setIsAutoMarking(false);
            }
        });
    }, [isScanCooldown, checkEnrollment, attendanceDeviceId, hasRecentMotion, resetAutoMark]);

    // Effect: If pendingMotionSession exists and motion is detected, mark attendance
    useEffect(() => {
        if (scannedDataRef.current) { setPendingMotionSession(null); return; }
        if (pendingMotionSession && isMotionVerified) {
            const { parsed } = pendingMotionSession;
            setBleFeedbackMessage('Marking attendance...');
            setPendingMotionSession(null);
            (async () => {
                setIsAutoMarking(true);
                setAutoMarkProgress(30);
                const { unitCode, lectureRoom, sessionStart } = parsed;
                const sessionKey = `${unitCode}|${lectureRoom}|${sessionStart}`;
                // Do NOT check seenSessionsRef here; allow marking after motion
                if (!checkEnrollment(unitCode)) {
                    setBleFeedbackMessage('Not enrolled');
                    setIsAutoMarking(false);
                    return;
                }
                const pendingGroupId = parsed.groupId ?? 0;
                if (!sessionManager.isSessionActive()) sessionManager.startSessionAt(sessionStart, pendingGroupId !== 0 ? GD_SESSION_DURATION_MS : SESSION_DURATION_MS);
                if (!sessionManager.isSessionActive()) {
                    setBleFeedbackMessage('Session expired');
                    setIsAutoMarking(false);
                    return;
                }
                if (!attendanceDeviceId) {
                    setBleFeedbackMessage('Device error');
                    setIsAutoMarking(false);
                    return;
                }
                setAutoMarkProgress(60);
                // UI-level deduplication now in persistAttendance
                setAutoMarkProgress(90);
                const saveResult = await persistAttendance({
                    unitCode,
                    lectureRoom,
                    sessionStart,
                    rawPayload: parsed.rawPayload ?? JSON.stringify(parsed),
                    deviceId: attendanceDeviceId,
                    synced: pendingGroupId !== 0 ? 1 : 0,
                    lessonType: pendingGroupId !== 0 ? 'GD' : null,
                });
                if (saveResult?.duplicate) {
                    setBleFeedbackMessage('Already marked');
                    setIsAutoMarking(false);
                    return;
                }
                if (saveResult?.saved) {
                    seenSessionsRef.current.add(sessionKey);
                    setAutoMarkProgress(100);
                    setFeedbackMessage('✓ Auto-marked!');
                    receivedSessionNonceRef.current = parsed.raw?.sessionNonce ?? null; // nonce for secure peer re-advertising
                    setScannedData({
                        data: JSON.stringify(parsed),
                        details: { unitCode, lectureRoom, sessionStart },
                    });
                    Vibration.vibrate([0, 100, 50, 100]);
                    resetAutoMark(true);
                } else {
                    setBleFeedbackMessage('Save failed');
                    setIsAutoMarking(false);
                }
            })();
        }
    }, [pendingMotionSession, isMotionVerified, checkEnrollment, attendanceDeviceId, resetAutoMark]);

    // ===== BLE SCANNER =====
    useEffect(() => {
        // Keep scanning after a PIN mark so the student can capture a peer nonce for relay.
        // Only stop once both scannedData AND a nonce are in hand.
        if (scannedDataRef.current && receivedSessionNonceRef.current !== null) return;

        if (isBluetoothOn) {
            const startBleScan = async () => {
                try {
                    setBleScanError('');
                    if (Platform.OS === 'android') {
                        if (Platform.Version >= 31) {
                            const granted = await PermissionsAndroid.request(
                                PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
                                {
                                    title: 'Bluetooth scan permission',
                                    message: 'Required to discover nearby attendance signals.',
                                    buttonNeutral: 'Ask Me Later',
                                    buttonNegative: 'Cancel',
                                    buttonPositive: 'OK',
                                }
                            );
                            if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
                                setBleScanError('Bluetooth scan permission denied');
                                return;
                            }
                        } else {
                            const granted = await PermissionsAndroid.request(
                                PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
                                {
                                    title: 'Location permission',
                                    message: 'Required to discover nearby Bluetooth devices on older Android versions.',
                                    buttonNeutral: 'Ask Me Later',
                                    buttonNegative: 'Cancel',
                                    buttonPositive: 'OK',
                                }
                            );
                            if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
                                setBleScanError('Location permission denied');
                                return;
                            }
                        }
                    }
                    // Always use the fastest scan mode available
                    if (!BLEScanner) {
                        setBleScanError('BLE scanner not available on this device');
                        return;
                    }
                    if (BLEScanner.startScanNoFilter) {
                        await BLEScanner.startScanNoFilter();
                        setBleFeedbackMessage('Scanning for attendance (fastest)...');
                    } else {
                        await BLEScanner.startScan(SERVICE_UUID);
                        setBleFeedbackMessage('Scanning...');
                    }
                } catch (error) {
                    const errorMsg = error.message || 'BLE scanning not available';
                    console.error('BLE scan error:', error);
                    setBleScanError(errorMsg);
                    setBleFeedbackMessage('');
                }
            };

            startBleScan();

            const onDeviceFoundListener = bleScannerEmitter?.addListener('onDeviceFound', async (device) => {
                const payload = device?.payload || device?.advertisementData || device?.data || '';

                if (scannedDataRef.current) {
                    // Student already marked — try to capture a session nonce from a peer beacon
                    // so PIN-marked students can start BLE relay advertising.
                    if (receivedSessionNonceRef.current === null) {
                        const pinParsed = await parseBinaryPayload(payload);
                        if (pinParsed?.raw?.sessionNonce != null) {
                            const { unitCode, lectureRoom } = scannedDataRef.current.details ?? {};
                            const normCode = s => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
                            if (unitCode && lectureRoom &&
                                normCode(pinParsed.unitCode) === normCode(unitCode) &&
                                normCode(pinParsed.lectureRoom) === normCode(lectureRoom)) {
                                receivedSessionNonceRef.current = pinParsed.raw.sessionNonce;
                                setPeerSessionNonce(pinParsed.raw.sessionNonce);
                            }
                        }
                    }
                    return; // already marked — never re-mark regardless of method
                }
                if (isAutoMarking) return;

                const parsed = await parseBinaryPayload(payload);
                if (!parsed) return;

                handleBLEDetection(parsed);

                // --- Probabilistic relay selection (coverage extension, Android only) ---
                // Always cache the freshest raw payload for re-election with an up-to-date counter.
                relayPayloadRef.current = payload;
                // Election probability scales with RSSI — strong-signal devices self-select.
                // No UI change, no state update — purely background.
                if (!isRelayingRef.current && BLEAdvertiserModule && Platform.OS === 'android') {
                    const rssi = typeof device.rssi === 'number' ? device.rssi : -80;
                    const rssiNorm = Math.max(0, Math.min(1,
                        (rssi - RELAY_RSSI_MIN) / (RELAY_RSSI_MAX - RELAY_RSSI_MIN)
                    ));
                    const electionP = rssiNorm * (RELAY_TARGET_COUNT / 500);
                    if (Math.random() < electionP) {
                        isRelayingRef.current = true;
                        const staggerMs = Math.floor(Math.random() * RELAY_STAGGER_MS);
                        relayTimerRef.current = setTimeout(async () => {
                            // Use the freshest payload captured since election to relay a current counter
                            const freshPayload = relayPayloadRef.current ?? payload;
                            try {
                                if (BLEAdvertiserModule.startAdvertisingWithServiceUUID) {
                                    await BLEAdvertiserModule.startAdvertisingWithServiceUUID(freshPayload, SERVICE_UUID);
                                } else {
                                    await BLEAdvertiserModule.startAdvertising(freshPayload);
                                }
                                // Stop after 3 QR windows so the next device-found can re-elect
                                // with a fresher counter, preventing stale relay collisions.
                                relayTimerRef.current = setTimeout(() => {
                                    BLEAdvertiserModule.stopAdvertising?.().catch(() => {});
                                    isRelayingRef.current = false;
                                    relayTimerRef.current = null;
                                }, QR_ROTATION_MS * 3);
                            } catch (e) {
                                console.warn('[BLE Relay] Could not start relay:', e.message);
                                isRelayingRef.current = false;
                                relayTimerRef.current = null;
                            }
                        }, staggerMs);
                    }
                }
                // -----------------------------------------------------------------------
            });

            const onScanErrorListener = bleScannerEmitter?.addListener('onScanError', (err) => {
                const msg = err && err.message ? err.message : 'BLE scan error';
                setBleScanError(msg);
                setBleFeedbackMessage('');
            });

            return () => {
                if (BLEScanner?.stopScan) BLEScanner.stopScan();
                onDeviceFoundListener?.remove();
                onScanErrorListener?.remove();
                
                if (autoMarkTimerRef.current) {
                    clearTimeout(autoMarkTimerRef.current);
                    autoMarkTimerRef.current = null;
                }
                if (progressIntervalRef.current) {
                    clearInterval(progressIntervalRef.current);
                    progressIntervalRef.current = null;
                }
                if (scanCooldownTimerRef.current) {
                    clearTimeout(scanCooldownTimerRef.current);
                    scanCooldownTimerRef.current = null;
                }
                // Stop relay advertising on BLE scan teardown
                if (isRelayingRef.current) {
                    BLEAdvertiserModule?.stopAdvertising?.().catch(() => {});
                    isRelayingRef.current = false;
                }
                if (relayTimerRef.current) {
                    clearTimeout(relayTimerRef.current);
                    relayTimerRef.current = null;
                }
            };
        }
    }, [isBluetoothOn, parseBinaryPayload, handleBLEDetection, scannedData, peerSessionNonce, isAutoMarking]);

    const generateNewQrData = useCallback(() => {
        // QR relay: re-display the original MWQR0x01 token received from the lecturer.
        // The embedded HMAC is still verifiable by the backend at sync time.
        setRegeneratedQrData(receivedQrDataRef.current || '');
        // PIN relay: show the 6-digit PIN entered by this student (valid for PIN_WINDOW_SECONDS).
        setRelayManualPin(relayPinRef.current || '');
    }, []);

    // QR rotation timer
    useEffect(() => {
        if (!scannedData) return;

        if (qrTimerRef.current) clearTimeout(qrTimerRef.current);

        const scheduleNextUpdate = () => {
            const now = Date.now();
            const timeUntilNextEpoch = QR_ROTATION_MS - (now % QR_ROTATION_MS);
            
            qrTimerRef.current = setTimeout(() => {
                generateNewQrData();
                if (sessionActive) {
                    scheduleNextUpdate();
                }
            }, timeUntilNextEpoch);
        };

        generateNewQrData();
        if (sessionActive) {
            scheduleNextUpdate();
        }

        return () => {
            if (qrTimerRef.current) clearTimeout(qrTimerRef.current);
        };
    }, [scannedData, sessionActive, generateNewQrData]);

    const toggleBluetooth = async (value) => {
        if (value) {
            try {
                setIsToggleBusy(true);
                if (Platform.OS === 'android' && BLEAdvertiserModule?.requestEnableBluetooth) {
                    if (Platform.Version >= 31) {
                        const granted = await PermissionsAndroid.request(
                            PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
                            {
                                title: 'Bluetooth permission',
                                message: 'Required to enable and use Bluetooth.',
                                buttonNeutral: 'Ask Me Later',
                                buttonNegative: 'Cancel',
                                buttonPositive: 'OK',
                            }
                        );
                        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
                            setToastMessage('Bluetooth permission denied');
                            setShowToast(true);
                            setTimeout(() => setShowToast(false), 2000);
                            return;
                        }
                    }
                    const enabled = await BLEAdvertiserModule?.requestEnableBluetooth?.();
                    if (enabled) {
                        setToastMessage('Bluetooth enabled');
                        setShowToast(true);
                        setTimeout(() => setShowToast(false), 2000);
                    } else {
                        setToastMessage('Could not enable Bluetooth');
                        setShowToast(true);
                        setTimeout(() => setShowToast(false), 2200);
                    }
                } else {
                    Alert.alert('Enable Bluetooth', 'Please enable Bluetooth in system settings.', [
                        { text: 'Open Settings', onPress: () => Linking.openSettings() },
                        { text: 'Cancel', style: 'cancel' },
                    ]);
                }
            } catch (e) {
                console.error('Bluetooth error:', e);
                Alert.alert('Bluetooth', 'Could not enable Bluetooth.');
            } finally {
                setIsToggleBusy(false);
            }
        } else {
            Alert.alert('Disable Bluetooth', 'Use system settings to turn off Bluetooth.', [
                { text: 'Open Settings', onPress: () => Linking.openSettings() },
                { text: 'OK', style: 'cancel' },
            ]);
        }
    };

    const handleManualTokenSubmit = useCallback(async () => {
        if (scannedDataRef.current) { setManualTokenError('Already marked for this session'); return; }
        const normalizedToken = normalizeManualAttendanceTokenInput(manualTokenInput);
        if (!normalizedToken) {
            setManualTokenError('Enter the 6-digit PIN');
            return;
        }

        if (!attendanceDeviceId) {
            setManualTokenError('Device verification unavailable');
            return;
        }


        // Extract just the unit code (e.g., SCH2170) for PIN validation
        const extractedUnitCode = extractUnitCodeFromEnrollment(manualUnitCodeInput);
        const manualUnitCode = normalizeUnitCode(extractedUnitCode);
        const manualLectureRoom = normalizeUnitCode(manualLectureRoomInput);
        if (!manualUnitCode || !manualLectureRoom) {
            setManualTokenError('Enter both unit code and room');
            return;
        }

        setIsManualSubmitting(true);

        try {
            // Detect GD session: student is in a group for this unit, or leader has a delegation.
            // Either signal means the marking window should be GD_SESSION_DURATION_MS (10 min).
            const myGroupNumber = myGroupsRef.current[manualUnitCode];
            const hasActiveDelegation = activeDelegationsRef.current.some(
                (d) => normalizeUnitCode(d.unitCode) === manualUnitCode,
            );
            const isGDSession = myGroupNumber != null || hasActiveDelegation;
            const manualSessionDuration = isGDSession ? GD_SESSION_DURATION_MS : SESSION_DURATION_MS;

            // Build synthetic cachedSession — student may not have pre-synced.
            // Session-active check is best-effort; actual PIN value is verified by backend at sync.
            const sessionDurationSec = Math.floor(manualSessionDuration / 1000);
            const nowS = Math.floor(Date.now() / 1000);
            const cachedSession = {
                sessionStart: nowS - sessionDurationSec,
                sessionDuration: sessionDurationSec * 2,
            };

            const validation = validateManualAttendanceToken({
                token: normalizedToken,
                cachedSession,
                atMs: Date.now(),
            });
            if (!validation.isValid) {
                setManualTokenError(
                    validation.reason === 'format' ? 'Enter a valid 6-digit PIN' : 'Invalid or expired token'
                );
                return;
            }

            const unitCode = manualUnitCode;
            const lectureRoom = manualLectureRoom;
            // Align to the current session-duration epoch so dedup is stable across
            // multiple submissions that arrive within the same session window.
            const sessionStart = Math.floor(nowS / sessionDurationSec) * sessionDurationSec * 1000;

            // Use enhanced enrollment check
            if (!checkEnrollment(unitCode)) {
                setManualTokenError('Not enrolled for this unit');
                return;
            }

            sessionManager.startSessionAt(sessionStart, manualSessionDuration);
            if (!sessionManager.isSessionActive()) {
                setManualTokenError('Session expired');
                return;
            }

            if (!hasRecentMotion()) {
                setManualTokenError('Move phone to verify presence');
                return;
            }

            // Absolute time-window counter: floor(nowMs / 30000).
            // The backend converts to a session-relative counter by subtracting
            // floor(session.sessionStart / 30) before computing the expected PIN.
            // This avoids needing to know sessionStart on the student device.
            const absolutePinCounter = Math.floor(Date.now() / MANUAL_TOKEN_ROTATION_MS);
            const saveResult = await persistAttendance({
                unitCode,
                lectureRoom,
                sessionStart,
                rawPayload: `MANUAL:${validation.normalizedToken}:${absolutePinCounter}`,
                deviceId: attendanceDeviceId,
            });
            if (saveResult?.duplicate) {
                setManualTokenError('Already marked');
                return;
            }
            if (!saveResult?.saved) {
                setManualTokenError('Could not save. Try again.');
                return;
            }

            setFeedbackMessage('✓ Success! (Manual)');
            setScannedData({
                data: `MANUAL:${normalizedToken}`,
                details: { unitCode, lectureRoom, sessionStart },
            });
            relayPinRef.current = validation.normalizedToken; // store PIN for peer relay
            setManualTokenError('');
            setManualTokenInput('');
            setManualUnitCodeInput('');
            setManualLectureRoomInput('');
            setScanCount(0);
            setFirstScannedData(null);
            setLastScanned('');
            setIsManualDialogVisible(false);
            Vibration.vibrate([0, 100, 50, 100]);
        } catch (error) {
            console.error('Manual PIN submission error:', error);
            setManualTokenError('An error occurred. Try again.');
        } finally {
            setIsManualSubmitting(false);
        }
    }, [manualTokenInput, manualUnitCodeInput, manualLectureRoomInput, checkEnrollment, attendanceDeviceId, hasRecentMotion]);

    const handleScan = useCallback(async (data) => {
        // Use refs throughout — native events fire faster than React re-renders,
        // so reading state from a closure gives stale values that misroute scan 2 back to scan 1.
        if (scannedDataRef.current) return;
        if (handlingScanRef.current) return; // prevent re-entrant async execution
        handlingScanRef.current = true;

        try {
            if (typeof data !== 'string') return;
            const rawScan = data.trim();
            if (!rawScan) return;

            // Decode MWQR0x01 signed payload — returns { payload, counter, token } or null
            const decodedQr = decodeQrPayload(rawScan);
            if (!decodedQr || !decodedQr.payload) {
                return;
            }

            const { payload, counter, token } = decodedQr;
            const { unitId, roomId, sessionStart: sessionStartSec, sessionDuration: sessionDurationSec, sessionNonce: qrSessionNonce } = payload;

            // Resolve numeric IDs to display codes from the locally-cached mapping.
            // The proactive useFocusEffect sync ensures the cache is warm before scanning starts;
            // if for any reason mappings are still missing, release the lock immediately so the
            // camera continues to emit frames — the next scan attempt will succeed once the
            // background sync (also triggered here) finishes.
            let rawUnitCode = adaptiveConfig.getUnitCodeFromId(unitId);
            let rawRoomCode = adaptiveConfig.getRoomCodeFromId(roomId);
            if (!rawUnitCode || !rawRoomCode) {
                // Kick off a background sync but do NOT await it — releasing handlingScanRef
                // lets camera events continue to flow during the fetch.
                getStudentSession().then(s => {
                    if (s?.institutionId && s?.token) {
                        adaptiveConfig.setInstitution(s.institutionId);
                        adaptiveConfig.syncInstitutionMappingsFromBackend(s.institutionId, s.token).catch(() => {});
                    }
                }).catch(() => {});
                setFeedbackMessage('Syncing — scan again shortly');
                setTimeout(() => setFeedbackMessage(''), 3000);
                return;
            }

            const unitCode = normalizeUnitCode(rawUnitCode);
            const lectureRoom = rawRoomCode;
            const sessionStart = sessionStartSec * 1000; // seconds → ms
            const qrSessionDuration = sessionDurationSec * 1000; // seconds → ms
            const now = Date.now();

            if (!checkEnrollment(unitCode)) {
                setFeedbackMessage('Not enrolled');
                setTimeout(() => setFeedbackMessage(''), 1500);
                return;
            }

            if (!attendanceDeviceId) {
                setFeedbackMessage('Device error');
                setTimeout(() => setFeedbackMessage(''), 1200);
                return;
            }

            if (sessionStart - now > TIMESTAMP_TOLERANCE_MS) {
                setFeedbackMessage('Session not started');
                setTimeout(() => setFeedbackMessage(''), 700);
                return;
            }

            if (now > sessionStart + qrSessionDuration) {
                setFeedbackMessage('Code expired');
                setTimeout(() => setFeedbackMessage(''), 400);
                return;
            }

            // 500ms dedup per counter window — prevents duplicate events from the same QR frame
            const scanKey = `${unitCode}@${lectureRoom}:${counter}`;
            if (lastScannedRef.current === scanKey && (now - lastScanTimeRef.current) < 500) return;
            lastScannedRef.current = scanKey;
            setLastScanned(scanKey);
            lastScanTimeRef.current = now;

            // First scan
            if (scanCountRef.current === 0) {
                const entry = { unitCode, lectureRoom, sessionStart, token, counter };
                firstScannedDataRef.current = entry;
                scanCountRef.current = 1;
                setFirstScannedData(entry);
                setScanCount(1);
                setFeedbackMessage('Scan 1 of 2');
                Vibration.vibrate(100);
                sessionManager.startSessionAt(sessionStart, qrSessionDuration);
                if (!sessionManager.isSessionActive()) {
                    setFeedbackMessage('Session expired');
                    scanCountRef.current = 0;
                    firstScannedDataRef.current = null;
                    setScanCount(0);
                    setFirstScannedData(null);
                    setTimeout(() => setFeedbackMessage(''), 1200);
                }
                return;
            }

            // Second scan — confirm same session
            if (scanCountRef.current === 1 && firstScannedDataRef.current) {
                if (!sessionManager.isSessionActive()) {
                    setFeedbackMessage('Session expired');
                    scanCountRef.current = 0;
                    firstScannedDataRef.current = null;
                    setScanCount(0);
                    setFirstScannedData(null);
                    setTimeout(() => setFeedbackMessage(''), 1200);
                    return;
                }

                const first = firstScannedDataRef.current;
                if (counter === first.counter) {
                    // Same 3-second window — QR hasn't rotated yet. Show time remaining
                    // in this window so students know to wait rather than assume failure.
                    const msIntoWindow = Date.now() % QR_ROTATION_MS;
                    const waitSec = Math.ceil((QR_ROTATION_MS - msIntoWindow) / 1000);
                    setFeedbackMessage(`QR refreshing in ${waitSec}s — scan again`);
                    setTimeout(() => setFeedbackMessage('Scan 1 of 2 ✓ — scan new QR'), waitSec * 1000);
                    return;
                }
                if (normalizeUnitCode(first.unitCode) !== unitCode || first.lectureRoom !== lectureRoom) {
                    setFeedbackMessage('Wrong Class!');
                    scanCountRef.current = 0;
                    firstScannedDataRef.current = null;
                    setScanCount(0);
                    setFirstScannedData(null);
                    setTimeout(() => setFeedbackMessage(''), 1500);
                    return;
                }

                if (!hasRecentMotion()) {
                    setFeedbackMessage('Move to verify');
                    setTimeout(() => setFeedbackMessage(''), 1500);
                    return;
                }

                if (!attendanceDeviceId) {
                    setFeedbackMessage('Device error');
                    setTimeout(() => setFeedbackMessage(''), 1200);
                    return;
                }

                const confirmedSessionStart = first.sessionStart;
                // Store the full MWQR0x01 string — backend needs encodedPayload + counter + token
                // to reconstruct the exact HMAC message for verification.
                const saveResult = await persistAttendance({
                    unitCode,
                    lectureRoom,
                    sessionStart: confirmedSessionStart,
                    rawPayload: rawScan,
                    deviceId: attendanceDeviceId,
                });
                if (saveResult?.duplicate) {
                    setFeedbackMessage('Already marked');
                    scanCountRef.current = 0;
                    firstScannedDataRef.current = null;
                    setScanCount(0);
                    setFirstScannedData(null);
                    setTimeout(() => setFeedbackMessage(''), 1200);
                    return;
                }
                if (!saveResult?.saved) {
                    setFeedbackMessage('Save failed');
                    setTimeout(() => setFeedbackMessage(''), 1200);
                    return;
                }
                setFeedbackMessage('✓ Success!');
                const result = {
                    data: token,
                    details: { unitCode, lectureRoom, sessionStart: confirmedSessionStart },
                };
                scannedDataRef.current = result;
                receivedSessionNonceRef.current = qrSessionNonce ?? null; // nonce for secure peer re-advertising
                receivedQrDataRef.current = rawScan; // store MWQR0x01 string for peer QR relay
                setScannedData(result);
                scanCountRef.current = 0;
                firstScannedDataRef.current = null;
                lastScannedRef.current = '';
                setScanCount(0);
                setFirstScannedData(null);
                setLastScanned('');
                Vibration.vibrate([0, 100, 50, 100]);
            }
        } catch (error) {
            if (__DEV__) console.error('❌ Error in handleScan:', error);
            setFeedbackMessage('Invalid QR');
            setTimeout(() => setFeedbackMessage(''), 400);
        } finally {
            handlingScanRef.current = false;
        }
    }, [checkEnrollment, attendanceDeviceId, hasRecentMotion]);

    const resetScan = () => {
        scannedDataRef.current = null;
        scanCountRef.current = 0;
        firstScannedDataRef.current = null;
        lastScannedRef.current = '';
        handlingScanRef.current = false;
        receivedQrDataRef.current = null;       // prevent stale QR relay across sessions
        relayPinRef.current = null;             // prevent stale PIN relay across sessions
        receivedSessionNonceRef.current = null; // prevent stale nonce from bleeding into next session
        setScannedData(null);
        setRegeneratedQrData('');
        setRelayManualPin('');
        setFeedbackMessage('');
        setScanCount(0);
        setFirstScannedData(null);
        setLastScanned('');
        setManualTokenError('');
        setManualTokenInput('');
        setManualUnitCodeInput('');
        setManualLectureRoomInput('');
        setDetectedBleId(null);
        setDetectedSession(null);
        setIsManualDialogVisible(false);
        seenSessionsRef.current.clear();
        resetAutoMark();
    };

    if (isConfigLoading) {
        return (
            <View style={styles.darkContainer}>
                <LinearGradient
                    colors={[C.bgPrimary, C.bgPrimary]}
                    style={styles.loadingContainer}
                >
                    <ActivityIndicator size="large" color={C.primaryMain} />
                    <Text style={styles.loadingText}>Initializing attendance system...</Text>
                </LinearGradient>
            </View>
        );
    }

    if (hasPermission === null) {
        return (
            <View style={styles.darkContainer}>
                <LinearGradient
                    colors={[C.bgPrimary, C.bgPrimary]}
                    style={styles.loadingContainer}
                >
                    <Animated.View style={{ transform: [{ rotate: spin }] }}>
                        <Icon name="qr-code-outline" size={64} color={C.primaryMain} />
                    </Animated.View>
                    <Text style={styles.loadingText}>Requesting camera permission...</Text>
                </LinearGradient>
            </View>
        );
    }

    if (hasPermission === false) {
        return (
            <SafeAreaView style={styles.darkContainer} edges={['top']}>
                <LinearGradient colors={C.primaryGradient} style={styles.permissionContainer}>
                    <Icon name="camera-outline" size={64} color="#FFFFFF" />
                    <Text style={styles.permissionTitle}>Camera Required</Text>
                    <Text style={styles.permissionText}>
                        Enable camera access to scan QR codes for attendance.
                    </Text>
                    <TouchableOpacity onPress={openSettings} style={styles.settingsButton}>
                        <LinearGradient colors={C.purpleGradient} style={styles.settingsButtonGradient}>
                            <Text style={styles.settingsButtonText}>Open Settings</Text>
                        </LinearGradient>
                    </TouchableOpacity>
                </LinearGradient>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.darkContainer} edges={['top']}>
            <OfflineBanner />

            {/* Manual PIN Dialog */}
            <ManualPinDialog
                visible={isManualDialogVisible}
                onClose={() => {
                    setIsManualDialogVisible(false);
                    setManualTokenError('');
                }}
                onSubmit={handleManualTokenSubmit}
                manualTokenInput={manualTokenInput}
                setManualTokenInput={setManualTokenInput}
                manualUnitCodeInput={manualUnitCodeInput}
                setManualUnitCodeInput={setManualUnitCodeInput}
                manualLectureRoomInput={manualLectureRoomInput}
                setManualLectureRoomInput={setManualLectureRoomInput}
                manualTokenError={manualTokenError}
                manualTokenRemainingSec={manualTokenRemainingSec}
                isSubmitting={isManualSubmitting}
                enrolledUnits={enrolledUnits}
                getUnitDisplayName={getUnitDisplayName}
                styles={styles}
                colors={colors}
            />

            {/* Help Modal */}
            <Modal
                visible={showHelp}
                transparent
                animationType="fade"
                onRequestClose={() => setShowHelp(false)}
            >
                <Pressable style={styles.modalOverlay} onPress={() => setShowHelp(false)}>
                    <View style={[styles.helpModalContent, isTablet && { width: Math.min(windowWidth * 0.8, 560), maxHeight: windowHeight * 0.85 }]}>
                        <LinearGradient colors={C.primaryGradient} style={styles.helpHeader}>
                            <Icon name="information-circle" size={48} color="#FFFFFF" />
                            <Text style={styles.helpTitle}>About Auto Attendance</Text>
                        </LinearGradient>
                        <ScrollView style={styles.helpBody}>
                            <Text style={styles.helpText}>
                                The app now supports automatic attendance marking via Bluetooth!
                            </Text>
                            <View style={styles.helpItem}>
                                <Icon name="bluetooth" size={20} color={C.primaryMain} />
                                <Text style={styles.helpItemText}>
                                    Keep Bluetooth ON for auto-detection
                                </Text>
                            </View>
                            <View style={styles.helpItem}>
                                <Icon name="walk" size={20} color={C.successMain} />
                                <Text style={styles.helpItemText}>
                                    A slight movement verifies your presence
                                </Text>
                            </View>
                            <View style={styles.helpItem}>
                                <Icon name="time" size={20} color={C.warningMain} />
                                <Text style={styles.helpItemText}>
                                    Attendance marks automatically after detection
                                </Text>
                            </View>
                            <Text style={styles.helpNote}>
                                No need to scan QR codes! Just walk into the lecture room with Bluetooth enabled.
                            </Text>
                            <TouchableOpacity style={styles.helpButton} onPress={() => setShowHelp(false)}>
                                <Text style={styles.helpButtonText}>Got it</Text>
                            </TouchableOpacity>
                        </ScrollView>
                    </View>
                </Pressable>
            </Modal>

            {/* Info Modal */}
            <Modal
                visible={showInfoModal}
                transparent
                animationType="fade"
                onRequestClose={() => setShowInfoModal(false)}
            >
                <Pressable style={styles.modalOverlay} onPress={() => setShowInfoModal(false)}>
                    <Animated.View style={[styles.modalContent]}>
                        <LinearGradient colors={C.primaryGradient} style={styles.modalGradient}>
                            <Icon name="information-circle" size={48} color="#FFFFFF" />
                            <Text style={styles.modalTitle}>Why Bluetooth?</Text>
                            <Text style={styles.modalBody}>
                                Bluetooth broadcasts short-range signals so nearby devices can discover and
                                confirm attendance without scanning a visible QR.
                            </Text>
                            <TouchableOpacity onPress={() => setShowInfoModal(false)} style={styles.modalButton}>
                                <LinearGradient colors={C.successGradient} style={styles.modalButtonGradient}>
                                    <Text style={styles.modalButtonText}>Got it</Text>
                                </LinearGradient>
                            </TouchableOpacity>
                        </LinearGradient>
                    </Animated.View>
                </Pressable>
            </Modal>

            {showToast && (
                <Animated.View style={[styles.toastContainer, { opacity: fadeAnim }]} pointerEvents="none">
                    <LinearGradient colors={C.primaryGradient} style={styles.toastBubble}>
                        <Text style={styles.toastText}>{toastMessage}</Text>
                    </LinearGradient>
                </Animated.View>
            )}

            <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={C.bgPrimary} />

            {!scannedData ? (
                <>
                    <MLKitCamera
                        style={styles.cameraPreview}
                        onBarcodeScan={handleScan}
                        onCameraReady={() => setIsCameraReady(true)}
                    />
                    
                    <ScrollView
                        style={StyleSheet.absoluteFill}
                        contentContainerStyle={[styles.scrollContent, { paddingHorizontal: r.pad }]}
                        showsVerticalScrollIndicator={false}
                        bounces={false}
                    >
                        <Animated.View 
                            style={[
                                styles.overlayContent,
                                {
                                    opacity: fadeAnim,
                                    transform: [{ translateY: slideAnim }],
                                },
                            ]}
                        >
                            {/* Top Bar */}
                            <View style={[styles.topBar, isTablet && { maxWidth: contentMaxWidth, alignSelf: 'center', width: '100%' }]}>
                                <View style={styles.topBarLeft}>
                                    <LinearGradient colors={C.primaryGradient} style={styles.logoContainer}>
                                        <Icon name="qr-code" size={20} color="#FFFFFF" />
                                    </LinearGradient>
                                    <Text style={[styles.topBarTitle, { fontSize: r.titleSize }]}>Mark Attendance</Text>
                                </View>
                                <View style={styles.topBarRight}>
                                    <TouchableOpacity
                                        style={styles.helpIconButton}
                                        onPress={() => setShowHelp(true)}
                                    >
                                        <Icon name="help-circle-outline" size={24} color={C.textSecondary} />
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        style={styles.infoIconButton}
                                        onPress={() => setShowInfoModal(true)}
                                    >
                                        <Icon name="information-circle-outline" size={24} color={C.textSecondary} />
                                    </TouchableOpacity>
                                </View>
                            </View>

                            {/* Main Content */}
                            <View style={[styles.mainContent, isTablet && { maxWidth: contentMaxWidth, alignSelf: 'center', width: '100%' }]}>
                                {/* Scan Area */}
                                <View style={styles.scanArea}>
                                    <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
                                        <LinearGradient
                                            colors={['transparent', C.primarySoft]}
                                            style={[styles.scanFrame, { width: r.scanFrame, height: r.scanFrame }]}
                                        >
                                            <View style={styles.scanFrameInner}>
                                                <View style={[styles.corner, styles.cornerTL]} />
                                                <View style={[styles.corner, styles.cornerTR]} />
                                                <View style={[styles.corner, styles.cornerBL]} />
                                                <View style={[styles.corner, styles.cornerBR]} />
                                                {!isCameraReady && (
                                                    <Animated.View style={{ transform: [{ rotate: spin }] }}>
                                                        <Icon name="sync" size={32} color={C.primaryMain} />
                                                    </Animated.View>
                                                )}
                                                {/* BLE Verification Indicator */}
                                                {isAutoMarking && (
                                                    <View style={styles.bleVerifyingOverlay}>
                                                        <ActivityIndicator size="large" color={C.primaryMain} />
                                                        <Text style={styles.bleVerifyingText}>Verifying BLE attendance...</Text>
                                                    </View>
                                                )}
                                            </View>
                                        </LinearGradient>
                                    </Animated.View>
                                    <Text style={styles.scanHint}>
                                        {isAutoMarking ? 'Auto-detecting (BLE verification in progress)...' : 'Position QR code within the frame'}
                                    </Text>
                                </View>


                                {/* Auto-marking Progress */}
                                {isAutoMarking && detectedSession && (
                                    <GlassCard styles={styles}>
                                        <AutoProgressIndicator
                                            progress={autoMarkProgress}
                                            message={`Auto-marking ${detectedSession.unitCode}...`}
                                            styles={styles}
                                        />
                                        <Text style={styles.autoMarkHint}>
                                            Stay still while we verify your attendance
                                        </Text>
                                    </GlassCard>
                                )}

                                {/* Progress Card */}
                                {!isAutoMarking && (
                                    <GlassCard styles={styles}>
                                        <View style={styles.progressHeader}>
                                            <Text style={styles.progressTitle}>Scan Progress</Text>
                                            <View style={styles.progressCountContainer}>
                                                <Text style={styles.progressCountText}>{scanCount}/2</Text>
                                            </View>
                                        </View>
                                        <ProgressSteps current={scanCount} total={2} styles={styles} />
                                        {feedbackMessage && (
                                            <StatusChip
                                                type={feedbackMessage.includes('✓') ? 'success' :
                                                      feedbackMessage.includes('Not enrolled') ? 'error' : 'info'}
                                                message={feedbackMessage}
                                                icon={feedbackMessage.includes('✓') ? 'checkmark-circle' : 'information-circle'}
                                                styles={styles}
                                            />
                                        )}
                                    </GlassCard>
                                )}

                                {/* Quick Stats */}
                                <GlassCard styles={styles}>
                                    <View style={styles.statsRow}>
                                        <View style={styles.statItem}>
                                            <Icon name="book-outline" size={16} color={C.primaryMain} />
                                            <Text style={styles.statLabel}>Units</Text>
                                            <Text style={styles.statValue}>{enrolledNormalizedSet.size}</Text>
                                        </View>
                                        <View style={styles.statDivider} />
                                        <View style={styles.statItem}>
                                            <Icon
                                                name={isMotionVerified ? 'walk' : 'pause-circle-outline'}
                                                size={16}
                                                color={isMotionVerified ? C.successMain : C.warningMain}
                                            />
                                            <Text style={styles.statLabel}>Motion</Text>
                                            <Text style={[styles.statValue, isMotionVerified && styles.statValueSuccess]}>
                                                {isMotionVerified ? 'Verified' : 'Pending'}
                                            </Text>
                                        </View>
                                        <View style={styles.statDivider} />
                                        <View style={styles.statItem}>
                                            <Icon name="time-outline" size={16} color={C.warningMain} />
                                            <Text style={styles.statLabel}>Session</Text>
                                            <Text style={styles.statValue}>
                                                {sessionActive ? formatRemaining(sessionRemainingMs) : '--:--'}
                                            </Text>
                                        </View>
                                    </View>
                                </GlassCard>

                                {/* Detected BLE ID Display */}
                                {detectedBleId && !scannedData && !isAutoMarking && (
                                    <GlassCard styles={styles}>
                                        <View style={styles.bleIdContainer}>
                                            <Icon name="radio" size={16} color={C.infoMain} />
                                            <Text style={styles.bleIdText}>
                                                Detected: Unit {formatId(detectedBleId.unitId)} •
                                                Room {formatId(detectedBleId.roomId)} •
                                                Session #{detectedBleId.sessionCounter}
                                            </Text>
                                        </View>
                                    </GlassCard>
                                )}

                                {/* Tabs */}
                                <View style={styles.tabContainer}>
                                    <TouchableOpacity
                                        style={[styles.tab, activeTab === 'scan' && styles.activeTab]}
                                        onPress={() => setActiveTab('scan')}
                                    >
                                        <Icon
                                            name="qr-code-outline"
                                            size={20}
                                            color={activeTab === 'scan' ? C.primaryMain : C.textSecondary}
                                        />
                                        <Text style={[styles.tabText, activeTab === 'scan' && styles.activeTabText]}>
                                            QR Scan
                                        </Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        style={[styles.tab, activeTab === 'manual' && styles.activeTab]}
                                        onPress={() => setIsManualDialogVisible(true)}
                                    >
                                        <Icon
                                            name="key-outline"
                                            size={20}
                                            color={activeTab === 'manual' ? C.primaryMain : C.textSecondary}
                                        />
                                        <Text style={[styles.tabText, activeTab === 'manual' && styles.activeTabText]}>
                                            Manual PIN
                                        </Text>
                                    </TouchableOpacity>
                                </View>

                                {/* Tab Content */}
                                {activeTab === 'scan' ? (
                                    <GlassCard styles={styles}>
                                        <View style={styles.bleControl}>
                                            <View style={styles.bleHeader}>
                                                <View style={styles.bleTitle}>
                                                    <Icon name="bluetooth" size={20} color={isBluetoothOn ? C.primaryMain : C.textSecondary} />
                                                    <Text style={styles.bleTitleText}>Auto Attendance</Text>
                                                </View>
                                                <Switch
                                                    value={isBluetoothOn}
                                                    onValueChange={toggleBluetooth}
                                                    disabled={isToggleBusy}
                                                    trackColor={{ false: C.borderMedium, true: C.primaryMain }}
                                                    thumbColor="#FFFFFF"
                                                    ios_backgroundColor={C.borderMedium}
                                                />
                                            </View>
                                            {bleScanError ? (
                                                <StatusChip type="error" message={bleScanError} icon="alert-circle" styles={styles} />
                                            ) : bleFeedbackMessage ? (
                                                <StatusChip type="info" message={bleFeedbackMessage} icon="information-circle" styles={styles} />
                                            ) : isBluetoothOn ? (
                                                <StatusChip
                                                    type="success"
                                                    message="Auto-attendance active - walk into any lecture room"
                                                    icon="checkmark-circle"
                                                    styles={styles}
                                                />
                                            ) : null}
                                            <Text style={styles.bleHint}>
                                                {isBluetoothOn 
                                                    ? "✓ Automatic - Just walk into the room with Bluetooth on" 
                                                    : "Enable Bluetooth for automatic attendance"}
                                            </Text>
                                        </View>

                                        <View style={styles.unitsPreview}>
                                            <Text style={styles.unitsPreviewLabel}>Your enrolled units</Text>
                                            <Text style={styles.unitsPreviewValue}>{enrolledUnitsPreview}</Text>
                                        </View>
                                    </GlassCard>
                                ) : null}
                            </View>
                        </Animated.View>
                    </ScrollView>
                </>
            ) : (
                <ScrollView
                    style={styles.scrollView}
                    contentContainerStyle={styles.resultScrollContent}
                    showsVerticalScrollIndicator={false}
                >
                    <LinearGradient colors={C.successGradient} style={styles.successHeader}>
                        <PulseView>
                            <View style={styles.successIconContainer}>
                                <Icon name="checkmark-circle" size={64} color="#FFFFFF" />
                            </View>
                        </PulseView>
                        <Text style={styles.resultTitle}>Attendance Marked!</Text>
                        <Text style={styles.resultDescription}>
                            {regeneratedQrData
                                ? "Show this QR to peers who haven't marked yet."
                                : relayManualPin
                                    ? "Share this PIN with peers who haven't marked yet."
                                    : isBluetoothOn
                                        ? "Broadcasting to peers — stay in the room to help others mark."
                                        : "Attendance recorded."}
                        </Text>

                        {sessionActive && (
                            <View style={styles.sessionTimer}>
                                <Icon name="time-outline" size={16} color="#FFD460" />
                                <Text style={styles.sessionTimerText}>
                                    Session active for {formatRemaining(sessionRemainingMs)}
                                </Text>
                            </View>
                        )}
                    </LinearGradient>

                    <View style={[styles.resultContent, isTablet && { maxWidth: contentMaxWidth, alignSelf: 'center', width: '100%' }]}>
                        <GlassCard styles={styles}>
                            <View style={styles.resultQrCard}>
                                {regeneratedQrData && (
                                    <QRCodeGenerator value={regeneratedQrData} size={220} />
                                )}
                                {!!relayManualPin && (
                                    <View style={styles.relayPinContainer}>
                                        <Text style={styles.relayPinLabel}>Manual fallback PIN</Text>
                                        <Text style={styles.relayPinValue}>{relayManualPin}</Text>
                                        <Text style={styles.relayPinContext}>
                                            {scannedData.details.unitCode} • {scannedData.details.lectureRoom}
                                        </Text>
                                        <Text style={styles.relayPinHint}>Expires in {manualTokenRemainingSec}s</Text>
                                    </View>
                                )}
                            </View>
                        </GlassCard>

                        <GlassCard styles={styles}>
                            <View style={styles.detailRow}>
                                <LinearGradient colors={[C.primarySoft, 'transparent']} style={styles.detailIconContainer}>
                                    <Icon name="book-outline" size={20} color={C.primaryMain} />
                                </LinearGradient>
                                <View style={styles.detailContent}>
                                    <Text style={styles.detailLabel}>Unit Code</Text>
                                    <Text style={styles.detailValue}>{scannedData.details.unitCode}</Text>
                                </View>
                            </View>

                            <View style={styles.detailDivider} />

                            <View style={styles.detailRow}>
                                <LinearGradient colors={[C.purpleSoft, 'transparent']} style={styles.detailIconContainer}>
                                    <Icon name="location-outline" size={20} color={C.purpleMain} />
                                </LinearGradient>
                                <View style={styles.detailContent}>
                                    <Text style={styles.detailLabel}>Lecture Room</Text>
                                    <Text style={styles.detailValue}>{scannedData.details.lectureRoom}</Text>
                                </View>
                            </View>

                            {detectedBleId && (
                                <View style={styles.broadcastStatus}>
                                    <Icon name="radio" size={20} color={C.successMain} />
                                    <Text style={styles.broadcastStatusText}>
                                        Session #{detectedBleId.sessionCounter}
                                    </Text>
                                </View>
                            )}
                        </GlassCard>

                        <GlassCard styles={styles}>
                            <View style={styles.bleCardHeader}>
                                <Icon name="bluetooth" size={24} color={isBluetoothOn ? C.primaryMain : C.textSecondary} />
                                <Text style={styles.bleCardTitle}>Auto Attendance</Text>
                            </View>

                            <View style={styles.bleToggleRow}>
                                <Text style={styles.bleToggleLabel}>Keep Bluetooth ON for future sessions</Text>
                                <Switch
                                    value={isBluetoothOn}
                                    onValueChange={toggleBluetooth}
                                    disabled={isToggleBusy}
                                    trackColor={{ false: C.borderMedium, true: C.primaryMain }}
                                    thumbColor="#FFFFFF"
                                    ios_backgroundColor={C.borderMedium}
                                />
                            </View>

                            {bleAdvertisingError ? (
                                <StatusChip type="error" message={bleAdvertisingError} icon="alert-circle" styles={styles} />
                            ) : !isBluetoothOn ? (
                                <StatusChip type="warning" message="Turn on Bluetooth for auto-attendance" icon="information-circle" styles={styles} />
                            ) : !isAdvertisingSupported ? (
                                <StatusChip type="error" message="BLE Advertising not supported" icon="close-circle" styles={styles} />
                            ) : isAdvertising ? (
                                <>
                                    <StatusChip type="success" message="Auto-attendance active" icon="checkmark-circle" styles={styles} />
                                    <View style={styles.broadcastingRow}>
                                        <Icon name="radio" size={20} color={C.infoMain} style={{ marginRight: 8 }} />
                                        <Text style={styles.broadcastingText}>Broadcasting to peers...</Text>
                                    </View>
                                </>
                            ) : null}
                        </GlassCard>

                        {!sessionActive && (
                            <View style={styles.sessionEndedContainer}>
                                <Icon name="time-outline" size={24} color={C.warningMain} />
                                <Text style={styles.sessionEndedText}>Session ended</Text>
                                <TouchableOpacity onPress={resetScan} style={styles.returnButton}>
                                    <LinearGradient colors={C.primaryGradient} style={styles.returnButtonGradient}>
                                        <Icon name="scan-outline" size={20} color="#FFFFFF" />
                                        <Text style={styles.returnButtonText}>Ready for Next Session</Text>
                                    </LinearGradient>
                                </TouchableOpacity>
                            </View>
                        )}
                    </View>
                </ScrollView>
            )}
        </SafeAreaView>
    );
};

// Styles
const makeStyles = (C) => StyleSheet.create({
    
    autoProgressContainer: {
        padding: 8,
    },
    autoProgressBar: {
        height: 4,
        backgroundColor: C.borderMedium,
        borderRadius: 2,
        overflow: 'hidden',
        marginBottom: 8,
    },
    autoProgressFill: {
        height: '100%',
        backgroundColor: C.successMain,
    },
    autoProgressText: {
        fontSize: 14,
        color: C.textPrimary,
        fontWeight: '600',
        textAlign: 'center',
    },
    autoMarkHint: {
        fontSize: 12,
        color: C.textSecondary,
        textAlign: 'center',
        marginTop: 4,
        fontStyle: 'italic',
    },
    broadcastingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 10,
        marginBottom: 2,
        justifyContent: 'center',
    },
    broadcastingText: {
        color: C.infoMain,
        fontSize: 15,
        fontWeight: '600',
    },
    scrollContent: {
        flexGrow: 1,
        paddingHorizontal: 16,
        paddingBottom: 20,
    },
    overlayContent: {
        flex: 1,
    },
    dialogOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.7)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    dialogContainer: {
        width: width * 0.9,
        maxWidth: 400,
        backgroundColor: C.surfacePrimary,
        borderRadius: 24,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: C.borderLight,
    },
    dialogContainerKeyboard: {
        marginTop: -100,
    },
    dialogHeader: {
        padding: 20,
        alignItems: 'center',
        position: 'relative',
    },
    dialogTitle: {
        fontSize: 20,
        fontWeight: '700',
        color: '#FFFFFF',
        marginTop: 8,
    },
    dialogCloseButton: {
        position: 'absolute',
        top: 16,
        right: 16,
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: 'rgba(255,255,255,0.2)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    dialogContent: {
        padding: 20,
    },
    inputLabel: {
        fontSize: 13,
        color: C.textSecondary,
        fontWeight: '600',
        marginBottom: 6,
        marginTop: 10,
    },
    dialogInput: {
        borderWidth: 1,
        borderColor: C.borderLight,
        borderRadius: 12,
        paddingHorizontal: 14,
        paddingVertical: 12,
        color: C.textPrimary,
        backgroundColor: C.surfaceSecondary,
        fontSize: 16,
        marginBottom: 4,
    },
    dialogButtons: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: 20,
        gap: 12,
    },
    dialogCancelButton: {
        flex: 1,
        paddingVertical: 14,
        borderRadius: 12,
        backgroundColor: C.surfaceTertiary,
        alignItems: 'center',
    },
    dialogCancelText: {
        fontSize: 15,
        fontWeight: '600',
        color: C.textPrimary,
    },
    dialogSubmitButton: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 14,
        borderRadius: 12,
        gap: 8,
    },
    dialogSubmitText: {
        fontSize: 15,
        fontWeight: '700',
        color: '#FFFFFF',
    },
    // — main styles —
    bleVerifyingOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(10,10,15,0.7)',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10,
        borderRadius: 16,
    },
    bleVerifyingText: {
        color: C.primaryMain,
        fontSize: 16,
        fontWeight: '600',
        marginTop: 12,
        textAlign: 'center',
    },
    darkContainer: {
        flex: 1,
        backgroundColor: C.bgPrimary,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    loadingText: {
        marginTop: 16,
        fontSize: 16,
        color: C.textSecondary,
        fontWeight: '500',
    },
    cameraPreview: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 0,
    },
    topBar: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingTop: 16,
        paddingBottom: 8,
    },
    topBarLeft: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    topBarRight: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    logoContainer: {
        width: 36,
        height: 36,
        borderRadius: 10,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    topBarTitle: {
        fontSize: 20,
        fontWeight: '700',
        color: C.textPrimary,
    },
    helpIconButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: C.surfaceSecondary,
        marginRight: 8,
    },
    infoIconButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: C.surfaceSecondary,
    },
    mainContent: {
        flex: 1,
        paddingTop: 20,
    },
    scanArea: {
        alignItems: 'center',
        marginBottom: 16,
    },
    scanFrame: {
        width: width * 0.6,
        height: width * 0.6,
        borderRadius: 24,
        borderWidth: 2,
        borderColor: C.primaryMain,
        justifyContent: 'center',
        alignItems: 'center',
        overflow: 'hidden',
    },
    scanFrameInner: {
        width: '100%',
        height: '100%',
        justifyContent: 'center',
        alignItems: 'center',
        position: 'relative',
    },
    corner: {
        position: 'absolute',
        width: 20,
        height: 20,
        borderColor: C.primaryMain,
        borderWidth: 3,
    },
    cornerTL: {
        top: -2,
        left: -2,
        borderRightWidth: 0,
        borderBottomWidth: 0,
    },
    cornerTR: {
        top: -2,
        right: -2,
        borderLeftWidth: 0,
        borderBottomWidth: 0,
    },
    cornerBL: {
        bottom: -2,
        left: -2,
        borderRightWidth: 0,
        borderTopWidth: 0,
    },
    cornerBR: {
        bottom: -2,
        right: -2,
        borderLeftWidth: 0,
        borderTopWidth: 0,
    },
    scanHint: {
        marginTop: 12,
        fontSize: 14,
        color: C.textSecondary,
        fontWeight: '500',
    },
    glassCard: {
        backgroundColor: 'rgba(28, 28, 36, 0.8)',
        borderRadius: 20,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: C.borderLight,
        overflow: 'hidden',
    },
    glassCardInner: {
        padding: 16,
    },
    progressHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
    },
    progressTitle: {
        fontSize: 14,
        fontWeight: '600',
        color: C.textSecondary,
    },
    progressCountContainer: {
        backgroundColor: C.primarySoft,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
    },
    progressCountText: {
        fontSize: 12,
        fontWeight: '700',
        color: C.primaryMain,
    },
    progressStepsContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 12,
    },
    progressStep: {
        width: 30,
        height: 30,
        borderRadius: 15,
        backgroundColor: C.surfaceSecondary,
        borderWidth: 2,
        borderColor: C.borderMedium,
        justifyContent: 'center',
        alignItems: 'center',
    },
    progressStepCompleted: {
        backgroundColor: C.successMain,
        borderColor: C.successMain,
    },
    progressStepCurrent: {
        borderColor: C.primaryMain,
        backgroundColor: C.primarySoft,
    },
    statusChip: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 20,
        borderWidth: 1,
    },
    statusChipText: {
        fontSize: 12,
        fontWeight: '600',
        marginLeft: 6,
    },
    statsRow: {
        flexDirection: 'row',
        justifyContent: 'space-around',
    },
    statItem: {
        alignItems: 'center',
        flex: 1,
    },
    statLabel: {
        fontSize: 10,
        color: C.textTertiary,
        marginTop: 4,
    },
    statValue: {
        fontSize: 14,
        fontWeight: '700',
        color: C.textPrimary,
        marginTop: 2,
    },
    statValueSuccess: {
        color: C.successMain,
    },
    statDivider: {
        width: 1,
        backgroundColor: C.borderLight,
    },
    bleIdContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    bleIdText: {
        fontSize: 12,
        color: C.infoMain,
        marginLeft: 8,
        flex: 1,
    },
    bleHint: {
        fontSize: 11,
        color: C.textTertiary,
        marginTop: 8,
        fontStyle: 'italic',
    },
    tabContainer: {
        flexDirection: 'row',
        marginBottom: 12,
        backgroundColor: C.surfaceSecondary,
        borderRadius: 12,
        padding: 4,
    },
    tab: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 10,
        borderRadius: 10,
        gap: 6,
    },
    activeTab: {
        backgroundColor: C.primarySoft,
    },
    tabText: {
        fontSize: 13,
        fontWeight: '600',
        color: C.textSecondary,
    },
    activeTabText: {
        color: C.primaryMain,
    },
    bleControl: {
        marginBottom: 12,
    },
    bleHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    bleTitle: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    bleTitleText: {
        fontSize: 14,
        fontWeight: '600',
        color: C.textPrimary,
    },
    unitsPreview: {
        borderTopWidth: 1,
        borderTopColor: C.borderLight,
        paddingTop: 12,
    },
    unitsPreviewLabel: {
        fontSize: 12,
        color: C.textTertiary,
        marginBottom: 4,
    },
    unitsPreviewValue: {
        fontSize: 13,
        color: C.textPrimary,
        fontWeight: '500',
    },
    manualTitle: {
        fontSize: 15,
        fontWeight: '700',
        color: C.textPrimary,
        marginBottom: 4,
    },
    manualHint: {
        fontSize: 12,
        color: C.textTertiary,
        marginBottom: 12,
    },
    pinTimer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: C.warningSoft,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 20,
        marginBottom: 16,
        alignSelf: 'flex-start',
    },
    pinTimerText: {
        fontSize: 12,
        fontWeight: '600',
        color: C.warningMain,
        marginLeft: 6,
    },
    manualInputGroup: {
        flexDirection: 'row',
        gap: 8,
        marginBottom: 8,
    },
    manualInput: {
        flex: 1,
        borderWidth: 1,
        borderColor: C.borderLight,
        borderRadius: 12,
        paddingHorizontal: 14,
        paddingVertical: 12,
        color: C.textPrimary,
        backgroundColor: C.surfaceSecondary,
        fontSize: 14,
        marginBottom: 8,
    },
    manualSubmitButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 14,
        borderRadius: 12,
        marginTop: 8,
        gap: 8,
    },
    manualSubmitText: {
        fontSize: 15,
        fontWeight: '700',
        color: '#FFFFFF',
    },
    scrollView: {
        flex: 1,
    },
    resultScrollContent: {
        flexGrow: 1,
    },
    successHeader: {
        paddingTop: 40,
        paddingBottom: 30,
        paddingHorizontal: 20,
        alignItems: 'center',
        borderBottomLeftRadius: 30,
        borderBottomRightRadius: 30,
    },
    successIconContainer: {
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: 'rgba(255,255,255,0.2)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    resultTitle: {
        fontSize: 28,
        fontWeight: '700',
        color: '#FFFFFF',
        marginTop: 16,
        marginBottom: 8,
        textAlign: 'center',
    },
    resultDescription: {
        fontSize: 15,
        color: 'rgba(255,255,255,0.9)',
        textAlign: 'center',
        paddingHorizontal: 20,
    },
    sessionTimer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(255, 212, 96, 0.2)',
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 20,
        marginTop: 16,
    },
    sessionTimerText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#FFD460',
        marginLeft: 8,
    },
    resultContent: {
        padding: 20,
    },
    resultQrCard: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    relayPinContainer: {
        marginTop: 16,
        borderTopWidth: 1,
        borderTopColor: C.borderLight,
        paddingTop: 12,
        width: '100%',
        alignItems: 'center',
    },
    relayPinLabel: {
        fontSize: 12,
        color: C.textTertiary,
        fontWeight: '700',
        textTransform: 'uppercase',
        letterSpacing: 0.4,
        marginBottom: 4,
    },
    relayPinValue: {
        fontSize: 24,
        color: C.textPrimary,
        fontWeight: '800',
        letterSpacing: 2,
    },
    relayPinHint: {
        marginTop: 4,
        fontSize: 12,
        color: C.textTertiary,
        fontWeight: '600',
    },
    relayPinContext: {
        marginTop: 4,
        fontSize: 13,
        color: C.textSecondary,
        fontWeight: '700',
    },
    detailRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    detailIconContainer: {
        width: 44,
        height: 44,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 16,
    },
    detailContent: {
        flex: 1,
    },
    detailLabel: {
        fontSize: 12,
        color: C.textTertiary,
        marginBottom: 4,
        fontWeight: '500',
    },
    detailValue: {
        fontSize: 18,
        color: C.textPrimary,
        fontWeight: '600',
    },
    detailDivider: {
        height: 1,
        backgroundColor: C.borderLight,
        marginVertical: 16,
    },
    broadcastStatus: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 12,
        paddingTop: 12,
        borderTopWidth: 1,
        borderTopColor: C.borderLight,
    },
    broadcastStatusText: {
        fontSize: 14,
        color: C.successMain,
        fontWeight: '600',
        marginLeft: 8,
    },
    bleCardHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 16,
    },
    bleCardTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: C.textPrimary,
        marginLeft: 12,
    },
    bleToggleRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
    },
    bleToggleLabel: {
        fontSize: 15,
        color: C.textPrimary,
        fontWeight: '500',
    },
    sessionEndedContainer: {
        alignItems: 'center',
        marginTop: 16,
    },
    sessionEndedText: {
        fontSize: 16,
        color: C.warningMain,
        marginVertical: 12,
    },
    returnButton: {
        width: '100%',
    },
    returnButtonGradient: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 16,
        borderRadius: 12,
        gap: 8,
    },
    returnButtonText: {
        fontSize: 16,
        fontWeight: '700',
        color: '#FFFFFF',
    },
    permissionContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 30,
    },
    permissionTitle: {
        fontSize: 24,
        fontWeight: '700',
        color: '#FFFFFF',
        marginTop: 20,
        marginBottom: 12,
        textAlign: 'center',
    },
    permissionText: {
        fontSize: 16,
        color: 'rgba(255,255,255,0.8)',
        textAlign: 'center',
        marginBottom: 30,
        lineHeight: 24,
    },
    settingsButton: {
        width: '100%',
        maxWidth: 300,
    },
    settingsButtonGradient: {
        paddingVertical: 16,
        paddingHorizontal: 32,
        borderRadius: 12,
        alignItems: 'center',
    },
    settingsButtonText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#FFFFFF',
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: C.overlayHeavy,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    modalContent: {
        width: '100%',
        maxWidth: 400,
        borderRadius: 24,
        overflow: 'hidden',
    },
    modalGradient: {
        padding: 30,
        alignItems: 'center',
    },
    modalTitle: {
        fontSize: 22,
        fontWeight: '700',
        color: '#FFFFFF',
        marginTop: 16,
        marginBottom: 16,
        textAlign: 'center',
    },
    modalBody: {
        fontSize: 15,
        color: 'rgba(255,255,255,0.9)',
        marginBottom: 24,
        textAlign: 'center',
        lineHeight: 22,
    },
    modalButton: {
        width: '100%',
    },
    modalButtonGradient: {
        paddingVertical: 14,
        borderRadius: 12,
        alignItems: 'center',
    },
    modalButtonText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#FFFFFF',
    },
    helpModalContent: {
        backgroundColor: C.surfacePrimary,
        borderRadius: 24,
        marginHorizontal: 20,
        overflow: 'hidden',
        maxHeight: height * 0.8,
        width: width * 0.9,
    },
    helpHeader: {
        padding: 24,
        alignItems: 'center',
    },
    helpTitle: {
        fontSize: 20,
        fontWeight: '700',
        color: '#FFFFFF',
        marginTop: 12,
    },
    helpBody: {
        padding: 24,
    },
    helpText: {
        fontSize: 14,
        color: C.textSecondary,
        lineHeight: 20,
        marginBottom: 20,
    },
    helpItem: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 16,
    },
    helpItemText: {
        fontSize: 14,
        color: C.textPrimary,
        marginLeft: 12,
        flex: 1,
    },
    helpNote: {
        fontSize: 13,
        color: C.textTertiary,
        fontStyle: 'italic',
        marginTop: 16,
        marginBottom: 20,
    },
    helpButton: {
        backgroundColor: C.primaryMain,
        borderRadius: 12,
        paddingVertical: 14,
        alignItems: 'center',
    },
    helpButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '600',
    },
    toastContainer: {
        position: 'absolute',
        bottom: 40,
        left: 20,
        right: 20,
        alignItems: 'center',
        zIndex: 1000,
    },
    toastBubble: {
        paddingHorizontal: 20,
        paddingVertical: 12,
        borderRadius: 25,
        shadowColor: '#000',
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 8,
    },
    toastText: {
        color: '#FFFFFF',
        fontSize: 14,
        fontWeight: '600',
    },
});

export default OfflineMarker;