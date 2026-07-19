const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const { describe, it } = require("node:test")
const assert = require("node:assert/strict")

const commonCode = fs.readFileSync(path.join(__dirname, "..", "js", "core", "common.js"), "utf8")
const speechCode = fs.readFileSync(path.join(__dirname, "..", "js", "speech.js"), "utf8")
const settingsCode = fs.readFileSync(path.join(__dirname, "..", "js", "settings.js"), "utf8")
const styleCode = fs.readFileSync(path.join(__dirname, "..", "css", "style.css"), "utf8")

function createBaseSandbox() {
  const document = {
    activeElement: null,
    body: {
      appendChild() {},
      classList: { add() {}, remove() {} },
      contains() { return false },
      style: {},
    },
    addEventListener() {},
    removeEventListener() {},
    getElementById() { return { id: "existing-modal" } },
  }
  const window = {
    WORDS: [],
    WORDBOOKS: [],
    addEventListener() {},
    alert() {},
    document,
    scrollTo() {},
    scrollY: 0,
  }
  window.window = window
  return {
    console,
    document,
    window,
    setTimeout,
    clearTimeout,
    Uint8Array,
    ArrayBuffer,
    Blob,
    Error,
    URL,
  }
}

function loadSpeech({ invokeHandler, audioPlay, bridgeHandler, userAgent = "Android 15" } = {}) {
  const sandbox = createBaseSandbox()
  const invokeCalls = []
  const audioSources = []
  const bridgeCalls = []
  const alerts = []
  let blobSequence = 0

  class FakeAudio {
    constructor(src = "") {
      this.src = String(src || "")
      audioSources.push(this.src)
    }

    play() {
      const error = typeof audioPlay === "function" ? audioPlay(this.src) : null
      if (error) return Promise.reject(error)
      if (typeof this.onplaying === "function") this.onplaying()
      return Promise.resolve()
    }

    pause() {}

    removeAttribute(name) {
      if (name === "src") this.src = ""
    }

    load() {}
  }

  class FakeUtterance {
    constructor(text) {
      this.text = text
    }
  }

  const invoke = async (command, args) => {
    invokeCalls.push({ command, args })
    if (typeof invokeHandler === "function") return invokeHandler(command, args)
    return undefined
  }

  Object.assign(sandbox.window, {
    A4Utils: { getTauriInvoke: () => invoke },
    A4TtsBridge: {
      synthesize: async (request) => {
        bridgeCalls.push(request)
        if (typeof bridgeHandler === "function") return bridgeHandler(request)
        return { success: false }
      },
    },
    Audio: FakeAudio,
    Blob,
    URL: {
      createObjectURL() {
        blobSequence += 1
        return `blob:a4-${blobSequence}`
      },
      revokeObjectURL() {},
    },
    SpeechSynthesisUtterance: FakeUtterance,
    crypto: {},
    navigator: { userAgent },
    speechSynthesis: {
      addEventListener() {},
      removeEventListener() {},
      cancel() {},
      getVoices() { return [] },
      speak(utterance) {
        if (typeof utterance.onend === "function") utterance.onend()
      },
    },
    alert(message) { alerts.push(String(message || "")) },
  })
  Object.assign(sandbox, {
    Audio: FakeAudio,
    SpeechSynthesisUtterance: FakeUtterance,
    navigator: sandbox.window.navigator,
    URL: sandbox.window.URL,
  })

  vm.createContext(sandbox)
  vm.runInContext(commonCode, sandbox)
  vm.runInContext(speechCode, sandbox)
  return {
    speech: sandbox.window.A4Speech,
    invokeCalls,
    audioSources,
    bridgeCalls,
    alerts,
  }
}

function createDeferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function makeSpeakOptions(overrides = {}) {
  return {
    text: "Hello",
    pronunciationEnabled: true,
    pronunciationLang: "en",
    wordbookLanguage: "en-US",
    accent: "auto",
    voiceMode: "auto",
    voiceURI: "",
    onlineTtsEnabled: true,
    onlineTtsProvider: "edge",
    ttsMode: "offline",
    offlineVoiceId: "voice-en",
    ...overrides,
  }
}

function loadSettingsHelpers() {
  const sandbox = createBaseSandbox()
  Object.assign(sandbox.window, {
    A4Utils: {},
    A4Storage: {},
    A4Speech: {
      getCurrentLanguageBase({ pronunciationLang, wordbookLanguage }) {
        if (pronunciationLang && pronunciationLang !== "auto") return pronunciationLang
        return String(wordbookLanguage || "en").split("-")[0].toLowerCase()
      },
    },
    matchMedia() { return { matches: false } },
  })
  sandbox.localStorage = {
    getItem() { return null },
    removeItem() {},
    setItem() {},
  }
  sandbox.alert = () => {}
  vm.createContext(sandbox)
  vm.runInContext(commonCode, sandbox)
  vm.runInContext(settingsCode, sandbox)
  return sandbox.window.A4Settings
}

