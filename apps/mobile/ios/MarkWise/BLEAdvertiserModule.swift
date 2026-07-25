import Foundation
import CoreBluetooth
import React
import UIKit

private let kServiceUUID = CBUUID(string: "00001101-0000-1000-8000-00805F9B34FB")
private let kLocalNamePrefix = "MW:"

/// iOS BLE Advertiser – matches the Android BLEAdvertiserModule interface.
///
/// iOS CBPeripheralManager cannot embed raw manufacturer-specific data in advertisements
/// (unlike Android), so we encode the 7-byte payload as base64 in the local advertisement
/// name prefixed with "MW:" — the matching BLEScannerModule detects this prefix on iOS.
/// Android devices will see the service UUID advertisement from iOS peripherals and ignore
/// the local name, so iOS-advertised payloads are iOS-to-iOS only.  Android-advertised payloads
/// (manufacturer data 0x1234) are fully detected by the iOS BLEScannerModule.
@objc(BLEAdvertiserModule)
class BLEAdvertiserModule: NSObject, CBPeripheralManagerDelegate {

  private var peripheralManager: CBPeripheralManager?
  private var isAdvertising = false
  private var currentPayload: String?
  /// Queued resolve block waiting for the peripheral manager to report its first real state.
  private var pendingAdvertisingSupportedResolve: RCTPromiseResolveBlock?

  @objc static func requiresMainQueueSetup() -> Bool { false }

  // MARK: - React Methods

  @objc func isAdvertisingSupported(
    _ resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    // Ensure the manager exists so we get a real state reading.
    if peripheralManager == nil {
      peripheralManager = CBPeripheralManager(delegate: self, queue: nil, options: [
        CBPeripheralManagerOptionShowPowerAlertKey: false
      ])
    }
    switch peripheralManager!.state {
    case .poweredOn:
      resolve(true)
    case .poweredOff, .unauthorized, .unsupported:
      resolve(false)
    case .unknown, .resetting:
      // Manager is still initialising — resolve once the delegate fires.
      pendingAdvertisingSupportedResolve = resolve
    @unknown default:
      resolve(false)
    }
  }

  @objc func isBluetoothEnabled(
    _ resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    let state = peripheralManager?.state ?? CBManagerState.unknown
    resolve(state == .poweredOn)
  }

  @objc func requestEnableBluetooth(
    _ resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    // iOS does not support programmatic Bluetooth enablement; redirect to Settings.
    DispatchQueue.main.async {
      if let url = URL(string: UIApplication.openSettingsURLString) {
        UIApplication.shared.open(url, options: [:], completionHandler: nil)
      }
      resolve(false)
    }
  }

  @objc func startAdvertising(
    _ data: String,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    // Validate the base64 payload
    guard Data(base64Encoded: data) != nil else {
      reject("E_BLE_BASE64_DECODE", "Failed to decode base64 payload", nil)
      return
    }

    currentPayload = data
    if peripheralManager == nil {
      // Delegate callback (peripheralManagerDidUpdateState) will start advertising
      peripheralManager = CBPeripheralManager(delegate: self, queue: nil, options: [
        CBPeripheralManagerOptionShowPowerAlertKey: true
      ])
    } else if peripheralManager?.state == .poweredOn {
      beginAdvertising()
    }
    // If BT is off, we'll start in peripheralManagerDidUpdateState
    resolve(nil)
  }

  @objc func stopAdvertising(
    _ resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    peripheralManager?.stopAdvertising()
    isAdvertising = false
    currentPayload = nil
    resolve(nil)
  }

  // MARK: - Private

  private func beginAdvertising() {
    guard let peripheralManager,
          peripheralManager.state == .poweredOn,
          let payload = currentPayload
    else { return }

    if isAdvertising { peripheralManager.stopAdvertising() }

    // Encode payload in local name so iOS scanners can detect it via BLEScannerModule
    let localName = kLocalNamePrefix + payload
    peripheralManager.startAdvertising([
      CBAdvertisementDataServiceUUIDsKey: [kServiceUUID],
      CBAdvertisementDataLocalNameKey: localName,
    ])
    isAdvertising = true
  }

  // MARK: - CBPeripheralManagerDelegate

  func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
    // Resolve any pending isAdvertisingSupported call now that we have a real state.
    if let resolve = pendingAdvertisingSupportedResolve {
      pendingAdvertisingSupportedResolve = nil
      resolve(peripheral.state == .poweredOn)
    }

    if peripheral.state == .poweredOn, currentPayload != nil {
      beginAdvertising()
    } else if peripheral.state != .poweredOn {
      isAdvertising = false
    }
  }

  func peripheralManagerDidStartAdvertising(_ peripheral: CBPeripheralManager, error: Error?) {
    if let error {
      isAdvertising = false
      NSLog("[BLEAdvertiserModule] Failed to start advertising: %@", error.localizedDescription)
    } else {
      isAdvertising = true
    }
  }
}
