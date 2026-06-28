# Signage TV Player — ProGuard rules
# WebView JS interface and related classes must not be obfuscated
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class com.signage.tvplayer.** { *; }
