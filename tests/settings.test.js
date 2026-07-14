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

function createInteractiveElement(id) {
  const attributes = new Map()
  const classes = new Set()
  const listeners = new Map()
  return {
    id,
    hidden: false,
    tabIndex: -1,
    focusCount: 0,
    classList: {
      contains(name) { return classes.has(name) },
      toggle(name, force) {
        if (force) classes.add(name)
        else classes.delete(name)
      },
    },
    setAttribute(name, value) { attributes.set(name, String(value)) },
    getAttribute(name) { return attributes.get(name) ?? null },
    addEventListener(type, listener) { listeners.set(type, listener) },
    dispatch(type, event = {}) { listeners.get(type)?.(event) },
    focus() { this.focusCount += 1 },
  }
}

function getCategoryPanelMarkup(panelId, nextPanelId) {
  const startToken = `<section class="settings-category-panel" id="${panelId}"`
  const start = settingsCode.indexOf(startToken)
  assert.notEqual(start, -1, `${panelId} should exist`)
  if (!nextPanelId) return settingsCode.slice(start)
  const end = settingsCode.indexOf(
    `<section class="settings-category-panel" id="${nextPanelId}"`,
    start + startToken.length
  )
  assert.notEqual(end, -1, `${nextPanelId} should follow ${panelId}`)
  return settingsCode.slice(start, end)
}

