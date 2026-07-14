const fs = require("node:fs")
const fsp = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")
const crypto = require("node:crypto")
const { describe, it, afterEach } = require("node:test")
const assert = require("node:assert/strict")

const ROOT = path.join(__dirname, "..")
const PREPARE_SCRIPT = path.join(ROOT, "scripts", "prepare-android-tts.mjs")
const tempDirs = []

async function makeAndroidProject() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "a4-android-tts-test-"))
  tempDirs.push(root)
  const androidDir = path.join(root, "src-tauri", "gen", "android")
  const appDir = path.join(androidDir, "app")
  await fsp.mkdir(path.join(appDir, "src", "main", "java", "app", "tauri"), { recursive: true })
  await fsp.writeFile(
    path.join(appDir, "build.gradle.kts"),
    [
      "android {",
      "    defaultConfig {",
      "        minSdk = 24",
      "    }",
      "}",
      "",
      "dependencies {",
      "}",
      "",
    ].join("\n")
  )
  await fsp.writeFile(path.join(appDir, "proguard-rules.pro"), "# generated\n")
  return { root, androidDir, appDir }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fsp.rm(dir, { recursive: true, force: true })))
})

describe("Android offline TTS build preparation", () => {
  it("injects the AAR, native bridges, Gradle settings and keep rules idempotently", async () => {
    const { root, androidDir, appDir } = await makeAndroidProject()
    const fakeAar = path.join(root, "sherpa.aar")
    const fakeBytes = Buffer.from("fake sherpa aar for deterministic test")
    await fsp.writeFile(fakeAar, fakeBytes)
    const fakeSha256 = crypto.createHash("sha256").update(fakeBytes).digest("hex")
    const { prepareAndroidTts } = await import(PREPARE_SCRIPT)

    const options = {
      projectRoot: ROOT,
      androidDir,
      aarSourcePath: fakeAar,
      expectedSha256: fakeSha256,
    }
    await prepareAndroidTts(options)
    await prepareAndroidTts(options)

    const gradle = await fsp.readFile(path.join(appDir, "build.gradle.kts"), "utf8")
    const proguard = await fsp.readFile(path.join(appDir, "proguard-rules.pro"), "utf8")
    assert.equal((gradle.match(/abiFilters \+= listOf\("arm64-v8a"\)/g) || []).length, 1)
    assert.equal((gradle.match(/androidx\.lifecycle:lifecycle-process:2\.10\.0/g) || []).length, 1)
    assert.equal((gradle.match(/implementation\(files\("libs\/sherpa-onnx-1\.13\.3\.aar"\)\)/g) || []).length, 1)
    assert.equal((proguard.match(/-keep class app\.tauri\.A4OfflineTtsBridge \{ \*; \}/g) || []).length, 1)
    assert.equal((proguard.match(/-keep class com\.k2fsa\.sherpa\.onnx\.\*\* \{ \*; \}/g) || []).length, 1)

    assert.deepEqual(
      await fsp.readFile(path.join(appDir, "libs", "sherpa-onnx-1.13.3.aar")),
      fakeBytes
    )
    for (const name of ["A4SpeechBridge.kt", "A4OfflineTtsBridge.kt"]) {
      assert.deepEqual(
        await fsp.readFile(path.join(appDir, "src", "main", "java", "app", "tauri", name)),
        await fsp.readFile(path.join(ROOT, "src-tauri", "android", name))
      )
    }
  })

  it("does nothing for a non-Android Tauri build", async () => {
    const { prepareAndroidTtsForBuild } = await import(PREPARE_SCRIPT)
    const result = await prepareAndroidTtsForBuild({
      env: { TAURI_ENV_PLATFORM: "darwin" },
      projectRoot: ROOT,
      download: async () => {
        throw new Error("must not download")
      },
    })
    assert.equal(result.prepared, false)
  })

  it("rejects non-arm64 Android hooks with an actionable target command", async () => {
    const { prepareAndroidTtsForBuild } = await import(PREPARE_SCRIPT)
    await assert.rejects(
      prepareAndroidTtsForBuild({
        env: { TAURI_ENV_PLATFORM: "androideabi", TAURI_ENV_ARCH: "arm" },
        projectRoot: ROOT,
        download: async () => {
          throw new Error("must not download")
        },
      }),
      /--target aarch64/i
    )
  })
})

