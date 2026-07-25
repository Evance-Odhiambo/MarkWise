import UIKit
import AVFoundation
import React
import ZXingObjC

/// AVFoundation + ZXingObjC camera view that emits `onBarcodeScan` and `onCameraReady`.
/// Replaces the Vision-based decoder so we can intercept between QR locate and decode,
/// letting us undo the visual inversion mask before the decoder sees the bits.
class MLKitCameraViewImpl: UIView,
                           AVCaptureVideoDataOutputSampleBufferDelegate {

  @objc var onBarcodeScan: RCTDirectEventBlock?
  @objc var onCameraReady: RCTDirectEventBlock?

  private var captureSession: AVCaptureSession?
  private var previewLayer: AVCaptureVideoPreviewLayer?
  private let sessionQueue = DispatchQueue(label: "com.markwise.camera.session")
  private let ciContext = CIContext(options: [.useSoftwareRenderer: false])

  // Per-QR-size inverse-mask cache: flat [Bool] where index = row*size+col.
  // Avoids recomputing shouldInvert in the inner loop on every decode.
  private var maskCache: [Int: [Bool]] = [:]

  // Throttle bridge emissions to 100 ms — allows fast double-scanning while
  // preventing 30 fps event storms from flooding the JS bridge.
  private var lastEmitTime: TimeInterval = 0

  override init(frame: CGRect) {
    super.init(frame: frame)
    backgroundColor = .black
  }

  required init?(coder: NSCoder) { fatalError() }

  // MARK: - Layout

  override func layoutSubviews() {
    super.layoutSubviews()
    previewLayer?.frame = bounds
  }

  // MARK: - React lifecycle

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil {
      startSessionIfNeeded()
    } else {
      stopSession()
    }
  }

  override func removeFromSuperview() {
    stopSession()
    super.removeFromSuperview()
  }

  // MARK: - Camera setup

  private func startSessionIfNeeded() {
    guard captureSession == nil else { return }
    checkPermissionAndStart()
  }

  private func checkPermissionAndStart() {
    switch AVCaptureDevice.authorizationStatus(for: .video) {
    case .authorized:
      configureAndStart()
    case .notDetermined:
      AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
        if granted { self?.configureAndStart() }
      }
    default:
      break
    }
  }

  private func configureAndStart() {
    sessionQueue.async { [weak self] in
      guard let self else { return }
      let session = AVCaptureSession()
      session.sessionPreset = .hd1280x720

      guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
            let input = try? AVCaptureDeviceInput(device: device),
            session.canAddInput(input)
      else { return }
      session.addInput(input)

      let output = AVCaptureVideoDataOutput()
      output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String:
                                kCVPixelFormatType_32BGRA]
      output.alwaysDiscardsLateVideoFrames = true
      output.setSampleBufferDelegate(self, queue: self.sessionQueue)
      guard session.canAddOutput(output) else { return }
      session.addOutput(output)

      DispatchQueue.main.async { [weak self] in
        guard let self else { return }
        let previewLayer = AVCaptureVideoPreviewLayer(session: session)
        previewLayer.videoGravity = .resizeAspectFill
        previewLayer.frame = self.bounds
        self.layer.insertSublayer(previewLayer, at: 0)
        self.previewLayer = previewLayer
        self.captureSession = session
        session.startRunning()
        self.onCameraReady?([:])
      }
    }
  }

  private func stopSession() {
    sessionQueue.async { [weak self] in
      self?.captureSession?.stopRunning()
      self?.captureSession = nil
      DispatchQueue.main.async { [weak self] in
        self?.previewLayer?.removeFromSuperlayer()
        self?.previewLayer = nil
      }
    }
  }

  // MARK: - AVCaptureVideoDataOutputSampleBufferDelegate

  func captureOutput(
    _ output: AVCaptureOutput,
    didOutput sampleBuffer: CMSampleBuffer,
    from connection: AVCaptureConnection
  ) {
    guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }

    let fullW = CVPixelBufferGetWidth(pixelBuffer)
    let fullH = CVPixelBufferGetHeight(pixelBuffer)

    // Crop to centre 75% square — reduces pixel work by ~44% vs full frame.
    let cropSize = Int(Double(min(fullW, fullH)) * 0.75)
    let cropL = (fullW - cropSize) / 2
    let cropT = (fullH - cropSize) / 2
    let cropRect = CGRect(x: cropL, y: cropT, width: cropSize, height: cropSize)

    // Convert cropped region to CGImage for ZXingObjC luminance source.
    let ciImage = CIImage(cvPixelBuffer: pixelBuffer).cropped(to: cropRect)
    guard let cgImage = ciContext.createCGImage(ciImage, from: ciImage.extent) else { return }

    // Fast path: GlobalHistogramBinarizer (~3–5× faster, works in normal light)
    // Slow path: HybridBinarizer for backlit / low-contrast scenes
    guard let rawValue = tryDecode(cgImage: cgImage, fast: true)
                      ?? tryDecode(cgImage: cgImage, fast: false)
    else { return }

    let now = Date().timeIntervalSinceReferenceDate
    guard now - lastEmitTime >= 0.1 else { return }
    lastEmitTime = now

    DispatchQueue.main.async { [weak self] in
      self?.onBarcodeScan?(["data": rawValue])
    }
  }

  // MARK: - Decode helpers

  private func tryDecode(cgImage: CGImage, fast: Bool) -> String? {
    guard let source = ZXCGImageLuminanceSource(cgImage: cgImage) else { return nil }

    let binarizer: ZXBinarizer = fast
      ? ZXGlobalHistogramBinarizer(source: source)
      : ZXHybridBinarizer(source: source)

    guard let bitmap = ZXBinaryBitmap(binarizer: binarizer) else { return nil }
    var error: NSError?
    guard let matrix = bitmap.blackMatrix(&error) else { return nil }

    let detector = ZXQRCodeDetector(image: matrix)
    guard let detectorResult = detector.detect(hints: nil, error: &error),
          let bits = detectorResult.bits
    else { return nil }

    let size = Int(bits.width)
    let mask = cachedMask(for: size)
    let decoder = ZXQRCodeDecoder()

    // Try with MarkWise inverse mask removed first
    applyMask(mask, to: bits, size: size)
    if let result = decoder.decode(bits, hints: nil, error: &error), let text = result.text {
      return text
    }
    // XOR is self-inverse: reapply restores original → try plain decode
    applyMask(mask, to: bits, size: size)
    if let result = decoder.decode(bits, hints: nil, error: &error), let text = result.text {
      return text
    }
    return nil
  }

  private func cachedMask(for size: Int) -> [Bool] {
    if let cached = maskCache[size] { return cached }
    var mask = [Bool](repeating: false, count: size * size)
    for row in 0 ..< size {
      for col in 0 ..< size {
        mask[row * size + col] = shouldInvert(row: row, col: col, size: size)
      }
    }
    maskCache[size] = mask
    return mask
  }

  private func applyMask(_ mask: [Bool], to bits: ZXBitMatrix, size: Int) {
    for i in 0 ..< mask.count where mask[i] {
      bits.flipX(Int32(i % size), y: Int32(i / size))
    }
  }

  // MARK: - Inverse mask (mirror of MLKitCameraView.kt + QRCodeGeneratorModule.swift)

  private func shouldInvert(row: Int, col: Int, size: Int) -> Bool {
    if row < 9 && col < 9 { return false }
    if row < 9 && col >= size - 8 { return false }
    if row >= size - 8 && col < 9 { return false }
    if row == 6 || col == 6 { return false }
    return (row + col) % 2 == 0
  }
}
