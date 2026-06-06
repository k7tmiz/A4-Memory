package app.tauri

import android.app.Activity
import android.content.ContentValues
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.Environment
import android.provider.MediaStore
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.widget.Toast
import java.io.File
import java.util.Locale
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

object A4SpeechBridge {
    private val mainHandler = Handler(Looper.getMainLooper())
    private var engine: TextToSpeech? = null

    @JvmStatic
    fun speak(activity: Activity, text: String, langTag: String): String? {
        return try {
            speakSafe(activity, text, langTag)
        } catch (e: Throwable) {
            "error:${e.javaClass.simpleName}: ${e.message ?: "unknown"}"
        }
    }

    @JvmStatic
    fun saveTextFile(activity: Activity, filename: String, mime: String, content: String): String? {
        return try {
            saveTextFileSafe(activity, filename, mime, content)
        } catch (e: Throwable) {
            "error:${e.javaClass.simpleName}: ${e.message ?: "unknown"}"
        }
    }

    private fun saveTextFileSafe(activity: Activity, filename: String, mime: String, content: String): String? {
        val safeName = sanitizeFilename(filename).ifEmpty { "a4-memory-export.txt" }
        val safeMime = mime.trim().ifEmpty { "text/plain;charset=utf-8" }
        val bytes = content.toByteArray(Charsets.UTF_8)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val resolver = activity.contentResolver
            val values = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, safeName)
                put(MediaStore.MediaColumns.MIME_TYPE, safeMime)
                put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                put(MediaStore.MediaColumns.IS_PENDING, 1)
            }
            val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                ?: return "error:Cannot create Downloads file"
            try {
                resolver.openOutputStream(uri)?.use { it.write(bytes) }
                    ?: return "error:Cannot open Downloads file"
                values.clear()
                values.put(MediaStore.MediaColumns.IS_PENDING, 0)
                resolver.update(uri, values, null, null)
            } catch (e: Exception) {
                resolver.delete(uri, null, null)
                return "error:${e.javaClass.simpleName}: ${e.message ?: "unknown"}"
            }
        } else {
            val dir = activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
                ?: return "error:Cannot access app Downloads directory"
            if (!dir.exists() && !dir.mkdirs()) return "error:Cannot create app Downloads directory"
            File(dir, safeName).writeBytes(bytes)
        }

        mainHandler.post {
            Toast.makeText(activity.applicationContext, "已导出到下载目录：$safeName", Toast.LENGTH_LONG).show()
        }
        return "saved"
    }

    private fun sanitizeFilename(value: String): String {
        return value.trim()
            .replace(Regex("""[\\/:*?"<>|]"""), "-")
            .replace(Regex("""\s+"""), " ")
            .take(120)
    }

    private fun speakSafe(activity: Activity, text: String, langTag: String): String? {
        val speechText = text.trim()
        if (speechText.isEmpty()) return "empty"

        val targetTag = langTag.trim().ifEmpty { "en-US" }
        val locale = try {
            Locale.forLanguageTag(targetTag)
        } catch (e: Exception) {
            return "Android TTS locale error: ${e.message ?: "unknown"}"
        }

        val latch = CountDownLatch(1)
        val result = AtomicReference<String?>()

        mainHandler.post {
            try {
                speakOnMainThread(activity, speechText, locale) { status ->
                    result.set(status)
                    latch.countDown()
                }
            } catch (e: Exception) {
                shutdownEngine()
                result.set("error:${e.javaClass.simpleName}: ${e.message ?: "unknown"}")
                latch.countDown()
            }
        }

        if (!latch.await(1800, TimeUnit.MILLISECONDS)) {
            return "error:Android TTS bridge timed out"
        }
        return result.get()
    }

    private fun speakOnMainThread(activity: Activity, speechText: String, locale: Locale, onReady: (String?) -> Unit) {
        shutdownEngine()
        engine = TextToSpeech(activity.applicationContext) { status ->
            mainHandler.post { speakWhenReady(status, speechText, locale, onReady) }
        }
    }

    private fun speakWhenReady(status: Int, speechText: String, locale: Locale, onReady: (String?) -> Unit) {
        val current = engine
        if (current == null) {
            onReady("error:Android TTS engine unavailable")
            return
        }
        if (status != TextToSpeech.SUCCESS) {
            shutdownEngine()
            onReady("error:Android TTS engine initialization failed")
            return
        }

        val langResult = try {
            current.setLanguage(locale)
        } catch (e: Exception) {
            shutdownEngine()
            onReady("error:Android TTS language error: ${e.message ?: "unknown"}")
            return
        }
        if (langResult == TextToSpeech.LANG_MISSING_DATA || langResult == TextToSpeech.LANG_NOT_SUPPORTED) {
            shutdownEngine()
            onReady("error:Android TTS language is missing or not supported")
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
        if (result == TextToSpeech.ERROR) {
            shutdownEngine()
            onReady("error:Android TTS speak failed")
            return
        }
        onReady("queued")
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
