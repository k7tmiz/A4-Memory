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
