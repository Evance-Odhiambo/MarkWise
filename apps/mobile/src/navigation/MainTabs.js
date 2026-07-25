// C:\Users\evanc\Desktop\MarkWise\src\navigation\MainTabs.js
import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

// Import screens
import HomeTopTabs from './HomeTopTabs';
import AlertsScreen from '../screens/student/common/AlertsScreen';
import StudentTopTimetableTabs from './StudentTopTimetableTabs';
import CourseCenter from '../screens/student/common/CourseCenter';
import SettingsScreen from '../screens/student/common/SettingsScreen';

import { useColors } from '../theme';

const Tab = createBottomTabNavigator();

const MainTabs = ({ route }) => {
  const colors  = useColors();
  const primary = colors.primary.main;
  const { studentEmail, studentName } = route.params || {};

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName;
          if (route.name === 'Home') {
            iconName = focused ? 'home' : 'home-outline';
          } else if (route.name === 'Alerts') {
            iconName = focused ? 'bell' : 'bell-outline';
          } else if (route.name === 'Timetable') {
            iconName = focused ? 'calendar' : 'calendar-outline';
          } else if (route.name === 'Attendance') {
            iconName = focused ? 'checkbox-marked-circle' : 'checkbox-marked-circle-outline';
          } else if (route.name === 'Schedule') {
            iconName = focused ? 'calendar-clock' : 'calendar-clock-outline';
          } else if (route.name === 'Settings') {
            iconName = focused ? 'cog' : 'cog-outline';
          }
          return <Icon name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: primary,
        tabBarInactiveTintColor: 'gray',
        headerShown: false,
      })}
    >
      <Tab.Screen
        name="Home"
        options={{ tabBarAccessibilityLabel: 'Home tab' }}
        children={() => (
          <HomeTopTabs
            studentName={studentName}
            studentEmail={studentEmail}
            role={route?.params?.role || 'Student'}
          />
        )}
      />
      <Tab.Screen
        name="Alerts"
        component={AlertsScreen}
        options={{ tabBarAccessibilityLabel: 'Alerts tab' }}
      />
      <Tab.Screen
        name="Timetable"
        options={{ tabBarAccessibilityLabel: 'Timetable tab' }}
        children={() => <StudentTopTimetableTabs />}
      />
      <Tab.Screen
        name="Course Center"
        component={CourseCenter}
        options={{
          tabBarAccessibilityLabel: 'Course Center tab',
          tabBarIcon: ({ focused, color, size }) => (
            <Icon name={focused ? 'book-open' : 'book-open-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ tabBarAccessibilityLabel: 'Settings tab' }}
      />
    </Tab.Navigator>
  );
};

export default MainTabs;