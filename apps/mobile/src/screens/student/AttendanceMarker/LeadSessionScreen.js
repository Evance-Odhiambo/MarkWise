// src/screens/student/AttendanceMarker/LeadSessionScreen.js
// Group leader's BLE session host screen for delegated Group Discussion attendance.
// Activated only when the lecturer pushes a delegation to this student.

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator,
  ScrollView, NativeModules, AppState,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Buffer } from 'buffer';
import { useNavigation, useRoute } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Ionicons';
import sqliteStorage from '../../../storage/sqliteStorage';
import { startDelegatedSession, endDelegatedSession, submitLeaderProxyMark } from '../../../utils/delegationApi';
import { submitOfflineAttendance } from '../../../utils/offlineAttendanceApi';
import { getStudentSession } from '../../../utils/authSession';
import { getGroupMembers } from '../../../utils/groupsApi';
import { adaptiveConfig } from '../../../utils/adaptiveAttendanceConfig';
import { QR_ROTATION_MS, MANUAL_TOKEN_ROTATION_MS, GD_SESSION_DURATION_MS } from '../../../utils/constants';
import QRCodeGenerator from '../../../components/QRCodeGenerator';
import { useColors } from '../../../theme';

if (typeof global.Buffer === 'undefined') { global.Buffer = Buffer; }

const { BLEAdvertiserModule } = NativeModules;
const SERVICE_UUID = '00001101-0000-1000-8000-00805F9B34FB';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const formatCountdown = (ms) => {
  if (ms <= 0) return '00:00';
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60).toString().padStart(2, '0');
  const sec = (totalSec % 60).toString().padStart(2, '0');
  return `${min}:${sec}`;
};


