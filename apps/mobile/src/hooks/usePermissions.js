import { useState, useEffect } from 'react';
import { PermissionsAndroid, Platform, Linking, NativeModules } from 'react-native';

const usePermissions = () => {
    const [hasPermission, setHasPermission] = useState(null);

    useEffect(() => {
        const requestCameraPermission = async () => {
            if (Platform.OS === 'android') {
                try {
                    const granted = await PermissionsAndroid.request(
                        PermissionsAndroid.PERMISSIONS.CAMERA,
                        {
                            title: 'Camera Permission',
                            message: 'MarkWise needs camera access to scan QR codes for attendance.',
                            buttonNeutral: 'Ask Me Later',
                            buttonNegative: 'Cancel',
                            buttonPositive: 'OK',
                        },
                    );
                    setHasPermission(granted === PermissionsAndroid.RESULTS.GRANTED);
                } catch (err) {
                    console.warn(err);
                    setHasPermission(false);
                }
            } else {
                // iOS: the native MLKitCameraView calls AVCaptureDevice.requestAccess when the
                // camera view is mounted, which triggers the system prompt automatically.
                // We optimistically allow the view to render; if the user denies it the camera
                // view stays blank and openSettings() directs them to Settings.
                setHasPermission(true);
            }
        };

        requestCameraPermission();
    }, []);

    const openSettings = () => {
        Linking.openSettings();
    };

    return { hasPermission, openSettings };
};

export default usePermissions;
