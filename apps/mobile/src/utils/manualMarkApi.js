// src/utils/manualMarkApi.js
// API functions for the lecturer manual attendance mark feature.
// Used when a student without a smartphone presents their physical ID card to the lecturer.
// The lecturer reads the admission number off the card and submits it here.
// Backend records these as attendance_method = "manual_lecturer" for auditability.
//
// OFFLINE STRATEGY:
//   1. When unit is selected online: fetchAndCacheUnitRoster() pre-fetches enrolled students into SQLite.
//   2. lookupStudentByAdmissionNumber() checks SQLite roster first; falls back to network if online.
//   3. submitManualMark() submits to backend if online; queues in pending_manual_marks if offline.
//   4. syncPendingManualMarks() drains the queue — called by offlineAttendanceApi on internet restore.

import { API_BASE_URL, normalizeUnitCode as normalizeUnitCodeUtil } from './constants';
import sqliteStorage from '../storage/sqliteStorage';
import { hasInternetConnection } from './connectivity';
import { syncConductedSession } from './offlineAttendanceApi';
import { getSessionKey } from './sessionKeyStore';

// Canonical unit code normalizer — imported from constants.js
const normalizeUnitCode = normalizeUnitCodeUtil;
const normalizeRoomCode = (room) =>
  String(room || '')
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9]/g, '') || String(room || '').toUpperCase();
const normalizeAdmNumber = (adm) => String(adm || '').trim().toUpperCase();

// Cache duration constants
const MANUAL_MARK_CACHE_DURATION_MS = 2 * 60 * 60 * 1000; // 2 hours for manual mark roster

// Remember which roster endpoint worked last so we skip failed ones on the next call.
let _lastWorkingEndpoint = null;

/**
 * Check if roster cache is still valid
 * @param {string} unitCode
 * @param {string} institutionId
 * @param {number} [maxAgeMs] - Maximum cache age in milliseconds (default: 24h for general, 2h for manual marks)
 */
export const isRosterCacheValid = async (unitCode, institutionId, maxAgeMs = MANUAL_MARK_CACHE_DURATION_MS) => {
    if (!unitCode) return false;
    try {
        const normalizedCode = normalizeUnitCode(unitCode);
        const cacheMeta = await sqliteStorage.getUnitRosterCacheMeta(normalizedCode, institutionId || '');
        if (!cacheMeta) return false;
        
        const isValid = Date.now() - (cacheMeta.last_updated || 0) < maxAgeMs;
        return isValid && (cacheMeta.student_count > 0);
    } catch (err) {
        console.warn('[manualMarkApi] Error checking cache validity:', err);
        return false;
    }
};

/**
 * Get roster status for a unit (returns count and validity)
 * @param {string} unitCode
 * @param {string} institutionId
 * @param {number} [maxAgeMs] - Maximum cache age in milliseconds
 */
export const getRosterStatus = async (unitCode, institutionId, maxAgeMs = MANUAL_MARK_CACHE_DURATION_MS) => {
    if (!unitCode) return { hasCache: false, studentCount: 0, isValid: false };
    try {
        const normalizedCode = normalizeUnitCode(unitCode);
        
        // Try to get metadata first
        const cacheMeta = await sqliteStorage.getUnitRosterCacheMeta(normalizedCode, institutionId || '');
        if (cacheMeta) {
            const isValid = Date.now() - (cacheMeta.last_updated || 0) < maxAgeMs;
            return {
                hasCache: true,
                studentCount: cacheMeta.student_count || 0,
                isValid: isValid,
                lastUpdated: cacheMeta.last_updated
            };
        }
        
        // Fallback: try to get cached students directly
        const cachedStudents = await sqliteStorage.getAllCachedStudentsForUnit(normalizedCode);
        if (cachedStudents && cachedStudents.length > 0) {
            return {
                hasCache: true,
                studentCount: cachedStudents.length,
                isValid: true, // Assume valid if we have cache
                lastUpdated: Date.now()
            };
        }
        
        return { hasCache: false, studentCount: 0, isValid: false };
    } catch (err) {
        console.warn('[manualMarkApi] Error getting roster status:', err);
        return { hasCache: false, studentCount: 0, isValid: false };
    }
};

