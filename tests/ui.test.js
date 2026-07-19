const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const { describe, it } = require("node:test")
const assert = require("node:assert/strict")

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
  }
}

function createElement({ id = "", classes = [], tagName = "DIV", focusable = false } = {}) {
  const attributes = new Map()
  const listeners = new Map()
  const element = {
    id,
    tagName,
    dataset: {},
    style: {},
    inert: false,
    disabled: false,
    offsetParent: focusable ? {} : null,
    classList: createClassList(classes),
    children: [],
    parentElement: null,
    focusCount: 0,
    clickCount: 0,
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
    focus() {
      element.focusCount += 1
      element.ownerDocument.activeElement = element
    },
    click() { element.clickCount += 1 },
    contains(candidate) {
      if (candidate === element) return true
      return element.children.some((child) => child.contains(candidate))
    },
    appendChild(child) {
      child.parentElement = element
      child.ownerDocument = element.ownerDocument
      element.children.push(child)
      return child
    },
    querySelectorAll(selector) {
      if (selector.includes("button")) {
        return element.children.filter((child) => child.offsetParent !== null)
      }
      return []
    },
    querySelector(selector) {
      if (selector === "[data-autofocus]") {
        return element.children.find((child) => child.hasAttribute("data-autofocus")) || null
      }
      if (selector.includes("modal-backdrop")) {
        return element.children.find((child) => child.classList.contains("modal-backdrop")) || null
      }
      return null
    },
  }
  return element
}

function loadUi({ motion = false } = {}) {
  const code = fs.readFileSync(path.join(__dirname, "..", "js", "ui", "layers.js"), "utf8")
  const documentListeners = new Map()
  const body = createElement({ tagName: "BODY" })
  const document = {
    body,
    activeElement: null,
    addEventListener(type, listener) { documentListeners.set(type, listener) },
    removeEventListener(type, listener) {
      if (documentListeners.get(type) === listener) documentListeners.delete(type)
    },
    dispatch(type, event) { documentListeners.get(type)?.(event) },
  }
  body.ownerDocument = document
  const scrollCalls = []
  const window = {
    document,
    scrollY: 137,
    scrollTo(x, y) { scrollCalls.push([x, y]) },
    matchMedia: motion ? () => ({ matches: false }) : undefined,
    setTimeout,
    clearTimeout,
  }
  window.window = window
  const sandbox = {
    console,
    document,
    window,
    CustomEvent: class CustomEvent {
      constructor(type, options = {}) {
        this.type = type
        this.cancelable = !!options.cancelable
        this.defaultPrevented = false
      }
      preventDefault() { if (this.cancelable) this.defaultPrevented = true }
    },
  }
  vm.createContext(sandbox)
  vm.runInContext(code, sandbox)

  function attach(element) {
    const setOwnerDocument = (node) => {
      node.ownerDocument = document
      node.children.forEach(setOwnerDocument)
    }
    setOwnerDocument(element)
    body.appendChild(element)
    return element
  }

  return { A4UI: window.A4UI, attach, body, document, documentListeners, scrollCalls }
}

function createLayer(id) {
  const layer = createElement({ id, classes: ["modal", "hidden"] })
  const backdrop = createElement({ classes: ["modal-backdrop"], focusable: false })
  const firstButton = createElement({ id: `${id}-first`, tagName: "BUTTON", focusable: true })
  const closeButton = createElement({ id: `${id}-close`, tagName: "BUTTON", focusable: true })
  layer.appendChild(backdrop)
  layer.appendChild(firstButton)
  layer.appendChild(closeButton)
  return { layer, backdrop, firstButton, closeButton }
}

