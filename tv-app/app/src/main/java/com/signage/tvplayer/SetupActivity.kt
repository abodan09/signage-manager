package com.signage.tvplayer

import android.content.Intent
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity

class SetupActivity : AppCompatActivity() {

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
            tvCurrent.text = "No server configured yet"
        }

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
            prefs.edit().putString("server_url", url).apply()
            Toast.makeText(this, "Saved! Connecting…", Toast.LENGTH_SHORT).show()
            startMain()
        }
    }

    private fun startMain() {
        startActivity(Intent(this, MainActivity::class.java))
        finish()
    }
}
