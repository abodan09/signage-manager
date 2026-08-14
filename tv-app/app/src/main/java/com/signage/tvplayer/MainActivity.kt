package com.signage.tvplayer

import android.annotation.SuppressLint
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import android.view.View
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private var webViewDestroyed = false
    private var statusText: android.widget.TextView? = null
    private var mainFrameFailed = false
    private lateinit var prefs: android.content.SharedPreferences
    private var longPressHandler = Handler(Looper.getMainLooper())
    private var centerPressStart = 0L
    private val LONG_PRESS_MS = 3000L  // 3-second hold on OK/center to open settings

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        prefs = getSharedPreferences("signage", MODE_PRIVATE)

        // Redirect to setup if no server URL saved
        val serverUrl = prefs.getString("server_url", null)
        if (serverUrl.isNullOrBlank()) {
            startActivity(Intent(this, SetupActivity::class.java))
            finish()
            return
        }

        // Check if launched by ADB with a new SERVER_URL
        intent.getStringExtra("SERVER_URL")?.takeIf { it.isNotBlank() }?.let { newUrl ->
            prefs.edit().putString("server_url", newUrl).apply()
        }

        // Some Android TV boxes ship without a WebView provider — inflating the
        // layout then throws. Show a message instead of crashing on launch.
        try {
            setContentView(R.layout.activity_main)
            webView = findViewById(R.id.webView)
            statusText = findViewById(R.id.statusText)
        } catch (t: Throwable) {
            val msg = android.widget.TextView(this).apply {
                text = "Android System WebView is missing or disabled on this TV,\n" +
                    "so the Signage Player cannot run.\n\n" +
                    "Fix: TV Settings → Apps → See all apps → show system apps →\n" +
                    "\"Android System WebView\" → Enable (then update it in the Play Store)."
                setTextColor(0xFFF1F5F9.toInt())
                setBackgroundColor(0xFF0F172A.toInt())
                textSize = 20f
                gravity = android.view.Gravity.CENTER
            }
            setContentView(msg)
            CrashReporter.showIfCrashed(this)
            return
        }

        setupWebView()
        loadPlayer()
        CrashReporter.showIfCrashed(this)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            cacheMode = WebSettings.LOAD_DEFAULT
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            allowFileAccess = true
            loadWithOverviewMode = true
            useWideViewPort = true
            builtInZoomControls = false
            displayZoomControls = false
        }

        webView.webViewClient = object : WebViewClient() {

            private fun onMainFrameError() {
                mainFrameFailed = true
                val url = prefs.getString("server_url", "") ?: ""
                statusText?.text =
                    "Can't reach the server at $url — retrying every 5 seconds…\n" +
                    "Check that Signage Manager is open on the PC and that the TV and PC " +
                    "are on the same network. Hold OK for 3 seconds to change the address."
                statusText?.visibility = View.VISIBLE
                // Server unreachable — retry in 5 seconds
                Handler(Looper.getMainLooper()).postDelayed({
                    loadPlayer()
                }, 5000)
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                if (request?.isForMainFrame == true) onMainFrameError()
            }

            // API 21-22 delivers load errors only through this legacy callback
            @Deprecated("Deprecated in Java")
            override fun onReceivedError(
                view: WebView?,
                errorCode: Int,
                description: String?,
                failingUrl: String?
            ) {
                onMainFrameError()
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                // Fires for the built-in error page too — only clear the banner
                // when the last main-frame load actually succeeded.
                if (!mainFrameFailed) statusText?.visibility = View.GONE
                mainFrameFailed = false
            }

            // The WebView renderer runs out-of-process on Android 8+ and dies
            // when it hits an OOM or a codec bug (common on low-RAM TVs playing
            // heavy video). Returning false — the default — makes Android kill
            // the whole app. Swallow the crash and rebuild the player instead.
            override fun onRenderProcessGone(
                view: WebView?,
                detail: RenderProcessGoneDetail?
            ): Boolean {
                if (view != null) {
                    (view.parent as? android.view.ViewGroup)?.removeView(view)
                    view.destroy()
                    webViewDestroyed = true
                }
                Handler(Looper.getMainLooper()).postDelayed({
                    if (!isFinishing && !isDestroyed) recreate()
                }, 1000)
                return true
            }
        }

        // Hide system bars for true fullscreen kiosk mode
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_FULLSCREEN
            or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
        )
    }

    private fun loadPlayer() {
        val serverUrl = prefs.getString("server_url", "") ?: ""
        val deviceId  = prefs.getString("device_id", null)
            ?: java.util.UUID.randomUUID().toString().also { id ->
                prefs.edit().putString("device_id", id).apply()
            }
        webView.loadUrl("$serverUrl/tv/player?deviceId=$deviceId")
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        // Long-press on OK/DPAD_CENTER opens setup
        if (keyCode == KeyEvent.KEYCODE_DPAD_CENTER || keyCode == KeyEvent.KEYCODE_ENTER) {
            if (event?.repeatCount == 0) {
                centerPressStart = System.currentTimeMillis()
                longPressHandler.postDelayed({
                    startActivity(Intent(this, SetupActivity::class.java))
                }, LONG_PRESS_MS)
            }
            return true
        }
        // Back button — suppress (kiosk mode)
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onKeyUp(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_DPAD_CENTER || keyCode == KeyEvent.KEYCODE_ENTER) {
            longPressHandler.removeCallbacksAndMessages(null)
            return true
        }
        return super.onKeyUp(keyCode, event)
    }

    override fun onResume() {
        super.onResume()
        // Re-enter fullscreen if system UI was shown
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_FULLSCREEN
            or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        )
    }

    override fun onDestroy() {
        longPressHandler.removeCallbacksAndMessages(null)
        if (::webView.isInitialized && !webViewDestroyed) webView.destroy()
        super.onDestroy()
    }
}
