import React, { useMemo, useState, useCallback } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import * as Animatable from 'react-native-animatable';
const { width: initialWidth, height: initialHeight } = Dimensions.get('window');

const ScanningOverlay = React.memo(({
    overlayColor = 'rgba(0,0,0,0.7)',
    frameRatio = 0.72,
    maxFrameSize = 280,
    animationDuration = 2500,
}) => {
    const [layout, setLayout] = useState({ width: initialWidth, height: initialHeight });

    const onOverlayLayout = useCallback((event) => {
        const { width, height } = event.nativeEvent.layout;
        setLayout({ width, height });
    }, []);

    const frameSize = useMemo(() => Math.min(layout.width * frameRatio, maxFrameSize), [layout.width, frameRatio, maxFrameSize]);
    const frameLeft = useMemo(() => Math.max(0, (layout.width - frameSize) / 2), [layout.width, frameSize]);
    const frameTop = useMemo(() => Math.max(0, (layout.height - frameSize) / 2), [layout.height, frameSize]);

    return (
        <View style={styles.overlay} pointerEvents="none" onLayout={onOverlayLayout}>
            <View style={[styles.mask, styles.maskTop, { height: frameTop, backgroundColor: overlayColor }]} />
            <View style={[styles.mask, styles.maskBottom, { top: frameTop + frameSize, backgroundColor: overlayColor }]} />
            <View style={[styles.mask, styles.maskLeft, { top: frameTop, width: frameLeft, height: frameSize, backgroundColor: overlayColor }]} />
            <View style={[styles.mask, styles.maskRight, { top: frameTop, left: frameLeft + frameSize, right: 0, height: frameSize, backgroundColor: overlayColor }]} />

            <View style={[styles.viewfinder, { top: frameTop, left: frameLeft, width: frameSize, height: frameSize }]}> 
                <Animatable.View
                    style={[styles.scanLine, { position: 'absolute', top: 0, left: 0 }]}
                    animation={{
                        from: { translateY: 0 },
                        to: { translateY: frameSize - 2 },
                    }}
                    duration={animationDuration}
                    iterationCount="infinite"
                    direction="alternate"
                    useNativeDriver
                />
                <View style={[styles.corner, styles.topLeft]} />
                <View style={[styles.corner, styles.topRight]} />
                <View style={[styles.corner, styles.bottomLeft]} />
                <View style={[styles.corner, styles.bottomRight]} />
            </View>
        </View>
    );
});

const styles = StyleSheet.create({
    overlay: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 2,
    },
    mask: {
        position: 'absolute',
    },
    maskTop: {
        top: 0,
        left: 0,
        right: 0,
    },
    maskBottom: {
        left: 0,
        right: 0,
        bottom: 0,
    },
    maskLeft: {
        left: 0,
    },
    maskRight: {
        position: 'absolute',
    },
    viewfinder: {
        position: 'absolute',
        backgroundColor: 'transparent',
    },
    scanLine: {
        width: '100%',
        height: 2,
        backgroundColor: '#667eea',
        shadowColor: '#667eea',
        shadowOpacity: 0.8,
        shadowRadius: 5,
        elevation: 10,
    },
    corner: {
        position: 'absolute',
        width: 35,
        height: 35,
        borderColor: '#FFFFFF',
        borderWidth: 5,
    },
    topLeft: {
        top: 0,
        left: 0,
        borderBottomWidth: 0,
        borderRightWidth: 0,
    },
    topRight: {
        top: 0,
        right: 0,
        borderBottomWidth: 0,
        borderLeftWidth: 0,
    },
    bottomLeft: {
        bottom: 0,
        left: 0,
        borderTopWidth: 0,
        borderRightWidth: 0,
    },
    bottomRight: {
        bottom: 0,
        right: 0,
        borderTopWidth: 0,
        borderLeftWidth: 0,
    },
});

export default ScanningOverlay;
