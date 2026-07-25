import React from 'react';
import { createDrawerNavigator } from '@react-navigation/drawer';

import AnalyticsScreen from '../screens/lecturer/AnalyticsScreen';
import ReportsScreen from '../screens/lecturer/ReportsScreen';
import NotificationsScreen from '../screens/lecturer/NotificationsScreen';
import SettingsScreen from '../screens/lecturer/SettingsScreen';
import OverviewScreen from '../screens/lecturer/OverviewScreen';
import TimetableScreen from '../screens/lecturer/TimetableScreen';
import LecturerAttendanceStack from './LecturerAttendanceStack';
import TeachingHubStack from './TeachingHubStack';
import CustomLecturerDrawer from './CustomLecturerDrawer';


const Drawer = createDrawerNavigator();

export default function LecturerDrawer({ route }) {
  const lecturerName = route?.params?.lecturerName || 'Lecturer';

  return (
    <Drawer.Navigator
      drawerContent={props => (
        <CustomLecturerDrawer
          {...props}
          userName={lecturerName}        
        />
      )}
      screenOptions={{
        headerShown: false,
      }}
    >
      <Drawer.Screen name="Overview"      component={OverviewScreen} />
      <Drawer.Screen name="Timetable"     component={TimetableScreen} />
      <Drawer.Screen name="Attendance"    component={LecturerAttendanceStack} />
      <Drawer.Screen name="Teaching Hub"  component={TeachingHubStack} />
      <Drawer.Screen name="Notifications" component={NotificationsScreen} />
      <Drawer.Screen name="Analytics"     component={AnalyticsScreen} />
      <Drawer.Screen name="Reports"       component={ReportsScreen} />
      <Drawer.Screen name="Settings"      component={SettingsScreen} />
    </Drawer.Navigator>
  );
}
