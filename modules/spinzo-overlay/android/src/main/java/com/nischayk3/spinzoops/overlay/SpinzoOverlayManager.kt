package com.nischayk3.spinzoops.overlay

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.net.Uri
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
import android.view.Gravity
import android.view.LayoutInflater
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.TextView
import androidx.core.app.NotificationCompat

object SpinzoOverlayManager {

    private var currentOverlayView: View? = null
    private var mediaPlayer: MediaPlayer? = null
    private var vibrator: Vibrator? = null
    private var pendingAcceptedOrderId: String? = null
    private var pendingIsDelivery: Boolean = false

    fun getPendingAcceptedOrder(): Map<String, Any>? {
        val id = pendingAcceptedOrderId ?: return null
        return mapOf(
            "orderId" to id,
            "isDelivery" to pendingIsDelivery
        )
    }

    fun clearPendingAcceptedOrder() {
        pendingAcceptedOrderId = null
        pendingIsDelivery = false
    }

    fun showOverlay(context: Context, data: Map<String, String>) {
        dismissOverlay(context)

        val windowManager = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val inflater = LayoutInflater.from(context)

        val overlayView = inflater.inflate(R.layout.overlay_assignment_card, null)
        currentOverlayView = overlayView

        val orderId = data["orderId"] ?: ""
        val shortId = if (orderId.length >= 6) orderId.takeLast(6).uppercase() else orderId.uppercase()
        val taskType = data["taskType"] ?: "pickup"
        val isDelivery = taskType.equals("delivery", ignoreCase = true)
        val isInstant = data["isInstant"].equals("true", ignoreCase = true)
        val address = data["address"] ?: "Customer Address"
        val slot = data["slot"] ?: ""
        val stepName = data["stepName"] ?: ""

        val tvTitle = overlayView.findViewById<TextView>(R.id.tvTitle)
        val tvSubtitle = overlayView.findViewById<TextView>(R.id.tvSubtitle)
        val tvAddress = overlayView.findViewById<TextView>(R.id.tvAddress)
        val tvSlot = overlayView.findViewById<TextView>(R.id.tvSlot)
        val btnAccept = overlayView.findViewById<Button>(R.id.btnAccept)
        val btnClose = overlayView.findViewById<TextView>(R.id.btnClose)

        if (isInstant) {
            tvTitle.text = "⚡ Instant Pickup!"
        } else if (isDelivery) {
            tvTitle.text = "📦 Delivery Assigned!"
        } else if (stepName.isNotEmpty()) {
            tvTitle.text = "⚙️ $stepName Assigned!"
        } else {
            tvTitle.text = "📦 Order Assigned!"
        }

        tvSubtitle.text = "#$shortId • ${if (isDelivery) "Delivery" else "Pickup"}"
        tvAddress.text = address
        if (slot.isNotEmpty()) {
            tvSlot.visibility = View.VISIBLE
            tvSlot.text = slot
        } else {
            tvSlot.visibility = View.GONE
        }

        btnAccept.setOnClickListener {
            Log.d("SpinzoOverlay", "User tapped ACCEPT ORDER on overlay for #$orderId")
            pendingAcceptedOrderId = orderId
            pendingIsDelivery = isDelivery
            dismissOverlay(context)

            val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                putExtra("acceptedOrderId", orderId)
                putExtra("isDelivery", isDelivery)
                putExtra("taskType", taskType)
            }
            if (launchIntent != null) {
                context.startActivity(launchIntent)
            }
        }

        btnClose.setOnClickListener {
            Log.d("SpinzoOverlay", "User dismissed overlay for #$orderId")
            dismissOverlay(context)
        }

        val layoutType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }

        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            layoutType,
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
            WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.CENTER
        }

        windowManager.addView(overlayView, params)
        startAudioAndVibration(context)
    }

    fun dismissOverlay(context: Context) {
        stopAudioAndVibration()
        if (currentOverlayView != null) {
            try {
                val windowManager = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
                windowManager.removeView(currentOverlayView)
            } catch (e: Exception) {
                Log.w("SpinzoOverlay", "Error removing overlay view: ${e.message}")
            }
            currentOverlayView = null
        }
    }

    private fun startAudioAndVibration(context: Context) {
        stopAudioAndVibration()
        try {
            val soundUri = Uri.parse("android.resource://${context.packageName}/${R.raw.alarm}")
            mediaPlayer = MediaPlayer().apply {
                setDataSource(context, soundUri)
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build()
                )
                isLooping = true
                prepare()
                start()
            }
        } catch (e: Exception) {
            Log.w("SpinzoOverlay", "MediaPlayer error: ${e.message}")
        }

        try {
            vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val vm = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager
                vm?.defaultVibrator
            } else {
                @Suppress("DEPRECATION")
                context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val timings = longArrayOf(0, 500, 300, 500, 300)
                val amplitudes = intArrayOf(0, 255, 0, 255, 0)
                vibrator?.vibrate(VibrationEffect.createWaveform(timings, amplitudes, 0))
            } else {
                @Suppress("DEPRECATION")
                vibrator?.vibrate(longArrayOf(0, 500, 300, 500), 0)
            }
        } catch (e: Exception) {
            Log.w("SpinzoOverlay", "Vibration error: ${e.message}")
        }
    }

    fun stopAudioAndVibration() {
        try {
            mediaPlayer?.stop()
            mediaPlayer?.release()
        } catch (_: Exception) {}
        mediaPlayer = null

        try {
            vibrator?.cancel()
        } catch (_: Exception) {}
        vibrator = null
    }

    fun showFallbackNotification(context: Context, data: Map<String, String>) {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val channelId = "order_assignment"

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                channelId,
                "Order Assignments",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "High-priority order assignment alerts"
                enableVibration(true)
                enableLights(true)
                lightColor = Color.rgb(153, 75, 255)
            }
            nm.createNotificationChannel(channel)
        }

        val orderId = data["orderId"] ?: ""
        val shortId = if (orderId.length >= 6) orderId.takeLast(6).uppercase() else orderId.uppercase()
        val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            putExtra("acceptedOrderId", orderId)
        }
        val pendingIntent = PendingIntent.getActivity(
            context,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(context, channelId)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("New Order Assigned: #$shortId")
            .setContentText(data["address"] ?: "Tap to accept order")
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .build()

        nm.notify((System.currentTimeMillis() % 10000).toInt(), notification)
    }
}
