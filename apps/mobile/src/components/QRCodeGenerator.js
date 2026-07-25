import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Image, ActivityIndicator, View, Text, TouchableOpacity, NativeModules } from 'react-native';

const { QRCodeGenerator } = NativeModules;

const QRCodeGeneratorComponent = React.memo(({ value, size }) => {
    const [displayImage, setDisplayImage] = useState(null);
    const [nextImage, setNextImage] = useState(null);
    const [error, setError] = useState(null);
    const generationIdRef = useRef(0);
    const nextImageRef = useRef(null);

    const generate = useCallback((val) => {
        if (!val) return;
        setError(null);
        const id = ++generationIdRef.current;
        QRCodeGenerator.generateQRCode(val)
            .then(result => {
                if (generationIdRef.current !== id) return;
                nextImageRef.current = result;
                setNextImage(result);
            })
            .catch(err => {
                if (generationIdRef.current !== id) return;
                console.error('[QRCodeGenerator]', err);
                setError('QR generation failed — tap to retry');
            });
    }, []);

    useEffect(() => {
        generate(value);
    }, [value, generate]);

    // Called once the next image is fully decoded and ready to paint — swap atomically.
    const onNextLoad = useCallback(() => {
        const loaded = nextImageRef.current;
        if (!loaded) return;
        setDisplayImage(loaded);
        nextImageRef.current = null;
        setNextImage(null);
    }, []);

    if (error) {
        return (
            <TouchableOpacity
                style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FEF2F2', borderRadius: 8 }}
                onPress={() => generate(value)}
                activeOpacity={0.7}
            >
                <Text style={{ fontSize: 24 }}>⚠️</Text>
                <Text style={{ fontSize: 11, color: '#DC2626', textAlign: 'center', marginTop: 6, paddingHorizontal: 8 }}>{error}</Text>
            </TouchableOpacity>
        );
    }

    if (!displayImage && !nextImage) {
        return (
            <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
                <ActivityIndicator size="small" />
            </View>
        );
    }

    return (
        <View style={{ width: size, height: size }}>
            {/* Current image always visible — never removed until next is ready */}
            {displayImage && (
                <Image
                    source={{ uri: `data:image/png;base64,${displayImage}` }}
                    style={{ position: 'absolute', width: size, height: size }}
                    fadeDuration={0}
                />
            )}
            {/* Next image decoded off-screen; onLoad triggers the atomic swap */}
            {nextImage && (
                <Image
                    source={{ uri: `data:image/png;base64,${nextImage}` }}
                    style={{ position: 'absolute', width: size, height: size }}
                    fadeDuration={0}
                    onLoad={onNextLoad}
                />
            )}
        </View>
    );
});

export default QRCodeGeneratorComponent;
