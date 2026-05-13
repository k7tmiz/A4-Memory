package app.tauri

import android.app.Activity
import android.os.Build
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import java.util.Locale
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

object A4SpeechBridge {
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

        val initLatch = CountDownLatch(1)
        val doneLatch = CountDownLatch(1)
        val errorRef = AtomicReference<String?>(null)
        val engineRef = AtomicReference<TextToSpeech?>()

        val tts = try {
            TextToSpeech(activity.applicationContext) { status ->
                val engine = engineRef.get()
                if (status != TextToSpeech.SUCCESS || engine == null) {
                    errorRef.compareAndSet(null, "Android TTS initialization failed")
                    initLatch.countDown()
                    return@TextToSpeech
                }

                try {
                    val langResult = engine.setLanguage(locale)
                    if (langResult == TextToSpeech.LANG_MISSING_DATA || langResult == TextToSpeech.LANG_NOT_SUPPORTED) {
                        errorRef.compareAndSet(null, "Android TTS language is not available")
                        initLatch.countDown()
                        return@TextToSpeech
                    }
                } catch (e: Exception) {
                    errorRef.compareAndSet(null, "Android TTS language setup failed: ${e.message ?: "unknown"}")
                    initLatch.countDown()
                    return@TextToSpeech
                }

                engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                    override fun onStart(utteranceId: String?) = Unit

                    override fun onDone(utteranceId: String?) {
                        doneLatch.countDown()
                    }

                    @Deprecated("Deprecated in Java")
                    override fun onError(utteranceId: String?) {
                        errorRef.compareAndSet(null, "Android TTS speak failed")
                        doneLatch.countDown()
                    }

                    override fun onError(utteranceId: String?, errorCode: Int) {
                        errorRef.compareAndSet(null, "Android TTS speak failed")
                        doneLatch.countDown()
                    }
                })

                try {
                    val utteranceId = "a4-memory-${System.currentTimeMillis()}"
                    val speakResult =
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                            engine.speak(speechText, TextToSpeech.QUEUE_FLUSH, Bundle(), utteranceId)
                        } else {
                            @Suppress("DEPRECATION")
                            engine.speak(speechText, TextToSpeech.QUEUE_FLUSH, null, utteranceId)
                        }
                    if (speakResult == TextToSpeech.ERROR) {
                        errorRef.compareAndSet(null, "Android TTS speak failed")
                        doneLatch.countDown()
                    }
                } catch (e: Exception) {
                    errorRef.compareAndSet(null, "Android TTS speak failed: ${e.message ?: "unknown"}")
                    doneLatch.countDown()
                } finally {
                    initLatch.countDown()
                }
            }
        } catch (e: Exception) {
            return "failed to create TextToSpeech: ${e.message ?: "unknown"}"
        }

        engineRef.set(tts)

        if (!initLatch.await(3, TimeUnit.SECONDS)) {
            tts.shutdown()
            return "Android TTS initialization timed out"
        }

        val initError = errorRef.get()
        if (initError != null) {
            tts.shutdown()
            return initError
        }

        if (!doneLatch.await(6, TimeUnit.SECONDS)) {
            tts.shutdown()
            return "Android TTS speak timed out"
        }

        tts.shutdown()
        return errorRef.get()
    }
}
