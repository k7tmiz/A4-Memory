const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const { describe, it } = require("node:test")
const assert = require("node:assert/strict")

const commonCode = fs.readFileSync(path.join(__dirname, "..", "js", "core", "common.js"), "utf8")
const recordsCode = fs.readFileSync(path.join(__dirname, "..", "js", "records.js"), "utf8")

function loadNormalizeRecordsState() {
  const sandbox = {
    console,
    Date,
    window: {
      A4Sanitize: { escapeHtml(value) { return String(value || "") } },
      A4Settings: { normalizeRoundCap(value) { return Math.max(20, Math.min(30, Math.round(Number(value) || 30))) } },
      A4Storage: {},
      A4Utils: {},
    },
  }
  sandbox.window.window = sandbox.window
  vm.createContext(sandbox)
  vm.runInContext(commonCode, sandbox)
  const instrumented = recordsCode.replace(
    /\n  main\(\)\n\}\)\(\)\s*$/,
    "\n  window.__normalizeRecordsState = normalizeState\n})()"
  )
  assert.notEqual(instrumented, recordsCode, "records test instrumentation must replace main()")
  vm.runInContext(instrumented, sandbox)
  return sandbox.window.__normalizeRecordsState
}

describe("records state normalization", () => {
  it("migrates a legacy disabled-online state to system TTS", () => {
    const normalizeState = loadNormalizeRecordsState()
    const state = normalizeState({
      version: 2,
      rounds: [],
      onlineTtsEnabled: false,
    })

    assert.equal(state.ttsMode, "system")
    assert.equal(state.onlineTtsEnabled, false)
    assert.deepEqual(JSON.parse(JSON.stringify(state.offlineVoiceByLang)), {})
  })
})
