package com.nischayk3.spinzoops.overlay

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import com.google.firebase.messaging.FirebaseMessaging
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SpinzoOverlayModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("SpinzoOverlay")

        Function("canDrawOverlays") {
            appContext.reactContext?.let { context ->
                Settings.canDrawOverlays(context)
            } ?: false
        }

        Function("openOverlaySettings") {
            appContext.reactContext?.let { context ->
                val intent = Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:${context.packageName}")
                ).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                context.startActivity(intent)
            }
        }

        Function("setOnShift") { onShift: Boolean ->
            appContext.reactContext?.let { context ->
                val prefs = context.getSharedPreferences("SpinzoPrefs", Context.MODE_PRIVATE)
                prefs.edit().putBoolean("on_shift", onShift).apply()
            }
        }

        Function("showOverlay") { data: Map<String, String> ->
            val context = appContext.reactContext ?: return@Function false
            val canDraw = Settings.canDrawOverlays(context)
            if (canDraw) {
                Handler(Looper.getMainLooper()).post {
                    try {
                        SpinzoOverlayManager.showOverlay(context, data)
                    } catch (e: Exception) {
                        SpinzoOverlayManager.showFallbackNotification(context, data)
                    }
                }
                true
            } else {
                SpinzoOverlayManager.showFallbackNotification(context, data)
                false
            }
        }

        Function("dismissOverlay") {
            appContext.reactContext?.let { context ->
                SpinzoOverlayManager.dismissOverlay(context)
            }
        }

        AsyncFunction("getFCMToken") { promise: Promise ->
            try {
                FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
                    if (task.isSuccessful) {
                        val token = task.result
                        appContext.reactContext?.let { context ->
                            if (token != null) {
                                val prefs = context.getSharedPreferences("SpinzoPrefs", Context.MODE_PRIVATE)
                                prefs.edit().putString("fcm_token", token).apply()
                            }
                        }
                        promise.resolve(token)
                    } else {
                        promise.resolve(null)
                    }
                }
            } catch (e: Exception) {
                promise.resolve(null)
            }
        }

        Function("getCachedFCMToken") {
            appContext.reactContext?.let { context ->
                val prefs = context.getSharedPreferences("SpinzoPrefs", Context.MODE_PRIVATE)
                prefs.getString("fcm_token", null)
            }
        }

        Function("getPendingAcceptedOrder") {
            SpinzoOverlayManager.getPendingAcceptedOrder()
        }

        Function("clearPendingAcceptedOrder") {
            SpinzoOverlayManager.clearPendingAcceptedOrder()
        }
    }
}
