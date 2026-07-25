/**
 * backgroundBLEService.js
 *
 * Self-contained background BLE tasks for MarkWise attendance.
 *
 * studentBackgroundTask  — keeps BLE scanning alive when OfflineMarker is backgrounded.
 *   On beacon match: saves attendance to SQLite, shows a local notification, writes
 *   result to AsyncStorage so the UI can restore state when the app foregrounds.
 *
 * lecturerBackgroundTask — keeps BLE advertising alive when OfflineTaker is backgrounded.
 *   Rotates the BLE counter every QR_WINDOW_SECONDS so nearby students keep receiving
 *   a valid, time-bound beacon even while the lecturer's screen is off.
 *
 * Both functions are designed to be passed to react-native-background-actions:
 *   await BackgroundActions.start(studentBackgroundTask, options);
 *   await BackgroundActions.stop();
 *
 * Security: same HMAC-free BLE beacon format as foreground (v0x01). The beacon carries
 * sessionNonce + counter; the backend verifies counter windows at sync time.
 * No session key is needed for advertising — it remains in Keychain, never touched here.
 */

import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Buffer } from 'buffer';
import {
    encodeBLEBeacon,
    decodeBLEBeacon,
    deriveCounter,
    QR_WINDOW_SECONDS,
} from '../utils/sessionCrypto';
import { adaptiveConfig } from '../utils/adaptiveAttendanceConfig';
import sqliteStorage from '../storage/sqliteStorage';
import { displayLocalNotification, CHANNELS } from '../utils/notificationService';

const { BLEScanner, BLEAdvertiserModule } = NativeModules;

const SERVICE_UUID      = '00001101-0000-1000-8000-00805F9B34FB';
const QR_ROTATION_MS    = QR_WINDOW_SECONDS * 1000;
const SESSION_DURATION_MS = 2 * 60 * 60 * 1000; // 2 hours

/** AsyncStorage key — UI reads this on foreground restore to show the success screen. */
export const BG_STUDENT_RESULT_KEY = '@markwise_bg_student_result';

// ── Helpers ───────────────────────────────────────────────────────────────────

const normCode = s => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

async function ensureAdaptiveConfig() {
    if (!adaptiveConfig.currentInstitutionId) {
        try {
            const raw = await AsyncStorage.getItem('studentSession');
            const sess = raw ? JSON.parse(raw) : null;
            if (sess?.institutionId) adaptiveConfig.setInstitution(sess.institutionId);
        } catch {}
    }
}

/**
 * Background-safe beacon parser — mirrors parseBinaryPayload in OfflineMarker
 * but makes no React state calls.
 */
async function parseBeaconBg(base64Payload) {
    try {
        if (typeof base64Payload !== 'string' || base64Payload.length < 8) return null;

        await ensureAdaptiveConfig();

        const buf = Buffer.from(base64Payload, 'base64');
        if (buf.length !== 9 && buf.length !== 10) return null;

        // Secure v0x01 format
        if (buf.length === 10 && buf[9] === 0x01) {
            const decoded = decodeBLEBeacon(buf);
            if (!decoded) return null;
            const { sessionNonce, counter, unitId, roomId } = decoded;

            let unitCode    = adaptiveConfig.getUnitCodeFromId(unitId);
            let lectureRoom = adaptiveConfig.getRoomCodeFromId(roomId);

            if (!unitCode || !lectureRoom) {
                try {
                    const raw = await AsyncStorage.getItem('studentSession');
                    const sess = raw ? JSON.parse(raw) : null;
                    if (sess?.institutionId && sess?.token) {
                        adaptiveConfig.setInstitution(sess.institutionId);
                        await adaptiveConfig.syncInstitutionMappingsFromBackend(sess.institutionId, sess.token);
                    }
                } catch {}
                unitCode    = adaptiveConfig.getUnitCodeFromId(unitId);
                lectureRoom = adaptiveConfig.getRoomCodeFromId(roomId);
            }
            if (!unitCode || !lectureRoom) return null;

            // Epoch sessionStart — same stable formula as OfflineMarker
            const sessionDurationSec = Math.floor(SESSION_DURATION_MS / 1000);
            const nowS = Math.floor(Date.now() / 1000);
            const sessionStart = Math.floor(nowS / sessionDurationSec) * sessionDurationSec * 1000;

            return {
                unitCode,
                lectureRoom,
                sessionStart,
                sessionNonce,
                raw: { sessionNonce, counter, unitId, roomId },
            };
        }

        // Legacy format (9-byte or 10-byte without version byte 0x01)
        const unitId = (buf[0] << 8) | buf[1];
        const roomId = (buf[2] << 8) | buf[3];
        const unitCode    = adaptiveConfig.getUnitCodeFromId(unitId);
        const lectureRoom = adaptiveConfig.getRoomCodeFromId(roomId);
        if (!unitCode || !lectureRoom) return null;
        const timestampSec = (buf[4] << 24) | (buf[5] << 16) | (buf[6] << 8) | buf[7];
        return {
            unitCode,
            lectureRoom,
            sessionStart: timestampSec * 1000,
            sessionNonce: null,
            raw: { unitId, roomId, sessionNonce: null, counter: 0 },
        };
    } catch {
        return null;
    }
}

/** Enrollment check via SQLite — no React context required. */
async function isEnrolledBg(unitCode) {
    try {
        const state = await sqliteStorage.getEnrollmentState();
        const units = Array.isArray(state?.enrolledUnits) ? state.enrolledUnits : [];
        return units.some(u => normCode(u) === normCode(unitCode));
    } catch {
        return false;
    }
}

/** Local notification — uses the centralized service so the channel is guaranteed registered. */
async function showLocalNotification(title, body) {
    await displayLocalNotification({ title, body, channelId: CHANNELS.attendance });
}

