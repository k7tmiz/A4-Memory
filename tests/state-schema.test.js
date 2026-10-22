const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const { describe, it } = require("node:test")
const assert = require("node:assert/strict")

const ROOT = path.join(__dirname, "..")
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8")

function loadStateModules() {
  const sandbox = {
    console,
    window: { WORDBOOKS: [{ id: "cet4", name: "CET4", language: "en", words: [] }], WORDS: [] },
  }
  sandbox.window.window = sandbox.window
  vm.createContext(sandbox)
  for (const file of ["js/core/common.js", "js/core/state-schema.js", "js/settings/state-normalize.js"]) {
    vm.runInContext(read(file), sandbox)
  }
  return {
    A4State: sandbox.window.A4State,
    normalizeImportedState: sandbox.window.A4SettingsInternal.stateNormalize.normalizeImportedState,
  }
}

// 沙箱对象与测试上下文的原型不同，比较前转为普通数据
const plain = (value) => JSON.parse(JSON.stringify(value))

const MESSY_STATE = {
  version: 2,
  rounds: [],
  showMeaning: true,
  darkMode: true,
  themePalette: "plum",
  roundCap: 99,
  dailyGoalRounds: "7.6",
  dailyGoalWords: 12.4,
  reviewIntervals: { unknownDays: 0, learningDays: 999, masteredDays: "5" },
  pronunciationEnabled: "yes",
  onlineTtsEnabled: false,
  onlineTtsProvider: "GOOGLE",
  aiConfig: { provider: "OpenAI", baseUrl: " https://example.test ", apiKey: "sk-secret", model: " m1 " },
  lookupOnlineSource: "CUSTOM",
  lookupLangMode: "fr",
  lookupCacheDays: 9999,
}

describe("A4State preference schema", () => {
  it("returns every preference with its default for empty input", () => {
    const { A4State } = loadStateModules()
    const preferences = plain(A4State.normalizePreferences(null))
    assert.deepEqual(Object.keys(preferences).sort(), [...A4State.PREFERENCE_KEYS].sort())
    assert.deepEqual(preferences, plain(A4State.PREFERENCE_DEFAULTS))
  })

  it("clamps, rounds and migrates messy or legacy values", () => {
    const { A4State } = loadStateModules()
    const preferences = A4State.normalizePreferences(MESSY_STATE)
    assert.equal(preferences.meaningVisible, true)
    assert.equal(preferences.showMeaning, true)
    assert.equal(preferences.themeMode, "dark")
    assert.equal(preferences.themePalette, "classic")
    assert.equal(preferences.roundCap, 30)
    assert.equal(preferences.dailyGoalRounds, 8)
    assert.equal(preferences.dailyGoalWords, 12)
    assert.deepEqual(plain(preferences.reviewIntervals), { unknownDays: 1, learningDays: 60, masteredDays: 5 })
    assert.equal(preferences.pronunciationEnabled, true)
    assert.equal(preferences.ttsMode, "system")
    assert.equal(preferences.onlineTtsEnabled, false)
    assert.equal(preferences.onlineTtsProvider, "google")
    assert.equal(preferences.lookupOnlineSource, "custom")
    assert.equal(preferences.lookupLangMode, "auto")
    assert.equal(preferences.lookupCacheDays, 365)
  })

  it("never carries the AI API key", () => {
    const { A4State } = loadStateModules()
    const preferences = A4State.normalizePreferences(MESSY_STATE)
    assert.deepEqual(plain(preferences.aiConfig), {
      provider: "openai",
      baseUrl: "https://example.test",
      apiKey: "",
      model: "m1",
    })
    assert.equal(MESSY_STATE.aiConfig.apiKey, "sk-secret", "input must not be mutated")
  })

  it("is idempotent", () => {
    const { A4State } = loadStateModules()
    const once = A4State.normalizePreferences(MESSY_STATE)
    assert.deepEqual(plain(A4State.normalizePreferences(once)), plain(once))
  })

  it("persists preferences and data fields but drops runtime-only fields", () => {
    const { A4State } = loadStateModules()
    const runtime = {
      ...MESSY_STATE,
      rounds: [{ id: "r1", items: [] }],
      currentRoundId: "r1",
      selectedWordbookId: "cet4",
      customWordbooks: [],
      unknownTerms: ["en||apple"],
      pendingReviewRoundId: "",
      pendingGenerateStatusKind: "due",
      pool: [1, 2, 3],
      placed: [{ el: {} }],
    }
    const persisted = A4State.buildPersistedState(runtime, { darkMode: true, currentCount: 0 })
    for (const key of [...A4State.PREFERENCE_KEYS, ...A4State.DATA_KEYS]) {
      assert.ok(key in persisted, `${key} must be persisted`)
    }
    assert.equal(persisted.version, A4State.STATE_VERSION)
    assert.equal(persisted.darkMode, true)
    assert.equal(persisted.currentCount, 0)
    assert.equal("pool" in persisted, false)
    assert.equal("placed" in persisted, false)
    assert.equal(persisted.aiConfig.apiKey, "")
  })

  it("survives a persist → reload round trip unchanged", () => {
    const { A4State } = loadStateModules()
    const persisted = plain(A4State.buildPersistedState(MESSY_STATE))
    const reloaded = plain(A4State.buildPersistedState(persisted))
    assert.deepEqual(reloaded, persisted)
  })
})

describe("A4State consumers", () => {
  it("backup import uses the same preference rules as the schema", () => {
    const { A4State, normalizeImportedState } = loadStateModules()
    const imported = normalizeImportedState(MESSY_STATE)
    const expected = plain(A4State.normalizePreferences(MESSY_STATE))
    for (const key of A4State.PREFERENCE_KEYS) {
      assert.deepEqual(plain(imported[key]), expected[key], key)
    }
  })

  it("study, records and settings views read preferences through A4State", () => {
    assert.match(read("js/app.js"), /Object\.assign\(appState, omitMeaningVisible\(normalizePreferences\(saved\)\)\)/)
    assert.match(read("js/app.js"), /saveState\(buildPersistedState\(/)
    assert.match(read("js/records.js"), /const preferences = normalizePreferences\(raw\)/)
    assert.match(read("js/settings-page.js"), /window\.A4State\?\.normalizePreferences\?\.\(base\)/)
    assert.match(read("js/settings/state-normalize.js"), /Object\.assign\(next, normalizePreferences\(next\)\)/)
  })

  it("loads the schema right after common.js", () => {
    const markup = read("index.html")
    const common = markup.indexOf('src="./js/core/common.js?v=')
    const schema = markup.indexOf('src="./js/core/state-schema.js?v=')
    assert.ok(common > 0 && schema > common)
    assert.equal(markup.slice(common, schema).split("<script").length, 2, "state-schema.js must directly follow common.js")
  })
})
