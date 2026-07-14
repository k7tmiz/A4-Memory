const fs = require("node:fs")
const path = require("node:path")
const { describe, it } = require("node:test")
const assert = require("node:assert/strict")

const ROOT = path.join(__dirname, "..")

function readHtmlCsp(filename) {
  const html = fs.readFileSync(path.join(ROOT, filename), "utf8")
  const match = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/)
  assert.ok(match, `${filename} must declare a Content-Security-Policy`)
  return match[1]
}

describe("network endpoint security policy", () => {
  it("allows every fixed origin used by the public frontend", () => {
    const indexCsp = readHtmlCsp("index.html")
    const recordsCsp = readHtmlCsp("records.html")
    const tauriConfig = JSON.parse(
      fs.readFileSync(path.join(ROOT, "src-tauri", "tauri.conf.json"), "utf8")
    )
    const tauriCsp = tauriConfig.app.security.csp

    const sharedOrigins = [
      "https://api.mymemory.translated.net",
      "https://api.deepseek.com",
      "https://api.siliconflow.cn",
    ]
    for (const origin of sharedOrigins) {
      assert.match(indexCsp, new RegExp(origin.replaceAll(".", "\\.")))
      assert.match(recordsCsp, new RegExp(origin.replaceAll(".", "\\.")))
      assert.match(tauriCsp, new RegExp(origin.replaceAll(".", "\\.")))
    }

    const rawGithub = "https://raw.githubusercontent.com"
    assert.match(indexCsp, new RegExp(rawGithub.replaceAll(".", "\\.")))
    assert.match(tauriCsp, new RegExp(rawGithub.replaceAll(".", "\\.")))
  })
})

describe("private backend deployment filters", () => {
  const deployScriptPath = path.join(ROOT, "deploy-backend.sh")

  it("keeps the public environment template while excluding real environment files", {
    skip: !fs.existsSync(deployScriptPath),
  }, () => {
    const script = fs.readFileSync(deployScriptPath, "utf8")
    const includeExample = script.indexOf("--include='.env.example'")
    const excludeVariants = script.indexOf("--exclude='.env.*'")

    assert.notEqual(includeExample, -1)
    assert.notEqual(excludeVariants, -1)
    assert.ok(includeExample < excludeVariants, "the rsync include rule must precede the broad exclude")
  })
})
