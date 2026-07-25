package com.markwise.mlkit

import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext

class MLKitCameraManager : SimpleViewManager<MLKitCameraView>() {

    override fun getName() = "MLKitCameraView"

    override fun createViewInstance(reactContext: ThemedReactContext): MLKitCameraView {
        return MLKitCameraView(reactContext)
    }

    override fun getExportedCustomDirectEventTypeConstants(): MutableMap<String, Any> {
        return mutableMapOf(
            "onBarcodeScan" to mutableMapOf("registrationName" to "onBarcodeScan")
        )
    }
}