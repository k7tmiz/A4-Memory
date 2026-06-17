const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const { describe, it } = require("node:test")
const assert = require("node:assert/strict")

function loadSanitize() {
  const filePath = path.join(__dirname, "..", "js", "core", "sanitize.js")
  const code = fs.readFileSync(filePath, "utf8")
  const sandbox = { window: {} }
  sandbox.window.window = sandbox.window
  vm.createContext(sandbox)
  vm.runInContext(code, sandbox)
  return sandbox.window.A4Sanitize
}

const A4Sanitize = loadSanitize()

describe("A4Sanitize.escapeHtml", () => {
  it("escapes <script> tags", () => {
    const out = A4Sanitize.escapeHtml("<script>alert(1)</script>")
    assert.equal(out, "&lt;script&gt;alert(1)&lt;/script&gt;")
    assert.ok(!out.includes("<script>"))
  })

  it("escapes img onerror payload", () => {
    const out = A4Sanitize.escapeHtml('<img src=x onerror="alert(1)">')
    assert.ok(!out.includes("<img"))
    assert.ok(out.includes("&lt;img"))
    assert.ok(out.includes("&quot;"))
  })

  it("escapes ampersand first to avoid double encoding", () => {
    assert.equal(A4Sanitize.escapeHtml("&"), "&amp;")
    assert.equal(A4Sanitize.escapeHtml("&lt;"), "&amp;lt;")
  })

  it("escapes single and double quotes", () => {
    const out = A4Sanitize.escapeHtml(`"' onmouseover='x'`)
    assert.ok(!out.includes('"'))
    assert.ok(!out.includes("'"))
    assert.ok(out.includes("&quot;"))
    assert.ok(out.includes("&#x27;"))
  })

  it("handles nested tags and broken markup", () => {
    const out = A4Sanitize.escapeHtml("<<svg><script>alert(1)</script>")
    assert.ok(!out.includes("<svg>"))
    assert.ok(!out.includes("<script>"))
  })

  it("coerces non-string input", () => {
    assert.equal(A4Sanitize.escapeHtml(null), "")
    assert.equal(A4Sanitize.escapeHtml(undefined), "")
    assert.equal(A4Sanitize.escapeHtml(123), "123")
  })
})

describe("A4Sanitize.escapeAttr", () => {
  it("escapes attribute-breaking quotes", () => {
    const out = A4Sanitize.escapeAttr(`" onmouseover="alert(1)`)
    assert.ok(!out.startsWith('"'))
    assert.ok(out.includes("&quot;"))
  })

  it("escapes single quotes", () => {
    assert.equal(A4Sanitize.escapeAttr("a'b"), "a&#x27;b")
  })

  it("coerces non-string input", () => {
    assert.equal(A4Sanitize.escapeAttr(null), "")
  })
})
