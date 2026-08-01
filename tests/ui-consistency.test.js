const fs = require("node:fs")
const path = require("node:path")
const { describe, it } = require("node:test")
const assert = require("node:assert/strict")

const ROOT = path.join(__dirname, "..")
const read = (filename) => fs.readFileSync(path.join(ROOT, filename), "utf8")

const appCode = read("js/app.js")
const lookupCode = read("js/lookup.js")
const settingsCode = read("js/settings.js")
const speechCode = read("js/speech.js")
const recordsCode = read("js/records.js")
const updaterCode = read("js/updater.js")
const utilsCode = read("js/utils.js")
const indexMarkup = read("index.html")
const rustCode = read("src-tauri/src/lib.rs")
const androidBridgeSource = read("src-tauri/android/A4SpeechBridge.kt")
const generatedAndroidBridge = read("src-tauri/gen/android/app/src/main/java/app/tauri/A4SpeechBridge.kt")

describe("application-owned UI consistency", () => {
  it("does not fall back to browser or WebView-native alert dialogs", () => {
    for (const source of [appCode, settingsCode, speechCode, recordsCode, updaterCode]) {
      assert.doesNotMatch(source, /window\.(?:alert|confirm|prompt)\s*\(/)
    }
    assert.match(utilsCode, /function showNoticeDialog\(/)
    assert.match(utilsCode, /function showToast\(/)
    assert.doesNotMatch(indexMarkup, /id="appToast"/)
    assert.doesNotMatch(appCode, /appToast(?:Timer)?/)
  })

  it("routes every application-owned Android select through an in-app picker", () => {
    assert.match(appCode, /installAndroidSelectPicker\?\.\(document,\s*"#remoteImportSelect"\)/)
    assert.match(appCode, /function renderRemoteImportOptions[^]*refreshAndroidSelectPickers\?\.\(dom\.remoteImportModal\)/)
    assert.match(lookupCode, /installAndroidSelectPicker\?\.\(modal,\s*"#lookupLangSelect"\)/)
    assert.match(lookupCode, /refreshAndroidSelectPickers\?\.\(dom\.modal\)/)
  })

  it("replaces the native model datalist with an application choice panel while preserving free input", () => {
    assert.doesNotMatch(settingsCode, /<datalist\b|\blist="aiModelDatalist"/)
    assert.match(settingsCode, /id="aiModelInput"[^>]*type="text"/)
    assert.match(settingsCode, /id="aiModelPickerBtn"[^>]*aria-haspopup="dialog"/)
    assert.match(settingsCode, /showChoiceDialog\(/)
  })

  it("shows Android export feedback in the shared web UI instead of a Kotlin Toast", () => {
    for (const source of [androidBridgeSource, generatedAndroidBridge]) {
      assert.doesNotMatch(source, /android\.widget\.Toast|Toast\.makeText/)
    }
    assert.match(utilsCode, /a4_android_save_text_file[^]*\.then\([^]*showToast\(/)
  })

  it("retains native surfaces that provide system permissions or device services", () => {
    assert.match(indexMarkup, /<input id="importFile" type="file"/)
    assert.match(settingsCode, /<input id="importBackupFile" type="file"/)
    assert.match(rustCode, /createPrintDocumentAdapter/)
    assert.match(rustCode, /call_method\(\s*print_manager,\s*"print"/s)
    assert.match(updaterCode, /a4_open_external/)
  })
})
