const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const { describe, it } = require("node:test")
const assert = require("node:assert/strict")

const lookupCode = fs.readFileSync(path.join(__dirname, "..", "js", "lookup.js"), "utf8")

function createElement(id = "") {
  const listeners = new Map()
  const classes = new Set(["hidden"])
  let innerHtml = ""
  const element = {
    id,
    value: "",
    className: "",
    textContent: "",
    dataset: {},
    children: [],
    classList: {
      add(...names) { names.forEach((name) => classes.add(name)) },
      remove(...names) { names.forEach((name) => classes.delete(name)) },
      contains(name) { return classes.has(name) },
    },
    setAttribute() {},
    addEventListener(type, listener) {
      const entries = listeners.get(type) || []
      entries.push(listener)
      listeners.set(type, entries)
    },
    dispatch(type, event = {}) {
      for (const listener of listeners.get(type) || []) listener(event)
    },
    listenerCount(type) { return (listeners.get(type) || []).length },
    appendChild(child) { this.children.push(child); return child },
    focus() {},
    setSelectionRange() {},
    querySelector(selector) {
      const datasetKey = selector === '[data-lookup-online="1"]'
        ? "lookupOnline"
        : selector === '[data-lookup-conj="1"]'
          ? "lookupConj"
          : ""
      const visit = (node) => {
        for (const child of node.children || []) {
          if (datasetKey && child.dataset?.[datasetKey] === "1") return child
          const nested = visit(child)
          if (nested) return nested
        }
        return null
      }
      return visit(this)
    },
  }
  Object.defineProperty(element, "innerHTML", {
    get() { return innerHtml },
    set(value) { innerHtml = String(value); element.children = [] },
  })
  Object.defineProperty(element, "childNodes", { get() { return element.children } })
  return element
}

function loadLookup({ AbortController: AbortControllerRef, fetch: fetchRef, closeLayer: closeLayerSpy } = {}) {
  const controls = new Map([
    ["#lookupBackdrop", createElement("lookupBackdrop")],
    ["#closeLookupBtn", createElement("closeLookupBtn")],
    ["#lookupInput", createElement("lookupInput")],
    ["#lookupLangSelect", createElement("lookupLangSelect")],
    ["#lookupSearchBtn", createElement("lookupSearchBtn")],
    ["#lookupHint", createElement("lookupHint")],
    ["#lookupToast", createElement("lookupToast")],
    ["#lookupResults", createElement("lookupResults")],
  ])
  const modal = createElement("lookupModal")
  modal.querySelector = (selector) => controls.get(selector) || null
  const document = {
    body: { appendChild() {} },
    getElementById(id) { return id === "lookupModal" ? modal : null },
    createElement() { return createElement() },
  }
  const window = {
    document,
    A4Common: {
      normalizeLookupText(value) {
        const raw = String(value || "").trim()
        return { raw, lower: raw.toLowerCase(), folded: raw.toLowerCase() }
      },
      scoreLookupMatch(word, query) {
        const term = String(word?.term || "").toLowerCase()
        return term.includes(query.lower) ? { score: 1 } : { score: -Infinity }
      },
      dedupeAndSortLookupResults(list) { return list },
      buildLatestTermMap() { return new Map() },
      buildFirstSeenRoundMap() { return new Map() },
      formatMeaning(word) { return String(word?.meaning || "") },
      getWordKey(word) { return String(word?.term || "").toLowerCase() },
      getWordbooksFromGlobal() { return [] },
      normalizeLangTag(value) { return { base: String(value || "").split(/[-_]/)[0].toLowerCase() } },
      clamp(value, min, max) { return Math.max(min, Math.min(max, value)) },
      setModalVisible(layer, visible) {
        layer.classList[visible ? "remove" : "add"]("hidden")
      },
    },
    requestAnimationFrame(callback) { callback() },
  }
  if (typeof closeLayerSpy === "function") {
    window.A4UI = { closeLayer: closeLayerSpy }
  }
  window.window = window
  const sandbox = {
    console,
    document,
    window,
    localStorage: { getItem() { return null }, setItem() {} },
    requestAnimationFrame: window.requestAnimationFrame,
    setTimeout,
    clearTimeout,
  }
  if (AbortControllerRef) sandbox.AbortController = AbortControllerRef
  if (fetchRef) sandbox.fetch = fetchRef
  vm.createContext(sandbox)
  vm.runInContext(lookupCode, sandbox)
  return { A4Lookup: window.A4Lookup, controls, modal }
}

