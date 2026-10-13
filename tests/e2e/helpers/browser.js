/**
 * 端到端测试浏览器驱动。
 *
 * 不引入额外依赖：用 Node 内置 http 提供静态文件，用内置 WebSocket 通过
 * Chrome DevTools Protocol 驱动本机 Chrome / Chromium。找不到浏览器时返回 null，
 * 由测试自行跳过。可用 CHROME_PATH 指定浏览器路径。
 */
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const http = require("node:http")
const { spawn, execFileSync } = require("node:child_process")

const ROOT = path.join(__dirname, "..", "..", "..")

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  ].filter(Boolean)
  for (const candidate of candidates) if (fs.existsSync(candidate)) return candidate
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    try {
      const found = execFileSync("which", [name], { encoding: "utf8" }).trim()
      if (found) return found
    } catch {
      // 继续尝试下一个候选
    }
  }
  return null
}

function startStaticServer(root = ROOT) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost")
    const filePath = path.normalize(path.join(root, decodeURIComponent(url.pathname)))
    if (!filePath.startsWith(root) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404)
      res.end("not found")
      return
    }
    res.writeHead(200, { "content-type": MIME[path.extname(filePath)] || "application/octet-stream" })
    fs.createReadStream(filePath).pipe(res)
  })
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` }))
  })
}

class Page {
  constructor(ws) {
    this.ws = ws
    this.nextId = 0
    this.pending = new Map()
    this.listeners = new Map()
    this.errors = []
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data)
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id)
        this.pending.delete(message.id)
        if (message.error) reject(new Error(`${message.error.message} (${message.error.code})`))
        else resolve(message.result)
        return
      }
      if (message.method === "Runtime.exceptionThrown") {
        const details = message.params.exceptionDetails
        this.errors.push(details.exception?.description || details.text)
      }
      for (const listener of this.listeners.get(message.method) || []) listener(message.params)
    })
  }

  send(method, params = {}) {
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  once(method) {
    return new Promise((resolve) => {
      const list = this.listeners.get(method) || []
      const listener = (params) => {
        this.listeners.set(method, (this.listeners.get(method) || []).filter((item) => item !== listener))
        resolve(params)
      }
      list.push(listener)
      this.listeners.set(method, list)
    })
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    }
    return result.result.value
  }

  async waitFor(expression, { timeout = 5000, interval = 50 } = {}) {
    const deadline = Date.now() + timeout
    let last
    while (Date.now() < deadline) {
      last = await this.evaluate(expression).catch((error) => error)
      if (last && !(last instanceof Error)) return last
      await sleep(interval)
    }
    throw new Error(`waitFor timed out: ${expression}${last instanceof Error ? ` (${last.message})` : ""}`)
  }

  async setViewport(width, height) {
    const mobile = width < 700
    await this.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile })
  }

  async goto(url) {
    const loaded = this.once("Page.loadEventFired")
    await this.send("Page.navigate", { url })
    await loaded
  }

  click(selector) {
    return this.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)})
      if (!el) throw new Error("missing element: ${selector.replaceAll('"', '\\"')}")
      el.click()
      return true
    })()`)
  }
}

async function launchBrowser() {
  const chromePath = findChrome()
  if (!chromePath) return null
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "a4-e2e-"))
  const chrome = spawn(
    chromePath,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--hide-scrollbars",
      "--remote-debugging-port=0",
      `--user-data-dir=${userDataDir}`,
      ...(process.env.CI ? ["--no-sandbox"] : []),
      "about:blank",
    ],
    { stdio: "ignore" },
  )
  const portFile = path.join(userDataDir, "DevToolsActivePort")
  const deadline = Date.now() + 15000
  while (!fs.existsSync(portFile) || !fs.readFileSync(portFile, "utf8").includes("\n")) {
    if (Date.now() > deadline) {
      chrome.kill()
      throw new Error("Chrome DevTools port not available")
    }
    await sleep(50)
  }
  const port = fs.readFileSync(portFile, "utf8").split("\n")[0].trim()
  const { server, origin } = await startStaticServer()
  const pages = []

  async function newPage() {
    const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json()
    const ws = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true })
      ws.addEventListener("error", reject, { once: true })
    })
    const page = new Page(ws)
    await page.send("Runtime.enable")
    await page.send("Page.enable")
    pages.push(page)
    return page
  }

  // 每个用例使用全新的本地存储，避免应用退出时回写的旧状态互相污染
  async function freshApp(page, { query = "", width = 1440, height = 900, skipIntro = true, state = null } = {}) {
    await page.setViewport(width, height)
    await page.goto("about:blank")
    await page.send("Storage.clearDataForOrigin", { origin, storageTypes: "local_storage" })
    await page.goto(`${origin}/manifest.webmanifest`)
    await page.evaluate(`(() => {
      localStorage.clear()
      ${skipIntro ? 'localStorage.setItem("a4-memory:intro-seen:v1", "1")' : ""}
      ${state ? `localStorage.setItem("a4-memory:v1", ${JSON.stringify(JSON.stringify(state))})` : ""}
    })()`)
    page.errors.length = 0
    await page.goto(`${origin}/index.html${query}`)
    await page.waitFor(`document.readyState === "complete" && !!window.A4Router`)
  }

  async function close() {
    for (const page of pages) page.ws.close()
    chrome.kill()
    server.close()
    await sleep(100)
    fs.rmSync(userDataDir, { recursive: true, force: true })
  }

  return { origin, newPage, freshApp, close }
}

module.exports = { launchBrowser, findChrome, sleep }
