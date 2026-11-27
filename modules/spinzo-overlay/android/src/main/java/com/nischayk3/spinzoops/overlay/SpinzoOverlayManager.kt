package com.nischayk3.spinzoops.overlay

import android.app.Notification
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
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import android.view.Gravity
import android.view.LayoutInflater
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.TextView
import androidx.core.app.NotificationCompat
import java.util.Collections
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

object SpinzoOverlayManager {

    private const val SIREN_BURST_MS = 1_500L
    private const val VOICE_REPEAT_INTERVAL_MS = 8_000L
    private const val MAX_VOICE_REPEATS = 3
    private const val REPEAT_VIBRATION_PULSE_MS = 600L
    private const val AUTO_STOP_SAFETY_MS = 30_000L
    private const val FALLBACK_NOTIF_TAG = "spinzo_alert"

    @Volatile
    var isAppInForeground: Boolean = false

    private val overlayGeneration = AtomicLong(0L)

    fun currentGeneration(): Long = overlayGeneration.get()

    fun bumpGeneration(): Long = overlayGeneration.incrementAndGet()

    private val activeNotificationIds: MutableSet<Int> =
        Collections.newSetFromMap(ConcurrentHashMap<Int, Boolean>())

    private val LATIN_TO_DEVANAGARI = mapOf(
        'A' to "ए",
        'B' to "बी",
        'C' to "सी",
        'D' to "डी",
        'E' to "ई",
        'F' to "एफ",
        'G' to "जी",
        'H' to "एच",
        'I' to "आई",
        'J' to "जे",
        'K' to "के",
        'L' to "एल",
        'M' to "एम",
        'N' to "एन",
        'O' to "ओ",
        'P' to "पी",
        'Q' to "क्यू",
        'R' to "आर",
        'S' to "एस",
        'T' to "टी",
        'U' to "यू",
        'V' to "वी",
        'W' to "डब्ल्यू",
        'X' to "एक्स",
        'Y' to "वाई",
        'Z' to "जेड"
    )

    private var currentOverlayView: View? = null
    private var mediaPlayer: MediaPlayer? = null
    private var vibrator: Vibrator? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var ttsFailed = false
    private var pendingVoiceText: String? = null
    private var activeVoiceText: String? = null
    private var voiceRepeatCount = 0
    private var pendingAcceptedOrderId: String? = null
    private var pendingIsDelivery: Boolean = false
    private var pendingTaskType: String? = null
    private val mainHandler = Handler(Looper.getMainLooper())
    private val stopSirenOnlyRunnable = Runnable {
        Log.d("SpinzoOverlay", "Siren burst (${SIREN_BURST_MS}ms) finished — stopping siren & looping vibration")
        stopSirenOnly()
    }
    private val autoStopRunnable = Runnable {
        Log.d("SpinzoOverlay", "30s auto-stop failsafe triggered — stopping alarm & vibration")
        stopAudioAndVibration()
    }
    private val startVoiceRunnable = Runnable {
        stopSirenOnly()
        val text = activeVoiceText ?: return@Runnable
        if (ttsFailed || tts == null) {
            Log.w("SpinzoOverlay", "TTS unavailable — siren burst already ended cleanly")
            return@Runnable
        }
        if (!ttsReady) {
            pendingVoiceText = text
            Log.d("SpinzoOverlay", "TTS still initializing — queued pending voice text")
            return@Runnable
        }
        duckSirenAndSpeak(text, cancelLoopingVibration = true)
    }
    private val voiceRepeatRunnable = Runnable {
        val text = activeVoiceText ?: return@Runnable
        if (voiceRepeatCount >= MAX_VOICE_REPEATS) return@Runnable
        triggerShortVibrationPulse()
        duckSirenAndSpeak(text, cancelLoopingVibration = false)
    }

    private fun formatStepLabel(raw: String): String {
        return when (raw.trim().lowercase()) {
            "getting_washed" -> "Washing"
            "getting_dried" -> "Drying"
            "getting_ironed" -> "Ironing"
            "tagging" -> "Tagging"
            "prestain" -> "Pre-stain"
            "packaging" -> "Packaging"
            else -> raw.trim().replaceFirstChar { if (it.isLowerCase()) it.titlecase() else it.toString() }
        }
    }

