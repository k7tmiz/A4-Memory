const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const { describe, it } = require("node:test")
const assert = require("node:assert/strict")

const routerPath = path.join(__dirname, "..", "js", "ui", "router.js")

function createClassList(initial = []) {
  const values = new Set(initial)
  return {
    add(...names) { names.forEach((name) => values.add(name)) },
    remove(...names) { names.forEach((name) => values.delete(name)) },
    toggle(name, force) {
      if (force === true) values.add(name)
      else if (force === false) values.delete(name)
      else if (values.has(name)) values.delete(name)
      else values.add(name)
      return values.has(name)
    },
    contains(name) { return values.has(name) },
  }
}

function createElement({ view = "", route = "" } = {}) {
  const attributes = new Map()
  const focusCalls = []
  const element = {
    classList: createClassList(),
    dataset: {},
    hidden: false,
    inert: false,
    setAttribute(name, value) { attributes.set(name, String(value)) },
    removeAttribute(name) { attributes.delete(name) },
    getAttribute(name) { return attributes.get(name) ?? null },
    focus(options) { focusCalls.push(options) },
    querySelector(selector) {
      return selector === "[data-a4-route-focus]" ? element.focusTarget || null : null
    },
    closest(selector) {
      return selector === "[data-a4-route]" && route ? element : null
    },
    focusCalls,
  }
  if (view) element.dataset.a4View = view
  if (route) element.dataset.a4Route = route
  return element
}

function loadRouter({ pathname = "/index.html", search = "", reducedMotion = false, A4UI = null } = {}) {
  const code = fs.readFileSync(routerPath, "utf8")
  const views = ["study", "records", "settings"].map((view) => createElement({ view }))
  for (const view of views) view.focusTarget = createElement()
  const links = ["study", "records", "settings"].map((route) => createElement({ route }))
  const dock = createElement()
  const nextAction = createElement()
  const body = createElement()
  const documentListeners = new Map()
  const windowListeners = new Map()
  const historyCalls = []
  const scrollCalls = []
  const location = {
    href: `https://example.test${pathname}${search}`,
    origin: "https://example.test",
    pathname,
    search,
  }
  const document = {
    body,
    readyState: "loading",
    title: "A4 Memory",
    querySelector(selector) {
      if (selector === ".app-dock-shell") return dock
      if (selector === ".app-next-action") return nextAction
      const match = /^\[data-a4-view="([^"]+)"\]$/.exec(selector)
      return match ? views.find((view) => view.dataset.a4View === match[1]) || null : null
    },
    querySelectorAll(selector) {
      if (selector === "[data-a4-view]") return views
      if (selector === "[data-a4-route]") return links
      return []
    },
    addEventListener(type, listener) { documentListeners.set(type, listener) },
  }
  const window = {
    document,
    URLSearchParams,
    location,
    history: {
      pushState(state, unused, href) { historyCalls.push(["push", state, href]) },
      replaceState(state, unused, href) { historyCalls.push(["replace", state, href]) },
    },
    matchMedia: () => ({ matches: reducedMotion }),
    addEventListener(type, listener) { windowListeners.set(type, listener) },
    setTimeout,
    clearTimeout,
    requestAnimationFrame(callback) { callback() },
    scrollY: 0,
    scrollTo(options) { scrollCalls.push(options) },
  }
  if (A4UI) window.A4UI = A4UI
  window.window = window
  const sandbox = { window, document, URL, URLSearchParams, setTimeout, clearTimeout }
  vm.createContext(sandbox)
  vm.runInContext(code, sandbox)
  const A4Router = window.A4Router.createRouter({
    windowRef: window,
    documentRef: document,
    exitMs: 4,
    enterMs: 4,
  })
  return {
    A4Router,
    body,
    dock,
    documentListeners,
    historyCalls,
    links,
    location,
    nextAction,
    scrollCalls,
    views,
    window,
    windowListeners,
  }
}

