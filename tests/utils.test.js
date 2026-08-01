const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const { describe, it } = require("node:test")
const assert = require("node:assert/strict")

const utilsCode = fs.readFileSync(path.join(__dirname, "..", "js", "utils.js"), "utf8")
const layersCode = fs.readFileSync(path.join(__dirname, "..", "js", "ui", "layers.js"), "utf8")

function loadUtils() {
  const filePath = path.join(__dirname, "..", "js", "utils.js")
  const code = fs.readFileSync(filePath, "utf8")
  const sandbox = {
    window: {},
    document: {
      readyState: "complete",
      addEventListener() {},
      createElement() { return { style: {}, classList: { add() {}, remove() {} }, appendChild() {}, addEventListener() {} } },
      body: { appendChild() {}, removeChild() {} },
      getElementById: () => null,
      querySelectorAll: () => [],
    },
    navigator: { userAgent: "node", maxTouchPoints: 0 },
  }
  sandbox.window.window = sandbox.window
  sandbox.window.matchMedia = () => ({ matches: false })
  vm.createContext(sandbox)
  vm.runInContext(code, sandbox)
  return sandbox.window.A4Utils
}

function loadUtilsWithLayerSpy({ deferClose = false } = {}) {
  const filePath = path.join(__dirname, "..", "js", "utils.js")
  const code = fs.readFileSync(filePath, "utf8")
  const layerCalls = []
  let releaseClose = null

  function createElement(tagName = "div") {
    const listeners = new Map()
    const classes = new Set()
    const element = {
      tagName: String(tagName).toUpperCase(),
      children: [],
      parentElement: null,
      style: {},
      textContent: "",
      type: "",
      setAttribute() {},
      addEventListener(type, listener) { listeners.set(type, listener) },
      appendChild(child) {
        child.parentElement = element
        element.children.push(child)
        return child
      },
      click() { listeners.get("click")?.({ target: element }) },
      classList: {
        add(...names) { names.forEach((name) => classes.add(name)) },
        remove(...names) { names.forEach((name) => classes.delete(name)) },
        contains(name) { return classes.has(name) },
      },
    }
    Object.defineProperty(element, "className", {
      get() { return [...classes].join(" ") },
      set(value) {
        classes.clear()
        String(value || "").split(/\s+/).filter(Boolean).forEach((name) => classes.add(name))
      },
    })
    return element
  }

  const body = createElement("body")
  body.removeChild = (child) => {
    body.children = body.children.filter((entry) => entry !== child)
    child.parentElement = null
  }
  const document = {
    readyState: "complete",
    body,
    addEventListener() {},
    createElement,
    getElementById: () => null,
    querySelectorAll: () => [],
  }
  const window = {
    document,
    matchMedia: () => ({ matches: false }),
    A4UI: {
      setLayerVisible(modal, visible, options = {}) {
        layerCalls.push({ modal, visible, options })
        modal.classList.toggle?.("hidden", !visible)
      },
      closeLayer: deferClose
        ? (modal) => {
            layerCalls.push({ modal, visible: false })
            return new Promise((resolve) => {
              releaseClose = () => {
                modal.classList.add("hidden")
                resolve(true)
              }
            })
          }
        : undefined,
    },
  }
  window.window = window
  const sandbox = {
    window,
    document,
    navigator: { userAgent: "node", maxTouchPoints: 0 },
    Blob,
    URL,
    setTimeout,
    clearTimeout,
  }
  vm.createContext(sandbox)
  vm.runInContext(code, sandbox)
  return { A4Utils: window.A4Utils, body, layerCalls, releaseClose: () => releaseClose?.() }
}

