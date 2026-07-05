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

class SetupActivity : AppCompatActivity() {

    private var discoverySocket: DatagramSocket? = null

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

    private fun startDiscoveryListener(
        urlInput: EditText,
        tvCurrent: TextView,
        prefs: android.content.SharedPreferences,
    ) {
        Thread {
            try {
                val socket = DatagramSocket(47777)
                discoverySocket = socket
                socket.broadcast = true
                socket.soTimeout = 60_000   // wait up to 60 s for a broadcast

                val buf    = ByteArray(512)
                val packet = DatagramPacket(buf, buf.size)

                socket.receive(packet)
                val json = String(packet.data, 0, packet.length)
                val obj  = JSONObject(json)
                if (obj.optString("type") != "signage-discovery") return@Thread

                val ip   = obj.getString("ip")
                val port = obj.getInt("port")
                val url  = "http://$ip:$port"

                runOnUiThread {
                    urlInput.setText(url)
                    tvCurrent.text = "Auto-discovered: $url"
                    prefs.edit().putString("server_url", url).apply()
                    Toast.makeText(this, "Server found! Connecting…", Toast.LENGTH_SHORT).show()
                    startMain()
                }
            } catch (_: Exception) {
                // Timeout or closed — ignore
            }
        }.start()
    }

    private fun stopDiscovery() {
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
