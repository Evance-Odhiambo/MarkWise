// C:\Users\evanc\Desktop\MarkWise\src\navigation\RootNavigator.js
import React, { useEffect, useState } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActivityIndicator, View } from 'react-native';

import RoleSelectionScreen from '../screens/auth/RoleSelectionScreen';
import StudentSignInScreen from '../screens/auth/StudentSignInScreen';
import StudentSignUpScreen from '../screens/auth/StudentSignUpScreen';
import LecturerSignInScreen from '../screens/auth/LecturerSignInScreen';
import LecturerSignUpScreen from '../screens/auth/LecturerSignUpScreen';
import MainTabs from './MainTabs';
import LecturerDrawer from './LecturerDrawer';
import GroupsScreen from '../screens/student/CourseWorkspace/GroupsScreen';
import AssignmentsScreen from '../screens/student/CourseWorkspace/AssignmentsScreen';
import MaterialsScreen from '../screens/student/CourseWorkspace/MaterialsScreen';
import { getLecturerSession, getStudentSession } from '../utils/authSession';
import useAttendancePermissions from '../hooks/useAttendancePermissions';

// Import missing screens
import StudentAttendanceStack from './StudentAttendanceStack';
import OfflineMarker from '../screens/student/AttendanceMarker/OfflineMarker';
import OnlineMarker from '../screens/student/AttendanceMarker/OnlineMarker';
import MeetingInvitesScreen from '../screens/student/AttendanceMarker/MeetingInvitesScreen';
import LeadSessionScreen from '../screens/student/AttendanceMarker/LeadSessionScreen';


const Stack = createNativeStackNavigator();

export default function RootNavigator() {
  // Request all attendance-related permissions (camera + BLE) on first install.
  useAttendancePermissions();

  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [initialRouteName, setInitialRouteName] = useState('RoleSelection');
  const [studentInitialParams, setStudentInitialParams] = useState({ role: 'student' });
  const [lecturerInitialParams, setLecturerInitialParams] = useState({});

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const [studentSession, lecturerSession] = await Promise.all([
          getStudentSession(),
          getLecturerSession(),
        ]);

        if (studentSession?.token && (!lecturerSession?.token || (studentSession.savedAt || 0) >= (lecturerSession.savedAt || 0))) {
          setInitialRouteName('MainApp');
          setStudentInitialParams({
            role: 'student',
            studentEmail: studentSession?.studentEmail || '',
            studentName: studentSession?.studentName || '',
          });
        } else if (lecturerSession?.token) {
          setInitialRouteName('LecturerApp');
          setLecturerInitialParams({
            lecturerName: lecturerSession?.lecturerName || 'Lecturer',
            lecturerEmail: lecturerSession?.lecturerEmail || '',
          });
        }
      } finally {
        setIsBootstrapping(false);
      }
    };

    bootstrap();
  }, []);

  if (isBootstrapping) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8f9fa' }}>
        <ActivityIndicator size="large" color="#16A34A" />
      </View>
    );
  }

  return (
    <Stack.Navigator
      initialRouteName={initialRouteName}
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#f8f9fa' },
      }}
    >
      {/* Entry point */}
      <Stack.Screen
        name="RoleSelection"
        component={RoleSelectionScreen}
        options={{ gestureEnabled: false }}
      />

      <Stack.Screen
        name="StudentSignIn"
        component={StudentSignInScreen}
      />

      <Stack.Screen
        name="StudentSignUp"
        component={StudentSignUpScreen}
      />

      <Stack.Screen
        name="LecturerSignIn"
        component={LecturerSignInScreen}
      />

      <Stack.Screen
        name="LecturerSignUp"
        component={LecturerSignUpScreen}
      />

      {/* Students / Representatives */}
      <Stack.Screen
        name="MainApp"
        component={MainTabs}
        initialParams={studentInitialParams}
        options={{ gestureEnabled: false }}
      />


      {/* Student Attendance Sessions - accessible from OverviewScreen */}
      <Stack.Screen
        name="StudentAttendanceSessions"
        component={StudentAttendanceStack}
        options={{ title: 'Join Attendance Session', headerShown: false }}
      />

      {/* Student Attendance Markers - Global access */}
      <Stack.Screen
        name="OfflineMarker"
        component={OfflineMarker}
        options={{ title: 'Offline Attendance' }}
      />
      <Stack.Screen
        name="OnlineMarker"
        component={OnlineMarker}
        options={{ title: 'Online Attendance' }}
      />
      <Stack.Screen
        name="MeetingInvites"
        component={MeetingInvitesScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="LeadSession"
        component={LeadSessionScreen}
        options={{ headerShown: false }}
      />

      {/* Lecturers */}
      <Stack.Screen
        name="LecturerApp"
        component={LecturerDrawer}
        initialParams={lecturerInitialParams}
        options={{ gestureEnabled: false }} 
      />
      
      <Stack.Screen 
        name="GroupsScreen" 
        component={GroupsScreen} 
        options={{ title: 'Groups' }} 
      />
      
      <Stack.Screen 
        name="AssignmentsScreen" 
        component={AssignmentsScreen} 
        options={{ title: 'Assignments' }} 
      />
      
      <Stack.Screen 
        name="MaterialsScreen" 
        component={MaterialsScreen} 
        options={{ title: 'Materials' }} 
      />

    </Stack.Navigator>
  );
}