/**
 * Pre-fetch the enrolled student roster for a unit and cache it in SQLite.
 * Call this when the lecturer selects a unit while online (session start).
 * Returns { success: boolean, error?: string, studentCount?: number } for caller feedback.
 *
 * @param {string} unitCode      — raw unit code from timetable (will be normalized)
 * @param {string} institutionId — from lecturer session
 * @param {string} token         — lecturer JWT
 * @param {number} retryCount    — internal retry counter (default 0)
 */
export const fetchAndCacheUnitRoster = async (unitCode, institutionId, token) => {
    // Validation
    if (!token) {
        return { success: false, error: 'Authentication required. Please log in again.' };
    }
    if (!unitCode) {
        return { success: false, error: 'Unit code is required.' };
    }

    // First, try to get cached data regardless of connectivity
    let cachedStudentCount = 0;
    try {
        const normalizedCode = normalizeUnitCode(unitCode);
        const cachedStudents = await sqliteStorage.getAllCachedStudentsForUnit(normalizedCode);
        if (cachedStudents && cachedStudents.length > 0) {
            cachedStudentCount = cachedStudents.length;
            console.log(`[manualMarkApi] Found ${cachedStudentCount} cached students for ${normalizedCode}`);
        }
    } catch (_) {}

    // Check connectivity
    const online = await hasInternetConnection().catch(() => false);
    if (!online) {
        // Return cached data if available
        if (cachedStudentCount > 0) {
            return {
                success: true,
                studentCount: cachedStudentCount,
                fromCache: true,
                warning: 'Using cached roster (offline mode)'
            };
        }
        return { success: false, error: 'No internet connection and no cached roster available.' };
    }

    try {
        const normalizedCode = normalizeUnitCode(unitCode);
        
        // Try multiple possible endpoint formats.
        // Prioritise the last-working endpoint to skip failed probes on repeat calls.
        const candidateEndpoints = [
            `/api/lecturer/units/${encodeURIComponent(normalizedCode)}/students`,
            `/api/units/${encodeURIComponent(normalizedCode)}/students`,
            `/api/attendance/units/${encodeURIComponent(normalizedCode)}/roster`,
            `/api/lecturer/roster/${encodeURIComponent(normalizedCode)}`,
        ];
        const endpoints = _lastWorkingEndpoint
            ? [_lastWorkingEndpoint, ...candidateEndpoints.filter(e => e !== _lastWorkingEndpoint)]
            : candidateEndpoints;

        let students = null;

        for (const endpoint of endpoints) {
            try {
                const params = new URLSearchParams({
                    unitCode: normalizedCode,
                    _t: Date.now()
                });
                if (institutionId) params.set('institutionId', String(institutionId));

                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 15000);

                const res = await fetch(
                    `${API_BASE_URL}${endpoint}?${params}`,
                    {
                        headers: {
                            Authorization: `Bearer ${token}`,
                            'Cache-Control': 'no-cache'
                        },
                        signal: controller.signal
                    }
                );
                clearTimeout(timeoutId);

                if (res.ok) {
                    const data = await res.json().catch(() => null);
                    if (data) {
                        // Extract students from response
                        if (Array.isArray(data)) {
                            students = data;
                        } else if (Array.isArray(data?.students)) {
                            students = data.students;
                        } else if (Array.isArray(data?.data)) {
                            students = data.data;
                        } else if (Array.isArray(data?.enrolledStudents)) {
                            students = data.enrolledStudents;
                        }

                        if (students && students.length > 0) {
                            _lastWorkingEndpoint = endpoint;
                            console.log(`[manualMarkApi] Fetched roster from ${endpoint} (${students.length} students)`);
                            break;
                        }
                    }
                } else {
                    const errorText = await res.text().catch(() => '');
                    console.warn(`[manualMarkApi] Endpoint ${endpoint} returned ${res.status}: ${errorText.substring(0, 100)}`);
                }
            } catch (err) {
                console.warn(`[manualMarkApi] Endpoint ${endpoint} failed:`, err.message);
            }
        }
        
        // If no students found from any endpoint, try to use cached data
        if (!students || students.length === 0) {
            if (cachedStudentCount > 0) {
                return {
                    success: true,
                    studentCount: cachedStudentCount,
                    fromCache: true,
                    warning: 'Using cached roster (endpoint returned no data)'
                };
            }
            return { 
                success: true, 
                studentCount: 0,
                warning: 'No enrolled students found for this unit.'
            };
        }

        // Validate and normalize student records
        const validStudents = [];
        const skippedStudents = [];
        
        for (const s of students) {
            const studentId = s.studentId || s.student_id || s.id || s._id;
            const admissionNumber = s.admissionNumber || s.admission_number || s.admNo || s.adm_no || s.admNumber || s.registrationNumber;
            const studentName = s.studentName || s.student_name || s.name || s.fullName || s.full_name || 'Unknown';
            
            if (studentId && admissionNumber) {
                validStudents.push({
                    studentId: String(studentId),
                    studentName: String(studentName),
                    admissionNumber: String(admissionNumber).toUpperCase(),
                    unitCode: normalizedCode
                });
            } else {
                skippedStudents.push({ studentId, admissionNumber });
            }
        }

        if (validStudents.length === 0) {
            return { 
                success: false, 
                error: `No valid student records found. ${skippedStudents.length} records skipped.`
            };
        }

        // Save to SQLite
        await sqliteStorage.saveUnitRosterCache(normalizedCode, institutionId || '', validStudents);
        
        // Save metadata
        await sqliteStorage.saveUnitRosterCacheMeta(normalizedCode, institutionId || '', {
            lastUpdated: Date.now(),
            studentCount: validStudents.length,
            unitDisplay: unitCode
        });

        return { 
            success: true, 
            studentCount: validStudents.length,
            skipped: skippedStudents.length,
            fromCache: false
        };

    } catch (err) {
        console.error('[manualMarkApi] Fetch roster error:', err);
        
        // Try to return cached data as fallback
        if (cachedStudentCount > 0) {
            return {
                success: true,
                studentCount: cachedStudentCount,
                fromCache: true,
                warning: `Using cached roster (${err.message || 'Unknown error'})`
            };
        }

        return { 
            success: false, 
            error: `Failed to load roster: ${err.message || 'Unknown error'}` 
        };
    }
};