    private fun formatTokenForHindiSpeech(raw: String): String {
        val parts = raw.split(",").mapNotNull { segment ->
            val cleaned = segment.trim().trimStart('#').trim()
            if (cleaned.isEmpty()) return@mapNotNull null

            val chunks = mutableListOf<String>()
            val digitBuf = StringBuilder()

            fun flushDigits() {
                if (digitBuf.isNotEmpty()) {
                    chunks.add(digitBuf.toString())
                    digitBuf.clear()
                }
            }

            for (ch in cleaned.uppercase(Locale.ROOT)) {
                when {
                    ch in '0'..'9' -> digitBuf.append(ch)
                    ch in 'A'..'Z' -> {
                        flushDigits()
                        LATIN_TO_DEVANAGARI[ch]?.let { chunks.add(it) }
                    }
                    ch == '-' || ch == '_' || ch.isWhitespace() -> {
                        flushDigits()
                    }
                    else -> {
                        flushDigits()
                        chunks.add(ch.toString())
                    }
                }
            }
            flushDigits()
            chunks.joinToString(" ").takeIf { it.isNotBlank() }
        }
        return parts.joinToString(" और ")
    }

    private fun buildFallbackHindiVoice(data: Map<String, String>): String {
        val rawToken = data["tokenNumber"]?.trim()?.takeIf { it.isNotEmpty() }
        val spokenToken = rawToken?.let { formatTokenForHindiSpeech(it) }?.takeIf { it.isNotEmpty() }
        val prefix = if (spokenToken != null) "टोकन नंबर $spokenToken, " else ""

        val stepRaw = (data["step"]?.takeIf { it.isNotBlank() } ?: data["stepName"])?.trim()?.lowercase() ?: ""
        val normalizedStep = when {
            stepRaw == "getting_washed" || stepRaw.contains("wash") -> "getting_washed"
            stepRaw == "getting_dried" || stepRaw.contains("dri") || stepRaw.contains("dry") -> "getting_dried"
            stepRaw == "getting_ironed" || stepRaw.contains("iron") -> "getting_ironed"
            stepRaw == "tagging" || stepRaw.contains("tag") -> "tagging"
            stepRaw == "prestain" || stepRaw.contains("stain") -> "prestain"
            stepRaw == "packaging" || stepRaw.contains("packag") || stepRaw.contains("pack") -> "packaging"
            else -> stepRaw
        }

        val phase = data["phase"]?.trim()?.lowercase() ?: ""
        val taskType = data["taskType"]?.trim()?.lowercase() ?: ""
        val type = data["type"]?.trim()?.lowercase() ?: ""
        val isInstant = data["isInstant"].equals("true", ignoreCase = true)
        val isNudge = taskType == "stage_nudge" || type == "stage_nudge"
        val isDelivery = taskType.contains("delivery")

        return when {
            phase == "idle_alert" -> {
                if (normalizedStep == "getting_dried") "ड्रायर खाली है, कपड़े डालिए"
                else "वॉशर खाली है, कपड़े डालिए"
            }
            phase == "detergent" -> "${prefix}डिटर्जेंट डालिए"
            phase == "softener" -> "${prefix}सॉफ्टनर डालिए"
            normalizedStep == "getting_washed" && phase == "accepted" -> "${prefix}वॉशर चालू करिए"
            normalizedStep == "getting_washed" && phase == "started" -> "${prefix}वॉशर से निकालिए"
            normalizedStep == "getting_dried" && phase == "accepted" -> "${prefix}ड्रायर चालू करिए"
            normalizedStep == "getting_dried" && phase == "started" -> "${prefix}ड्रायर से निकालिए"
            isNudge && normalizedStep == "tagging" -> "${prefix}टैगिंग जल्दी पूरी करिए"
            isNudge && normalizedStep == "packaging" -> "${prefix}पैकेजिंग जल्दी पूरी करिए"
            isNudge && normalizedStep == "getting_ironed" -> "${prefix}आयरनिंग जल्दी पूरी करिए"
            isNudge -> "${prefix}नया काम आया है"
            isDelivery -> {
                when {
                    spokenToken != null -> "टोकन नंबर $spokenToken, डिलीवरी के लिए जाना है"
                    isInstant -> "एक्सप्रेस डिलीवरी के लिए जाना है"
                    else -> "नई डिलीवरी आई है"
                }
            }
            normalizedStep == "tagging" -> "${prefix}टैगिंग करनी है"
            normalizedStep == "getting_washed" -> "${prefix}वॉशर में डालिए"
            normalizedStep == "getting_dried" -> "${prefix}ड्रायर में डालिए"
            normalizedStep == "getting_ironed" -> {
                if (spokenToken != null) "टोकन नंबर $spokenToken, नया आयरनिंग का ऑर्डर आया है"
                else "नया आयरनिंग का ऑर्डर आया है"
            }
            normalizedStep == "packaging" -> "${prefix}पैकेजिंग करनी है"
            normalizedStep == "prestain" -> "${prefix}प्री-स्टेन करना है"
            isInstant -> "${prefix}एक्सप्रेस पिकअप आया है"
            taskType.contains("pickup") -> "${prefix}नया पिकअप आया है"
            else -> "${prefix}नया ऑर्डर आया है"
        }
    }

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

