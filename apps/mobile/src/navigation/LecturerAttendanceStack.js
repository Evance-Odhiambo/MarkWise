import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import AttendanceTaker from '../screens/lecturer/AttendanceTracker/AttendanceTaker';
import OfflineTaker from '../screens/lecturer/AttendanceTracker/OfflineTaker';
import OnlineTaker from '../screens/lecturer/AttendanceTracker/OnlineTaker';

const Stack = createNativeStackNavigator();

export default function LecturerAttendanceStack() {
  return (
    <Stack.Navigator initialRouteName="AttendanceTaker" screenOptions={{ headerShown: false }}>
      <Stack.Screen name="AttendanceTaker" component={AttendanceTaker} />
      <Stack.Screen name="OfflineTaker" component={OfflineTaker} />
      <Stack.Screen name="OnlineTaker" component={OnlineTaker} />
    </Stack.Navigator>
  );
}
