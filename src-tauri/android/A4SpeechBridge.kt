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
import android.provider.Settings
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import androidx.core.content.FileProvider
import java.io.File
import java.io.FileOutputStream
import java.util.Locale
import org.json.JSONArray
import org.json.JSONObject

object A4SpeechBridge {
    private val mainHandler = Handler(Looper.getMainLooper())
    private var engine: TextToSpeech? = null

    private const val ACTION_TTS_SERVICE = "android.intent.action.TTS_SERVICE"
    private const val ENGINE_ESPEAK = "com.googlecode.eyesfree.espeak"
    private const val ENGINE_GOOGLE = "com.google.android.tts"
    private const val SETTING_DEFAULT_TTS_ENGINE = "tts_default_synth"
    private const val AUTHORITY_SUFFIX = ".fileprovider"

    @JvmStatic
    fun listEngines(activity: Activity): String {
        return try {
            val context = activity.applicationContext
            val pm = context.packageManager
            val defaultEngine = Settings.Secure.getString(context.contentResolver, SETTING_DEFAULT_TTS_ENGINE) ?: ""
            val engines = JSONArray()
            val seen = mutableSetOf<String>()
            val services = pm.queryIntentServices(
                Intent(ACTION_TTS_SERVICE),
                PackageManager.MATCH_DEFAULT_ONLY
            )

            for (service in services) {
                val packageName = service.serviceInfo?.packageName ?: continue
                if (!seen.add(packageName)) continue
                val label = try {
                    service.loadLabel(pm)?.toString()
                } catch (_: Exception) {
                    null
                }
                engines.put(
                    JSONObject()
                        .put("packageName", packageName)
                        .put("name", label?.takeIf { it.isNotBlank() } ?: packageName)
                        .put("default", packageName == defaultEngine)
                        .put("installed", true)
                        .put("bundled", false)
                )
            }

            if (hasBuiltinEspeak(context) && !seen.contains(ENGINE_ESPEAK)) {
                engines.put(
                    JSONObject()
                        .put("packageName", ENGINE_ESPEAK)
                        .put("name", "eSpeak NG")
                        .put("default", false)
                        .put("installed", false)
                        .put("bundled", true)
                )
            }

            JSONObject()
                .put("ok", true)
                .put("defaultEngine", defaultEngine)
                .put("engines", engines)
                .toString()
        } catch (e: Exception) {
            JSONObject()
                .put("ok", false)
                .put("error", e.message ?: "unknown")
                .toString()
        }
    }

    @JvmStatic
    fun speak(activity: Activity, text: String, langTag: String, enginePackage: String): String? {
        return try {
            speakSafe(activity, text, langTag, enginePackage)
        } catch (e: Throwable) {
            "error:${e.javaClass.simpleName}: ${e.message ?: "unknown"}"
        }
    }

    private fun speakSafe(activity: Activity, text: String, langTag: String, enginePackage: String): String? {
        val speechText = text.trim()
        if (speechText.isEmpty()) return "empty"

        val targetTag = langTag.trim().ifEmpty { "en-US" }
        val locale = try {
            Locale.forLanguageTag(targetTag)
        } catch (e: Exception) {
            return "Android TTS locale error: ${e.message ?: "unknown"}"
        }

        val ctx = activity.applicationContext
        val requestedEngine = enginePackage.trim()
        if (requestedEngine.isNotEmpty() && !isEngineInstalled(ctx, requestedEngine)) {
            return if (requestedEngine == ENGINE_ESPEAK && hasBuiltinEspeak(ctx)) {
                triggerEspeakInstall(ctx, activity)
            } else {
                "error:engine_not_installed"
            }
        }
        if (requestedEngine.isEmpty() && !hasAnyTtsEngine(ctx) && hasBuiltinEspeak(ctx)) {
            return triggerEspeakInstall(ctx, activity)
        }

        mainHandler.post {
            try {
                speakOnMainThread(ctx, speechText, locale, requestedEngine.ifEmpty { null })
            } catch (_: Exception) {
                shutdownEngine()
            }
        }

        return "queued"
    }

    private fun hasBuiltinEspeak(context: Context): Boolean {
        return try {
            val resId = context.resources.getIdentifier("espeak", "raw", context.packageName)
            resId != 0
        } catch (_: Exception) {
            false
        }
    }

    private fun triggerEspeakInstall(context: Context, activity: Activity): String {
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !context.packageManager.canRequestPackageInstalls()) {
                val settingsIntent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply {
                    data = Uri.parse("package:${context.packageName}")
                }
                activity.startActivity(settingsIntent)
                return "install_permission_required"
            }

            val resId = context.resources.getIdentifier("espeak", "raw", context.packageName)
            if (resId == 0) return "error:missing_bundled_espeak"

            val destDir = File(context.filesDir, "tts")
            if (!destDir.exists()) destDir.mkdirs()
            val destFile = File(destDir, "espeak.apk")

            if (!destFile.exists()) {
                context.resources.openRawResource(resId).use { input ->
                    FileOutputStream(destFile).use { output ->
                        input.copyTo(output)
                    }
                }
            }

            val authority = "${context.packageName}$AUTHORITY_SUFFIX"
            val uri: Uri = FileProvider.getUriForFile(context, authority, destFile)

            val intent = Intent(Intent.ACTION_INSTALL_PACKAGE).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                putExtra(Intent.EXTRA_RETURN_RESULT, false)
            }
            context.packageManager.queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY).forEach { info ->
                context.grantUriPermission(info.activityInfo.packageName, uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            activity.startActivity(intent)
            "install_started"
        } catch (e: Exception) {
            "error:${e.message ?: "install_failed"}"
        }
    }

    private fun isEngineInstalled(context: Context, packageName: String): Boolean {
        if (packageName.isBlank()) return false
        return try {
            context.packageManager.getPackageInfo(packageName, 0)
            true
        } catch (_: PackageManager.NameNotFoundException) {
            false
        } catch (_: Exception) {
            false
        }
    }

    private fun hasAnyTtsEngine(context: Context): Boolean {
        return try {
            context.packageManager
                .queryIntentServices(Intent(ACTION_TTS_SERVICE), PackageManager.MATCH_DEFAULT_ONLY)
                .isNotEmpty()
        } catch (_: Exception) {
            false
        }
    }

    private fun isEngineAvailable(tts: TextToSpeech, packageName: String): Boolean {
        return try {
            tts.engines.any { it.name == packageName }
        } catch (_: Exception) {
            false
        }
    }

    private fun speakOnMainThread(context: Context, speechText: String, locale: Locale, enginePackage: String?) {
        shutdownEngine()
        engine = if (enginePackage.isNullOrBlank()) TextToSpeech(context) { status ->
            mainHandler.post { speakWhenReady(status, speechText, locale) }
        } else TextToSpeech(context, { status ->
            mainHandler.post { speakWhenReady(status, speechText, locale) }
        }, enginePackage)
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
