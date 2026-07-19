const fs = require("node:fs")
const path = require("node:path")
const { describe, it } = require("node:test")
const assert = require("node:assert/strict")

const ROOT = path.join(__dirname, "..")
const readOptional = (filename) => {
  const target = path.join(ROOT, filename)
  return fs.existsSync(target) ? fs.readFileSync(target, "utf8") : ""
}
const indexMarkup = fs.readFileSync(path.join(ROOT, "index.html"), "utf8")
const recordsMarkup = fs.readFileSync(path.join(ROOT, "records.html"), "utf8")
const settingsMarkup = readOptional("settings.html")
const appCode = fs.readFileSync(path.join(ROOT, "js", "app.js"), "utf8")
const recordsCode = fs.readFileSync(path.join(ROOT, "js", "records.js"), "utf8")
const settingsCode = fs.readFileSync(path.join(ROOT, "js", "settings.js"), "utf8")
const settingsPageCode = readOptional("js/settings-page.js")
const sharedStyle = fs.readFileSync(path.join(ROOT, "css", "style.css"), "utf8")
const shellStyle = fs.readFileSync(path.join(ROOT, "css", "shell.css"), "utf8")
const buildCode = fs.readFileSync(path.join(ROOT, "scripts", "build.mjs"), "utf8")

