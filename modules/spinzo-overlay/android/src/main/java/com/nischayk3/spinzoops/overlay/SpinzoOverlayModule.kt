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

        Function("dismissOverlay") {
            appContext.reactContext?.let { context ->
                SpinzoOverlayManager.dismissOverlay(context)
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
