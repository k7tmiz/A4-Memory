/**
 * 主流程端到端测试：在真实浏览器中驱动 App Shell。
 * 运行：npm run test:e2e（找不到 Chrome / Chromium 时整体跳过）
 */
const { describe, it, before, after } = require("node:test")
const assert = require("node:assert/strict")
const { launchBrowser, findChrome } = require("./helpers/browser")

const isVisible = (id) => `!document.getElementById(${JSON.stringify(id)}).classList.contains("hidden")`
const isHidden = (id) => `document.getElementById(${JSON.stringify(id)}).classList.contains("hidden")`
const wordCount = `document.querySelectorAll("#paperInner .word-item").length`
const wordsOutsidePaper = `(() => {
  const paper = document.getElementById("paperInner").getBoundingClientRect()
  return [...document.querySelectorAll("#paperInner .word-item")].filter((el) => {
    const r = el.getBoundingClientRect()
    return r.left < paper.left - 0.5 || r.top < paper.top - 0.5 || r.right > paper.right + 0.5 || r.bottom > paper.bottom + 0.5
  }).length
})()`

describe("A4 Memory end-to-end", { skip: findChrome() ? false : "未找到 Chrome / Chromium" }, () => {
  let browser
  let page

  before(async () => {
    browser = await launchBrowser()
    page = await browser.newPage()
  })

  after(async () => {
    await browser?.close()
  })

  async function addWordAndCloseReview() {
    const before = await page.evaluate(wordCount)
    await page.click("#dockNextBtn")
    await page.waitFor(`${wordCount} === ${before + 1}`)
    await page.waitFor(isVisible("reviewModal"))
    await page.click("#closeReviewBtn")
    await page.waitFor(isHidden("reviewModal"))
  }

  it("opens the intro at the top on first visit and closes it", async () => {
    await browser.freshApp(page, { skipIntro: false })
    await page.waitFor(isVisible("introModal"))
    assert.equal(await page.evaluate(`document.activeElement?.id`), "closeIntroBtn")
    assert.equal(await page.evaluate(`document.querySelector("#introModal .modal-body").scrollTop`), 0)
    await page.click("#closeIntroBtn")
    await page.waitFor(isHidden("introModal"))
    assert.deepEqual(page.errors, [])
  })

  it("adds a word, auto-reviews it and keeps the status after reload", async () => {
    await browser.freshApp(page)
    await page.click("#dockNextBtn")
    await page.waitFor(`${wordCount} === 1`)
    await page.waitFor(isVisible("reviewModal"))
    await page.click("#reviewKnownBtn")
    await page.waitFor(isHidden("reviewModal"))
    await page.waitFor(`document.getElementById("roundStatusCounts").textContent.includes("已掌握 1")`)

    await page.goto(`${browser.origin}/index.html`)
    await page.waitFor(`${wordCount} === 1`)
    assert.match(await page.evaluate(`document.getElementById("roundStatusCounts").textContent`), /已掌握 1/)
    assert.deepEqual(page.errors, [])
  })

  it("keeps words inside the paper on a phone without horizontal overflow", async () => {
    await browser.freshApp(page, { width: 390, height: 844 })
    for (let i = 0; i < 12; i++) await addWordAndCloseReview()
    await page.click("#paperMeaningBtn")
    await page.waitFor(`document.querySelector(".paper").classList.contains("show-meaning")`)
    assert.equal(await page.evaluate(wordsOutsidePaper), 0)
    assert.equal(await page.evaluate(`document.documentElement.scrollWidth <= window.innerWidth`), true)
    assert.deepEqual(page.errors, [])
  })

  it("imports a CSV wordbook and selects it", async () => {
    await browser.freshApp(page)
    await page.evaluate(`(() => {
      const input = document.getElementById("importFile")
      const transfer = new DataTransfer()
      transfer.items.add(new File(["apple,n. 苹果\\nbanana,n. 香蕉\\ncherry,n. 樱桃"], "fruits.csv", { type: "text/csv" }))
      input.files = transfer.files
      input.dispatchEvent(new Event("change", { bubbles: true }))
    })()`)
    await page.waitFor(`document.getElementById("wordbookSelect").selectedOptions[0]?.textContent.includes("fruits")`)
    await page.click("#dockNextBtn")
    await page.waitFor(`["apple", "banana", "cherry"].includes(document.querySelector("#paperInner .word-item")?.dataset.term)`)
    assert.deepEqual(page.errors, [])
  })

  it("switches views through the dock and browser history", async () => {
    await browser.freshApp(page)
    const currentView = `document.body.dataset.a4CurrentView`
    await page.click('.app-dock-item[data-a4-route="records"]')
    await page.waitFor(`${currentView} === "records" && location.pathname.endsWith("/records.html")`)
    await page.click("#dockSettingsNav")
    await page.waitFor(`${currentView} === "settings" && location.pathname.endsWith("/settings.html")`)
    await page.evaluate(`history.back()`)
    await page.waitFor(`${currentView} === "records"`)
    await page.evaluate(`history.back()`)
    await page.waitFor(`${currentView} === "study"`)
    assert.equal(await page.evaluate(`document.querySelectorAll('[data-a4-view]:not([hidden])').length`), 1)
    assert.deepEqual(page.errors, [])
  })

  it("starts a round review from the records view", async () => {
    await browser.freshApp(page)
    await addWordAndCloseReview()
    await addWordAndCloseReview()
    await page.click('.app-dock-item[data-a4-route="records"]')
    await page.waitFor(`!!document.querySelector(".round-review-action")`)
    await page.click(".round-review-action")
    await page.waitFor(`document.body.dataset.a4CurrentView === "study"`)
    await page.waitFor(isVisible("reviewModal"))
    assert.deepEqual(page.errors, [])
  })

  it("persists the theme from settings and keeps the Google entry hidden", async () => {
    await browser.freshApp(page, { query: "?view=settings" })
    await page.waitFor(`!!document.getElementById("themeModeSelect")`)
    assert.equal(await page.evaluate(`document.getElementById("accountOauthEntry").offsetParent === null`), true)
    await page.evaluate(`(() => {
      const select = document.getElementById("themeModeSelect")
      select.value = "dark"
      select.dispatchEvent(new Event("change", { bubbles: true }))
    })()`)
    await page.waitFor(`document.body.classList.contains("theme-dark")`)
    await page.goto(`${browser.origin}/index.html`)
    await page.waitFor(`document.readyState === "complete" && document.body.classList.contains("theme-dark")`)
    assert.deepEqual(page.errors, [])
  })
})
