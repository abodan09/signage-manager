package com.signage.tvplayer

import android.annotation.SuppressLint
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import android.view.View
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
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

        setContentView(R.layout.activity_main)
        webView = findViewById(R.id.webView)

        setupWebView()
        loadPlayer()
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
            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                if (request?.isForMainFrame == true) {
                    // Server unreachable — retry in 5 seconds
                    Handler(Looper.getMainLooper()).postDelayed({
                        loadPlayer()
                    }, 5000)
                }
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
        webView.destroy()
        super.onDestroy()
    }
}
