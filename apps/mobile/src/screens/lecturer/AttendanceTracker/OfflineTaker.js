import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
    View,
    StyleSheet,
    Text,
    StatusBar,
    NativeModules,
    TouchableOpacity,
    ScrollView,
    Modal,
    TextInput,
    FlatList,
    AppState,
    ActivityIndicator,
    Alert,
    Vibration,
    InteractionManager,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import QRCodeGenerator from '../../../components/QRCodeGenerator';
import getBleManager from '../../../utils/bleManager';
import {
    QR_ROTATION_MS,
    SESSION_DURATION_MS,
    MANUAL_TOKEN_ROTATION_MS,
} from '../../../utils/constants';
import sessionManager from '../../../utils/sessionManager';
import sqliteStorage from '../../../storage/sqliteStorage';
import { generateManualAttendanceToken } from '../../../utils/manualAttendanceToken';
import { encodeQrPayload } from '../../../utils/qrSigning';
import { generateSessionNonce, encodeBLEBeacon, deriveCounter, QR_WINDOW_SECONDS } from '../../../utils/sessionCrypto';
import { storeSessionKey, clearSessionKey } from '../../../utils/sessionKeyStore';
import { useAdaptiveAttendance, adaptiveConfig } from '../../../utils/adaptiveAttendanceConfig';
import { getLecturerSession } from '../../../utils/authSession';
import { fetchMyLecturerTimetable } from '../../../utils/lecturerTimetableApi';
import { syncConductedSession } from '../../../utils/offlineAttendanceApi';
import { 
    fetchAndCacheUnitRoster,
    submitManualMark,
    syncPendingManualMarks,
    getRosterStatus,
} from '../../../utils/manualMarkApi';
import { useInternetStatus } from '../../../hooks/useInternetStatus';
import Icon from 'react-native-vector-icons/Ionicons';
import LinearGradient from 'react-native-linear-gradient';
import { Buffer } from 'buffer';
import colors from '../../../theme/colors';

const { BLEAdvertiserModule } = NativeModules;
const manager = getBleManager();

// Polyfill Buffer for React Native if not present
if (typeof global.Buffer === 'undefined') {
    global.Buffer = Buffer;
}

/* global crypto */ // polyfilled by react-native-get-random-values via sessionCrypto import

// ─── Timetable room-selection helpers ────────────────────────────────────────

const _DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const _parseDow = (dayStr) => {
    if (!dayStr || typeof dayStr !== 'string') return -1;
    const prefix = dayStr.trim().toLowerCase().slice(0, 3);
    return _DAYS.findIndex(d => d.startsWith(prefix));
};

const _parseMinutes = (timeStr) => {
    if (!timeStr || typeof timeStr !== 'string') return null;
    const s = timeStr.trim();
    let m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*$/);
    if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)$/i);
    if (m) {
        let h = parseInt(m[1], 10);
        const min = parseInt(m[2], 10);
        const pm = m[3].toLowerCase() === 'pm';
        if (pm && h !== 12) h += 12;
        if (!pm && h === 12) h = 0;
        return h * 60 + min;
    }
    return null;
};

/**
 * Returns the best-matching timetable entry for the current moment.
 * Priority: active now > upcoming today (soonest) > soonest future day > ended today.
 */
const pickBestTimetableEntry = (entries) => {
    const now = new Date();
    const todayDow = now.getDay();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const DAY = 24 * 60;
    let best = null;
    let bestScore = Infinity;
    for (const e of entries) {
        const dow = _parseDow(e.day);
        const startMin = _parseMinutes(e.startTime);
        const endMin = _parseMinutes(e.endTime);
        let score;
        if (dow < 0) {
            score = 14 * DAY; // no day info — lowest priority
        } else {
            const diff = ((dow - todayDow) + 7) % 7;
            if (diff === 0) {
                if (startMin !== null && endMin !== null) {
                    if (nowMin >= startMin && nowMin <= endMin) score = 0; // active now
                    else if (nowMin < startMin) score = startMin - nowMin; // upcoming today
                    else score = 8 * DAY + (nowMin - endMin); // past today — low priority
                } else {
                    score = 7 * DAY; // today, no time data
                }
            } else {
                score = diff * DAY + (startMin ?? 0); // future day
            }
        }
        if (score < bestScore) { bestScore = score; best = e; }
    }
    return best;
};

// Picker Modal Component
const PickerModal = React.memo(({
    visible,
    onClose,
    title,
    items,
    onSelect,
    selectedItem,
    searchQuery,
    onSearchChange,
    searchPlaceholder,
    renderItemExtra,
}) => (
    <Modal
        visible={visible}
        transparent
        animationType="slide"
        onRequestClose={onClose}
    >
        <View style={styles.modalOverlay}>
            <View style={styles.modalBackdrop} />
            <View style={styles.modalContainer}>
                <View style={styles.modalHeader}>
                    <Text style={styles.modalTitle}>{title}</Text>
                    <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                        <Icon name="close" size={24} color="#666" />
                    </TouchableOpacity>
                </View>
                
                <View style={styles.searchContainer}>
                    <View style={styles.searchInputRow}>
                        <Icon name="search" size={20} color="#8A8A95" />
                        <TextInput
                            style={styles.searchInput}
                            value={searchQuery}
                            onChangeText={onSearchChange}
                            placeholder={searchPlaceholder}
                            placeholderTextColor="#8A8A95"
                            autoCapitalize="none"
                            autoCorrect={false}
                            clearButtonMode="while-editing"
                        />
                    </View>
                </View>
                
                <FlatList
                    style={styles.modalContent}
                    data={items}
                    keyExtractor={(item, index) => item?.id || item?.code || String(index)}
                    keyboardShouldPersistTaps="handled"
                    ListEmptyComponent={
                        <View style={styles.emptyStateContainer}>
                            <Icon name="search-outline" size={48} color="#666" />
                            <Text style={styles.emptyStateText}>No matches found</Text>
                        </View>
                    }
                    renderItem={({ item }) => {
                        const isSelected = selectedItem?.id === item?.id || 
                                         selectedItem?.code === item?.code ||
                                         selectedItem?.roomCode === item?.roomCode;
                        return (
                            <TouchableOpacity
                                style={[styles.pickerItem, isSelected && styles.pickerItemSelected]}
                                onPress={() => {
                                    onSelect(item);
                                    onClose();
                                }}
                            >
                                <View style={styles.pickerItemContent}>
                                    <Text style={[styles.pickerItemText, isSelected && styles.pickerItemTextSelected]}>
                                        {item.display}
                                    </Text>
                                    {item.category && (
                                        <Text style={styles.pickerItemSubtext}>{item.category}</Text>
                                    )}
                                    {item.building && (
                                        <Text style={styles.pickerItemSubtext}>
                                            {item.building} • Floor {item.floor}
                                        </Text>
                                    )}
                                    {renderItemExtra && renderItemExtra(item)}
                                </View>
                                {isSelected && (
                                    <Icon name="checkmark-circle" size={24} color={colors.primary.main} />
                                )}
                            </TouchableOpacity>
                        );
                    }}
                />
            </View>
        </View>
    </Modal>
));

// Glass Card Component
const GlassCard = ({ children, style, innerStyle }) => (
    <View style={[styles.glassCard, style]}>
        <View style={[styles.glassCardInner, innerStyle]}>{children}</View>
    </View>
);

