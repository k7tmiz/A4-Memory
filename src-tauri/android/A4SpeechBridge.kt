package app.tauri

import android.app.Activity
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
                speakOnMainThread(activity, speechText, locale)
            } catch (_: Exception) {
                shutdownEngine()
            }
        }

        return null
    }

    private fun speakOnMainThread(activity: Activity, speechText: String, locale: Locale) {
        shutdownEngine()

        engine = TextToSpeech(activity.applicationContext) { status ->
            mainHandler.post { speakWhenReady(status, speechText, locale) }
        }
    }

    private fun speakWhenReady(status: Int, speechText: String, locale: Locale) {
        val current = engine ?: return
        if (status != TextToSpeech.SUCCESS) {
            shutdownEngine()
            return
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
