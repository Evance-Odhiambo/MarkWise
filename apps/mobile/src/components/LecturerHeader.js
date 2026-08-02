import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { View, Text, TouchableOpacity, Animated } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import sqliteStorage from '../storage/sqliteStorage';
import { getLecturerSession } from '../utils/authSession';

const GREETINGS = [
  { start: 5, end: 12, text: 'Good morning', icon: 'weather-sunny' },
  { start: 12, end: 17, text: 'Good afternoon', icon: 'white-balance-sunny' },
  { start: 17, end: 21, text: 'Good evening', icon: 'weather-sunset-down' },
  { start: 21, end: 5, text: 'Good night', icon: 'weather-night' },
];

const getGreeting = (hour) => GREETINGS.find(g => hour >= g.start && hour < g.end) || GREETINGS[3];

export default function LecturerHeader({ navigation }) {
  const insets = useSafeAreaInsets();
  const [unreadCount, setUnreadCount] = useState(0);
  const [fullName, setFullName] = useState('');
  const [isLoadingName, setIsLoadingName] = useState(true);

  const badgeScale = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const prevCountRef = useRef(0);
  const now = useMemo(() => new Date(), []);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
    ]).start();
  }, []);

  const refreshBadge = useCallback(async () => {
    try {
      const count = await sqliteStorage.getUnreadNotificationCount();
      setUnreadCount(count);
    } catch (_) {}
  }, []);

  useEffect(() => {
    refreshBadge();
    const unsub = navigation?.addListener?.('state', refreshBadge);
    return () => unsub?.();
  }, [navigation, refreshBadge]);

  useEffect(() => {
    getLecturerSession()
      .then(s => {
        const name = s?.lecturerName || '';
        setFullName(name);
        setIsLoadingName(false);
      })
      .catch(() => setIsLoadingName(false));
  }, []);

  useEffect(() => {
    if (unreadCount > 0 && prevCountRef.current === 0) {
      Animated.spring(badgeScale, { toValue: 1, tension: 300, friction: 12, useNativeDriver: true }).start();
    } else if (unreadCount === 0 && prevCountRef.current > 0) {
      Animated.timing(badgeScale, { toValue: 0, duration: 200, useNativeDriver: true }).start();
    }
    prevCountRef.current = unreadCount;
  }, [unreadCount, badgeScale]);

  const greeting = getGreeting(now.getHours());
  const displayName = isLoadingName ? 'Lecturer' : (fullName || 'Lecturer');
  const initial = displayName ? displayName.charAt(0).toUpperCase() : '?';

  const openDrawer = () => navigation?.dispatch?.({ type: 'OPEN_DRAWER' });
  const openNotifications = () => navigation?.navigate?.('Notifications');

  return (
    <Animated.View style={{ opacity: fadeAnim }}>
      <LinearGradient colors={['#064E3B', '#065F46', '#047857']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} className="relative overflow-hidden rounded-b-3xl">
        {/* Decorative orbs */}
        <View className="absolute w-[180px] h-[180px] rounded-full -top-10 -right-10 bg-white/5" />
        <View className="absolute w-[120px] h-[120px] rounded-full -bottom-10 -left-10 bg-white/5" />

        <View style={{ paddingTop: insets.top }} className="px-5 pt-4 pb-4">
          {/* Top row: menu | name | bell */}
          <View className="flex-row items-center">
            <TouchableOpacity
              className="w-10 h-10 rounded-full items-center justify-center bg-white/15"
              onPress={openDrawer}
              activeOpacity={0.7}
            >
              <Icon name="menu" size={22} color="#FFFFFF" />
            </TouchableOpacity>

            <View className="flex-1 items-center mx-4">
              <Text className="text-lg font-bold text-white tracking-tight" numberOfLines={1}>{displayName}</Text>
            </View>

            <TouchableOpacity
              className="w-10 h-10 rounded-full items-center justify-center bg-white/15 relative"
              onPress={openNotifications}
              activeOpacity={0.7}
            >
              <Icon name="bell-outline" size={22} color="#FFFFFF" />
              {unreadCount > 0 && (
                <Animated.View
                  className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full items-center justify-center bg-red500 border-2 border-emerald900 px-1"
                  style={{ transform: [{ scale: badgeScale }] }}
                >
                  <Text className="text-[9px] font-extrabold text-white leading-[11px]">{unreadCount > 9 ? '9+' : unreadCount}</Text>
                </Animated.View>
              )}
            </TouchableOpacity>
          </View>

          {/* Greeting row */}
          <View className="flex-row items-center justify-center gap-2 mt-2.5">
            <View className="w-7 h-7 rounded-full items-center justify-center bg-white/15">
              <Icon name={greeting.icon} size={15} color="#FBBF24" />
            </View>
            <Text className="text-sm font-semibold text-white/90">{greeting.text}</Text>
          </View>
        </View>

        {/* Bottom separator */}
        <View className="h-px bg-white/12 mx-5" />
      </LinearGradient>
    </Animated.View>
  );
}
