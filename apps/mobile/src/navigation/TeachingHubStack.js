import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import TeachingHub from '../screens/lecturer/TeachingHub';
import LecturerAssignmentsScreen from '../screens/lecturer/ClassManager/AssignmentsScreen';
import LecturerGroupsScreen from '../screens/lecturer/ClassManager/GroupsScreen';
import LecturerMaterialsScreen from '../screens/lecturer/ClassManager/MaterialsScreen';

const Stack = createNativeStackNavigator();

export default function TeachingHubStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="TeachingHubMain" component={TeachingHub} />
      <Stack.Screen name="LecturerAssignments" component={LecturerAssignmentsScreen} />
      <Stack.Screen name="LecturerGroups" component={LecturerGroupsScreen} />
      <Stack.Screen name="LecturerMaterials" component={LecturerMaterialsScreen} />
    </Stack.Navigator>
  );
}
