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
const themeStyle = fs.readFileSync(path.join(ROOT, "css", "theme.css"), "utf8")
const shellStyle = fs.readFileSync(path.join(ROOT, "css", "shell.css"), "utf8")
const settingsStyle = readOptional("css/settings.css")
const recordsStyle = readOptional("css/records.css")
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

  it("moves lower-frequency study actions into one dismissible mobile menu", () => {
    assert.match(indexMarkup, /id="mobileMoreTools"/)
    assert.match(indexMarkup, /id="mobileMoreMenu"/)
    assert.match(indexMarkup, /class="mobile-more-tools mobile-only"/)
    for (const target of ["newRoundBtn", "lookupBtn", "importWordbookBtn", "toggleImmersiveBtn", "introBtn"]) {
      assert.match(indexMarkup, new RegExp(`data-action-target="${target}"`))
    }
    assert.match(shellStyle, /\.mobile-more-menu\s*\{[^}]*animation:\s*a4-menu-enter/s)
    assert.match(shellStyle, /\.desktop-tools-popover\s*\{[^}]*animation:\s*a4-menu-enter/s)
  })

  it("places Review and Meaning in a shared paper toolbar while keeping real action targets", () => {
    assert.match(indexMarkup, /class="paper-toolbar"/)
    assert.match(indexMarkup, /id="paperReviewBtn"/)
    assert.match(indexMarkup, /id="paperMeaningBtn"[^>]*aria-pressed="false"/)
    assert.match(appCode, /paperMeaningBtn\.setAttribute\("aria-pressed"/)
  })

  it("keeps a dedicated immersive exit action on the paper after the surrounding controls disappear", () => {
    assert.match(indexMarkup, /id="paperImmersiveExitBtn"[^>]*class="[^"]*paper-toolbar-action/)
    assert.match(appCode, /paperImmersiveExitBtn:\s*document\.getElementById\("paperImmersiveExitBtn"\)/)
    assert.match(appCode, /paperImmersiveExitBtn\?\.classList\.toggle\("hidden",\s*!appState\.immersiveMode\)/)
    assert.match(appCode, /paperImmersiveExitBtn\?\.addEventListener\("click",\s*toggleImmersiveMode\)/)
  })

  it("locks the Study viewport to vertical gestures without resizing the A4 paper", () => {
    assert.match(indexMarkup, /maximum-scale=1, user-scalable=no/)
    assert.match(sharedStyle, /html\s*\{[^}]*overflow-x:\s*clip[^}]*overscroll-behavior-x:\s*none/s)
    assert.match(sharedStyle, /body\.home-page\s*\{[^}]*overflow-x:\s*clip[^}]*touch-action:\s*pan-y[^}]*overscroll-behavior-x:\s*none/s)
    assert.match(shellStyle, /body\.home-page \.paper\s*\{[^}]*width:\s*456px[^}]*aspect-ratio:\s*210 \/ 297/s)
  })

  it("positions the shared lookup panel slightly above visual center", () => {
    assert.match(sharedStyle, /\.lookup-modal \.lookup-panel\s*\{[^}]*translate:\s*0\s+clamp\(-40px,\s*-4dvh,\s*-24px\)/s)
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

  it("suppresses the browser outline on programmatically focused route surfaces", () => {
    assert.match(
      shellStyle,
      /\[data-a4-route-focus\]:focus\s*\{[^}]*outline:\s*none/s
    )
  })

  it("keeps every Records workflow inside the task-first page shell", () => {
    assert.match(indexMarkup, /class="records-page-intro"/)
    assert.match(indexMarkup, /id="recordsToolsBtn"/)
    assert.match(indexMarkup, /id="recordsToolsMenu"/)
    assert.match(indexMarkup, /class="records-view-switch"/)
    assert.match(indexMarkup, /class="records-view-indicator"/)
    for (const id of [
      "recordsFocus",
      "viewRoundsBtn",
      "viewStatusBtn",
      "recordsLookupBtn",
      "exportCsvBtn",
      "printPdfBtn",
      "clearBtn",
      "rounds",
      "statusView",
    ]) {
      assert.match(indexMarkup, new RegExp(`id="${id}"`))
    }
    assert.doesNotMatch(indexMarkup, /records-controls-top/)
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
    assert.match(indexMarkup, /shell\.css[^>]+>[\s\S]*records\.css/)
    assert.match(indexMarkup, /records\.css[^>]+>[\s\S]*settings\.css/)
    assert.match(recordsMarkup, /theme\.css[^>]+>[\s\S]*shell\.css/)
    assert.match(shellStyle, /@media \(max-width:\s*700px\)/)
    assert.match(shellStyle, /\.app-dock-shell\s*\{/)
    assert.match(shellStyle, /\.mobile-more-menu\s*\{/)
    assert.match(shellStyle, /@media \(prefers-reduced-motion:\s*reduce\)/)
    assert.match(settingsStyle, /body\.settings-page \.settings-page-main/)
    assert.match(recordsStyle, /body\.records-page \.app\.records/)
  })

  it("shares motion tokens and safe-area behavior across focused page styles", () => {
    assert.match(sharedStyle, /--motion-ease-out:\s*cubic-bezier\(/)
    assert.match(sharedStyle, /--motion-duration-page:\s*300ms/)
    assert.match(settingsStyle, /prefers-reduced-motion[^]*\.settings-category-indicator[^}]*transition:\s*none\s*!important/s)
    assert.match(recordsStyle, /prefers-reduced-motion[^]*\.records-view-indicator[^}]*transition:\s*none\s*!important/s)
    assert.match(recordsStyle, /body\.records-page \.app\.records[^}]*env\(safe-area-inset-bottom\)/s)
    assert.match(themeStyle, /body\.theme-palette-paper/)
    assert.match(themeStyle, /body\.theme-palette-ocean/)
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
    assert.doesNotMatch(settingsStyle, /body\.settings-page #settingsModal \.modal-header/)
    assert.match(settingsStyle, /body\.settings-page #settingsModal \.settings-category-tabs\s*\{[^}]*top:\s*0/s)
    assert.match(shellStyle, /prefers-reduced-motion[^]*animation-duration:\s*1ms/s)
    assert.match(shellStyle, /prefers-reduced-motion[^]*\.settings-category-indicator\s*\{[^}]*transition:\s*none\s*!important/s)
    assert.match(shellStyle, /prefers-reduced-motion[^]*\.settings-category-panel\.settings-panel-enter-forward[^}]*animation:\s*none\s*!important/s)
  })

  it("keeps the five Settings categories on one liquid-glass track at every width", () => {
    assert.match(
      settingsStyle,
      /@media \(max-width:\s*759px\)\s*\{[^]*?body\.settings-page #settingsModal \.settings-category-tabs\s*\{[^}]*align-self:\s*stretch/s
    )
    assert.match(
      settingsStyle,
      /@media \(min-width:\s*760px\)\s*\{[^]*?#settingsModal \.settings-category-tabs\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)/s
    )
  })

  it("implements the approved no-header desktop A4 workspace", () => {
    assert.match(indexMarkup, /<body class="home-page"/)
    assert.doesNotMatch(indexMarkup, /<header class="app-header"/)
    assert.match(indexMarkup, /class="desktop-status-stack"/)
    assert.match(indexMarkup, /id="desktopToolsBtn"[^>]*aria-expanded="false"/)
    assert.match(indexMarkup, /id="desktopToolsPopover"/)
    assert.match(shellStyle, /@media \(min-width:\s*701px\)[^]*body\.home-page \.app\s*\{[^}]*justify-items:\s*center/s)
    assert.match(shellStyle, /@media \(min-width:\s*701px\)[^]*body\.home-page \.home-controls\s*\{[^}]*position:\s*fixed/s)
    assert.match(shellStyle, /@media \(min-width:\s*701px\)[^]*\.desktop-status-stack\s*\{[^}]*position:\s*fixed/s)
    assert.match(shellStyle, /@media \(min-width:\s*701px\)[^]*\.paper-toolbar\s*\{[^}]*display:\s*flex/s)
    assert.match(shellStyle, /body\.home-page \.paper\s*\{[^}]*width:\s*456px[^}]*max-width:\s*100%[^}]*aspect-ratio:\s*210 \/ 297/s)
  })

  it("renders Records and Settings as desktop page surfaces above the shared dock", () => {
    assert.doesNotMatch(indexMarkup, /<header class="app-header"/)
    assert.match(indexMarkup, /data-a4-view="records"[^]*class="records-page-intro"/)
    assert.match(indexMarkup, /id="recordsLookupBtn"[^>]*>查词<\/button>/)
    assert.match(recordsStyle, /body\.records-page \.app\.records\s*\{[^}]*width:\s*min\(100%,\s*1120px\)/s)
    assert.match(shellStyle, /@media \(min-width:\s*701px\)[^]*body\.settings-page \.settings-page-main\s*\{[^}]*padding-bottom:\s*96px/s)
  })

  it("keeps the dock glass interactive with drag, lift and velocity stretch", () => {
    assert.match(indexMarkup, /<script src="\.\/js\/ui\/dock-glass\.js\?v=20260825-2"><\/script>/)
    const dockGlassCode = fs.readFileSync(path.join(ROOT, "js", "ui", "dock-glass.js"), "utf8")
    assert.match(dockGlassCode, /A4DockGlass/)
    assert.match(dockGlassCode, /attachSlider/)
    assert.match(dockGlassCode, /--a4-dock-drag/)
    assert.match(dockGlassCode, /--a4-dock-shift/)
    assert.match(dockGlassCode, /A4Router\?\.navigate/)
    assert.match(dockGlassCode, /suppressedClick/)
    assert.match(shellStyle, /\.app-dock-nav\s*\{[^}]*touch-action:\s*pan-y[^}]*transform:\s*translateX\(var\(--a4-dock-shift/s)
    assert.match(shellStyle, /\.app-dock-nav\.is-dragging,\s*\.app-dock-nav\.is-dragging \.app-dock-indicator\s*\{[^}]*transition:\s*none/s)
    assert.match(shellStyle, /\.app-dock-indicator\s*\{[^}]*transform:\s*translate3d\(calc\(var\(--a4-dock-index\) \* 100% \+ var\(--a4-dock-drag, 0px\)\),\s*var\(--a4-dock-float, 0px\),\s*0\) scale\(var\(--a4-dock-lift/s)
    assert.match(shellStyle, /\.app-dock-nav\.is-lifting \.app-dock-indicator,[^}]*--a4-dock-lift:\s*1\.22/s)
    assert.match(shellStyle, /\.app-dock-nav\.is-lifting \.app-dock-indicator,[^}]*filter:\s*drop-shadow\(calc\(/s)
    assert.match(shellStyle, /\.app-dock-item\s*\{[^}]*-webkit-user-drag:\s*none/s)
    assert.match(dockGlassCode, /--a4-dock-sweep/)
    assert.match(dockGlassCode, /--a4-dock-dir/)
    assert.match(dockGlassCode, /--a4-dock-motion/)
  })

  it("renders drag-reactive glass optics on the dock and settings tabs", () => {
    const settingsStyle = fs.readFileSync(path.join(ROOT, "css", "settings.css"), "utf8")
    assert.match(
      shellStyle,
      /\.app-dock-nav::after\s*\{[^}]*calc\(46% \+ var\(--a4-dock-sweep, 0px\)\)[^}]*inset calc\(var\(--a4-dock-dir, 0\) \* \(7px \+ var\(--a4-dock-over, 0\) \* 9px\)\)[^}]*opacity:\s*var\(--a4-dock-glow, var\(--a4-dock-motion, 0\)\)/s
    )
    assert.match(shellStyle, /\.app-dock-nav\.is-lifting \.app-dock-indicator::after,\s*\.app-dock-nav\.is-dragging \.app-dock-indicator::after\s*\{\s*opacity:\s*1/s)
    assert.match(
      settingsStyle,
      /#settingsModal \.settings-category-tabs::after\s*\{[^}]*calc\(46% \+ var\(--a4-dock-sweep, 0px\)\)[^}]*opacity:\s*var\(--a4-dock-glow, var\(--a4-dock-motion, 0\)\)/s
    )
    assert.match(settingsStyle, /#settingsModal \.settings-category-tabs\.is-lifting \.settings-category-indicator::after,\s*#settingsModal \.settings-category-tabs\.is-dragging \.settings-category-indicator::after\s*\{\s*opacity:\s*1/s)
    for (const style of [shellStyle, settingsStyle]) {
      assert.match(style, /@media \(prefers-reduced-motion: reduce\)\s*\{[^]*?(::after|tabs::after),[^]*?display:\s*none/s)
    }
  })

  it("applies rubber-band limits and press feedback to the glass dock", () => {
    const dockGlassCode = fs.readFileSync(path.join(ROOT, "js", "ui", "dock-glass.js"), "utf8")
    const settingsStyle = fs.readFileSync(path.join(ROOT, "css", "settings.css"), "utf8")
    assert.match(dockGlassCode, /const overshoot = Math\.abs\(rawDrag\) - maxDrag/)
    assert.match(dockGlassCode, /classList\.toggle\("is-clamped", overshoot > 0 && maxDrag > 0\)/)
    assert.match(dockGlassCode, /setVar\("--a4-dock-over"/)
    assert.match(dockGlassCode, /setVar\("--a4-dock-glow"/)
    assert.match(shellStyle, /\.app-dock-nav\.is-lifting\s*\{[^}]*--a4-dock-press:\s*0\.988/s)
    assert.match(shellStyle, /\.app-dock-nav\.is-lifting \.app-dock-indicator,[^}]*--a4-dock-float:\s*-1\.5px/s)
    assert.match(shellStyle, /\.app-dock-nav\.is-clamped::after/)
    assert.match(settingsStyle, /#settingsModal \.settings-category-tabs\.is-lifting\s*\{[^}]*--a4-dock-press:\s*0\.988/s)
    assert.match(settingsStyle, /#settingsModal \.settings-category-tabs\.is-clamped::after/)
    for (const style of [shellStyle, settingsStyle]) {
      assert.match(style, /opacity:\s*var\(--a4-dock-glow, var\(--a4-dock-motion, 0\)\)/)
    }
  })

  it("cache-busts every changed shell asset", () => {
    const styleRevision = "20260802-1"
    for (const markup of [indexMarkup, recordsMarkup, settingsMarkup]) {
      assert.match(markup, new RegExp(`href="\\./css/style\\.css\\?v=${styleRevision}"`))
      assert.match(markup, new RegExp(`href="\\./css/theme\\.css\\?v=${styleRevision}"`))
      assert.match(markup, new RegExp(`href="\\./css/shell\\.css\\?v=20260825-2"`))
    }
    assert.match(indexMarkup, /href="\.\/css\/records\.css\?v=20260825-1"/)
    assert.match(indexMarkup, /href="\.\/css\/settings\.css\?v=20260825-8"/)
    const scriptRevisions = new Map([
      ["js/core/common.js", "20260802-1"],
      ["js/ui/layers.js", "20260802-1"],
      ["js/ui/router.js", "20260802-1"],
      ["js/ui/dock-glass.js", "20260825-2"],
      ["js/utils.js", "20260802-1"],
      ["js/speech.js", "20260802-1"],
      ["js/updater.js", "20260825-1"],
      ["js/settings.js", "20260825-4"],
      ["js/lookup.js", "20260802-1"],
      ["js/app.js", "20260802-1"],
      ["js/records.js", "20260825-1"],
      ["js/settings-page.js", "20260802-1"],
    ])
    for (const [script, revision] of scriptRevisions) {
      const escapedScript = script.replaceAll(".", "\\.")
      assert.match(indexMarkup, new RegExp(`src="\\./${escapedScript}\\?v=${revision}"`))
    }
  })
})
