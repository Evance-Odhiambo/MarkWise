import { BleManager } from 'react-native-ble-plx';

let bleManagerInstance = null;

/**
 * Get singleton instance of BleManager
 * @returns {BleManager} The shared BleManager instance
 */
export const getBleManager = () => {
    if (!bleManagerInstance) {
        bleManagerInstance = new BleManager();
    }
    return bleManagerInstance;
};

export default getBleManager;
