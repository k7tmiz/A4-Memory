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
    "\n  window.__recordsInternals = { normalizeState, buildCsv, computeRecordsSummary }\n})()"
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

  it("normalizes visual palette state for records and imported legacy data", () => {
    const { normalizeState } = loadRecordsInternals()
    assert.equal(normalizeState({ version: 2, rounds: [], themePalette: "ocean" }).themePalette, "ocean")
    assert.equal(normalizeState({ version: 2, rounds: [], themePalette: "plum" }).themePalette, "classic")
    assert.equal(normalizeState(null).themePalette, "classic")
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

describe("records summary cards", () => {
  it("computes the three frequent mobile metrics and the compact goal line", () => {
    const { computeRecordsSummary } = loadRecordsInternals()
    const nowMs = Date.parse("2026-07-19T12:00:00.000Z")
    const rounds = [
      {
        startedAt: "2026-07-19T08:00:00.000Z",
        finishedAt: "2026-07-19T09:00:00.000Z",
        items: [
          { word: { term: "memory" }, createdAt: "2026-07-19T08:10:00.000Z", nextReviewAt: "2026-07-19T10:00:00.000Z" },
          { word: { term: "future" }, createdAt: "2026-07-19T08:20:00.000Z", nextReviewAt: "2026-07-20T10:00:00.000Z" },
        ],
      },
    ]

    const summary = computeRecordsSummary({
      rounds,
      state: { dailyGoalWords: 5, dailyGoalRounds: 0, reviewSystemEnabled: true },
      nowMs,
    })

    assert.equal(summary.todayWords, 2)
    assert.equal(summary.dueWords, 1)
    assert.equal(summary.streak, 1)
    assert.equal(summary.goalText, "每日目标：2/5 个词 · 未达成")
    assert.equal(summary.totalText, "累计 2 个词 · 完成 1 轮")
  })
})
