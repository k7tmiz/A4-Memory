const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const { describe, it } = require("node:test")
const assert = require("node:assert/strict")

const routeEntryPath = path.join(__dirname, "..", "js", "ui", "route-entry.js")

function runEntry(view, href = "https://example.test/app/records.html") {
  const code = fs.readFileSync(routeEntryPath, "utf8")
  const replacements = []
  const location = {
    href,
    replace(target) { replacements.push(String(target)) },
  }
  const document = { body: { dataset: { a4EntryView: view } } }
  const window = { document, location, URL }
  window.window = window

  vm.runInNewContext(code, { window, document, URL })
  return replacements
}

describe("route compatibility entry", () => {
  it("moves Records deep links into the persistent shell", () => {
    assert.deepEqual(runEntry("records"), ["https://example.test/app/index.html?view=records"])
  })

  it("moves Settings deep links into the persistent shell", () => {
    assert.deepEqual(
      runEntry("settings", "https://example.test/app/settings.html?from=records"),
      ["https://example.test/app/index.html?view=settings"]
    )
  })

  it("ignores unsupported entry names", () => {
    assert.deepEqual(runEntry("admin"), [])
  })
})