/**
 * Look up a student by admission number within a unit.
 * Strategy: SQLite cache first (works offline), then network fallback (if online).
 *
 * Returns: { studentName, studentId, admissionNumber, isEnrolled, fromCache }
 */
export const lookupStudentByAdmissionNumber = async (admissionNumber, unitCode, token) => {
    if (!token) throw new Error('Not authenticated. Please log in again.');
    
    const normalizedAdm = normalizeAdmNumber(admissionNumber);
    if (!normalizedAdm) throw new Error('Valid admission number is required.');
    
    const normalizedCode = normalizeUnitCode(unitCode);
    if (!normalizedCode) throw new Error('Valid unit code is required.');

    // --- Step 1: Check local SQLite roster cache ---
    try {
        const cached = await sqliteStorage.getUnitRosterCache(normalizedCode, normalizedAdm);
        if (cached) {
            console.log(`[manualMarkApi] Found student in cache: ${cached.studentName}`);
            return { 
                ...cached, 
                fromCache: true,
                isEnrolled: true
            };
        }
    } catch (err) {
        console.warn('[manualMarkApi] Cache lookup error:', err);
    }

    // --- Step 2: Check if we have any cached roster for this unit ---
    let hasAnyCache = false;
    try {
        const allCached = await sqliteStorage.getAllCachedStudentsForUnit(normalizedCode);
        hasAnyCache = allCached && allCached.length > 0;
    } catch (_) {}

    // --- Step 3: Try network if online ---
    const online = await hasInternetConnection().catch(() => false);
    
    if (!online) {
        if (hasAnyCache) {
            throw new Error(
                `Student ${normalizedAdm} not found in offline roster.\n\n` +
                `The student may not be enrolled in ${normalizedCode}.`
            );
        } else {
            throw new Error(
                `Student roster not available offline.\n\n` +
                `Please connect to the internet to load the student roster for ${normalizedCode}.`
            );
        }
    }

    // --- Step 4: Network lookup ---
    try {
        const params = new URLSearchParams({
            admissionNumber: normalizedAdm,
            unitCode: normalizedCode,
        });
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        
        const res = await fetch(
            `${API_BASE_URL}/api/attendance/manual-mark/lookup?${params}`,
            { 
                headers: { 
                    Authorization: `Bearer ${token}`,
                    'Cache-Control': 'no-cache'
                },
                signal: controller.signal
            }
        );
        clearTimeout(timeoutId);
        
        const data = await res.json().catch(() => ({}));
        
        if (!res.ok) {
            throw new Error(data.message || data.error || `Student not found (${res.status})`);
        }

        // Normalize response
        const result = {
            studentId: data.studentId || data.student_id || data.id || data._id || '',
            studentName: data.studentName || data.student_name || data.name || data.fullName || data.full_name || 'Unknown',
            admissionNumber: data.admissionNumber || data.admission_number || data.admNo || data.adm_number || normalizedAdm,
            isEnrolled: data.isEnrolled !== undefined ? data.isEnrolled : true,
            fromCache: false,
        };

        // Cache the result into the existing roster for future offline use.
        // Use '_lookup' as institution scope so it doesn't DELETE the full
        // roster (which is stored under the real institutionId).
        if (result.isEnrolled && result.studentId) {
            try {
                await sqliteStorage.saveUnitRosterCache(normalizedCode, '_lookup', [result]);
            } catch (_) {}
        }

        return result;
        
    } catch (err) {
        console.error('[manualMarkApi] Network lookup error:', err);
        
        if (hasAnyCache) {
            throw new Error(
                `Student not found in roster.\n\n` +
                `The student may not be enrolled in ${normalizedCode}.`
            );
        }
        
        throw new Error(`Failed to lookup student: ${err.message || 'Network error'}`);
    }
};

