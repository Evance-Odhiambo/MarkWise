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
import { useColors } from '../theme';

const STATUSBAR_HEIGHT = Platform.OS === 'ios' ? 44 : (StatusBar.currentHeight ?? 24);
const HEADER_TOTAL_HEIGHT = STATUSBAR_HEIGHT + 80;

const DESIGN = {
  headerHeight: HEADER_TOTAL_HEIGHT,
  avatarSize: 48,
  iconSize: 22,
  badgeSize: 18,
  borderRadius: {
    button: 16,
    avatar: 24,
    badge: 9,
    card: 20,
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    xxl: 24,
  },
};

const GREETINGS = [
  { start: 5, end: 12, text: 'Good morning', icon: 'weather-sunny', color: '#FBBF24' },
  { start: 12, end: 17, text: 'Good afternoon', icon: 'white-balance-sunny', color: '#F97316' },
  { start: 17, end: 21, text: 'Good evening', icon: 'weather-sunset-down', color: '#FB923C' },
  { start: 21, end: 5, text: 'Good night', icon: 'weather-night', color: '#A5B4FC' },
];

const getGreeting = (hour) => {
  return GREETINGS.find(g => hour >= g.start && hour < g.end) || GREETINGS[3];
};

const formatDate = (date) => {
  const day = date.toLocaleDateString('en-GB', { weekday: 'long' });
  const month = date.toLocaleDateString('en-GB', { month: 'short' });
  const dayNum = date.getDate();
  return `${day}, ${month} ${dayNum}`;
};

const useClock = () => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(id);
  }, []);
  return now;
};

const HeaderButton = ({ onPress, icon, badgeCount, badgeScale, colors }) => (
  <TouchableOpacity
    style={[styles.headerButton, { backgroundColor: colors.primary.soft }]}
    onPress={onPress}
    activeOpacity={0.7}
    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
  >
    <Icon name={icon} size={DESIGN.iconSize} color={colors.primary.main} />
    {badgeCount > 0 && (
      <Animated.View style={[styles.badge, { transform: [{ scale: badgeScale }], backgroundColor: colors.danger.main }]}>
        <Text style={styles.badgeText}>{badgeCount > 9 ? '9+' : badgeCount}</Text>
      </Animated.View>
    )}
  </TouchableOpacity>
);

const LecturerAvatar = ({ name, onPress, colors }) => {
  const initial = name ? name.charAt(0).toUpperCase() : '?';
  return (
    <TouchableOpacity 
      style={[styles.avatar, { backgroundColor: colors.primary.soft, borderColor: colors.primary.main + '30' }]} 
      onPress={onPress} 
      activeOpacity={0.7}
    >
      <Text style={[styles.avatarText, { color: colors.primary.main }]}>{initial}</Text>
    </TouchableOpacity>
  );
};

export default function LecturerHeader({ navigation }) {
  const colors = useColors();
  const [unreadCount, setUnreadCount] = useState(0);
  const [fullName, setFullName] = useState('');
  const [isLoadingName, setIsLoadingName] = useState(true);
  
  const badgeScale = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;
  const prevCountRef = useRef(0);
  const now = useClock();

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 600,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fadeAnim, slideAnim]);

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
  const displayName = isLoadingName ? 'Lecturer' : (fullName || 'Lecturer');

  return (
    <Animated.View style={[styles.root, { opacity: fadeAnim }]}>
      <StatusBar 
        barStyle="light-content" 
        backgroundColor="transparent" 
        translucent 
      />
      
      <LinearGradient
        colors={[colors.primary.dark, colors.primary.main]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
      >
        {/* Subtle decorative orbs */}
        <View style={[styles.decorOrb1, { backgroundColor: colors.primary.light + '15' }]} />
        <View style={[styles.decorOrb2, { backgroundColor: colors.primary.light + '10' }]} />
        
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
            
            <LecturerAvatar name={fullName} onPress={() => navigation.navigate('Profile')} colors={colors} />
          </View>

          {/* Center: Greeting + Date */}
          <View style={styles.centerSection}>
            <View style={styles.greetingRow}>
              <View style={[styles.greetingIconWrap, { backgroundColor: greeting.color + '25' }]}>
                <Icon name={greeting.icon} size={16} color={greeting.color} />
              </View>
              <Text style={styles.greetingText} numberOfLines={1}>
                {greeting.text}
              </Text>
            </View>
            <Text style={styles.nameText} numberOfLines={1}>
              {displayName}
            </Text>
            <Text style={styles.dateText}>{formattedDate}</Text>
          </View>

          {/* Right: Notifications */}
          <HeaderButton
            onPress={() => navigation.navigate('Notifications')}
            icon="bell-outline"
            badgeCount={unreadCount}
            badgeScale={badgeScale}
            colors={colors}
          />
        </View>

        {/* Subtle bottom separator */}
        <View style={styles.bottomSeparator} />
      </LinearGradient>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
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
    width: 220,
    height: 220,
    borderRadius: 110,
    top: -100,
    right: -70,
  },
  decorOrb2: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
    bottom: -50,
    left: -40,
  },
  
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: DESIGN.spacing.lg,
    paddingTop: DESIGN.spacing.md,
    paddingBottom: DESIGN.spacing.md,
    gap: DESIGN.spacing.md,
  },
  
  leftSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: DESIGN.spacing.sm,
  },
  
  menuButton: {
    width: 44,
    height: 44,
    borderRadius: DESIGN.borderRadius.button,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  
  avatar: {
    width: DESIGN.avatarSize,
    height: DESIGN.avatarSize,
    borderRadius: DESIGN.borderRadius.avatar,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  avatarText: {
    fontSize: 20,
    fontWeight: '700',
  },
  
  centerSection: {
    flex: 1,
    gap: 2,
  },
  greetingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  greetingIconWrap: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  greetingText: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.9)',
    letterSpacing: 0.2,
  },
  nameText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.2,
    marginTop: 2,
  },
  dateText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.6)',
    marginTop: 2,
    letterSpacing: 0.3,
    fontWeight: '500',
  },
  
  headerButton: {
    width: 44,
    height: 44,
    borderRadius: DESIGN.borderRadius.button,
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
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#FFFFFF',
    lineHeight: 11,
  },
  
  bottomSeparator: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginHorizontal: DESIGN.spacing.lg,
  },
});