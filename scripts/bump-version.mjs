// 一次改齐所有版本声明：npm run bump-version -- 3.1.0
// 只改版本号本身；CHANGELOG.md 与 release.yml 的「本次更新」仍需手动填写。
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CRATE_NAME = "a4-memory";

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const next = String(process.argv[2] || "").trim().replace(/^v/, "");
if (!/^\d+\.\d+\.\d+$/.test(next)) {
  fail("用法：npm run bump-version -- <主.次.修订>，例如 npm run bump-version -- 3.1.0");
}

const current = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
if (!/^\d+\.\d+\.\d+$/.test(String(current))) fail(`package.json 的当前版本无法识别：${current}`);
if (current === next) fail(`当前版本已经是 ${next}`);

const escaped = current.replaceAll(".", "\\.");

// 每项：文件、要替换的模式（必须恰好命中 expected 次）、替换结果
const targets = [
  {
    file: "package.json",
    pattern: new RegExp(`("name": "${CRATE_NAME}",\\s*"private": true,\\s*"version": ")${escaped}(")`),
    expected: 1,
  },
  {
    file: "package-lock.json",
    pattern: new RegExp(`("name": "${CRATE_NAME}",\\s*"version": ")${escaped}(")`, "g"),
    expected: 2,
  },
  {
    file: join("src-tauri", "Cargo.toml"),
    pattern: new RegExp(`(\\[package\\]\\s*name = "${CRATE_NAME}"\\s*version = ")${escaped}(")`),
    expected: 1,
  },
  {
    file: join("src-tauri", "Cargo.lock"),
    pattern: new RegExp(`(\\[\\[package\\]\\]\\s*name = "${CRATE_NAME}"\\s*version = ")${escaped}(")`),
    expected: 1,
  },
  {
    file: join("src-tauri", "tauri.conf.json"),
    pattern: new RegExp(`("version": ")${escaped}(")`),
    expected: 1,
  },
  {
    file: join("js", "updater.js"),
    pattern: new RegExp(`(APP_VERSION = ")${escaped}(")`),
    expected: 1,
  },
  {
    // Release 工作流在发版时校验发布说明里的 Android 安装包文件名
    file: join(".github", "workflows", "release.yml"),
    pattern: new RegExp(`(a4-memory-v)${escaped}(-android\\.apk)`, "g"),
    expected: 1,
  },
];

// 先全部校验再写入，任何一处对不上都不留下改到一半的状态
const updates = targets.map(({ file, pattern, expected }) => {
  const source = readFileSync(join(ROOT, file), "utf8");
  const matches = source.match(new RegExp(pattern.source, "g")) || [];
  if (matches.length !== expected) {
    fail(`${file}：预期找到 ${expected} 处 ${current}，实际 ${matches.length} 处，未做任何修改`);
  }
  return { file, content: source.replace(pattern, `$1${next}$2`) };
});

for (const { file, content } of updates) {
  writeFileSync(join(ROOT, file), content);
  console.log(`  ✓ ${file}`);
}

console.log(`\n版本号 ${current} → ${next}。接下来：`);
console.log("  1. 在 CHANGELOG.md 顶部追加该版本的条目");
console.log("  2. 更新 .github/workflows/release.yml 中 releaseBody 的「本次更新」");
console.log("  3. 运行 npm run check");
