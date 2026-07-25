import React from 'react';
import { requireNativeComponent } from 'react-native';

const MLKitCameraView = requireNativeComponent('MLKitCameraView');

const MLKitCamera = (props) => {
  const { onBarcodeScan, ...rest } = props;

  const _onBarcodeScan = (event) => {
    onBarcodeScan(event.nativeEvent.data);
  };

  return <MLKitCameraView {...rest} onBarcodeScan={_onBarcodeScan} />;
};

export default MLKitCamera;
