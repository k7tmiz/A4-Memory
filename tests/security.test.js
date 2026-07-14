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

describe("release pipeline safety", () => {
  const workflowPath = path.join(ROOT, ".github", "workflows", "release.yml")
  const workflow = fs.readFileSync(workflowPath, "utf8")

  it("fails release builds instead of silently omitting the private cloud module", () => {
    const injectionBlocks = Array.from(
      workflow.matchAll(/- name: Inject cloud\.js from secret[\s\S]*?run: \|([\s\S]*?)(?=\n\s{6}- (?:name|run|uses):)/g),
      (match) => match[1]
    )

    assert.equal(injectionBlocks.length, 2)
    for (const block of injectionBlocks) {
      assert.match(block, /if \[ -z "\$CLOUD_JS_BASE64" \]/)
      assert.match(block, /exit 1/)
      assert.doesNotMatch(block, /using stub/i)
    }
  })

  it("requires the persistent Android release keystore", () => {
    assert.match(workflow, /ANDROID_KEYSTORE_BASE64 is required/)
    assert.doesNotMatch(workflow, /keytool -genkey/)
    assert.doesNotMatch(workflow, /temporary keystore/i)
  })

  it("preserves the Android init command exit status through tee", () => {
    const initBlock = workflow.match(
      /- name: Init Android project[\s\S]*?run: \|([\s\S]*?)(?=\n\s{6}- name:)/
    )
    assert.ok(initBlock)
    assert.match(initBlock[1], /set -o pipefail/)
    assert.match(initBlock[1], /INIT_EXIT=\$\{PIPESTATUS\[0\]\}/)
    assert.match(initBlock[1], /exit "\$INIT_EXIT"/)
  })

  it("validates the release tag against every application version entry", () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"))
    const packageLock = JSON.parse(fs.readFileSync(path.join(ROOT, "package-lock.json"), "utf8"))
    const tauriConfig = JSON.parse(
      fs.readFileSync(path.join(ROOT, "src-tauri", "tauri.conf.json"), "utf8")
    )
    const cargoToml = fs.readFileSync(path.join(ROOT, "src-tauri", "Cargo.toml"), "utf8")
    const cargoLock = fs.readFileSync(path.join(ROOT, "src-tauri", "Cargo.lock"), "utf8")
    const updater = fs.readFileSync(path.join(ROOT, "js", "updater.js"), "utf8")
    const versions = [
      packageJson.version,
      packageLock.version,
      packageLock.packages[""].version,
      cargoToml.match(/^version = "([^"]+)"/m)?.[1],
      cargoLock.match(/\[\[package\]\]\nname = "a4-memory"\nversion = "([^"]+)"/m)?.[1],
      tauriConfig.version,
      updater.match(/APP_VERSION = "([^"]+)"/)?.[1],
    ]

    assert.deepEqual(new Set(versions), new Set(["1.0.33"]))
    assert.match(workflow, /name: Validate release version/)
    assert.match(workflow, /GITHUB_REF_NAME#v/)
    assert.match(workflow, /Release tag and application versions do not match/)
  })
})