    fun showOverlay(context: Context, data: Map<String, String>, expectedGen: Long? = null) {
        if (expectedGen != null && expectedGen != overlayGeneration.get()) {
            Log.d("SpinzoOverlay", "Skipping stale showOverlay (expectedGen=$expectedGen, current=${overlayGeneration.get()})")
            return
        }
        dismissOverlay(context)

        val appContext = context.applicationContext ?: context
        val windowManager = appContext.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val themedContext = android.view.ContextThemeWrapper(appContext, android.R.style.Theme_DeviceDefault_NoActionBar)
        val inflater = LayoutInflater.from(themedContext)

        val overlayView = inflater.inflate(R.layout.overlay_assignment_card, null)
        currentOverlayView = overlayView

        val orderId = data["orderId"] ?: ""
        val shortId = if (orderId.length >= 6) orderId.takeLast(6).uppercase() else orderId.uppercase()
        val tokenNumber = data["tokenNumber"]?.trim()?.takeIf { it.isNotEmpty() }
        val displayId = if (tokenNumber != null) "Token #$tokenNumber" else "#$shortId"
        val taskType = data["taskType"] ?: "pickup"
        val isDelivery = taskType.contains("delivery", ignoreCase = true)
        val isInstant = data["isInstant"].equals("true", ignoreCase = true)
        val slot = data["slot"] ?: ""
        val stepName = data["stepName"]?.takeIf { it.isNotBlank() } ?: data["step"] ?: ""
        val formattedStep = if (stepName.isNotEmpty()) formatStepLabel(stepName) else ""
        val isNudge = taskType.equals("stage_nudge", ignoreCase = true) || (data["type"] ?: "").equals("stage_nudge", ignoreCase = true)
        val isIdleAlert = data["phase"] == "idle_alert"
        val voiceText = data["voiceText"]?.takeIf { it.isNotBlank() } ?: buildFallbackHindiVoice(data)

        val rawAddress = data["address"]
        val address = when {
            !rawAddress.isNullOrBlank() -> rawAddress
            isIdleAlert -> "Check idle machine on store floor"
            stepName.isNotEmpty() -> "$displayId • Floor Task"
            else -> "Customer Address"
        }

        val tvTitle = overlayView.findViewById<TextView>(R.id.tvTitle)
        val tvSubtitle = overlayView.findViewById<TextView>(R.id.tvSubtitle)
        val tvAddress = overlayView.findViewById<TextView>(R.id.tvAddress)
        val tvSlot = overlayView.findViewById<TextView>(R.id.tvSlot)
        val btnAccept = overlayView.findViewById<Button>(R.id.btnAccept)
        val btnClose = overlayView.findViewById<TextView>(R.id.btnClose)

        if (isNudge) {
            val titleText = data["customerName"]?.takeIf { it.isNotBlank() }
                ?: data["title"]?.takeIf { it.isNotBlank() }
            tvTitle.text = when {
                !titleText.isNullOrEmpty() -> {
                    if (titleText.startsWith("⚡") || titleText.startsWith("⏰")) titleText else "⏰ $titleText"
                }
                formattedStep.isNotEmpty() -> "⏰ $formattedStep"
                else -> "⏰ Operations Check"
            }
            tvSubtitle.text = when {
                isIdleAlert -> "Store Floor • Idle Machine"
                formattedStep.isNotEmpty() -> "$displayId • $formattedStep"
                else -> "$displayId • Status Check"
            }
            btnAccept.text = if (formattedStep.isNotEmpty()) formattedStep.uppercase() else "OPEN & RESPOND"
        } else if (isDelivery) {
            if (isInstant) {
                tvTitle.text = "⚡ Express Delivery!"
                tvSubtitle.text = "$displayId • Express Delivery"
            } else {
                tvTitle.text = "📦 Delivery Assigned!"
                tvSubtitle.text = "$displayId • Delivery"
            }
            btnAccept.text = "ACCEPT ORDER"
        } else if (isInstant) {
            tvTitle.text = "⚡ Instant Pickup!"
            tvSubtitle.text = "$displayId • Instant Pickup"
            btnAccept.text = "ACCEPT ORDER"
        } else if (formattedStep.isNotEmpty()) {
            tvTitle.text = "⚙️ $formattedStep Assigned!"
            tvSubtitle.text = "$displayId • $formattedStep"
            btnAccept.text = "ACCEPT ORDER"
        } else {
            tvTitle.text = "📦 Order Assigned!"
            tvSubtitle.text = "$displayId • Pickup"
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
            bumpGeneration()
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
        startAudioAndVibration(appContext, voiceText)

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

        val appContext = context.applicationContext ?: context

        try {
            val nm = appContext.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
            if (nm != null) {
                val idsToCancel = synchronized(activeNotificationIds) {
                    val copy = activeNotificationIds.toList()
                    activeNotificationIds.clear()
                    copy
                }
                for (notifId in idsToCancel) {
                    nm.cancel(FALLBACK_NOTIF_TAG, notifId)
                }
            }
        } catch (e: Exception) {
            Log.w("SpinzoOverlay", "Error cancelling fallback notifications: ${e.message}")
        }

        if (currentOverlayView != null) {
            try {
                val windowManager = appContext.getSystemService(Context.WINDOW_SERVICE) as WindowManager
                if (currentOverlayView?.isAttachedToWindow == true) {
                    windowManager.removeView(currentOverlayView)
                }
            } catch (e: Exception) {
                Log.w("SpinzoOverlay", "Error removing overlay view: ${e.message}")
            }
            currentOverlayView = null
        }
    }

    private fun stopSirenOnly() {
        try {
            mediaPlayer?.let { mp ->
                try {
                    if (mp.isPlaying) {
                        mp.stop()
                    }
                } catch (_: Exception) {}
                try {
                    mp.release()
                } catch (_: Exception) {}
            }
        } catch (e: Exception) {
            Log.w("SpinzoOverlay", "stopSirenOnly MediaPlayer error: ${e.message}")
        }
        mediaPlayer = null

        try {
            vibrator?.cancel()
        } catch (e: Exception) {
            Log.w("SpinzoOverlay", "stopSirenOnly vibrator cancel error: ${e.message}")
        }
    }

    private fun ensureTtsInitialized(appContext: Context) {
        if (tts != null && (ttsReady || !ttsFailed)) return
        try {
            ttsReady = false
            ttsFailed = false
            tts = TextToSpeech(appContext) { status ->
                mainHandler.post {
                    val engine = tts
                    if (status == TextToSpeech.SUCCESS && engine != null) {
                        try {
                            var langResult = engine.setLanguage(Locale("hi", "IN"))
                            if (langResult == TextToSpeech.LANG_MISSING_DATA || langResult == TextToSpeech.LANG_NOT_SUPPORTED) {
                                langResult = engine.setLanguage(Locale("hi"))
                            }
                            if (langResult == TextToSpeech.LANG_MISSING_DATA || langResult == TextToSpeech.LANG_NOT_SUPPORTED) {
                                Log.w("SpinzoOverlay", "Hindi TTS voice unavailable (code=$langResult) — skipping voice")
                                ttsReady = false
                                ttsFailed = true
                                pendingVoiceText = null
                                return@post
                            }
                            engine.setSpeechRate(0.90f)
                            engine.setAudioAttributes(
                                AudioAttributes.Builder()
                                    .setUsage(AudioAttributes.USAGE_ALARM)
                                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                                    .build()
                            )
                            engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                                override fun onStart(utteranceId: String?) {}
                                override fun onDone(utteranceId: String?) {}

                                @Deprecated("Deprecated in Java")
                                override fun onError(utteranceId: String?) {
                                    Log.w("SpinzoOverlay", "TTS utterance error — not restarting siren")
                                }

                                override fun onError(utteranceId: String?, errorCode: Int) {
                                    Log.w("SpinzoOverlay", "TTS utterance error ($errorCode) — not restarting siren")
                                }
                            })
                            ttsReady = true
                            ttsFailed = false

                            val queued = pendingVoiceText
                            if (queued != null && activeVoiceText != null) {
                                pendingVoiceText = null
                                duckSirenAndSpeak(queued, cancelLoopingVibration = true)
                            }
                        } catch (e: Exception) {
                            Log.w("SpinzoOverlay", "TTS configuration error: ${e.message}")
                            ttsReady = false
                            ttsFailed = true
                            pendingVoiceText = null
                        }
                    } else {
                        Log.w("SpinzoOverlay", "TTS initialization failed (status=$status) — siren burst ends cleanly")
                        ttsReady = false
                        ttsFailed = true
                        pendingVoiceText = null
                    }
                }
            }
        } catch (e: Exception) {
            Log.w("SpinzoOverlay", "TTS constructor error: ${e.message}")
            tts = null
            ttsReady = false
            ttsFailed = true
            pendingVoiceText = null
        }
    }

    private fun duckSirenAndSpeak(text: String, cancelLoopingVibration: Boolean) {
        if (activeVoiceText == null || text.isBlank()) return
        val engine = tts
        if (engine == null || !ttsReady) {
            Log.w("SpinzoOverlay", "TTS not ready — skipping voice speak")
            return
        }
        try {
            if (cancelLoopingVibration) {
                stopSirenOnly()
            } else {
                try {
                    mediaPlayer?.let { mp ->
                        if (mp.isPlaying) mp.stop()
                        mp.release()
                    }
                } catch (e: Exception) {
                    Log.w("SpinzoOverlay", "MediaPlayer stop error: ${e.message}")
                }
                mediaPlayer = null
            }

            val utteranceId = "spinzo_alert_${System.currentTimeMillis()}"
            val speakResult = engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, utteranceId)
            if (speakResult == TextToSpeech.SUCCESS) {
                voiceRepeatCount += 1
                if (voiceRepeatCount < MAX_VOICE_REPEATS && activeVoiceText != null) {
                    mainHandler.removeCallbacks(voiceRepeatRunnable)
                    mainHandler.postDelayed(voiceRepeatRunnable, VOICE_REPEAT_INTERVAL_MS)
                }
            } else {
                Log.w("SpinzoOverlay", "TTS speak returned error ($speakResult) — not restarting siren")
            }
        } catch (e: Exception) {
            Log.w("SpinzoOverlay", "TTS speak exception: ${e.message} — not restarting siren")
        }
    }

    private fun triggerShortVibrationPulse() {
        try {
            val v = vibrator ?: return
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                v.vibrate(VibrationEffect.createOneShot(REPEAT_VIBRATION_PULSE_MS, VibrationEffect.DEFAULT_AMPLITUDE))
            } else {
                @Suppress("DEPRECATION")
                v.vibrate(REPEAT_VIBRATION_PULSE_MS)
            }
        } catch (e: Exception) {
            Log.w("SpinzoOverlay", "Short vibration pulse error: ${e.message}")
        }
    }

    private fun startAudioAndVibration(context: Context, voiceText: String? = null) {
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
                    isLooping = false
                    setOnCompletionListener { mp ->
                        try {
                            mp.release()
                        } catch (_: Exception) {}
                        if (mediaPlayer === mp) {
                            mediaPlayer = null
                        }
                    }
                    prepare()
                    start()
                }
            } else {
                mediaPlayer = MediaPlayer.create(context, R.raw.alarm)?.apply {
                    isLooping = false
                    setOnCompletionListener { mp ->
                        try {
                            mp.release()
                        } catch (_: Exception) {}
                        if (mediaPlayer === mp) {
                            mediaPlayer = null
                        }
                    }
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

        // Always stop the attention siren burst and looping vibration at SIREN_BURST_MS whether TTS succeeds or fails
        mainHandler.postDelayed(stopSirenOnlyRunnable, SIREN_BURST_MS)

        val cleanedVoice = voiceText?.takeIf { it.isNotBlank() }
        if (cleanedVoice != null) {
            activeVoiceText = cleanedVoice
            voiceRepeatCount = 0
            ensureTtsInitialized(context.applicationContext ?: context)
            mainHandler.postDelayed(startVoiceRunnable, SIREN_BURST_MS)
        }

        mainHandler.postDelayed(autoStopRunnable, AUTO_STOP_SAFETY_MS)
    }

    fun stopAudioAndVibration() {
        mainHandler.removeCallbacks(stopSirenOnlyRunnable)
        mainHandler.removeCallbacks(autoStopRunnable)
        mainHandler.removeCallbacks(startVoiceRunnable)
        mainHandler.removeCallbacks(voiceRepeatRunnable)

        activeVoiceText = null
        pendingVoiceText = null
        voiceRepeatCount = 0

        try {
            tts?.stop()
        } catch (e: Exception) {
            Log.w("SpinzoOverlay", "TTS stop error: ${e.message}")
        }

        stopSirenOnly()
        vibrator = null
    }

    fun showFallbackNotification(context: Context, data: Map<String, String>) {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val channelId = "order_assignment"

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val soundUri = Uri.parse("android.resource://${context.packageName}/${R.raw.alarm}")
            val audioAttrs = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
            val channel = NotificationChannel(
                channelId,
                "Order Assignments",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "High-priority order assignment alerts"
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 500, 250, 500, 250, 500)
                enableLights(true)
                lightColor = Color.rgb(153, 75, 255)
                setSound(soundUri, audioAttrs)
                setBypassDnd(true)
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            }
            nm.createNotificationChannel(channel)
        }

        val orderId = data["orderId"] ?: ""
        val shortId = if (orderId.length >= 6) orderId.takeLast(6).uppercase() else orderId.uppercase()
        val tokenNumber = data["tokenNumber"]?.trim()?.takeIf { it.isNotEmpty() }
        val displayId = if (tokenNumber != null) "Token #$tokenNumber" else "#$shortId"
        val taskType = data["taskType"] ?: "pickup"
        val isDelivery = taskType.contains("delivery", ignoreCase = true)
        val isInstant = data["isInstant"].equals("true", ignoreCase = true)
        val stepName = data["stepName"]?.takeIf { it.isNotBlank() } ?: data["step"] ?: ""
        val formattedStep = if (stepName.isNotEmpty()) formatStepLabel(stepName) else ""
        val isNudge = taskType.equals("stage_nudge", ignoreCase = true) || (data["type"] ?: "").equals("stage_nudge", ignoreCase = true)
        val isIdleAlert = data["phase"] == "idle_alert"

        val notifTitle = when {
            isNudge && isIdleAlert -> {
                val titleText = data["customerName"]?.takeIf { it.isNotBlank() }
                    ?: data["title"]?.takeIf { it.isNotBlank() }
                if (!titleText.isNullOrEmpty()) {
                    if (titleText.startsWith("⚡") || titleText.startsWith("⏰")) titleText else "⏰ $titleText"
                } else {
                    "⏰ Idle Machine Alert"
                }
            }
            isNudge -> "⏰ Status Check: $displayId"
            isDelivery && isInstant -> "⚡ Express Delivery: $displayId"
            isDelivery -> "📦 Delivery Assigned: $displayId"
            isInstant -> "⚡ Instant Pickup: $displayId"
            formattedStep.isNotEmpty() -> "⚙️ $formattedStep Assigned: $displayId"
            else -> "New Order Assigned: $displayId"
        }

        val rawAddress = data["address"]
        val notifBody = when {
            !rawAddress.isNullOrBlank() -> if (tokenNumber != null && !rawAddress.contains(tokenNumber)) "Token #$tokenNumber • $rawAddress" else rawAddress
            isIdleAlert -> "Store Floor • Idle Machine — tap to respond"
            isNudge -> "$displayId • Tap to open and respond"
            formattedStep.isNotEmpty() -> "$displayId • $formattedStep — tap to accept"
            else -> "$displayId • Tap to accept order"
        }

        val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            putExtra("acceptedOrderId", orderId)
            putExtra("isDelivery", isDelivery)
            putExtra("taskType", taskType)
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

        val notifId = (System.currentTimeMillis() % 10000).toInt()
        synchronized(activeNotificationIds) {
            activeNotificationIds.add(notifId)
        }
        nm.notify(FALLBACK_NOTIF_TAG, notifId, notification)

        try {
            val appContext = context.applicationContext ?: context
            val pm = appContext.getSystemService(Context.POWER_SERVICE) as? PowerManager
            if (pm != null) {
                @Suppress("DEPRECATION")
                val fallbackWakeLock = pm.newWakeLock(
                    PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP,
                    "SpinzoOps:FallbackNotifWakeLock"
                )
                fallbackWakeLock.setReferenceCounted(false)
                fallbackWakeLock.acquire(10_000L)
            }
        } catch (e: Exception) {
            Log.w("SpinzoOverlay", "Fallback WakeLock error: ${e.message}")
        }
    }
}
