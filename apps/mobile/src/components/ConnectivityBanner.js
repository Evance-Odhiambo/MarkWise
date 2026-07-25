// src/components/ConnectivityBanner.js
// Isolated offline indicator — keeps useInternetStatus re-renders out of
// parent screens so controlled TextInputs don't experience cursor jumps
// from periodic network polling.

import React from 'react';
import { View } from 'react-native';
import { useInternetStatus } from '../hooks/useInternetStatus';
import OfflineBanner from './OfflineBanner';

export default function ConnectivityBanner({ message, wrapperStyle }) {
  const { isOnline } = useInternetStatus();
  if (isOnline) return null;
  return (
    <View style={wrapperStyle}>
      <OfflineBanner message={message} />
    </View>
  );
}
