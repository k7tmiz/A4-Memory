const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const { describe, it } = require("node:test")
const assert = require("node:assert/strict")

function loadStorage() {
  const filePath = path.join(__dirname, "..", "js", "storage.js")
  const code = fs.readFileSync(filePath, "utf8")
  const store = new Map()
  const sandbox = {
    window: {},
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
  }
  sandbox.window.window = sandbox.window
  vm.createContext(sandbox)
  vm.runInContext(code, sandbox)
  return { A4Storage: sandbox.window.A4Storage, store }
}

describe("A4Storage", () => {
  it("strips apiKey from aiConfig on save", () => {
    const { A4Storage, store } = loadStorage()
    const ok = A4Storage.saveState({
      rounds: [],
      aiConfig: { apiKey: "sk-secret", provider: "openai" },
    })
    assert.equal(ok, true)
    const raw = store.get(A4Storage.STORAGE_KEY)
    const parsed = JSON.parse(raw)
    assert.equal(parsed.aiConfig.apiKey, "")
    assert.equal(parsed.aiConfig.provider, "openai")
  })

  it("strips apiKey on load even if older versions persisted it", () => {
    const { A4Storage, store } = loadStorage()
    store.set(
      A4Storage.STORAGE_KEY,
      JSON.stringify({ rounds: [], aiConfig: { apiKey: "leaked", provider: "x" } })
    )
    const loaded = A4Storage.loadState()
    assert.equal(loaded.aiConfig.apiKey, "")
    assert.equal(loaded.aiConfig.provider, "x")
  })

  it("returns null for missing key", () => {
    const { A4Storage } = loadStorage()
    assert.equal(A4Storage.loadState(), null)
  })

  it("returns null for invalid JSON", () => {
    const { A4Storage, store } = loadStorage()
    store.set(A4Storage.STORAGE_KEY, "not json{{{")
    assert.equal(A4Storage.loadState(), null)
  })

  it("preserves non-aiConfig fields", () => {
    const { A4Storage, store } = loadStorage()
    A4Storage.saveState({ rounds: [{ id: "r1" }], roundCap: 25 })
    const parsed = JSON.parse(store.get(A4Storage.STORAGE_KEY))
    assert.equal(parsed.roundCap, 25)
    assert.deepEqual(parsed.rounds, [{ id: "r1" }])
  })
})
