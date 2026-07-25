import React, { forwardRef, memo } from 'react';
import { requireNativeComponent } from 'react-native';
import PropTypes from 'prop-types';

const RNTQRCodeScanner = requireNativeComponent('QRCodeScanner');

const QRCodeScanner = forwardRef((props, ref) => {
  const { onQRCodeScanned, ...rest } = props;

  const _onQRCodeScanned = (event) => {
    if (onQRCodeScanned) {
      onQRCodeScanned(event.nativeEvent.data);
    }
  };

  return <RNTQRCodeScanner ref={ref} {...rest} onQRCodeScanned={_onQRCodeScanned} />;
});

QRCodeScanner.propTypes = {
  onQRCodeScanned: PropTypes.func,
};

export default memo(QRCodeScanner);
