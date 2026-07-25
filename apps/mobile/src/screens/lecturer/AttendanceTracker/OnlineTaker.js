// screens/lecturer/AttendanceTracker/OnlineTaker.js
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    FlatList,
    ActivityIndicator,
    Alert,
    Share,
    RefreshControl,
    ScrollView,
    Modal,
    TextInput,
    KeyboardAvoidingView,
    Platform,
    StatusBar,
    Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import Clipboard from '@react-native-clipboard/clipboard';
import { getLecturerSession } from '../../../utils/authSession';
import { fetchMyLecturerTimetable } from '../../../utils/lecturerTimetableApi';
import { API_BASE_URL, ONLINE_SESSION_DURATION_MS as SESSION_DURATION_MS } from '../../../utils/constants';
import { syncConductedSession } from '../../../utils/offlineAttendanceApi';
import { detectPlatform } from '../../../utils/meetingInviteApi';
import ShareMeetingModal from './ShareMeetingModal';
import useResponsive from '../../../hooks/useResponsive';
import themeColors from '../../../theme/colors';

const SESS_BASE = `${API_BASE_URL}/api/attendance/sessions`;

// Polling interval for fetching attendees (5 seconds)
const POLL_INTERVAL_MS = 5000;

const colors = {
    primary:    themeColors.primary,
    success:    themeColors.success,
    danger:     themeColors.danger,
    warning:    themeColors.warning,
    info:       themeColors.info,
    purple:     themeColors.purple,
    background: {
        primary:   themeColors.background.primary,
        secondary: themeColors.background.secondary,
        screen:    themeColors.light.background.primary,
        card:      themeColors.light.surface.primary,
    },
    surface: {
        primary:   themeColors.surface.primary,
        secondary: themeColors.surface.tertiary,
    },
    text: {
        primary:   themeColors.light.text.primary,
        secondary: themeColors.light.text.tertiary,
        muted:     themeColors.text.secondary,
        inverse:   themeColors.text.primary,
    },
    border: {
        light:  themeColors.light.border.light,
        medium: themeColors.border.light,
    },
    overlay: themeColors.overlay,
};

/**
 * Format milliseconds to MM:SS format
 * @param {number} ms - Milliseconds to format
 * @returns {string} Formatted time string
 */
const formatDuration = (ms) => {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSec / 60);
    const seconds = totalSec % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

// Fields shown in the student-side attendance summary
const FORM_FIELDS = [
    { icon: 'book-open-outline',           label: 'Unit Code',      note: 'From session · Read-only' },
    { icon: 'shield-account-outline',      label: 'Identity',       note: 'From MarkWise account · JWT' },
    { icon: 'cellphone-check',             label: 'Device Binding', note: 'Auto · Rate-limit protection' },
    { icon: 'calendar-clock',              label: 'Timestamp',      note: 'Auto-generated on submit' },
];

