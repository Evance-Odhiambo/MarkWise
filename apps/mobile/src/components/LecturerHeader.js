import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  StatusBar,
  Animated, 
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import sqliteStorage from '../storage/sqliteStorage';
import { getLecturerSession } from '../utils/authSession';
import colors from '../theme/colors';

const STATUSBAR_HEIGHT = Platform.OS === 'ios' ? 44 : (StatusBar.currentHeight ?? 24);
const HEADER_TOTAL_HEIGHT = STATUSBAR_HEIGHT + 72;

// Design constants
const DESIGN = {
  headerHeight: HEADER_TOTAL_HEIGHT,
  avatarSize: 44,
  iconSize: 20,
  badgeSize: 18,
  borderRadius: {
    button: 14,
    avatar: 22,
    badge: 9,
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
  },
};

// Gradient colors for header — driven by the primary brand token
const GRADIENT_COLORS = {
  start:        colors.primary.gradient[0],  // indigo-600
  end:          colors.primary.gradient[1],  // purple-600
  overlayStart: 'rgba(255,255,255,0.08)',
  overlayEnd:   'rgba(255,255,255,0)',
};

// Greeting configuration
const GREETINGS = [
  { start: 5, end: 12, text: 'Good morning', icon: 'weather-sunny', iconColor: '#FBBF24' },
  { start: 12, end: 17, text: 'Good afternoon', icon: 'white-balance-sunny', iconColor: '#F97316' },
  { start: 17, end: 21, text: 'Good evening', icon: 'weather-sunset-down', iconColor: '#FB923C' },
  { start: 21, end: 5, text: 'Good night', icon: 'weather-night', iconColor: '#A5B4FC' },
];

function getGreeting(hour) {
  const greeting = GREETINGS.find(g => hour >= g.start && hour < g.end) || GREETINGS[3];
  return greeting;
}

function formatDate(date) {
  const day = date.toLocaleDateString('en-GB', { weekday: 'long' });
  const month = date.toLocaleDateString('en-GB', { month: 'short' });
  const dayNum = date.getDate();
  return `${day}, ${month} ${dayNum}`;
}

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(id);
  }, []);
  return now;
}

// Extracted subcomponents for better organization
const HeaderButton = ({ onPress, icon, badgeCount, badgeScale }) => (
  <TouchableOpacity
    style={styles.headerButton}
    onPress={onPress}
    activeOpacity={0.7}
    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
  >
    <Icon name={icon} size={DESIGN.iconSize} color="#FFFFFF" />
    {badgeCount > 0 && (
      <Animated.View style={[styles.badge, { transform: [{ scale: badgeScale }] }]}>
        <Text style={styles.badgeText}>{badgeCount > 9 ? '9+' : badgeCount}</Text>
      </Animated.View>
    )}
  </TouchableOpacity>
);

const LecturerAvatar = ({ name, onPress }) => {
  const initial = name ? name.charAt(0).toUpperCase() : '?';
  return (
    <TouchableOpacity style={styles.avatar} onPress={onPress} activeOpacity={0.7}>
      <Text style={styles.avatarText}>{initial}</Text>
    </TouchableOpacity>
  );
};

