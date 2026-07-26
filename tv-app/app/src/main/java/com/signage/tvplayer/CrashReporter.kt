package com.signage.tvplayer

import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.widget.ScrollView
import android.widget.TextView
import java.io.File

/**
 * Minimal on-device crash diagnostics. TVs rarely have ADB hooked up, so an
 * uncaught exception is written to a file and shown on screen at next launch —
 * the stack trace is otherwise lost forever on a sideloaded install.
 */
object CrashReporter {

    private fun logFile(ctx: Context) = File(ctx.filesDir, "last_crash.txt")

    fun install(ctx: Context) {
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, e ->
            try {
                logFile(ctx).writeText(
                    "Signage TV Player v" + BuildConfig.VERSION_NAME + "\n" +
                    android.os.Build.MANUFACTURER + " " + android.os.Build.MODEL +
                    " — Android " + android.os.Build.VERSION.RELEASE +
                    " (API " + android.os.Build.VERSION.SDK_INT + ")\n\n" +
                    android.util.Log.getStackTraceString(e)
                )
            } catch (_: Exception) {}
            if (previous != null) previous.uncaughtException(thread, e)
            else android.os.Process.killProcess(android.os.Process.myPid())
        }
    }

    /** If the previous run crashed, show the saved stack trace on screen. */
    fun showIfCrashed(activity: Activity) {
        val f = logFile(activity)
        if (!f.exists()) return
        val text = try { f.readText() } catch (_: Exception) { return }
        val tv = TextView(activity).apply {
            this.text = text
            textSize = 12f
            setPadding(32, 24, 32, 24)
            typeface = android.graphics.Typeface.MONOSPACE
        }
        try {
            AlertDialog.Builder(activity)
                .setTitle("The player crashed last time")
                .setView(ScrollView(activity).apply { addView(tv) })
                .setPositiveButton("Dismiss") { _, _ -> f.delete() }
                .setNegativeButton("Keep", null)
                .show()
        } catch (_: Exception) {
            // Never let diagnostics take the app down
        }
    }
}
