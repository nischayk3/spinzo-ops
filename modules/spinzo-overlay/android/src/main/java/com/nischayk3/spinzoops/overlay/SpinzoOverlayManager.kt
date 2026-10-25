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
import android.os.PowerManager
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
    private var wakeLock: PowerManager.WakeLock? = null
    private var pendingAcceptedOrderId: String? = null
    private var pendingIsDelivery: Boolean = false
    private var pendingTaskType: String? = null

    fun getPendingAcceptedOrder(): Map<String, Any>? {
        val id = pendingAcceptedOrderId ?: return null
        return mapOf(
            "orderId" to id,
            "isDelivery" to pendingIsDelivery,
            "taskType" to (pendingTaskType ?: "")
        )
    }

    fun clearPendingAcceptedOrder() {
        pendingAcceptedOrderId = null
        pendingIsDelivery = false
        pendingTaskType = null
    }

    fun showOverlay(context: Context, data: Map<String, String>) {
        dismissOverlay(context)

        val appContext = context.applicationContext ?: context
        val windowManager = appContext.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val themedContext = android.view.ContextThemeWrapper(appContext, android.R.style.Theme_DeviceDefault_NoActionBar)
        val inflater = LayoutInflater.from(themedContext)

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

        val isNudge = taskType.equals("stage_nudge", ignoreCase = true) || (data["type"] ?: "").equals("stage_nudge", ignoreCase = true)

        if (isNudge) {
            val titleText = data["customerName"] ?: data["title"]
            tvTitle.text = if (!titleText.isNullOrEmpty()) "⏰ $titleText" else if (stepName.isNotEmpty()) "⏰ $stepName" else "⏰ Operations Check"
            tvSubtitle.text = "#$shortId • Status Check"
            btnAccept.text = if (stepName.isNotEmpty()) stepName.uppercase() else "OPEN & RESPOND"
        } else if (isInstant) {
            tvTitle.text = "⚡ Instant Pickup!"
            tvSubtitle.text = "#$shortId • Instant Pickup"
            btnAccept.text = "ACCEPT ORDER"
        } else if (isDelivery) {
            tvTitle.text = "📦 Delivery Assigned!"
            tvSubtitle.text = "#$shortId • Delivery"
            btnAccept.text = "ACCEPT ORDER"
        } else if (stepName.isNotEmpty()) {
            tvTitle.text = "⚙️ $stepName Assigned!"
            tvSubtitle.text = "#$shortId • Process Stage"
            btnAccept.text = "ACCEPT ORDER"
        } else {
            tvTitle.text = "📦 Order Assigned!"
            tvSubtitle.text = "#$shortId • Pickup"
            btnAccept.text = "ACCEPT ORDER"
        }

        tvAddress.text = address
        if (slot.isNotEmpty()) {
            tvSlot.visibility = View.VISIBLE
            tvSlot.text = slot
        } else {
            tvSlot.visibility = View.GONE
        }

        btnAccept.setOnClickListener {
            Log.d("SpinzoOverlay", "User tapped ACCEPT/RESPOND on overlay for #$orderId")
            pendingAcceptedOrderId = orderId
            pendingIsDelivery = isDelivery
            pendingTaskType = taskType
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

        // Dismiss mechanism removed: riders/helpers must press ACCEPT ORDER
        btnClose?.visibility = View.GONE

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
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
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

        try {
            val pm = appContext.getSystemService(Context.POWER_SERVICE) as? PowerManager
            if (pm != null && (wakeLock == null || wakeLock?.isHeld != true)) {
                @Suppress("DEPRECATION")
                wakeLock = pm.newWakeLock(
                    PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP or PowerManager.ON_AFTER_RELEASE,
                    "SpinzoOps:OverlayWakeLock"
                ).apply {
                    setReferenceCounted(false)
                    acquire(60 * 1000L) // Auto-release safety after 60s
                }
            }
        } catch (e: Exception) {
            Log.w("SpinzoOverlay", "WakeLock error: ${e.message}")
        }
    }

    fun dismissOverlay(context: Context) {
        stopAudioAndVibration()
        try {
            if (wakeLock?.isHeld == true) {
                wakeLock?.release()
            }
            wakeLock = null
        } catch (e: Exception) {}

        if (currentOverlayView != null) {
            try {
                val windowManager = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
                if (currentOverlayView?.isAttachedToWindow == true) {
                    windowManager.removeView(currentOverlayView)
                }
            } catch (e: Exception) {
                Log.w("SpinzoOverlay", "Error removing overlay view: ${e.message}")
            }
            currentOverlayView = null
        }
    }

    private fun startAudioAndVibration(context: Context) {
        stopAudioAndVibration()
        try {
            val afd = context.resources.openRawResourceFd(R.raw.alarm)
            if (afd != null) {
                mediaPlayer = MediaPlayer().apply {
                    setAudioAttributes(
                        AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_ALARM)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                            .build()
                    )
                    setDataSource(afd.fileDescriptor, afd.startOffset, afd.length)
                    afd.close()
                    isLooping = true
                    prepare()
                    start()
                }
            } else {
                mediaPlayer = MediaPlayer.create(context, R.raw.alarm)?.apply {
                    isLooping = true
                    start()
                }
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
        } catch (e: Exception) {}
        mediaPlayer = null

        try {
            vibrator?.cancel()
        } catch (e: Exception) {}
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
        val isNudge = (data["taskType"] ?: "").equals("stage_nudge", ignoreCase = true) || (data["type"] ?: "").equals("stage_nudge", ignoreCase = true)
        val notifTitle = if (isNudge) "⏰ Status Check: #$shortId" else "New Order Assigned: #$shortId"
        val notifBody = data["address"] ?: (if (isNudge) "Tap to open and respond" else "Tap to accept order")

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
            .setContentTitle(notifTitle)
            .setContentText(notifBody)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setFullScreenIntent(pendingIntent, true)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .build()

        nm.notify((System.currentTimeMillis() % 10000).toInt(), notification)
    }
}