// Status Chip Component
const StatusChip = ({ type, message, icon }) => {
    const colorMap = {
        success: colors.success,
        warning: colors.warning,
        error: colors.danger,
        info: colors.info,
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

const OfflineTaker = () => {
    const {
        units: allUnits,
        rooms: allRooms,
        isLoading,
        lastSync,
        error,
        stats,
        refresh,
        debugMappings,
        getUnitId,
        getRoomId,
        getUnitDisplayName,
    } = useAdaptiveAttendance();
    const { isOnline } = useInternetStatus();
    const wasOnlineRef = useRef(isOnline);

    // Declared early — referenced in the effect below and in lecturerUnitsLoad effect.
    const [lecturerUnitCodes, setLecturerUnitCodes] = useState(new Set());
    const [lecturerTimetableEntries, setLecturerTimetableEntries] = useState([]);
    const lecturerUnitsLoadedRef = useRef(false);

    // Drain the offline manual-mark queue and refresh rosters whenever internet is restored.
    useEffect(() => {
        const justRestored = !wasOnlineRef.current && isOnline;
        wasOnlineRef.current = isOnline;
        if (!justRestored) return;
        const syncMarks = async () => {
            try {
                const session = await getLecturerSession();
                if (session?.token) {
                    await syncPendingManualMarks(session.token);
                    // Re-cache rosters for all lecturer units so they're available offline going forward.
                    if (lecturerUnitCodes && lecturerUnitCodes.size > 0 && session.institutionId) {
                        for (const code of lecturerUnitCodes) {
                            await fetchAndCacheUnitRoster(code, session.institutionId, session.token).catch(() => {});
                        }
                    }
                }
            } catch (_) {}
        };
        syncMarks();
    }, [isOnline, lecturerUnitCodes]);

    const [selectedUnit, setSelectedUnit] = useState(null);
    const [selectedRoom, setSelectedRoom] = useState(null);
    const [unitSearchQuery, setUnitSearchQuery] = useState('');
    const [roomSearchQuery, setRoomSearchQuery] = useState('');
    const [showUnitPicker, setShowUnitPicker] = useState(false);
    const [showRoomPicker, setShowRoomPicker] = useState(false);
    const [qrData, setQrData] = useState('');
    const [manualToken, setManualToken] = useState('');
    const [manualTokenRemainingSec, setManualTokenRemainingSec] = useState(
        Math.ceil(MANUAL_TOKEN_ROTATION_MS / 1000),
    );
    const [qrRefreshSec, setQrRefreshSec] = useState(
        Math.max(1, Math.ceil((QR_ROTATION_MS - (Date.now() % QR_ROTATION_MS)) / 1000)),
    );
    const [sessionStart, setSessionStart] = useState(null);
    const [isAdvertising, setIsAdvertising] = useState(false);
    const [isAdvertisingSupported, setIsAdvertisingSupported] = useState(false);
    const [isBluetoothOn, setIsBluetoothOn] = useState(false);
    const [bleError, setBleError] = useState('');
    const [sessionRemainingMs, setSessionRemainingMs] = useState(null);
    const [sessionActive, setSessionActive] = useState(false);
    const [bleStatus, setBleStatus] = useState('');
    const [sessionCounter, setSessionCounter] = useState(1);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [showHelp, setShowHelp] = useState(false);
    const [showManualModal, setShowManualModal] = useState(false);
    const [rosterStudentList, setRosterStudentList] = useState([]);
    const [rosterListLoading, setRosterListLoading] = useState(false);
    const [rosterFilterQuery, setRosterFilterQuery] = useState('');
    const markingStudentIdsRef = useRef(new Set());
    const [markingStudentIds, setMarkingStudentIds] = useState(new Set());
    const [markedStudentIds, setMarkedStudentIds] = useState(new Set());
    const [manualMarkSuccess, setManualMarkSuccess] = useState('');
    const [mappingsReady, setMappingsReady] = useState(false);
    const [syncStatus, setSyncStatus] = useState('');
    const [rosterLoading, setRosterLoading] = useState(false);
    const [rosterError, setRosterError] = useState(null);
    const [rosterStudentCount, setRosterStudentCount] = useState(0);

    // ===== Refs for roster fetching =====
    const rosterFetchAttemptedRef = useRef(false);
    const rosterFetchPromiseRef = useRef(null);
    
    const persistedSessionKeyRef = useRef(null);
    const qrTimerRef = useRef(null);
    const advertisingStartedRef = useRef(false);
    const appStateRef = useRef(AppState.currentState);
    const syncAttemptedRef = useRef(false);
    const lastAdvertisedPayloadRef = useRef(null);
    const unitIdRef = useRef(null);
    const roomIdRef = useRef(null);
    const sessionStartSetRef = useRef(false);
    const isMountedRef = useRef(true);
    const sessionNonceRef = useRef(null);
    const sessionKeyRef = useRef(null);
    const pendingAutoRoomCodeRef = useRef(null); // deferred auto-room when allRooms loads late
    // Mirrors for state values read inside async AppState callback (avoids stale closures)
    const sessionStartRef = useRef(null);
    const sessionActiveRef = useRef(false);
    const selectedUnitRef = useRef(null);
    const selectedRoomRef = useRef(null);

    // Keep AppState-callback refs in sync with state
    useEffect(() => { sessionStartRef.current = sessionStart; }, [sessionStart]);
    useEffect(() => { sessionActiveRef.current = sessionActive; }, [sessionActive]);
    useEffect(() => { selectedUnitRef.current = selectedUnit; }, [selectedUnit]);
    useEffect(() => { selectedRoomRef.current = selectedRoom; }, [selectedRoom]);

    // ===== ID CACHING + MAPPINGS READY CHECK (merged to avoid duplicate effect runs) =====
    useEffect(() => {
        const unitId = selectedUnit?.code ? getUnitId(selectedUnit.code) : null;
        const roomId = selectedRoom?.roomCode ? getRoomId(selectedRoom.roomCode) : null;
        if (unitId != null) unitIdRef.current = unitId;
        if (roomId != null) roomIdRef.current = roomId;
        if (selectedUnit && selectedRoom) {
            const resolvedUnit = unitIdRef.current != null ? unitIdRef.current : unitId;
            const resolvedRoom = roomIdRef.current != null ? roomIdRef.current : roomId;
            const ready = resolvedUnit != null && resolvedRoom != null;
            setMappingsReady(prev => prev !== ready ? ready : prev);
        }
    }, [selectedUnit, selectedRoom, getUnitId, getRoomId]);

    // ===== LOAD LECTURER-ASSIGNED UNITS =====
    useEffect(() => {
        if (lecturerUnitsLoadedRef.current) return;
        lecturerUnitsLoadedRef.current = true;
        const norm = (code) => String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

        const load = async () => {
            try {
                const session = await getLecturerSession();
                if (!session?.token) return;
                const tt = await fetchMyLecturerTimetable(session.token);
                const entries = Array.isArray(tt) ? tt : [];
                const codes = new Set();
                for (const entry of entries) {
                    const code = norm(entry?.unitCode);
                    if (code) codes.add(code);
                }
                if (!isMountedRef.current) return;
                setLecturerTimetableEntries(entries);
                setLecturerUnitCodes(codes.size > 0 ? codes : new Set());

                // Proactively cache rosters for all assigned units so manual
                // attendance works even when the lecturer later goes offline.
                if (isOnline && codes.size > 0 && session.institutionId) {
                    for (const code of codes) {
                        await fetchAndCacheUnitRoster(code, session.institutionId, session.token).catch(() => {});
                    }
                }
            } catch (_) {
                if (isMountedRef.current) setLecturerUnitCodes(new Set());
            }
        };

        load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ===== SYNC MAPPINGS IN BACKGROUND =====
    // Deferred via InteractionManager so the first render completes before any
    // network work starts — user can pick unit/room immediately, cached IDs are
    // already available from useAdaptiveAttendance.
    useEffect(() => {
        isMountedRef.current = true;
        if (syncAttemptedRef.current) return () => { isMountedRef.current = false; };

        let retryCount = 0;
        const MAX_RETRIES = 3;

        const runSync = async () => {
            try {
                const session = await getLecturerSession();
                if (!session?.institutionId || !session?.token) return;

                if (typeof adaptiveConfig?.setInstitution === 'function') {
                    adaptiveConfig.setInstitution(session.institutionId);
                }
                if (typeof adaptiveConfig?.syncInstitutionMappingsFromBackend !== 'function') return;

                await adaptiveConfig.syncInstitutionMappingsFromBackend(session.institutionId, session.token);
                syncAttemptedRef.current = true;
                // notifyListeners() inside syncInstitutionMappingsFromBackend already updates units/rooms state.
            } catch (_) {
                if (isMountedRef.current && retryCount < MAX_RETRIES) {
                    retryCount++;
                    // Exponential back-off: 5s, 10s, 15s — all silent
                    setTimeout(runSync, 5000 * retryCount);
                }
            }
        };

        const task = InteractionManager.runAfterInteractions(runSync);
        return () => {
            isMountedRef.current = false;
            task.cancel();
        };
    }, []);

    // ===== Fetch roster when unit is selected =====
    useEffect(() => {
        if (!selectedUnit?.code) {
            setRosterError(null);
            setRosterStudentCount(0);
            rosterFetchAttemptedRef.current = false;
            rosterFetchPromiseRef.current = null;
            return;
        }

        // Already attempted and succeeded for this unit — skip.
        // (handleUnitSelect resets rosterFetchAttemptedRef on every unit change,
        //  so this guard only fires when the effect re-runs for the same unit.)
        if (rosterFetchAttemptedRef.current && rosterStudentCount > 0 && !rosterError) {
            return;
        }

        // If there's already a fetch in progress, don't start another
        if (rosterFetchPromiseRef.current) {
            return;
        }

        const fetchRoster = async () => {
            setRosterLoading(true);
            setRosterError(null);
            
            try {
                const session = await getLecturerSession();
                if (!session?.token) {
                    throw new Error('Not authenticated. Please log in again.');
                }

                if (!session?.institutionId) {
                    throw new Error('Institution ID not found. Please contact support.');
                }

                const result = await fetchAndCacheUnitRoster(
                    selectedUnit.code,
                    session.institutionId,
                    session.token
                );

                if (result.success) {
                    if (result.studentCount > 0) {
                        setRosterStudentCount(result.studentCount);
                        setRosterError(null);
                    } else {
                        setRosterError('No enrolled students found for this unit. Manual attendance may not work.');
                        setRosterStudentCount(0);
                    }
                } else {
                    setRosterError(result.error || 'Failed to load student roster');
                    setRosterStudentCount(0);

                    try {
                        const status = await getRosterStatus(selectedUnit.code, session.institutionId);
                        if (status.hasCache && status.studentCount > 0) {
                            setRosterStudentCount(status.studentCount);
                        }
                    } catch (_) {}
                }
            } catch (err) {
                setRosterError(err.message || 'Unexpected error loading roster');
                setRosterStudentCount(0);
            } finally {
                setRosterLoading(false);
                rosterFetchAttemptedRef.current = true;
                rosterFetchPromiseRef.current = null;
            }
        };

        rosterFetchPromiseRef.current = fetchRoster();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedUnit?.code]); // rosterStudentCount/rosterError read only as a one-time guard; adding them would cause a refetch loop

    // Deferred auto-room: applied once allRooms is populated after a unit was selected
    // while mappings were still loading (common on first open).
    useEffect(() => {
        if (!pendingAutoRoomCodeRef.current || !allRooms.length || selectedRoom) return;
        const norm = (code) => String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        const target = norm(pendingAutoRoomCodeRef.current);
        const match = allRooms.find(r => norm(r.roomCode) === target);
        if (match) {
            pendingAutoRoomCodeRef.current = null;
            setSelectedRoom(match);
        }
    }, [allRooms, selectedRoom]);

    // Generate QR data and manual PIN using per-session HMAC key
    const generateQrData = useCallback(() => {
        const unitId = unitIdRef.current;
        const roomId = roomIdRef.current;
        const nonce = sessionNonceRef.current;
        const key = sessionKeyRef.current;
        if (unitId == null || roomId == null || !sessionStart || !nonce || !key) return;

        const session = {
            unitId,
            roomId,
            sessionStart: Math.floor(sessionStart / 1000),
            sessionDuration: Math.floor(SESSION_DURATION_MS / 1000),
            sessionNonce: nonce,
        };

        setQrData(encodeQrPayload(session, key));
        setManualToken(generateManualAttendanceToken({ session, sessionKey: key }));
    }, [sessionStart]);

    // When a unit is selected, auto-fill the room from today's scheduled session.
    const handleUnitSelect = useCallback((unit) => {
        // Reset roster state so the new unit's roster is fetched fresh.
        setRosterError(null);
        setRosterStudentCount(0);
        rosterFetchAttemptedRef.current = false;
        rosterFetchPromiseRef.current = null;
        pendingAutoRoomCodeRef.current = null;

        setSelectedRoom(null); // clear previous room before auto-selecting for new unit
        setSelectedUnit(unit);
        if (!unit) return;

        const norm = (code) => String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        const normCode = norm(unit.code);

        // Collect all entries for this unit that carry venue information
        const unitEntries = lecturerTimetableEntries.filter(
            e => norm(e?.unitCode) === normCode && (e?.roomCode || e?.venue || e?.lectureRoom)
        );
        if (!unitEntries.length) return;

        // Pick the entry that best matches the current day and time
        const best = pickBestTimetableEntry(unitEntries);
        if (!best) return;

        const roomCode = best.roomCode;
        if (!roomCode) return;

        const roomNorm = norm(roomCode);

        // Resolve against the loaded room list
        let match = allRooms.find(r => norm(r.roomCode) === roomNorm);

        // Secondary: resolve via numeric roomId from the timetable entry
        if (!match && best.roomId) {
            const resolved = adaptiveConfig.getRoomCodeFromId(best.roomId);
            if (resolved) match = allRooms.find(r => norm(r.roomCode) === norm(resolved));
        }

        if (match) {
            setSelectedRoom(match);
        } else {
            // allRooms not populated yet — defer to the effect above
            pendingAutoRoomCodeRef.current = roomCode;
        }
    }, [lecturerTimetableEntries, allRooms]);

    const filteredUnits = useMemo(() => {
        const norm = (code) => String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        const assignedUnits = lecturerUnitCodes != null && lecturerUnitCodes.size > 0
            ? allUnits.filter(item => lecturerUnitCodes.has(norm(item.code)))
            : allUnits;
        const query = unitSearchQuery.trim().toLowerCase();
        if (!query) return assignedUnits;
        return assignedUnits.filter(item =>
            item.display.toLowerCase().includes(query) ||
            item.code.toLowerCase().includes(query) ||
            item.name?.toLowerCase().includes(query)
        );
    }, [allUnits, unitSearchQuery, lecturerUnitCodes]);

    const filteredRooms = useMemo(() => {
        const query = roomSearchQuery.trim().toLowerCase();
        if (!query) return allRooms;
        return allRooms.filter(item => {
            const fields = [item.display, item.roomCode, item.building, item.floor];
            return fields.filter(Boolean).some(f => String(f).toLowerCase().includes(query));
        });
    }, [allRooms, roomSearchQuery]);

    const formatRemaining = useCallback((ms) => {
        if (ms == null) return '';
        const minutes = Math.floor(ms / 60000);
        const seconds = Math.floor((ms % 60000) / 1000);
        return `${minutes}:${String(seconds).padStart(2, '0')}`;
    }, []);

    // Bluetooth state listener
    useEffect(() => {
        const subscription = manager.onStateChange((state) => {
            const newIsBluetoothOn = state === 'PoweredOn';
            setIsBluetoothOn(newIsBluetoothOn);
            if (!newIsBluetoothOn) {
                setIsAdvertisingSupported(false);
                setBleError('Bluetooth is off');
            } else {
                setBleError('');
            }
        }, true);
        return () => subscription.remove();
    }, []);

    // Check BLE advertising support
    useEffect(() => {
        if (!isBluetoothOn || !BLEAdvertiserModule) return;

        let cancelled = false;
        const MAX_ATTEMPTS = 4;
        const RETRY_DELAY_MS = 500;

        const check = async (attempt = 1) => {
            try {
                const supported = await BLEAdvertiserModule.isAdvertisingSupported();
                if (cancelled) return;
                if (!supported && attempt < MAX_ATTEMPTS) {
                    setTimeout(() => { if (!cancelled) check(attempt + 1); }, RETRY_DELAY_MS);
                    return;
                }
                setIsAdvertisingSupported(!!supported);
                if (!supported) {
                    setBleError('BLE advertising not supported on this device');
                }
            } catch (e) {
                if (cancelled) return;
                setIsAdvertisingSupported(false);
                setBleError('Failed to check BLE support');
            }
        };

        check();
        return () => { cancelled = true; };
    }, [isBluetoothOn]);

    // Session countdown
    useEffect(() => {
        let intervalId;
        const update = () => {
            const end = sessionManager.getSessionEnd();
            if (end && Date.now() < end) {
                setSessionRemainingMs(end - Date.now());
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

    // Handle app state changes — starts/stops background BLE beacon task
    useEffect(() => {
        const subscription = AppState.addEventListener('change', async (nextAppState) => {
            const wasBackground = appStateRef.current.match(/inactive|background/);
            appStateRef.current = nextAppState;

            if (wasBackground && nextAppState === 'active') {
                // Stop background beacon task and resume foreground advertising
                try {
                    const BackgroundActions = require('react-native-background-actions').default;
                    if (await BackgroundActions.isRunning()) await BackgroundActions.stop();
                } catch (_) {}

                if (selectedUnitRef.current && selectedRoomRef.current) {
                    generateQrData();
                }
            } else if (nextAppState.match(/inactive|background/)) {
                // Start background beacon if a session is active
                const nonce = sessionNonceRef.current;
                const unitId = unitIdRef.current;
                const roomId = roomIdRef.current;
                const start = sessionStartRef.current;

                if (sessionActiveRef.current && nonce && unitId != null && roomId != null && start) {
                    const remainingMs = start + SESSION_DURATION_MS - Date.now();
                    if (remainingMs > 5000) {
                        try {
                            const BackgroundActions = require('react-native-background-actions').default;
                            const { lecturerBackgroundTask } = require('../../../services/backgroundBLEService');
                            const unit = selectedUnitRef.current;
                            const room = selectedRoomRef.current;
                            await BackgroundActions.start(lecturerBackgroundTask, {
                                taskName:             'lecturerBeacon',
                                taskTitle:            'Attendance Session Active',
                                taskDesc:             `${unit?.code ?? ''} • ${room?.roomCode ?? ''}`,
                                taskIcon:             { name: 'ic_launcher', type: 'mipmap' },
                                color:                '#4F46E5',
                                foregroundServiceType: ['connectedDevice'],
                                parameters: {
                                    unitId,
                                    roomId,
                                    sessionNonce: nonce,
                                    sessionStart: start,
                                    lessonTypeId: 0,
                                    remainingMs,
                                },
                            });
                        } catch (_) {}
                    }
                }
            }
        });

        return () => subscription.remove();
    }, [generateQrData]);

    // Manual token + QR refresh countdown timers
    useEffect(() => {
        const updateRemaining = () => {
            const pinMs = MANUAL_TOKEN_ROTATION_MS - (Date.now() % MANUAL_TOKEN_ROTATION_MS);
            setManualTokenRemainingSec(Math.max(1, Math.ceil(pinMs / 1000)));
            const qrMs = QR_ROTATION_MS - (Date.now() % QR_ROTATION_MS);
            setQrRefreshSec(Math.max(1, Math.ceil(qrMs / 1000)));
        };

        updateRemaining();
        const intervalId = setInterval(updateRemaining, 250);
        return () => clearInterval(intervalId);
    }, []);

    // Persist conducted session
    const persistConductedSession = useCallback(async (unitCode, lectureRoom, start) => {
        if (!unitCode || !lectureRoom || !Number.isFinite(start)) return;

        const key = `${unitCode}|${lectureRoom}|${start}`;
        if (persistedSessionKeyRef.current === key) return;

        persistedSessionKeyRef.current = key;
        const createdAt = Date.now();
        try {
            await sqliteStorage.addConductedSession({
                unitCode,
                lectureRoom,
                sessionStart: start,
                createdAt,
            });
        } catch (_) {
            persistedSessionKeyRef.current = null;
            return;
        }
        // Forward sessionKey and sessionNonce so the backend can verify student tokens.
        // If this sync fails (offline), the key is already in Keychain; a manual retry
        // path or future reconnect handler can re-send it using the Keychain entry.
        syncConductedSession({
            unitCode,
            lectureRoom,
            sessionStart: start,
            createdAt,
            sessionKey:   sessionKeyRef.current,
            sessionNonce: sessionNonceRef.current,
        }).catch(() => {});
    }, []);

    // Session start effect
    useEffect(() => {
        if (selectedUnit && selectedRoom) {
            if (sessionStart === null && !sessionStartSetRef.current) {
                sessionStartSetRef.current = true;
                const now = Math.floor(Date.now() / 1000) * 1000;

                // Generate crypto material BEFORE persisting so syncConductedSession
                // can forward sessionKey + sessionNonce to the backend in the same call.
                sessionNonceRef.current = generateSessionNonce();
                const keyBuf = new Uint8Array(32);
                crypto.getRandomValues(keyBuf);
                const newKey = Array.from(keyBuf).map(b => b.toString(16).padStart(2, '0')).join('');
                sessionKeyRef.current = newKey;

                setSessionStart(now);
                setSessionCounter(prev => (prev % 255) + 1);
                sessionManager.startSessionAt(now, SESSION_DURATION_MS);

                const unitCode = selectedUnit?.code;
                const lectureRoom = selectedRoom?.roomCode;
                if (unitCode && lectureRoom) {
                    // Store key in hardware Keychain so it survives an offline sync failure.
                    // The sessionId is the same composite key used by persistedSessionKeyRef.
                    const sessionId = `${unitCode}|${lectureRoom}|${now}`;
                    storeSessionKey(sessionId, newKey).catch(() => {});
                    persistConductedSession(unitCode, lectureRoom, now);
                }
            }
        } else {
            // Clear key from Keychain when the lecturer ends the session.
            const unitCode = selectedUnit?.code ?? null;
            const lectureRoom = selectedRoom?.roomCode ?? null;
            if (unitCode && lectureRoom && sessionStart !== null) {
                const sessionId = `${unitCode}|${lectureRoom}|${sessionStart}`;
                clearSessionKey(sessionId).catch(() => {});
            }
            sessionStartSetRef.current = false;
            if (sessionStart !== null) setSessionStart(null);
            sessionNonceRef.current = null;
            sessionKeyRef.current = null;
        }
    }, [selectedUnit, selectedRoom, sessionStart, persistConductedSession]);

    // QR rotation timer — schedules based on sessionStart rather than the async sessionActive
    // flag to avoid a ~500 ms gap where the QR is generated once but never rotated.
    useEffect(() => {
        if (qrTimerRef.current) clearTimeout(qrTimerRef.current);

        if (!selectedUnit || !selectedRoom || !sessionStart) return;

        generateQrData();

        const scheduleNextUpdate = () => {
            const now = Date.now();
            const timeUntilNextEpoch = QR_ROTATION_MS - (now % QR_ROTATION_MS);
            qrTimerRef.current = setTimeout(() => {
                // sessionManager is the source of truth — cheaper than reading sessionActive state
                if (sessionManager.isSessionActive()) {
                    generateQrData();
                    scheduleNextUpdate();
                }
            }, timeUntilNextEpoch);
        };

        scheduleNextUpdate();

        return () => {
            if (qrTimerRef.current) clearTimeout(qrTimerRef.current);
        };
    }, [selectedUnit, selectedRoom, sessionStart, generateQrData]);

    // BLE advertising payload creation — secure format v0x01
    const createPayload = useCallback(() => {
        const unitId = unitIdRef.current;
        const roomId = roomIdRef.current;
        const nonce  = sessionNonceRef.current;
        if (unitId == null || roomId == null || !sessionStart || !nonce) return null;
        const counter = deriveCounter(Math.floor(sessionStart / 1000), QR_WINDOW_SECONDS, Date.now());
        const bytes = encodeBLEBeacon({
            sessionNonce: nonce & 0xFFFF,
            counter,
            unitId,
            roomId,
            lessonTypeId: 0,
        });
        return Buffer.from(bytes).toString('base64');
    }, [sessionStart]);

    const startAdvertising = useCallback(async (force = false) => {
        const unitCode = selectedUnit?.code;
        const roomCode = selectedRoom?.roomCode;
        
        if (!isBluetoothOn || !isAdvertisingSupported || !unitCode || !roomCode || !sessionActive) {
            return;
        }

        let unitId = unitIdRef.current;
        let roomId = roomIdRef.current;

        if (unitId == null || roomId == null) {
            unitId = getUnitId(unitCode);
            roomId = getRoomId(roomCode);
            unitIdRef.current = unitId;
            roomIdRef.current = roomId;
        }

        if (unitId == null || roomId == null) {
            setBleError('Missing IDs');
            return;
        }

        const payload = createPayload();
        if (!payload) {
            setBleError('Session not ready');
            return;
        }

        if (!force && lastAdvertisedPayloadRef.current === payload) {
            return;
        }

        if (!BLEAdvertiserModule) {
            setBleError('BLE advertising not available on this device');
            return;
        }

        try {
            if (advertisingStartedRef.current) {
                await BLEAdvertiserModule.stopAdvertising();
                advertisingStartedRef.current = false;
            }

            if (BLEAdvertiserModule.startAdvertisingWithServiceUUID) {
                await BLEAdvertiserModule.startAdvertisingWithServiceUUID(
                    payload,
                    '00001101-0000-1000-8000-00805F9B34FB'
                );
            } else {
                await BLEAdvertiserModule.startAdvertising(payload);
            }

            lastAdvertisedPayloadRef.current = payload;
            advertisingStartedRef.current = true;
            setIsAdvertising(true);
            setBleStatus(`Broadcasting #${sessionCounter}`);
            setBleError('');
        } catch (e) {
            setBleError(e.message);
            setIsAdvertising(false);
            advertisingStartedRef.current = false;
        }
    }, [selectedUnit, selectedRoom, isBluetoothOn, isAdvertisingSupported, sessionActive,
        sessionCounter, getUnitId, getRoomId, createPayload]);

    // Main advertising effect
    useEffect(() => {
        let timerId;
        let isActive = true;

        const scheduleAdvertising = () => {
            if (!isActive) return;
            startAdvertising(false);
            if (isActive) {
                const now = Date.now();
                const nextUpdate = QR_ROTATION_MS - (now % QR_ROTATION_MS);
                timerId = setTimeout(scheduleAdvertising, nextUpdate);
            }
        };

        if (selectedUnit && selectedRoom && isBluetoothOn && isAdvertisingSupported && sessionActive) {
            scheduleAdvertising();
        }

        return () => {
            isActive = false;
            if (timerId) {
                clearTimeout(timerId);
            }
            if (advertisingStartedRef.current) {
                // Reset UI immediately — don't wait for the async native stop.
                // If stopAdvertising() returns a non-Promise the .then() never fires,
                // leaving isAdvertising stuck true and the chip showing "Broadcasting"
                // long after the session has ended.
                setIsAdvertising(false);
                advertisingStartedRef.current = false;
                BLEAdvertiserModule?.stopAdvertising?.()?.catch(() => {});
            }
        };
    }, [selectedUnit, selectedRoom, isBluetoothOn, isAdvertisingSupported, sessionActive, startAdvertising]);

    // Force update when sessionCounter changes
    useEffect(() => {
        if (advertisingStartedRef.current) {
            startAdvertising(true);
        }
    }, [sessionCounter, startAdvertising]);

    // Cleanup
    useEffect(() => {
        return () => {
            if (qrTimerRef.current) {
                clearTimeout(qrTimerRef.current);
            }
            if (advertisingStartedRef.current) {
                BLEAdvertiserModule?.stopAdvertising?.()?.catch(() => {});
            }
            sessionManager.stopSession();
        };
    }, []);

    const handleRefresh = useCallback(async () => {
        setIsRefreshing(true);
        setSyncStatus('Refreshing...');
        await refresh();
        
        try {
            const session = await getLecturerSession();
            if (session?.institutionId && session?.token) {
                if (adaptiveConfig && typeof adaptiveConfig.syncInstitutionMappingsFromBackend === 'function') {
                    await adaptiveConfig.syncInstitutionMappingsFromBackend(session.institutionId, session.token);
                    setSyncStatus('Sync complete');
                    
                    if (selectedUnit?.code) {
                        unitIdRef.current = getUnitId(selectedUnit.code);
                    }
                    if (selectedRoom?.roomCode) {
                        roomIdRef.current = getRoomId(selectedRoom.roomCode);
                    }
                }
            }
        } catch (_) {
            setSyncStatus('Sync failed');
        }
        
        setTimeout(() => setSyncStatus(''), 2000);
        setIsRefreshing(false);
    }, [refresh, selectedUnit, selectedRoom, getUnitId, getRoomId]);

    const handleDebug = useCallback(() => {
        if (!__DEV__) {
            Alert.alert('Debug', 'Debug info only available in development builds.');
            return;
        }
        if (debugMappings) debugMappings();
        Alert.alert('Debug', 'Mappings dumped — check logcat.');
    }, [debugMappings]);

    // Reset marked-student set when the session context changes — NOT when the modal merely closes.
    // Resetting on modal close lost all "already marked" state when the lecturer reopened the roster
    // within the same session, allowing accidental duplicate marks.
    useEffect(() => {
        setMarkedStudentIds(new Set());
    }, [selectedUnit?.code, sessionStart]);

    // ===== Roster list: load when modal opens =====
    useEffect(() => {
        if (!showManualModal) {
            return;
        }
        if (!selectedUnit?.code) return;
        setRosterListLoading(true);
        setRosterFilterQuery('');
        const loadRoster = async () => {
            try {
                const list = await sqliteStorage.getAllCachedStudentsForUnit(selectedUnit.code);
                if (isMountedRef.current) setRosterStudentList(list);
            } catch (_) {
                // Silently fail
            } finally {
                if (isMountedRef.current) setRosterListLoading(false);
            }
        };
        loadRoster();
    }, [showManualModal, selectedUnit?.code]);

    // ===== Filtered roster for search =====
    const filteredRosterStudents = useMemo(() => {
        const q = rosterFilterQuery.trim().toLowerCase();
        if (!q) return rosterStudentList;
        return rosterStudentList.filter(s =>
            s.studentName?.toLowerCase().includes(q) ||
            s.admissionNumber?.toLowerCase().includes(q)
        );
    }, [rosterStudentList, rosterFilterQuery]);

    // ===== Manual mark student from roster =====
    const handleManualMarkStudent = useCallback(async (student) => {
        if (!student?.studentId) return;
        if (markingStudentIdsRef.current.has(student.studentId)) return;
        markingStudentIdsRef.current.add(student.studentId);
        setMarkingStudentIds(new Set(markingStudentIdsRef.current));
        try {
            const session = await getLecturerSession();
            const effectiveRoom = selectedRoom?.roomCode || selectedRoom?.name || 'MANUAL';
            const effectiveStart = Number.isFinite(sessionStart) ? sessionStart : Date.now();
            await syncConductedSession({
                unitCode: selectedUnit.code,
                lectureRoom: effectiveRoom,
                sessionStart: effectiveStart,
                createdAt: effectiveStart,
                sessionKey:   sessionKeyRef.current,
                sessionNonce: sessionNonceRef.current,
            }).catch(() => {});
            const result = await submitManualMark({
                admissionNumber: student.admissionNumber,
                studentId: student.studentId,
                unitCode: selectedUnit.code,
                lectureRoom: effectiveRoom,
                sessionStart: effectiveStart,
                lecturerId: session?.lecturerId,
                token: session?.token,
            });
            setMarkedStudentIds(prev => new Set([...prev, student.studentId]));
            if (!result?.duplicate) Vibration.vibrate(100);
            const msg = result?.queued
                ? `${student.studentName} queued (offline) ✓`
                : result?.duplicate
                ? `${student.studentName} already marked ✓`
                : `${student.studentName} marked present ✓`;
            setManualMarkSuccess(msg);
            setTimeout(() => { if (isMountedRef.current) setManualMarkSuccess(''); }, 3000);
        } catch (err) {
            Alert.alert('Mark Failed', err?.message || 'Could not mark student present.', [{ text: 'OK' }]);
        } finally {
            markingStudentIdsRef.current.delete(student.studentId);
            setMarkingStudentIds(new Set(markingStudentIdsRef.current));
        }
    }, [selectedUnit, selectedRoom, sessionStart]);

    if (isLoading) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={colors.primary.main} />
                <Text style={styles.loadingText}>Loading attendance configuration...</Text>
            </View>
        );
    }

    return (
        <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
            <StatusBar barStyle="light-content" backgroundColor={colors.background.primary} />
            
            {/* Help Modal */}
            <Modal
                visible={showHelp}
                transparent
                animationType="fade"
                onRequestClose={() => setShowHelp(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={styles.helpModalContent}>
                        <LinearGradient
                            colors={colors.primary.gradient}
                            style={styles.helpHeader}
                        >
                            <Icon name="information-circle" size={48} color="#FFFFFF" />
                            <Text style={styles.helpTitle}>About BLE Attendance</Text>
                        </LinearGradient>
                        <ScrollView style={styles.helpBody}>
                            <Text style={styles.helpText}>
                                The system broadcasts attendance signals via Bluetooth Low Energy (BLE).
                            </Text>
                            <View style={styles.helpItem}>
                                <Icon name="cube-outline" size={20} color={colors.primary.main} />
                                <Text style={styles.helpItemText}>
                                    Units use IDs 0x01-0x7F (1-127)
                                </Text>
                            </View>
                            <View style={styles.helpItem}>
                                <Icon name="business-outline" size={20} color={colors.success.main} />
                                <Text style={styles.helpItemText}>
                                    Rooms use IDs 0x80-0xFF (128-255)
                                </Text>
                            </View>
                            <View style={styles.helpItem}>
                                <Icon name="sync-outline" size={20} color={colors.warning.main} />
                                <Text style={styles.helpItemText}>
                                    IDs are synced from the server automatically
                                </Text>
                            </View>
                            <Text style={styles.helpNote}>
                                Make sure Bluetooth is ON and you've selected a unit and room.
                            </Text>
                            <TouchableOpacity
                                style={styles.helpButton}
                                onPress={() => setShowHelp(false)}
                            >
                                <Text style={styles.helpButtonText}>Got it</Text>
                            </TouchableOpacity>
                        </ScrollView>
                    </View>
                </View>
            </Modal>

            {/* Sync Status Bar */}
            <View style={styles.syncBar}>
                <Icon
                    name={syncStatus.includes('complete') ? 'checkmark-circle' : 'sync-outline'}
                    size={16}
                    color={syncStatus.includes('complete') ? colors.success.main : colors.text.secondary}
                />
                <Text style={styles.syncText}>
                    {syncStatus || `Last sync: ${lastSync ? new Date(lastSync).toLocaleTimeString() : 'Never'}`}
                </Text>
                {stats && (
                    <Text style={styles.statsText}>
                        {stats.unitCount}U/{stats.roomCount}R
                    </Text>
                )}
                <TouchableOpacity onPress={handleRefresh} disabled={isRefreshing}>
                    <Icon 
                        name="refresh" 
                        size={18} 
                        color={isRefreshing ? colors.text.tertiary : colors.primary.main} 
                    />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setShowHelp(true)} style={styles.helpIcon}>
                    <Icon name="help-circle-outline" size={18} color={colors.text.secondary} />
                </TouchableOpacity>
                <TouchableOpacity onPress={handleDebug} style={styles.debugIcon}>
                    <Icon name="bug-outline" size={18} color={colors.warning.main} />
                </TouchableOpacity>
            </View>

            {error && (
                <View style={styles.errorBanner}>
                    <Icon name="alert-circle" size={16} color={colors.danger.main} />
                    <Text style={styles.errorText}>{error}</Text>
                </View>
            )}

            {/* Mapping Status Warning */}
            {selectedUnit && selectedRoom && !mappingsReady && !isLoading && (
                <View style={styles.warningBanner}>
                    <Icon name="warning-outline" size={16} color={colors.warning.main} />
                    <Text style={styles.warningText}>
                        Waiting for mappings to load... Please wait or tap refresh.
                    </Text>
                </View>
            )}

            <ScrollView 
                style={styles.scrollView}
                contentContainerStyle={styles.container}
                showsVerticalScrollIndicator={false}
            >
                <View style={styles.header}>
                    <Text style={styles.title}>Attendance QR Generator</Text>
                    <Text style={styles.subtitle}>
                        Select unit and room to generate attendance code
                    </Text>
                    {sessionActive && (
                        <View style={styles.timerContainer}>
                            <Icon name="time-outline" size={20} color="#FFD460" />
                            <Text style={styles.timerText}>
                                Session ends in {formatRemaining(sessionRemainingMs)}
                            </Text>
                        </View>
                    )}
                </View>

                <View style={styles.selectorsContainer}>
                    {/* Unit Selector */}
                    <TouchableOpacity
                        style={styles.selectorButton}
                        onPress={() => {
                            setUnitSearchQuery('');
                            setShowUnitPicker(true);
                        }}
                    >
                        <View style={styles.selectorContent}>
                            <Text style={styles.selectorLabel}>Unit</Text>
                            <Text style={[styles.selectorValue, !selectedUnit && styles.placeholder]}>
                                {selectedUnit 
                                    ? `${getUnitDisplayName(selectedUnit.code)} (${selectedUnit.code})`
                                    : 'Select a unit'}
                            </Text>
                        </View>
                        <Icon name="chevron-down" size={20} color={colors.text.secondary} />
                    </TouchableOpacity>

                    {/* Room Selector */}
                    <TouchableOpacity
                        style={styles.selectorButton}
                        onPress={() => {
                            setRoomSearchQuery('');
                            setShowRoomPicker(true);
                        }}
                    >
                        <View style={styles.selectorContent}>
                            <Text style={styles.selectorLabel}>Lecture Room</Text>
                            <Text style={[styles.selectorValue, !selectedRoom && styles.placeholder]}>
                                {selectedRoom 
                                    ? `${selectedRoom.display} (${selectedRoom.roomCode})`
                                    : 'Select a room'}
                            </Text>
                            {selectedRoom && (
                                <Text style={styles.selectorSubtext}>
                                    {selectedRoom.building} • Floor {selectedRoom.floor}
                                </Text>
                            )}
                        </View>
                        <Icon name="chevron-down" size={20} color={colors.text.secondary} />
                    </TouchableOpacity>
                </View>

                {/* QR Code Card */}
                <GlassCard style={styles.qrCard} innerStyle={styles.qrCardInner}>
                    {qrData ? (
                        <>
                            <View style={styles.qrWrapper}>
                                <QRCodeGenerator value={qrData} size={260} />
                            </View>

                            {/* QR rotation countdown — tells students when to scan again */}
                            <View style={styles.qrRefreshRow}>
                                <Icon name="sync-outline" size={13} color={colors.text.secondary} />
                                <Text style={styles.qrRefreshText}>
                                    QR refreshes in {qrRefreshSec}s — students scan twice
                                </Text>
                            </View>

                            {!!manualToken && (
                                <View style={styles.manualTokenContainer}>
                                    <Text style={styles.manualTokenLabel}>Manual fallback PIN</Text>
                                    <Text style={styles.manualTokenValue}>{manualToken}</Text>
                                    <Text style={styles.manualTokenExpiry}>
                                        Expires in {manualTokenRemainingSec}s
                                    </Text>
                                    <Text style={styles.manualTokenRaw}>
                                        {selectedUnit?.code} @ {selectedRoom?.roomCode}
                                    </Text>
                                </View>
                            )}
                        </>
                    ) : (
                        <View style={styles.placeholderContainer}>
                            <Icon name="qr-code-outline" size={64} color={colors.text.tertiary} />
                            <Text style={styles.placeholderText}>Select unit and room</Text>
                            <Text style={styles.placeholderSubtext}>to generate QR code</Text>
                        </View>
                    )}
                </GlassCard>

                {/* BLE Status */}
                <GlassCard>
                    <View style={styles.bleHeader}>
                        <Icon 
                            name="bluetooth" 
                            size={24} 
                            color={isBluetoothOn ? colors.primary.main : colors.text.secondary} 
                        />
                        <Text style={styles.bleTitle}>Bluetooth Broadcast (Ultra-Fast)</Text>
                    </View>

                    <View style={styles.bleStatus}>
                        <Text style={styles.bleStatusLabel}>Status:</Text>
                        <Text style={[
                            styles.bleStatusValue,
                            { color: isBluetoothOn ? colors.success.main : colors.danger.main }
                        ]}>
                            {isBluetoothOn ? 'ON' : 'OFF'}
                        </Text>
                    </View>

                    {bleError ? (
                        <StatusChip
                            type="error"
                            message={bleError}
                            icon="alert-circle"
                        />
                    ) : !isBluetoothOn ? (
                        <StatusChip
                            type="warning"
                            message="Turn on Bluetooth to broadcast"
                            icon="information-circle"
                        />
                    ) : !isAdvertisingSupported ? (
                        <StatusChip
                            type="error"
                            message="BLE Advertising not supported"
                            icon="close-circle"
                        />
                    ) : isAdvertising && sessionActive ? (
                        <StatusChip
                            type="success"
                            message={`Broadcasting Session #${sessionCounter} (instant)`}
                            icon="checkmark-circle"
                        />
                    ) : bleStatus ? (
                        <StatusChip
                            type="info"
                            message={bleStatus}
                            icon="information-circle"
                        />
                    ) : null}

                    {!isBluetoothOn && (
                        <TouchableOpacity 
                            style={styles.enableBluetoothButton}
                            onPress={() => {
                                Alert.alert(
                                    'Enable Bluetooth',
                                    'Please enable Bluetooth in your system settings to broadcast attendance signals.',
                                    [
                                        { text: 'Cancel', style: 'cancel' },
                                        { text: 'Open Settings', onPress: () => NativeModules.BluetoothManager?.openSettings() }
                                    ]
                                );
                            }}
                        >
                            <Text style={styles.enableBluetoothText}>Enable Bluetooth</Text>
                        </TouchableOpacity>
                    )}
                </GlassCard>

                {/* Manual Mark Card — for students without smartphones */}
                {sessionActive && selectedUnit && selectedRoom && (
                    <GlassCard>
                        <View style={styles.manualMarkHeader}>
                            <Icon name="person-add-outline" size={24} color={colors.warning.main} />
                            <View style={styles.manualMarkHeaderText}>
                                <Text style={styles.manualMarkTitle}>Manual Mark</Text>
                                <Text style={styles.manualMarkSubtitle}>For students without smartphones</Text>
                            </View>
                        </View>

                        {/* Roster Status Indicator */}
                        <View style={styles.rosterStatus}>
                            {rosterLoading ? (
                                <View style={styles.rosterStatusLoading}>
                                    <ActivityIndicator size="small" color={colors.warning.main} />
                                    <Text style={styles.rosterStatusText}>Loading student roster...</Text>
                                </View>
                            ) : rosterError && rosterStudentCount === 0 ? (
                                <View style={styles.rosterStatusError}>
                                    <Icon name="alert-circle" size={16} color={colors.danger.main} />
                                    <Text style={[styles.rosterStatusText, { color: colors.danger.main, flex: 1 }]}>
                                        {rosterError.length > 60 ? rosterError.substring(0, 60) + '...' : rosterError}
                                    </Text>
                                    <TouchableOpacity 
                                        onPress={async () => {
                                            rosterFetchAttemptedRef.current = false;
                                            setRosterLoading(true);
                                            try {
                                                const session = await getLecturerSession();
                                                if (session?.token && session?.institutionId) {
                                                    await fetchAndCacheUnitRoster(
                                                        selectedUnit.code, 
                                                        session.institutionId, 
                                                        session.token
                                                    );
                                                }
                                            } finally {
                                                setRosterLoading(false);
                                            }
                                        }}
                                        style={{ marginLeft: 8 }}
                                    >
                                        <Icon name="refresh" size={16} color={colors.primary.main} />
                                    </TouchableOpacity>
                                </View>
                            ) : rosterStudentCount > 0 ? (
                                <View style={styles.rosterStatusSuccess}>
                                    <Icon name="people" size={14} color={colors.success.main} />
                                    <Text style={[styles.rosterStatusText, { color: colors.success.main }]}>
                                        {rosterStudentCount} student{rosterStudentCount !== 1 ? 's' : ''} enrolled
                                    </Text>
                                </View>
                            ) : null}
                        </View>

                        {!!manualMarkSuccess && (
                            <View style={styles.manualMarkSuccessRow}>
                                <Icon name="checkmark-circle" size={20} color={colors.success.main} />
                                <Text style={styles.manualMarkSuccessText}>{manualMarkSuccess}</Text>
                            </View>
                        )}

                        <TouchableOpacity
                            style={styles.manualMarkOpenButton}
                            onPress={() => setShowManualModal(true)}
                        >
                            <LinearGradient
                                colors={[colors.warning.dark, colors.warning.main]}
                                style={styles.manualMarkGradient}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 1, y: 0 }}
                            >
                                <Icon name="people-outline" size={20} color="#FFFFFF" />
                                <Text style={styles.manualMarkOpenText}>Mark Students Present</Text>
                            </LinearGradient>
                        </TouchableOpacity>
                    </GlassCard>
                )}

                {/* Session ended - Return to selection */}
                {!sessionActive && selectedUnit && selectedRoom && (
                    <View style={styles.sessionEndedContainer}>
                        <Icon name="time-outline" size={24} color={colors.warning.main} />
                        <Text style={styles.sessionEndedText}>Session ended</Text>
                        <TouchableOpacity 
                            style={styles.newSessionButton}
                            onPress={() => {
                                setSelectedUnit(null);
                                setSelectedRoom(null);
                                setQrData('');
                                setManualToken('');
                                setSessionStart(null);
                                setSessionCounter(prev => (prev % 255) + 1);
                                unitIdRef.current = null;
                                roomIdRef.current = null;
                                sessionStartSetRef.current = false;
                            }}
                        >
                            <LinearGradient
                                colors={colors.primary.gradient}
                                style={styles.newSessionGradient}
                            >
                                <Icon name="add-circle-outline" size={20} color="#FFFFFF" />
                                <Text style={styles.newSessionText}>Start New Session</Text>
                            </LinearGradient>
                        </TouchableOpacity>
                    </View>
                )}
            </ScrollView>

            {/* Manual Mark Modal — Roster List */}
            <Modal
                visible={showManualModal}
                transparent
                animationType="slide"
                onRequestClose={() => setShowManualModal(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={[styles.manualMarkModal, { maxHeight: '92%' }]}>
                        {/* Header */}
                        <View style={styles.modalHeader}>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.modalTitle}>Mark Students Present</Text>
                                <Text style={styles.rosterModalSubtitle}>
                                    {selectedUnit?.code} • {markedStudentIds.size} marked
                                </Text>
                            </View>
                            <TouchableOpacity onPress={() => setShowManualModal(false)} style={styles.closeButton}>
                                <Icon name="close" size={24} color="#666" />
                            </TouchableOpacity>
                        </View>

                        {/* Search */}
                        <View style={styles.rosterSearchRow}>
                            <Icon name="search" size={18} color="#8A8A95" />
                            <TextInput
                                style={styles.rosterSearchInput}
                                value={rosterFilterQuery}
                                onChangeText={setRosterFilterQuery}
                                placeholder="Search by Name or Admission No..."
                                placeholderTextColor="#8A8A95"
                                autoCapitalize="none"
                                autoCorrect={false}
                                clearButtonMode="while-editing"
                            />
                            {!!rosterFilterQuery && (
                                <TouchableOpacity onPress={() => setRosterFilterQuery('')}>
                                    <Icon name="close-circle" size={18} color="#8A8A95" />
                                </TouchableOpacity>
                            )}
                        </View>

                        {rosterListLoading ? (
                            <View style={styles.rosterLoadingState}>
                                <ActivityIndicator size="large" color={colors.primary.main} />
                                <Text style={styles.rosterLoadingText}>Loading roster...</Text>
                            </View>
                        ) : filteredRosterStudents.length === 0 ? (
                            <View style={styles.rosterEmptyState}>
                                <Icon name="people-outline" size={48} color="#CCC" />
                                <Text style={styles.rosterEmptyText}>
                                    {rosterStudentList.length === 0
                                        ? 'No students cached for this unit.\nClose this, refresh the roster above, then try again.'
                                        : 'No students match your search.'}
                                </Text>
                            </View>
                        ) : (
                            <FlatList
                                data={filteredRosterStudents}
                                keyExtractor={s => s.studentId}
                                keyboardShouldPersistTaps="handled"
                                contentContainerStyle={{ paddingBottom: 8 }}
                                renderItem={({ item }) => {
                                    const isMarked = markedStudentIds.has(item.studentId);
                                    const isMarking = markingStudentIds.has(item.studentId);
                                    return (
                                        <View style={[styles.rosterRow, isMarked && styles.rosterRowMarked]}>
                                            <View style={styles.rosterStudentInfo}>
                                                <Text style={styles.rosterStudentName} numberOfLines={1}>
                                                    {item.studentName}
                                                </Text>
                                                <Text style={styles.rosterAdmNum}>{item.admissionNumber}</Text>
                                            </View>
                                            <TouchableOpacity
                                                style={[
                                                    styles.rosterMarkBtn,
                                                    isMarked && styles.rosterMarkBtnMarked,
                                                    isMarking && { opacity: 0.6 },
                                                ]}
                                                onPress={() => handleManualMarkStudent(item)}
                                                disabled={isMarked || isMarking}
                                                activeOpacity={0.7}
                                            >
                                                {isMarking
                                                    ? <ActivityIndicator size="small" color="#FFF" />
                                                    : <Icon
                                                        name={isMarked ? 'checkmark-circle' : 'add-circle-outline'}
                                                        size={16}
                                                        color="#FFF"
                                                      />
                                                }
                                                <Text style={styles.rosterMarkBtnText}>
                                                    {isMarked ? 'Marked' : 'Mark'}
                                                </Text>
                                            </TouchableOpacity>
                                        </View>
                                    );
                                }}
                            />
                        )}

                        <TouchableOpacity
                            style={styles.rosterDoneButton}
                            onPress={() => setShowManualModal(false)}
                        >
                            <Text style={styles.rosterDoneText}>Done</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>

            {/* Unit Picker Modal */}
            <PickerModal
                visible={showUnitPicker}
                onClose={() => setShowUnitPicker(false)}
                title="Select Unit"
                items={filteredUnits}
                onSelect={handleUnitSelect}
                selectedItem={selectedUnit}
                searchQuery={unitSearchQuery}
                onSearchChange={setUnitSearchQuery}
                searchPlaceholder="Search units..."
            />

            {/* Room Picker Modal */}
            <PickerModal
                visible={showRoomPicker}
                onClose={() => setShowRoomPicker(false)}
                title="Select Room"
                items={filteredRooms}
                onSelect={setSelectedRoom}
                selectedItem={selectedRoom}
                searchQuery={roomSearchQuery}
                onSearchChange={setRoomSearchQuery}
                searchPlaceholder="Search rooms..."
            />
        </SafeAreaView>
    );
};

// Styles
const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
        backgroundColor: colors.background.primary,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: colors.background.primary,
    },
    loadingText: {
        marginTop: 16,
        fontSize: 16,
        color: colors.text.secondary,
    },
    syncBar: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.background.secondary,
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: colors.border.light,
    },
    syncText: {
        color: colors.text.secondary,
        fontSize: 12,
        flex: 1,
        marginLeft: 8,
    },
    statsText: {
        color: colors.primary.main,
        fontSize: 11,
        fontWeight: '600',
        marginRight: 8,
        backgroundColor: colors.primary.soft,
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 10,
    },
    helpIcon: {
        marginLeft: 12,
    },
    debugIcon: {
        marginLeft: 12,
    },
    errorBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(239, 68, 68, 0.1)',
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: colors.danger.main,
    },
    errorText: {
        color: colors.danger.main,
        fontSize: 12,
        marginLeft: 8,
        flex: 1,
    },
    warningBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(245, 158, 11, 0.1)',
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: colors.warning.main,
    },
    warningText: {
        color: colors.warning.main,
        fontSize: 12,
        marginLeft: 8,
        flex: 1,
    },
    scrollView: {
        flex: 1,
    },
    container: {
        padding: 20,
        paddingBottom: 40,
    },
    header: {
        alignItems: 'center',
        marginBottom: 24,
    },
    title: {
        fontSize: 28,
        fontWeight: '700',
        color: colors.text.primary,
        marginBottom: 8,
        textAlign: 'center',
    },
    subtitle: {
        fontSize: 15,
        color: colors.text.secondary,
        textAlign: 'center',
    },
    timerContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 16,
        backgroundColor: 'rgba(255, 212, 96, 0.15)',
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 20,
    },
    timerText: {
        fontSize: 14,
        color: '#FFD460',
        fontWeight: '600',
        marginLeft: 8,
    },
    selectorsContainer: {
        marginBottom: 20,
    },
    selectorButton: {
        backgroundColor: colors.background.secondary,
        borderRadius: 16,
        padding: 16,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: colors.border.light,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    selectorContent: {
        flex: 1,
    },
    selectorLabel: {
        fontSize: 12,
        color: colors.text.tertiary,
        marginBottom: 4,
        fontWeight: '600',
        textTransform: 'uppercase',
    },
    selectorValue: {
        fontSize: 16,
        color: colors.text.primary,
        fontWeight: '600',
    },
    selectorSubtext: {
        fontSize: 12,
        color: colors.text.tertiary,
        marginTop: 2,
    },
    placeholder: {
        color: colors.text.tertiary,
        fontWeight: '400',
    },
    glassCard: {
        backgroundColor: 'rgba(30, 30, 45, 0.8)',
        borderRadius: 20,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: colors.border.light,
        overflow: 'hidden',
    },
    glassCardInner: {
        padding: 20,
    },
    qrCard: {},
    qrCardInner: {
        alignItems: 'center',
    },
    qrWrapper: {
        backgroundColor: '#FFFFFF',
        padding: 16,
        borderRadius: 16,
        marginBottom: 16,
        alignItems: 'center',
    },
    manualTokenContainer: {
        marginTop: 16,
        paddingTop: 16,
        borderTopWidth: 1,
        borderTopColor: colors.border.light,
        width: '100%',
        alignItems: 'center',
    },
    manualTokenLabel: {
        fontSize: 12,
        color: colors.text.tertiary,
        fontWeight: '600',
        textTransform: 'uppercase',
        marginBottom: 4,
        textAlign: 'center',
    },
    manualTokenValue: {
        fontSize: 24,
        color: colors.text.primary,
        fontWeight: '800',
        letterSpacing: 2,
        marginBottom: 2,
        textAlign: 'center',
    },
    manualTokenExpiry: {
        fontSize: 11,
        color: colors.warning.main,
        fontWeight: '600',
        textAlign: 'center',
    },
    manualTokenRaw: {
        fontSize: 10,
        color: colors.text.tertiary,
        marginTop: 4,
        fontFamily: 'monospace',
        textAlign: 'center',
    },
    placeholderContainer: {
        alignItems: 'center',
        paddingVertical: 40,
    },
    placeholderText: {
        fontSize: 18,
        color: colors.text.tertiary,
        marginTop: 16,
    },
    placeholderSubtext: {
        fontSize: 14,
        color: colors.text.tertiary,
        marginTop: 4,
    },
    bleHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 16,
    },
    bleTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.text.primary,
        marginLeft: 12,
    },
    bleStatus: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12,
    },
    bleStatusLabel: {
        fontSize: 14,
        color: colors.text.secondary,
        marginRight: 8,
    },
    bleStatusValue: {
        fontSize: 14,
        fontWeight: '600',
    },
    statusChip: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 20,
        borderWidth: 1,
        marginTop: 8,
    },
    statusChipText: {
        fontSize: 12,
        fontWeight: '600',
        marginLeft: 6,
    },
    enableBluetoothButton: {
        backgroundColor: colors.primary.main,
        borderRadius: 12,
        paddingVertical: 12,
        alignItems: 'center',
        marginTop: 16,
    },
    enableBluetoothText: {
        color: '#FFFFFF',
        fontSize: 14,
        fontWeight: '600',
    },
    sessionEndedContainer: {
        alignItems: 'center',
        marginTop: 8,
    },
    sessionEndedText: {
        fontSize: 16,
        color: colors.warning.main,
        marginVertical: 12,
    },
    newSessionButton: {
        width: '100%',
    },
    newSessionGradient: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 16,
        borderRadius: 12,
    },
    newSessionText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '600',
        marginLeft: 8,
    },
    // Modal Styles
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        justifyContent: 'flex-end',
    },
    modalBackdrop: {
        ...StyleSheet.absoluteFill,
    },
    modalContainer: {
        backgroundColor: '#FFFFFF',
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
        borderBottomColor: '#E0E0E0',
    },
    modalTitle: {
        fontSize: 20,
        fontWeight: '700',
        color: '#1A1A1A',
    },
    closeButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: '#F0F0F0',
        justifyContent: 'center',
        alignItems: 'center',
    },
    searchContainer: {
        paddingHorizontal: 20,
        paddingTop: 12,
        paddingBottom: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#EAEAEA',
    },
    searchInputRow: {
        backgroundColor: '#F6F6F8',
        borderWidth: 1,
        borderColor: '#E0E0E6',
        borderRadius: 12,
        paddingHorizontal: 12,
        flexDirection: 'row',
        alignItems: 'center',
    },
    searchInput: {
        flex: 1,
        paddingVertical: 12,
        paddingHorizontal: 8,
        fontSize: 15,
        color: '#1A1A1A',
    },
    modalContent: {
        maxHeight: 500,
    },
    emptyStateContainer: {
        paddingVertical: 48,
        alignItems: 'center',
    },
    emptyStateText: {
        fontSize: 15,
        color: '#666',
        marginTop: 8,
    },
    pickerItem: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#F0F0F0',
    },
    pickerItemSelected: {
        backgroundColor: '#F0F7FF',
    },
    pickerItemContent: {
        flex: 1,
    },
    pickerItemText: {
        fontSize: 16,
        color: '#1A1A1A',
        fontWeight: '500',
        marginBottom: 2,
    },
    pickerItemTextSelected: {
        color: colors.primary.main,
    },
    pickerItemSubtext: {
        fontSize: 13,
        color: '#666',
        marginTop: 2,
    },
    // Help Modal Styles
    helpModalContent: {
        backgroundColor: '#FFFFFF',
        borderRadius: 24,
        marginHorizontal: 20,
        overflow: 'hidden',
        maxHeight: '80%',
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
        color: '#666',
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
        color: '#1A1A1A',
        marginLeft: 12,
        flex: 1,
    },
    helpNote: {
        fontSize: 13,
        color: '#666',
        fontStyle: 'italic',
        marginTop: 16,
        marginBottom: 20,
    },
    helpButton: {
        backgroundColor: colors.primary.main,
        borderRadius: 12,
        paddingVertical: 14,
        alignItems: 'center',
    },
    helpButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '600',
    },
    // Manual Mark Styles
    manualMarkHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 14,
    },
    manualMarkHeaderText: {
        marginLeft: 12,
        flex: 1,
    },
    manualMarkTitle: {
        fontSize: 16,
        fontWeight: '700',
        color: colors.text.primary,
    },
    manualMarkSubtitle: {
        fontSize: 12,
        color: colors.text.secondary,
        marginTop: 2,
    },
    manualMarkSuccessRow: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.success.soft,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 8,
        marginBottom: 12,
    },
    manualMarkSuccessText: {
        color: colors.success.main,
        fontSize: 14,
        fontWeight: '600',
        marginLeft: 8,
    },
    manualMarkOpenButton: {
        borderRadius: 12,
        overflow: 'hidden',
    },
    manualMarkGradient: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 14,
        paddingHorizontal: 16,
    },
    manualMarkOpenText: {
        color: '#FFFFFF',
        fontSize: 15,
        fontWeight: '600',
        marginLeft: 8,
    },
    manualMarkModal: {
        backgroundColor: '#FFFFFF',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        maxHeight: '80%',
    },
    // Roster Status Styles
    rosterStatus: {
        marginBottom: 12,
        padding: 8,
        borderRadius: 8,
    },
    rosterStatusLoading: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    rosterStatusError: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
    },
    rosterStatusSuccess: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    rosterStatusText: {
        fontSize: 12,
        fontWeight: '500',
    },
    // Roster modal
    rosterModalSubtitle: {
        fontSize: 12,
        color: '#8A8A95',
        marginTop: 2,
    },
    rosterSearchRow: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F4F4F8',
        borderRadius: 10,
        marginHorizontal: 16,
        marginBottom: 4,
        paddingHorizontal: 12,
        paddingVertical: 8,
        gap: 8,
    },
    rosterSearchInput: {
        flex: 1,
        fontSize: 14,
        color: '#1A1A2E',
        paddingVertical: 2,
    },
    rosterLoadingState: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 48,
        gap: 12,
    },
    rosterLoadingText: {
        fontSize: 14,
        color: '#8A8A95',
    },
    rosterEmptyState: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 48,
        paddingHorizontal: 32,
        gap: 12,
    },
    rosterEmptyText: {
        fontSize: 14,
        color: '#999',
        textAlign: 'center',
        lineHeight: 22,
    },
    rosterRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#F0F0F5',
    },
    rosterRowMarked: {
        backgroundColor: 'rgba(16, 185, 129, 0.07)',
    },
    rosterStudentInfo: {
        flex: 1,
        marginRight: 12,
    },
    rosterStudentName: {
        fontSize: 15,
        fontWeight: '600',
        color: '#1A1A2E',
        marginBottom: 2,
    },
    rosterAdmNum: {
        fontSize: 12,
        color: '#8A8A95',
        letterSpacing: 0.5,
    },
    rosterMarkBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        backgroundColor: colors.success.main,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 8,
        minWidth: 82,
        justifyContent: 'center',
    },
    rosterMarkBtnMarked: {
        backgroundColor: colors.text.tertiary,
    },
    rosterMarkBtnText: {
        color: '#FFF',
        fontSize: 13,
        fontWeight: '600',
    },
    rosterDoneButton: {
        margin: 16,
        paddingVertical: 14,
        borderRadius: 12,
        backgroundColor: colors.primary.main,
        alignItems: 'center',
    },
    rosterDoneText: {
        color: '#FFF',
        fontSize: 16,
        fontWeight: '700',
    },
    qrRefreshRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        marginTop: 4,
        marginBottom: 8,
    },
    qrRefreshText: {
        fontSize: 12,
        color: colors.text.secondary,
    },
});

export default OfflineTaker;