describe("A4Lookup shared shell controller", () => {
  it("binds shared DOM once and switches every user action to the route that opened it", () => {
    const { A4Lookup, controls } = loadLookup()
    const studyPatches = []
    const recordsPatches = []
    const addedByStudy = []
    const state = {
      lookupLangMode: "auto",
      lookupOnlineEnabled: false,
      lookupSpanishConjugationEnabled: false,
      rounds: [],
      customWordbooks: [{ id: "custom", name: "Custom", words: [{ term: "memory", meaning: "记忆" }] }],
    }
    const study = A4Lookup.createLookupModalController({
      getState: () => state,
      setState: (patch) => studyPatches.push(patch),
      getWordbookLanguage: () => "es-MX",
      addWordToCurrentRound: (word) => addedByStudy.push(word),
    })
    const records = A4Lookup.createLookupModalController({
      getState: () => state,
      setState: (patch) => recordsPatches.push(patch),
    })
    const lang = controls.get("#lookupLangSelect")

    assert.equal(controls.get("#lookupSearchBtn").listenerCount("click"), 1)
    assert.equal(lang.listenerCount("change"), 1)

    study.open()
    lang.value = "es"
    lang.dispatch("change")
    assert.deepEqual(JSON.parse(JSON.stringify(studyPatches)), [{ lookupLangMode: "es" }])
    assert.deepEqual(recordsPatches, [])

    records.open()
    lang.value = "en"
    lang.dispatch("change")
    assert.deepEqual(JSON.parse(JSON.stringify(studyPatches)), [{ lookupLangMode: "es" }])
    assert.deepEqual(JSON.parse(JSON.stringify(recordsPatches)), [{ lookupLangMode: "en" }])

    const findAddButton = (node) => {
      if (String(node.className || "").includes("lookup-add-btn")) return node
      for (const child of node.children || []) {
        const match = findAddButton(child)
        if (match) return match
      }
      return null
    }
    study.runLookup("memory")
    findAddButton(controls.get("#lookupResults")).dispatch("click", {
      preventDefault() {},
      stopPropagation() {},
    })
    assert.deepEqual(JSON.parse(JSON.stringify(addedByStudy)), [{ term: "memory", pos: "", meaning: "记忆", lang: "es" }])

    records.runLookup("memory")
    findAddButton(controls.get("#lookupResults")).dispatch("click", {
      preventDefault() {},
      stopPropagation() {},
    })
    assert.equal(addedByStudy.length, 1)
  })

  it("cancels an in-flight request before switching the shared dialog to another route", () => {
    let abortCount = 0
    class FakeAbortController {
      constructor() { this.signal = { aborted: false } }
      abort() { this.signal.aborted = true; abortCount += 1 }
    }
    const { A4Lookup } = loadLookup({
      AbortController: FakeAbortController,
      fetch: () => new Promise(() => {}),
    })
    const state = {
      lookupOnlineEnabled: true,
      lookupCacheEnabled: false,
      lookupSpanishConjugationEnabled: false,
      rounds: [],
      customWordbooks: [],
    }
    const study = A4Lookup.createLookupModalController({ getState: () => state })
    const records = A4Lookup.createLookupModalController({ getState: () => state })

    study.runLookup("memory")
    records.open()

    assert.equal(abortCount, 1)
  })

  it("runs the active controller abort hook when the layer owner is batch-dismissed", () => {
    let abortCount = 0
    const closeCalls = []
    class FakeAbortController {
      constructor() { this.signal = { aborted: false } }
      abort() { this.signal.aborted = true; abortCount += 1 }
    }
    const { A4Lookup, modal } = loadLookup({
      AbortController: FakeAbortController,
      fetch: () => new Promise(() => {}),
      closeLayer: (layer, options) => closeCalls.push({ layer, options }),
    })
    const state = {
      lookupOnlineEnabled: true,
      lookupCacheEnabled: false,
      lookupSpanishConjugationEnabled: false,
      rounds: [],
      customWordbooks: [],
    }
    const study = A4Lookup.createLookupModalController({ getState: () => state })
    study.runLookup("memory")

    let prevented = false
    modal.dispatch("a4-layer-dismiss", {
      detail: { immediate: true, reason: "batch" },
      preventDefault() { prevented = true },
    })

    assert.equal(prevented, true)
    assert.equal(abortCount, 1)
    assert.equal(closeCalls.length, 1)
    assert.equal(closeCalls[0].options.restoreFocus, false)
  })

  it("restores the trigger focus when Escape dismisses the lookup owner", () => {
    const closeCalls = []
    const { A4Lookup, modal } = loadLookup({
      closeLayer: (layer, options) => closeCalls.push({ layer, options }),
    })
    A4Lookup.createLookupModalController({
      getState: () => ({ rounds: [], customWordbooks: [] }),
    })

    modal.dispatch("a4-layer-dismiss", {
      detail: { immediate: false, reason: "escape" },
      preventDefault() {},
    })

    assert.equal(closeCalls.length, 1)
    assert.equal(closeCalls[0].options.restoreFocus, true)
  })
})
