package com.markwise.mlkit

import android.content.Context
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.widget.FrameLayout
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.lifecycle.LifecycleOwner
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.ReactContext
import com.facebook.react.uimanager.events.RCTEventEmitter
import com.google.zxing.BinaryBitmap
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.common.BitMatrix
import com.google.zxing.common.GlobalHistogramBinarizer
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.decoder.Decoder as ZXingQRDecoder
import com.google.zxing.qrcode.detector.Detector as ZXingQRDetector
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class MLKitCameraView(context: Context) : FrameLayout(context), LifecycleEventListener {

    private val previewView: PreviewView
    private var cameraProvider: ProcessCameraProvider? = null
    private var camera: Camera? = null
    private var imageAnalysis: ImageAnalysis? = null
    private val cameraExecutor: ExecutorService = Executors.newSingleThreadExecutor()
    private val reactContext: ReactContext = context as ReactContext
    private val mainHandler = Handler(Looper.getMainLooper())

    init {
        setBackgroundColor(Color.TRANSPARENT)
        previewView = PreviewView(context)
        previewView.layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
        previewView.implementationMode = PreviewView.ImplementationMode.COMPATIBLE
        previewView.scaleType = PreviewView.ScaleType.FILL_CENTER
        previewView.setBackgroundColor(Color.TRANSPARENT)
        addView(previewView)

        reactContext.addLifecycleEventListener(this)
        post { startCamera() }
    }

    override fun requestLayout() {
        super.requestLayout()
        post(this::measureAndLayout)
    }

    private fun measureAndLayout() {
        measure(
            MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY),
            MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY)
        )
        layout(left, top, right, bottom)
    }

    private fun startCamera() {
        cameraExecutor.execute {
            try {
                val provider = ProcessCameraProvider.getInstance(context)
                    .get(10, java.util.concurrent.TimeUnit.SECONDS)
                mainHandler.post {
                    try {
                        cameraProvider = provider
                        bindCameraUseCases()
                    } catch (exc: Exception) {
                        Log.e("MLKitCameraView", "Failed to bind camera use cases", exc)
                        scheduleRebind()
                    }
                }
            } catch (exc: Exception) {
                Log.e("MLKitCameraView", "Failed to initialize camera provider", exc)
                scheduleRebind()
            }
        }
    }

    private fun scheduleRebind(delayMs: Long = 250L) {
        mainHandler.removeCallbacksAndMessages(null)
        mainHandler.postDelayed({
            if (cameraProvider == null) startCamera() else bindCameraUseCases()
        }, delayMs)
    }

    private fun bindCameraUseCases() {
        val cameraProvider = cameraProvider ?: return
        val activity = reactContext.currentActivity
        if (activity !is LifecycleOwner) {
            Log.e("MLKitCameraView", "Could not get a LifecycleOwner.")
            scheduleRebind()
            return
        }

        val preview = Preview.Builder().build().also {
            it.setSurfaceProvider(previewView.surfaceProvider)
        }

        imageAnalysis = ImageAnalysis.Builder()
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .build()
            .also { it.setAnalyzer(cameraExecutor, BarcodeAnalyzer()) }

        try {
            cameraProvider.unbindAll()
            camera = cameraProvider.bindToLifecycle(activity, CameraSelector.DEFAULT_BACK_CAMERA, preview, imageAnalysis)
        } catch (exc: Exception) {
            Log.e("MLKitCameraView", "Use case binding failed", exc)
        }
    }

    private inner class BarcodeAnalyzer : ImageAnalysis.Analyzer {
        // Throttle bridge emissions so we don't flood JS with duplicate scan events.
        // 100ms allows fast double-scanning (student needs two distinct events) while
        // still preventing 30fps event storms.
        private var lastEmitMs = 0L

        @androidx.annotation.OptIn(androidx.camera.core.ExperimentalGetImage::class)
        override fun analyze(imageProxy: ImageProxy) {
            val mediaImage = imageProxy.image
            if (mediaImage == null) { imageProxy.close(); return }
            try {
                val yPlane = mediaImage.planes[0]
                val yBuffer = yPlane.buffer
                val yRowStride = yPlane.rowStride
                val fullWidth = mediaImage.width
                val fullHeight = mediaImage.height

                val yData = ByteArray(yBuffer.remaining())
                yBuffer.get(yData)

                // Crop to the centre 85% square — wide enough to catch QR codes near the frame
                // edge while still reducing pixel work ~28% vs full frame.
                val cropSize = (minOf(fullWidth, fullHeight) * 0.85f).toInt()
                val cropL = (fullWidth - cropSize) / 2
                val cropT = (fullHeight - cropSize) / 2

                // Fast path: GlobalHistogramBinarizer (~3–5× faster than Hybrid, works in normal light)
                // Slow path: HybridBinarizer for challenging lighting (backlit, low contrast)
                val rawValue =
                    tryDecode(yData, yRowStride, fullHeight, cropL, cropT, cropSize, cropSize, fast = true)
                    ?: tryDecode(yData, yRowStride, fullHeight, cropL, cropT, cropSize, cropSize, fast = false)
                    ?: return

                val now = System.currentTimeMillis()
                if (now - lastEmitMs < 100) return
                lastEmitMs = now

                mainHandler.post {
                    reactContext.getJSModule(RCTEventEmitter::class.java).receiveEvent(
                        id, "onBarcodeScan",
                        Arguments.createMap().apply { putString("data", rawValue) }
                    )
                }
            } catch (_: Exception) {
            } finally {
                imageProxy.close()
            }
        }

        private fun tryDecode(
            yData: ByteArray, dataWidth: Int, dataHeight: Int,
            left: Int, top: Int, width: Int, height: Int,
            fast: Boolean
        ): String? {
            return try {
                val source = PlanarYUVLuminanceSource(yData, dataWidth, dataHeight, left, top, width, height, false)
                val bitmap = if (fast) BinaryBitmap(GlobalHistogramBinarizer(source))
                             else BinaryBitmap(HybridBinarizer(source))
                val blackMatrix: BitMatrix = bitmap.blackMatrix
                val detector = ZXingQRDetector(blackMatrix)
                val bits = detector.detect(null).bits
                
                // Decode standard QR code directly (no visual inversion)
                ZXingQRDecoder().decode(bits, null).text
            } catch (_: Exception) {
                null
            }
        }
    }

    override fun onHostResume() { bindCameraUseCases() }

    override fun onHostPause() { cameraProvider?.unbindAll() }

    override fun onHostDestroy() {
        cameraProvider?.unbindAll()
        mainHandler.removeCallbacksAndMessages(null)
        cameraExecutor.shutdown()
        reactContext.removeLifecycleEventListener(this)
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        if (cameraProvider == null) startCamera() else bindCameraUseCases()
    }

    override fun onDetachedFromWindow() {
        super.onDetachedFromWindow()
        cameraProvider?.unbindAll()
        mainHandler.removeCallbacksAndMessages(null)
    }
}
