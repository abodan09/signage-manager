package com.signage.tvplayer

import android.content.Intent
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetSocketAddress
import java.net.SocketAddress
import java.net.SocketTimeoutException

class SetupActivity : AppCompatActivity() {

    private var discoverySocket: DatagramSocket? = null
    @Volatile private var discoveryStopped = false
    @Volatile private var inForeground = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_setup)

        val prefs      = getSharedPreferences("signage", MODE_PRIVATE)
        val urlInput   = findViewById<EditText>(R.id.urlInput)
        val btnConnect = findViewById<Button>(R.id.btnConnect)
        val tvCurrent  = findViewById<TextView>(R.id.tvCurrent)

        // If launched via ADB intent, pre-fill and auto-save
        val adbUrl = intent.getStringExtra("SERVER_URL")
        if (!adbUrl.isNullOrBlank()) {
            prefs.edit().putString("server_url", adbUrl).apply()
            startMain()
            return
        }

        val saved = prefs.getString("server_url", "")
        if (!saved.isNullOrBlank()) {
            urlInput.setText(saved)
            tvCurrent.text = "Current: $saved"
        } else {
            tvCurrent.text = "Scanning for server on network…"
        }

        // Check for updates
        UpdateChecker.check(this, BuildConfig.VERSION_NAME)

        // If the previous run died, put the stack trace on screen — a sideloaded
        // TV app has no other way to report why it crashed.
        CrashReporter.showIfCrashed(this)

        // Start UDP discovery listener (runs even if a URL is saved, to pick up IP changes)
        startDiscoveryListener(urlInput, tvCurrent, prefs)

        btnConnect.setOnClickListener {
            stopDiscovery()
            val url = urlInput.text.toString().trim().trimEnd('/')
            if (url.isEmpty()) {
                Toast.makeText(this, "Please enter a server URL", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            if (!url.startsWith("http://") && !url.startsWith("https://")) {
                Toast.makeText(this, "URL must start with http:// or https://", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            prefs.edit().putString("server_url", url).apply()
            Toast.makeText(this, "Saved! Connecting…", Toast.LENGTH_SHORT).show()
            startMain()
        }
    }

    override fun onResume() {
        super.onResume()
        inForeground = true
    }

    override fun onPause() {
        super.onPause()
        inForeground = false
    }

    private fun startDiscoveryListener(
        urlInput: EditText,
        tvCurrent: TextView,
        prefs: android.content.SharedPreferences,
    ) {
        Thread {
            try {
                val socket = DatagramSocket(null as SocketAddress?).apply {
                    reuseAddress = true
                    broadcast = true
                    soTimeout = 15_000
                    bind(InetSocketAddress(47777))
                }
                discoverySocket = socket

                val buf = ByteArray(512)
                // Keep listening until a valid beacon arrives or the activity stops us.
                // A malformed/foreign packet must not end discovery.
                while (!discoveryStopped) {
                    val packet = DatagramPacket(buf, buf.size)
                    try {
                        socket.receive(packet)
                    } catch (_: SocketTimeoutException) {
                        continue
                    }
                    try {
                        val obj = JSONObject(String(packet.data, 0, packet.length))
                        if (obj.optString("type") != "signage-discovery") continue

                        val ip   = obj.getString("ip")
                        val port = obj.getInt("port")
                        val url  = "http://$ip:$port"

                        runOnUiThread {
                            prefs.edit().putString("server_url", url).apply()
                            urlInput.setText(url)
                            tvCurrent.text = "Auto-discovered: $url"
                            // Only navigate when we are the visible activity —
                            // starting an activity from the background is blocked
                            // on modern Android and would silently do nothing.
                            if (inForeground && !isFinishing) {
                                Toast.makeText(this, "Server found! Connecting…", Toast.LENGTH_SHORT).show()
                                startMain()
                            }
                        }
                        return@Thread
                    } catch (_: Exception) {
                        // Not our packet — keep listening
                    }
                }
            } catch (_: Exception) {
                // Bind failed (port in use) or socket closed — discovery unavailable
            }
        }.start()
    }

    private fun stopDiscovery() {
        discoveryStopped = true
        try { discoverySocket?.close() } catch (_: Exception) {}
        discoverySocket = null
    }

    override fun onDestroy() {
        super.onDestroy()
        stopDiscovery()
    }

    private fun startMain() {
        startActivity(Intent(this, MainActivity::class.java))
        finish()
    }
}
