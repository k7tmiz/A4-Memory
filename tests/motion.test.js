const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const { describe, it } = require("node:test")
const assert = require("node:assert/strict")

const motionPath = path.join(__dirname, "..", "js", "ui", "motion.js")

function createClassList() {
  const values = new Set()
  return {
    add(...names) { names.forEach((name) => values.add(name)) },
    remove(...names) { names.forEach((name) => values.delete(name)) },
    contains(name) { return values.has(name) },
  }
}

function loadMotion({ reducedMotion = false } = {}) {
  const code = fs.readFileSync(motionPath, "utf8")
  const listeners = new Map()
  const body = {
    classList: createClassList(),
    setAttribute() {},
    removeAttribute() {},
  }
  const document = {
    body,
    readyState: "loading",
    addEventListener(type, listener) { listeners.set(type, listener) },
  }
  const window = {
    document,
    location: { assign() {} },
    matchMedia: () => ({ matches: reducedMotion }),
    setTimeout,
    addEventListener() {},
  }
  window.window = window
  const sandbox = { window, document, URL, setTimeout, clearTimeout }
  vm.createContext(sandbox)
  vm.runInContext(code, sandbox)
  return { A4Motion: window.A4Motion, body }
}

describe("A4Motion page transitions", () => {
  it("loads a shared motion controller for cross-page navigation", () => {
    assert.equal(fs.existsSync(motionPath), true)
    const { A4Motion } = loadMotion()
    assert.equal(typeof A4Motion.navigate, "function")
  })

  it("plays the page exit state before navigating and ignores duplicate requests", async () => {
    const { A4Motion, body } = loadMotion()
    const destinations = []

    const first = A4Motion.navigate("./records.html", {
      delayMs: 5,
      navigateTo: (href) => destinations.push(href),
    })
    const duplicate = A4Motion.navigate("./index.html", {
      delayMs: 5,
      navigateTo: (href) => destinations.push(href),
    })

    assert.equal(first, true)
    assert.equal(duplicate, false)
    assert.equal(body.classList.contains("a4-page-leaving"), true)
    assert.deepEqual(destinations, [])

    await new Promise((resolve) => setTimeout(resolve, 12))
    assert.deepEqual(destinations, ["./records.html"])
  })

  it("navigates immediately when reduced motion is requested", () => {
    const { A4Motion, body } = loadMotion({ reducedMotion: true })
    const destinations = []

    A4Motion.navigate("./records.html", {
      delayMs: 20,
      navigateTo: (href) => destinations.push(href),
    })

    assert.deepEqual(destinations, ["./records.html"])
    assert.equal(body.classList.contains("a4-page-leaving"), false)
  })
})