describe("A4Router persistent application shell", () => {
  it("starts the default router only after every deferred controller has loaded", () => {
    const harness = loadRouter()
    assert.equal(harness.window.A4Router.getCurrentView(), "")

    harness.documentListeners.get("DOMContentLoaded")()

    assert.equal(harness.window.A4Router.getCurrentView(), "study")
  })

  it("normalizes route names and existing clean URLs", () => {
    const { A4Router } = loadRouter()

    assert.equal(A4Router.resolveView("study"), "study")
    assert.equal(A4Router.resolveView("./records.html"), "records")
    assert.equal(A4Router.resolveView("https://example.test/settings.html?from=records"), "settings")
    assert.equal(A4Router.resolveView("./unknown.html"), "study")
    assert.equal(A4Router.hrefForView("records"), "./records.html")
  })

  it("starts from a compatibility view query and mounts exactly one view", () => {
    const harness = loadRouter({ pathname: "/index.html", search: "?view=settings" })
    const entered = []
    harness.A4Router.register("settings", { enter: (context) => entered.push(context) })

    assert.equal(harness.A4Router.start(), true)
    assert.equal(harness.A4Router.getCurrentView(), "settings")
    assert.deepEqual(harness.views.map((view) => view.hidden), [true, true, false])
    assert.equal(harness.body.classList.contains("settings-page"), true)
    assert.equal(harness.body.dataset.a4CurrentView, "settings")
    assert.equal(harness.body.dataset.a4View, undefined)
    assert.equal(harness.dock.dataset.activeView, "settings")
    assert.equal(harness.nextAction.getAttribute("aria-hidden"), "true")
    assert.equal(harness.nextAction.getAttribute("tabindex"), "-1")
    assert.equal(harness.nextAction.disabled, true)
    assert.equal(entered.length, 1)
    assert.equal(entered[0].initial, true)
    assert.equal(harness.historyCalls.length, 1)
    assert.equal(harness.historyCalls[0][0], "replace")
    assert.equal(harness.historyCalls[0][1].a4View, "settings")
    assert.equal(harness.historyCalls[0][2], "./settings.html")
  })

  it("runs leave and enter lifecycles while rejecting duplicate navigation", async () => {
    const harness = loadRouter()
    const events = []
    harness.A4Router.register("study", { leave: ({ to }) => events.push(`leave:${to}`) })
    harness.A4Router.register("records", { enter: ({ from }) => events.push(`enter:${from}`) })
    harness.A4Router.start()

    assert.equal(harness.A4Router.navigate("records", { exitMs: 4, enterMs: 4 }), true)
    assert.equal(harness.A4Router.navigate("settings"), false)
    assert.deepEqual(events, ["leave:records"])

    await new Promise((resolve) => setTimeout(resolve, 14))
    assert.equal(harness.A4Router.getCurrentView(), "records")
    assert.deepEqual(events, ["leave:records", "enter:study"])
    const historyCall = harness.historyCalls.at(-1)
    assert.equal(historyCall[0], "push")
    assert.equal(historyCall[1].a4View, "records")
    assert.equal(historyCall[2], "./records.html")
  })

  it("keeps Study, Records, and Settings on one horizontal route axis", async () => {
    const harness = loadRouter()
    harness.A4Router.start()

    assert.equal(harness.A4Router.navigate("settings", { exitMs: 0, enterMs: 12 }), true)
    assert.equal(harness.views[2].classList.contains("a4-view-entering-forward"), true)
    await new Promise((resolve) => setTimeout(resolve, 16))

    assert.equal(harness.A4Router.navigate("records", { exitMs: 0, enterMs: 12 }), true)
    assert.equal(harness.views[1].classList.contains("a4-view-entering-back"), true)
    await new Promise((resolve) => setTimeout(resolve, 16))

    assert.equal(harness.A4Router.navigate("study", { exitMs: 12, enterMs: 0 }), true)
    assert.equal(harness.views[1].classList.contains("a4-view-leaving-back"), true)
    await new Promise((resolve) => setTimeout(resolve, 16))

    assert.equal(harness.A4Router.navigate("records", { exitMs: 12, enterMs: 0 }), true)
    assert.equal(harness.views[0].classList.contains("a4-view-leaving-forward"), true)
    await new Promise((resolve) => setTimeout(resolve, 16))
  })

  it("uses popstate without adding a second history entry", async () => {
    const harness = loadRouter()
    harness.A4Router.start()
    harness.location.pathname = "/records.html"
    harness.location.search = ""

    harness.windowListeners.get("popstate")()
    await new Promise((resolve) => setTimeout(resolve, 16))

    assert.equal(harness.A4Router.getCurrentView(), "records")
    assert.equal(harness.historyCalls.filter(([kind]) => kind === "push").length, 0)
  })

  it("queues browser history changes that arrive during an active transition", async () => {
    const harness = loadRouter()
    harness.A4Router.start()
    harness.A4Router.navigate("records", { exitMs: 4, enterMs: 4 })
    harness.location.pathname = "/settings.html"

    harness.windowListeners.get("popstate")()
    await new Promise((resolve) => setTimeout(resolve, 28))

    assert.equal(harness.A4Router.getCurrentView(), "settings")
    assert.equal(harness.historyCalls.filter(([kind]) => kind === "push").length, 1)
  })

  it("keeps the latest dock click while another view is still entering", async () => {
    const harness = loadRouter()
    harness.A4Router.start()
    harness.A4Router.navigate("records", { exitMs: 4, enterMs: 4 })
    let prevented = false

    harness.documentListeners.get("click")({
      target: harness.links[2],
      button: 0,
      preventDefault() { prevented = true },
    })
    await new Promise((resolve) => setTimeout(resolve, 28))

    assert.equal(prevented, true)
    assert.equal(harness.A4Router.getCurrentView(), "settings")
    assert.equal(harness.historyCalls.filter(([kind]) => kind === "push").length, 2)
  })

  it("keeps a rapid Back action that targets the view still leaving", async () => {
    const harness = loadRouter()
    harness.A4Router.start()
    harness.A4Router.navigate("records", { exitMs: 4, enterMs: 4 })
    harness.location.pathname = "/index.html"

    harness.windowListeners.get("popstate")()
    await new Promise((resolve) => setTimeout(resolve, 28))

    assert.equal(harness.A4Router.getCurrentView(), "study")
    assert.equal(harness.historyCalls.filter(([kind]) => kind === "push").length, 1)
  })

  it("switches immediately when reduced motion is requested", () => {
    const harness = loadRouter({ reducedMotion: true })
    harness.A4Router.start()

    assert.equal(harness.A4Router.navigate("settings"), true)
    assert.equal(harness.A4Router.getCurrentView(), "settings")
    assert.equal(harness.views[2].hidden, false)
    assert.equal(harness.views[2].classList.contains("a4-view-entering"), false)
  })

  it("runs document-exit persistence only for the active controller in script registration order", () => {
    const harness = loadRouter({ reducedMotion: true })
    const writes = []
    harness.A4Router.register("study", { exit: () => writes.push("study") })
    harness.A4Router.register("records", {})
    harness.A4Router.register("settings", { exit: () => writes.push("settings") })
    harness.A4Router.start()

    harness.windowListeners.get("pagehide")()
    assert.deepEqual(writes, ["study"])

    harness.A4Router.navigate("records")
    harness.windowListeners.get("beforeunload")()
    assert.deepEqual(writes, ["study"])

    harness.A4Router.navigate("settings")
    harness.windowListeners.get("pagehide")()
    assert.deepEqual(writes, ["study", "settings"])
  })

  it("exposes one active-route ownership check for long-lived controller listeners", () => {
    const harness = loadRouter({ reducedMotion: true })
    const reactions = []
    const reactFor = (view, value) => {
      if (harness.A4Router.isActive(view)) reactions.push([view, value])
    }
    harness.A4Router.start()

    assert.equal(harness.A4Router.isActive("study"), true)
    assert.equal(harness.A4Router.isActive("records"), false)
    reactFor("study", "study-old")
    reactFor("records", "records-old")
    reactFor("settings", "settings-new")
    assert.deepEqual(reactions, [["study", "study-old"]])

    harness.A4Router.navigate("settings")
    assert.equal(harness.A4Router.isActive("study"), false)
    assert.equal(harness.A4Router.isActive("settings"), true)
    reactFor("study", "study-old")
    reactFor("records", "records-old")
    reactFor("settings", "settings-new")
    assert.deepEqual(reactions, [["study", "study-old"], ["settings", "settings-new"]])
  })

  it("closes every shared layer before a history route switch leaves its owner", () => {
    const events = []
    const harness = loadRouter({
      reducedMotion: true,
      A4UI: { closeAll(options) { events.push(["layers", options]) } },
    })
    harness.A4Router.register("study", { leave: () => events.push(["leave"]) })
    harness.A4Router.start()
    harness.location.pathname = "/records.html"

    harness.windowListeners.get("popstate")()

    assert.deepEqual(events.map(([kind]) => kind), ["layers", "leave"])
    assert.equal(events[0][1].immediate, true)
    assert.equal(harness.A4Router.getCurrentView(), "records")
  })
})
