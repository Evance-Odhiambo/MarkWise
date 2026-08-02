import './global.css';
import React, { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import {
  StatusBar, View, ActivityIndicator, Text,
  TouchableOpacity, StyleSheet, NativeModules, Vibration,
} from 'react-native';
import { adaptiveConfig, injectDelegationMappings } from './src/utils/adaptiveAttendanceConfig';
import { getLecturerSession, getStudentSession } from './src/utils/authSession';
import {
  setupNotificationChannels,
  requestNotificationPermission,
  displayLocalNotification,
  getChannelForType,
} from './src/utils/notificationService';
import {
  emitTimetableUpdated,
  emitNotificationReceived,
  isTimetableType,
} from './src/utils/notificationEventBus';
import { invalidateLecturerTimetableCache } from './src/utils/lecturerTimetableApi';
import RootNavigator from './src/navigation/RootNavigator';
import { EnrollmentProvider } from './src/context/EnrollmentContext';
import { AuthProvider } from './src/context/AuthContext';
import { ThemeProvider } from './src/theme';
import sqliteStorage from './src/storage/sqliteStorage';

// ── Global error boundary ────────────────────────────────────────────────────
class GlobalErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(_error, _info) {}

  handleReset = () => this.setState({ hasError: false, error: null });

  render() {
    if (this.state.hasError) {
      return (
        <View style={errStyles.container}>
          <Text style={errStyles.title}>Something went wrong</Text>
          <Text style={errStyles.message}>
            {__DEV__
              ? this.state.error?.message
              : 'An unexpected error occurred. Please restart the app.'}
          </Text>
          <TouchableOpacity
            style={errStyles.btn}
            onPress={this.handleReset}
            accessibilityRole="button"
            accessibilityLabel="Try again"
          >
            <Text style={errStyles.btnText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const errStyles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F8FAFC', padding: 24 },
  title: { color: '#EF4444', fontSize: 20, fontWeight: '700', marginBottom: 12 },
  message: { color: '#64748B', textAlign: 'center', fontSize: 14, lineHeight: 22, marginBottom: 28 },
  btn: { backgroundColor: '#10B981', paddingVertical: 12, paddingHorizontal: 32, borderRadius: 10 },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
});

// ── Deep link config ─────────────────────────────────────────────────────────
const linking = {
  prefixes: ['markwise://'],
  config: {
    screens: {
      OnlineMarker: {
        path: 'attend',
        parse: { session: (v) => v },
      },
    },
  },
};

// ── Root app component ───────────────────────────────────────────────────────
function App() {
  const [isInitializing, setIsInitializing] = useState(true);
  const [initError, setInitError] = useState(null);

  // Set up notification channels and request permission on first launch.
  useEffect(() => {
    setupNotificationChannels();
    requestNotificationPermission();
  }, []);

  // FCM message handler — save to SQLite so AlertsScreen can display them,
  // then surface a heads-up notification (with custom sound) via notifee.
  // Guarded: only runs when the native Firebase module is linked.
  useEffect(() => {
    if (!NativeModules.RNFBAppModule) return;
    let unsubscribeForeground;
    (async () => {
      try {
        const {
          getMessaging,
          onMessage,
          getInitialNotification,
          onNotificationOpenedApp,
        } = require('@react-native-firebase/messaging');
        const messagingInstance = getMessaging();

        // Helper: persist to SQLite and play sound via notifee.
        // Achievement badges are detected and notified entirely in-app (AchievementsScreen)
        // so FCM achievement messages are ignored here — they would race and duplicate.
        const handleMessage = async (remoteMessage) => {
          const { messageId, notification, data } = remoteMessage;

          // Achievements are handled exclusively by AchievementsScreen in-app detection.
          if (data?.type === 'achievement') return;

          const title = notification?.title || data?.title || 'New notification';
          const body  = notification?.body  || data?.body  || null;

          // Prefer the backend-assigned notificationId so this row can be
          // matched against the inbox seed and the dismiss sync endpoint.
          const wasNew = await sqliteStorage.savePushNotification({
            id: data?.notificationId || messageId || `${Date.now()}`,
            type: data?.type || 'general',
            title,
            body,
            data,
          });

          // Skip if duplicate FCM delivery.
          if (!wasNew) return;

          if (data?.type === 'delegation') {
            try { injectDelegationMappings(data); } catch (_) {}
          }

          // Timetable-type FCM: invalidate the lecturer cache so the next load
          // always gets fresh data, then signal mounted screens to reload now.
          if (isTimetableType(data?.type)) {
            invalidateLecturerTimetableCache().catch(() => {});
            emitTimetableUpdated({ type: data?.type });
          }

          // Signal AlertsScreen / notification-aware screens to refresh.
          emitNotificationReceived({ type: data?.type });

          // Vibrate and display heads-up banner only for genuinely new messages.
          Vibration.vibrate([0, 200, 80, 200]);

          await displayLocalNotification({
            title,
            body: body || '',
            channelId: getChannelForType(data?.type),
            data: data || {},
          });
        };

        // Foreground messages (app open)
        unsubscribeForeground = onMessage(messagingInstance, handleMessage);

        // Background/quit tap — app opened via notification
        const initial = await getInitialNotification(messagingInstance);
        if (initial) {
          const { messageId, notification, data } = initial;
          if (data?.type !== 'achievement') {
            await sqliteStorage.savePushNotification({
              id: data?.notificationId || messageId || `${Date.now()}`,
              type: data?.type || 'general',
              title: notification?.title || data?.title || 'New notification',
              body: notification?.body || data?.body || null,
              data,
            });
            if (data?.type === 'delegation') {
              try { injectDelegationMappings(data); } catch (_) {}
            }
          }
        }

        // Background message opened (app in background, user taps notification)
        onNotificationOpenedApp(messagingInstance, async (remoteMessage) => {
          const { messageId, notification, data } = remoteMessage;
          if (data?.type === 'achievement') return;
          await sqliteStorage.savePushNotification({
            id: data?.notificationId || messageId || `${Date.now()}`,
            type: data?.type || 'general',
            title: notification?.title || data?.title || 'New notification',
            body: notification?.body || data?.body || null,
            data,
          });
          if (data?.type === 'delegation') {
            try { injectDelegationMappings(data); } catch (_) {}
          }
        });
      } catch (_) {}
    })();
    return () => { if (unsubscribeForeground) unsubscribeForeground(); };
  }, []);

  useEffect(() => {
    const initializeApp = async () => {
      try {
        // Initialize SQLite first so all subsequent DB operations find tables ready.
        await sqliteStorage.initDatabase();

        let session = await getLecturerSession();
        if (!session) {
          session = await getStudentSession();
        }

        if (session?.institutionId) {
          await adaptiveConfig.initialize(session.institutionId);
          if (session.token) {
            setTimeout(() => {
              adaptiveConfig.syncInstitutionMappingsFromBackend(session.institutionId, session.token)
                .catch(err => console.warn('[App] Background sync failed:', err.message));
            }, 2000);
          }
        }

        setIsInitializing(false);

        // Drain any records that were queued while offline before this launch,
        // and seed the notification inbox so AlertsScreen is populated on any device.
        if (session?.token) {
          setTimeout(() => {
            const { syncPendingAttendance } = require('./src/utils/offlineAttendanceApi');
            syncPendingAttendance().catch(() => {});

            const { seedNotificationInbox } = require('./src/utils/notificationsInboxApi');
            seedNotificationInbox().catch(() => {});
          }, 4000);
        }
      } catch (error) {
        console.error('[App] Init error:', error);
        setInitError(error.message);
        setIsInitializing(false);
      }
    };

    initializeApp();
  }, []);

  if (isInitializing) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F8FAFC' }}>
        <ActivityIndicator size="large" color="#10B981" />
        <Text style={{ marginTop: 16, color: '#64748B' }}>Loading MarkWise...</Text>
      </View>
    );
  }

  if (initError) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F8FAFC', padding: 20 }}>
        <Text style={{ color: '#EF4444', fontSize: 18, fontWeight: '600', marginBottom: 10 }}>Initialization Error</Text>
        <Text style={{ color: '#64748B', textAlign: 'center' }}>{initError}</Text>
        <Text style={{ color: '#10B981', marginTop: 20 }}>Please restart the app</Text>
      </View>
    );
  }

  return (
    <GlobalErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <ThemeProvider>
            <AuthProvider>
              <EnrollmentProvider>
                <NavigationContainer linking={linking}>
                  <StatusBar barStyle="dark-content" backgroundColor="#F8FAFC" />
                  <RootNavigator />
                </NavigationContainer>
              </EnrollmentProvider>
            </AuthProvider>
          </ThemeProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </GlobalErrorBoundary>
  );
}

export default App;