function assertAccordionGroups(markup, expectedLabels, openLabels) {
  const groups = [...markup.matchAll(/<details class="settings-accordion-card[^"]*"[^>]*>\s*<summary>([^<]+)<\/summary>/g)]
  assert.deepEqual(groups.map((match) => match[1]), expectedLabels)
  assert.deepEqual(
    groups.filter((match) => /\sopen(?:\s|>)/.test(match[0])).map((match) => match[1]),
    openLabels
  )
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
      /function open\(\)\s*\{[\s\S]*?setAccountStatsExpanded\(shouldExpandAccountStatsByDefault\(accountStatsWideQuery\)\)[\s\S]*?render\(\)/
    )
  })

  it("keeps secondary statistics expanded when matchMedia is unavailable", () => {
    const settings = loadSettingsHelpers()
    assert.equal(typeof settings.shouldExpandAccountStatsByDefault, "function")
    assert.equal(settings.shouldExpandAccountStatsByDefault({ matches: false }), false)
    assert.equal(settings.shouldExpandAccountStatsByDefault({ matches: true }), true)
    assert.equal(settings.shouldExpandAccountStatsByDefault(null), true)
    assert.equal(settings.shouldExpandAccountStatsByDefault(undefined), true)
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

describe("A4Settings responsive category navigation", () => {
  it("renders five accessible top-level categories in the approved order", () => {
    const navigation = settingsCode.match(
      /<div class="settings-category-tabs" role="tablist" aria-label="设置类别">([\s\S]*?)<\/div>\s*<div class="modal-body">/
    )
    assert.ok(navigation)

    const tabs = [...navigation[1].matchAll(
      /<button class="settings-category-tab" id="([^"]+)" type="button" role="tab" aria-controls="([^"]+)" aria-selected="(true|false)" tabindex="(-?\d+)">([^<]+)<\/button>/g
    )]
    assert.deepEqual(tabs.map((match) => match[5]), ["账号", "学习", "发音", "AI", "更多"])
    assert.deepEqual(tabs.map((match) => match[1]), [
      "settingsTabAccount",
      "settingsTabLearning",
      "settingsTabPronunciation",
      "settingsTabAi",
      "settingsTabMore",
    ])
    assert.deepEqual(tabs.map((match) => match[2]), [
      "settingsPanelAccount",
      "settingsPanelLearning",
      "settingsPanelPronunciation",
      "settingsPanelAi",
      "settingsPanelMore",
    ])
    assert.deepEqual(tabs.map((match) => match[3]), ["true", "false", "false", "false", "false"])
    assert.deepEqual(tabs.map((match) => match[4]), ["0", "-1", "-1", "-1", "-1"])

    const panels = [...settingsCode.matchAll(
      /<section class="settings-category-panel" id="([^"]+)" role="tabpanel" aria-labelledby="([^"]+)"( hidden)?>/g
    )]
    assert.deepEqual(panels.map((match) => match[1]), tabs.map((match) => match[2]))
    assert.deepEqual(panels.map((match) => match[2]), tabs.map((match) => match[1]))
    assert.deepEqual(panels.map((match) => !!match[3]), [false, true, true, true, true])
  })

  it("maps every settings group into native non-exclusive accordion cards", () => {
    const account = getCategoryPanelMarkup("settingsPanelAccount", "settingsPanelLearning")
    const learning = getCategoryPanelMarkup("settingsPanelLearning", "settingsPanelPronunciation")
    const pronunciation = getCategoryPanelMarkup("settingsPanelPronunciation", "settingsPanelAi")
    const ai = getCategoryPanelMarkup("settingsPanelAi", "settingsPanelMore")
    const more = getCategoryPanelMarkup("settingsPanelMore")

    assert.match(account, /<section class="panel account-panel" id="accountPanel">/)
    assert.doesNotMatch(account, /settings-accordion-card/)
    assertAccordionGroups(learning, ["外观与目标", "复习节奏", "学习体验"], ["外观与目标"])
    assertAccordionGroups(pronunciation, ["发音方式", "离线语音包", "系统语音"], ["发音方式"])
    assertAccordionGroups(ai, ["模型配置", "生成参数"], ["模型配置"])
    assertAccordionGroups(more, ["联网补充", "数据管理", "版本信息"], ["联网补充"])

    for (const id of [
      "themeModeSelect", "dailyGoalRoundsInput", "dailyGoalWordsInput", "roundCapInput",
      "reviewSystemToggleBtn", "reviewIntervalsPanel", "reviewUnknownDaysInput",
      "reviewLearningDaysInput", "reviewMasteredDaysInput", "continuousStudyModeToggleBtn",
      "reviewCardFlipToggleBtn",
    ]) assert.match(learning, new RegExp(`id="${id}"`), `${id} should be in 学习`)

    for (const id of [
      "pronounceToggleBtn", "ttsModeSelect", "onlineTtsProviderRow", "onlineTtsProviderSelect",
      "onlineTtsPrivacyHint", "onlineTtsToggleBtn", "offlineTtsSection", "offlineTtsRefreshBtn",
      "offlineTtsList", "offlineTtsStatus", "accentSelect", "pronunciationLangSelect",
      "voiceModeSelect", "voiceManualRow", "voiceSelect", "currentVoiceText", "voiceHint", "testVoiceBtn",
    ]) assert.match(pronunciation, new RegExp(`id="${id}"`), `${id} should be in 发音`)

    for (const id of [
      "aiCustomConfigPanel", "aiProviderSelect", "aiBaseUrlInput", "aiApiKeyInput", "aiModelInput",
      "aiModelDatalist", "aiTypeSelect", "aiCustomTopicInput", "aiCountInput", "aiGenerateBtn", "aiStatus",
    ]) assert.match(ai, new RegExp(`id="${id}"`), `${id} should be in AI`)

    for (const id of [
      "lookupOnlineToggleBtn", "lookupOnlineSourceSelect", "lookupSpanishToggleBtn",
      "lookupCacheToggleBtn", "lookupCacheDaysInput", "exportBackupBtn", "importBackupBtn",
      "importBackupFile", "versionPanel", "versionText", "checkUpdateBtn", "updateStatus",
    ]) assert.match(more, new RegExp(`id="${id}"`), `${id} should be in 更多`)
  })

  it("activates categories on click and with wrapping arrow, Home, and End keys", () => {
    const settings = loadSettingsHelpers()
    assert.equal(typeof settings.installSettingsCategoryNavigation, "function")

    const panelIds = [
      "settingsPanelAccount",
      "settingsPanelLearning",
      "settingsPanelPronunciation",
      "settingsPanelAi",
      "settingsPanelMore",
    ]
    const tabs = panelIds.map((panelId, index) => {
      const tab = createInteractiveElement(`tab-${index}`)
      tab.setAttribute("aria-controls", panelId)
      return tab
    })
    const panels = panelIds.map((id) => createInteractiveElement(id))
    const scrollContainer = { scrollTop: 120 }
    const navigation = settings.installSettingsCategoryNavigation({ tabs, panels, scrollContainer })

    navigation.activate(0, { resetScroll: false })
    tabs[2].dispatch("click")
    assert.equal(scrollContainer.scrollTop, 0)
    assert.deepEqual(tabs.map((tab) => tab.getAttribute("aria-selected")), ["false", "false", "true", "false", "false"])
    assert.deepEqual(tabs.map((tab) => tab.tabIndex), [-1, -1, 0, -1, -1])
    assert.deepEqual(panels.map((panel) => panel.hidden), [true, true, false, true, true])

    const press = (index, key, expectedIndex) => {
      let prevented = false
      scrollContainer.scrollTop = 50
      tabs[index].dispatch("keydown", { key, preventDefault() { prevented = true } })
      assert.equal(prevented, true, `${key} should prevent native scrolling`)
      assert.equal(tabs[expectedIndex].getAttribute("aria-selected"), "true")
      assert.equal(tabs[expectedIndex].focusCount > 0, true)
      assert.equal(scrollContainer.scrollTop, 0)
    }

    press(2, "ArrowLeft", 1)
    press(1, "ArrowUp", 0)
    press(0, "ArrowRight", 1)
    press(1, "ArrowDown", 2)
    press(2, "End", 4)
    press(4, "ArrowRight", 0)
    press(0, "ArrowLeft", 4)
    press(4, "Home", 0)
  })

  it("resets to Account every time the dialog opens without runtime panel reordering", () => {
    assert.match(
      settingsCode,
      /function open\(\)\s*\{[\s\S]*?settingsNavigation\.activate\(0\)[\s\S]*?setModalVisible\(dom\.modal, true\)/
    )
    assert.doesNotMatch(settingsCode, /insertBefore\(accountPanel,\s*modalBody\.firstElementChild\)/)
  })

  it("uses a theme-aware segmented phone track and a two-column desktop layout", () => {
    assert.match(
      styleCode,
      /#settingsModal \.modal-panel\s*\{[^}]*width:\s*min\(94vw,\s*560px\)[^}]*max-width:\s*100%/s
    )
    assert.match(
      styleCode,
      /#settingsModal \.settings-category-tabs\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)[^}]*background:\s*var\(--card2\)/s
    )
    assert.match(styleCode, /#settingsModal \.settings-category-tab\s*\{[^}]*white-space:\s*nowrap/s)

    const selectedRule = styleCode.match(
      /#settingsModal \.settings-category-tab\[aria-selected="true"\]\s*\{([^}]*)\}/s
    )
    assert.ok(selectedRule)
    assert.match(selectedRule[1], /color-mix\([^;]*var\(--(?:card2|text|surfaceHover)\)/)
    assert.doesNotMatch(selectedRule[1], /(?:#fff(?:fff)?|\bwhite\b)/i)

    const focusRule = styleCode.match(
      /#settingsModal \.settings-category-tab:focus-visible\s*\{([^}]*)\}/s
    )
    assert.ok(focusRule)
    assert.match(focusRule[1], /outline:\s*2px\s+solid\s+var\(--text\)/)
    assert.match(focusRule[1], /outline-offset:\s*2px/)
    assert.doesNotMatch(focusRule[1], /box-shadow|(?:#fff(?:fff)?|\bwhite\b)/i)

    assert.match(
      styleCode,
      /@media \(min-width:\s*760px\)[\s\S]*?#settingsModal \.modal-panel\s*\{[^}]*width:\s*min\(94vw,\s*920px\)[^}]*max-width:\s*100%[^}]*\}[\s\S]*?#settingsModal \.settings-shell\s*\{[^}]*grid-template-columns:\s*\d+px\s+minmax\(0,\s*1fr\)[^}]*\}[\s\S]*?#settingsModal \.settings-accordion-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s
    )
  })
})
