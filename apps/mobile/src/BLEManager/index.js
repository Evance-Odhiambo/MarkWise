import { NativeModules, NativeEventEmitter, Platform } from 'react-native';

const { BLEAdvertiserModule, BLEScanner } = NativeModules;

if (!BLEAdvertiserModule || !BLEScanner) {
	console.warn(
		'BLEAdvertiserModule or BLEScanner native modules are not linked. Make sure the native code is properly registered.'
	);
}

const BLEAdvertiser = BLEAdvertiserModule || {};
const BLEScannerModule = BLEScanner || {};

// Optionally, set up event emitter for BLEScanner events
let scannerEventEmitter = null;
if (Platform.OS === 'android' && BLEScanner) {
	scannerEventEmitter = new NativeEventEmitter(BLEScanner);
}

const BLEManager = {
	...BLEAdvertiser,
	...BLEScannerModule,
	onDeviceFound: (callback) => {
		if (scannerEventEmitter) {
			return scannerEventEmitter.addListener('onDeviceFound', callback);
		}
		return { remove: () => {} };
	},
	onScanError: (callback) => {
		if (scannerEventEmitter) {
			return scannerEventEmitter.addListener('onScanError', callback);
		}
		return { remove: () => {} };
	},
};

export default BLEManager;