const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const { describe, it } = require("node:test")
const assert = require("node:assert/strict")

const ROOT = path.join(__dirname, "..")
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8")

function createElement() {
  const listeners = new Map()
  const children = new Map()
  return {
    className: "",
    id: "",
    innerHTML: "",
    dataset: {},
    attributes: new Map(),
    setAttribute(name, value) { this.attributes.set(name, value) },
    addEventListener(type, listener) { listeners.set(type, listener) },
    querySelector(selector) {
      if (!children.has(selector)) children.set(selector, createElement())
      return children.get(selector)
    },
    listeners,
  }
}

function loadAnnouncements({ activeRoute = "study", loggedIn = true, result } = {}) {
  const calls = { visible: [], markedRead: [], fetches: 0 }
  const appended = []
  const sandbox = {
    console,
    Element: function Element() {},
    document: {
      createElement: () => createElement(),
      body: { appendChild: (el) => appended.push(el) },
    },
    window: {
      setTimeout,
      clearTimeout,
      A4Common: {
        formatDateTime: (value) => `formatted:${value}`,
        setModalVisible: (modal, visible, options) => calls.visible.push({ modal, visible, options }),
      },
      A4Sanitize: { escapeHtml: (value) => String(value).replaceAll("<", "&lt;").replaceAll(">", "&gt;") },
      A4Router: { isActive: (route) => route === activeRoute },
      A4Cloud: {
        isLoggedIn: () => loggedIn,
        fetchAnnouncements: async () => {
          calls.fetches += 1
          return result
        },
        markAnnouncementsRead: async (ids) => calls.markedRead.push([...ids]),
      },
    },
  }
  sandbox.window.window = sandbox.window
  vm.createContext(sandbox)
  vm.runInContext(read("js/ui/announcements.js"), sandbox)
  return { A4Announcements: sandbox.window.A4Announcements, calls, appended }
}

const UNREAD_RESULT = {
  success: true,
  unreadIds: [7, "x"],
  announcements: [{ id: 7, title: "<b>Hi</b>", content: "line1\nline2", createdAt: "2026-10-01", isUnread: true }],
}

describe("shared announcement controller", () => {
  it("opens unread announcements with neutral motion and escaped content", async () => {
    const { A4Announcements, calls, appended } = loadAnnouncements({ result: UNREAD_RESULT })
    const controller = A4Announcements.createAnnouncementController({ route: "study" })
    await controller.check()
    assert.equal(appended.length, 1)
    assert.equal(appended[0].id, "announcementModal")
    const list = appended[0].querySelector("#announcementList")
    assert.match(list.innerHTML, /&lt;b&gt;Hi&lt;\/b&gt;/)
    assert.match(list.innerHTML, /line1<br \/>line2/)
    assert.match(list.innerHTML, /formatted:2026-10-01/)
    assert.equal(calls.visible.at(-1).visible, true)
    assert.equal(calls.visible.at(-1).options.motion, "neutral")
  })

  it("marks only valid unread ids as read when dismissed", async () => {
    const { A4Announcements, calls } = loadAnnouncements({ result: UNREAD_RESULT })
    const controller = A4Announcements.createAnnouncementController({ route: "study" })
    await controller.check()
    await controller.dismiss()
    assert.deepEqual(calls.markedRead.map((ids) => [...ids]), [[7]])
    assert.equal(calls.visible.at(-1).visible, false)
  })

  it("skips fetching while another route is active or the user is logged out", async () => {
    const inactive = loadAnnouncements({ activeRoute: "settings", result: UNREAD_RESULT })
    await inactive.A4Announcements.createAnnouncementController({ route: "records" }).check()
    assert.equal(inactive.calls.fetches, 0)

    const loggedOut = loadAnnouncements({ loggedIn: false, result: UNREAD_RESULT })
    await loggedOut.A4Announcements.createAnnouncementController({ route: "study" }).check()
    assert.equal(loggedOut.calls.fetches, 0)
  })

  it("hides an open announcement on logout without marking it read", async () => {
    const { A4Announcements, calls } = loadAnnouncements({ result: UNREAD_RESULT })
    const controller = A4Announcements.createAnnouncementController({ route: "study" })
    await controller.check()
    controller.handleAuthChanged(false)
    assert.equal(calls.visible.at(-1).visible, false)
    assert.deepEqual(calls.markedRead, [])
  })

  it("uses per-view element ids so both views can own a modal", async () => {
    const { A4Announcements, appended } = loadAnnouncements({ activeRoute: "records", result: UNREAD_RESULT })
    await A4Announcements.createAnnouncementController({ route: "records", idPrefix: "recordsAnnouncement" }).check()
    assert.equal(appended[0].id, "recordsAnnouncementModal")
    assert.match(appended[0].innerHTML, /id="recordsAnnouncementList"/)
  })
})