// ── Student background task ───────────────────────────────────────────────────

/**
 * Keeps BLE scanning alive while the student app is backgrounded.
 *
 * On first matching, enrolled, non-duplicate beacon:
 *   1. Saves attendance record to SQLite.
 *   2. Writes result to AsyncStorage (@markwise_bg_student_result).
 *   3. Shows a local notification.
 *   4. Stops the background task.
 *
 * Called by:
 *   await BackgroundActions.start(studentBackgroundTask, { taskName: 'studentBLEScan', ... });
 */
export const studentBackgroundTask = async (_taskData) => {
    await new Promise(async (resolve) => {
        if (!BLEScanner) { resolve(); return; }

        const emitter = new NativeEventEmitter(BLEScanner);
        let done = false;

        const finish = () => {
            if (done) return;
            done = true;
            listener?.remove();       // eslint-disable-line no-use-before-define
            BLEScanner.stopScan?.();
            resolve();
        };

        try {
            // iOS background BLE requires a service UUID filter — withServices:nil
            // stops delivering callbacks once the app is suspended. Android has no
            // such restriction, so we use the faster no-filter scan there.
            if (Platform.OS === 'ios') {
                await BLEScanner.startScan(SERVICE_UUID);
            } else if (BLEScanner.startScanNoFilter) {
                await BLEScanner.startScanNoFilter();
            } else {
                await BLEScanner.startScan(SERVICE_UUID);
            }
        } catch {
            resolve(); return;
        }

        const listener = emitter.addListener('onDeviceFound', async (device) => {
            if (done) return;

            const payload = device?.payload || device?.advertisementData || device?.data || '';
            const parsed = await parseBeaconBg(payload);
            if (!parsed) return;

            const { unitCode, lectureRoom, sessionStart, sessionNonce, raw } = parsed;

            if (!await isEnrolledBg(unitCode)) return;

            const alreadyMarked = await sqliteStorage
                .hasAttendanceForSession({ unitCode, lectureRoom, sessionStart })
                .catch(() => false);
            if (alreadyMarked) { finish(); return; }

            const rawPayload = raw?.sessionNonce != null
                ? `MWBLE:v1:${raw.sessionNonce}:${raw.counter}:${raw.unitId}:${raw.roomId}`
                : 'MWBLE:legacy';

            const result = await sqliteStorage.addAttendanceRecord({
                unitCode,
                lectureRoom,
                sessionStart,
                scannedAt: Date.now(),
                rawPayload,
                deviceId: null,
                synced: 0,
                lessonType: null,
            }).catch(() => null);

            if (result?.saved) {
                await AsyncStorage.setItem(BG_STUDENT_RESULT_KEY, JSON.stringify({
                    unitCode,
                    lectureRoom,
                    sessionStart,
                    markedAt: Date.now(),
                    sessionNonce: sessionNonce ?? null,
                })).catch(() => {});

                await showLocalNotification(
                    'Attendance Marked!',
                    `${unitCode} • ${lectureRoom}`,
                );
                finish();
            }
        });

        // Auto-stop after session window — prevents indefinite battery drain
        setTimeout(finish, SESSION_DURATION_MS);
    });
};

// ── Lecturer background task ──────────────────────────────────────────────────

/**
 * Keeps BLE advertising alive while the lecturer app is backgrounded.
 *
 * Rotates the beacon counter every QR_WINDOW_SECONDS using the same
 * deriveCounter() formula so nearby students always receive a valid token.
 *
 * taskData fields (all required):
 *   unitId       {number}  — numeric unit ID from adaptiveConfig
 *   roomId       {number}  — numeric room ID from adaptiveConfig
 *   sessionNonce {number}  — 16-bit nonce generated at session start
 *   sessionStart {number}  — epoch ms of session start
 *   lessonTypeId {number}  — lesson type (0 = standard)
 *   remainingMs  {number}  — ms until session expires
 *
 * Called by:
 *   await BackgroundActions.start(lecturerBackgroundTask, { taskName: 'lecturerBeacon', parameters: {...} });
 */
export const lecturerBackgroundTask = async (taskData) => {
    const {
        unitId,
        roomId,
        sessionNonce,
        sessionStart,
        lessonTypeId = 0,
        remainingMs,
    } = taskData;

    await new Promise(async (resolve) => {
        if (!BLEAdvertiserModule || unitId == null || roomId == null || !sessionNonce || !sessionStart) {
            resolve(); return;
        }

        const advertise = async () => {
            try {
                const counter = deriveCounter(
                    Math.floor(sessionStart / 1000),
                    QR_WINDOW_SECONDS,
                    Date.now(),
                );
                const bytes = encodeBLEBeacon({
                    sessionNonce: sessionNonce & 0xFFFF,
                    counter,
                    unitId,
                    roomId,
                    lessonTypeId,
                });
                const base64Payload = Buffer.from(bytes).toString('base64');

                await BLEAdvertiserModule.stopAdvertising().catch(() => {});
                if (BLEAdvertiserModule.startAdvertisingWithServiceUUID) {
                    await BLEAdvertiserModule.startAdvertisingWithServiceUUID(base64Payload, SERVICE_UUID);
                } else {
                    await BLEAdvertiserModule.startAdvertising(base64Payload);
                }
            } catch {}
        };

        await advertise();
        const intervalId = setInterval(advertise, QR_ROTATION_MS);

        // Stop when the session expires (or use remainingMs if provided)
        const stopAfterMs = Math.max(remainingMs ?? SESSION_DURATION_MS, 5000);
        setTimeout(() => {
            clearInterval(intervalId);
            BLEAdvertiserModule.stopAdvertising().catch(() => {});
            resolve();
        }, stopAfterMs);
    });
};
