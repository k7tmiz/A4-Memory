const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const { describe, it } = require("node:test")
const assert = require("node:assert/strict")

const ROOT = path.join(__dirname, "..")
const settingsCode = fs.readFileSync(path.join(ROOT, "js", "settings.js"), "utf8")
const styleCode = fs.readFileSync(path.join(ROOT, "css", "style.css"), "utf8")

function loadSettingsHelpers() {
  const document = {
    body: { appendChild() {} },
    getElementById() { return {} },
  }
  const window = {
    A4Speech: {},
    A4Storage: {},
    A4Utils: {},
    document,
  }
  window.window = window
  const sandbox = { console, document, window }
  vm.createContext(sandbox)
  vm.runInContext(settingsCode, sandbox)
  return window.A4Settings
}

describe("A4Settings compact account summary", () => {
  it("keeps three key statistics visible and groups secondary statistics behind a collapsed control", () => {
    const keyStatsStart = settingsCode.indexOf('class="account-summary-key-stats"')
    const detailsToggle = settingsCode.indexOf('id="accountStatsToggleBtn"')
    const detailsPanel = settingsCode.indexOf('id="accountStatsDetails"')

    assert.notEqual(keyStatsStart, -1)
    assert.notEqual(detailsToggle, -1)
    assert.notEqual(detailsPanel, -1)
    assert.ok(keyStatsStart < detailsToggle)
    assert.ok(detailsToggle < detailsPanel)

    for (const id of ["cloudWordsText", "cloudStreakText", "cloudCurrentRoundText"]) {
      const index = settingsCode.indexOf(`id="${id}"`)
      assert.ok(index > keyStatsStart && index < detailsToggle, `${id} should stay visible`)
    }

    for (const id of ["cloudRoundsText", "cloudTodayWordsText", "cloudTodayRoundsText", "cloudSessionText"]) {
      const index = settingsCode.indexOf(`id="${id}"`)
      assert.ok(index > detailsPanel, `${id} should be inside the secondary details panel`)
    }

    assert.match(
      settingsCode,
      /id="accountStatsToggleBtn"[^>]*aria-expanded="false"[^>]*aria-controls="accountStatsDetails"[^>]*>更多学习统计/
    )
    assert.match(settingsCode, /id="accountStatsDetails"[^>]*class="account-summary-details hidden"/)
  })

  it("toggles secondary statistics accessibly and chooses the default state from screen width", () => {
    assert.match(settingsCode, /accountStatsToggleBtn:\s*modal\.querySelector\("#accountStatsToggleBtn"\)/)
    assert.match(settingsCode, /accountStatsDetails:\s*modal\.querySelector\("#accountStatsDetails"\)/)
    assert.match(
      settingsCode,
      /function setAccountStatsExpanded\(expanded\)\s*\{[\s\S]*?setAttribute\("aria-expanded",\s*isExpanded \? "true" : "false"\)[\s\S]*?classList\.toggle\("hidden",\s*!isExpanded\)[\s\S]*?\}/
    )
    assert.match(
      settingsCode,
      /accountStatsToggleBtn\?\.addEventListener\("click",[\s\S]*?setAccountStatsExpanded\(!expanded\)[\s\S]*?\}/
    )
    assert.match(settingsCode, /matchMedia\("\(min-width:\s*431px\)"\)/)
    assert.match(
      settingsCode,
      /function open\(\)\s*\{[\s\S]*?setAccountStatsExpanded\(shouldExpandAccountStatsByDefault\(\)\)[\s\S]*?render\(\)/
    )
  })

  it("uses a compact three-column mobile summary and exposes all details on larger screens", () => {
    assert.match(
      styleCode,
      /\.account-summary-sync\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*auto\s+minmax\(0,\s*1fr\)/s
    )
    assert.match(
      styleCode,
      /\.account-summary-key-stats,\s*\.account-summary-secondary-stats\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s
    )
    assert.match(
      styleCode,
      /\.account-summary-details-toggle\s*\{[^}]*width:\s*100%[^}]*justify-content:\s*space-between/s
    )
    assert.match(
      styleCode,
      /@media \(min-width:\s*431px\)[\s\S]*?\.account-summary-details-toggle\s*\{[^}]*display:\s*none/s
    )
    assert.match(
      styleCode,
      /@media \(max-width:\s*430px\)[\s\S]*?\.account-summary-actions #cloudLogoutBtn\s*\{[^}]*border-color:\s*transparent/s
    )
  })

  it("updates the expanded state when the viewport crosses the phone breakpoint", () => {
    const settings = loadSettingsHelpers()
    assert.equal(typeof settings.listenForAccountStatsBreakpoint, "function")

    let listener = null
    let removedListener = null
    const mediaQuery = {
      addEventListener(type, callback) {
        assert.equal(type, "change")
        listener = callback
      },
      removeEventListener(type, callback) {
        assert.equal(type, "change")
        removedListener = callback
      },
    }
    const states = []
    const stopListening = settings.listenForAccountStatsBreakpoint(mediaQuery, (expanded) => {
      states.push(expanded)
    })

    listener({ matches: true })
    listener({ matches: false })
    assert.deepEqual(states, [true, false])

    stopListening()
    assert.equal(removedListener, listener)
  })
})
