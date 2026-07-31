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

function createElement({
  id = "",
  classes = [],
  tagName = "DIV",
  focusable = false,
  rect = { left: 0, top: 0, width: 0, height: 0 },
} = {}) {
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
    rect: { ...rect },
    animations: [],
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
    blur() {
      if (element.ownerDocument.activeElement === element) element.ownerDocument.activeElement = null
    },
    click() { element.clickCount += 1 },
    getBoundingClientRect() {
      const { left, top, width, height } = element.rect
      return { left, top, width, height, right: left + width, bottom: top + height }
    },
    animate(keyframes, options) {
      const animation = {
        keyframes,
        options,
        canceled: false,
        finished: Promise.resolve(),
        cancel() { animation.canceled = true },
      }
      element.animations.push(animation)
      return animation
    },
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
      const descendants = []
      const visit = (node) => {
        for (const child of node.children) {
          descendants.push(child)
          visit(child)
        }
      }
      visit(element)
      if (selector.includes("button")) {
        return descendants.filter(
          (child) => child.tagName === "BUTTON" && child.offsetParent !== null
        )
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
      if (selector.includes(".modal-panel")) {
        return element.children.find((child) => child.classList.contains("modal-panel")) || null
      }
      return null
    },
  }
  return element
}

function loadUi({ motion = false, reducedMotion = false } = {}) {
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
    matchMedia: motion || reducedMotion ? () => ({ matches: reducedMotion }) : undefined,
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
        this.detail = options.detail
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
  const panel = createElement({
    classes: ["modal-panel"],
    rect: { left: 200, top: 300, width: 320, height: 240 },
  })
  const firstButton = createElement({ id: `${id}-first`, tagName: "BUTTON", focusable: true })
  const closeButton = createElement({ id: `${id}-close`, tagName: "BUTTON", focusable: true })
  closeButton.setAttribute("data-layer-close", "")
  layer.appendChild(backdrop)
  panel.appendChild(firstButton)
  panel.appendChild(closeButton)
  layer.appendChild(panel)
  return { layer, backdrop, panel, firstButton, closeButton }
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

  it("opens from the clicked control and closes back to the same saved origin", async () => {
    const { A4UI, attach, document } = loadUi({ motion: true })
    const trigger = attach(createElement({
      id: "open-settings",
      tagName: "BUTTON",
      focusable: true,
      rect: { left: 20, top: 40, width: 80, height: 40 },
    }))
    const { layer, panel } = createLayer("originModal")
    attach(layer)
    document.activeElement = trigger

    A4UI.setLayerVisible(layer, true, { trigger, motion: "origin" })

    assert.equal(panel.animations.length, 1)
    assert.equal(
      panel.animations[0].keyframes[0].transform,
      "translate3d(-300px, -360px, 0) scale(0.72)"
    )
    assert.equal(
      panel.animations[0].keyframes.at(-1).transform,
      "translate3d(0, 0, 0) scale(1)"
    )

    const closed = A4UI.closeLayer(layer)
    assert.equal(
      panel.animations.at(-1).keyframes.at(-1).transform,
      "translate3d(-300px, -360px, 0) scale(0.72)"
    )
    await closed
  })

  it("uses a neutral fallback when no user trigger exists", () => {
    const { A4UI, attach } = loadUi({ motion: true })
    const { layer, panel } = createLayer("automaticModal")
    attach(layer)

    A4UI.setLayerVisible(layer, true, { motion: "neutral" })

    assert.equal(
      panel.animations[0].keyframes[0].transform,
      "translate3d(0, 10px, 0) scale(0.97)"
    )
  })

  it("removes spatial animations when reduced motion is requested", async () => {
    const { A4UI, attach } = loadUi({ reducedMotion: true })
    const trigger = attach(createElement({
      id: "reduced-trigger",
      tagName: "BUTTON",
      focusable: true,
      rect: { left: 20, top: 40, width: 80, height: 40 },
    }))
    const { layer, panel, backdrop } = createLayer("reducedModal")
    attach(layer)

    A4UI.setLayerVisible(layer, true, { trigger, motion: "origin" })
    await A4UI.closeLayer(layer)

    assert.equal(panel.animations.length, 0)
    assert.equal(backdrop.animations.length, 0)
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

  it("closes every open or animating layer immediately for a route handoff", () => {
    const { A4UI, attach, body, document } = loadUi({ motion: true })
    const first = createLayer("first")
    const second = createLayer("second")
    const third = createLayer("third")
    attach(first.layer)
    attach(second.layer)
    attach(third.layer)
    const dismissOrder = []
    for (const current of [first, second, third]) {
      current.layer.addEventListener("a4-layer-dismiss", (event) => {
        dismissOrder.push(current.layer.id)
        event.preventDefault()
        A4UI.closeLayer(current.layer, { immediate: event.detail?.immediate })
      })
    }
    A4UI.setLayerVisible(first.layer, true)
    A4UI.setLayerVisible(second.layer, true)
    A4UI.closeLayer(second.layer)
    A4UI.setLayerVisible(third.layer, true)
    document.activeElement = third.firstButton

    assert.equal(body.classList.contains("modal-open"), true)
    assert.equal(A4UI.closeAll({ immediate: true }), 3)
    assert.deepEqual(dismissOrder, ["third", "second", "first"])
    assert.equal(first.layer.classList.contains("hidden"), true)
    assert.equal(second.layer.classList.contains("hidden"), true)
    assert.equal(third.layer.classList.contains("hidden"), true)
    assert.equal(A4UI.hasOpenLayer(), false)
    assert.equal(body.classList.contains("modal-open"), false)
    assert.equal(document.activeElement, null)
    assert.equal(first.firstButton.focusCount, 1)
    assert.equal(second.firstButton.focusCount, 1)
    assert.equal(third.firstButton.focusCount, 1)
  })

  it("keeps focus suppressed when an animating layer joins an asynchronous batch close", async () => {
    const { A4UI, attach, document } = loadUi({ motion: true })
    const trigger = attach(createElement({ id: "trigger", focusable: true }))
    const outer = createLayer("outer")
    const inner = createLayer("inner")
    attach(outer.layer)
    attach(inner.layer)
    trigger.focus()
    A4UI.setLayerVisible(outer.layer, true)
    A4UI.setLayerVisible(inner.layer, true)

    A4UI.closeLayer(inner.layer)
    assert.equal(A4UI.closeAll(), 2)
    await new Promise((resolve) => setTimeout(resolve, 220))

    assert.equal(A4UI.hasOpenLayer(), false)
    assert.equal(document.activeElement, null)
    assert.equal(trigger.focusCount, 1)
  })

  it("does not treat a visible Settings page surface as an open modal layer", () => {
    const { A4UI, attach } = loadUi()
    const settingsPage = attach(createElement({ id: "settingsModal", classes: ["settings-page-root"] }))

    assert.equal(settingsPage.classList.contains("hidden"), false)
    assert.equal(A4UI.hasOpenLayer(), false)
  })
})
