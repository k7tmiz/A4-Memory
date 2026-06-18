package app.tauri

import android.app.Activity
import com.k2fsa.sherpa.onnx.OfflineTts
import com.k2fsa.sherpa.onnx.OfflineTtsConfig
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig
import com.k2fsa.sherpa.onnx.OfflineTtsVitsModelConfig
import java.io.File
import java.util.concurrent.ConcurrentHashMap

object A4OfflineTtsBridge {
    private val engineCache = ConcurrentHashMap<String, OfflineTts>()

    @JvmStatic
    fun speak(activity: Activity, text: String, voiceId: String, voiceDir: String): String? {
        return try {
            speakSafe(activity, text, voiceId, voiceDir)
        } catch (e: Throwable) {
            """{"ok":false,"error":"${e.javaClass.simpleName}: ${e.message ?: "unknown"}"}"""
        }
    }

    private fun speakSafe(activity: Activity, text: String, voiceId: String, voiceDir: String): String {
        val speechText = text.trim()
        if (speechText.isEmpty()) {
            return """{"ok":false,"error":"empty text"}"""
        }

        val tts = engineCache.getOrPut(voiceId) {
            createEngine(voiceDir)
        }

        val audio = try {
            tts.generate(speechText, 0, 1.0f)
        } catch (e: Exception) {
            engineCache.remove(voiceId)?.release()
            return """{"ok":false,"error":"synthesis failed: ${e.message}"}"""
        }

        if (audio.samples.isEmpty()) {
            return """{"ok":false,"error":"no audio samples generated"}"""
        }

        val wav = floatArrayToWav(audio.samples, audio.sampleRate)

        val cacheDir = File(voiceDir, ".cache")
        cacheDir.mkdirs()
        val wavFile = File(cacheDir, "output_${System.currentTimeMillis()}.wav")
        wavFile.writeBytes(wav)

        return """{"ok":true,"sample_rate":${audio.sampleRate},"wav_path":"${wavFile.absolutePath}"}"""
    }

    private fun createEngine(voiceDir: String): OfflineTts {
        val metaFile = File(voiceDir, "voice.json")
        if (!metaFile.exists()) {
            throw IllegalStateException("voice.json not found in $voiceDir")
        }
        val meta = metaFile.readText()

        // Extract fields from JSON manually to avoid extra dependencies
        fun extractJsonString(json: String, key: String): String {
            val regex = """"$key"\s*:\s*"((?:[^"\\]|\\.)*)"""".toRegex()
            val match = regex.find(json) ?: return ""
            return match.groupValues[1]
        }

        val modelName = extractJsonString(meta, "model")
        val tokensName = extractJsonString(meta, "tokens")
        val lexiconName = extractJsonString(meta, "lexicon")
        val dataDirName = extractJsonString(meta, "data_dir")

        val modelPath = File(voiceDir, modelName).absolutePath
        val tokensPath = File(voiceDir, tokensName).absolutePath
        val lexiconPath = if (lexiconName.isNotEmpty()) File(voiceDir, lexiconName).absolutePath else ""
        val dataDirPath = if (dataDirName.isNotEmpty()) File(voiceDir, dataDirName).absolutePath else ""

        if (modelName.isEmpty() || tokensName.isEmpty()) {
            throw IllegalStateException("voice.json missing model or tokens field")
        }

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

    private fun floatArrayToWav(samples: FloatArray, sampleRate: Int): ByteArray {
        val dataSize = samples.size * 2
        val buf = java.io.ByteArrayOutputStream(44 + dataSize)
        val dos = java.io.DataOutputStream(buf)

        fun writeLeShort(v: Int) = dos.writeShort(java.lang.Integer.reverseBytes(v shl 16) ushr 16)
        fun writeLeInt(v: Int) = dos.writeInt(java.lang.Integer.reverseBytes(v))

        // RIFF header
        dos.writeBytes("RIFF")
        writeLeInt(36 + dataSize)
        dos.writeBytes("WAVE")

        // fmt chunk
        dos.writeBytes("fmt ")
        writeLeInt(16)                // chunk size
        writeLeShort(1)               // PCM
        writeLeShort(1)               // mono
        writeLeInt(sampleRate)
        writeLeInt(sampleRate * 2)    // byte rate
        writeLeShort(2)               // block align
        writeLeShort(16)              // bits per sample

        // data chunk
        dos.writeBytes("data")
        writeLeInt(dataSize)

        // samples
        for (s in samples) {
            val clamped = s.coerceIn(-1f, 1f)
            val int16 = (clamped * 32767f).toInt()
            writeLeShort(int16)
        }

        dos.flush()
        return buf.toByteArray()
    }
}