export default function OnlineTaker() {
    const navigation = useNavigation();

    // ── Responsive layout ───────────────────────────────────────────────
    const { width, isTablet, isDesktop, contentMaxWidth, numColumns, r } = useResponsive();

    // ── Setup form state ────────────────────────────────────────────────
    const [setupUnitCode, setSetupUnitCode] = useState('');
    const [unitCodeError, setUnitCodeError] = useState('');
    const [units, setUnits] = useState([]);
    const [loadingUnits, setLoadingUnits] = useState(false);
    const [loadUnitsError, setLoadUnitsError] = useState('');
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [meetingLink, setMeetingLink]         = useState('');
    const [meetingPasscode, setMeetingPasscode] = useState('');

    // ── Session state ───────────────────────────────────────────────────
    const [sessionActive, setSessionActive] = useState(false);
    const [sessionId, setSessionId] = useState(null);
    const [sessionUnitCode, setSessionUnitCode] = useState('');
    const [shareableLink, setShareableLink] = useState('');
    const [timeRemaining, setTimeRemaining] = useState(SESSION_DURATION_MS);
    const [attendees, setAttendees] = useState([]);

    // ── UI state ────────────────────────────────────────────────────────
    const [starting, setStarting] = useState(false);
    const [ending, setEnding] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [copied, setCopied] = useState(false);
    const [copiedMeeting, setCopiedMeeting] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [shareMeetingVisible, setShareMeetingVisible] = useState(false);

    // Refs for timers and mounted state
    const pollTimer = useRef(null);
    const countdownTimer = useRef(null);
    const sessionEndTime = useRef(null);
    const isMounted = useRef(true);
    const isFetchingAttendeesRef = useRef(false); // prevents overlapping poll requests

    // Cleanup on unmount
    useEffect(() => {
        isMounted.current = true;
        return () => {
            isMounted.current = false;
            clearInterval(pollTimer.current);
            clearInterval(countdownTimer.current);
        };
    }, []);

    /**
     * Map timetable entries to a unique list of units
     * @param {Array} entries - Timetable entries from API
     * @returns {Array} Mapped units with code, name, and display
     */
    const mapAssignedUnits = (entries) => {
        const map = new Map();
        (Array.isArray(entries) ? entries : []).forEach((entry) => {
            const code = String(entry?.unitCode || entry?.code || '').trim();
            const name = String(entry?.unitTitle || entry?.unitName || entry?.unit || entry?.name || '').trim();
            if (!code && !name) return;
            const key = (code || name).toUpperCase();
            if (map.has(key)) return;
            map.set(key, {
                code: code || name,
                name: name || code,
                display: code && name ? `${code} — ${name}` : code || name,
            });
        });
        return Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code));
    };

    // Load assigned units from timetable on mount
    const loadUnits = useCallback(async () => {
        setLoadingUnits(true);
        setLoadUnitsError('');
        try {
            const session = await getLecturerSession();
            if (!session?.token) throw new Error('No lecturer session found. Please sign in again.');
            const entries = await fetchMyLecturerTimetable(session.token);
            const mapped = mapAssignedUnits(entries);
            setUnits(mapped);
            if (mapped.length === 0) {
                setLoadUnitsError('No units found in your timetable. You can type a unit code manually below.');
            }
        } catch (e) {
            console.warn('[OnlineTaker] Could not load units:', e.message);
            setLoadUnitsError(e.message || 'Failed to load units.');
        } finally {
            setLoadingUnits(false);
        }
    }, []);

    useEffect(() => {
        loadUnits();
    }, [loadUnits]);

    /**
     * Fetch attendees for a given session
     * @param {string} sid - Session ID
     */
    const fetchAttendees = useCallback(async (sid) => {
        if (!sid || isFetchingAttendeesRef.current) return;
        isFetchingAttendeesRef.current = true;
        try {
            const session = await getLecturerSession();
            const res = await fetch(`${SESS_BASE}/${sid}/attendees`, {
                headers: { Authorization: `Bearer ${session?.token}` },
            });
            if (!res.ok) return;
            const data = await res.json();
            if (isMounted.current) {
                setAttendees(Array.isArray(data) ? data : (data?.attendees ?? []));
            }
        } catch (err) {
            console.warn('[OnlineTaker] Poll error:', err.message);
        } finally {
            isFetchingAttendeesRef.current = false;
        }
    }, []);

    /**
     * Start polling for attendees
     * @param {string} sid - Session ID
     */
    const startPolling = useCallback((sid) => {
        clearInterval(pollTimer.current);
        fetchAttendees(sid);
        pollTimer.current = setInterval(() => fetchAttendees(sid), POLL_INTERVAL_MS);
    }, [fetchAttendees]);

    /**
     * Start countdown timer for session duration
     */
    const startCountdown = useCallback(() => {
        clearInterval(countdownTimer.current);
        sessionEndTime.current = Date.now() + SESSION_DURATION_MS;
        countdownTimer.current = setInterval(() => {
            const remaining = sessionEndTime.current - Date.now();
            if (!isMounted.current) return;
            if (remaining <= 0) {
                setTimeRemaining(0);
                clearInterval(countdownTimer.current);
                clearInterval(pollTimer.current);
                if (isMounted.current) setSessionActive(false);
                Alert.alert(
                    'Session Expired',
                    'The attendance window has closed automatically.',
                    [{ text: 'OK' }]
                );
            } else {
                setTimeRemaining(remaining);
            }
        }, 500);
    }, []);

    /**
     * Start a new attendance session
     */
    const handleStartSession = async () => {
        const code = setupUnitCode.trim().toUpperCase();
        if (!code) {
            setUnitCodeError('Please select a unit to start a session');
            return;
        }
        setUnitCodeError('');
        setStarting(true);
        try {
            const session = await getLecturerSession();
            const res = await fetch(SESS_BASE, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${session?.token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    lecturerId: session?.lecturerId,
                    unitCode: code,
                    durationMs: SESSION_DURATION_MS,
                    type: 'online',
                }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.message || `Server error ${res.status}`);
            }
            const data = await res.json();
            const sid = data?.sessionId ?? data?.id ?? '';
            if (!sid) throw new Error('Invalid session response from server');

            // Use the HTTP link from the backend — it serves a redirect page that
            // fires markwise://attend?session=<sid> via JavaScript, so it works
            // from both browser chat (Zoom web, Meet) and native app chat.
            const link = data?.shareableLink ??
                data?.link ??
                `${API_BASE_URL}/attend?session=${encodeURIComponent(sid)}`;
            
            const sessionCreatedAt = data?.createdAt ? new Date(data.createdAt).getTime() : Date.now();

            if (isMounted.current) {
                setSessionId(sid);
                setSessionUnitCode(code);
                setShareableLink(link);
                setAttendees([]);
                setTimeRemaining(SESSION_DURATION_MS);
                setSessionActive(true);
                startPolling(sid);
                startCountdown();
            }

            // Register this online session in the conducted_sessions table so it
            // appears in all count/analytics/grid endpoints immediately.
            syncConductedSession({
                unitCode: code,
                lectureRoom: 'ONLINE',
                sessionStart: sessionCreatedAt,
                createdAt: sessionCreatedAt,
            }).catch(() => {});
        } catch (err) {
            Alert.alert('Failed to start session', err.message);
        } finally {
            if (isMounted.current) setStarting(false);
        }
    };

    /**
     * Copy attendance link to clipboard
     */
    const handleCopyLink = () => {
        Clipboard.setString(shareableLink);
        setCopied(true);
        setTimeout(() => { 
            if (isMounted.current) setCopied(false); 
        }, 2500);
    };

    const handleCopyMeetingLink = () => {
        const text = meetingPasscode
            ? `Meeting: ${meetingLink}\nPasscode: ${meetingPasscode}`
            : meetingLink;
        Clipboard.setString(text);
        setCopiedMeeting(true);
        setTimeout(() => {
            if (isMounted.current) setCopiedMeeting(false);
        }, 2500);
    };

    const handleShareMeetingLink = async () => {
        const platform = detectPlatform(meetingLink);
        const passcodeLine = meetingPasscode ? `\nRoom Passcode: ${meetingPasscode}` : '';
        const passcodNote = meetingPasscode ? '\n\n* You will need the passcode to enter the room.' : '';
        try {
            await Share.share({
                message: `You are invited to join the ${sessionUnitCode} lecture on ${platform.name}.\n\nJoin here:\n${meetingLink}${passcodeLine}${passcodNote}`,
                url: meetingLink,
                title: `${sessionUnitCode} — ${platform.name}`,
            });
        } catch (err) {
            console.warn('[OnlineTaker] Share meeting error:', err.message);
        }
    };

    /**
     * Share attendance link via device share sheet
     */
    const handleShareLink = async () => {
        try {
            await Share.share({
                message: `📋 Mark your attendance for ${sessionUnitCode}:\n\nTap the link below in MarkWise to mark attendance:\n${shareableLink}\n\n⏰ Session closes in ${formatDuration(timeRemaining)}`,
                url: shareableLink,
                title: `${sessionUnitCode} Attendance`,
            });
        } catch (err) {
            console.warn('[OnlineTaker] Share error:', err.message);
        }
    };

    /**
     * End the current session
     */
    const handleEndSession = () => {
        Alert.alert(
            'End Session',
            'Are you sure you want to close this attendance window?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'End Session',
                    style: 'destructive',
                    onPress: async () => {
                        setEnding(true);
                        try {
                            const session = await getLecturerSession();
                            await fetch(`${SESS_BASE}/${sessionId}/end`, {
                                method: 'POST',
                                headers: { Authorization: `Bearer ${session?.token}` },
                            }).catch(() => {});
                            
                            // Show summary
                            Alert.alert(
                                'Session Ended',
                                `Total attendees: ${attendees.length}`,
                                [{ text: 'OK' }]
                            );
                        } finally {
                            clearInterval(pollTimer.current);
                            clearInterval(countdownTimer.current);
                            if (isMounted.current) {
                                setSessionActive(false);
                                setEnding(false);
                                setSessionId(null);
                                setSessionUnitCode('');
                                setShareableLink('');
                                setSetupUnitCode('');
                                setMeetingLink('');
                                setMeetingPasscode('');
                            }
                        }
                    },
                },
            ],
        );
    };

    /**
     * Manually refresh attendees list
     */
    const handleRefresh = useCallback(async () => {
        if (!sessionId) return;
        setRefreshing(true);
        await fetchAttendees(sessionId);
        if (isMounted.current) setRefreshing(false);
    }, [sessionId, fetchAttendees]);

    // Filtered attendees based on search query
    const filteredAttendees = searchQuery.trim()
        ? attendees.filter((item) => {
              const q = searchQuery.toLowerCase();
              const name = (item.studentName ?? item.name ?? '').toLowerCase();
              const admission = (item.admissionNumber ?? item.studentId ?? '').toLowerCase();
              return name.includes(q) || admission.includes(q);
          })
        : attendees;

    /**
     * Render individual attendee item
     */
    const renderAttendee = ({ item, index }) => (
        <Animated.View 
            style={[
                styles.attendeeRow,
                index === 0 && styles.firstAttendee
            ]}
        >
            <LinearGradient
                colors={[colors.primary.main, colors.purple.main]}
                style={styles.attendeeAvatar}
            >
                <Text style={styles.attendeeAvatarText}>
                    {(item.studentName ?? item.name ?? '?').charAt(0).toUpperCase()}
                </Text>
            </LinearGradient>
            <View style={styles.attendeeInfo}>
                <Text style={styles.attendeeName} numberOfLines={1}>
                    {item.studentName ?? item.name ?? 'Unknown'}
                </Text>
                <Text style={styles.attendeeAdmission} numberOfLines={1}>
                    {item.admissionNumber ?? item.studentId ?? '—'}
                </Text>
            </View>
            <View style={styles.attendeeTime}>
                <Icon name="clock-outline" size={14} color={colors.text.muted} />
                <Text style={styles.attendeeTimeText}>
                    {item.timestamp ? new Date(item.timestamp).toLocaleTimeString() : 'Just now'}
                </Text>
            </View>
            <Icon name="check-circle" size={22} color={colors.success.main} />
        </Animated.View>
    );

    return (
        <SafeAreaView style={styles.screen} edges={['top']}>
            <StatusBar barStyle="dark-content" backgroundColor={colors.background.card} />

            {/* ── Header ───────────────────────────────────────────────── */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                    <Icon name="arrow-left" size={24} color={colors.text.primary} />
                </TouchableOpacity>
                <Text style={[styles.headerTitle, isTablet && { fontSize: 20 }]}>Online Attendance</Text>
                {sessionActive ? (
                    <LinearGradient
                        colors={[colors.warning.soft, 'transparent']}
                        style={styles.timerPill}
                    >
                        <Icon name="clock-outline" size={14} color={colors.warning.main} />
                        <Text style={styles.timerPillText}>{formatDuration(timeRemaining)}</Text>
                    </LinearGradient>
                ) : (
                    <View style={{ width: 72 }} />
                )}
            </View>

            {!sessionActive ? (
                // ── PHASE 1: Setup Form ──────────────────────────────────
                <KeyboardAvoidingView
                    style={{ flex: 1 }}
                    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                >
                    <ScrollView
                        contentContainerStyle={[
                            styles.setupScroll,
                            { paddingHorizontal: r.pad },
                            isTablet && { alignItems: 'center' },
                        ]}
                        showsVerticalScrollIndicator={false}
                    >
                        {/* Constrain width on wider screens */}
                        <View style={[
                            { width: '100%' },
                            isTablet && { maxWidth: contentMaxWidth },
                        ]}>

                        {/* Hero Section */}
                        <LinearGradient colors={colors.primary.gradient} style={[
                            styles.heroIcon,
                            { width: r.heroSize, height: r.heroSize, borderRadius: r.heroSize / 2 },
                        ]}>
                            <Icon name="link-variant-plus" size={isDesktop ? 56 : isTablet ? 50 : 44} color="#fff" />
                        </LinearGradient>
                        
                        <Text style={[styles.setupTitle, { fontSize: r.titleSize }]}>Create Attendance Link</Text>
                        <Text style={[styles.setupDesc, { fontSize: r.bodySize }]}>
                            Generate a secure link to share in your virtual classroom.
                            Students tap it to open MarkWise and mark attendance — identity verified automatically via their account.
                        </Text>

                        {/* Form Card */}
                        <View style={styles.card}>
                            {/* Unit Selection */}
                            <Text style={styles.fieldLabel}>
                                Unit Code <Text style={styles.required}>*</Text>
                            </Text>
                            
                            {loadingUnits ? (
                                <View style={styles.loadingRow}>
                                    <ActivityIndicator size="small" color={colors.primary.main} />
                                    <Text style={styles.loadingText}>Loading your units…</Text>
                                </View>
                            ) : loadUnitsError && units.length === 0 ? (
                                // ── Error state: show error + retry + manual fallback ──
                                <View>
                                    <View style={styles.unitsErrorBox}>
                                        <Icon name="alert-circle-outline" size={16} color={colors.danger.main} />
                                        <Text style={styles.unitsErrorMsg} numberOfLines={3}>{loadUnitsError}</Text>
                                        <TouchableOpacity onPress={loadUnits} style={styles.retryBtn} activeOpacity={0.7}>
                                            <Icon name="refresh" size={15} color={colors.primary.main} />
                                            <Text style={styles.retryBtnText}>Retry</Text>
                                        </TouchableOpacity>
                                    </View>
                                    <View style={[styles.meetingInputRow, { marginTop: 10 }]}>
                                        <Icon name="book-open-outline" size={18} color={colors.primary.main} />
                                        <TextInput
                                            style={styles.meetingInput}
                                            placeholder="Enter unit code manually (e.g. CS101)"
                                            placeholderTextColor={colors.text.muted}
                                            value={setupUnitCode}
                                            onChangeText={(v) => { setSetupUnitCode(v.toUpperCase()); setUnitCodeError(''); }}
                                            autoCapitalize="characters"
                                            autoCorrect={false}
                                        />
                                        {!!setupUnitCode && (
                                            <TouchableOpacity onPress={() => setSetupUnitCode('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                                                <Icon name="close-circle" size={18} color={colors.text.muted} />
                                            </TouchableOpacity>
                                        )}
                                    </View>
                                </View>
                            ) : (
                                <TouchableOpacity
                                    style={[
                                        styles.selectButton,
                                        unitCodeError ? styles.selectButtonError : null
                                    ]}
                                    onPress={() => units.length > 0 && setDropdownOpen(true)}
                                    activeOpacity={0.7}
                                >
                                    <Icon name="book-open-outline" size={18} color={colors.primary.main} />
                                    {setupUnitCode ? (
                                        <Text style={styles.selectButtonText} numberOfLines={1}>
                                            {units.find(u => u.code === setupUnitCode)?.display ?? setupUnitCode}
                                        </Text>
                                    ) : (
                                        <Text style={styles.selectButtonPlaceholder} numberOfLines={1}>
                                            {units.length > 0 ? 'Choose a unit…' : 'No units found'}
                                        </Text>
                                    )}
                                    <Icon name="chevron-down" size={18} color={colors.text.muted} />
                                </TouchableOpacity>
                            )}
                            
                            {!!unitCodeError && (
                                <View style={styles.errorRow}>
                                    <Icon name="alert-circle-outline" size={14} color={colors.danger.main} />
                                    <Text style={styles.errorMsg}>{unitCodeError}</Text>
                                </View>
                            )}

                            <View style={styles.divider} />

                            {/* Form Fields Preview */}
                            <Text style={styles.previewHeading}>What gets recorded per student:</Text>
                            {FORM_FIELDS.map(({ icon, label, note }) => (
                                <View key={label} style={styles.previewRow}>
                                    <LinearGradient
                                        colors={[colors.primary.soft, 'transparent']}
                                        style={styles.previewIconWrap}
                                    >
                                        <Icon name={icon} size={14} color={colors.primary.main} />
                                    </LinearGradient>
                                    <View style={styles.previewContent}>
                                        <Text style={styles.previewField}>{label}</Text>
                                        <Text style={styles.previewNote}>{note}</Text>
                                    </View>
                                </View>
                            ))}

                            <View style={styles.divider} />

                            {/* Session Info */}
                            <View style={styles.infoRow}>
                                <Icon name="information-outline" size={16} color={colors.info.main} />
                                <Text style={styles.infoText}>
                                    Session duration: <Text style={styles.infoHighlight}>{formatDuration(SESSION_DURATION_MS)}</Text>
                                </Text>
                            </View>
                            <View style={styles.infoRow}>
                                <Icon name="account-group-outline" size={16} color={colors.success.main} />
                                <Text style={styles.infoText}>
                                    Identity verified via student's MarkWise account · Device-bound
                                </Text>
                            </View>
                        </View>

                        {/* Generate Button */}
                        <TouchableOpacity
                            style={styles.primaryBtn}
                            onPress={handleStartSession}
                            disabled={starting || !setupUnitCode}
                            activeOpacity={0.8}
                        >
                            <LinearGradient 
                                colors={starting ? ['#6B7280', '#4B5563'] : colors.primary.gradient} 
                                style={styles.btnGradient}
                            >
                                {starting ? (
                                    <ActivityIndicator color="#fff" size="small" />
                                ) : (
                                    <>
                                        <Icon name="link-variant-plus" size={20} color="#fff" />
                                        <Text style={styles.btnText}>Generate Attendance Link</Text>
                                    </>
                                )}
                            </LinearGradient>
                        </TouchableOpacity>

                        {/* Help Text */}
                        <View style={styles.helpContainer}>
                            <Icon name="help-circle-outline" size={16} color={colors.text.muted} />
                            <Text style={[styles.helpText, { fontSize: r.bodySize - 1 }]}>
                                The link will be active for {formatDuration(SESSION_DURATION_MS)}. 
                                Students who submit after that won't be recorded.
                            </Text>
                        </View>

                        {/* Meeting Link Card */}
                        <View style={styles.card}>
                            <View style={styles.meetingCardHeader}>
                                <LinearGradient colors={['#10B981', '#34D399']} style={styles.meetingCardIcon}>
                                    <Icon name="video" size={16} color="#fff" />
                                </LinearGradient>
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.meetingCardTitle}>Meeting Link</Text>
                                    <Text style={styles.meetingCardSubtitle}>Optional · Share before class starts</Text>
                                </View>
                            </View>
                            <View style={styles.meetingInputRow}>
                                <Icon name="link-variant" size={18} color={colors.text.muted} />
                                <TextInput
                                    style={styles.meetingInput}
                                    placeholder="Paste Zoom, Google Meet or Teams URL…"
                                    placeholderTextColor={colors.text.muted}
                                    value={meetingLink}
                                    onChangeText={setMeetingLink}
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    keyboardType="url"
                                />
                                {!!meetingLink && (
                                    <TouchableOpacity onPress={() => setMeetingLink('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                                        <Icon name="close-circle" size={18} color={colors.text.muted} />
                                    </TouchableOpacity>
                                )}
                            </View>

                            {/* Passcode row */}
                            <View style={[styles.meetingInputRow, { marginTop: 10 }]}>
                                <Icon name="lock-outline" size={18} color={colors.text.muted} />
                                <TextInput
                                    style={styles.meetingInput}
                                    placeholder="Room passcode (optional)"
                                    placeholderTextColor={colors.text.muted}
                                    value={meetingPasscode}
                                    onChangeText={setMeetingPasscode}
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    secureTextEntry={false}
                                />
                                {!!meetingPasscode && (
                                    <TouchableOpacity onPress={() => setMeetingPasscode('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                                        <Icon name="close-circle" size={18} color={colors.text.muted} />
                                    </TouchableOpacity>
                                )}
                            </View>

                            {/* Send invite button — visible once a meeting link is entered */}
                            {!!meetingLink.trim() && (
                                <TouchableOpacity
                                    style={styles.sendInviteBtn}
                                    onPress={() => setShareMeetingVisible(true)}
                                    activeOpacity={0.8}
                                >
                                    <LinearGradient
                                        colors={['#10B981', '#059669']}
                                        style={styles.sendInviteBtnGradient}
                                    >
                                        <Icon name="send" size={16} color="#fff" />
                                        <Text style={styles.sendInviteBtnText}>Send to Students</Text>
                                    </LinearGradient>
                                </TouchableOpacity>
                            )}
                        </View>

                        </View>{/* end maxWidth wrapper */}
                    </ScrollView>
                </KeyboardAvoidingView>
            ) : (
                // ── PHASE 2: Active Session ───────────────────────────────
                <View style={{ flex: 1 }}>
                    <FlatList
                        data={filteredAttendees}
                        keyExtractor={(item, index) => String(item.studentId ?? item.id ?? index)}
                        renderItem={renderAttendee}
                        numColumns={numColumns}
                        key={numColumns} /* force re-mount when columns change */
                        contentContainerStyle={[
                            styles.listContent,
                            isTablet && { alignSelf: 'center', width: '100%', maxWidth: contentMaxWidth + r.pad * 2 },
                        ]}
                        columnWrapperStyle={numColumns > 1 ? { gap: 10 } : null}
                        showsVerticalScrollIndicator={false}
                        refreshControl={
                            <RefreshControl
                                refreshing={refreshing}
                                onRefresh={handleRefresh}
                                colors={[colors.primary.main]}
                                tintColor={colors.primary.main}
                            />
                        }
                        ListHeaderComponent={
                            <View style={isTablet ? { maxWidth: contentMaxWidth, alignSelf: 'center', width: '100%' } : null}>
                                {/* Share Link Card */}
                                <LinearGradient
                                    colors={[colors.background.card, colors.background.card]}
                                    style={styles.shareCard}
                                >
                                    <View style={styles.cardHeader}>
                                        <View style={styles.cardTitleRow}>
                                            <LinearGradient
                                                colors={colors.primary.gradient}
                                                style={styles.cardIcon}
                                            >
                                                <Icon name="link-variant" size={16} color="#fff" />
                                            </LinearGradient>
                                            <Text style={styles.cardTitle}>Attendance Link</Text>
                                        </View>
                                        <View style={styles.unitBadge}>
                                            <Icon name="school" size={12} color={colors.primary.main} />
                                            <Text style={styles.unitBadgeText}>{sessionUnitCode}</Text>
                                        </View>
                                    </View>

                                    <Text style={styles.cardDescription}>
                                        Share this link in your Zoom, Google Meet, or Teams chat.
                                    </Text>

                                    {/* Link Display */}
                                    <View style={styles.linkContainer}>
                                        <Icon name="link" size={18} color={colors.primary.main} />
                                        <Text style={styles.linkText} selectable numberOfLines={2}>
                                            {shareableLink}
                                        </Text>
                                    </View>

                                    {/* Action Buttons */}
                                    <View style={styles.actionRow}>
                                        <TouchableOpacity
                                            style={styles.copyButton}
                                            onPress={handleCopyLink}
                                            activeOpacity={0.7}
                                        >
                                            <Icon
                                                name={copied ? 'check-circle' : 'content-copy'}
                                                size={20}
                                                color={copied ? colors.success.main : colors.primary.main}
                                            />
                                            <Text style={[
                                                styles.copyButtonText,
                                                copied && { color: colors.success.main }
                                            ]}>
                                                {copied ? 'Copied!' : 'Copy'}
                                            </Text>
                                        </TouchableOpacity>

                                        <TouchableOpacity
                                            style={styles.shareButton}
                                            onPress={handleShareLink}
                                            activeOpacity={0.7}
                                        >
                                            <LinearGradient
                                                colors={colors.primary.gradient}
                                                style={styles.shareButtonGradient}
                                            >
                                                <Icon name="share-variant" size={20} color="#fff" />
                                                <Text style={styles.shareButtonText}>Share</Text>
                                            </LinearGradient>
                                        </TouchableOpacity>
                                    </View>

                                    {/* Quick Tips */}
                                    <View style={styles.tipsContainer}>
                                        <Icon name="lightbulb-outline" size={14} color={colors.warning.main} />
                                        <Text style={styles.tipsText}>
                                            Students: Tap link in chat → MarkWise opens → Tap "Mark My Attendance"
                                        </Text>
                                    </View>
                                </LinearGradient>

                                {/* Meeting Link Card (only if provided) */}
                                {!!meetingLink && (() => {
                                    const platform = detectPlatform(meetingLink);
                                    return (
                                    <View style={styles.meetingActiveCard}>
                                        <View style={styles.cardHeader}>
                                            <View style={styles.cardTitleRow}>
                                                <LinearGradient
                                                    colors={['#10B981', '#34D399']}
                                                    style={styles.cardIcon}
                                                >
                                                    <Icon name={platform.icon} size={16} color="#fff" />
                                                </LinearGradient>
                                                <Text style={styles.cardTitle}>{platform.name}</Text>
                                            </View>
                                        </View>
                                        <View style={styles.meetingLinkDisplay}>
                                            <Icon name="link-variant" size={16} color={colors.success.main} />
                                            <Text style={styles.meetingLinkText} selectable numberOfLines={2}>
                                                {meetingLink}
                                            </Text>
                                        </View>
                                        {!!meetingPasscode && (
                                            <View style={styles.passcodeRow}>
                                                <Icon name="lock-outline" size={15} color={colors.warning.main} />
                                                <Text style={styles.passcodeLabel}>Passcode:</Text>
                                                <Text style={styles.passcodeValue} selectable>{meetingPasscode}</Text>
                                            </View>
                                        )}
                                        <View style={styles.actionRow}>
                                            <TouchableOpacity
                                                style={styles.meetingCopyBtn}
                                                onPress={handleCopyMeetingLink}
                                                activeOpacity={0.7}
                                            >
                                                <Icon
                                                    name={copiedMeeting ? 'check-circle' : 'content-copy'}
                                                    size={18}
                                                    color={copiedMeeting ? colors.success.main : colors.success.main}
                                                />
                                                <Text style={[styles.meetingCopyBtnText, copiedMeeting && { color: colors.success.main }]}>
                                                    {copiedMeeting ? 'Copied!' : 'Copy'}
                                                </Text>
                                            </TouchableOpacity>
                                            <TouchableOpacity
                                                style={styles.shareButton}
                                                onPress={handleShareMeetingLink}
                                                activeOpacity={0.7}
                                            >
                                                <LinearGradient
                                                    colors={['#10B981', '#34D399']}
                                                    style={styles.shareButtonGradient}
                                                >
                                                    <Icon name="share-variant" size={18} color="#fff" />
                                                    <Text style={styles.shareButtonText}>Share</Text>
                                                </LinearGradient>
                                            </TouchableOpacity>
                                        </View>
                                    </View>
                                    );
                                })()}

                                {/* Search Bar */}
                                <View style={styles.searchRow}>
                                    <Icon name="magnify" size={18} color={colors.text.muted} />
                                    <TextInput
                                        style={styles.searchInput}
                                        placeholder="Search by name or admission number…"
                                        placeholderTextColor={colors.text.muted}
                                        value={searchQuery}
                                        onChangeText={setSearchQuery}
                                        autoCorrect={false}
                                        autoCapitalize="none"
                                        clearButtonMode="while-editing"
                                    />
                                    {!!searchQuery && (
                                        <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                                            <Icon name="close-circle" size={18} color={colors.text.muted} />
                                        </TouchableOpacity>
                                    )}
                                </View>

                                {/* Attendee Stats */}
                                <View style={styles.statsHeader}>
                                    <View style={styles.statsBadge}>
                                        <Icon name="account-check" size={18} color={colors.success.main} />
                                        <Text style={styles.statsCount}>
                                            {searchQuery.trim() ? filteredAttendees.length : attendees.length}
                                        </Text>
                                        <Text style={styles.statsLabel}>
                                            {searchQuery.trim()
                                                ? `of ${attendees.length} Present`
                                                : attendees.length === 1 ? 'Student Present' : 'Students Present'}
                                        </Text>
                                    </View>
                                    <TouchableOpacity onPress={handleRefresh} style={styles.refreshButton}>
                                        <Icon 
                                            name="refresh" 
                                            size={18} 
                                            color={colors.text.muted}
                                            style={refreshing && styles.spinning}
                                        />
                                    </TouchableOpacity>
                                </View>
                            </View>
                        }
                        ListEmptyComponent={
                            <View style={styles.emptyState}>
                                <LinearGradient
                                    colors={[colors.primary.soft, 'transparent']}
                                    style={styles.emptyIcon}
                                >
                                    <Icon name="account-clock-outline" size={48} color={colors.primary.main} />
                                </LinearGradient>
                                <Text style={styles.emptyTitle}>Waiting for Students</Text>
                                <Text style={styles.emptyDescription}>
                                    Students will appear here once they submit the form
                                </Text>
                                <View style={styles.emptyHint}>
                                    <Icon name="information-outline" size={14} color={colors.text.muted} />
                                    <Text style={styles.emptyHintText}>
                                        Make sure you've shared the attendance link
                                    </Text>
                                </View>
                            </View>
                        }
                    />

                    {/* End Session Footer */}
                    <LinearGradient
                        colors={['transparent', colors.background.screen]}
                        style={styles.footerGradient}
                    >
                        <TouchableOpacity
                            style={[styles.endButton, ending && styles.endButtonDisabled]}
                            onPress={handleEndSession}
                            disabled={ending}
                            activeOpacity={0.8}
                        >
                            <LinearGradient 
                                colors={ending ? ['#6B7280', '#4B5563'] : colors.danger.gradient} 
                                style={styles.endButtonGradient}
                            >
                                {ending ? (
                                    <ActivityIndicator color="#fff" size="small" />
                                ) : (
                                    <>
                                        <Icon name="stop-circle" size={20} color="#fff" />
                                        <Text style={styles.endButtonText}>End Session</Text>
                                    </>
                                )}
                            </LinearGradient>
                        </TouchableOpacity>
                    </LinearGradient>
                </View>
            )}

            {/* ── Share Meeting Modal ────────────────────────────────────── */}
            <ShareMeetingModal
                visible={shareMeetingVisible}
                onClose={() => setShareMeetingVisible(false)}
                onSent={() => setShareMeetingVisible(false)}
                unitCode={setupUnitCode}
                unitName={units.find(u => u.code === setupUnitCode)?.name ?? ''}
                meetingLink={meetingLink}
                passcode={meetingPasscode}
            />

            {/* ── Unit Selection Modal ───────────────────────────────────── */}
            <Modal
                visible={dropdownOpen}
                transparent
                animationType="slide"
                onRequestClose={() => setDropdownOpen(false)}
            >
                <TouchableOpacity
                    style={styles.modalOverlay}
                    activeOpacity={1}
                    onPress={() => setDropdownOpen(false)}
                >
                    <View
                        onStartShouldSetResponder={() => true}
                        style={[
                            styles.modalContent,
                            isTablet && {
                                alignSelf: 'center',
                                width: Math.min(width * 0.85, 560),
                                borderRadius: 24,
                            },
                        ]}
                    >
                        <View style={styles.modalHandle} />
                        <Text style={styles.modalTitle}>Select a Unit</Text>
                        
                        <FlatList
                            data={units}
                            keyExtractor={(item) => item.code}
                            renderItem={({ item }) => (
                                <TouchableOpacity
                                    style={[
                                        styles.modalItem,
                                        item.code === setupUnitCode && styles.modalItemSelected,
                                    ]}
                                    onPress={() => {
                                        setSetupUnitCode(item.code);
                                        setUnitCodeError('');
                                        setDropdownOpen(false);
                                    }}
                                    activeOpacity={0.7}
                                >
                                    <View style={styles.modalItemContent}>
                                        <Text style={styles.modalItemCode}>{item.code}</Text>
                                        {item.name && item.name !== item.code && (
                                            <Text style={styles.modalItemName} numberOfLines={1}>
                                                {item.name}
                                            </Text>
                                        )}
                                    </View>
                                    {item.code === setupUnitCode && (
                                        <Icon name="check-circle" size={20} color={colors.primary.main} />
                                    )}
                                </TouchableOpacity>
                            )}
                            ItemSeparatorComponent={() => <View style={styles.modalSeparator} />}
                            showsVerticalScrollIndicator={false}
                        />
                    </View>
                </TouchableOpacity>
            </Modal>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    screen: {
        flex: 1,
        backgroundColor: colors.background.screen,
    },

    // ── Header Styles ─────────────────────────────────────────────────
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 14,
        backgroundColor: colors.background.card,
        borderBottomWidth: 1,
        borderBottomColor: colors.border.light,
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 3,
    },
    backBtn: {
        width: 40,
        height: 40,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: colors.text.primary,
    },
    timerPill: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 20,
        gap: 6,
        minWidth: 72,
    },
    timerPillText: {
        fontSize: 13,
        fontWeight: '700',
        color: colors.warning.main,
    },

    // ── Setup Phase Styles ────────────────────────────────────────────
    setupScroll: {
        flexGrow: 1,
        paddingHorizontal: 20,
        paddingTop: 32,
        paddingBottom: 40,
    },
    heroIcon: {
        width: 96,
        height: 96,
        borderRadius: 48,
        justifyContent: 'center',
        alignItems: 'center',
        alignSelf: 'center',
        marginBottom: 24,
        elevation: 4,
        shadowColor: colors.primary.main,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
    },
    setupTitle: {
        fontSize: 24,
        fontWeight: '700',
        color: colors.text.primary,
        marginBottom: 8,
        textAlign: 'center',
    },
    setupDesc: {
        fontSize: 14,
        color: colors.text.secondary,
        textAlign: 'center',
        lineHeight: 22,
        marginBottom: 24,
        paddingHorizontal: 8,
    },

    // ── Card Styles ───────────────────────────────────────────────────
    card: {
        backgroundColor: colors.background.card,
        borderRadius: 20,
        padding: 20,
        marginBottom: 20,
        borderWidth: 1,
        borderColor: colors.border.light,
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 8,
    },
    shareCard: {
        borderRadius: 20,
        padding: 20,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: colors.border.light,
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 8,
    },
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
    },
    cardTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    cardIcon: {
        width: 28,
        height: 28,
        borderRadius: 8,
        justifyContent: 'center',
        alignItems: 'center',
    },
    cardTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.text.primary,
    },
    cardDescription: {
        fontSize: 13,
        color: colors.text.secondary,
        marginBottom: 16,
        lineHeight: 18,
    },

    // ── Form Field Styles ─────────────────────────────────────────────
    fieldLabel: {
        fontSize: 13,
        fontWeight: '600',
        color: colors.text.secondary,
        marginBottom: 6,
    },
    required: {
        color: colors.danger.main,
    },
    selectButton: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.background.screen,
        borderRadius: 12,
        borderWidth: 1.5,
        borderColor: colors.border.light,
        paddingHorizontal: 14,
        paddingVertical: 14,
        gap: 10,
    },
    selectButtonError: {
        borderColor: colors.danger.main,
        backgroundColor: colors.danger.soft,
    },
    selectButtonText: {
        flex: 1,
        fontSize: 15,
        color: colors.text.primary,
        fontWeight: '500',
    },
    selectButtonPlaceholder: {
        flex: 1,
        fontSize: 15,
        color: colors.text.muted,
    },
    loadingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.background.screen,
        borderRadius: 12,
        paddingHorizontal: 14,
        paddingVertical: 14,
        gap: 10,
    },
    loadingText: {
        fontSize: 15,
        color: colors.text.muted,
    },
    errorRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 6,
        gap: 6,
    },
    errorMsg: {
        fontSize: 12,
        color: colors.danger.main,
    },

    // ── Divider ───────────────────────────────────────────────────────
    divider: {
        height: 1,
        backgroundColor: colors.border.light,
        marginVertical: 16,
    },

    // ── Preview Section ───────────────────────────────────────────────
    previewHeading: {
        fontSize: 12,
        fontWeight: '700',
        color: colors.text.muted,
        textTransform: 'uppercase',
        letterSpacing: 0.6,
        marginBottom: 12,
    },
    previewRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
        gap: 12,
    },
    previewIconWrap: {
        width: 32,
        height: 32,
        borderRadius: 8,
        justifyContent: 'center',
        alignItems: 'center',
    },
    previewContent: {
        flex: 1,
    },
    previewField: {
        fontSize: 13,
        fontWeight: '600',
        color: colors.text.primary,
        marginBottom: 2,
    },
    previewNote: {
        fontSize: 11,
        color: colors.text.muted,
    },

    // ── Info Row ──────────────────────────────────────────────────────
    infoRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 8,
        marginBottom: 10,
    },
    infoText: {
        flex: 1,
        fontSize: 13,
        color: colors.text.secondary,
        lineHeight: 18,
    },
    infoHighlight: {
        fontWeight: '600',
        color: colors.primary.main,
    },

    // ── Button Styles ─────────────────────────────────────────────────
    primaryBtn: {
        borderRadius: 14,
        overflow: 'hidden',
        elevation: 2,
        shadowColor: colors.primary.main,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 8,
    },
    btnGradient: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 16,
        gap: 10,
    },
    btnText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '700',
    },

    // ── Help Container ────────────────────────────────────────────────
    helpContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginTop: 16,
        paddingHorizontal: 12,
    },
    helpText: {
        flex: 1,
        fontSize: 12,
        color: colors.text.muted,
        lineHeight: 18,
    },

    // ── Link Display ──────────────────────────────────────────────────
    linkContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.primary.soft,
        borderRadius: 12,
        padding: 14,
        marginBottom: 16,
        gap: 10,
        borderWidth: 1,
        borderColor: colors.primary.light,
    },
    linkText: {
        flex: 1,
        fontSize: 13,
        color: colors.primary.dark,
        lineHeight: 18,
    },

    // ── Action Buttons ────────────────────────────────────────────────
    actionRow: {
        flexDirection: 'row',
        gap: 12,
        marginBottom: 16,
    },
    copyButton: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 12,
        borderRadius: 12,
        borderWidth: 1.5,
        borderColor: colors.primary.main,
        backgroundColor: colors.primary.soft,
    },
    copyButtonText: {
        fontSize: 15,
        fontWeight: '600',
        color: colors.primary.main,
    },
    shareButton: {
        flex: 1,
        borderRadius: 12,
        overflow: 'hidden',
    },
    shareButtonGradient: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 12,
        gap: 8,
    },
    shareButtonText: {
        color: '#fff',
        fontSize: 15,
        fontWeight: '600',
    },

    // ── Tips Container ────────────────────────────────────────────────
    tipsContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        padding: 12,
        backgroundColor: colors.warning.soft,
        borderRadius: 10,
    },
    tipsText: {
        flex: 1,
        fontSize: 12,
        color: colors.warning.main,
        fontWeight: '500',
    },

    // ── Search Bar ────────────────────────────────────────────────────
    searchRow: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.background.card,
        borderRadius: 12,
        borderWidth: 1.5,
        borderColor: colors.border.light,
        paddingHorizontal: 12,
        paddingVertical: 10,
        marginBottom: 12,
        gap: 8,
    },
    searchInput: {
        flex: 1,
        fontSize: 14,
        color: colors.text.primary,
        padding: 0,
    },

    // ── Units error box ────────────────────────────────────────────────
    unitsErrorBox: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 8,
        backgroundColor: colors.danger.soft,
        borderRadius: 12,
        paddingHorizontal: 14,
        paddingVertical: 12,
        flexWrap: 'wrap',
    },
    unitsErrorMsg: {
        flex: 1,
        fontSize: 13,
        color: colors.danger.main,
        lineHeight: 18,
    },
    retryBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 8,
        backgroundColor: colors.primary.soft,
        borderWidth: 1,
        borderColor: colors.primary.main,
        marginTop: 6,
    },
    retryBtnText: {
        fontSize: 12,
        fontWeight: '600',
        color: colors.primary.main,
    },

    // ── Send Invite Button ─────────────────────────────────────────────
    sendInviteBtn: {
        borderRadius: 12,
        overflow: 'hidden',
        marginTop: 14,
        elevation: 1,
        shadowColor: '#10B981',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.18,
        shadowRadius: 6,
    },
    sendInviteBtnGradient: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 13,
        gap: 8,
    },
    sendInviteBtnText: {
        fontSize: 14,
        fontWeight: '700',
        color: '#fff',
    },

    // ── Meeting Link (setup) ────────────────────────────────────────────
    meetingCardHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        marginBottom: 12,
    },
    meetingCardIcon: {
        width: 28,
        height: 28,
        borderRadius: 8,
        justifyContent: 'center',
        alignItems: 'center',
    },
    meetingCardTitle: {
        fontSize: 14,
        fontWeight: '700',
        color: colors.text.primary,
    },
    meetingCardSubtitle: {
        fontSize: 11,
        color: colors.text.muted,
        marginTop: 1,
    },
    meetingInputRow: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.background.screen,
        borderRadius: 12,
        borderWidth: 1.5,
        borderColor: colors.border.light,
        paddingHorizontal: 12,
        paddingVertical: 12,
        gap: 10,
    },
    meetingInput: {
        flex: 1,
        fontSize: 14,
        color: colors.text.primary,
        padding: 0,
    },

    // ── Meeting Link (active session card) ───────────────────────────
    meetingActiveCard: {
        backgroundColor: colors.background.card,
        borderRadius: 20,
        padding: 20,
        marginBottom: 16,
        borderWidth: 1.5,
        borderColor: '#10B981',
        elevation: 2,
        shadowColor: '#10B981',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
    },
    meetingLinkDisplay: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(16,185,129,0.08)',
        borderRadius: 12,
        padding: 14,
        marginBottom: 14,
        gap: 10,
        borderWidth: 1,
        borderColor: 'rgba(16,185,129,0.25)',
    },
    meetingLinkText: {
        flex: 1,
        fontSize: 13,
        color: colors.success.main,
        lineHeight: 18,
    },
    meetingCopyBtn: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 12,
        borderRadius: 12,
        borderWidth: 1.5,
        borderColor: colors.success.main,
        backgroundColor: colors.success.soft,
    },
    meetingCopyBtnText: {
        fontSize: 15,
        fontWeight: '600',
        color: colors.success.main,
    },
    passcodeRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: colors.warning.soft,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 8,
        marginBottom: 14,
    },
    passcodeLabel: {
        fontSize: 13,
        fontWeight: '600',
        color: colors.warning.main,
    },
    passcodeValue: {
        fontSize: 13,
        fontWeight: '700',
        color: colors.warning.main,
        letterSpacing: 1,
    },

    // ── Stats Header ──────────────────────────────────────────────────
    statsHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 16,
        paddingHorizontal: 4,
    },
    statsBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.success.soft,
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 30,
        gap: 8,
    },
    statsCount: {
        fontSize: 16,
        fontWeight: '700',
        color: colors.success.main,
        marginLeft: 2,
    },
    statsLabel: {
        fontSize: 13,
        fontWeight: '500',
        color: colors.success.main,
    },
    refreshButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: colors.background.card,
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: colors.border.light,
    },
    spinning: {
        transform: [{ rotate: '45deg' }],
    },

    // ── Unit Badge ────────────────────────────────────────────────────
    unitBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.primary.soft,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
        gap: 4,
    },
    unitBadgeText: {
        fontSize: 12,
        fontWeight: '600',
        color: colors.primary.main,
    },

    // ── List Content ──────────────────────────────────────────────────
    listContent: {
        paddingHorizontal: 16,
        paddingBottom: 100,
    },

    // ── Attendee Row ──────────────────────────────────────────────────
    attendeeRow: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.background.card,
        borderRadius: 16,
        padding: 14,
        marginBottom: 8,
        borderWidth: 1,
        borderColor: colors.border.light,
        elevation: 1,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.02,
        shadowRadius: 2,
    },
    firstAttendee: {
        borderColor: colors.primary.light,
        borderWidth: 1.5,
    },
    attendeeAvatar: {
        width: 44,
        height: 44,
        borderRadius: 22,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    attendeeAvatarText: {
        fontSize: 18,
        fontWeight: '700',
        color: '#fff',
    },
    attendeeInfo: {
        flex: 1,
    },
    attendeeName: {
        fontSize: 15,
        fontWeight: '600',
        color: colors.text.primary,
        marginBottom: 2,
    },
    attendeeAdmission: {
        fontSize: 12,
        color: colors.text.muted,
    },
    attendeeTime: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        marginRight: 12,
    },
    attendeeTimeText: {
        fontSize: 11,
        color: colors.text.muted,
    },

    // ── Empty State ───────────────────────────────────────────────────
    emptyState: {
        alignItems: 'center',
        paddingVertical: 40,
        paddingHorizontal: 32,
    },
    emptyIcon: {
        width: 96,
        height: 96,
        borderRadius: 48,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 20,
    },
    emptyTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: colors.text.primary,
        marginBottom: 8,
    },
    emptyDescription: {
        fontSize: 14,
        color: colors.text.secondary,
        textAlign: 'center',
        marginBottom: 16,
        lineHeight: 20,
    },
    emptyHint: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: colors.info.soft,
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 20,
    },
    emptyHintText: {
        fontSize: 12,
        color: colors.info.main,
        fontWeight: '500',
    },

    // ── Footer ────────────────────────────────────────────────────────
    footerGradient: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        paddingTop: 20,
        paddingHorizontal: 16,
        paddingBottom: 16,
    },
    endButton: {
        borderRadius: 14,
        overflow: 'hidden',
        elevation: 2,
        shadowColor: colors.danger.main,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 8,
    },
    endButtonDisabled: {
        opacity: 0.7,
    },
    endButtonGradient: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 16,
        gap: 10,
    },
    endButtonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '700',
    },

    // ── Modal Styles ──────────────────────────────────────────────────
    modalOverlay: {
        flex: 1,
        backgroundColor: colors.overlay.light,
        justifyContent: 'flex-end',
    },
    modalContent: {
        backgroundColor: colors.background.card,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        padding: 20,
        paddingBottom: Platform.OS === 'ios' ? 40 : 20,
        maxHeight: '80%',
    },
    modalHandle: {
        width: 40,
        height: 4,
        borderRadius: 2,
        backgroundColor: colors.border.light,
        alignSelf: 'center',
        marginBottom: 16,
    },
    modalTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: colors.text.primary,
        marginBottom: 16,
    },
    modalItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 16,
        paddingHorizontal: 8,
    },
    modalItemSelected: {
        backgroundColor: colors.primary.soft,
        borderRadius: 12,
        marginHorizontal: -4,
        paddingHorizontal: 12,
    },
    modalItemContent: {
        flex: 1,
    },
    modalItemCode: {
        fontSize: 15,
        fontWeight: '700',
        color: colors.text.primary,
        marginBottom: 2,
    },
    modalItemName: {
        fontSize: 13,
        color: colors.text.secondary,
    },
    modalSeparator: {
        height: 1,
        backgroundColor: colors.border.light,
    },
});