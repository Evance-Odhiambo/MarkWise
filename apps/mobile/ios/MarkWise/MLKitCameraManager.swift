import React

/// RCTViewManager that vends MLKitCameraViewImpl as the native component for
/// requireNativeComponent('MLKitCameraView').  The "Manager" suffix is stripped
/// by React Native's bridge discovery to expose the component as "MLKitCameraView".
@objc(MLKitCameraViewManager)
class MLKitCameraViewManager: RCTViewManager {
  override func view() -> UIView! {
    MLKitCameraViewImpl()
  }

  override static func requiresMainQueueSetup() -> Bool { true }
}
