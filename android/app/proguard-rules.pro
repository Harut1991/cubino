# Keep line numbers for crash reports (upload mapping.txt to Play Console)
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Capacitor bridge / plugins (reflection + JS bridge)
-keep class com.getcapacitor.** { *; }
-keep class com.cubino.game.** { *; }
-keepclassmembers class * {
    @com.getcapacitor.annotation.CapacitorPlugin *;
    @com.getcapacitor.PluginMethod *;
}

# AdMob
-keep class com.google.android.gms.ads.** { *; }
-keep class com.google.android.gms.common.** { *; }
-keep class com.getcapacitor.community.admob.** { *; }
-dontwarn com.google.android.gms.**
