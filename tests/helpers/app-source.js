/**
 * 学习视图源码加载辅助。
 *
 * 学习视图由 js/app/ 下的子模块与控制器 js/app.js 组成。
 * 针对源码文本的断言读取拼接后的整体源码，函数在子模块间移动时断言仍然有效。
 */
const fs = require("node:fs")
const path = require("node:path")

const ROOT = path.join(__dirname, "..", "..")

// 顺序必须与 index.html 中的 <script> 顺序一致
const APP_MODULE_FILES = [
  "js/app/wordbook-io.js",
  "js/app/study-helpers.js",
  "js/app/review-swipe.js",
  "js/app/paper-layout.js",
  "js/app/wordbook-manager.js",
]

function readStudyBundle() {
  return [...APP_MODULE_FILES, "js/app.js"]
    .map((relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8"))
    .join("\n")
}

module.exports = { ROOT, APP_MODULE_FILES, readStudyBundle }