describe("Android offline TTS native bridge contract", () => {
  it("saves Sherpa output directly and performs inference on a worker", () => {
    const source = fs.readFileSync(path.join(ROOT, "src-tauri", "android", "A4OfflineTtsBridge.kt"), "utf8")
    assert.match(source, /Executors\.newSingleThreadExecutor/)
    assert.match(source, /fun startSpeak\s*\(/)
    assert.match(source, /fun takeResult\s*\(/)
    assert.match(source, /fun cancelRequest\s*\(/)
    assert.match(source, /fun completeRequest\s*\(/)
    assert.match(source, /fun clearVoice\s*\(/)
    assert.match(source, /JSONObject/)
    assert.match(source, /audio\.save\(wavFile\.absolutePath\)/)
    assert.doesNotMatch(source, /floatArrayToWav/)
  })

  it("uses short JNI calls and asynchronous polling from Rust", () => {
    const source = fs.readFileSync(path.join(ROOT, "src-tauri", "src", "lib.rs"), "utf8")
    assert.match(source, /async fn a4_offline_speak\s*\(/)
    assert.match(source, /"startSpeak"/)
    assert.match(source, /"takeResult"/)
    assert.match(source, /"cancelRequest"/)
    assert.match(source, /"completeRequest"/)
    assert.match(source, /"clearVoice"/)
    assert.match(source, /fn clear_android_offline_voice\s*\(/)
    assert.match(source, /fn android_offline_voice_lock\s*\(/)
    assert.ok((source.match(/\.lock_owned\(\)\.await/g) || []).length >= 3)
    assert.match(source, /Android offline TTS engine cleanup failed/)
    assert.doesNotMatch(source, /let _ = call_android_offline_bridge\([\s\S]{0,160}ClearVoice/)
    assert.doesNotMatch(source, /recv_timeout\(std::time::Duration::from_secs\(15\)\)/)
  })

  it("loads the app bridge class through the Android activity class loader", () => {
    const source = fs.readFileSync(path.join(ROOT, "src-tauri", "src", "lib.rs"), "utf8")
    assert.match(source, /fn load_android_app_class(?:<[^>]+>)?\s*\(/)
    assert.match(source, /"getAppClass"/)
    assert.match(source, /name\.replace\('\/', "\."\)/)
    assert.equal((source.match(/\.call_static_method\(\s*&bridge_class,/g) || []).length, 7)
    assert.doesNotMatch(source, /env\.call_static_method\(\s*"app\/tauri\//)
  })

  it("exports the shared download command only outside Android", () => {
    const sharedSource = fs.readFileSync(
      path.join(ROOT, "src-tauri", "src", "offline_tts.rs"),
      "utf8"
    )
    const androidSource = fs.readFileSync(
      path.join(ROOT, "src-tauri", "src", "lib.rs"),
      "utf8"
    )

    assert.match(
      sharedSource,
      /#\[cfg_attr\(not\(target_os = "android"\), tauri::command\)\]\s*pub async fn a4_offline_voices_download\s*\(/
    )
    assert.match(
      androidSource,
      /#\[cfg\(target_os = "android"\)\]\s*#\[tauri::command\]\s*async fn a4_offline_voices_download\s*\(/
    )
  })

  it("imports the desktop engine mutex only outside Android", () => {
    const source = fs.readFileSync(
      path.join(ROOT, "src-tauri", "src", "offline_tts.rs"),
      "utf8"
    )

    assert.match(
      source,
      /^#\[cfg\(not\(target_os = "android"\)\)\]\nuse parking_lot::Mutex;/
    )
  })
})

describe("Android offline TTS build integration", () => {
  it("runs the shared preparation script from the build hook and release workflow", () => {
    const build = fs.readFileSync(path.join(ROOT, "scripts", "build.mjs"), "utf8")
    const prepare = fs.readFileSync(PREPARE_SCRIPT, "utf8")
    const workflow = fs.readFileSync(path.join(ROOT, ".github", "workflows", "release.yml"), "utf8")
    assert.match(build, /prepareAndroidTtsForBuild/)
    assert.match(prepare, /AbortController/)
    assert.match(prepare, /AAR_MAX_DOWNLOAD_BYTES/)
    assert.match(workflow, /node scripts\/prepare-android-tts\.mjs/)
    assert.doesNotMatch(workflow, /name: Download sherpa-onnx AAR/)
    assert.doesNotMatch(workflow, /name: Inject Android dependencies/)
  })

  it("does not retain the retired tts.k7tmiz.com origin", () => {
    const tauriConfig = fs.readFileSync(path.join(ROOT, "src-tauri", "tauri.conf.json"), "utf8")
    assert.doesNotMatch(tauriConfig, /tts\.k7tmiz\.com/)
  })

  it("documents the arm64-only Android build and keeps release notes current", () => {
    const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8")
    const workflow = fs.readFileSync(path.join(ROOT, ".github", "workflows", "release.yml"), "utf8")
    assert.match(readme, /android build -- --apk --target aarch64/)
    assert.doesNotMatch(workflow, /tts\.k7tmiz\.com/)
    assert.match(workflow, /手机端统一使用分段式分类导航与手风琴折叠分组/)
    assert.match(workflow, /手机端紧凑摘要保留单词、连续天数和当前轮次/)
    assert.match(workflow, /Android 以 Release 页面为主下载入口并保留 APK 直链兜底/)
  })

  it("configures the Android NDK linker in pull-request CI", () => {
    const workflow = fs.readFileSync(path.join(ROOT, ".github", "workflows", "ci.yml"), "utf8")
    assert.match(workflow, /android-actions\/setup-android@v3/)
    assert.match(workflow, /CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER/)
  })

  it("configures the NDK archiver for Android native dependencies", () => {
    for (const name of ["ci.yml", "release.yml"]) {
      const workflow = fs.readFileSync(
        path.join(ROOT, ".github", "workflows", name),
        "utf8"
      )
      assert.match(workflow, /NDK_AR=.*llvm-ar/)
      assert.match(workflow, /AR_aarch64_linux_android=.*NDK_AR/)
    }
  })
})
