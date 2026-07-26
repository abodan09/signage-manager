package com.signage.tvplayer

import android.app.Application

class SignageApp : Application() {
    override fun onCreate() {
        super.onCreate()
        CrashReporter.install(this)
    }
}
