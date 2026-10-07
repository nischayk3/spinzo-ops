package com.nischayk3.spinzoops.overlay

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class SpinzoMessagingService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        Log.d("SpinzoOverlay", "FCM onNewToken: $token")
        val prefs = getSharedPreferences("SpinzoPrefs", Context.MODE_PRIVATE)
        prefs.edit().putString("fcm_token", token).apply()
    }

    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        super.onMessageReceived(remoteMessage)
        val data = remoteMessage.data
        val orderId = data["orderId"] ?: ""
        val type = data["type"] ?: ""

        Log.d("SpinzoOverlay", "1. FCM received: type=$type, orderId=$orderId, data=$data")

        if (type == "order_assignment") {
            val prefs = getSharedPreferences("SpinzoPrefs", Context.MODE_PRIVATE)
            val onShift = prefs.getBoolean("on_shift", false)
            Log.d("SpinzoOverlay", "2. Helper on-shift: $onShift")

            val canDraw = Settings.canDrawOverlays(this)
            Log.d("SpinzoOverlay", "3. Overlay permission (canDrawOverlays): $canDraw")

            if (canDraw) {
                Log.d("SpinzoOverlay", "4. Triggering native overlay on Main Thread via WindowManager")
                Handler(Looper.getMainLooper()).post {
                    try {
                        SpinzoOverlayManager.showOverlay(applicationContext, data)
                        Log.d("SpinzoOverlay", "5. WindowManager.addView successful")
                    } catch (e: Exception) {
                        Log.e("SpinzoOverlay", "5. WindowManager.addView failed: ${e.message}", e)
                        SpinzoOverlayManager.showFallbackNotification(applicationContext, data)
                    }
                }
            } else {
                Log.d("SpinzoOverlay", "4. Overlay permission missing - triggering fallback Heads-Up notification")
                SpinzoOverlayManager.showFallbackNotification(applicationContext, data)
            }
        }
    }
}