/**
 * Submit a manual attendance mark.
 * If online: posts to backend immediately.
 * If offline: saves to pending_manual_marks queue for later sync via syncPendingManualMarks().
 *
 * Returns { queued: true } when saved offline, or the backend response when online.
 * Returns 409 silently as { duplicate: true }.
 */
export const submitManualMark = async ({
    admissionNumber,
    studentId,
    unitCode,
    lectureRoom,
    sessionStart,
    lecturerId,
    token,
}) => {
    if (!token) throw new Error('Not authenticated. Please log in again.');
    
    const normalizedAdm = normalizeAdmNumber(admissionNumber);
    if (!normalizedAdm) throw new Error('Valid admission number is required.');
    
    if (!studentId) throw new Error('Student ID is required.');
    
    const normalizedCode = normalizeUnitCode(unitCode);
    if (!normalizedCode) throw new Error('Valid unit code is required.');
    
    const normalizedRoom = normalizeRoomCode(lectureRoom);
    if (!normalizedRoom) throw new Error('Valid lecture room is required.');
    
    if (!sessionStart || !Number.isFinite(sessionStart)) {
        throw new Error('Valid session start time is required.');
    }

    const payload = {
        admissionNumber: normalizedAdm,
        studentId: String(studentId),
        unitCode: normalizedCode,
        lectureRoom: normalizedRoom,
        sessionStart: Number(sessionStart),
        lecturerId: lecturerId || null,
        markedAt: Date.now(),
    };

    const online = await hasInternetConnection().catch(() => false);

    if (!online) {
        try {
            await sqliteStorage.addPendingManualMark(payload);
            return { queued: true, message: 'Mark saved offline. Will sync when online.' };
        } catch (err) {
            console.error('[manualMarkApi] Failed to queue manual mark:', err);
            throw new Error('Failed to save attendance offline. Please try again.');
        }
    }

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        
        const res = await fetch(`${API_BASE_URL}/api/attendance/manual-mark/submit`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (res.status === 409) {
            return { duplicate: true, message: 'Student already marked present for this session.' };
        }

        const data = await res.json().catch(() => ({}));
        
        if (!res.ok) {
            throw new Error(data.message || data.error || `Could not mark attendance (${res.status})`);
        }
        
        return { success: true, ...data };
        
    } catch (err) {
        console.error('[manualMarkApi] Submit error:', err);

        const isNetworkError =
            err.name === 'AbortError' ||
            err.name === 'TypeError' ||
            err.message?.includes('network') ||
            err.message?.includes('timeout') ||
            err.message?.includes('fetch') ||
            err.message?.includes('internet') ||
            err.message?.includes('connection');

        if (isNetworkError) {
            try {
                await sqliteStorage.addPendingManualMark(payload);
                return { queued: true, message: 'Network error. Mark saved offline and will sync when online.' };
            } catch (queueErr) {
                throw new Error('No internet connection and offline queue unavailable. Please try again.');
            }
        }

        throw new Error(err.message || 'Failed to submit attendance. Please try again.');
    }
};

