// src/utils/adaptiveAttendanceConfig.js
import React, { useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLecturerSession, getStudentSession } from './authSession';
import { API_BASE_URL } from './constants';
import sqliteStorage from '../storage/sqliteStorage';

// Dev-only logger — silenced in production builds
const _log = __DEV__ ? (...a) => console.log(...a) : () => {};

// Fetch institution mappings from backend
export async function fetchInstitutionMappings(institutionId, token) {
    if (!institutionId) throw new Error('Missing institutionId');
    const base = String(API_BASE_URL || '').trim();
    const normalizedBase = base.replace(/\/$/, '');
    const url = `${normalizedBase}/api/mappings?institutionId=${encodeURIComponent(institutionId)}`;
    const headers = {
        Accept: 'application/json',
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    let response;
    try {
        response = await fetch(url, { method: 'GET', headers });
    } catch (err) {
        // Bubble up network errors with a clear message for debugging
        throw new Error(`Network request failed when fetching mappings from ${url}: ${err.message}`);
    }

    if (!response.ok) {
        throw new Error(`Failed to fetch mappings: ${response.status}`);
    }
    const data = await response.json();
    if (data && data.metadata) {
        return { ...data, ...data.metadata };
    }
    return data;
}

const STORAGE_KEYS = {
    MAPPINGS: (institutionId) => `@attendance_mappings_v4:${institutionId}`,
    LAST_SYNC: (institutionId) => `@attendance_last_sync_v4:${institutionId}`,
    DEVICE_ID: '@attendance_device_id'
};

// Backend uses 4-digit IDs: units U0000–U7999 (0–7999), rooms R8000–R9999 (8000–9999).
// The numeric bleId from the BLE payload (UInt16BE, 0–65535) maps directly.
// Units: 0–7999, Rooms: 8000–9999.
const PAD_LENGTH = 4;
const UNIT_ID_MAX = 7999;
const ROOM_ID_MIN = 8000;

class AdaptiveAttendanceConfig {
    constructor() {
        this.mappings = null;
        this.currentInstitutionId = null;
        this.syncInProgress = false;
        this.initialized = false;
        this.lastSyncTime = null;
        this.listeners = new Set();
        // ID-to-code caches: key is zero-padded 4-digit string or hex string
        this.unitIdToCodeCache = new Map();
        this.roomIdToCodeCache = new Map();
    }

    addListener(callback) {
        this.listeners.add(callback);
        return () => this.listeners.delete(callback);
    }

    notifyListeners() {
        this.listeners.forEach(callback => {
            try {
                callback(this.mappings);
            } catch (err) {
                console.error('[AdaptiveConfig] Listener error:', err);
            }
        });
    }

    setInstitution(institutionId) {
        if (!institutionId) {
            console.warn('[AdaptiveConfig] Attempted to set null institutionId');
            return;
        }
        this.currentInstitutionId = institutionId;
        _log('[AdaptiveConfig] Institution set to:', institutionId);
    }

    async initialize(institutionId) {
        if (this.initialized && this.currentInstitutionId === institutionId) {
            _log('[AdaptiveConfig] Already initialized for this institution');
            return;
        }

        if (institutionId) {
            this.setInstitution(institutionId);
        }

        await this.loadFromStorage();

        _log('[AdaptiveConfig] Initialized', {
            institutionId: this.currentInstitutionId,
            mappingsLoaded: !!this.mappings,
            unitCount: this.mappings?.unitMappings?.size || 0,
            roomCount: this.mappings?.roomMappings?.size || 0,
            lastSync: this.lastSyncTime ? new Date(this.lastSyncTime).toLocaleString() : 'never'
        });

        this.initialized = true;
        this.notifyListeners();
    }

    /**
     * Rebuild ID-to-code caches.
     * Backend uses 4-digit IDs (e.g. "U0001", "R8000") stored as keys in unitMappings/roomMappings.
     * The BLE payload sends the raw numeric bleId (UInt16BE: 0–7999 for units, 8000–9999 for rooms).
     * We store cache entries keyed by:
     *   - 4-digit zero-padded decimal string (e.g. "0001", "8000")
     *   - hex string with 0x prefix (e.g. "0x0001", "0x1F40")
     */
    rebuildIdToCodeCaches() {
        this.unitIdToCodeCache.clear();
        this.roomIdToCodeCache.clear();

        if (!this.mappings) return;

        // Strip any U/R prefix and parse to a number.
        const parseNumericId = (val) => {
            if (val === undefined || val === null) return NaN;
            if (typeof val === 'number') return val;
            return parseInt(String(val).replace(/^[UR]/i, ''), 10);
        };

        const addToCache = (cache, idVal, rawCode) => {
            const num = parseNumericId(idVal);
            if (!isNaN(num) && rawCode) {
                cache.set(String(num).padStart(PAD_LENGTH, '0'), rawCode);
                cache.set('0x' + num.toString(16).toUpperCase(), rawCode);
            }
        };

        // Build from unitMappings — prefer numericId/bleId, fall back to the map key.
        for (const [key, mapping] of this.mappings.unitMappings.entries()) {
            const rawCode = mapping.rawCode || mapping.displayName;
            if (!rawCode) continue;
            addToCache(this.unitIdToCodeCache, mapping.numericId ?? mapping.bleId ?? key, rawCode);
        }

        // Build from reverseUnit (key = formatted ID like "U0001", value = rawCode)
        for (const [id, code] of this.mappings.reverseUnit.entries()) {
            if (!id || !code) continue;
            addToCache(this.unitIdToCodeCache, id, code);
        }

        // Build from roomMappings — prefer numericId/bleId, fall back to the map key.
        for (const [key, mapping] of this.mappings.roomMappings.entries()) {
            const rawCode = mapping.rawCode || mapping.displayName;
            if (!rawCode) continue;
            addToCache(this.roomIdToCodeCache, mapping.numericId ?? mapping.bleId ?? key, rawCode);
        }

        // Build from reverseRoom (key = formatted ID like "R8000", value = rawCode)
        for (const [id, code] of this.mappings.reverseRoom.entries()) {
            if (!id || !code) continue;
            addToCache(this.roomIdToCodeCache, id, code);
        }

        _log('[AdaptiveConfig] Rebuilt caches:', {
            unitCacheSize: this.unitIdToCodeCache.size,
            roomCacheSize: this.roomIdToCodeCache.size,
        });
    }

    async syncInstitutionMappingsFromBackend(institutionId, token, retryCount = 0) {
        if (!institutionId) throw new Error('No institutionId provided');
        if (this.syncInProgress) {
            _log('[AdaptiveConfig] Sync already in progress, skipping...');
            return false;
        }

        const MAX_RETRIES = 3;
        this.syncInProgress = true;

        try {
            _log(`[AdaptiveConfig] Syncing mappings for institution ${institutionId} (attempt ${retryCount + 1})`);

            const data = await fetchInstitutionMappings(institutionId, token);

            if (!data || typeof data !== 'object') {
                throw new Error('Invalid mappings response from server');
            }

            _log('[AdaptiveConfig] Received mappings:', {
                units: Object.keys(data.unitMappings || {}).length,
                rooms: Object.keys(data.roomMappings || {}).length,
                version: data.version
            });

            const meta = data.metadata || data;
            const needsFullSync = data._meta?.needsFullSync === true;

            if (needsFullSync) {
                // Clear stale v3 AsyncStorage keys and SQLite remote caches
                await AsyncStorage.multiRemove([
                    '@attendance_mappings_v3',
                    '@attendance_last_sync_v3',
                ]).catch(() => {});
                await sqliteStorage.clearRemoteSyncCaches().catch(() => {});
            }

            this.mappings = {
                version: data._meta?.timestamp || data.version || Date.now(),
                unitMappings: new Map(Object.entries(meta.unitMappings || {})),
                roomMappings: new Map(Object.entries(meta.roomMappings || {})),
                reverseUnit: new Map(Object.entries(meta.reverseUnit || {})),
                reverseRoom: new Map(Object.entries(meta.reverseRoom || {})),
                normalizedUnit: new Map(Object.entries(meta.normalizedUnit || {})),
                normalizedRoom: new Map(Object.entries(meta.normalizedRoom || {}))
            };

            this.lastSyncTime = Date.now();
            this.rebuildIdToCodeCaches();
            await this.saveToStorage();
            _log(`[AdaptiveConfig] Sync completed: ${this.mappings.unitMappings.size} units, ${this.mappings.roomMappings.size} rooms`);
            this.notifyListeners();
            return true;

        } catch (error) {
            if (error.message.includes('429') && retryCount < MAX_RETRIES) {
                const delay = Math.pow(2, retryCount) * 2000;
                _log(`[AdaptiveConfig] Rate limited, retrying in ${delay}ms...`);
                this.syncInProgress = false;
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.syncInstitutionMappingsFromBackend(institutionId, token, retryCount + 1);
            }

            // Network failures are expected when offline; handle silently so callers don't
            // need to distinguish – the OfflineBanner in UI already shows the offline state.
            const isNetworkError = error.message && (
                error.message.includes('Network request failed') ||
                error.message.includes('fetch') ||
                error.message.includes('network')
            );
            if (isNetworkError) {
                console.warn('[AdaptiveConfig] Sync skipped (offline):', error.message);
                return false;
            }
            console.error('[AdaptiveConfig] Sync failed:', error.message);
            throw error;
        } finally {
            this.syncInProgress = false;
        }
    }

    async loadFromStorage() {
        if (!this.currentInstitutionId) return;

        try {
            const [mappingsRaw, lastSyncRaw] = await Promise.all([
                AsyncStorage.getItem(STORAGE_KEYS.MAPPINGS(this.currentInstitutionId)),
                AsyncStorage.getItem(STORAGE_KEYS.LAST_SYNC(this.currentInstitutionId))
            ]);

            if (mappingsRaw) {
                const parsed = JSON.parse(mappingsRaw);
                this.mappings = {
                    version: parsed.version,
                    unitMappings: new Map(parsed.unitMappings || []),
                    roomMappings: new Map(parsed.roomMappings || []),
                    reverseUnit: new Map(parsed.reverseUnit || []),
                    reverseRoom: new Map(parsed.reverseRoom || []),
                    normalizedUnit: new Map(parsed.normalizedUnit || []),
                    normalizedRoom: new Map(parsed.normalizedRoom || [])
                };
                _log('[AdaptiveConfig] Loaded mappings from storage:', {
                    institutionId: this.currentInstitutionId,
                    units: this.mappings.unitMappings.size,
                    rooms: this.mappings.roomMappings.size
                });
            }
            this.rebuildIdToCodeCaches();

            if (lastSyncRaw) {
                this.lastSyncTime = parseInt(lastSyncRaw);
            }
        } catch (error) {
            console.error('[AdaptiveConfig] Failed to load from storage:', error);
        }
    }

    async saveToStorage() {
        if (!this.mappings || !this.currentInstitutionId) return;

        try {
            const serializable = {
                version: this.mappings.version,
                unitMappings: Array.from(this.mappings.unitMappings.entries()),
                roomMappings: Array.from(this.mappings.roomMappings.entries()),
                reverseUnit: Array.from(this.mappings.reverseUnit.entries()),
                reverseRoom: Array.from(this.mappings.reverseRoom.entries()),
                normalizedUnit: Array.from(this.mappings.normalizedUnit.entries()),
                normalizedRoom: Array.from(this.mappings.normalizedRoom.entries())
            };

            await Promise.all([
                AsyncStorage.setItem(STORAGE_KEYS.MAPPINGS(this.currentInstitutionId), JSON.stringify(serializable)),
                AsyncStorage.setItem(STORAGE_KEYS.LAST_SYNC(this.currentInstitutionId), String(this.lastSyncTime || ''))
            ]);

            _log('[AdaptiveConfig] Saved mappings to storage:', { institutionId: this.currentInstitutionId });
        } catch (error) {
            console.error('[AdaptiveConfig] Failed to save to storage:', error);
        }
    }

    // ===== CORE LOOKUP METHODS =====

    getUnitId(unitCode) {
        if (!unitCode) {
            console.warn('[AdaptiveConfig] getUnitId: No unit code provided');
            return null;
        }

        if (!this.mappings) {
            console.warn('[AdaptiveConfig] getUnitId: No mappings available');
            return null;
        }

        const normalized = this.normalizeCode(unitCode);

        // Strategy 1: Direct lookup by normalized code via unitMappings
        for (const [, mapping] of this.mappings.unitMappings.entries()) {
            if (mapping.rawCode && this.normalizeCode(mapping.rawCode) === normalized) {
                const id = mapping.numericId ?? mapping.id ?? mapping.bleId;
                if (id !== undefined && id !== null) {
                    // Strip prefix if formatted ID
                    if (typeof id === 'string') {
                        const num = parseInt(id.replace(/^[UR]/i, ''), 10);
                        return isNaN(num) ? null : num;
                    }
                    return typeof id === 'number' ? id : parseInt(id, 10);
                }
            }
        }

        // Strategy 2: Reverse lookup (key = formatted ID, value = rawCode)
        for (const [formattedId, code] of this.mappings.reverseUnit.entries()) {
            if (this.normalizeCode(code) === normalized) {
                const numStr = formattedId.replace(/^[UR]/i, '');
                const num = parseInt(numStr, 10);
                if (!isNaN(num)) return num;
            }
        }

        // Strategy 3: normalizedUnit map (value = rawCode, then look up in unitMappings)
        const canonicalCode = this.mappings.normalizedUnit.get(normalized.toLowerCase())
            || this.mappings.normalizedUnit.get(normalized);
        if (canonicalCode) {
            for (const [, mapping] of this.mappings.unitMappings.entries()) {
                if (mapping.rawCode === canonicalCode) {
                    const id = mapping.numericId ?? mapping.id ?? mapping.bleId;
                    if (id !== undefined && id !== null) {
                        if (typeof id === 'string') {
                            const num = parseInt(id.replace(/^[UR]/i, ''), 10);
                            return isNaN(num) ? null : num;
                        }
                        return typeof id === 'number' ? id : parseInt(id, 10);
                    }
                }
            }
        }

        console.warn(`[AdaptiveConfig] No unit ID found for: ${unitCode} (normalized: ${normalized})`);
        return null;
    }

    getRoomId(roomCode) {
        if (!roomCode) {
            console.warn('[AdaptiveConfig] getRoomId: No room code provided');
            return null;
        }

        if (!this.mappings) {
            console.warn('[AdaptiveConfig] getRoomId: No mappings available');
            return null;
        }

        const normalized = this.normalizeCode(roomCode);

        // Strategy 1: Direct lookup by normalized code via roomMappings
        for (const [, mapping] of this.mappings.roomMappings.entries()) {
            if (mapping.rawCode && this.normalizeCode(mapping.rawCode) === normalized) {
                const id = mapping.numericId ?? mapping.id ?? mapping.bleId;
                if (id !== undefined && id !== null) {
                    if (typeof id === 'string') {
                        const num = parseInt(id.replace(/^[UR]/i, ''), 10);
                        return isNaN(num) ? null : num;
                    }
                    return typeof id === 'number' ? id : parseInt(id, 10);
                }
            }
        }

        // Strategy 2: Reverse lookup
        for (const [formattedId, code] of this.mappings.reverseRoom.entries()) {
            if (this.normalizeCode(code) === normalized) {
                const numStr = formattedId.replace(/^[UR]/i, '');
                const num = parseInt(numStr, 10);
                if (!isNaN(num)) return num;
            }
        }

        // Strategy 3: normalizedRoom map
        const canonicalCode = this.mappings.normalizedRoom.get(normalized)
            || this.mappings.normalizedRoom.get(normalized.toLowerCase());
        if (canonicalCode) {
            for (const [, mapping] of this.mappings.roomMappings.entries()) {
                if (mapping.rawCode === canonicalCode) {
                    const id = mapping.numericId ?? mapping.id ?? mapping.bleId;
                    if (id !== undefined && id !== null) {
                        if (typeof id === 'string') {
                            const num = parseInt(id.replace(/^[UR]/i, ''), 10);
                            return isNaN(num) ? null : num;
                        }
                        return typeof id === 'number' ? id : parseInt(id, 10);
                    }
                }
            }
        }

        console.warn(`[AdaptiveConfig] No room ID found for: ${roomCode} (normalized: ${normalized})`);
        return null;
    }

    /**
     * Get unit code from numeric BLE ID.
     * The BLE payload sends a raw numeric UInt16 ID (0–7999 for units).
     */
    getUnitCodeFromId(unitId) {
        if (unitId === undefined || unitId === null) {
            console.warn('[AdaptiveConfig] getUnitCodeFromId: No ID provided');
            return null;
        }
        if (!this.mappings) {
            console.warn('[AdaptiveConfig] getUnitCodeFromId: No mappings available');
            return null;
        }

        // Normalize to number
        let num;
        if (typeof unitId === 'string' && unitId.startsWith('0x')) {
            num = parseInt(unitId, 16);
        } else {
            num = typeof unitId === 'number' ? unitId : parseInt(unitId, 10);
        }

        if (isNaN(num)) {
            console.warn(`[AdaptiveConfig] getUnitCodeFromId: Invalid ID: ${unitId}`);
            return null;
        }

        const paddedKey = String(num).padStart(PAD_LENGTH, '0');
        if (this.unitIdToCodeCache.has(paddedKey)) return this.unitIdToCodeCache.get(paddedKey);

        const hexKey = '0x' + num.toString(16).toUpperCase();
        if (this.unitIdToCodeCache.has(hexKey)) return this.unitIdToCodeCache.get(hexKey);

        // Cache miss — scan maps directly (handles cold cache or unusual mapping shapes).
        for (const k of [paddedKey, 'U' + paddedKey, String(num), 'U' + num]) {
            const mapping = this.mappings.unitMappings.get(k);
            if (mapping) {
                const code = mapping.rawCode || mapping.displayName;
                if (code) { this.unitIdToCodeCache.set(paddedKey, code); return code; }
            }
            const rev = this.mappings.reverseUnit.get(k);
            if (rev) { this.unitIdToCodeCache.set(paddedKey, rev); return rev; }
        }

        console.warn(`[AdaptiveConfig] No unit code found for ID: ${unitId} (num=${num}, key=${paddedKey})`);
        return null;
    }

    /**
     * Get room code from numeric BLE ID.
     * The BLE payload sends a raw numeric UInt16 ID (8000–9999 for rooms).
     * Accepts: number, decimal string, or hex string (e.g. "0x1F40").
     */
    getRoomCodeFromId(roomId) {
        if (roomId === undefined || roomId === null) {
            console.warn('[AdaptiveConfig] getRoomCodeFromId: No ID provided');
            return null;
        }
        if (!this.mappings) {
            console.warn('[AdaptiveConfig] getRoomCodeFromId: No mappings available');
            return null;
        }

        // Normalize to number
        let num;
        if (typeof roomId === 'string' && roomId.startsWith('0x')) {
            num = parseInt(roomId, 16);
        } else {
            num = typeof roomId === 'number' ? roomId : parseInt(roomId, 10);
        }

        if (isNaN(num)) {
            console.warn(`[AdaptiveConfig] getRoomCodeFromId: Invalid ID: ${roomId}`);
            return null;
        }

        const paddedKey = String(num).padStart(PAD_LENGTH, '0');
        if (this.roomIdToCodeCache.has(paddedKey)) return this.roomIdToCodeCache.get(paddedKey);

        const hexKey = '0x' + num.toString(16).toUpperCase();
        if (this.roomIdToCodeCache.has(hexKey)) return this.roomIdToCodeCache.get(hexKey);

        // Cache miss — scan maps directly (handles cold cache or unusual mapping shapes).
        for (const k of [paddedKey, 'R' + paddedKey, String(num), 'R' + num]) {
            const mapping = this.mappings.roomMappings.get(k);
            if (mapping) {
                const code = mapping.rawCode || mapping.displayName;
                if (code) { this.roomIdToCodeCache.set(paddedKey, code); return code; }
            }
            const rev = this.mappings.reverseRoom.get(k);
            if (rev) { this.roomIdToCodeCache.set(paddedKey, rev); return rev; }
        }

        console.warn(`[AdaptiveConfig] No room code found for ID: ${roomId} (num=${num}, key=${paddedKey})`);
        return null;
    }

    getUnitDisplayName(unitCode) {
        if (!unitCode) return unitCode;
        if (!this.mappings) return this.formatUnitCode(unitCode);

        const normalized = this.normalizeCode(unitCode);

        for (const [, mapping] of this.mappings.unitMappings.entries()) {
            if (mapping.rawCode && this.normalizeCode(mapping.rawCode) === normalized) {
                return mapping.displayName || mapping.rawCode;
            }
        }

        return this.formatUnitCode(unitCode);
    }

    getRoomDisplayName(roomCode) {
        if (!roomCode) return roomCode;
        if (!this.mappings) return this.formatRoomCode(roomCode);

        const normalized = this.normalizeCode(roomCode);

        for (const [, mapping] of this.mappings.roomMappings.entries()) {
            if (mapping.rawCode && this.normalizeCode(mapping.rawCode) === normalized) {
                return mapping.displayName || mapping.rawCode;
            }
        }

        return this.formatRoomCode(roomCode);
    }

    getAllUnits() {
        if (!this.mappings) return [];

        const units = [];
        for (const [, mapping] of this.mappings.unitMappings.entries()) {
            if (mapping && mapping.rawCode) {
                units.push({
                    id: mapping.numericId ?? mapping.id ?? mapping.bleId,
                    code: mapping.rawCode,
                    display: mapping.displayName && mapping.displayName !== mapping.rawCode
                        ? `${mapping.rawCode} (${mapping.displayName})`
                        : mapping.displayName || mapping.rawCode,
                    displayName: mapping.displayName || mapping.rawCode,
                    rawCode: mapping.rawCode
                });
            }
        }
        return units.sort((a, b) => a.display.localeCompare(b.display));
    }

    getAllRooms() {
        if (!this.mappings) return [];

        const rooms = [];
        for (const [, mapping] of this.mappings.roomMappings.entries()) {
            if (mapping && mapping.rawCode) {
                rooms.push({
                    id: mapping.numericId ?? mapping.id ?? mapping.bleId,
                    roomCode: mapping.rawCode,
                    display: mapping.displayName || mapping.rawCode,
                    displayName: mapping.displayName || mapping.rawCode,
                    building: mapping.building,
                    floor: mapping.floor,
                    rawCode: mapping.rawCode
                });
            }
        }
        return rooms.sort((a, b) => a.display.localeCompare(b.display));
    }

    getStats() {
        if (!this.mappings) {
            return {
                unitCount: 0,
                roomCount: 0,
                lastSync: this.lastSyncTime,
                version: null
            };
        }

        return {
            unitCount: this.mappings.unitMappings.size,
            roomCount: this.mappings.roomMappings.size,
            lastSync: this.lastSyncTime,
            version: this.mappings.version
        };
    }

    async clearMappings() {
        const institutionId = this.currentInstitutionId;
        this.mappings = null;
        this.lastSyncTime = null;
        this.unitIdToCodeCache.clear();
        this.roomIdToCodeCache.clear();
        if (institutionId) {
            await AsyncStorage.removeItem(STORAGE_KEYS.MAPPINGS(institutionId));
            await AsyncStorage.removeItem(STORAGE_KEYS.LAST_SYNC(institutionId));
        }
        // Also remove legacy keys in case the app is migrating from an earlier version.
        await AsyncStorage.removeItem('@attendance_mappings_v4').catch(() => {});
        await AsyncStorage.removeItem('@attendance_last_sync_v4').catch(() => {});
        _log('[AdaptiveConfig] Cleared all mappings');
        this.notifyListeners();
    }

    // ===== UTILITY METHODS =====

    normalizeCode(code) {
        if (!code) return '';
        return String(code)
            .toUpperCase()
            .replace(/\s+/g, '')
            .replace(/[^A-Z0-9]/g, '');
    }

    formatUnitCode(code) {
        if (!code) return code;
        if (code.includes(' ')) return code;
        const spaceMatch = code.match(/^([A-Za-z]+)(\d+.*)$/);
        if (spaceMatch) {
            return `${spaceMatch[1]} ${spaceMatch[2]}`;
        }
        return code;
    }

    formatRoomCode(code) {
        return this.formatUnitCode(code);
    }

    async getCurrentSession() {
        try {
            let session = await getLecturerSession();
            if (session && session.token) return session;
            session = await getStudentSession();
            if (session && session.token) return session;
            return null;
        } catch (err) {
            console.warn('[AdaptiveConfig] Failed to get session:', err);
            return null;
        }
    }
}

// Singleton instance
export const adaptiveConfig = new AdaptiveAttendanceConfig();

/**
 * Inject a single unit+room mapping pair received in a delegation FCM notification.
 * Populates adaptiveConfig on the group leader's device without needing a full
 * institution mapping sync, so BLE broadcasts use the correct IDs immediately.
 *
 * FCM data values are always strings — this method handles Number() conversion.
 *
 * @param {object} params
 * @param {string} params.institutionId
 * @param {string} params.unitCode  e.g. "CS301"
 * @param {string|number} params.unitId   BLE numeric ID e.g. "5" or 5
 * @param {string} params.roomCode  e.g. "LAB4"
 * @param {string|number} params.roomId   BLE numeric ID e.g. "8003" or 8003
 */
export function injectDelegationMappings({ institutionId, unitCode, unitId, roomCode, roomId }) {
    const uId = Number(unitId);
    const rId = Number(roomId);

    const hasValidUnit = unitCode && !isNaN(uId) && uId > 0;
    const hasValidRoom = roomCode && !isNaN(rId) && rId > 0;

    if (!hasValidUnit && !hasValidRoom) {
        console.warn('[AdaptiveConfig] injectDelegationMappings: no valid IDs to inject', { unitCode, unitId, roomCode, roomId });
        return;
    }

    // Ensure a mappings shell exists so getRoomId / getRoomCodeFromId work immediately.
    if (!adaptiveConfig.mappings) {
        adaptiveConfig.mappings = {
            version: Date.now(),
            unitMappings: new Map(),
            roomMappings: new Map(),
            reverseUnit: new Map(),
            reverseRoom: new Map(),
            normalizedUnit: new Map(),
            normalizedRoom: new Map(),
        };
    }

    if (institutionId && !adaptiveConfig.currentInstitutionId) {
        adaptiveConfig.currentInstitutionId = institutionId;
    }

    if (hasValidUnit) {
        const key = String(uId).padStart(PAD_LENGTH, '0');
        adaptiveConfig.mappings.unitMappings.set(key, { rawCode: unitCode, numericId: uId });
        adaptiveConfig.mappings.reverseUnit.set('U' + key, unitCode);
        adaptiveConfig.mappings.normalizedUnit.set(unitCode.toLowerCase(), unitCode);
    }

    if (hasValidRoom) {
        const key = String(rId).padStart(PAD_LENGTH, '0');
        adaptiveConfig.mappings.roomMappings.set(key, { rawCode: roomCode, numericId: rId });
        adaptiveConfig.mappings.reverseRoom.set('R' + key, roomCode);
        adaptiveConfig.mappings.normalizedRoom.set(roomCode.toLowerCase(), roomCode);
    }

    adaptiveConfig.rebuildIdToCodeCaches();
    // Persist silently so the mapping survives app restarts.
    adaptiveConfig.saveToStorage().catch(() => {});

    _log(
        `[AdaptiveConfig] Injected delegation mapping: ${unitCode}\u2192BLE ${uId}, ${roomCode}\u2192BLE ${rId}`,
    );
}

// React hook for using adaptive attendance
export const useAdaptiveAttendance = () => {
    const [units, setUnits] = useState([]);
    const [rooms, setRooms] = useState([]);
    // Start as already-loaded if the singleton was initialized in a previous render cycle.
    // Prevents the full-screen loading flash on every re-mount when mappings are cached.
    const [isLoading, setIsLoading] = useState(() => !adaptiveConfig.initialized);
    const [lastSync, setLastSync] = useState(null);
    const [error, setError] = useState(null);
    const [stats, setStats] = useState(null);

    useEffect(() => {
        let mounted = true;
        let unsubscribe;

        const updateState = () => {
            if (!mounted) return;
            setUnits(adaptiveConfig.getAllUnits());
            setRooms(adaptiveConfig.getAllRooms());
            setLastSync(adaptiveConfig.lastSyncTime);
            setStats(adaptiveConfig.getStats());
        };

        const init = async () => {
            try {
                const session = await adaptiveConfig.getCurrentSession();
                await adaptiveConfig.initialize(session?.institutionId);

                if (mounted) {
                    updateState();
                    setIsLoading(false);
                }
            } catch (err) {
                console.error('[useAdaptiveAttendance] Init error:', err);
                if (mounted) {
                    setError(err.message);
                    setIsLoading(false);
                }
            }
        };

        init();

        unsubscribe = adaptiveConfig.addListener(updateState);

        return () => {
            mounted = false;
            if (unsubscribe) unsubscribe();
        };
    }, []);

    const refresh = async () => {
        setIsLoading(true);
        setError(null);

        try {
            const session = await adaptiveConfig.getCurrentSession();
            if (session?.institutionId && session?.token) {
                await adaptiveConfig.syncInstitutionMappingsFromBackend(session.institutionId, session.token);
            }

            setUnits(adaptiveConfig.getAllUnits());
            setRooms(adaptiveConfig.getAllRooms());
            setLastSync(adaptiveConfig.lastSyncTime);
            setStats(adaptiveConfig.getStats());
        } catch (err) {
            console.error('[useAdaptiveAttendance] Refresh error:', err);
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    };

    const debugMappings = () => {
        if (!__DEV__) return;
        _log('=== ADAPTIVE CONFIG DEBUG ===');
        _log('Institution ID:', adaptiveConfig.currentInstitutionId);
        _log('Initialized:', adaptiveConfig.initialized);
        _log('Last Sync:', adaptiveConfig.lastSyncTime ? new Date(adaptiveConfig.lastSyncTime).toLocaleString() : 'Never');
        _log('Mappings exist:', !!adaptiveConfig.mappings);
        if (adaptiveConfig.mappings) {
            _log('Units:', adaptiveConfig.mappings.unitMappings.size);
            _log('Rooms:', adaptiveConfig.mappings.roomMappings.size);
            _log('Version:', adaptiveConfig.mappings.version);
            _log('--- UNITS ---');
            adaptiveConfig.getAllUnits().forEach(u => {
                const id = adaptiveConfig.getUnitId(u.code);
                _log(`  ${u.code} -> ID: ${id != null ? `${id} (0x${id.toString(16).toUpperCase()})` : 'NOT FOUND'}`);
            });
            _log('--- ROOMS ---');
            adaptiveConfig.getAllRooms().forEach(r => {
                const id = adaptiveConfig.getRoomId(r.roomCode);
                _log(`  ${r.roomCode} -> ID: ${id != null ? `${id} (0x${id.toString(16).toUpperCase()})` : 'NOT FOUND'}`);
            });
        }
        _log('============================');
    };

    const getUnitId = React.useCallback(adaptiveConfig.getUnitId.bind(adaptiveConfig), []);
    const getRoomId = React.useCallback(adaptiveConfig.getRoomId.bind(adaptiveConfig), []);

    return {
        units,
        rooms,
        isLoading,
        lastSync,
        error,
        stats,
        refresh,
        debugMappings,
        getUnitId,
        getRoomId,
        getUnitCodeFromId: adaptiveConfig.getUnitCodeFromId.bind(adaptiveConfig),
        getRoomCodeFromId: adaptiveConfig.getRoomCodeFromId.bind(adaptiveConfig),
        getUnitDisplayName: adaptiveConfig.getUnitDisplayName.bind(adaptiveConfig),
        getRoomDisplayName: adaptiveConfig.getRoomDisplayName.bind(adaptiveConfig),
        normalizeCode: adaptiveConfig.normalizeCode.bind(adaptiveConfig),
        formatUnitCode: adaptiveConfig.formatUnitCode.bind(adaptiveConfig),
        formatRoomCode: adaptiveConfig.formatRoomCode.bind(adaptiveConfig)
    };
};