const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const { describe, it } = require("node:test")
const assert = require("node:assert/strict")

const ROOT = path.join(__dirname, "..")
const updaterCode = fs.readFileSync(path.join(ROOT, "js", "updater.js"), "utf8")
const styleCode = fs.readFileSync(path.join(ROOT, "css", "style.css"), "utf8")

function loadUpdaterHelpers() {
  const window = {}
  window.window = window
  const sandbox = { console, setTimeout, window }
  vm.createContext(sandbox)
  vm.runInContext(updaterCode, sandbox)
  return window.A4Updater
}

describe("A4Updater release-note normalization", () => {
  it("turns Markdown and HTML-looking release text into clean list items", () => {
    const updater = loadUpdaterHelpers()
    const notes = updater.normalizeReleaseNotes(`
# 本次更新
- 修复同步状态
* <strong>提升</strong>启动速度
3. 改善 Android 下载提示
### Release notes
> 调整深色主题
`)

    assert.deepEqual(Array.from(notes), [
      "修复同步状态",
      "提升启动速度",
      "改善 Android 下载提示",
      "调整深色主题",
    ])
  })

  it("returns no more than four items and caps each item at 120 code units", () => {
    const updater = loadUpdaterHelpers()
    const notes = Array.from(updater.normalizeReleaseNotes([
      `- ${"优".repeat(121)}`,
      "- 第二项",
      "- 第三项",
      "- 第四项",
      "- 不应出现的第五项",
    ].join("\n")))

    assert.equal(notes.length, 4)
    assert.equal(notes[0].length, 120)
    assert.equal(notes[0].endsWith("…"), true)
    assert.deepEqual(notes.slice(1), ["第二项", "第三项", "第四项"])
  })

  it("accepts arbitrary input and uses one fallback item when nothing useful remains", () => {
    const updater = loadUpdaterHelpers()
    const expected = ["包含功能优化与问题修复。"]

    for (const value of [null, undefined, "", "<h1>本次更新</h1>\n---", Object.create(null)]) {
      assert.deepEqual(Array.from(updater.normalizeReleaseNotes(value)), expected)
    }
  })
})

describe("A4Updater compact update card", () => {
  it("builds a dedicated accessible card while preserving controller IDs and actions", () => {
    assert.match(updaterCode, /modal\.className = "modal hidden update-modal"/)
    assert.match(updaterCode, /panel\.className = "modal-panel update-card"/)
    assert.match(updaterCode, /panel\.setAttribute\("role", "dialog"\)/)
    assert.match(updaterCode, /panel\.setAttribute\("aria-modal", "true"\)/)
    assert.match(updaterCode, /panel\.setAttribute\("aria-labelledby", "updateTitle"\)/)
    assert.match(updaterCode, /panel\.setAttribute\("aria-describedby", "updateBody"\)/)
    assert.match(updaterCode, /title\.id = "updateTitle"[\s\S]*?title\.textContent = "发现新版本"/)
    assert.match(updaterCode, /subtitle\.className = "update-subtitle"/)
    assert.match(updaterCode, /closeBtn\.className = "ghost update-close"[\s\S]*?closeBtn\.textContent = "关闭"/)
    assert.match(updaterCode, /body\.className = "update-content"[\s\S]*?body\.id = "updateBody"/)
    assert.match(updaterCode, /skipBtn\.id = "updateSkipBtn"[\s\S]*?skipBtn\.textContent = "稍后提醒"/)
    assert.match(updaterCode, /downloadBtn\.id = "updateDownloadBtn"[\s\S]*?downloadBtn\.textContent = "前往更新"/)
    assert.match(updaterCode, /className = "update-version-current"/)
    assert.match(updaterCode, /className = "update-version-latest"/)
    assert.match(updaterCode, /sectionTitle\.textContent = "本次更新"/)
    assert.match(updaterCode, /className = "update-asset"/)
    assert.doesNotMatch(updaterCode, /\.style(?:\.|\[|\s*=)/)
  })

  it("renders remote release strings as text and never exposes resolved URLs as visible copy", () => {
    assert.doesNotMatch(updaterCode, /\.innerHTML\s*=/)
    assert.match(updaterCode, /normalizeReleaseNotes\(bodyHtml\)/)
    assert.match(updaterCode, /noteItem\.textContent = note/)
    assert.match(updaterCode, /latestVersionEl\.textContent = String\(version \|\| ""\)/)
    assert.match(updaterCode, /assetNameEl\.textContent = downloadFileName/)
    assert.doesNotMatch(updaterCode, /\.textContent\s*=\s*resolved(?:Release|Download)Url/)
    assert.doesNotMatch(updaterCode, /createTextNode\(\s*resolved(?:Release|Download)Url/)
  })

  it("keeps Android on the Release page and offers the distinct APK URL as an optional fallback", () => {
    assert.match(
      updaterCode,
      /m\._releaseUrl = platform === "android" \? \(releaseUrl \|\| downloadUrl\) : \(downloadUrl \|\| releaseUrl\)/
    )
    assert.match(
      updaterCode,
      /showDirectDownload = platform === "android" &&[\s\S]*?resolvedDownloadUrl !== resolvedReleaseUrl/
    )
    assert.match(updaterCode, /directDownloadBtn\.textContent = "备用下载"/)
    assert.match(updaterCode, /directDownloadBtn\.classList\.toggle\("hidden", !showDirectDownload\)/)
    assert.match(updaterCode, /openExternalUrl\(modal\._directDownloadUrl\)/)
  })
})

describe("A4Updater card styling", () => {
  it("uses scoped theme-aware CSS with a centered mobile layout", () => {
    const match = styleCode.match(
      /\/\* Update information card \*\/([\s\S]*?)\/\* End update information card \*\//
    )
    assert.ok(match, "update card CSS section should exist")
    const componentCss = match[1]
    const allowedVariables = new Set([
      "--card",
      "--card2",
      "--text",
      "--muted",
      "--border",
      "--border2",
      "--border3",
      "--surfaceHover",
      "--accent",
      "--accentText",
      "--shadowModal",
    ])

    assert.match(componentCss, /#updateModal \.update-card\s*\{[^}]*width:\s*min\([^;]*45\dpx\)/s)
    assert.match(componentCss, /#updateModal \.update-icon\s*\{[^}]*color-mix\(/s)
    assert.match(componentCss, /#updateModal \.update-asset\s*\{[^}]*background:\s*var\(--card2\)/s)
    assert.match(componentCss, /#updateModal \.update-asset-name\s*\{[^}]*overflow-wrap:\s*anywhere/s)
    assert.match(componentCss, /@media \(max-width:\s*480px\)[\s\S]*?#updateModal \.update-card/s)
    assert.match(componentCss, /@media \(max-width:\s*480px\)[\s\S]*?#updateModal \.update-actions button\s*\{[^}]*min-height:\s*44px/s)
    assert.doesNotMatch(componentCss, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i)

    for (const variable of componentCss.matchAll(/var\((--[\w-]+)/g)) {
      assert.equal(allowedVariables.has(variable[1]), true, `${variable[1]} is not an approved update-card variable`)
    }
  })
})