let _isSyncingManualMarks = false;

/**
 * Drain the pending_manual_marks queue.
 * Called by offlineAttendanceApi.syncPendingAttendance() when internet is restored.
 * Returns { synced, failed } counts.
 */
export const syncPendingManualMarks = async (token) => {
    if (_isSyncingManualMarks || !token) return { synced: 0, failed: 0 };
    _isSyncingManualMarks = true;
    let synced = 0;
    let failed = 0;
    
    try {
        const pending = await sqliteStorage.getUnsyncedPendingManualMarks();
        
        if (pending.length === 0) {
            return { synced: 0, failed: 0 };
        }
        
        console.log(`[manualMarkApi] Syncing ${pending.length} pending manual marks...`);
        
        for (const mark of pending) {
            try {
                // Attempt to recover the session key from Keychain so the backend can
                // associate the crypto material with this session if the initial
                // syncConductedSession failed while the lecturer was offline.
                const sessionId = `${normalizeUnitCode(mark.unit_code)}|${normalizeRoomCode(mark.lecture_room)}|${mark.session_start}`;
                const recoveredKey = await getSessionKey(sessionId).catch(() => null);
                await syncConductedSession({
                    unitCode: mark.unit_code,
                    lectureRoom: mark.lecture_room,
                    sessionStart: mark.session_start,
                    createdAt: mark.marked_at,
                    sessionKey: recoveredKey, // null if already synced or key expired from Keychain
                }).catch(() => {});

                const res = await fetch(`${API_BASE_URL}/api/attendance/manual-mark/submit`, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        admissionNumber: mark.admission_number,
                        studentId: mark.student_id,
                        unitCode: normalizeUnitCode(mark.unit_code),
                        lectureRoom: normalizeRoomCode(mark.lecture_room),
                        sessionStart: mark.session_start,
                        lecturerId: mark.lecturer_id,
                        markedAt: mark.marked_at,
                    }),
                });
                
                if (res.ok || res.status === 409) {
                    await sqliteStorage.markPendingManualMarkSynced(mark.id);
                    synced++;
                } else {
                    sqliteStorage.incrementManualMarkSyncAttempts(mark.id).catch(() => {});
                    failed++;
                    console.warn(`[manualMarkApi] Failed to sync mark ${mark.id}: HTTP ${res.status}`);
                }
            } catch (err) {
                sqliteStorage.incrementManualMarkSyncAttempts(mark.id).catch(() => {});
                failed++;
                console.warn(`[manualMarkApi] Error syncing mark ${mark.id}:`, err.message);
            }
        }
        
        console.log(`[manualMarkApi] Sync complete: ${synced} synced, ${failed} failed`);
        return { synced, failed };
        
    } catch (err) {
        console.error('[manualMarkApi] Sync error:', err);
        return { synced, failed };
    } finally {
        _isSyncingManualMarks = false;
    }
};

// Export all functions
export default {
    fetchAndCacheUnitRoster,
    lookupStudentByAdmissionNumber,
    submitManualMark,
    syncPendingManualMarks,
    isRosterCacheValid,
    getRosterStatus,
};