const buildPayload = (unitId, roomId, sessionStartSec, groupId, counter) => {
  // 10-byte packet identical to OfflineTaker format:
  // [unitId Hi][unitId Lo][roomId Hi][roomId Lo][ts B3][ts B2][ts B1][ts B0][groupId][counter]
  const buf = new Uint8Array(10);
  buf[0] = (unitId >> 8) & 0xFF;
  buf[1] = unitId & 0xFF;
  buf[2] = (roomId >> 8) & 0xFF;
  buf[3] = roomId & 0xFF;
  buf[4] = (sessionStartSec >> 24) & 0xFF;
  buf[5] = (sessionStartSec >> 16) & 0xFF;
  buf[6] = (sessionStartSec >> 8) & 0xFF;
  buf[7] = sessionStartSec & 0xFF;
  buf[8] = groupId & 0xFF;
  buf[9] = counter & 0xFF;
  return Buffer.from(buf).toString('base64');
};

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function LeadSessionScreen() {
  const navigation = useNavigation();
  const route = useRoute();

  const colors = useColors();
  const C = useMemo(() => ({
    primary:     colors.primary.main,
    success:     colors.success.main,
    danger:      colors.danger.main,
    warning:     colors.warning.main,
    textSecAlt:  colors.text.secondary,
    bgLight:     colors.background.primary,
    bgLightSec:  colors.background.secondary,
    textDark:    colors.text.primary,
    textDarkTer: colors.text.secondary,
    textMid:     colors.text.tertiary,
    borderLt:    colors.border.light,
  }), [colors]);
  const styles = useMemo(() => makeStyles(C), [C]);

  // The delegation object is passed as a route param (or loaded from SQLite on mount)
  const [delegation, setDelegation] = useState(route.params?.delegation ?? null);
  const [loadingDelegation, setLoadingDelegation] = useState(!route.params?.delegation);

  const [phase, setPhase] = useState('idle'); // idle | starting | active | ending | done
  const [sessionToken, setSessionToken] = useState(null);
  const [sessionStartMs, setSessionStartMs] = useState(null);
  const [, setElapsedMs] = useState(0);
  const [countdownMs, setCountdownMs] = useState(null);
  const [, setCounter] = useState(0);
  const [bleError, setBleError] = useState('');
  const [isAdvertising, setIsAdvertising] = useState(false);
  const [qrData, setQrData] = useState('');
  const [manualToken, setManualToken] = useState('');
  const [manualTokenRemainingSec, setManualTokenRemainingSec] = useState(
    Math.ceil(MANUAL_TOKEN_ROTATION_MS / 1000),
  );

  // ── Proxy-mark state ─────────────────────────────────────────────────────────
  const [groupMembers, setGroupMembers] = useState([]);        // [{ studentId, admissionNumber, name, isLeader }]
  const [proxyMarked, setProxyMarked] = useState(new Set());   // studentIds successfully proxy-marked this session
  const [markingMemberId, setMarkingMemberId] = useState(null); // studentId currently being submitted
  const [myStudentId, setMyStudentId] = useState(null);        // current leader's own studentId

  const doEndRef = useRef(null); // always points to latest doEnd — eliminates stale-closure in useEffect + Alert
  const advertisingRef = useRef(false);
  const counterRef = useRef(0);
  const advertTimerRef = useRef(null);
  const qrTimerRef = useRef(null);
  // Resolved BLE IDs — set when phase becomes 'active'. These are the actual
  // BLE-range IDs (units 0-7999, rooms 8000-9999) resolved from the code strings
  // via adaptiveConfig so that even if the delegation row has unitId/roomId=0
  // (DB FK from an older delegation), we always broadcast the correct values.
  const resolvedBleIdsRef = useRef({ unitId: 0, roomId: 0 });
  const elapsedTimerRef = useRef(null);
  const countdownTimerRef = useRef(null);
  const sessionStartMsRef = useRef(null);
  const appStateRef = useRef(AppState.currentState);

  // ── Generate QR data + refresh manual token ──────────────────────────────────
  const generateQrData = useCallback(() => {
    // GD leader QR/PIN generation disabled: student devices do not hold the session key
    // required to produce HMAC-signed tokens. GD attendance is relayed via BLE only.
    setQrData('');
    setManualToken('');
  }, []);

  // ── Load delegation from SQLite; fall back to backend API if SQLite is empty ─
  useEffect(() => {
    if (delegation) { setLoadingDelegation(false); return; }
    let isMounted = true;
    (async () => {
      try {
        // First check SQLite (instant)
        let active = await sqliteStorage.getActiveDelegations().catch(() => []);
        console.log('[LeadSessionScreen] SQLite active delegations:', active.length);
        if (!active.length) {
          // Not in SQLite yet — fetch from backend
          const { fetchMyDelegations } = require('../../../utils/delegationApi');
          const remote = await fetchMyDelegations().catch(() => []);
          console.log('[LeadSessionScreen] API returned', remote.length, 'delegation(s)');
          if (Array.isArray(remote) && remote.length > 0) {
            // Persist to SQLite as a background cache — do NOT block display on it.
            // If the save fails (e.g. schema mismatch), the API data is used directly.
            sqliteStorage.saveDelegations(remote).catch((e) =>
              console.warn('[LeadSessionScreen] SQLite cache write failed:', e?.message),
            );
            // Use the API response directly; avoids a second SQLite round-trip that can
            // return [] if the save failed or the migration hasn't run yet.
            active = remote;
          }
        }
        if (isMounted) {
          setDelegation(active[0] ?? null);
          if (!active.length) {
            console.warn('[LeadSessionScreen] No active delegation found for this student. Check that leaderStudentId in the delegation matches the student JWT identity.');
          }
          setLoadingDelegation(false);
        }
      } catch (_) {
        if (isMounted) setLoadingDelegation(false);
      }
    })();
    return () => { isMounted = false; };
  }, []);

  // ── Countdown timer: ticks down from GD_SESSION_DURATION_MS to 0 ──────────────
  useEffect(() => {
    if (phase !== 'active') return;
    const update = () => {
      if (sessionStartMsRef.current) {
        const elapsed = Date.now() - sessionStartMsRef.current;
        setCountdownMs(Math.max(0, GD_SESSION_DURATION_MS - elapsed));
      }
    };
    update();
    countdownTimerRef.current = setInterval(update, 1000);
    return () => clearInterval(countdownTimerRef.current);
  }, [phase]);

  // ── Elapsed timer while session is active ────────────────────────────────────
  useEffect(() => {
    if (phase !== 'active') return;
    elapsedTimerRef.current = setInterval(() => {
      if (sessionStartMsRef.current) {
        setElapsedMs(Date.now() - sessionStartMsRef.current);
      }
    }, 1000);
    return () => clearInterval(elapsedTimerRef.current);
  }, [phase]);

  // ── Auto-end: stop session automatically when the GD window expires ──────────
  useEffect(() => {
    if (phase !== 'active') return;
    const elapsed = sessionStartMsRef.current ? Date.now() - sessionStartMsRef.current : 0;
    const remaining = Math.max(0, GD_SESSION_DURATION_MS - elapsed);
    const timer = setTimeout(() => doEndRef.current?.(), remaining);
    return () => clearTimeout(timer);
  }, [phase]);

  // ── QR rotation (aligned to epoch boundaries, same as OfflineTaker) ──────────
  useEffect(() => {
    if (phase !== 'active' || !sessionStartMs) return;
    generateQrData();
    const scheduleNext = () => {
      const now = Date.now();
      const timeUntilNext = QR_ROTATION_MS - (now % QR_ROTATION_MS);
      qrTimerRef.current = setTimeout(() => { generateQrData(); scheduleNext(); }, timeUntilNext);
    };
    scheduleNext();
    return () => clearTimeout(qrTimerRef.current);
  }, [phase, sessionStartMs, generateQrData]);

  // ── Manual-token countdown (always ticking, resets every MANUAL_TOKEN_ROTATION_MS) ─
  useEffect(() => {
    const updateRemaining = () => {
      const remainingMs = MANUAL_TOKEN_ROTATION_MS - (Date.now() % MANUAL_TOKEN_ROTATION_MS);
      setManualTokenRemainingSec(Math.max(1, Math.ceil(remainingMs / 1000)));
    };
    updateRemaining();
    const intervalId = setInterval(updateRemaining, 250);
    return () => clearInterval(intervalId);
  }, []);

  // ── Auto-rotate BLE packet (same cadence as OfflineTaker) ────────────────────
  const advertise = useCallback(async (unitId, roomId, groupId, startSec, ctr) => {
    if (!BLEAdvertiserModule) { setBleError('BLE advertising not available'); return; }
    const payload = buildPayload(unitId, roomId, startSec, groupId, ctr);
    try {
      if (advertisingRef.current) await BLEAdvertiserModule.stopAdvertising().catch(() => {});
      if (BLEAdvertiserModule.startAdvertisingWithServiceUUID) {
        await BLEAdvertiserModule.startAdvertisingWithServiceUUID(payload, SERVICE_UUID);
      } else {
        await BLEAdvertiserModule.startAdvertising(payload);
      }
      advertisingRef.current = true;
      setIsAdvertising(true);
      setBleError('');
    } catch (e) {
      setBleError(e.message || 'BLE error');
      setIsAdvertising(false);
      advertisingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (phase !== 'active' || !delegation || !sessionStartMsRef.current) return;

    // Use groupNumber (1-indexed) for the BLE packet byte 8, NOT the DB groupId.
    // OfflineMarker compares this byte against myGroupsRef.current[unit] which also stores groupNumber.
    const { groupNumber } = delegation;
    const startSec = Math.floor(sessionStartMsRef.current / 1000);

    // Resolve BLE-range IDs from code strings.  delegation.unitId / roomId may be 0
    // (DB FK) if the lecturer's device had no mappings when the delegation was created.
    // Always prefer adaptiveConfig lookup; fall back to stored value only if non-zero.
    const resolveAndAdvertise = async () => {
      await adaptiveConfig.initialize(adaptiveConfig.currentInstitutionId).catch(() => {});
      const resolvedUnitId =
        (adaptiveConfig.getUnitId(delegation.unitCode) ?? 0) || Number(delegation.unitId || 0);
      const resolvedRoomId =
        (adaptiveConfig.getRoomId(delegation.roomCode) ?? 0) || Number(delegation.roomId || 0);
      resolvedBleIdsRef.current = { unitId: resolvedUnitId, roomId: resolvedRoomId };
      console.log(
        `[LeadSession] BLE IDs resolved: ${delegation.unitCode}→${resolvedUnitId}, ${delegation.roomCode}→${resolvedRoomId}`,
      );

      const scheduleNext = () => {
        counterRef.current = (counterRef.current + 1) & 0xFF;
        setCounter(counterRef.current);
        advertise(resolvedUnitId, resolvedRoomId, groupNumber, startSec, counterRef.current);
        const now = Date.now();
        const delay = QR_ROTATION_MS - (now % QR_ROTATION_MS);
        advertTimerRef.current = setTimeout(scheduleNext, delay);
      };

      advertise(resolvedUnitId, resolvedRoomId, groupNumber, startSec, counterRef.current);
      const now = Date.now();
      const delay = QR_ROTATION_MS - (now % QR_ROTATION_MS);
      advertTimerRef.current = setTimeout(scheduleNext, delay);
    };

    resolveAndAdvertise();
    return () => {
      clearTimeout(advertTimerRef.current);
    };
  }, [phase, delegation, advertise]);

  // ── Stop advertising when leaving ────────────────────────────────────────────
  useEffect(() => {
    return () => {
      clearTimeout(advertTimerRef.current);
      clearTimeout(qrTimerRef.current);
      clearInterval(elapsedTimerRef.current);
      clearInterval(countdownTimerRef.current);
      if (advertisingRef.current) {
        BLEAdvertiserModule?.stopAdvertising?.().catch(() => {});
        advertisingRef.current = false;
      }
    };
  }, []);

  // ── AppState: stop BLE when app backgrounds ──────────────────────────────────
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (appStateRef.current === 'active' && next !== 'active') {
        clearTimeout(advertTimerRef.current);
        BLEAdvertiserModule?.stopAdvertising?.().catch(() => {});
        advertisingRef.current = false;
        setIsAdvertising(false);
      }
      if (appStateRef.current !== 'active' && next === 'active' && phase === 'active') {
        const { groupNumber } = delegation;
        const startSec = Math.floor(sessionStartMsRef.current / 1000);
        const { unitId, roomId } = resolvedBleIdsRef.current;
        advertise(unitId, roomId, groupNumber, startSec, counterRef.current);
      }
      appStateRef.current = next;
    });
    return () => sub.remove();
  }, [phase, delegation, advertise]);

  // ── Resolve own studentId once on mount (used to skip proxy-mark button for self) ─
  useEffect(() => {
    getStudentSession().then((s) => setMyStudentId(s?.studentId ?? s?.id ?? null)).catch(() => {});
  }, []);

  // ── Fetch group member list when session becomes active ───────────────────────
  useEffect(() => {
    if (phase !== 'active' || !delegation?.groupId) return;
    let isMounted = true;
    getGroupMembers(delegation.groupId)
      .then((members) => { if (isMounted) setGroupMembers(Array.isArray(members) ? members : []); })
      .catch(() => { if (isMounted) setGroupMembers([]); });
    return () => { isMounted = false; };
  }, [phase, delegation]);

  // ── Mark a member present on behalf of the leader (proxy mark) ────────────────
  const handleProxyMark = useCallback(async (member) => {
    if (markingMemberId) return;
    const memberId = member.studentId ?? member.id;
    if (proxyMarked.has(memberId)) return;
    setMarkingMemberId(memberId);
    try {
      const markedAt = Date.now();
      // Always queue locally first — guarantees no data loss if offline.
      await sqliteStorage.addPendingProxyMark({
        delegationId: delegation.id,
        sessionToken,
        targetStudentId: memberId,
        targetAdmissionNumber: member.admissionNumber,
        unitCode: delegation.unitCode,
        lectureRoom: delegation.roomCode,
        sessionStart: sessionStartMsRef.current,
        markedAt,
      });
      // Optimistically show as marked — UI does not wait for backend.
      setProxyMarked((prev) => new Set([...prev, memberId]));
      // Try backend immediately; failure is silent (sync will retry).
      submitLeaderProxyMark(delegation.id, {
        sessionToken,
        targetStudentId: memberId,
        targetAdmissionNumber: member.admissionNumber,
        markedAt,
      }).then(async () => {
        // Find the queued record and mark it synced.
        const pending = await sqliteStorage.getUnsyncedProxyMarks();
        const match = pending.find(
          (r) => r.delegation_id === String(delegation.id) && r.target_student_id === String(memberId),
        );
        if (match) await sqliteStorage.markProxyMarkSynced(match.id).catch(() => {});
      }).catch(() => { /* stays in queue, syncs later */ });
    } catch (err) {
      Alert.alert('Could Not Mark', err?.message || 'Please try again.');
    } finally {
      setMarkingMemberId(null);
    }
  }, [delegation, sessionToken, markingMemberId, proxyMarked]);

  // ── Start session ─────────────────────────────────────────────────────────────
  const handleStart = useCallback(async () => {
    if (!delegation) return;
    const now = Date.now();
    if (now < delegation.validFrom) {
      Alert.alert('Too early', 'The session window has not opened yet.');
      return;
    }
    if (now > delegation.validUntil) {
      Alert.alert('Expired', 'The delegation time window has passed.');
      return;
    }
    setPhase('starting');
    try {
      // startDelegatedSession is offline-aware: returns a local token if offline.
      const result = await startDelegatedSession(delegation.id);
      const token = result?.sessionToken;
      if (!token) throw new Error('Could not generate a session token.');
      const startMs = Date.now();
      sessionStartMsRef.current = startMs;
      setSessionToken(token);
      setSessionStartMs(startMs);
      setElapsedMs(0);
      counterRef.current = 0;
      setCounter(0);
      await sqliteStorage.markDelegationUsed(delegation.id, token);
      // Auto-mark leader present — queue locally first, try backend immediately.
      const leaderMarkPayload = {
        unitCode: delegation.unitCode,
        lectureRoom: delegation.roomCode,
        sessionStart: startMs,
        scannedAt: startMs,
        deviceId: `GD-leader-${delegation.id}`,
        rawPayload: null,
      };
      let leaderSynced = 0;
      try {
        await submitOfflineAttendance(leaderMarkPayload);
        leaderSynced = 1;
      } catch (_) { /* will retry via syncPendingAttendance */ }
      await sqliteStorage.addAttendanceRecord({ ...leaderMarkPayload, synced: leaderSynced }).catch(() => {});
      setPhase('active');
      if (result?.offline) {
        Alert.alert('Session started offline', 'You are offline. Attendance will sync automatically when internet is restored.');
      }
    } catch (err) {
      setPhase('idle');
      Alert.alert('Could not start session', err.message || 'Please check your connection and try again.');
    }
  }, [delegation]);

  // ── End session ───────────────────────────────────────────────────────────────
  const doEnd = useCallback(async () => {
    doEndRef.current = null; // prevent double-invocation (auto-end + manual tap race)
    if (!delegation) return;
    setPhase('ending');
    clearTimeout(advertTimerRef.current);
    clearInterval(elapsedTimerRef.current);
    if (advertisingRef.current) {
      await BLEAdvertiserModule?.stopAdvertising?.().catch(() => {});
      advertisingRef.current = false;
      setIsAdvertising(false);
    }
    // endDelegatedSession is offline-aware: queues locally and resolves immediately.
    // Never blocks the UI on a network call.
    await endDelegatedSession(delegation.id, {
      sessionToken,
      unitCode: delegation.unitCode,
      roomCode: delegation.roomCode,
      sessionStart: sessionStartMsRef.current,
      sessionEnd: Date.now(),
    }).catch((err) => console.warn('[LeadSessionScreen] doEnd error (queued):', err?.message));
    setPhase('done');
  }, [delegation, sessionToken]);

  // Keep ref current every render so auto-end timer and Alert always call the latest doEnd.
  doEndRef.current = doEnd;

  const handleEnd = useCallback(() => {
    Alert.alert(
      'End session?',
      'This will stop the BLE beacon and submit attendance. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'End & Submit', style: 'destructive', onPress: () => doEndRef.current?.() },
      ],
    );
  }, []); // no deps — reads doEndRef at call time, always fresh

  // ── Render helpers ────────────────────────────────────────────────────────────

  if (loadingDelegation) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color="#6366F1" />
        <Text style={styles.loadingText}>Checking delegations…</Text>
      </SafeAreaView>
    );
  }

  if (!delegation) {
    return (
      <SafeAreaView style={styles.center}>
        <Icon name="lock-closed-outline" size={48} color="#94A3B8" />
        <Text style={styles.emptyTitle}>No active delegation</Text>
        <Text style={styles.emptySubtitle}>
          Your lecturer has not assigned you to lead a session.
        </Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backBtnText}>Go Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const windowClosed = Date.now() > delegation.validUntil;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBack}>
            <Icon name="arrow-back" size={22} color={C.textDark} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Lead Session</Text>
          <View style={{ width: 40 }} />
        </View>

        {/* Session info card */}
        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <Icon name="school-outline" size={16} color="#6366F1" />
            <Text style={styles.infoLabel}>Unit</Text>
            <Text style={styles.infoValue}>{delegation.unitCode}</Text>
          </View>
          <View style={styles.infoRow}>
            <Icon name="people-outline" size={16} color="#10B981" />
            <Text style={styles.infoLabel}>Group</Text>
            <Text style={styles.infoValue}>{delegation.groupName || `Group ${delegation.groupNumber}`}</Text>
          </View>
          <View style={styles.infoRow}>
            <Icon name="location-outline" size={16} color="#F59E0B" />
            <Text style={styles.infoLabel}>Room</Text>
            <Text style={styles.infoValue}>{delegation.roomCode}</Text>
          </View>
          <View style={styles.infoRow}>
            <Icon name="calendar-outline" size={16} color="#3B82F6" />
            <Text style={styles.infoLabel}>Valid</Text>
            <Text style={styles.infoValue}>
              {new Date(delegation.validFrom).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
            </Text>
          </View>
        </View>

        {/* Status display */}
        {phase === 'idle' && !windowClosed && (
          <View style={styles.statusCard}>
            <Icon name="radio-outline" size={40} color="#6366F1" />
            <Text style={styles.statusTitle}>Ready to start</Text>
            <Text style={styles.statusSub}>
              Your group members will be able to mark attendance once you start the BLE beacon.
            </Text>
          </View>
        )}

        {phase === 'idle' && windowClosed && (
          <View style={[styles.statusCard, { borderColor: C.danger }]}>
            <Icon name="close-circle-outline" size={40} color="#EF4444" />
            <Text style={[styles.statusTitle, { color: C.danger }]}>Window expired</Text>
            <Text style={styles.statusSub}>The delegation time window has passed.</Text>
          </View>
        )}

        {(phase === 'starting' || phase === 'ending') && (
          <View style={styles.statusCard}>
            <ActivityIndicator size="large" color="#6366F1" />
            <Text style={styles.statusTitle}>{phase === 'starting' ? 'Starting…' : 'Submitting…'}</Text>
          </View>
        )}

        {phase === 'active' && (
          <View style={[styles.statusCard, { borderColor: C.success }]}>
            <View style={[styles.dot, isAdvertising ? styles.dotActive : styles.dotInactive]} />
            <Text style={[styles.statusTitle, { color: C.success }]}>Session active</Text>
            <Text
              style={[
                styles.elapsedText,
                countdownMs != null && countdownMs < 60000 && { color: C.warning },
                countdownMs != null && countdownMs < 30000 && { color: C.danger },
              ]}
            >
              {formatCountdown(countdownMs ?? GD_SESSION_DURATION_MS)}
            </Text>
            <Text style={styles.countdownLabel}>remaining</Text>
            <Text style={styles.statusSub}>
              Broadcasting to {delegation.groupName || `Group ${delegation.groupNumber}`}.
              {'\n'}Only your group members can mark attendance.
            </Text>
            {!!bleError && <Text style={styles.bleError}>{bleError}</Text>}
          </View>
        )}

        {/* QR Code + Manual PIN — visible only while session is active */}
        {phase === 'active' && !!qrData && (
          <View style={styles.qrCard}>
            <Text style={styles.qrCardTitle}>Attendance QR Code</Text>
            <Text style={styles.qrCardSub}>
              Group members without BLE can scan this QR code to mark attendance.
            </Text>
            <View style={styles.qrWrap}>
              <QRCodeGenerator value={qrData} size={220} />
            </View>
            <Text style={styles.qrRotateHint}>Refreshes every 3 seconds</Text>

            <View style={styles.pinDivider} />

            <Text style={styles.pinLabel}>Manual fallback PIN</Text>
            <Text style={styles.pinValue}>{manualToken || '------'}</Text>
            <Text style={styles.pinExpiry}>Expires in {manualTokenRemainingSec}s</Text>
          </View>
        )}

        {/* Phoneless member proxy-mark — visible while session is active and members loaded */}
        {phase === 'active' && groupMembers.length > 0 && (
          <View style={styles.membersCard}>
            <View style={styles.membersHeader}>
              <Icon name="people-outline" size={18} color="#6366F1" />
              <Text style={styles.membersTitle}>Group Members</Text>
            </View>
            <Text style={styles.membersSub}>
              Tap "Mark Present" for a member without a smartphone. Only your group can be marked.
            </Text>
            {groupMembers.map((member) => {
              const memberId = member.studentId ?? member.id;
              const isSelf = memberId === myStudentId;
              const alreadyMarked = isSelf || proxyMarked.has(memberId);
              const isBeingMarked = markingMemberId === memberId;
              return (
                <View key={String(memberId)} style={styles.memberRow}>
                  <View style={styles.memberInfo}>
                    <Text style={styles.memberName} numberOfLines={1}>{member.name || 'Unknown'}</Text>
                    <Text style={styles.memberAdm}>{member.admissionNumber || ''}</Text>
                  </View>
                  {isSelf ? (
                    <View style={styles.memberBadgePresent}>
                      <Icon name="checkmark-circle" size={13} color="#16A34A" />
                      <Text style={styles.memberBadgePresentText}>You</Text>
                    </View>
                  ) : alreadyMarked ? (
                    <View style={styles.memberBadgePresent}>
                      <Icon name="checkmark-circle" size={13} color="#16A34A" />
                      <Text style={styles.memberBadgePresentText}>Present</Text>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={[styles.memberMarkBtn, (isBeingMarked || !!markingMemberId) && { opacity: 0.5 }]}
                      onPress={() => handleProxyMark(member)}
                      disabled={isBeingMarked || !!markingMemberId}
                    >
                      {isBeingMarked
                        ? <ActivityIndicator size="small" color="#FFF" />
                        : <Text style={styles.memberMarkBtnText}>Mark Present</Text>}
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
          </View>
        )}

        {phase === 'done' && (
          <View style={[styles.statusCard, { borderColor: C.success }]}>
            <Icon name="checkmark-circle-outline" size={48} color="#10B981" />
            <Text style={[styles.statusTitle, { color: C.success }]}>Session ended</Text>
            <Text style={styles.statusSub}>
              Attendance has been saved locally and will sync automatically when online.
            </Text>
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: C.primary, marginTop: 16 }]}
              onPress={() => navigation.goBack()}>
              <Text style={styles.actionBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Action buttons */}
        {phase === 'idle' && !windowClosed && (
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: C.success }]} onPress={handleStart}>
            <Icon name="radio" size={20} color="#FFF" style={{ marginRight: 8 }} />
            <Text style={styles.actionBtnText}>Start Session</Text>
          </TouchableOpacity>
        )}

        {phase === 'active' && (
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: C.danger }]} onPress={handleEnd}>
            <Icon name="stop-circle-outline" size={20} color="#FFF" style={{ marginRight: 8 }} />
            <Text style={styles.actionBtnText}>End &amp; Submit</Text>
          </TouchableOpacity>
        )}

        {/* Reminder */}
        <View style={styles.reminderBox}>
          <Icon name="information-circle-outline" size={14} color="#64748B" />
          <Text style={styles.reminderText}>
            Your group members must be physically near your device and scan with OfflineMarker to mark attendance.
          </Text>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (C) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bgLight },
  scroll: { padding: 16, paddingBottom: 32 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  loadingText: { color: C.textMid, fontSize: 14, marginTop: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: C.textDark, textAlign: 'center' },
  emptySubtitle: { fontSize: 14, color: C.textMid, textAlign: 'center', lineHeight: 20 },
  backBtn: {
    marginTop: 8, backgroundColor: C.primary,
    paddingHorizontal: 24, paddingVertical: 10, borderRadius: 10,
  },
  backBtnText: { color: '#FFF', fontWeight: '700', fontSize: 14 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 16,
  },
  headerBack: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '700', color: C.textDark },
  infoCard: {
    backgroundColor: C.bgLight, borderRadius: 14, padding: 16, marginBottom: 16,
    borderWidth: 1, borderColor: C.borderLt, gap: 10,
  },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  infoLabel: { fontSize: 13, color: C.textMid, fontWeight: '600', width: 52 },
  infoValue: { fontSize: 13, color: C.textDark, fontWeight: '700', flex: 1 },
  statusCard: {
    backgroundColor: C.bgLight, borderRadius: 14, padding: 20, marginBottom: 16,
    borderWidth: 1.5, borderColor: C.borderLt, alignItems: 'center', gap: 8,
  },
  statusTitle: { fontSize: 17, fontWeight: '700', color: C.textDark },
  statusSub: { fontSize: 13, color: C.textDarkTer, textAlign: 'center', lineHeight: 18 },
  countdown: { fontSize: 36, fontWeight: '800', color: C.warning, letterSpacing: 2 },
  elapsedText: { fontSize: 32, fontWeight: '800', color: C.success, letterSpacing: 2 },
  countdownLabel: { fontSize: 11, color: C.textSecAlt, textTransform: 'uppercase', letterSpacing: 1 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  dotActive: { backgroundColor: C.success },
  dotInactive: { backgroundColor: C.textSecAlt },
  bleError: { color: C.danger, fontSize: 12, textAlign: 'center' },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 14, borderRadius: 14, marginBottom: 12,
  },
  actionBtnText: { color: '#FFF', fontWeight: '700', fontSize: 16 },
  reminderBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    backgroundColor: C.bgLightSec, borderRadius: 10, padding: 12,
  },
  reminderText: { flex: 1, fontSize: 12, color: C.textDarkTer, lineHeight: 17 },
  // QR + PIN card
  qrCard: {
    backgroundColor: C.bgLight, borderRadius: 14, padding: 20, marginBottom: 16,
    borderWidth: 1.5, borderColor: C.primary, alignItems: 'center', gap: 6,
  },
  qrCardTitle: { fontSize: 15, fontWeight: '700', color: C.textDark },
  qrCardSub: { fontSize: 12, color: C.textDarkTer, textAlign: 'center', lineHeight: 17, marginBottom: 4 },
  qrWrap: {
    backgroundColor: C.bgLight, padding: 12, borderRadius: 12,
    borderWidth: 1, borderColor: C.borderLt,
  },
  qrRotateHint: { fontSize: 11, color: C.textSecAlt, marginTop: 2 },
  pinDivider: { height: 1, backgroundColor: C.borderLt, alignSelf: 'stretch', marginVertical: 8 },
  pinLabel: { fontSize: 12, color: C.textMid, fontWeight: '600' },
  pinValue: {
    fontSize: 28, fontWeight: '800', color: C.primary, letterSpacing: 4,
    fontVariant: ['tabular-nums'],
  },
  pinExpiry: { fontSize: 12, color: C.textSecAlt },
  // Group member proxy-mark card
  membersCard: {
    backgroundColor: C.bgLight, borderRadius: 14, padding: 16, marginBottom: 16,
    borderWidth: 1.5, borderColor: C.borderLt, gap: 10,
  },
  membersHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  membersTitle: { fontSize: 15, fontWeight: '700', color: C.textDark },
  membersSub: { fontSize: 12, color: C.textDarkTer, lineHeight: 17 },
  memberRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 8, borderTopWidth: 1, borderTopColor: C.bgLightSec,
  },
  memberInfo: { flex: 1, marginRight: 10 },
  memberName: { fontSize: 13, fontWeight: '600', color: C.textDark },
  memberAdm: { fontSize: 11, color: C.textSecAlt, marginTop: 1 },
  memberBadgePresent: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#DCFCE7', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20,
  },
  memberBadgePresentText: { fontSize: 11, fontWeight: '700', color: '#16A34A' },
  memberMarkBtn: {
    backgroundColor: C.primary, paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 20, minWidth: 90, alignItems: 'center', justifyContent: 'center',
  },
  memberMarkBtnText: { color: '#FFF', fontSize: 12, fontWeight: '700' },
});