function loadUtilsWithRealLayers({ reducedMotion = false } = {}) {
  function createClassList(initial = []) {
    const values = new Set(initial)
    return {
      add(...names) { names.forEach((name) => values.add(name)) },
      remove(...names) { names.forEach((name) => values.delete(name)) },
      contains(name) { return values.has(name) },
      toggle(name, force) {
        const enabled = force === undefined ? !values.has(name) : !!force
        if (enabled) values.add(name)
        else values.delete(name)
        return enabled
      },
      values,
    }
  }

  const documentListeners = new Map()
  const document = {
    readyState: "complete",
    activeElement: null,
    addEventListener(type, listener) {
      const entries = documentListeners.get(type) || []
      entries.push(listener)
      documentListeners.set(type, entries)
    },
    removeEventListener(type, listener) {
      documentListeners.set(type, (documentListeners.get(type) || []).filter((entry) => entry !== listener))
    },
    getElementById(id) {
      const visit = (node) => {
        if (node.id === id) return node
        for (const child of node.children || []) {
          const match = visit(child)
          if (match) return match
        }
        return null
      }
      return visit(document.body)
    },
    querySelectorAll() { return [] },
  }

  function createElement(tagName = "div") {
    const attributes = new Map()
    const listeners = new Map()
    const element = {
      id: "",
      tagName: String(tagName).toUpperCase(),
      children: [],
      parentElement: null,
      ownerDocument: document,
      style: {},
      dataset: {},
      textContent: "",
      type: "",
      disabled: false,
      inert: false,
      offsetParent: String(tagName).toUpperCase() === "BUTTON" ? {} : null,
      classList: createClassList(),
      setAttribute(name, value) { attributes.set(name, String(value)) },
      getAttribute(name) { return attributes.get(name) ?? null },
      hasAttribute(name) { return attributes.has(name) },
      removeAttribute(name) { attributes.delete(name) },
      addEventListener(type, listener) {
        const entries = listeners.get(type) || []
        entries.push(listener)
        listeners.set(type, entries)
      },
      removeEventListener(type, listener) {
        listeners.set(type, (listeners.get(type) || []).filter((entry) => entry !== listener))
      },
      dispatchEvent(event) {
        event.target ||= element
        for (const listener of listeners.get(event.type) || []) listener(event)
        return !event.defaultPrevented
      },
      click() {
        element.dispatchEvent({ type: "click", defaultPrevented: false, preventDefault() { this.defaultPrevented = true } })
      },
      appendChild(child) {
        child.parentElement = element
        child.ownerDocument = document
        element.children.push(child)
        return child
      },
      remove() { element.parentElement?.removeChild?.(element) },
      removeChild(child) {
        element.children = element.children.filter((entry) => entry !== child)
        child.parentElement = null
        return child
      },
      contains(candidate) {
        return candidate === element || element.children.some((child) => child.contains?.(candidate))
      },
      focus() { document.activeElement = element },
      blur() { if (document.activeElement === element) document.activeElement = null },
      querySelectorAll() {
        const matches = []
        const visit = (node) => {
          for (const child of node.children || []) {
            if (["BUTTON", "INPUT", "TEXTAREA", "SELECT", "DETAILS", "A"].includes(child.tagName)) matches.push(child)
            visit(child)
          }
        }
        visit(element)
        return matches
      },
      querySelector(selector) {
        const visit = (node) => {
          for (const child of node.children || []) {
            if (selector === "[data-autofocus]" && child.hasAttribute("data-autofocus")) return child
            if (selector.includes("data-layer-close") && child.hasAttribute("data-layer-close")) return child
            if (selector.includes("modal-backdrop") && child.classList.contains("modal-backdrop")) return child
            const match = visit(child)
            if (match) return match
          }
          return null
        }
        return visit(element)
      },
    }
    Object.defineProperty(element, "className", {
      get() { return [...element.classList.values].join(" ") },
      set(value) {
        element.classList.values.clear()
        String(value || "").split(/\s+/).filter(Boolean).forEach((name) => element.classList.add(name))
      },
    })
    return element
  }

  document.createElement = createElement
  document.body = createElement("body")
  const window = {
    document,
    scrollY: 0,
    scrollTo() {},
    setTimeout,
    clearTimeout,
    matchMedia: () => ({ matches: reducedMotion }),
  }
  window.window = window
  const sandbox = {
    window,
    document,
    navigator: { userAgent: "node", maxTouchPoints: 0 },
    Blob,
    URL,
    console,
    CustomEvent: class CustomEvent {
      constructor(type, options = {}) {
        this.type = type
        this.cancelable = !!options.cancelable
        this.detail = options.detail
        this.defaultPrevented = false
      }
      preventDefault() { if (this.cancelable) this.defaultPrevented = true }
    },
  }
  vm.createContext(sandbox)
  vm.runInContext(layersCode, sandbox)
  vm.runInContext(utilsCode, sandbox)
  return { A4UI: window.A4UI, A4Utils: window.A4Utils, body: document.body, document }
}

const A4Utils = loadUtils()

describe("A4Utils.sanitizeFilename", () => {
  it("removes path-traversal and shell-special chars", () => {
    assert.equal(A4Utils.sanitizeFilename("../../etc/passwd"), "..-..-etc-passwd")
    assert.equal(A4Utils.sanitizeFilename("a\\b/c:d*e?f\"g<h>i|j"), "a-b-c-d-e-f-g-h-i-j")
  })

  it("collapses whitespace", () => {
    assert.equal(A4Utils.sanitizeFilename("hello    world"), "hello world")
  })

  it("trims leading and trailing whitespace", () => {
    assert.equal(A4Utils.sanitizeFilename("  abc  "), "abc")
  })

  it("limits to 80 chars", () => {
    const long = "a".repeat(200)
    assert.equal(A4Utils.sanitizeFilename(long).length, 80)
  })

  it("coerces non-string input", () => {
    assert.equal(A4Utils.sanitizeFilename(null), "")
    assert.equal(A4Utils.sanitizeFilename(undefined), "")
  })
})

