// screens/student/AttendanceMarker/OnlineMarker.js
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    ActivityIndicator,
    StatusBar,
    Animated,
    BackHandler,
    Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { getStudentSession } from '../../../utils/authSession';
import { fetchOnlineSessionInfo, submitOnlineAttendance } from '../../../utils/onlineAttendanceApi';
import DeviceInfo from 'react-native-device-info';
import sqliteStorage from '../../../storage/sqliteStorage';
import useResponsive from '../../../hooks/useResponsive';
import themeColors from '../../../theme/colors';

// Brief flash to confirm attendance before app minimises back to meeting (ms)
const AUTO_DISMISS_MS = 1200;

// ─── Component ───────────────────────────────────────────────────────────────
export default function OnlineMarker() {
    const navigation  = useNavigation();
    const route       = useRoute();
    const { isTablet, contentMaxWidth } = useResponsive();

    // Session ID comes from deep link: markwise://attend?session=<id>
    // or from navigation params when navigating in-app
    const sessionId = route.params?.session ?? route.params?.sessionId ?? null;

    // ── state ────────────────────────────────────────────────────────────────
    const [phase, setPhase] = useState('loading');
    // phases: 'loading' → 'submitting' → 'success' | 'duplicate' | 'expired' | 'error'

    const [sessionInfo,  setSessionInfo]  = useState(null);
    const [studentName,  setStudentName]  = useState('');
    const [infoError,    setInfoError]    = useState('');
    const [submitError,  setSubmitError]  = useState('');

    // animations
    const scaleAnim  = useRef(new Animated.Value(0.85)).current;
    const opacityAnim = useRef(new Animated.Value(0)).current;

    const isMounted    = useRef(true);
    const dismissTimer = useRef(null);

    useEffect(() => {
        isMounted.current = true;
        return () => {
            isMounted.current = false;
            clearTimeout(dismissTimer.current);
        };
    }, []);

    // ── dismiss: return student to Zoom/browser, not just back in MarkWise ────
    // dismiss(forceMinimize=true)  → always minimize on Android (success/duplicate — return to meeting)
    // dismiss()                      → go back within app (error/expired — student stays in MarkWise)
    const dismiss = useCallback((forceMinimize = false) => {
        if (Platform.OS === 'android' && forceMinimize) {
            BackHandler.exitApp(); // restore the previous app (Zoom, Teams, etc.)
        } else if (navigation.canGoBack()) {
            navigation.goBack();
        } else if (Platform.OS === 'android') {
            BackHandler.exitApp();
        } else {
            navigation.goBack();
        }
    }, [navigation]);

    // ── pop-in animation helper ───────────────────────────────────────────────
    const popIn = useCallback(() => {
        Animated.parallel([
            Animated.spring(scaleAnim,   { toValue: 1, useNativeDriver: true, bounciness: 10 }),
            Animated.timing(opacityAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
        ]).start();
    }, [scaleAnim, opacityAnim]);

    // ── auto-dismiss after success / duplicate ────────────────────────────────
    const startAutoDismiss = useCallback(() => {

        dismissTimer.current = setTimeout(() => {
            if (isMounted.current) dismiss(true); // always minimize — student needs to return to meeting
        }, AUTO_DISMISS_MS);
    }, [dismiss]);

    // ── load session + immediately auto-submit ────────────────────────────────
    const run = useCallback(async () => {
        if (!sessionId) {
            setInfoError('No session ID found. Please tap the attendance link again.');
            setPhase('error');
            return;
        }

        setPhase('loading');
        setInfoError('');
        setSubmitError('');

        try {
            // Fetch session info + student identity in parallel
            const [stuSession, info] = await Promise.all([
                getStudentSession(),
                fetchOnlineSessionInfo(sessionId),
            ]);
            if (!isMounted.current) return;

            if (!stuSession?.token) {
                setInfoError('You are not signed in. Please open MarkWise and sign in first, then tap the link again.');
                setPhase('error');
                return;
            }

            setStudentName(stuSession.studentName || stuSession.admissionNumber || '');
            setSessionInfo(info);

            // Check if session is already closed before even trying
            const alreadyClosed = info?.status === 'ended' || info?.status === 'expired';
            if (alreadyClosed) {
                setPhase('expired');
                popIn();
                return;
            }

            // ── Auto-submit immediately ───────────────────────────────────────
            setPhase('submitting');
            try {
                await submitOnlineAttendance(sessionId);
                if (!isMounted.current) return;
                // Save a local record so ProgressScreen / history includes this session
                try {
                    const deviceId = await DeviceInfo.getUniqueId();
                    await sqliteStorage.addAttendanceRecord({
                        unitCode: info.unitCode,
                        lectureRoom: 'ONLINE',
                        sessionStart: Date.now(),
                        scannedAt: Date.now(),
                        rawPayload: JSON.stringify({ type: 'online', sessionId }),
                        deviceId,
                        synced: 1,
                    });
                } catch (_) { /* local save is non-critical */ }
                setPhase('success');
                popIn();
                startAutoDismiss();
            } catch (submitErr) {
                if (!isMounted.current) return;
                const msg = submitErr.message || '';
                if (/already|duplicate|submitted/i.test(msg)) {
                    setPhase('duplicate');
                    popIn();
                    startAutoDismiss();
                } else if (/closed|expired|ended|410/i.test(msg)) {
                    setPhase('expired');
                    popIn();
                } else {
                    setSubmitError(msg || 'Submission failed. Tap Retry to try again.');
                    setPhase('error');
                }
            }
        } catch (loadErr) {
            if (isMounted.current) {
                setInfoError(loadErr.message || 'Failed to load session details.');
                setPhase('error');
            }
        }
    }, [sessionId, popIn, startAutoDismiss]);

    useEffect(() => { run(); }, [run]);

    // ── render ────────────────────────────────────────────────────────────────
    const maxW = isTablet ? { maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center' } : {};

    // ── PHASE: loading or submitting ─────────────────────────────────────────
    if (phase === 'loading' || phase === 'submitting') {
        return (
            <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
                <StatusBar barStyle="light-content" backgroundColor={colors.background.dark} />
                <View style={styles.centerFull}>
                    <LinearGradient colors={colors.primary.gradient} style={styles.spinnerRing}>
                        <ActivityIndicator size="large" color="#fff" />
                    </LinearGradient>
                    <Text style={styles.loadingTitle}>
                        {phase === 'submitting' ? 'Marking attendance…' : 'Opening session…'}
                    </Text>
                    {phase === 'submitting' && sessionInfo?.unitCode ? (
                        <Text style={styles.loadingUnit}>{sessionInfo.unitCode}</Text>
                    ) : null}
                </View>
            </SafeAreaView>
        );
    }

    // ── PHASE: success ───────────────────────────────────────────────────────
    if (phase === 'success') {
        return (
            <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
                <StatusBar barStyle="light-content" backgroundColor={colors.background.dark} />
                <View style={[styles.centerFull, maxW]}>
                    <Animated.View style={[styles.resultWrap, { transform: [{ scale: scaleAnim }], opacity: opacityAnim }]}>
                        <LinearGradient colors={colors.success.gradient} style={styles.resultIconCircle}>
                            <Icon name="check-bold" size={52} color="#fff" />
                        </LinearGradient>
                        <Text style={styles.resultTitle}>Attendance Recorded</Text>
                        <Text style={styles.resultUnit}>
                            {sessionInfo?.unitCode
                                ? sessionInfo.unitName
                                    ? `${sessionInfo.unitCode} · ${sessionInfo.unitName}`
                                    : sessionInfo.unitCode
                                : 'Session'}
                        </Text>
                        {!!studentName && (
                            <Text style={styles.resultStudent}>{studentName}</Text>
                        )}
                        <View style={styles.dismissRow}>
                            <Icon name="arrow-left-circle-outline" size={14} color={colors.text.muted} />
                            <Text style={styles.dismissText}>Returning to meeting…</Text>
                        </View>
                        <TouchableOpacity
                            onPress={() => dismiss(true)}
                            style={styles.doneBtn}
                            activeOpacity={0.8}
                        >
                            <Text style={styles.doneBtnText}>Done</Text>
                        </TouchableOpacity>
                    </Animated.View>
                </View>
            </SafeAreaView>
        );
    }

    // ── PHASE: duplicate ─────────────────────────────────────────────────────
    if (phase === 'duplicate') {
        return (
            <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
                <StatusBar barStyle="light-content" backgroundColor={colors.background.dark} />
                <View style={[styles.centerFull, maxW]}>
                    <Animated.View style={[styles.resultWrap, { transform: [{ scale: scaleAnim }], opacity: opacityAnim }]}>
                        <LinearGradient colors={['#F59E0B', '#D97706']} style={styles.resultIconCircle}>
                            <Icon name="check-circle-outline" size={52} color="#fff" />
                        </LinearGradient>
                        <Text style={styles.resultTitle}>Already Recorded</Text>
                        <Text style={styles.resultUnit}>
                            You already marked attendance for{'\n'}
                            {sessionInfo?.unitCode ?? 'this session'}.
                        </Text>
                        <View style={styles.dismissRow}>
                            <Icon name="arrow-left-circle-outline" size={14} color={colors.text.muted} />
                            <Text style={styles.dismissText}>Returning to meeting…</Text>
                        </View>
                        <TouchableOpacity
                            onPress={() => dismiss(true)}
                            style={[styles.doneBtn, { backgroundColor: '#F59E0B' }]}
                            activeOpacity={0.8}
                        >
                            <Text style={styles.doneBtnText}>Done</Text>
                        </TouchableOpacity>
                    </Animated.View>
                </View>
            </SafeAreaView>
        );
    }

    // ── PHASE: expired ───────────────────────────────────────────────────────
    if (phase === 'expired') {
        return (
            <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
                <StatusBar barStyle="light-content" backgroundColor={colors.background.dark} />
                <View style={[styles.centerFull, maxW]}>
                    <Animated.View style={[styles.resultWrap, { transform: [{ scale: scaleAnim }], opacity: opacityAnim }]}>
                        <LinearGradient colors={colors.danger.gradient} style={styles.resultIconCircle}>
                            <Icon name="clock-remove-outline" size={52} color="#fff" />
                        </LinearGradient>
                        <Text style={styles.resultTitle}>Session Closed</Text>
                        <Text style={styles.resultUnit}>
                            This attendance window has ended.{'\n'}
                            Contact your lecturer if you were present.
                        </Text>
                        <TouchableOpacity
                            onPress={dismiss}
                            style={[styles.doneBtn, { backgroundColor: colors.danger.main }]}
                            activeOpacity={0.8}
                        >
                            <Text style={styles.doneBtnText}>OK</Text>
                        </TouchableOpacity>
                    </Animated.View>
                </View>
            </SafeAreaView>
        );
    }

    // ── PHASE: error ─────────────────────────────────────────────────────────
    return (
        <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
            <StatusBar barStyle="light-content" backgroundColor={colors.background.dark} />

            {/* Minimal header with back button */}
            <View style={styles.errorHeader}>
                <TouchableOpacity onPress={dismiss} style={styles.backBtn}>
                    <Icon name="arrow-left" size={24} color="#fff" />
                </TouchableOpacity>
                <Text style={styles.errorHeaderTitle}>Online Attendance</Text>
                <View style={{ width: 40 }} />
            </View>

            <View style={[styles.centerFull, maxW]}>
                <LinearGradient colors={[colors.danger.soft, 'transparent']} style={styles.errorIconCircle}>
                    <Icon name="alert-circle-outline" size={52} color={colors.danger.main} />
                </LinearGradient>
                <Text style={styles.errorTitle}>Could Not Submit</Text>
                <Text style={styles.errorDesc}>{submitError || infoError}</Text>
                <TouchableOpacity onPress={run} style={styles.retryBtn} activeOpacity={0.8}>
                    <LinearGradient colors={colors.primary.gradient} style={styles.retryBtnGradient}>
                        <Icon name="refresh" size={17} color="#fff" />
                        <Text style={styles.retryText}>Try Again</Text>
                    </LinearGradient>
                </TouchableOpacity>
                <TouchableOpacity onPress={dismiss} style={styles.cancelLink} activeOpacity={0.7}>
                    <Text style={styles.cancelLinkText}>Cancel</Text>
                </TouchableOpacity>
            </View>
        </SafeAreaView>
    );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const colors = {
    primary:    themeColors.primary,
    success:    themeColors.success,
    danger:     themeColors.danger,
    warning:    themeColors.warning,
    background: { dark: themeColors.background.primary, screen: themeColors.background.primary, card: themeColors.surface.card },
    text:       { primary: themeColors.text.primary, secondary: themeColors.text.secondary, muted: themeColors.text.muted },
};

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background.screen },

    // Loading / result center layout
    centerFull: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },

    // Loading state
    spinnerRing: {
        width: 88, height: 88, borderRadius: 44,
        alignItems: 'center', justifyContent: 'center', marginBottom: 24,
    },
    loadingTitle: { fontSize: 18, fontWeight: '700', color: colors.text.primary, textAlign: 'center' },
    loadingUnit:  { fontSize: 14, color: colors.text.secondary, marginTop: 6 },

    // Result states
    resultWrap: { alignItems: 'center', width: '100%' },
    resultIconCircle: {
        width: 100, height: 100, borderRadius: 50,
        alignItems: 'center', justifyContent: 'center', marginBottom: 24,
    },
    resultTitle:   { fontSize: 26, fontWeight: '800', color: colors.text.primary, textAlign: 'center', marginBottom: 10 },
    resultUnit:    { fontSize: 15, color: colors.text.secondary, textAlign: 'center', lineHeight: 22, marginBottom: 8 },
    resultStudent: { fontSize: 13, color: colors.text.muted, marginBottom: 20 },
    dismissRow:    { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 28 },
    dismissText:   { fontSize: 13, color: colors.text.muted },

    doneBtn: {
        backgroundColor: colors.success.main,
        borderRadius: 14, paddingVertical: 14, paddingHorizontal: 48,
    },
    doneBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

    // Error state header
    errorHeader: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 16, paddingVertical: 14,
    },
    backBtn:          { padding: 4 },
    errorHeaderTitle: { fontSize: 17, fontWeight: '700', color: colors.text.primary },

    // Error state body
    errorIconCircle: {
        width: 96, height: 96, borderRadius: 48,
        alignItems: 'center', justifyContent: 'center', marginBottom: 20,
    },
    errorTitle: { fontSize: 20, fontWeight: '800', color: colors.text.primary, marginBottom: 10, textAlign: 'center' },
    errorDesc:  { fontSize: 14, color: colors.text.secondary, textAlign: 'center', lineHeight: 21, marginBottom: 28, paddingHorizontal: 8 },

    retryBtn:         { borderRadius: 14, overflow: 'hidden', marginBottom: 16 },
    retryBtnGradient: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 14, paddingHorizontal: 36 },
    retryText:        { color: '#fff', fontSize: 15, fontWeight: '700' },

    cancelLink:     { paddingVertical: 8 },
    cancelLinkText: { fontSize: 14, color: colors.text.muted },
});