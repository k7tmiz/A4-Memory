const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const { describe, it } = require("node:test")
const assert = require("node:assert/strict")

function loadCommon() {
  const filePath = path.join(__dirname, "..", "js", "core", "common.js")
  const code = fs.readFileSync(filePath, "utf8")
  const sandbox = {
    console,
    window: {
      scrollY: 0,
      scrollTo() {},
      WORDS: [],
      WORDBOOKS: [],
    },
    document: {
      body: {
        classList: { add() {}, remove() {} },
        style: {},
      },
    },
  }
  sandbox.window.window = sandbox.window
  vm.createContext(sandbox)
  vm.runInContext(code, sandbox)
  return sandbox.window.A4Common
}

const A4Common = loadCommon()

describe("A4Common core utilities", () => {
  it("clamp returns a value within bounds", () => {
    assert.equal(A4Common.clamp(5, 0, 10), 5)
    assert.equal(A4Common.clamp(-3, 0, 10), 0)
    assert.equal(A4Common.clamp(15, 0, 10), 10)
  })

  it("makeUuid returns a v4-like UUID string", () => {
    const uuid = A4Common.makeUuid()
    assert.match(uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    const second = A4Common.makeUuid()
    assert.notEqual(uuid, second)
  })

  it("normalizeStatus accepts known values and defaults to unknown", () => {
    assert.equal(A4Common.normalizeStatus("mastered"), "mastered")
    assert.equal(A4Common.normalizeStatus("LEARNING"), "learning")
    assert.equal(A4Common.normalizeStatus(""), "unknown")
    assert.equal(A4Common.normalizeStatus("invalid"), "unknown")
  })

  it("normalizeRoundType accepts known values and defaults to normal", () => {
    assert.equal(A4Common.normalizeRoundType("review_mastered"), "review_mastered")
    assert.equal(A4Common.normalizeRoundType("review_learning"), "review_learning")
    assert.equal(A4Common.normalizeRoundType(""), "normal")
  })

  it("getStatusLabel returns Chinese labels", () => {
    assert.equal(A4Common.getStatusLabel("mastered"), "已掌握")
    assert.equal(A4Common.getStatusLabel("learning"), "学习中")
    assert.equal(A4Common.getStatusLabel("unknown"), "不会")
  })

  it("computeStudyStats counts completed rounds and today words", () => {
    const today = new Date().toISOString()
    const yesterday = new Date(Date.now() - 86400000).toISOString()
    const rounds = [
      { startedAt: today, finishedAt: today, items: [{ term: "a", createdAt: today }, { term: "b", createdAt: today }] },
      { startedAt: yesterday, finishedAt: yesterday, items: [{ term: "c", createdAt: yesterday }] },
      { startedAt: today, finishedAt: "", items: [{ term: "d", createdAt: today }] },
    ]
    const stats = A4Common.computeStudyStats(rounds)
    assert.equal(stats.totalWords, 4)
    assert.equal(stats.todayWords, 3)
    assert.equal(stats.completedRounds, 2)
    assert.equal(stats.todayCompletedRounds, 1)
    assert.equal(stats.streak, 2)
  })

  it("getRoundPageCount splits round items into pages", () => {
    const round = {
      roundCap: 2,
      items: [
        { term: "a", pageIndex: 0 },
        { term: "b", pageIndex: 0 },
        { term: "c", pageIndex: 1 },
      ],
    }
    assert.equal(A4Common.getRoundPageCount(round), 2)
    assert.deepEqual(
      A4Common.getRoundItemsByPage(round, 1).map((i) => i.term),
      ["c"]
    )
  })

  it("normalizeWordObject normalizes term and meaning", () => {
    const word = A4Common.normalizeWordObject({ term: "  Hello  ", pos: "n.", meaning: " 你好 " })
    assert.equal(word.term, "Hello")
    assert.equal(word.pos, "n.")
    assert.equal(word.meaning, "你好")
    assert.equal(word.tags.length, 0)
    assert.equal(word.lang, "")
  })

  it("normalizeWordObject supports string input", () => {
    const word = A4Common.normalizeWordObject("world")
    assert.equal(word.term, "world")
    assert.equal(word.meaning, "")
  })

  it("getWordKey is stable for equivalent words", () => {
    const a = A4Common.getWordKey({ term: "Test", pos: "n.", meaning: "测试" })
    const b = A4Common.getWordKey({ term: "test", pos: "N.", meaning: "测试" })
    assert.equal(a, b)
  })

  it("normalizeRoundCap clamps to valid range", () => {
    assert.equal(A4Common.normalizeRoundCap(10), 20)
    assert.equal(A4Common.normalizeRoundCap(25), 25)
    assert.equal(A4Common.normalizeRoundCap(40), 30)
  })

  it("normalizeThemeMode accepts valid modes", () => {
    assert.equal(A4Common.normalizeThemeMode("dark"), "dark")
    assert.equal(A4Common.normalizeThemeMode("light"), "light")
    assert.equal(A4Common.normalizeThemeMode("auto"), "auto")
    assert.equal(A4Common.normalizeThemeMode("invalid"), "auto")
  })

  it("toLocalDateKey formats date as local YYYY-MM-DD", () => {
    const key = A4Common.toLocalDateKey(new Date(2026, 5, 17))
    assert.equal(key, "2026-06-17")
  })
})
