import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CRATE_NAME = "a4-memory";

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function readJson(relativePath) {
  try {
    return JSON.parse(readFileSync(join(ROOT, relativePath), "utf8"));
  } catch (error) {
    fail(`无法读取或解析 ${relativePath}: ${error.message}`);
  }
}

function readText(relativePath) {
  try {
    return readFileSync(join(ROOT, relativePath), "utf8");
  } catch (error) {
    fail(`无法读取 ${relativePath}: ${error.message}`);
  }
}

const pkg = readJson("package.json");
if (!pkg.version) fail("package.json 缺少 version 字段");
const expected = pkg.version;

// 每项：[描述文件位置, 提取到的版本或 null]
const results = [];
function record(label, value) {
  results.push({ label, value });
}

record("package.json", expected);

const lock = readJson("package-lock.json");
record("package-lock.json (.version)", lock.version ?? null);
record('package-lock.json (packages[""])', lock.packages?.[""]?.version ?? null);

const cargoToml = readText(join("src-tauri", "Cargo.toml"));
const cargoTomlMatch = cargoToml.match(/^\s*version\s*=\s*"([^"]+)"/m);
record("src-tauri/Cargo.toml [package]", cargoTomlMatch ? cargoTomlMatch[1] : null);

const cargoLock = readText(join("src-tauri", "Cargo.lock"));
let cargoLockVersion = null;
const cargoLockBlocks = cargoLock.split("[[package]]");
for (const block of cargoLockBlocks) {
  const name = block.match(/name\s*=\s*"([^"]+)"/);
  if (name && name[1] === CRATE_NAME) {
    const version = block.match(/version\s*=\s*"([^"]+)"/);
    if (version) cargoLockVersion = version[1];
    break;
  }
}
record(`src-tauri/Cargo.lock (${CRATE_NAME})`, cargoLockVersion);

const tauriConf = readJson(join("src-tauri", "tauri.conf.json"));
record("src-tauri/tauri.conf.json", tauriConf.version ?? null);

const updater = readText(join("js", "updater.js"));
const updaterMatch = updater.match(/APP_VERSION\s*=\s*"([^"]+)"/);
record("js/updater.js APP_VERSION", updaterMatch ? updaterMatch[1] : null);

console.log(`以 package.json 版本 ${expected} 为基准：\n`);
let ok = true;
for (const { label, value } of results) {
  if (value === expected) {
    console.log(`  ✓ ${label} = ${value}`);
  } else {
    ok = false;
    console.error(`  ✗ ${label} = ${value === null ? "(未找到)" : value}`);
  }
}

if (!ok) {
  console.error("\n版本声明不一致，请将以上各处统一后再发布。");
  process.exit(1);
}
console.log("\n六处版本声明全部一致。");
