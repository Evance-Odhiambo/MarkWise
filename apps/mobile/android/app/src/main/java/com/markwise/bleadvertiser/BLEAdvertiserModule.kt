package com.markwise.bleadvertiser

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.content.Intent
import android.app.Activity
import com.facebook.react.bridge.ActivityEventListener
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.BluetoothLeAdvertiser
import android.content.Context
import android.os.ParcelUuid
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.util.UUID
import android.util.Log
import android.os.Build

class BLEAdvertiserModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    companion object {
        private const val TAG = "BLEAdvertiserModule"
    }

    override fun getName() = "BLEAdvertiserModule"

    private val bluetoothAdapter: BluetoothAdapter? by lazy {
        val bluetoothManager = reactContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        bluetoothManager?.adapter
    }

    // Computed property — re-queried every call so we always reflect the current BT state.
    // A `by lazy` here would cache null permanently if BT was off on first access.
    private val advertiser: BluetoothLeAdvertiser?
        get() = bluetoothAdapter?.bluetoothLeAdvertiser

    private var isAdvertising = false
    private val advertiseCallback = object : AdvertiseCallback() {
        override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
            isAdvertising = true
            Log.d(TAG, "Advertising started successfully")
            super.onStartSuccess(settingsInEffect)
        }

        override fun onStartFailure(errorCode: Int) {
            isAdvertising = false
            val errorMessage = when(errorCode) {
                ADVERTISE_FAILED_ALREADY_STARTED -> "Already started"
                ADVERTISE_FAILED_DATA_TOO_LARGE -> "Data too large"
                ADVERTISE_FAILED_FEATURE_UNSUPPORTED -> "Feature unsupported"
                ADVERTISE_FAILED_INTERNAL_ERROR -> "Internal error"
                ADVERTISE_FAILED_TOO_MANY_ADVERTISERS -> "Too many advertisers"
                else -> "Unknown error: $errorCode"
            }
            Log.e(TAG, "Advertising failed to start: $errorMessage (code=$errorCode)")
            super.onStartFailure(errorCode)
        }
    }

    private var pendingEnablePromise: Promise? = null
    private val REQUEST_ENABLE_BT = 4123

    private val activityEventListener = object : ActivityEventListener {
        override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
            if (requestCode == REQUEST_ENABLE_BT) {
                val enabled = bluetoothAdapter?.isEnabled == true
                pendingEnablePromise?.resolve(enabled)
                pendingEnablePromise = null
            }
        }

        override fun onNewIntent(intent: Intent) {
            // no-op
        }
    }

    init {
        reactContext.addActivityEventListener(activityEventListener)
    }

    @ReactMethod
    fun isAdvertisingSupported(promise: Promise) {
        promise.resolve(advertiser != null)
    }

    @ReactMethod
    fun isBluetoothEnabled(promise: Promise) {
        promise.resolve(bluetoothAdapter?.isEnabled == true)
    }

    @ReactMethod
    fun requestEnableBluetooth(promise: Promise) {
        try {
            if (bluetoothAdapter?.isEnabled == true) {
                promise.resolve(true)
                return
            }

            val currentActivity: Activity? = reactApplicationContext.currentActivity
            if (currentActivity == null) {
                // Fallback: open settings
                val intent = Intent(android.provider.Settings.ACTION_BLUETOOTH_SETTINGS)
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                reactApplicationContext.startActivity(intent)
                promise.resolve(false)
                return
            }

            pendingEnablePromise = promise
            val enableIntent = Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE)
            currentActivity.startActivityForResult(enableIntent, REQUEST_ENABLE_BT)
        } catch (e: Exception) {
            pendingEnablePromise = null
            promise.reject("E_REQUEST_ENABLE_BT", e.message)
        }
    }

    @ReactMethod
    fun startAdvertising(data: String, promise: Promise) {
        if (advertiser == null) {
            Log.e(TAG, "startAdvertising: BLE Advertiser not available")
            promise.reject("E_BLE_ADVERTISER", "BLE Advertiser not available")
            return
        }

        if (bluetoothAdapter?.isEnabled != true) {
            Log.e(TAG, "startAdvertising: Bluetooth is not enabled")
            promise.reject("E_BLUETOOTH_OFF", "Bluetooth is not enabled")
            return
        }

        // Expect data as base64-encoded binary payload (7 bytes expected)
        val manufacturerId = 0x1234 // Use a unique 16-bit manufacturer ID for your app
        val dataBytes: ByteArray = try {
            android.util.Base64.decode(data, android.util.Base64.DEFAULT)
        } catch (e: Exception) {
            Log.e(TAG, "startAdvertising: Failed to decode base64 payload", e)
            promise.reject("E_BLE_BASE64_DECODE", "Failed to decode base64 payload: ${e.message}")
            return
        }
        if (dataBytes.size > 24) {
            Log.w(TAG, "startAdvertising: data size (${dataBytes.size} bytes) is too large for manufacturer data, truncating to 24 bytes!")
            // Truncate to 24 bytes if needed (should not happen for 7-byte payload)
            dataBytes.copyOf(24)
        }

        // Build settings with appropriate flags
        val settings = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
            .setConnectable(false)
            .build()

        Log.d(TAG, "startAdvertising called with base64 payload: '$data' (decoded ${dataBytes.size} bytes) as manufacturer data, manufacturerId=0x${manufacturerId.toString(16)}")

        // Build advertise data with manufacturer data
        val advertiseData = AdvertiseData.Builder()
            .setIncludeDeviceName(false)
            .setIncludeTxPowerLevel(false)
            .addManufacturerData(manufacturerId, dataBytes)
            .build()

        try {
            // Stop any existing advertising first
            if (isAdvertising) {
                advertiser?.stopAdvertising(advertiseCallback)
                isAdvertising = false
            }

            advertiser?.startAdvertising(settings, advertiseData, advertiseCallback)
            Log.d(TAG, "startAdvertising call submitted")
            promise.resolve(null)
        } catch (e: SecurityException) {
            Log.e(TAG, "startAdvertising failed: ${e.message}", e)
            promise.reject("E_BLE_ADVERTISING_SECURITY", e.message)
        } catch (e: IllegalStateException) {
            Log.e(TAG, "startAdvertising failed: ${e.message}", e)
            promise.reject("E_BLE_ADVERTISING_STATE", e.message)
        } catch (e: Exception) {
            Log.e(TAG, "startAdvertising failed: ${e.message}", e)
            promise.reject("E_BLE_ADVERTISING", e.message)
        }
    }

    @ReactMethod
    fun stopAdvertising(promise: Promise) {
        if (advertiser == null) {
            // BT is off or advertiser unavailable — nothing to stop, treat as success.
            Log.d(TAG, "stopAdvertising: advertiser not available, nothing to stop")
            isAdvertising = false
            promise.resolve(null)
            return
        }

        try {
            advertiser?.stopAdvertising(advertiseCallback)
            isAdvertising = false
            Log.d(TAG, "stopAdvertising succeeded")
            promise.resolve(null)
        } catch (e: Exception) {
            Log.e(TAG, "stopAdvertising failed: ${e.message}", e)
            promise.reject("E_BLE_ADVERTISING_STOP", e.message)
        }
    }
}