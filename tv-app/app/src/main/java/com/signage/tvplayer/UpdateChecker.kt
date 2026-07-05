package com.signage.tvplayer

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

object UpdateChecker {

    private const val REPO    = "abodan09/signage-manager"
    private const val API_URL = "https://api.github.com/repos/$REPO/releases/latest"
    private const val PAGE_URL = "https://signage.frozenbit.eu"

    fun check(activity: Activity, currentVersion: String) {
        Thread {
            try {
                val conn = URL(API_URL).openConnection() as HttpURLConnection
                conn.setRequestProperty("User-Agent", "SignageManager-Android/$currentVersion")
                conn.connectTimeout = 6_000
                conn.readTimeout    = 6_000

                val body = conn.inputStream.bufferedReader().readText()
                val json = JSONObject(body)
                val latest = json.optString("tag_name").trimStart('v')

                if (latest.isNotEmpty() && isNewer(latest, currentVersion)) {
                    val releaseUrl = json.optString("html_url", PAGE_URL)
                    Handler(Looper.getMainLooper()).post {
                        if (!activity.isFinishing) showDialog(activity, latest, releaseUrl)
                    }
                }
            } catch (_: Exception) {
                // Silently ignore — network may be unavailable
            }
        }.start()
    }

    private fun isNewer(a: String, b: String): Boolean {
        val pa = a.split(".").map { it.toIntOrNull() ?: 0 }
        val pb = b.split(".").map { it.toIntOrNull() ?: 0 }
        val len = maxOf(pa.size, pb.size)
        for (i in 0 until len) {
            val diff = (pa.getOrElse(i) { 0 }) - (pb.getOrElse(i) { 0 })
            if (diff != 0) return diff > 0
        }
        return false
    }

    private fun showDialog(activity: Activity, version: String, releaseUrl: String) {
        AlertDialog.Builder(activity)
            .setTitle("Update Available")
            .setMessage("A new version (v$version) of the Signage TV Player is available.\n\nVisit the download page to get the latest APK and reinstall via ADB.")
            .setPositiveButton("View Release") { _, _ ->
                activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(releaseUrl)))
            }
            .setNegativeButton("Later", null)
            .show()
    }
}
