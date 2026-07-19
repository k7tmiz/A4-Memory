const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const { describe, it } = require("node:test")
const assert = require("node:assert/strict")

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
      setLayerVisible(modal, visible) {
        layerCalls.push({ modal, visible })
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
  }
  vm.createContext(sandbox)
  vm.runInContext(code, sandbox)
  return { A4Utils: window.A4Utils, body, layerCalls, releaseClose: () => releaseClose?.() }
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
    const result = utils.showConfirmDialog("确定继续吗？")

    assert.equal(body.children.length, 1)
    assert.deepEqual(layerCalls.map(({ visible }) => visible), [true])

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
})
