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
const lookupCode = fs.readFileSync(path.join(ROOT, "js", "lookup.js"), "utf8")
const routerCode = fs.readFileSync(path.join(ROOT, "js", "ui", "router.js"), "utf8")
const layersCode = fs.readFileSync(path.join(ROOT, "js", "ui", "layers.js"), "utf8")
const sharedStyle = fs.readFileSync(path.join(ROOT, "css", "style.css"), "utf8")
const shellStyle = fs.readFileSync(path.join(ROOT, "css", "shell.css"), "utf8")
const buildCode = fs.readFileSync(path.join(ROOT, "scripts", "build.mjs"), "utf8")

describe("responsive application shell", () => {
  it("keeps the three frequent destinations and Next Word in one shared dock", () => {
    assert.match(indexMarkup, /<nav class="app-dock-nav"[^>]*aria-label="主要导航"/)
    assert.equal((indexMarkup.match(/class="app-dock-shell"/g) || []).length, 1)
    assert.match(indexMarkup, /class="app-dock-indicator"[^>]*aria-hidden="true"/)
    assert.match(indexMarkup, /id="dockStudyNav"[^>]*data-a4-route="study"/)
    assert.match(indexMarkup, /href="\.\/records\.html"[^>]*data-a4-route="records"/)
    assert.match(indexMarkup, /href="\.\/settings\.html"[^>]*data-a4-route="settings"/)
    assert.match(indexMarkup, /id="dockSettingsNav"/)
    assert.match(indexMarkup, /id="dockNextBtn"[^>]*>[^]*下一个单词[^]*<\/button>/)
    assert.doesNotMatch(indexMarkup, /app-dock-shell[^>]*mobile-only/)
  })

  it("uses a roomy full-width mobile dock instead of compressing the destinations", () => {
    assert.match(shellStyle, /@media \(max-width:\s*700px\)[^]*?\.app-dock-shell\s*\{[^}]*bottom:\s*calc\(18px \+ env\(safe-area-inset-bottom\)\)[^}]*width:\s*min\(calc\(100vw - 16px\),\s*420px\)/s)
    assert.match(shellStyle, /\.app-dock-nav\s*\{[^}]*flex:\s*1 1 auto/s)
    assert.match(shellStyle, /\.app-dock-item\s*\{[^}]*flex:\s*1 1 0/s)
    assert.match(shellStyle, /\.app-dock-item span\s*\{[^}]*max-width:\s*none[^}]*opacity:\s*1/s)
    assert.doesNotMatch(shellStyle, /\.app-dock-shell\.is-secondary/)
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

  it("mounts Study, Records, and Settings inside one route stage", () => {
    assert.match(indexMarkup, /class="app-view-stage"[^>]*id="appViewStage"/)
    assert.match(indexMarkup, /<body class="home-page" data-a4-current-view="study">/)
    assert.doesNotMatch(indexMarkup, /<body[^>]*data-a4-view=/)
    for (const view of ["study", "records", "settings"]) {
      assert.match(indexMarkup, new RegExp(`data-a4-view="${view}"`))
    }
    assert.match(indexMarkup, /data-a4-view="records"[^]*id="recordsLookupBtn"/)
    assert.match(indexMarkup, /data-a4-view="settings"[^]*id="settingsPageMount"/)
  })

  it("routes every Settings entry to a dedicated route view instead of opening a modal", () => {
    assert.match(indexMarkup, /id="dockSettingsNav"/)
    assert.match(indexMarkup, /data-a4-route="settings"/)
    assert.doesNotMatch(appCode, /createSettingsModalController\(/)
    assert.doesNotMatch(recordsCode, /createSettingsModalController\(/)
    assert.match(settingsCode, /document\.getElementById\("settingsPageMount"\)/)
  })

  it("keeps Records and Settings URLs as CSP-safe compatibility entrypoints", () => {
    assert.match(recordsMarkup, /<body[^>]*data-a4-entry-view="records"/)
    assert.match(settingsMarkup, /<body[^>]*data-a4-entry-view="settings"/)
    assert.match(recordsMarkup, /<script src="\.\/js\/ui\/route-entry\.js(?:\?[^\"]*)?"/)
    assert.match(settingsMarkup, /<script src="\.\/js\/ui\/route-entry\.js(?:\?[^\"]*)?"/)
    assert.doesNotMatch(recordsMarkup, /app-dock-shell/)
    assert.doesNotMatch(settingsMarkup, /app-dock-shell/)
    assert.doesNotMatch(recordsMarkup, /<script(?![^>]*\bsrc=)[^>]*>/)
    assert.doesNotMatch(settingsMarkup, /<script(?![^>]*\bsrc=)[^>]*>/)
    assert.match(settingsPageCode, /presentation:\s*"page"/)
    assert.doesNotMatch(settingsPageCode, /returnView|navigateBack|onClose/)
    assert.doesNotMatch(settingsPageCode, /A4Router\?\.navigate|window\.location\.href/)
    assert.match(buildCode, /'settings\.html'/)
  })

  it("keeps every mounted control id unique", () => {
    const ids = Array.from(indexMarkup.matchAll(/\sid="([^"]+)"/g), (match) => match[1])
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index)
    assert.deepEqual(duplicates, [])
  })

  it("loads the isolated shell stylesheet after the shared theme tokens", () => {
    assert.match(indexMarkup, /theme\.css[^>]+>[\s\S]*shell\.css/)
    assert.match(recordsMarkup, /theme\.css[^>]+>[\s\S]*shell\.css/)
    assert.match(shellStyle, /@media \(max-width:\s*700px\)/)
    assert.match(shellStyle, /\.app-dock-shell\s*\{/)
    assert.match(shellStyle, /\.mobile-more-panel\s*\{/)
    assert.match(shellStyle, /@media \(prefers-reduced-motion:\s*reduce\)/)
  })

  it("defines directional view motion while the dock remains mounted", () => {
    assert.match(shellStyle, /@keyframes a4-view-enter-forward/)
    assert.match(shellStyle, /@keyframes a4-view-leave-back/)
    assert.match(shellStyle, /\.app-view\.a4-view-entering-forward[^}]*animation:\s*a4-view-enter-forward/s)
    assert.match(shellStyle, /\.app-view\.a4-view-leaving-back[^}]*animation:\s*a4-view-leave-back/s)
    assert.doesNotMatch(shellStyle, /body\.a4-page-leaving[^}]*app-dock-shell/)
    assert.match(sharedStyle, /\.modal\.a4-layer-closing\s+\.modal-backdrop/)
    assert.match(sharedStyle, /\.modal\.a4-layer-closing\s+\.modal-panel/)
  })

  it("slides one shared dock indicator and smoothly collapses Next Word off Study", () => {
    assert.match(shellStyle, /\.app-dock-indicator\s*\{[^}]*transition:[^}]*transform\s+320ms/s)
    assert.match(shellStyle, /data-active-view="records"[^}]*--a4-dock-index:\s*1/s)
    assert.match(shellStyle, /data-active-view="settings"[^}]*--a4-dock-index:\s*2/s)
    assert.match(shellStyle, /data-active-view="records"[^}]*app-next-action[^}]*flex-basis:\s*0/s)
    assert.match(shellStyle, /data-active-view="settings"[^}]*app-next-action[^}]*opacity:\s*0/s)
  })

  it("animates A4 page changes in their navigation direction", () => {
    assert.match(appCode, /renderCurrentRound\(\{ transition:\s*"back" \}\)/)
    assert.match(appCode, /renderCurrentRound\(\{ transition:\s*"forward" \}\)/)
    assert.match(shellStyle, /@keyframes a4-paper-page-forward/)
    assert.match(shellStyle, /\.paper-inner\.a4-paper-page-back/)
  })

  it("loads the router before all three route controllers", () => {
    assert.match(indexMarkup, /ui\/layers\.js[^]*ui\/motion\.js[^]*ui\/router\.js[^]*app\.js[^]*records\.js[^]*settings-page\.js/)
    assert.match(indexMarkup, /href="\.\/records\.html"[^>]*data-a4-route="records"/)
    assert.match(indexMarkup, /href="\.\/index\.html"[^>]*data-a4-route="study"/)
  })

  it("refreshes each mounted controller through the shared router lifecycle", () => {
    assert.match(appCode, /A4Router\?\.register\?\.\("study"/)
    assert.match(recordsCode, /A4Router\?\.register\?\.\("records"/)
    assert.match(settingsPageCode, /A4Router\?\.register\?\.\("settings"/)
    assert.match(appCode, /A4Router\?\.navigate\?\.\("settings",\s*\{ queue:\s*true \}\)/)
    assert.match(recordsCode, /A4Router\?\.navigate\?\.\("study",\s*\{ queue:\s*true \}\)/)
    assert.match(recordsCode, /getElementById\("recordsLookupBtn"\)/)
    assert.doesNotMatch(recordsCode, /window\.location\.href\s*=\s*"\.\/index\.html"/)
    assert.doesNotMatch(settingsPageCode, /window\.location\.assign\(/)
  })

  it("gives the active route sole ownership of unload persistence and global reactions", () => {
    assert.match(routerCode, /beforeunload[^]*invokeLifecycle\(currentView,\s*"exit"/)
    assert.match(routerCode, /pagehide[^]*invokeLifecycle\(currentView,\s*"exit"/)
    assert.doesNotMatch(appCode, /addEventListener\("(?:pagehide|beforeunload)"/)
    assert.doesNotMatch(settingsPageCode, /addEventListener\("pagehide"/)
    assert.match(appCode, /register\?\.\("study"[^]*exit:\s*persistNow/s)
    assert.match(settingsPageCode, /register\?\.\("settings"[^]*exit:\s*persist/s)
    assert.match(appCode, /themeMedia[^]*isActive\("study"\)/s)
    assert.match(appCode, /enterStudyView[^]*syncStudySystemTheme\(/s)
    assert.match(recordsCode, /themeMedia[^]*isActive\("records"\)/s)
    assert.match(settingsPageCode, /onSystemThemeChange[^]*isActive\("settings"\)/s)
    assert.match(appCode, /function isAnyModalOpen\(\)[^]*A4UI\?\.hasOpenLayer[^]*A4UI\.hasOpenLayer\(\)/s)
    assert.doesNotMatch(
      appCode.match(/function isAnyModalOpen\(\)\s*\{([^]*?)\n\}/)?.[1] || "",
      /settingsModal/
    )
  })

  it("uses one context-switching lookup controller and route-owned announcement work", () => {
    assert.match(lookupCode, /sharedLookupController/)
    assert.match(lookupCode, /setContext/)
    assert.match(appCode, /addWordToCurrentRound:\s*addWordToCurrentRoundFromLookup/)
    assert.doesNotMatch(appCode, /window\.A4AddWordFromLookup/)
    assert.doesNotMatch(recordsCode, /addWordToCurrentRound:/)
    assert.match(appCode, /a4-cloud-auth-changed[^]*isActive\("study"\)/s)
    assert.match(recordsCode, /a4-cloud-auth-changed[^]*isActive\("records"\)/s)
    assert.match(
      recordsCode,
      /setModalVisible\(ensureAnnouncementModal\(\),\s*true,\s*\{ motion:\s*"neutral" \}\)/
    )
  })

  it("cleans route-owned layers and the Records print preview during every router leave", () => {
    assert.match(routerCode, /A4UI\?\.closeAll\?\.\(\{ immediate:\s*true \}\)/)
    assert.match(layersCode, /function closeAll\(/)
    assert.match(recordsCode, /leave:\s*\(\)\s*=>\s*closePrintPreview\(\)/)
    assert.match(recordsCode, /activePrintPreviewTeardown/)
  })

  it("uses horizontal page and Settings panel motion without replaying a vertical Records entrance", () => {
    assert.doesNotMatch(shellStyle, /@keyframes a4-content-enter/)
    assert.doesNotMatch(shellStyle, /\.rounds:not\(\.hidden\)[^}]*animation/s)
    assert.match(shellStyle, /@keyframes a4-view-enter-forward[^}]*translate3d\(22px,\s*0,\s*0\)/s)
    assert.match(shellStyle, /@keyframes a4-view-enter-back[^}]*translate3d\(-22px,\s*0,\s*0\)/s)
    assert.match(shellStyle, /@keyframes settings-panel-enter-initial/)
    assert.match(shellStyle, /\.settings-category-panel\.settings-panel-enter-initial\s*\{[^}]*settings-panel-enter-initial/s)
    assert.match(shellStyle, /\.settings-category-panel\.settings-panel-enter-forward\s*\{[^}]*settings-panel-enter-forward/s)
    assert.match(shellStyle, /\.settings-category-panel\.settings-panel-enter-back\s*\{[^}]*settings-panel-enter-back/s)
    assert.doesNotMatch(shellStyle, /body\.settings-page #settingsModal \.modal-header/)
    assert.match(shellStyle, /body\.settings-page #settingsModal \.settings-category-tabs\s*\{[^}]*top:\s*0/s)
    assert.match(shellStyle, /prefers-reduced-motion[^]*animation-duration:\s*1ms/s)
    assert.match(shellStyle, /prefers-reduced-motion[^]*\.settings-category-indicator\s*\{[^}]*transition:\s*none\s*!important/s)
    assert.match(shellStyle, /prefers-reduced-motion[^]*\.settings-category-panel\.settings-panel-enter-forward[^}]*animation:\s*none\s*!important/s)
  })

  it("spreads the five Settings categories across the phone track while retaining the desktop rail", () => {
    assert.match(
      shellStyle,
      /@media \(max-width:\s*759px\)\s*\{[^]*?body\.settings-page #settingsModal \.settings-category-tabs\s*\{[^}]*align-self:\s*stretch/s
    )
    assert.match(
      sharedStyle,
      /@media \(min-width:\s*760px\)\s*\{[^]*?#settingsModal \.settings-category-tabs\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column/s
    )
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
    assert.doesNotMatch(indexMarkup, /<header class="app-header"/)
    assert.match(indexMarkup, /data-a4-view="records"[^]*class="page-heading"/)
    assert.match(indexMarkup, /id="recordsLookupBtn"[^>]*>查词<\/button>/)
    assert.match(shellStyle, /@media \(min-width:\s*701px\)[^]*body\.records-page \.app\.records\s*\{[^}]*border-radius:\s*26px/s)
    assert.match(shellStyle, /@media \(min-width:\s*701px\)[^]*body\.settings-page \.settings-page-main\s*\{[^}]*padding-bottom:\s*96px/s)
  })

  it("cache-busts every changed shell asset", () => {
    const styleRevision = "20260720-1"
    for (const markup of [indexMarkup, recordsMarkup, settingsMarkup]) {
      assert.match(markup, new RegExp(`href="\\./css/style\\.css\\?v=${styleRevision}"`))
      assert.match(markup, new RegExp(`href="\\./css/shell\\.css\\?v=${styleRevision}"`))
    }
    const scriptRevisions = new Map([
      ["js/core/common.js", "20260720-3"],
      ["js/ui/layers.js", "20260720-3"],
      ["js/ui/router.js", "20260720-2"],
      ["js/utils.js", "20260720-3"],
      ["js/lookup.js", "20260720-3"],
      ["js/app.js", "20260720-3"],
      ["js/records.js", "20260720-2"],
      ["js/settings-page.js", "20260720-2"],
    ])
    for (const [script, revision] of scriptRevisions) {
      const escapedScript = script.replaceAll(".", "\\.")
      assert.match(indexMarkup, new RegExp(`src="\\./${escapedScript}\\?v=${revision}"`))
    }
  })
})