export default function LecturerHeader({ navigation }) {
  const [unreadCount, setUnreadCount] = useState(0);
  const [fullName, setFullName] = useState('');
  const [isLoadingName, setIsLoadingName] = useState(true);
  
  const badgeScale = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const prevCountRef = useRef(0);
  const now = useClock();

  // Animate header on mount
  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

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

  // Fetch lecturer name
  useEffect(() => {
    getLecturerSession()
      .then(s => {
        const name = s?.lecturerName || '';
        setFullName(name);
        setIsLoadingName(false);
      })
      .catch(() => setIsLoadingName(false));
  }, []);

  // Badge animation
  useEffect(() => {
    if (unreadCount > 0 && prevCountRef.current === 0) {
      Animated.spring(badgeScale, {
        toValue: 1,
        tension: 300,
        friction: 12,
        useNativeDriver: true,
      }).start();
    } else if (unreadCount === 0 && prevCountRef.current > 0) {
      Animated.timing(badgeScale, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
    prevCountRef.current = unreadCount;
  }, [unreadCount, badgeScale]);

  const greeting = getGreeting(now.getHours());
  const formattedDate = useMemo(() => formatDate(now), [now]);
  const displayName = isLoadingName ? 'Loading...' : (fullName || 'Lecturer');

  return (
    <Animated.View style={[styles.root, { opacity: fadeAnim }]}>
          <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
          
          <LinearGradient
            colors={[GRADIENT_COLORS.start, GRADIENT_COLORS.end]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.gradient}
          >
            {/* Decorative elements */}
            <View style={styles.decorOrb1} />
            <View style={styles.decorOrb2} />
            <View style={styles.decorLine} />

            <View style={styles.content}>
              {/* Left: Menu + Avatar */}
              <View style={styles.leftSection}>
                <TouchableOpacity
                  style={styles.menuButton}
                  onPress={() => navigation.openDrawer()}
                  activeOpacity={0.7}
                >
                  <Icon name="menu" size={DESIGN.iconSize} color="#FFFFFF" />
                </TouchableOpacity>
                
                <LecturerAvatar name={fullName} onPress={() => navigation.navigate('Profile')} />
              </View>

              {/* Center: Greeting + Date */}
              <View style={styles.centerSection}>
                <View style={styles.greetingRow}>
                  <Icon name={greeting.icon} size={14} color={greeting.iconColor} />
                  <Text style={styles.greetingText} numberOfLines={1}>
                    {greeting.text}, {displayName}
                  </Text>
                </View>
                <Text style={styles.dateText}>{formattedDate}</Text>
              </View>

              {/* Right: Notifications */}
              <HeaderButton
                onPress={() => navigation.navigate('Notifications')}
                icon="bell-outline"
                badgeCount={unreadCount}
                badgeScale={badgeScale}
              />
            </View>

            {/* Subtle bottom accent */}
            <View style={styles.bottomAccent} />
          </LinearGradient>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 8,
    zIndex: 10,
  },
  gradient: {
    paddingTop: STATUSBAR_HEIGHT,
    paddingBottom: DESIGN.spacing.xl,
    overflow: 'hidden',
    position: 'relative',
  },
  
  // Decorative elements
  decorOrb1: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: 'rgba(255,255,255,0.04)',
    top: -80,
    right: -60,
  },
  decorOrb2: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(255,255,255,0.03)',
    bottom: -40,
    left: -30,
  },
  decorLine: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: DESIGN.spacing.lg,
    paddingTop: DESIGN.spacing.sm,
    paddingBottom: DESIGN.spacing.sm,
    gap: DESIGN.spacing.md,
  },
  
  leftSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: DESIGN.spacing.sm,
  },
  
  menuButton: {
    width: 40,
    height: 40,
    borderRadius: DESIGN.borderRadius.button,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  
  avatar: {
    width: DESIGN.avatarSize,
    height: DESIGN.avatarSize,
    borderRadius: DESIGN.borderRadius.avatar,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  avatarText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  
  centerSection: {
    flex: 1,
  },
  greetingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  greetingText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  dateText: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.5)',
    marginTop: 2,
    letterSpacing: 0.3,
  },
  
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: DESIGN.borderRadius.button,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: DESIGN.badgeSize,
    height: DESIGN.badgeSize,
    borderRadius: DESIGN.borderRadius.badge,
    backgroundColor: colors.danger.main,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: '#059669',
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#FFFFFF',
    lineHeight: 11,
  },
  
  bottomAccent: {
    position: 'absolute',
    bottom: 0,
    left: DESIGN.spacing.lg,
    right: DESIGN.spacing.lg,
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 1,
  },
});