package app.tauri

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import java.util.Locale

object A4SpeechBridge {
    private val mainHandler = Handler(Looper.getMainLooper())
    private var engine: TextToSpeech? = null

    private const val ENGINE_ESPEAK = "com.googlecode.eyesfree.espeak"
    private const val ENGINE_GOOGLE = "com.google.android.tts"

    @JvmStatic
    fun speak(activity: Activity, text: String, langTag: String): String? {
        val speechText = text.trim()
        if (speechText.isEmpty()) return null

        val targetTag = langTag.trim().ifEmpty { "en-US" }
        val locale = try {
            Locale.forLanguageTag(targetTag)
        } catch (e: Exception) {
            return "Android TTS locale error: ${e.message ?: "unknown"}"
        }

        mainHandler.post {
            try {
                val ctx = activity.applicationContext
                if (!isEngineAvailable(ctx, ENGINE_ESPEAK) && !isEngineInstalled(ctx, ENGINE_ESPEAK)) {
                    if (hasBuiltinEspeak(ctx)) {
                        triggerEspeakInstall(activity)
                        return@post
                    }
                }
                speakOnMainThread(ctx, speechText, locale)
            } catch (_: Exception) {
                shutdownEngine()
            }
        }

        return null
    }

    private fun hasBuiltinEspeak(context: Context): Boolean {
        return try {
            val resId = context.resources.getIdentifier("espeak", "raw", context.packageName)
            resId != 0
        } catch (_: Exception) {
            false
        }
    }

    private fun triggerEspeakInstall(activity: Activity) {
        try {
            val ctx = activity.applicationContext
            val resId = ctx.resources.getIdentifier("espeak", "raw", ctx.packageName)
            if (resId == 0) return

            val uri = Uri.parse("android.resource://${ctx.packageName}/$resId")
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            activity.startActivity(intent)
        } catch (_: Exception) {
            // 安装失败，静默忽略
        }
    }

    private fun isEngineInstalled(context: Context, packageName: String): Boolean {
        return try {
            context.packageManager.getPackageInfo(packageName, 0)
            true
        } catch (_: PackageManager.NameNotFoundException) {
            false
        }
    }

    private fun isEngineAvailable(context: Context, packageName: String): Boolean {
        return TextToSpeech.getEngines(context).any { it.name == packageName }
    }

    private fun speakOnMainThread(context: Context, speechText: String, locale: Locale) {
        shutdownEngine()
        engine = TextToSpeech(context) { status ->
            mainHandler.post { speakWhenReady(status, speechText, locale) }
        }
    }

    private fun speakWhenReady(status: Int, speechText: String, locale: Locale) {
        val current = engine ?: return
        if (status != TextToSpeech.SUCCESS) {
            shutdownEngine()
            return
        }

        val preferredEngine = when {
            isEngineAvailable(current, ENGINE_ESPEAK) -> ENGINE_ESPEAK
            isEngineAvailable(current, ENGINE_GOOGLE) -> ENGINE_GOOGLE
            else -> null
        }
        if (preferredEngine != null) {
            current.setEngineByPackageName(preferredEngine)
        }

        val langResult = try {
            current.setLanguage(locale)
        } catch (_: Exception) {
            shutdownEngine()
            return
        }
        if (langResult == TextToSpeech.LANG_MISSING_DATA || langResult == TextToSpeech.LANG_NOT_SUPPORTED) {
            shutdownEngine()
            return
        }

        current.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) = Unit

            override fun onDone(utteranceId: String?) {
                mainHandler.post { shutdownEngine() }
            }

            @Deprecated("Deprecated in Java")
            override fun onError(utteranceId: String?) {
                mainHandler.post { shutdownEngine() }
            }

            override fun onError(utteranceId: String?, errorCode: Int) {
                mainHandler.post { shutdownEngine() }
            }
        })

        val utteranceId = "a4-memory-${System.currentTimeMillis()}"
        val result = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            current.speak(speechText, TextToSpeech.QUEUE_FLUSH, Bundle(), utteranceId)
        } else {
            @Suppress("DEPRECATION")
            current.speak(speechText, TextToSpeech.QUEUE_FLUSH, null, utteranceId)
        }
        if (result == TextToSpeech.ERROR) shutdownEngine()
    }

    private fun shutdownEngine() {
        val current = engine
        engine = null
        try {
            current?.stop()
            current?.shutdown()
        } catch (_: Exception) {
            // Ignore cleanup failures from platform TTS engines.
        }
    }
}
