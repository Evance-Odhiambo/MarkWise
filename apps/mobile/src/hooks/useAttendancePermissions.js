/**
 * useAttendancePermissions
 *
 * Requests all permissions required for offline attendance (QR scanning + BLE)
 * in a single pass on first install. Called once from RootNavigator on app boot.
 *
 * Android: CAMERA, BLUETOOTH_SCAN, BLUETOOTH_CONNECT, BLUETOOTH_ADVERTISE (API 31+),
 *          ACCESS_FINE_LOCATION (pre-31 fallback for BLE scanning)
 * iOS:     Camera via AVCaptureDevice.requestAccess — handled natively by MLKitCameraView
 *          when the camera view is first mounted. Bluetooth is auto-prompted by
 *          CBCentralManager / CBPeripheralManager when they are initialised.
 *          No JS-side request is needed or possible on iOS.
 */
import { useEffect, useRef } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';

const ALREADY_REQUESTED_KEY = '__markwise_attendance_perms_requested__';

// In-memory guard so the hook is idempotent across remounts in the same process.
let _requested = false;

const useAttendancePermissions = () => {
    const mounted = useRef(true);

    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);

    useEffect(() => {
        if (Platform.OS !== 'android') return;
        if (_requested) return;
        _requested = true;

        (async () => {
            try {
                const apiLevel = Platform.Version;

                if (apiLevel >= 31) {
                    // Android 12+ — request BLE permissions directly.
                    // CAMERA must be requested separately (different permission group).
                    await PermissionsAndroid.requestMultiple([
                        PermissionsAndroid.PERMISSIONS.CAMERA,
                        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
                        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
                        PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
                    ]);
                } else {
                    // Android < 12 — BLE scanning requires location permission.
                    await PermissionsAndroid.requestMultiple([
                        PermissionsAndroid.PERMISSIONS.CAMERA,
                        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
                    ]);
                }
            } catch (e) {
                // Non-fatal; individual features fall back to their own permission checks.
                console.warn('[AttendancePermissions] Failed to request permissions:', e.message);
            }
        })();
    }, []);
};

export default useAttendancePermissions;
