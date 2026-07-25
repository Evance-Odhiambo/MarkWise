import React from 'react';
import { createMaterialTopTabNavigator } from '@react-navigation/material-top-tabs';
import AssignedTimetableScreen from '../screens/lecturer/AssignedTimetableScreen';
import { useColors } from '../theme';

const Tab = createMaterialTopTabNavigator();

export default function TopTimetableTabs() {
  const colors = useColors();

  return (
    <Tab.Navigator
      screenOptions={{
        tabBarLabelStyle: {
          fontSize: 14,
          fontWeight: '600',
          textTransform: 'none',
        },
        tabBarIndicatorStyle: {
          backgroundColor: colors.success.main,
          height: 3,
        },
        tabBarStyle: {
          backgroundColor: colors.surface.primary,
          elevation: 0,
          shadowOpacity: 0,
          borderBottomWidth: 1,
          borderBottomColor: colors.border.light,
        },
        tabBarActiveTintColor: colors.success.main,
        tabBarInactiveTintColor: colors.text.muted,
      }}
    >
      <Tab.Screen
        name="LecturerTimetable"
        component={AssignedTimetableScreen}
      />
    </Tab.Navigator>
  );
}
