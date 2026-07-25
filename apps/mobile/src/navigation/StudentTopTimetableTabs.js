import React, { useRef, useEffect, useMemo } from 'react';
import {
  Platform,
  StatusBar,
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
  Dimensions
} from 'react-native';
import { createMaterialTopTabNavigator } from '@react-navigation/material-top-tabs';
import { SafeAreaView } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/Ionicons';
import MyTimetableScreen from '../screens/timetable/MyTimetableScreen';
import UnitEnrollmentScreen from '../screens/timetable/UnitEnrollmentScreen';
import { useColors, useTheme } from '../theme';

const Tab = createMaterialTopTabNavigator();
const { width } = Dimensions.get('window');

// CustomTabHeader is rendered as a React component so hooks are valid here
const CustomTabHeader = ({ state, descriptors, navigation, position }) => {
  const colors  = useColors();
  const C       = useMemo(() => ({
    primary:    colors.primary.main,
    primaryLt:  colors.primary.light,
    purple:     colors.purple.main,
    textSecAlt: colors.text.secondary,
    bg:         colors.background.primary,
  }), [colors]);
  const styles  = useMemo(() => makeStyles(C), [C]);

  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(-20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: 0,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  return (
    <Animated.View
      style={[
        styles.headerContainer,
        {
          opacity: fadeAnim,
          transform: [{ translateY: slideAnim }],
        }
      ]}
    >
      <LinearGradient
        colors={[C.bg, colors.background.secondary]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.headerGradient}
      >
        <View style={styles.headerTop}>
          <View style={styles.headerIconContainer}>
            <LinearGradient
              colors={[C.primary, C.purple]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.iconGradient}
            >
              <Icon name="calendar" size={22} color="#FFFFFF" />
            </LinearGradient>
          </View>
          <View style={styles.headerTextContainer}>
            <Text style={styles.headerTitle}>Academic Schedule</Text>
            <Text style={styles.headerSubtitle}>
              Manage your timetable and enrollments
            </Text>
          </View>
        </View>

        {/* Custom Tab Bar */}
        <View style={styles.tabBarContainer}>
          {state.routes.map((route, index) => {
            const { options } = descriptors[route.key];
            const label = options.title !== undefined ? options.title : route.name;
            const isFocused = state.index === index;

            const onPress = () => {
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });

              if (!isFocused && !event.defaultPrevented) {
                navigation.navigate(route.name);
              }
            };

            const onLongPress = () => {
              navigation.emit({
                type: 'tabLongPress',
                target: route.key,
              });
            };

            const inputRange = state.routes.map((_, i) => i);
            const opacity = position.interpolate({
              inputRange,
              outputRange: inputRange.map(i => (i === index ? 1 : 0.6)),
            });

            const iconName = index === 0 ? 'time-outline' : 'add-circle-outline';

            return (
              <TouchableOpacity
                key={route.key}
                accessibilityRole="button"
                accessibilityState={isFocused ? { selected: true } : {}}
                accessibilityLabel={options.tabBarAccessibilityLabel}
                onPress={onPress}
                onLongPress={onLongPress}
                style={styles.tabItem}
              >
                <Animated.View style={[styles.tabContent, { opacity }]}>
                  <View style={[
                    styles.tabIconContainer,
                    isFocused && styles.tabIconContainerActive
                  ]}>
                    <Icon
                      name={iconName}
                      size={18}
                      color={isFocused ? C.primary : C.textSecAlt}
                    />
                  </View>
                  <Text style={[
                    styles.tabLabel,
                    isFocused && styles.tabLabelActive
                  ]}>
                    {label}
                  </Text>
                  {isFocused && (
                    <Animated.View style={[
                      styles.tabIndicator,
                      {
                        transform: [{
                          scaleX: position.interpolate({
                            inputRange,
                            outputRange: inputRange.map(i => (i === index ? 1 : 0)),
                          }),
                        }],
                      },
                    ]}>
                      <LinearGradient
                        colors={[C.primary, C.purple]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={styles.tabIndicatorGradient}
                      />
                    </Animated.View>
                  )}
                </Animated.View>
              </TouchableOpacity>
            );
          })}
        </View>
      </LinearGradient>
    </Animated.View>
  );
};

const CustomTabBar = (props) => <CustomTabHeader {...props} />;

export default function StudentTopTimetableTabs() {
  const colors  = useColors();
  const { isDark } = useTheme();
  const styles  = useMemo(() => makeStyles({
    bg: colors.background.primary,
    primary: colors.primary.main,
    border: colors.border.light,
    textSecAlt: colors.text.secondary,
    primaryLt: colors.primary.light,
  }), [colors]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor={colors.background.primary}
      />

      <Tab.Navigator
        tabBar={CustomTabBar}
        screenOptions={{
          swipeEnabled: true,
          animationEnabled: true,
          lazy: true,
        }}
      >
        <Tab.Screen
          name="MyTimetable"
          component={MyTimetableScreen}
          options={{
            title: 'Timetable',
            tabBarIcon: ({ color }) => (
              <Icon name="calendar-outline" size={20} color={color} />
            ),
          }}
        />
        <Tab.Screen
          name="UnitEnrollment"
          component={UnitEnrollmentScreen}
          options={{
            title: 'Enrollments',
            tabBarIcon: ({ color }) => (
              <Icon name="add-circle-outline" size={20} color={color} />
            ),
          }}
        />
      </Tab.Navigator>
    </SafeAreaView>
  );
}

const makeStyles = (C) => StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: C.bg,
  },
  headerContainer: {
    backgroundColor: C.bg,
    borderBottomWidth: 1,
    borderBottomColor: C.border || 'rgba(255,255,255,0.08)',
  },
  headerGradient: {
    paddingTop: Platform.OS === 'ios' ? 12 : 20,
    paddingBottom: 0,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  headerIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 16,
    marginRight: 14,
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  iconGradient: {
    flex: 1,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTextContainer: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: C.text || '#0F172A',
    letterSpacing: -0.3,
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 13,
    color: C.textSecAlt,
    letterSpacing: -0.1,
    lineHeight: 18,
  },
  tabBarContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabContent: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    position: 'relative',
    width: '100%',
  },
  tabIconContainer: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
    backgroundColor: 'rgba(99,102,241,0.07)',
  },
  tabIconContainerActive: {
    backgroundColor: 'rgba(99,102,241,0.12)',
  },
  tabLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: C.textSecAlt,
    letterSpacing: 0.2,
  },
  tabLabelActive: {
    color: C.primaryLt,
  },
  tabIndicator: {
    position: 'absolute',
    bottom: -8,
    left: '10%',
    width: '80%',
    height: 3,
    borderRadius: 2,
    overflow: 'hidden',
  },
  tabIndicatorGradient: {
    flex: 1,
  },
});

export const tabAnimationConfig = {
  animation: 'spring',
  config: {
    stiffness: 1000,
    damping: 500,
    mass: 3,
    overshootClamping: true,
    restDisplacementThreshold: 0.01,
    restSpeedThreshold: 0.01,
  },
};
