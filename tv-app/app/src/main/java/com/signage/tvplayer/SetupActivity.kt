package com.signage.tvplayer

import android.app.AlertDialog
import android.content.Intent
import android.net.wifi.WifiManager
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.HttpURLConnection
import java.net.InetSocketAddress
import java.net.SocketAddress
import java.net.SocketTimeoutException
import java.net.URL

class SetupActivity : AppCompatActivity() {

    private var discoverySocket: DatagramSocket? = null
    private var multicastLock: WifiManager.MulticastLock? = null
    @Volatile private var discoveryStopped = false
    @Volatile private var inForeground = false

    // url → last failed probe time; avoids re-probing a dead address on every
    // 5-second beacon
    private val failedProbes = HashMap<String, Long>()

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
            val url = urlInput.text.toString().trim().trimEnd('/')
            if (url.isEmpty()) {
                Toast.makeText(this, "Please enter a server URL", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            if (!url.startsWith("http://") && !url.startsWith("https://")) {
                Toast.makeText(this, "URL must start with http:// or https://", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            // Verify the server actually answers before locking the URL in —
            // a silent black player screen told users nothing about what failed.
            btnConnect.isEnabled = false
            tvCurrent.text = "Testing connection to $url …"
            Thread {
                val problem = probeServer(url)
                runOnUiThread {
                    if (isFinishing) return@runOnUiThread
                    btnConnect.isEnabled = true
                    if (problem == null) {
                        stopDiscovery()
                        prefs.edit().putString("server_url", url).apply()
                        Toast.makeText(this, "Connected! Starting player…", Toast.LENGTH_SHORT).show()
                        startMain()
                    } else {
                        tvCurrent.text = "Could not reach $url"
                        AlertDialog.Builder(this)
                            .setTitle("Can't reach the server")
                            .setMessage(
                                problem +
                                "\n\nCheck that Signage Manager is open on the PC and that " +
                                "the TV and PC are on the same network."
                            )
                            .setPositiveButton("Save anyway") { _, _ ->
                                stopDiscovery()
                                prefs.edit().putString("server_url", url).apply()
                                startMain()
                            }
                            .setNegativeButton("Edit URL", null)
                            .show()
                    }
                }
            }.start()
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

    /** Returns null when the server answers, else a human-readable reason. */
    private fun probeServer(baseUrl: String): String? {
        return try {
            val conn = URL("$baseUrl/api/health").openConnection() as HttpURLConnection
            conn.connectTimeout = 4_000
            conn.readTimeout = 4_000
            val code = conn.responseCode
            conn.disconnect()
            if (code in 200..299) null else "The server answered with HTTP $code."
        } catch (e: java.net.ConnectException) {
            "Connection refused — the address is reachable but nothing is listening. " +
            "Is Signage Manager open on the PC? A PC firewall can also cause this."
        } catch (e: SocketTimeoutException) {
            "Timed out — the TV and PC may be on different networks, or the router " +
            "blocks device-to-device traffic (AP isolation)."
        } catch (e: java.net.UnknownHostException) {
            "Unknown host — check the address for typos."
        } catch (e: Exception) {
            e.message ?: "Unreachable."
        }
    }

    private fun startDiscoveryListener(
        urlInput: EditText,
        tvCurrent: TextView,
        prefs: android.content.SharedPreferences,
    ) {
        // Many TV Wi-Fi drivers silently DROP broadcast/multicast packets unless
        // a MulticastLock is held — without this, the PC's beacon never reaches
        // the app on wireless TVs. No-op on Ethernet-only devices.
        try {
            val wifi = applicationContext.getSystemService(WIFI_SERVICE) as WifiManager
            multicastLock = wifi.createMulticastLock("signage-discovery").apply {
                setReferenceCounted(false)
                acquire()
            }
        } catch (_: Exception) {}

        Thread {
            try {
                val socket = DatagramSocket(null as SocketAddress?).apply {
                    reuseAddress = true
                    broadcast = true
                    soTimeout = 15_000
                    bind(InetSocketAddress(47777))
                }
                discoverySocket = socket

                val buf = ByteArray(2048)
                // Keep listening until a REACHABLE beacon arrives or the activity
                // stops us. A malformed/foreign packet must not end discovery,
                // and neither should a beacon advertising an address we can't
                // actually reach (e.g. the PC's VPN adapter).
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

                        val port = obj.getInt("port")
                        val candidates = ArrayList<String>()
                        obj.optString("ip").takeIf { it.isNotBlank() }
                            ?.let { candidates.add("http://$it:$port") }
                        obj.optJSONArray("ips")?.let { arr ->
                            for (i in 0 until arr.length()) {
                                val u = "http://${arr.getString(i)}:$port"
                                if (!candidates.contains(u)) candidates.add(u)
                            }
                        }
                        if (candidates.isEmpty()) continue

                        var reachable: String? = null
                        var lastProblem: String? = null
                        for (u in candidates) {
                            if (discoveryStopped) break
                            val failedAt = failedProbes[u]
                            if (failedAt != null && System.currentTimeMillis() - failedAt < 30_000) continue
                            val problem = probeServer(u)
                            if (problem == null) { reachable = u; break }
                            failedProbes[u] = System.currentTimeMillis()
                            lastProblem = problem
                        }

                        if (reachable == null) {
                            if (lastProblem != null) {
                                runOnUiThread {
                                    if (!isFinishing) tvCurrent.text = "Server found, but not reachable: $lastProblem"
                                }
                            }
                            continue   // keep listening — network may recover
                        }

                        val url = reachable
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
        try { multicastLock?.release() } catch (_: Exception) {}
        multicastLock = null
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
