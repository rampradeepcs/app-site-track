# R8 rules for the Workfence phone app.
#
# The app is a Capacitor shell: almost everything a user touches is JavaScript
# in assets/, and the Java here exists to hand the web layer the camera, the
# GPS and the watch. That shapes every rule below — the danger is not dead code
# surviving, it is R8 renaming a class that something looks up by STRING at
# runtime, which fails silently in release and nowhere else.

# ---------------------------------------------------------------------------
# Plugins resolved by name, not by reference
# ---------------------------------------------------------------------------
# assets/capacitor.plugins.json lists these as text and Capacitor loads them
# with Class.forName(). Renaming any of them takes out the feature it backs —
# and for camera and geolocation that means check-in stops working at all.
#
# Capacitor's own consumer rules already keep anything extending Plugin. These
# repeat that for the exact seven, because the cost of being wrong is a release
# that installs, opens, and cannot record a day's work.
-keep class com.getcapacitor.community.speechrecognition.SpeechRecognition { *; }
-keep class com.capacitorjs.plugins.app.AppPlugin { *; }
-keep class com.capacitorjs.plugins.browser.BrowserPlugin { *; }
-keep class com.capacitorjs.plugins.camera.CameraPlugin { *; }
-keep class com.capacitorjs.plugins.geolocation.GeolocationPlugin { *; }
-keep class com.capacitorjs.plugins.network.NetworkPlugin { *; }
-keep class com.capacitorjs.plugins.preferences.PreferencesPlugin { *; }

# Ours, registered by hand in MainActivity. The .class reference keeps them
# alive; this keeps their METHODS, which the bridge finds reflectively.
-keep class app.workfence.workforce.ContactPickerPlugin { *; }
-keep class app.workfence.workforce.WatchPlugin { *; }

# ---------------------------------------------------------------------------
# The bridge itself
# ---------------------------------------------------------------------------
# Every call from JavaScript arrives through a @JavascriptInterface method.
# The default Android config keeps these, but the bridge is the one seam where
# a mistake silences the entire app, so it is stated here rather than assumed.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Capacitor reads plugin configuration by reflecting over annotation members.
-keepattributes *Annotation*, Signature, InnerClasses, EnclosingMethod

# ---------------------------------------------------------------------------
# Readable crashes
# ---------------------------------------------------------------------------
# Without these, every Play Console stack trace is obfuscated line noise. The
# mapping file is uploaded with the bundle, but keeping line numbers means a
# trace is legible even before anyone goes looking for the mapping.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# ---------------------------------------------------------------------------
# Wearable
# ---------------------------------------------------------------------------
# WatchPlugin talks to the phone half of the Data Layer. Play Services ships
# its own consumer rules; this covers the listener interface it resolves by
# name when a message arrives from the watch.
-keep interface com.google.android.gms.wearable.MessageClient$OnMessageReceivedListener { *; }
-keep interface com.google.android.gms.wearable.DataClient$OnDataChangedListener { *; }
