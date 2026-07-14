const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const { describe, it } = require("node:test")
const assert = require("node:assert/strict")

const commonCode = fs.readFileSync(path.join(__dirname, "..", "js", "core", "common.js"), "utf8")
const sanitizeCode = fs.readFileSync(path.join(__dirname, "..", "js", "core", "sanitize.js"), "utf8")
const recordsCode = fs.readFileSync(path.join(__dirname, "..", "js", "records.js"), "utf8")

function loadRecordsInternals() {
  const sandbox = {
    console,
    Date,
    window: {
      A4Settings: { normalizeRoundCap(value) { return Math.max(20, Math.min(30, Math.round(Number(value) || 30))) } },
      A4Storage: {},
      A4Utils: {},
    },
  }
  sandbox.window.window = sandbox.window
  vm.createContext(sandbox)
  vm.runInContext(commonCode, sandbox)
  vm.runInContext(sanitizeCode, sandbox)
  const instrumented = recordsCode.replace(
    /\n  main\(\)\n\}\)\(\)\s*$/,
    "\n  window.__recordsInternals = { normalizeState, buildCsv }\n})()"
  )
  assert.notEqual(instrumented, recordsCode, "records test instrumentation must replace main()")
  vm.runInContext(instrumented, sandbox)
  return sandbox.window.__recordsInternals
}

describe("records state normalization", () => {
  it("migrates a legacy disabled-online state to system TTS", () => {
    const { normalizeState } = loadRecordsInternals()
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

describe("records CSV export", () => {
  it("neutralizes spreadsheet formulas from imported wordbook fields", () => {
    const { buildCsv } = loadRecordsInternals()
    const csv = buildCsv([
      {
        id: "round-1",
        type: "normal",
        startedAt: "2026-07-14T00:00:00.000Z",
        finishedAt: "",
        items: [
          {
            word: { term: "=2+2", pos: "+CMD", meaning: "@SUM(A1:A2)" },
            status: "unknown",
          },
        ],
      },
    ])

    assert.match(csv, /'=2\+2/)
    assert.match(csv, /'\+CMD/)
    assert.match(csv, /'@SUM\(A1:A2\)/)
  })
})
