import Foundation
import CoreBluetooth
import React

// Matches the Android companion manufacturer ID used in BLEAdvertiserModule
private let kManufacturerId: UInt16 = 0x1234
// Local-name prefix used by iOS advertising so iOS scanners can find iOS peripherals
private let kLocalNamePrefix = "MW:"
private let kServiceUUID = CBUUID(string: "00001101-0000-1000-8000-00805F9B34FB")

@objc(BLEScanner)
class BLEScannerModule: RCTEventEmitter, CBCentralManagerDelegate {

  private var centralManager: CBCentralManager?
  private var isScanning = false
  // Queued scan request received before Bluetooth powered on
  private var pendingScan: (() -> Void)?

  override static func requiresMainQueueSetup() -> Bool { false }

  override func supportedEvents() -> [String]! {
    ["onDeviceFound", "onScanError"]
  }

  // MARK: - React Methods

  @objc func startScan(_ serviceUUID: String) {
    ensureManager()
    let uuid = CBUUID(string: serviceUUID)
    let doScan = { [weak self] in
      guard let self else { return }
      guard !self.isScanning else { return }
      self.centralManager?.scanForPeripherals(
        withServices: [uuid],
        options: [CBCentralManagerScanOptionAllowDuplicatesKey: true]
      )
      self.isScanning = true
    }
    if centralManager?.state == .poweredOn { doScan() } else { pendingScan = doScan }
  }

  @objc func startScanNoFilter() {
    ensureManager()
    let doScan = { [weak self] in
      guard let self else { return }
      guard !self.isScanning else { return }
      self.centralManager?.scanForPeripherals(
        withServices: nil,
        options: [CBCentralManagerScanOptionAllowDuplicatesKey: true]
      )
      self.isScanning = true
    }
    if centralManager?.state == .poweredOn { doScan() } else { pendingScan = doScan }
  }

  @objc func stopScan() {
    centralManager?.stopScan()
    isScanning = false
    pendingScan = nil
  }

  // MARK: - Private

  private func ensureManager() {
    guard centralManager == nil else { return }
    centralManager = CBCentralManager(
      delegate: self,
      queue: nil,
      options: [CBCentralManagerOptionShowPowerAlertKey: false]
    )
  }

  // MARK: - CBCentralManagerDelegate

  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    if central.state == .poweredOn, let pending = pendingScan {
      pendingScan = nil
      pending()
    } else if central.state != .poweredOn {
      isScanning = false
      pendingScan = nil
      let msg: String
      switch central.state {
      case .poweredOff:    msg = "Bluetooth is powered off"
      case .unauthorized:  msg = "Bluetooth permission not granted"
      case .unsupported:   msg = "Bluetooth LE not supported on this device"
      default:             msg = "Bluetooth is not available"
      }
      sendEvent(withName: "onScanError", body: ["message": msg])
    }
  }

  func centralManager(
    _ central: CBCentralManager,
    didDiscover peripheral: CBPeripheral,
    advertisementData: [String: Any],
    rssi RSSI: NSNumber
  ) {
    var payload: String?

    // 1. Manufacturer data (Android broadcasts with manufacturer ID 0x1234; first 2 bytes are ID LE)
    if let mfgData = advertisementData[CBAdvertisementDataManufacturerDataKey] as? Data,
       mfgData.count >= 3
    {
      let mfgId = UInt16(mfgData[0]) | (UInt16(mfgData[1]) << 8)
      if mfgId == kManufacturerId {
        payload = mfgData.subdata(in: 2..<mfgData.count).base64EncodedString()
      }
    }

    // 2. Service data (iOS-advertised via service data fallback)
    if payload == nil,
       let serviceData = advertisementData[CBAdvertisementDataServiceDataKey] as? [CBUUID: Data],
       let data = serviceData[kServiceUUID]
    {
      payload = data.base64EncodedString()
    }

    // 3. Local name with "MW:" prefix (iOS peripheral advertising via BLEAdvertiserModule)
    if payload == nil,
       let localName = advertisementData[CBAdvertisementDataLocalNameKey] as? String,
       localName.hasPrefix(kLocalNamePrefix)
    {
      let encoded = String(localName.dropFirst(kLocalNamePrefix.count))
      if Data(base64Encoded: encoded) != nil {
        payload = encoded
      }
    }

    guard let payload else { return }

    var body: [String: Any] = [
      "id": peripheral.identifier.uuidString,
      "rssi": RSSI.intValue,
      "payload": payload,
    ]
    // Prefer local-name from advertisement; fall back to peripheral.name
    let name = (advertisementData[CBAdvertisementDataLocalNameKey] as? String) ?? peripheral.name
    if let name, !name.hasPrefix(kLocalNamePrefix) { body["name"] = name }

    sendEvent(withName: "onDeviceFound", body: body)
  }
}
