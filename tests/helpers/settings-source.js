/**
 * 设置模块源码加载辅助。
 *
 * 设置实现按职责拆分在 js/settings/ 下，由门面 js/settings.js 组装。
 * 测试需要按与 index.html 相同的顺序拼接全部设置模块源码，
 * 才能同时在同一个 vm 沙箱里执行并保留针对源码文本的断言。
 */
const fs = require("node:fs")
const path = require("node:path")

const ROOT = path.join(__dirname, "..", "..")

// 顺序必须与 index.html 中的 <script> 顺序一致
const SETTINGS_MODULE_FILES = [
  "js/settings/state-normalize.js",
  "js/settings/ai.js",
  "js/settings/account.js",
  "js/settings/tts.js",
  "js/settings/dom.js",
  "js/settings/controller.js",
  "js/settings.js",
]

function readSettingsBundle() {
  return SETTINGS_MODULE_FILES
    .map((relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8"))
    .join("\n")
}

module.exports = { ROOT, SETTINGS_MODULE_FILES, readSettingsBundle }
