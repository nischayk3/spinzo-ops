package com.nischayk3.spinzoops.overlay

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SpinzoOverlayModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("SpinzoOverlay")

        Function("canDrawOverlays") {
            val context = appContext.reactContext ?: return@Function false
            Settings.canDrawOverlays(context)
        }

        Function("openOverlaySettings") {
            val context = appContext.reactContext ?: return@Function
            val intent = Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:${context.packageName}")
            ).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
        }

        Function("setOnShift") { onShift: Boolean ->
            val context = appContext.reactContext ?: return@Function
            val prefs = context.getSharedPreferences("SpinzoPrefs", Context.MODE_PRIVATE)
            prefs.edit().putBoolean("on_shift", onShift).apply()
        }

        Function("dismissOverlay") {
            val context = appContext.reactContext ?: return@Function
            SpinzoOverlayManager.dismissOverlay(context)
        }

        Function("getCachedFCMToken") {
            val context = appContext.reactContext ?: return@Function null
            val prefs = context.getSharedPreferences("SpinzoPrefs", Context.MODE_PRIVATE)
            prefs.getString("fcm_token", null)
        }

        Function("getPendingAcceptedOrder") {
            SpinzoOverlayManager.getPendingAcceptedOrder()
        }

        Function("clearPendingAcceptedOrder") {
            SpinzoOverlayManager.clearPendingAcceptedOrder()
        }
    }
}
