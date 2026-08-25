const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const { describe, it } = require("node:test")
const assert = require("node:assert/strict")

const commonCode = fs.readFileSync(path.join(__dirname, "..", "js", "core", "common.js"), "utf8")
const sanitizeCode = fs.readFileSync(path.join(__dirname, "..", "js", "core", "sanitize.js"), "utf8")
const recordsCode = fs.readFileSync(path.join(__dirname, "..", "js", "records.js"), "utf8")

function loadRecordsInternals({ document: documentRef } = {}) {
  const document = documentRef || {
    body: { classList: { remove() {} } },
    getElementById() { return null },
  }
  const sandbox = {
    console,
    Date,
    document,
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
    "\n  window.__recordsInternals = { normalizeState, buildCsv, buildRoundCardModel, computeRecordsSummary, closePrintPreview: typeof closePrintPreview === \"function\" ? closePrintPreview : undefined }\n})()"
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
    const localTime = (day, hour, minute = 0) => new Date(2026, 6, day, hour, minute).toISOString()
    const nowMs = new Date(2026, 6, 19, 12).getTime()
    const rounds = [
      {
        startedAt: localTime(19, 8),
        finishedAt: localTime(19, 9),
        items: [
          { word: { term: "memory" }, createdAt: localTime(19, 8, 10), nextReviewAt: localTime(19, 10) },
          { word: { term: "future" }, createdAt: localTime(19, 8, 20), nextReviewAt: localTime(20, 10) },
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
    assert.equal(summary.goalCurrent, 2)
    assert.equal(summary.goalTarget, 5)
    assert.equal(summary.goalPercent, 40)
    assert.equal(summary.goalText, "每日目标：2/5 个词 · 未达成")
    assert.equal(summary.totalText, "累计 2 个词 · 完成 1 轮")
  })
})

describe("records round presentation model", () => {
  it("summarizes one round without building its heavy detail DOM", () => {
    const { buildRoundCardModel } = loadRecordsInternals()
    const statuses = [
      ...Array.from({ length: 5 }, () => "mastered"),
      ...Array.from({ length: 4 }, () => "learning"),
      ...Array.from({ length: 4 }, () => "unknown"),
    ]
    const items = statuses.map((status, index) => ({
      word: { term: `word-${index}` },
      status,
      pageIndex: 0,
    }))
    const latestStatusMap = new Map(
      statuses.map((status, index) => [`word-${index}`, { status }])
    )

    const model = buildRoundCardModel(
      { type: "normal", finishedAt: "", items },
      {
        roundNo: 4,
        cap: 30,
        latestStatusMap,
        dueKeySet: new Set(["word-0", "word-7"]),
      }
    )

    assert.deepEqual(JSON.parse(JSON.stringify(model)), {
      roundNo: 4,
      wordCount: 13,
      cap: 30,
      pageCount: 1,
      due: 2,
      mastered: 5,
      learning: 4,
      unknown: 4,
      completed: false,
      typeLabel: "普通",
    })
  })
})

describe("records print preview lifecycle", () => {
  it("fully removes preview and print output when Records loses route ownership", () => {
    const removed = []
    const nodes = new Map([
      ["pdfPrintOverlay", { remove() { removed.push("overlay"); nodes.delete("pdfPrintOverlay") } }],
      ["pdfPrintPages", { remove() { removed.push("pages"); nodes.delete("pdfPrintPages") } }],
    ])
    const removedClasses = []
    const { closePrintPreview } = loadRecordsInternals({
      document: {
        body: { classList: { remove(name) { removedClasses.push(name) } } },
        getElementById(id) { return nodes.get(id) || null },
      },
    })

    closePrintPreview()

    assert.deepEqual(removed, ["overlay", "pages"])
    assert.deepEqual(removedClasses, ["a4-printing"])
  })
})

describe("records view switch glass", () => {
  it("uses the shared dock glass slider on the rounds/status switch", () => {
    const recordsStyle = fs.readFileSync(path.join(__dirname, "..", "css", "records.css"), "utf8")
    assert.match(recordsCode, /A4DockGlass\?\.attachSlider/)
    assert.match(recordsStyle, /\.records-view-switch\s*\{[^}]*border-radius:\s*999px[^}]*backdrop-filter:\s*blur\(28px\)/s)
    assert.match(recordsStyle, /\.records-view-indicator\s*\{[^}]*var\(--a4-dock-drag, 0px\)[^}]*var\(--a4-dock-lift/s)
    assert.match(recordsStyle, /\.records-view-switch\.is-lifting \.records-view-indicator/s)
  })
})