describe("A4UI layer manager", () => {
  it("opens and closes a layer idempotently while locking and restoring the page", () => {
    const { A4UI, attach, body, document, documentListeners, scrollCalls } = loadUi()
    const appRoot = attach(createElement({ id: "appRoot" }))
    const trigger = attach(createElement({ id: "trigger", tagName: "BUTTON", focusable: true }))
    const { layer, firstButton } = createLayer("settingsModal")
    attach(layer)
    document.activeElement = trigger

    A4UI.setLayerVisible(layer, true)
    A4UI.setLayerVisible(layer, true)

    assert.equal(layer.classList.contains("hidden"), false)
    assert.equal(layer.getAttribute("aria-hidden"), "false")
    assert.equal(body.classList.contains("modal-open"), true)
    assert.equal(body.style.top, "-137px")
    assert.equal(appRoot.inert, true)
    assert.equal(A4UI.getOpenLayers().length, 1)
    assert.equal(documentListeners.has("keydown"), true)
    assert.equal(firstButton.focusCount, 1)

    A4UI.setLayerVisible(layer, false)

    assert.equal(layer.classList.contains("hidden"), true)
    assert.equal(body.classList.contains("modal-open"), false)
    assert.equal(appRoot.inert, false)
    assert.deepEqual(scrollCalls, [[0, 137]])
    assert.equal(trigger.focusCount, 1)
    assert.equal(documentListeners.has("keydown"), false)
  })

  it("keeps the page locked until the last nested layer closes", () => {
    const { A4UI, attach, body, document } = loadUi()
    const trigger = attach(createElement({ id: "trigger", tagName: "BUTTON", focusable: true }))
    const outer = createLayer("outerModal")
    const inner = createLayer("innerModal")
    attach(outer.layer)
    attach(inner.layer)
    document.activeElement = trigger

    A4UI.setLayerVisible(outer.layer, true)
    document.activeElement = outer.firstButton
    A4UI.setLayerVisible(inner.layer, true)
    A4UI.setLayerVisible(inner.layer, false)

    assert.equal(body.classList.contains("modal-open"), true)
    assert.equal(outer.firstButton.focusCount, 2)
    const remainingLayers = A4UI.getOpenLayers()
    assert.equal(remainingLayers.length, 1)
    assert.equal(remainingLayers[0], outer.layer)

    A4UI.setLayerVisible(outer.layer, false)
    assert.equal(body.classList.contains("modal-open"), false)
    assert.equal(trigger.focusCount, 1)
  })

  it("requests dismissal of only the top layer when Escape is pressed", () => {
    const { A4UI, attach, document } = loadUi()
    const outer = createLayer("outerModal")
    const inner = createLayer("innerModal")
    attach(outer.layer)
    attach(inner.layer)

    A4UI.setLayerVisible(outer.layer, true)
    A4UI.setLayerVisible(inner.layer, true)
    document.dispatch("keydown", {
      key: "Escape",
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true },
    })

    assert.equal(inner.backdrop.clickCount, 1)
    assert.equal(outer.backdrop.clickCount, 0)
  })

  it("keeps the page locked while a layer performs its exit animation", async () => {
    const { A4UI, attach, body } = loadUi({ motion: true })
    const { layer } = createLayer("animatedModal")
    attach(layer)
    A4UI.setLayerVisible(layer, true)

    assert.equal(typeof A4UI.closeLayer, "function")
    const closed = A4UI.closeLayer(layer)
    assert.equal(layer.classList.contains("a4-layer-closing"), true)
    assert.equal(layer.classList.contains("hidden"), false)
    assert.equal(body.classList.contains("modal-open"), true)
    assert.equal(A4UI.hasOpenLayer(), true)

    await closed

    assert.equal(layer.classList.contains("a4-layer-closing"), false)
    assert.equal(layer.classList.contains("hidden"), true)
    assert.equal(body.classList.contains("modal-open"), false)
    assert.equal(A4UI.hasOpenLayer(), false)
  })

  it("cancels a pending exit without overwriting the original scroll lock", async () => {
    const { A4UI, attach, body } = loadUi({ motion: true })
    const { layer } = createLayer("reopenedModal")
    attach(layer)
    A4UI.setLayerVisible(layer, true)

    const interruptedClose = A4UI.closeLayer(layer)
    A4UI.setLayerVisible(layer, true)

    assert.equal(await interruptedClose, false)
    assert.equal(layer.classList.contains("hidden"), false)
    assert.equal(body.style.top, "-137px")

    await A4UI.closeLayer(layer)

    assert.equal(body.style.top, "")
  })
})