describe("responsive application shell", () => {
  it("keeps the three frequent destinations and Next Word in one shared dock", () => {
    assert.match(indexMarkup, /<nav class="app-dock-nav"[^>]*aria-label="主要导航"/)
    assert.match(indexMarkup, /id="dockStudyNav"[^>]*aria-current="page"/)
    assert.match(indexMarkup, /href="\.\/records\.html"[^>]*class="app-dock-item"/)
    assert.match(indexMarkup, /href="\.\/settings\.html\?from=study"[^>]*class="app-dock-item"[^>]*id="dockSettingsNav"/)
    assert.match(indexMarkup, /id="dockNextBtn"[^>]*>[^]*下一个单词[^]*<\/button>/)
    assert.doesNotMatch(indexMarkup, /app-dock-shell[^>]*mobile-only/)
  })

  it("uses a roomy full-width mobile dock instead of compressing the destinations", () => {
    assert.match(shellStyle, /@media \(max-width:\s*700px\)[^]*?\.app-dock-shell\s*\{[^}]*width:\s*min\(calc\(100vw - 16px\),\s*420px\)/s)
    assert.match(shellStyle, /\.app-dock-nav\s*\{[^}]*flex:\s*1 1 auto/s)
    assert.match(shellStyle, /\.app-dock-item\s*\{[^}]*flex:\s*1 1 0/s)
    assert.match(shellStyle, /\.app-dock-item span\s*\{[^}]*max-width:\s*none[^}]*opacity:\s*1/s)
    assert.match(shellStyle, /\.app-dock-shell\.is-secondary\s*\{[^}]*width:\s*min\(calc\(100vw - 24px\),\s*360px\)/s)
  })

  it("moves lower-frequency study actions into one dismissible mobile sheet", () => {
    assert.match(indexMarkup, /id="mobileMoreModal"[^>]*aria-hidden="true"/)
    for (const target of ["newRoundBtn", "lookupBtn", "importWordbookBtn", "toggleImmersiveBtn", "introBtn"]) {
      assert.match(indexMarkup, new RegExp(`data-action-target="${target}"`))
    }
    assert.match(indexMarkup, /id="mobileMoreBackdrop"/)
  })

  it("places Review and Meaning in a shared paper toolbar while keeping real action targets", () => {
    assert.match(indexMarkup, /class="paper-toolbar"/)
    assert.match(indexMarkup, /id="paperReviewBtn"/)
    assert.match(indexMarkup, /id="paperMeaningBtn"[^>]*aria-pressed="false"/)
    assert.match(appCode, /paperMeaningBtn\.setAttribute\("aria-pressed"/)
  })

  it("gives the records page the same navigation shell with Records active", () => {
    assert.match(recordsMarkup, /class="app-dock-item active"[^>]*aria-current="page"[^>]*>[^]*记录/)
    assert.match(recordsMarkup, /href="\.\/settings\.html\?from=records"[^>]*class="app-dock-item"[^>]*id="dockRecordsSettingsNav"/)
  })

  it("routes every Settings entry to a standalone page instead of opening a modal", () => {
    assert.match(indexMarkup, /id="dockSettingsNav"[^>]*data-a4-page-transition/)
    assert.match(recordsMarkup, /id="dockRecordsSettingsNav"[^>]*data-a4-page-transition/)
    assert.doesNotMatch(appCode, /createSettingsModalController\(/)
    assert.doesNotMatch(recordsCode, /createSettingsModalController\(/)
    assert.match(settingsCode, /document\.getElementById\("settingsPageMount"\)/)
  })

  it("provides a dedicated Settings document with page navigation and build output", () => {
    assert.match(settingsMarkup, /<body class="settings-page"/)
    assert.match(settingsMarkup, /<main[^>]*id="settingsPageMount"/)
    assert.match(settingsMarkup, /class="app-dock-item active"[^>]*aria-current="page"[^>]*>[^]*设置/)
    assert.doesNotMatch(settingsMarkup, /app-dock-shell[^>]*mobile-only/)
    assert.match(settingsMarkup, /js\/settings\.js[^>]*>[\s\S]*js\/settings-page\.js/)
    assert.match(settingsPageCode, /presentation:\s*"page"/)
    assert.match(settingsPageCode, /from === "records"\s*\?\s*"\.\/records\.html"\s*:\s*"\.\/index\.html"/)
    assert.match(buildCode, /'settings\.html'/)
  })

  it("loads the isolated shell stylesheet after the shared theme tokens", () => {
    assert.match(indexMarkup, /theme\.css[^>]+>[\s\S]*shell\.css/)
    assert.match(recordsMarkup, /theme\.css[^>]+>[\s\S]*shell\.css/)
    assert.match(shellStyle, /@media \(max-width:\s*700px\)/)
    assert.match(shellStyle, /\.app-dock-shell\s*\{/)
    assert.match(shellStyle, /\.mobile-more-panel\s*\{/)
    assert.match(shellStyle, /@media \(prefers-reduced-motion:\s*reduce\)/)
  })

  it("defines matching enter and exit motion for pages, docks, and layers", () => {
    assert.match(shellStyle, /@keyframes a4-screen-exit/)
    assert.match(shellStyle, /@keyframes a4-dock-enter/)
    assert.match(shellStyle, /body\.a4-page-leaving[^}]*animation:\s*a4-screen-exit/s)
    assert.match(shellStyle, /body\.a4-page-leaving[^}]*app-dock-shell[^}]*a4-dock-exit/s)
    assert.match(sharedStyle, /\.modal\.a4-layer-closing\s+\.modal-backdrop/)
    assert.match(sharedStyle, /\.modal\.a4-layer-closing\s+\.modal-panel/)
  })

  it("routes mobile Study and Records navigation through the shared motion controller", () => {
    assert.match(indexMarkup, /href="\.\/records\.html"[^>]*data-a4-page-transition/)
    assert.match(recordsMarkup, /href="\.\/index\.html"[^>]*data-a4-page-transition/)
    assert.match(indexMarkup, /ui\/layers\.js[^]*ui\/motion\.js/)
    assert.match(recordsMarkup, /ui\/layers\.js[^]*ui\/motion\.js/)
  })

  it("softens settings and records content changes without animating reduced-motion users", () => {
    assert.match(shellStyle, /@keyframes a4-content-enter/)
    assert.match(shellStyle, /settings-category-panel:not\(\[hidden\]\)[^}]*a4-content-enter/s)
    assert.match(shellStyle, /\.rounds:not\(\.hidden\)[^}]*a4-content-enter/s)
    assert.match(shellStyle, /prefers-reduced-motion[^]*animation-duration:\s*1ms/s)
  })

  it("implements the approved no-header desktop A4 workspace", () => {
    assert.match(indexMarkup, /<body class="home-page"/)
    assert.doesNotMatch(indexMarkup, /<header class="app-header"/)
    assert.match(indexMarkup, /class="desktop-status-stack"/)
    assert.match(indexMarkup, /id="desktopToolsBtn"[^>]*aria-expanded="false"/)
    assert.match(indexMarkup, /id="desktopToolsPopover"/)
    assert.match(shellStyle, /@media \(min-width:\s*701px\)[^]*body\.home-page \.app\s*\{[^}]*grid-template-columns:\s*220px\s+minmax\(440px,\s*520px\)/s)
    assert.match(shellStyle, /@media \(min-width:\s*701px\)[^]*\.desktop-status-stack\s*\{[^}]*position:\s*fixed/s)
    assert.match(shellStyle, /@media \(min-width:\s*701px\)[^]*\.paper-toolbar\s*\{[^}]*display:\s*flex/s)
    assert.match(shellStyle, /body\.home-page \.paper\s*\{[^}]*width:\s*456px[^}]*max-width:\s*100%[^}]*aspect-ratio:\s*210 \/ 297/s)
  })

  it("renders Records and Settings as desktop page surfaces above the shared dock", () => {
    assert.doesNotMatch(recordsMarkup, /<header class="app-header"/)
    assert.match(recordsMarkup, /class="page-heading"/)
    assert.match(recordsMarkup, /id="lookupBtn"[^>]*>查词<\/button>/)
    assert.match(shellStyle, /@media \(min-width:\s*701px\)[^]*body\.records-page \.app\.records\s*\{[^}]*border-radius:\s*26px/s)
    assert.match(shellStyle, /@media \(min-width:\s*701px\)[^]*body\.settings-page \.settings-page-main\s*\{[^}]*padding-bottom:\s*96px/s)
  })
})
