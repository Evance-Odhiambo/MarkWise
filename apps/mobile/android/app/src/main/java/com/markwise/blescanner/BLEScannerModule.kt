package com.markwise.blescanner

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.pm.PackageManager
import android.os.Build
import android.os.ParcelUuid
import android.util.Base64
import androidx.core.app.ActivityCompat
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.*
import android.util.Log

class BLEScannerModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    companion object {
        private const val TAG = "BLEScannerModule"
        private val SERVICE_UUID = ParcelUuid.fromString("00001101-0000-1000-8000-00805F9B34FB")
    }

    override fun getName() = "BLEScanner"

    private var isScanning = false
    private val bluetoothAdapter: BluetoothAdapter? by lazy { 
        val manager = reactContext.getSystemService(android.bluetooth.BluetoothManager::class.java)
        manager?.adapter
    }
    private val scanner by lazy { bluetoothAdapter?.bluetoothLeScanner }
    
    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult?) {
            Log.d(TAG, "onScanResult: device=${result?.device?.address}, RSSI=${result?.rssi}")
            result?.let { scanResult ->
                val scanRecord = scanResult.scanRecord
                // Log all advertisement fields for debugging
                Log.d(TAG, "  Device name: ${scanResult.device.name}")
                Log.d(TAG, "  Service UUIDs: ${scanRecord?.serviceUuids}")
                Log.d(TAG, "  Service Data: ${scanRecord?.serviceData}")
                Log.d(TAG, "  Manufacturer Data: ${scanRecord?.manufacturerSpecificData}")
                Log.d(TAG, "  Raw scan record bytes: ${scanRecord?.bytes?.joinToString()}")

                var payload: String? = null
                // Try to extract compact payload from manufacturer data (0x1234)
                val manufacturerId = 0x1234
                if (scanRecord?.manufacturerSpecificData != null) {
                    val data = scanRecord.manufacturerSpecificData.get(manufacturerId)
                    if (data != null) {
                        // Encode manufacturer data as base64 for JS
                        payload = Base64.encodeToString(data, Base64.NO_WRAP)
                        Log.d(TAG, "  Extracted compact payload from manufacturer data [$manufacturerId] (base64): '$payload'")
                    }
                }
                // Fallback: Try to extract from service data (legacy, not base64)
                if (payload == null) {
                    scanRecord?.serviceData?.get(SERVICE_UUID)?.let { data ->
                        payload = String(data)
                        Log.d(TAG, "  Extracted compact payload from serviceData: '$payload'")
                    }
                }
                // Fallback: local name with "MW:" prefix — iOS peripherals can't embed raw
                // manufacturer data, so BLEAdvertiserModule.swift encodes the payload in the
                // local advertisement name instead. scanRecord.deviceName reads AD type 0x08/0x09
                // from the packet bytes and does NOT require BLUETOOTH_CONNECT permission.
                if (payload == null) {
                    val localName = scanRecord?.deviceName
                    if (localName != null && localName.startsWith("MW:")) {
                        val b64 = localName.removePrefix("MW:")
                        try {
                            val bytes = Base64.decode(b64, Base64.NO_WRAP)
                            if (bytes.isNotEmpty()) {
                                payload = b64
                                Log.d(TAG, "  Extracted payload from local name (iOS peripheral): '$payload'")
                            }
                        } catch (_: Exception) {
                            Log.w(TAG, "  MW: local name has invalid base64 payload")
                        }
                    }
                }

                val deviceMap = Arguments.createMap().apply {
                    putString("id", scanResult.device.address)
                    putString("name", scanResult.device.name)
                    putInt("rssi", scanResult.rssi)
                    payload?.let { putString("payload", it) }
                }
                sendEvent("onDeviceFound", deviceMap)
            }
        }

        override fun onBatchScanResults(results: MutableList<ScanResult>?) {
            Log.d(TAG, "onBatchScanResults: ${results?.size} results")
            results?.forEach { onScanResult(0, it) }
        }

        override fun onScanFailed(errorCode: Int) {
            val errorMessage = when(errorCode) {
                SCAN_FAILED_ALREADY_STARTED -> "Scan already started"
                SCAN_FAILED_APPLICATION_REGISTRATION_FAILED -> "Application registration failed"
                SCAN_FAILED_FEATURE_UNSUPPORTED -> "Feature unsupported"
                SCAN_FAILED_INTERNAL_ERROR -> "Internal error"
                else -> "Unknown error: $errorCode"
            }
            Log.e(TAG, "onScanFailed: $errorMessage")
            
            sendEvent("onScanError", Arguments.createMap().apply { 
                putString("message", errorMessage)
                putInt("code", errorCode)
            })
        }
    }

    private fun hasScanPermission(): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            return ActivityCompat.checkSelfPermission(
                reactApplicationContext,
                Manifest.permission.BLUETOOTH_SCAN
            ) == PackageManager.PERMISSION_GRANTED
        } else {
            return ActivityCompat.checkSelfPermission(
                reactApplicationContext,
                Manifest.permission.ACCESS_FINE_LOCATION
            ) == PackageManager.PERMISSION_GRANTED
        }
    }

    @ReactMethod
    fun startScan(serviceUUID: String) {
        if (!hasScanPermission()) {
            Log.w(TAG, "startScan: Required permissions not granted")
            sendEvent("onScanError", Arguments.createMap().apply { 
                putString("message", "BLUETOOTH_SCAN or ACCESS_FINE_LOCATION permission not granted") 
            })
            return
        }
        
        if (bluetoothAdapter?.isEnabled != true) {
            Log.w(TAG, "startScan: Bluetooth is not enabled")
            sendEvent("onScanError", Arguments.createMap().apply { 
                putString("message", "Bluetooth is not enabled") 
            })
            return
        }
        
        if (isScanning) {
            Log.w(TAG, "startScan: already scanning, ignoring duplicate request")
            return
        }

        Log.d(TAG, "startScan called with serviceUUID: $serviceUUID")
        
        val scanFilter = ScanFilter.Builder()
            .setServiceUuid(ParcelUuid.fromString(serviceUUID))
            .build()
            
        val scanSettings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .setReportDelay(0) // Report immediately
            .build()
            
        try {
            scanner?.startScan(listOf(scanFilter), scanSettings, scanCallback)
            isScanning = true
            Log.d(TAG, "startScan succeeded")
        } catch (e: SecurityException) {
            Log.e(TAG, "startScan failed: ${e.message}", e)
            isScanning = false
            sendEvent("onScanError", Arguments.createMap().apply { 
                putString("message", "Security exception: ${e.message}") 
            })
        } catch (e: Exception) {
            Log.e(TAG, "startScan failed: ${e.message}", e)
            isScanning = false
            sendEvent("onScanError", Arguments.createMap().apply { 
                putString("message", "startScan failed: ${e.message}") 
            })
        }
    }

    @ReactMethod
    fun startScanNoFilter() {
        if (!hasScanPermission()) {
            Log.w(TAG, "startScanNoFilter: Required permissions not granted")
            sendEvent("onScanError", Arguments.createMap().apply { 
                putString("message", "BLUETOOTH_SCAN or ACCESS_FINE_LOCATION permission not granted") 
            })
            return
        }
        
        if (bluetoothAdapter?.isEnabled != true) {
            Log.w(TAG, "startScanNoFilter: Bluetooth is not enabled")
            sendEvent("onScanError", Arguments.createMap().apply { 
                putString("message", "Bluetooth is not enabled") 
            })
            return
        }
        
        if (isScanning) {
            Log.w(TAG, "startScanNoFilter: already scanning, ignoring duplicate request")
            return
        }

        Log.d(TAG, "startScanNoFilter called (discovering all devices)")
        
        val scanSettings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .setReportDelay(0)
            .build()
            
        try {
            scanner?.startScan(null, scanSettings, scanCallback)
            isScanning = true
            Log.d(TAG, "startScanNoFilter succeeded")
        } catch (e: SecurityException) {
            Log.e(TAG, "startScanNoFilter failed: ${e.message}", e)
            isScanning = false
            sendEvent("onScanError", Arguments.createMap().apply { 
                putString("message", "Security exception: ${e.message}") 
            })
        } catch (e: Exception) {
            Log.e(TAG, "startScanNoFilter failed: ${e.message}", e)
            isScanning = false
            sendEvent("onScanError", Arguments.createMap().apply { 
                putString("message", e.message) 
            })
        }
    }

    @ReactMethod
    fun stopScan() {
        if (!hasScanPermission()) {
            Log.w(TAG, "stopScan: Required permissions not granted")
            return
        }
        
        try {
            scanner?.stopScan(scanCallback)
            isScanning = false
            Log.d(TAG, "stopScan succeeded")
        } catch (e: Exception) {
            Log.e(TAG, "stopScan failed: ${e.message}", e)
        }
    }

    private fun sendEvent(eventName: String, params: WritableMap?) {
        try {
            reactApplicationContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(eventName, params)
        } catch (e: Exception) {
            Log.e(TAG, "sendEvent failed: ${e.message}")
        }
    }
}