describe("A4Speech offline TTS routing", () => {
  it("discovers and speaks an installed offline voice on Android Tauri", async () => {
    const harness = loadSpeech({
      invokeHandler(command) {
        if (command === "a4_offline_voices_installed") return [{ id: "voice-en", lang: "en-US" }]
        if (command === "a4_offline_speak") return { ok: true, wav: [1, 2, 3] }
        throw new Error(`unexpected command: ${command}`)
      },
    })

    assert.equal(await harness.speech.isOfflineAvailableForLang("en", "voice-en"), true)
    assert.equal(await harness.speech.speak(makeSpeakOptions()), true)

    assert.deepEqual(harness.invokeCalls.map((call) => call.command), [
      "a4_offline_voices_installed",
      "a4_offline_speak",
    ])
    assert.equal(harness.audioSources.some((src) => /^https?:/i.test(src)), false)
    assert.equal(harness.bridgeCalls.length, 0)
    assert.equal(harness.speech.getLastSpeakResult().usedMode, "offline")
  })

  for (const scenario of [
    {
      name: "native invoke rejection",
      offlineResult() { throw new Error("native engine failed") },
      errorPattern: /native engine failed/i,
    },
    {
      name: "native failure result",
      offlineResult() { return { ok: false, wav: [], error: "model returned no audio" } },
      errorPattern: /model returned no audio/i,
    },
    {
      name: "audio playback rejection",
      offlineResult() { return { ok: true, wav: [1, 2, 3] } },
      audioPlay(src) { return src.startsWith("blob:") ? new Error("audio decoder failed") : null },
      errorPattern: /audio decoder failed/i,
    },
  ]) {
    it(`falls back only to system TTS after ${scenario.name}`, async () => {
      const harness = loadSpeech({
        audioPlay: scenario.audioPlay,
        invokeHandler(command) {
          if (command === "a4_offline_voices_installed") return [{ id: "voice-en", lang: "en-US" }]
          if (command === "a4_offline_speak") return scenario.offlineResult()
          if (command === "a4_android_speak") return undefined
          throw new Error(`unexpected command: ${command}`)
        },
      })

      assert.equal(await harness.speech.speak(makeSpeakOptions()), true)
      const result = harness.speech.getLastSpeakResult()

      assert.equal(result.requestedMode, "offline")
      assert.equal(result.usedMode, "system")
      assert.match(result.error, scenario.errorPattern)
      assert.equal(harness.audioSources.some((src) => /^https?:/i.test(src)), false)
      assert.equal(harness.bridgeCalls.length, 0)
      assert.equal(harness.invokeCalls.some((call) => call.command === "a4_android_speak"), true)
    })
  }

  it("does not cache an installed-voice lookup failure", async () => {
    let attempts = 0
    const harness = loadSpeech({
      invokeHandler(command) {
        assert.equal(command, "a4_offline_voices_installed")
        attempts += 1
        if (attempts === 1) throw new Error("temporary bridge failure")
        return [{ id: "voice-en", lang: "en-US" }]
      },
    })

    assert.deepEqual(JSON.parse(JSON.stringify(await harness.speech.refreshOfflineInstalled())), [])
    const retried = await harness.speech.refreshOfflineInstalled()
    assert.equal(retried[0]?.id, "voice-en")
    assert.equal(attempts, 2)
  })

  it("keeps the online to offline fallback order in online mode", async () => {
    const harness = loadSpeech({
      audioPlay(src) {
        return /^https?:/i.test(src) ? new Error("network audio unavailable") : null
      },
      invokeHandler(command) {
        if (command === "a4_offline_voices_installed") return [{ id: "voice-en", lang: "en-US" }]
        if (command === "a4_offline_speak") return { ok: true, wav: [1, 2, 3] }
        if (command === "a4_android_speak") return undefined
        throw new Error(`unexpected command: ${command}`)
      },
    })

    assert.equal(await harness.speech.speak(makeSpeakOptions({ ttsMode: "online" })), true)
    const result = harness.speech.getLastSpeakResult()

    assert.equal(result.requestedMode, "online")
    assert.equal(result.usedMode, "offline")
    assert.equal(harness.audioSources.some((src) => /^https?:/i.test(src)), true)
    assert.equal(harness.invokeCalls.some((call) => call.command === "a4_offline_speak"), true)
    assert.equal(harness.invokeCalls.some((call) => call.command === "a4_android_speak"), false)
  })

  it("ignores a stale offline result after a newer speak request", async () => {
    const oldOfflineResult = createDeferred()
    const oldOfflineStarted = createDeferred()
    const harness = loadSpeech({
      audioPlay(src) {
        return src.startsWith("blob:") ? new Error("stale audio must not play") : null
      },
      invokeHandler(command, args) {
        if (command === "a4_offline_voices_installed") return [{ id: "voice-en", lang: "en-US" }]
        if (command === "a4_offline_speak" && args?.text === "Old") {
          oldOfflineStarted.resolve()
          return oldOfflineResult.promise
        }
        if (command === "a4_android_speak") return undefined
        throw new Error(`unexpected command: ${command}`)
      },
    })

    const oldSpeak = harness.speech.speak(makeSpeakOptions({ text: "Old" }))
    await oldOfflineStarted.promise
    const newSpeak = await harness.speech.speak(makeSpeakOptions({
      text: "New",
      ttsMode: "system",
      onlineTtsEnabled: false,
    }))
    oldOfflineResult.resolve({ ok: true, wav: [1, 2, 3] })

    assert.equal(newSpeak, true)
    assert.equal(await oldSpeak, false)
    assert.deepEqual(
      harness.invokeCalls
        .filter((call) => call.command === "a4_android_speak")
        .map((call) => call.args?.text),
      ["New"]
    )
    assert.equal(harness.audioSources.some((src) => src.startsWith("blob:")), false)
    assert.equal(harness.speech.getLastSpeakResult()?.requestedMode, "system")
  })

  it("ignores a stale online bridge response before playback or fallback", async () => {
    const oldBridgeResult = createDeferred()
    const oldBridgeStarted = createDeferred()
    let oldBridgeCalls = 0
    const harness = loadSpeech({
      audioPlay() {
        return new Error("network audio unavailable")
      },
      bridgeHandler(request) {
        if (request?.text === "Old" && oldBridgeCalls++ === 0) {
          oldBridgeStarted.resolve()
          return oldBridgeResult.promise
        }
        return { success: false }
      },
      invokeHandler(command, args) {
        if (command === "a4_android_speak") return undefined
        if (command === "a4_offline_voices_installed") return []
        throw new Error(`unexpected command: ${command} ${args?.text || ""}`)
      },
    })

    const oldSpeak = harness.speech.speak(makeSpeakOptions({ text: "Old", ttsMode: "online" }))
    await oldBridgeStarted.promise
    const newSpeak = await harness.speech.speak(makeSpeakOptions({
      text: "New",
      ttsMode: "system",
      onlineTtsEnabled: false,
    }))
    oldBridgeResult.resolve({ success: true, audio: new Uint8Array([1, 2, 3]), contentType: "audio/mpeg" })

    assert.equal(newSpeak, true)
    assert.equal(await oldSpeak, false)
    assert.equal(harness.audioSources.length, 0)
    assert.equal(harness.bridgeCalls.length, 1)
    assert.deepEqual(
      harness.invokeCalls
        .filter((call) => call.command === "a4_android_speak")
        .map((call) => call.args?.text),
      ["New"]
    )
    assert.equal(harness.invokeCalls.some((call) => call.command === "a4_offline_voices_installed"), false)
    assert.equal(harness.speech.getLastSpeakResult()?.requestedMode, "system")
  })

  it("keeps the exported three-argument speakOnline API", async () => {
    const harness = loadSpeech({ userAgent: "Desktop Browser" })

    assert.equal(await harness.speech.speakOnline("Hello", "en-US", "google"), true)
    assert.equal(harness.audioSources.some((src) => src.includes("translate.google.com/translate_tts")), true)
  })
})

