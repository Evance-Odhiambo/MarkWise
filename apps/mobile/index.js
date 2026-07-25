// Silence React Native Firebase v21→v22 modular-API deprecation warnings.
// Must be set before any Firebase module is imported or required.
globalThis.RNFB_SILENCE_MODULAR_DEPRECATION_WARNINGS = true;

import 'react-native-gesture-handler';
import { AppRegistry, NativeModules } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

// Stop any background BLE task that survived a process restart so we don't
// start with a phantom foreground-service notification on Android.
try {
    const BackgroundActions = require('react-native-background-actions').default;
    BackgroundActions.stop().catch(() => {});
} catch {}

// Background / killed-state FCM handler — must be registered at JS module level.
// Guarded so the app still launches when Firebase native module is not yet linked.
if (NativeModules.RNFBAppModule) {
  const { getMessaging, setBackgroundMessageHandler } =
    require('@react-native-firebase/messaging');

  setBackgroundMessageHandler(getMessaging(), async (remoteMessage) => {
    try {
      const sqliteStorage = require('./src/storage/sqliteStorage').default;
      const { messageId, notification, data } = remoteMessage;
      const title = notification?.title || data?.title || 'New notification';
      const body  = notification?.body  || data?.body  || null;

      await sqliteStorage.savePushNotification({
        id: messageId || String(Date.now()),
        type: data?.type || 'general',
        title,
        body,
        data,
      });

      // Pre-fill BLE mappings so the leader can broadcast immediately without
      // a separate institution sync.
      if (data?.type === 'delegation') {
        const { injectDelegationMappings } = require('./src/utils/adaptiveAttendanceConfig');
        injectDelegationMappings(data);
      }

      // Mark timetable as dirty so screens force-refresh when app returns to foreground.
      // DeviceEventEmitter won't work here (JS component tree not mounted).
      try {
        const { isTimetableType, setTimetableDirty } = require('./src/utils/notificationEventBus');
        if (isTimetableType(data?.type)) {
          setTimetableDirty();
        }
      } catch (_) {}

      // For data-only FCM messages (no notification field), Android won't
      // auto-display them — surface via notifee so the custom channel sound plays.
      // Notification messages are auto-shown by Android OS; skip to avoid duplicates.
      if (!notification) {
        const notifee = require('react-native-notify-kit').default;
        const { getChannelForType } = require('./src/utils/notificationService');
        await notifee.displayNotification({
          title,
          body: body || '',
          data: data || {},
          android: {
            channelId:   getChannelForType(data?.type),
            smallIcon:   'ic_launcher',
            pressAction: { id: 'default' },
          },
          ios: { sound: 'default' },
        });
      }
    } catch (_) {}
  });

  // Handle background/killed-state press events from notifee notifications
  try {
    const { EventType } = require('react-native-notify-kit');
    const notifee = require('react-native-notify-kit').default;
    notifee.onBackgroundEvent(async ({ type }) => {
      if (type === EventType.PRESS) {
        // App will open naturally; navigation is handled in the foreground
      }
    });
  } catch (_) {}
}

AppRegistry.registerComponent(appName, () => App);
