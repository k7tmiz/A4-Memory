package app.tauri

import android.app.Activity
import com.k2fsa.sherpa.onnx.OfflineTts
import com.k2fsa.sherpa.onnx.OfflineTtsConfig
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig
import com.k2fsa.sherpa.onnx.OfflineTtsVitsModelConfig
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import org.json.JSONObject

object A4OfflineTtsBridge {
    private const val QUEUED = "queued"
    private const val RUNNING = "running"
    private data class SynthesisResult(val json: String, val wavPath: String? = null)

    private val worker = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "a4-offline-tts").apply { isDaemon = true }
    }
    private val engineCache = ConcurrentHashMap<String, OfflineTts>()
    private val results = ConcurrentHashMap<String, String>()
    private val wavPaths = ConcurrentHashMap<String, String>()
    private val cancelled = ConcurrentHashMap.newKeySet<String>()

    @JvmStatic
    fun startSpeak(
        _activity: Activity,
        text: String,
        voiceId: String,
        voiceDir: String,
        requestId: String
    ): String? {
        val speechText = text.trim()
        val id = requestId.trim()
        if (speechText.isEmpty()) return "error:empty text"
        if (id.isEmpty()) return "error:empty request id"
        if (results.putIfAbsent(id, QUEUED) != null) return "error:duplicate request id"

        return try {
            worker.execute {
                if (cancelled.remove(id)) {
                    cleanupRequest(id, deleteWav = true)
                    return@execute
                }
                results[id] = RUNNING
                if (cancelled.remove(id)) {
                    cleanupRequest(id, deleteWav = true)
                    return@execute
                }
                val result = try {
                    speakSafe(speechText, voiceId, voiceDir)
                } catch (e: Throwable) {
                    errorResult("${e.javaClass.simpleName}: ${e.message ?: "unknown"}")
                }
                result.wavPath?.let { wavPaths[id] = it }
                results[id] = result.json
                if (cancelled.remove(id)) cleanupRequest(id, deleteWav = true)
            }
            QUEUED
        } catch (e: Throwable) {
            cleanupRequest(id, deleteWav = true)
            "error:${e.javaClass.simpleName}: ${e.message ?: "unknown"}"
        }
    }

    @JvmStatic
    fun takeResult(requestId: String): String? {
        val id = requestId.trim()
        return results[id] ?: "missing"
    }

    @JvmStatic
    fun cancelRequest(requestId: String): String? {
        val id = requestId.trim()
        if (id.isEmpty()) return "error:empty request id"
        val state = results[id] ?: return "missing"
        cancelled.add(id)
        cleanupRequest(id, deleteWav = true)
        if (state != QUEUED && state != RUNNING) cancelled.remove(id)
        return "cancelled"
    }

    @JvmStatic
    fun completeRequest(requestId: String): String? {
        val id = requestId.trim()
        if (id.isEmpty()) return "error:empty request id"
        cancelled.remove(id)
        cleanupRequest(id, deleteWav = false)
        return "completed"
    }

    @JvmStatic
    fun clearVoice(voiceId: String, requestId: String): String? {
        val id = voiceId.trim()
        val operationId = requestId.trim()
        if (id.isEmpty()) return "error:empty voice id"
        if (operationId.isEmpty()) return "error:empty request id"
        if (results.putIfAbsent(operationId, QUEUED) != null) return "error:duplicate request id"
        return try {
            worker.execute {
                if (cancelled.remove(operationId)) {
                    cleanupRequest(operationId, deleteWav = true)
                    return@execute
                }
                results[operationId] = RUNNING
                val result = try {
                    engineCache.remove(id)?.release()
                    "cleared"
                } catch (e: Throwable) {
                    "error:${e.javaClass.simpleName}: ${e.message ?: "unknown"}"
                }
                results[operationId] = result
                if (cancelled.remove(operationId)) cleanupRequest(operationId, deleteWav = true)
            }
            QUEUED
        } catch (e: Throwable) {
            cleanupRequest(operationId, deleteWav = true)
            "error:${e.javaClass.simpleName}: ${e.message ?: "unknown"}"
        }
    }

    private fun cleanupRequest(requestId: String, deleteWav: Boolean) {
        results.remove(requestId)
        val wavPath = wavPaths.remove(requestId)
        if (deleteWav && wavPath != null) File(wavPath).delete()
    }

    private fun speakSafe(text: String, voiceId: String, voiceDir: String): SynthesisResult {
        val tts = engineCache.getOrPut(voiceId) { createEngine(voiceDir) }
        val audio = try {
            tts.generate(text, 0, 1.0f)
        } catch (e: Exception) {
            engineCache.remove(voiceId)?.release()
            return errorResult("synthesis failed: ${e.message ?: "unknown"}")
        }

        if (audio.samples.isEmpty()) return errorResult("no audio samples generated")

        val cacheDir = File(voiceDir, ".cache")
        if (!cacheDir.exists() && !cacheDir.mkdirs()) {
            return errorResult("cannot create audio cache directory")
        }
        val wavFile = File(cacheDir, "output_${System.nanoTime()}.wav")
        if (!audio.save(wavFile.absolutePath)) {
            wavFile.delete()
            return errorResult("failed to save generated audio")
        }

        val result = JSONObject()
            .put("ok", true)
            .put("sample_rate", audio.sampleRate)
            .put("wav_path", wavFile.absolutePath)
            .toString()
        return SynthesisResult(result, wavFile.absolutePath)
    }

    private fun createEngine(voiceDir: String): OfflineTts {
        val metaFile = File(voiceDir, "voice.json")
        if (!metaFile.exists()) throw IllegalStateException("voice.json not found in $voiceDir")
        val meta = JSONObject(metaFile.readText())
        val modelName = meta.optString("model", "")
        val tokensName = meta.optString("tokens", "")
        val lexiconName = if (meta.isNull("lexicon")) "" else meta.optString("lexicon", "")
        val dataDirName = if (meta.isNull("data_dir")) "" else meta.optString("data_dir", "")
        if (modelName.isEmpty() || tokensName.isEmpty()) {
            throw IllegalStateException("voice.json missing model or tokens field")
        }

        val modelPath = File(voiceDir, modelName).absolutePath
        val tokensPath = File(voiceDir, tokensName).absolutePath
        val lexiconPath = if (lexiconName.isNotEmpty()) File(voiceDir, lexiconName).absolutePath else ""
        val dataDirPath = if (dataDirName.isNotEmpty()) File(voiceDir, dataDirName).absolutePath else ""

        val config = OfflineTtsConfig(
            model = OfflineTtsModelConfig(
                vits = OfflineTtsVitsModelConfig(
                    model = modelPath,
                    lexicon = lexiconPath,
                    tokens = tokensPath,
                    dataDir = dataDirPath,
                    noiseScale = 0.667f,
                    noiseScaleW = 0.8f,
                    lengthScale = 1.0f
                ),
                numThreads = 2,
                debug = false,
                provider = "cpu"
            ),
            maxNumSentences = 1
        )

        return OfflineTts(assetManager = null, config = config)
    }

    private fun errorResult(message: String): SynthesisResult =
        SynthesisResult(JSONObject().put("ok", false).put("error", message).toString())
}