describe("A4Settings TTS helpers", () => {
  it("builds test speech options with the selected mode and language voice", () => {
    const settings = loadSettingsHelpers()
    assert.equal(typeof settings.buildTestSpeechOptions, "function")

    const options = settings.buildTestSpeechOptions({
      text: "Hola",
      languageBase: "es",
      wordbookLanguage: "es-ES",
      state: {
        pronunciationEnabled: true,
        pronunciationLang: "auto",
        pronunciationAccent: "auto",
        voiceMode: "auto",
        voiceURI: "",
        onlineTtsEnabled: false,
        onlineTtsProvider: "edge",
        ttsMode: "offline",
        offlineVoiceByLang: { es: "voice-es" },
      },
    })

    assert.equal(options.ttsMode, "offline")
    assert.equal(options.offlineVoiceId, "voice-es")
    assert.equal(options.wordbookLanguage, "es-ES")
  })

  it("describes offline success, system fallback, and terminal errors", () => {
    const settings = loadSettingsHelpers()
    assert.equal(typeof settings.formatTestSpeakResult, "function")

    assert.match(
      settings.formatTestSpeakResult(true, { requestedMode: "offline", usedMode: "offline" }),
      /离线语音可用/
    )
    assert.match(
      settings.formatTestSpeakResult(true, {
        requestedMode: "offline",
        usedMode: "system",
        error: "模型加载失败",
      }),
      /离线发音失败.*回退系统语音/
    )
    assert.match(
      settings.formatTestSpeakResult(false, {
        requestedMode: "offline",
        usedMode: "",
        error: "模型加载失败",
      }),
      /测试失败.*模型加载失败/
    )
  })

  it("builds the offline download command payload from a voice id", () => {
    const settings = loadSettingsHelpers()
    assert.equal(typeof settings.buildOfflineVoiceDownloadArgs, "function")
    const onProgress = { channel: true }
    const args = settings.buildOfflineVoiceDownloadArgs("voice-es", onProgress)

    assert.equal(args.voiceId, "voice-es")
    assert.equal(args.onProgress, onProgress)
    assert.equal(Object.hasOwn(args, "voice"), false)
  })

  it("renders bounded manifest labels as text nodes", () => {
    const settings = loadSettingsHelpers()
    assert.equal(typeof settings.createOfflineVoiceTitle, "function")
    const created = []
    const documentRef = {
      createElement(tagName) {
        const element = {
          tagName: String(tagName || "").toUpperCase(),
          children: [],
          className: "",
          style: {},
          textContent: "",
          appendChild(child) { this.children.push(child) },
        }
        Object.defineProperty(element, "innerHTML", {
          set() { throw new Error("manifest labels must not use innerHTML") },
        })
        created.push(element)
        return element
      },
    }
    const title = settings.createOfflineVoiceTitle({
      voice: {
        name: `<img src=x onerror=alert(1)>${"n".repeat(200)}`,
        lang: `<script>alert(1)</script>${"l".repeat(80)}`,
      },
      id: "fallback-id",
      sizeText: "12.0 MB",
      documentRef,
    })

    assert.equal(title.children.length, 2)
    assert.equal(title.className, "offline-voice-title")
    assert.equal(title.children[1].className, "form-help offline-voice-meta")
    assert.match(title.children[0].textContent, /^<img src=x onerror=alert\(1\)>/)
    assert.equal(title.children[0].textContent.length <= 120, true)
    assert.match(title.children[1].textContent, /^<script>alert\(1\)<\/script>/)
    assert.equal(title.children[1].textContent.split(" · ")[0].length <= 40, true)
    assert.equal(title.children[1].textContent.endsWith(" · 12.0 MB"), true)
    assert.equal(created.length, 3)
  })

  it("uses an always-visible compact full-width offline voice list with inline errors", () => {
    assert.match(settingsCode, /class="form-row offline-tts-section" id="offlineTtsSection"/)
    assert.doesNotMatch(settingsCode, /class="form-row offline-tts-section hidden"/)
    assert.match(settingsCode, /id="offlineTtsStatus"[^>]*role="status"[^>]*aria-live="polite"/)
    assert.match(settingsCode, /row\.className = "offline-voice-row"/)
    assert.match(settingsCode, /head\.className = "offline-voice-head"/)
    assert.match(settingsCode, /actions\.className = "offline-voice-actions"/)
    assert.match(settingsCode, /progLabel\.className = "form-help offline-voice-progress"/)
    assert.match(settingsCode, /try\s*\{\s*const channel = new ChannelCtor/)
    assert.doesNotMatch(settingsCode, /row\.style\.cssText/)
    assert.doesNotMatch(settingsCode, /alert\(`(?:下载|删除)失败：/)
    assert.doesNotMatch(settingsCode, /alert\("当前 Tauri 环境不支持下载进度通道。"\)/)
    assert.match(
      styleCode,
      /\.offline-tts-section\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s
    )
    assert.match(
      styleCode,
      /\.offline-voice-head\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/s
    )
    assert.match(
      styleCode,
      /@media \(max-width:\s*360px\)\s*\{\s*\.offline-voice-head\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s
    )
  })

  it("builds system test options for a legacy records-page state", () => {
    const settings = loadSettingsHelpers()
    const options = settings.buildTestSpeechOptions({
      text: "Hello",
      languageBase: "en",
      wordbookLanguage: "en-US",
      state: {
        pronunciationEnabled: true,
        onlineTtsEnabled: false,
      },
    })

    assert.equal(options.ttsMode, "system")
    assert.equal(options.onlineTtsEnabled, false)
  })
})
