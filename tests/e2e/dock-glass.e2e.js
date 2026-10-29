const { describe, it, before, after } = require("node:test")
const assert = require("node:assert/strict")
const { launchBrowser, findChrome } = require("./helpers/browser")

describe("dock drag boundaries", { skip: findChrome() ? false : "未找到 Chrome / Chromium" }, () => {
  let browser
  let page

  before(async () => {
    browser = await launchBrowser()
    page = await browser.newPage()
  })

  after(async () => { await browser?.close() })

  async function settle() {
    await page.evaluate(`Promise.all(document.querySelector(".app-dock-shell").getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {})))`)
  }

  async function startDrag(direction) {
    const geometry = await page.evaluate(`(() => {
      const nav = document.querySelector(".app-dock-nav")
      const active = nav.querySelector(".active").getBoundingClientRect()
      return { x: active.left + active.width / 2, y: active.top + active.height / 2, width: active.width }
    })()`)
    await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: geometry.x, y: geometry.y, button: "left", buttons: 1, clickCount: 1 })
    await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: geometry.x + direction * 12, y: geometry.y, button: "left", buttons: 1 })
    return geometry
  }

  async function moveDrag(geometry, delta) {
    await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: geometry.x + delta, y: geometry.y, button: "left", buttons: 1 })
    return page.evaluate(`(() => {
      const nav = document.querySelector(".app-dock-nav")
      return { drag: parseFloat(nav.style.getPropertyValue("--a4-dock-drag")), clamped: nav.classList.contains("is-clamped") }
    })()`)
  }

  async function release(geometry, delta) {
    await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: geometry.x + delta, y: geometry.y, button: "left", buttons: 0, clickCount: 1 })
  }

  for (const width of [390, 1440]) {
    for (const [index, view] of ["study", "records", "settings"].entries()) {
      for (const direction of [-1, 1]) {
        it(`limits ${view} dragging ${direction < 0 ? "left" : "right"} at ${width}px and settles on the endpoint`, async () => {
          await browser.freshApp(page, { width, query: `?view=${view}` })
          await page.waitFor(`document.body.dataset.a4CurrentView === ${JSON.stringify(view)}`)
          await settle()
          const geometry = await startDrag(direction)
          const result = await moveDrag(geometry, direction * 2000)
          const bound = (direction < 0 ? -index : 2 - index) * geometry.width
          const excess = (result.drag - bound) * direction
          assert.equal(result.clamped, true)
          assert.ok(excess > 0 && excess <= 8.01, `excess displacement: ${excess}px`)
          await release(geometry, direction * 2000)
          const expected = direction < 0 ? "study" : "settings"
          await page.waitFor(`document.body.dataset.a4CurrentView === ${JSON.stringify(expected)}`)
          await settle()
          assert.equal(await page.evaluate(`document.querySelector(".app-dock-nav").style.getPropertyValue("--a4-dock-drag")`), "0px")
          assert.equal(await page.evaluate(`document.querySelector(".app-dock-nav").classList.contains("is-clamped")`), false)
          assert.deepEqual(page.errors, [])
        })
      }
    }
  }

  it("tracks a reversal back to the start and suppresses the drag click", async () => {
    await browser.freshApp(page, { width: 390 })
    await settle()
    const geometry = await startDrag(-1)
    await moveDrag(geometry, -1000)
    const result = await moveDrag(geometry, 0)
    assert.equal(result.drag, 0)
    assert.equal(result.clamped, false)
    await release(geometry, 0)
    assert.equal(await page.evaluate(`document.body.dataset.a4CurrentView`), "study")
    // The next genuine tap must still navigate after the drag's own click is consumed.
    await page.tap("#dockSettingsNav")
    await page.waitFor(`document.body.dataset.a4CurrentView === "settings"`)
    assert.deepEqual(page.errors, [])
  })
})
