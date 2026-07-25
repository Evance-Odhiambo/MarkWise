# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# -----------------------------------------------------------------------
# React Native
# -----------------------------------------------------------------------
-keep class com.facebook.react.** { *; }
-keep class com.facebook.hermes.** { *; }
-keep class com.facebook.jni.** { *; }
-dontwarn com.facebook.**

# -----------------------------------------------------------------------
# React Native Vector Icons
# -----------------------------------------------------------------------
-keep class com.oblador.vectoricons.** { *; }

# -----------------------------------------------------------------------
# React Native Reanimated
# -----------------------------------------------------------------------
-keep class com.swmansion.reanimated.** { *; }
-dontwarn com.swmansion.reanimated.**

# -----------------------------------------------------------------------
# React Native Gesture Handler
# -----------------------------------------------------------------------
-keep class com.swmansion.gesturehandler.** { *; }

# -----------------------------------------------------------------------
# React Native Screens
# -----------------------------------------------------------------------
-keep class com.swmansion.rnscreens.** { *; }

# -----------------------------------------------------------------------
# React Native BLE PLX
# -----------------------------------------------------------------------
-keep class com.polidea.rxandroidble2.** { *; }
-dontwarn com.polidea.rxandroidble2.**

# -----------------------------------------------------------------------
# React Native Keychain
# -----------------------------------------------------------------------
-keep class com.oblador.keychain.** { *; }

# -----------------------------------------------------------------------
# React Native Safe Area Context
# -----------------------------------------------------------------------
-keep class com.th3rdwave.safeareacontext.** { *; }

# -----------------------------------------------------------------------
# React Native PDF
# -----------------------------------------------------------------------
-keep class com.github.barteksc.pdfviewer.** { *; }
-dontwarn com.github.barteksc.pdfviewer.**
-keep class com.tom_roush.pdfbox.** { *; }
-dontwarn com.tom_roush.pdfbox.**
-dontwarn openjpeg2000.**
-dontwarn org.apache.pdfbox.**
-dontwarn com.gemalto.jp2.**

# -----------------------------------------------------------------------
# React Native HTML to PDF
# -----------------------------------------------------------------------
-keep class com.htmltopdf.** { *; }
-keep class android.print.** { *; }
-dontwarn android.print.**

# -----------------------------------------------------------------------
# React Native FS
# -----------------------------------------------------------------------
-keep class com.rnfs.** { *; }

# -----------------------------------------------------------------------
# React Native Share
# -----------------------------------------------------------------------
-keep class cl.json.RNShare** { *; }

# -----------------------------------------------------------------------
# ML Kit (barcode scanning)
# -----------------------------------------------------------------------
-keep class com.google.mlkit.** { *; }
-dontwarn com.google.mlkit.**

# -----------------------------------------------------------------------
# ZXing
# -----------------------------------------------------------------------
-keep class com.journeyapps.** { *; }
-keep class com.google.zxing.** { *; }

# -----------------------------------------------------------------------
# OkHttp / Okio (used by many networking libraries)
# -----------------------------------------------------------------------
-dontwarn okio.**
-dontwarn okhttp3.**
-keep class okhttp3.** { *; }
-keep interface okhttp3.** { *; }

# -----------------------------------------------------------------------
# Kotlin
# -----------------------------------------------------------------------
-keep class kotlin.** { *; }
-dontwarn kotlin.**

# -----------------------------------------------------------------------
# Keep JavaScript interface classes accessible from JS
# -----------------------------------------------------------------------
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# -----------------------------------------------------------------------
# Keep enum values (commonly needed at runtime)
# -----------------------------------------------------------------------
-keepclassmembers enum * {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}

# -----------------------------------------------------------------------
# Keep Parcelable implementations
# -----------------------------------------------------------------------
-keepclassmembers class * implements android.os.Parcelable {
    public static final ** CREATOR;
}

# -----------------------------------------------------------------------
# React Native Firebase (app + messaging)
# -----------------------------------------------------------------------
-keep class io.invertase.firebase.** { *; }
-dontwarn io.invertase.firebase.**
-keep class com.google.firebase.** { *; }
-dontwarn com.google.firebase.**
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.android.gms.**

# -----------------------------------------------------------------------
# React Native Notify Kit (Notifee)
# -----------------------------------------------------------------------
-keep class app.notifee.** { *; }
-dontwarn app.notifee.**
-keep class io.invertase.notifee.** { *; }

# -----------------------------------------------------------------------
# React Native Background Actions
# -----------------------------------------------------------------------
-keep class com.asterinet.react.bgactions.** { *; }
-dontwarn com.asterinet.react.bgactions.**

# -----------------------------------------------------------------------
# React Native WebView
# -----------------------------------------------------------------------
-keep class com.reactnativecommunity.webview.** { *; }
-dontwarn com.reactnativecommunity.webview.**

# -----------------------------------------------------------------------
# React Native Blob Util
# -----------------------------------------------------------------------
-keep class com.ReactNativeBlobUtil.** { *; }
-dontwarn com.ReactNativeBlobUtil.**

# -----------------------------------------------------------------------
# React Native SQLite Storage
# -----------------------------------------------------------------------
-keep class org.pgsqlite.** { *; }
-dontwarn org.pgsqlite.**

# -----------------------------------------------------------------------
# React Native Device Info
# -----------------------------------------------------------------------
-keep class com.learnium.RNDeviceInfo.** { *; }
-dontwarn com.learnium.RNDeviceInfo.**

# -----------------------------------------------------------------------
# React Native Sensors
# -----------------------------------------------------------------------
-keep class com.sensors.** { *; }
-dontwarn com.sensors.**

# -----------------------------------------------------------------------
# React Native Worklets
# -----------------------------------------------------------------------
-keep class com.swmansion.worklets.** { *; }
-dontwarn com.swmansion.worklets.**

# -----------------------------------------------------------------------
# React Native Async Storage
# -----------------------------------------------------------------------
-keep class com.reactnativecommunity.asyncstorage.** { *; }
-dontwarn com.reactnativecommunity.asyncstorage.**

# -----------------------------------------------------------------------
# React Native Clipboard
# -----------------------------------------------------------------------
-keep class com.reactnativecommunity.clipboard.** { *; }
-dontwarn com.reactnativecommunity.clipboard.**

# -----------------------------------------------------------------------
# React Native Net Info
# -----------------------------------------------------------------------
-keep class com.reactnativecommunity.netinfo.** { *; }
-dontwarn com.reactnativecommunity.netinfo.**

# -----------------------------------------------------------------------
# CameraX
# -----------------------------------------------------------------------
-keep class androidx.camera.** { *; }
-dontwarn androidx.camera.**

# -----------------------------------------------------------------------
# Guava (used by CameraX + Firebase)
# -----------------------------------------------------------------------
-dontwarn com.google.common.**
-keep class com.google.common.** { *; }
-dontwarn com.google.guava.**

# -----------------------------------------------------------------------
# Serialization — keep all classes with @Keep or used via reflection
# -----------------------------------------------------------------------
-keepattributes *Annotation*
-keepattributes Signature
-keepattributes Exceptions
-keepattributes InnerClasses
-keepattributes EnclosingMethod
