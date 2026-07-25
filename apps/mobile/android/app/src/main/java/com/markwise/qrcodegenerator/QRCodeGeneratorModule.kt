package com.markwise.qrcodegenerator

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import java.io.ByteArrayOutputStream

class QRCodeGeneratorModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "QRCodeGenerator"

    @ReactMethod
    fun generateQRCode(content: String, promise: Promise) {
        try {
            // Generate standard QR code with medium error correction for better scannability.
            // MARGIN=0 + size=1 forces QRCodeWriter to output exactly 1px per module.
            // Data security is provided by HMAC-SHA256 signing (see qrSigning.js),
            // so no visual obfuscation is needed.
            val hints = mapOf(
                EncodeHintType.CHARACTER_SET to "UTF-8",
                EncodeHintType.MARGIN to 0,
                EncodeHintType.ERROR_CORRECTION to com.google.zxing.qrcode.decoder.ErrorCorrectionLevel.M
            )
            val moduleBits = QRCodeWriter().encode(content, BarcodeFormat.QR_CODE, 1, 1, hints)
            val size = moduleBits.width  // module count (e.g. 33 for version 4)

            // 4-module quiet zone as per QR spec + larger output for better scanning
            val QUIET = 4
            val TOTAL = size + 2 * QUIET
            val OUTPUT_PX = 800  // Increased from 512 for better scanner compatibility
            val moduleSize = OUTPUT_PX / TOTAL
            val actualOutput = moduleSize * TOTAL

            val bitmap = Bitmap.createBitmap(actualOutput, actualOutput, Bitmap.Config.RGB_565)
            val canvas = Canvas(bitmap)
            canvas.drawColor(Color.WHITE)

            val paint = Paint().apply {
                color = Color.BLACK
                style = Paint.Style.FILL
                isAntiAlias = false
            }

            // Render standard QR code without visual obfuscation
            for (row in 0 until size) {
                for (col in 0 until size) {
                    if (moduleBits.get(col, row)) {  // true = dark module
                        val left = ((QUIET + col) * moduleSize).toFloat()
                        val top = ((QUIET + row) * moduleSize).toFloat()
                        canvas.drawRect(left, top, left + moduleSize, top + moduleSize, paint)
                    }
                }
            }

            val baos = ByteArrayOutputStream()
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, baos)
            promise.resolve(Base64.encodeToString(baos.toByteArray(), Base64.DEFAULT))
        } catch (e: Exception) {
            promise.reject("QRCode generation failed", e)
        }
    }
}
