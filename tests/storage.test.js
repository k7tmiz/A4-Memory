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

  it("keeps the in-memory apiKey on the caller's state after saving", () => {
    const { A4Storage } = loadStorage()
    const state = { rounds: [], aiConfig: { apiKey: "sk-memory", provider: "openai" } }
    A4Storage.saveState(state)
    assert.equal(state.aiConfig.apiKey, "sk-memory")
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

  it("tells the user when a save fails, at most once per minute", () => {
    const filePath = path.join(__dirname, "..", "js", "storage.js")
    const toasts = []
    const sandbox = {
      window: { A4Utils: { showToast: (opts) => toasts.push(opts) } },
      localStorage: {
        getItem: () => null,
        setItem: () => {
          throw new Error("QuotaExceededError")
        },
      },
    }
    sandbox.window.window = sandbox.window
    vm.createContext(sandbox)
    vm.runInContext(fs.readFileSync(filePath, "utf8"), sandbox)

    assert.equal(sandbox.window.A4Storage.saveState({ rounds: [] }), false)
    assert.equal(sandbox.window.A4Storage.saveState({ rounds: [] }), false)
    assert.equal(toasts.length, 1)
    assert.equal(toasts[0].kind, "error")
    assert.match(toasts[0].message, /保存失败/)
  })
})

// 最小 IndexedDB 替身：单个对象仓库，请求与事务都异步完成
function createFakeIndexedDb({ records = new Map(), failOpen = false } = {}) {
  const writes = []
  const control = { failWrites: false }
  const later = (fn) => setTimeout(fn, 0)
  const db = {
    objectStoreNames: { contains: () => false },
    createObjectStore() {},
    transaction() {
      const tx = {}
      tx.objectStore = () => ({
        get(key) {
          const request = {}
          later(() => {
            request.result = records.get(key)
            request.onsuccess?.()
          })
          return request
        },
        put(value, key) {
          later(() => {
            if (control.failWrites) return tx.onerror?.()
            records.set(key, value)
            writes.push(value)
            tx.oncomplete?.()
          })
          return {}
        },
      })
      return tx
    },
  }
  const factory = {
    open() {
      const request = {}
      later(() => {
        if (failOpen) return request.onerror?.()
        request.result = db
        request.onupgradeneeded?.()
        request.onsuccess?.()
      })
      return request
    },
  }
  return { factory, records, writes, control }
}

function loadStorageWithIndexedDb({ initialState = null, idb = createFakeIndexedDb() } = {}) {
  const code = fs.readFileSync(path.join(__dirname, "..", "js", "storage.js"), "utf8")
  const store = new Map()
  const toasts = []
  if (initialState) store.set("a4-memory:v1", JSON.stringify(initialState))
  const sandbox = {
    window: {
      indexedDB: idb.factory,
      setTimeout,
      clearTimeout,
      A4Utils: { showToast: (opts) => toasts.push(opts) },
    },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
  }
  sandbox.window.window = sandbox.window
  vm.createContext(sandbox)
  vm.runInContext(code, sandbox)
  const mainState = () => JSON.parse(store.get("a4-memory:v1") || "null")
  return { A4Storage: sandbox.window.A4Storage, store, idb, toasts, mainState }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 5))
const plain = (value) => JSON.parse(JSON.stringify(value))
const book = (id, terms = ["alpha"]) => ({ id, name: id, words: terms.map((term) => ({ term, meaning: `${term}-m` })) })