describe("A4Utils modal integration", () => {
  it("opens and closes confirmation dialogs through the shared layer manager", async () => {
    const { A4Utils: utils, body, layerCalls } = loadUtilsWithLayerSpy()
    const trigger = { id: "delete-round" }
    const result = utils.showConfirmDialog({
      message: "确定继续吗？",
      trigger,
    })

    assert.equal(body.children.length, 1)
    assert.deepEqual(layerCalls.map(({ visible }) => visible), [true])
    assert.equal(layerCalls[0].options.trigger, trigger)
    assert.equal(layerCalls[0].options.motion, "origin")

    const modal = body.children[0]
    const closeButton = modal.children[1].children[0].children[1].children[0]
    closeButton.click()

    assert.equal(await result, false)
    assert.deepEqual(layerCalls.map(({ visible }) => visible), [true, false])
    assert.equal(body.children.length, 0)
  })

  it("keeps a confirmation dialog mounted until its shared exit animation finishes", async () => {
    const { A4Utils: utils, body, releaseClose } = loadUtilsWithLayerSpy({ deferClose: true })
    const result = utils.showConfirmDialog("确定继续吗？")
    const modal = body.children[0]
    const closeButton = modal.children[1].children[0].children[1].children[0]

    closeButton.click()

    assert.equal(body.children.length, 1)
    releaseClose()
    assert.equal(await result, false)
    assert.equal(body.children.length, 0)
  })

  it("settles and removes each real confirmation owner when the router closes all layers", async () => {
    const { A4UI, A4Utils: utils, body, document } = loadUtilsWithRealLayers()

    for (let attempt = 0; attempt < 2; attempt++) {
      const result = utils.showConfirmDialog(`确认 ${attempt}`)
      assert.equal(document.getElementById("a4-confirm-title")?.textContent, "确认")
      assert.equal(A4UI.closeAll({ immediate: true }), 1)
      const settled = await Promise.race([
        result,
        new Promise((resolve) => setTimeout(() => resolve("timeout"), 50)),
      ])
      assert.equal(settled, false)
      assert.equal(body.children.length, 0)
      assert.equal(document.getElementById("a4-confirm-title"), null)
      assert.equal(A4UI.hasOpenLayer(), false)
    }
  })

  it("restores the trigger focus when Escape dismisses a real confirmation owner", async () => {
    const { A4UI, A4Utils: utils, body, document } = loadUtilsWithRealLayers({ reducedMotion: true })
    const trigger = document.createElement("button")
    body.appendChild(trigger)
    trigger.focus()

    const result = utils.showConfirmDialog("确定继续吗？")
    assert.notEqual(document.activeElement, trigger)
    assert.equal(A4UI.requestTopLayerClose(), true)

    assert.equal(await result, false)
    assert.equal(document.activeElement, trigger)
    assert.equal(body.children.length, 1)
  })

  it("opens application notices through the shared layer manager", async () => {
    const { A4Utils: utils, body, layerCalls } = loadUtilsWithLayerSpy()
    const result = utils.showNoticeDialog({
      title: "导入失败",
      message: "数据结构不正确。",
    })

    assert.equal(body.children.length, 1)
    assert.equal(layerCalls[0].visible, true)
    const modal = body.children[0]
    const panel = modal.children[1]
    assert.equal(panel.children[0].children[0].textContent, "导入失败")
    assert.equal(panel.children[1].textContent, "数据结构不正确。")

    panel.children[2].children[0].click()
    assert.equal(await result, true)
    assert.equal(body.children.length, 0)
  })

  it("returns an application-owned choice through a shared bottom sheet", async () => {
    const { A4Utils: utils, body, layerCalls } = loadUtilsWithLayerSpy()
    const trigger = { id: "model-picker" }
    const result = utils.showChoiceDialog({
      title: "选择常用模型",
      options: [
        { value: "gpt-4o-mini", label: "gpt-4o-mini" },
        { value: "gpt-4.1-mini", label: "gpt-4.1-mini" },
      ],
      value: "gpt-4o-mini",
      trigger,
    })

    assert.equal(layerCalls[0].options.trigger, trigger)
    assert.equal(layerCalls[0].options.motion, "sheet")
    const modal = body.children[0]
    const list = modal.children[1].children[1]
    list.children[1].click()

    assert.equal(await result, "gpt-4.1-mini")
    assert.equal(body.children.length, 0)
  })
})
