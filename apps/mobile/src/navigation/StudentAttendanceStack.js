// C:\Users\evanc\Desktop\MarkWise\src\navigation\SAttendanceStack.js
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import SessionsScreen from '../screens/student/AttendanceMarker/SessionsScreen';
import OnlineMarker from '../screens/student/AttendanceMarker/OnlineMarker';
import OfflineMarker from '../screens/student/AttendanceMarker/OfflineMarker';

import { useColors } from '../theme';

const Stack = createNativeStackNavigator();

const StudentAttendanceStack = () => {
  const colors = useColors();

  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.primary.main },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: 'bold' },
      }}
    >
      <Stack.Screen
        name="Sessions"
        component={SessionsScreen}
        options={{ title: 'Attendance Sessions' }}
      />
      <Stack.Screen
        name="OnlineMarker"
        component={OnlineMarker}
        options={{ title: 'Online Attendance' }}
      />
      <Stack.Screen
        name="OfflineMarker"
        component={OfflineMarker}
        options={{ title: 'Offline Attendance' }}
      />
    </Stack.Navigator>
  );
};

export default StudentAttendanceStack;
