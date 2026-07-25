import React from 'react';
import { View } from 'react-native';
import AssignedTimetableScreen from './AssignedTimetableScreen';
import { useColors } from '../../theme';

export default function TimetableScreen() {
  const colors = useColors();
  return (
    <View style={{ flex: 1, backgroundColor: colors.background.primary }}>
      <AssignedTimetableScreen />
    </View>
  );
}
