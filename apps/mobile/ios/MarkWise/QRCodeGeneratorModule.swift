import Foundation
import CoreImage
import CoreImage.CIFilterBuiltins
import UIKit
import React

@objc(QRCodeGenerator)
class QRCodeGeneratorModule: NSObject {

  @objc static func requiresMainQueueSetup() -> Bool { false }

  private let ciContext = CIContext(options: [.useSoftwareRenderer: false])

  @objc func generateQRCode(
    _ content: String,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    guard !content.isEmpty else {
      reject("E_QR_EMPTY", "QR code content must not be empty", nil)
      return
    }
    guard let data = content.data(using: .utf8) else {
      reject("E_QR_ENCODE", "Failed to encode content as UTF-8", nil)
      return
    }

    // Generate standard QR code with medium error correction for better scannability.
    // Data security is provided by HMAC-SHA256 signing (see qrSigning.js),
    // so no visual obfuscation is needed.
    let filter = CIFilter.qrCodeGenerator()
    filter.message = data
    filter.correctionLevel = "M"  // Medium error correction (15% recovery)

    guard let ciImage = filter.outputImage else {
      reject("E_QR_GENERATE", "CIFilter failed to produce output image", nil)
      return
    }

    let size = Int(ciImage.extent.width)  // module count (e.g. 33 for v4)

    // Render module-resolution CGImage (createCGImage flips CI coords so row 0 = QR top)
    guard let moduleCGImage = ciContext.createCGImage(ciImage, from: ciImage.extent) else {
      reject("E_QR_RENDER", "Failed to render module image", nil)
      return
    }

    // Read module values into RGBA pixel buffer (row 0 = QR top-left = finder pattern)
    var rawData = [UInt8](repeating: 0, count: size * size * 4)
    guard let pixCtx = CGContext(
      data: &rawData,
      width: size, height: size,
      bitsPerComponent: 8, bytesPerRow: size * 4,
      space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else {
      reject("E_QR_CTX", "Failed to create pixel context", nil)
      return
    }
    pixCtx.draw(moduleCGImage, in: CGRect(x: 0, y: 0, width: size, height: size))
    // rawData[(row * size + col) * 4] is the R channel — 0 = dark module, 255 = light module

    // Build larger output at 800×800 with 4-module quiet zone for better scanner compatibility
    let QUIET = 4
    let TOTAL = size + 2 * QUIET
    let OUTPUT_PX = 800  // Increased from 512 for better scanning
    let moduleSize = OUTPUT_PX / TOTAL
    let actualOutput = moduleSize * TOTAL

    let renderer = UIGraphicsImageRenderer(
      size: CGSize(width: actualOutput, height: actualOutput)
    )
    let outputImage = renderer.image { ctx in
      UIColor.white.setFill()
      ctx.fill(CGRect(x: 0, y: 0, width: actualOutput, height: actualOutput))
      UIColor.black.setFill()

      // Render standard QR code without visual obfuscation
      for row in 0 ..< size {
        for col in 0 ..< size {
          let isDark = rawData[(row * size + col) * 4] < 128
          if isDark {
            ctx.fill(CGRect(
              x: (QUIET + col) * moduleSize,
              y: (QUIET + row) * moduleSize,
              width: moduleSize, height: moduleSize
            ))
          }
        }
      }
    }

    guard let pngData = outputImage.pngData() else {
      reject("E_QR_PNG", "Failed to encode output as PNG", nil)
      return
    }
    resolve(pngData.base64EncodedString())
  }
}