describe("A4Storage wordbook storage", () => {
  it("keeps wordbooks inside the main state when IndexedDB is unavailable", async () => {
    const { A4Storage, store } = loadStorage()
    assert.equal(await A4Storage.ready, false)
    A4Storage.saveState({ rounds: [], customWordbooks: [book("b1")] })
    assert.equal(JSON.parse(store.get(A4Storage.STORAGE_KEY)).customWordbooks.length, 1)
    assert.equal(A4Storage.loadState().customWordbooks[0].id, "b1")
  })

  it("migrates wordbooks out of localStorage on first start and still returns them", async () => {
    const { A4Storage, idb, mainState } = loadStorageWithIndexedDb({
      initialState: { roundCap: 25, rounds: [{ id: "r1" }], customWordbooks: [book("b1"), book("b2")] },
    })
    assert.equal(await A4Storage.ready, true)

    assert.equal("customWordbooks" in mainState(), false, "the main state no longer carries wordbooks")
    assert.equal(mainState().roundCap, 25)
    assert.deepEqual(JSON.parse(idb.records.get("customWordbooks")).map((b) => b.id), ["b1", "b2"])
    const loaded = A4Storage.loadState()
    assert.deepEqual(plain(loaded.customWordbooks.map((b) => b.id)), ["b1", "b2"])
    assert.equal(loaded.rounds[0].id, "r1")
  })

  it("merges wordbooks left in localStorage with the ones already stored", async () => {
    const idb = createFakeIndexedDb({ records: new Map([["customWordbooks", JSON.stringify([book("b1", ["old"]), book("b2")])]]) })
    const { A4Storage } = loadStorageWithIndexedDb({ initialState: { customWordbooks: [book("b1", ["new"]), book("b3")] }, idb })
    await A4Storage.ready

    const books = plain(A4Storage.loadState().customWordbooks)
    assert.deepEqual(books.map((b) => b.id), ["b1", "b2", "b3"])
    assert.equal(books[0].words[0].term, "new")
  })

  it("writes wordbooks only when they change and keeps them out of localStorage", async () => {
    const { A4Storage, idb, mainState } = loadStorageWithIndexedDb()
    await A4Storage.ready

    const state = { rounds: [], customWordbooks: [book("b1")] }
    assert.equal(A4Storage.saveState(state), true)
    assert.equal(A4Storage.loadState().customWordbooks[0].id, "b1", "reads see the write immediately")
    await flush()
    assert.equal(idb.writes.length, 1)
    assert.equal("customWordbooks" in mainState(), false)

    A4Storage.saveState({ ...state, rounds: [{ id: "r1" }] })
    await flush()
    assert.equal(idb.writes.length, 1, "saving progress does not rewrite unchanged wordbooks")

    A4Storage.saveState({ ...state, customWordbooks: [] })
    await flush()
    assert.equal(idb.writes.length, 2)
    assert.equal(A4Storage.loadState().customWordbooks.length, 0)
  })

  it("returns independent copies so one view cannot mutate another view's wordbooks", async () => {
    const { A4Storage } = loadStorageWithIndexedDb({ initialState: { customWordbooks: [book("b1")] } })
    await A4Storage.ready
    const first = A4Storage.loadState()
    first.customWordbooks.push(book("b2"))
    assert.equal(A4Storage.loadState().customWordbooks.length, 1)
  })

  it("does not lose stored wordbooks when the main state is missing", async () => {
    const idb = createFakeIndexedDb({ records: new Map([["customWordbooks", JSON.stringify([book("b1")])]]) })
    const { A4Storage } = loadStorageWithIndexedDb({ idb })
    await A4Storage.ready
    assert.deepEqual(plain(A4Storage.loadState()), { customWordbooks: [book("b1")] })
  })

  it("falls back to localStorage when the wordbook store cannot be opened", async () => {
    const { A4Storage, mainState } = loadStorageWithIndexedDb({
      initialState: { customWordbooks: [book("b1")] },
      idb: createFakeIndexedDb({ failOpen: true }),
    })
    assert.equal(await A4Storage.ready, false)
    assert.equal(mainState().customWordbooks.length, 1, "nothing is removed when the migration cannot run")
    assert.equal(A4Storage.loadState().customWordbooks[0].id, "b1")
  })

  it("reports a failed wordbook write and retries it on the next save", async () => {
    const idb = createFakeIndexedDb()
    const { A4Storage, toasts } = loadStorageWithIndexedDb({ idb })
    await A4Storage.ready
    const state = { rounds: [], customWordbooks: [book("b1")] }

    idb.control.failWrites = true
    A4Storage.saveState(state)
    await flush()
    assert.equal(toasts.length, 1)
    assert.equal(idb.writes.length, 0)

    idb.control.failWrites = false
    A4Storage.saveState(state)
    await flush()
    assert.equal(idb.writes.length, 1, "the unchanged wordbooks are written again after a failure")
  })
})
