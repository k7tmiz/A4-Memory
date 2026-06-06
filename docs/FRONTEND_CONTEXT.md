# 前端架构文档

## 1. 项目结构

```
A4-Memory/
├── index.html              # 首页（主应用页面）
├── records.html            # 学习记录页
├── manifest.webmanifest   # PWA manifest
├── LICENSE
├── README.md
├── package.json            # Node 依赖（Vite + Tauri CLI）
├── vite.config.js          # Vite dev server 配置
├── assets/
│   ├── icon.svg
│   └── mask-icon.svg
├── css/
│   └── style.css
├── data/
│   └── words.js            # 内置词书（CET4 / CET6 / 西班牙语示例）
├── js/
│   ├── core/
│   │   ├── common.js      # 跨页共享纯业务逻辑
│   │   └── sanitize.js    # XSS 防护（HTML/属性转义）
│   ├── __cloud_stub.js    # cloud.js 占位（仅公开仓库构建时使用）
│   ├── app.js             # 首页控制器
│   ├── lookup.js          # 查词弹窗控制器
│   ├── records.js         # 记录页控制器
│   ├── settings.js        # 设置弹窗控制器
│   ├── speech.js          # 语音合成封装
│   ├── storage.js         # localStorage 读写封装
│   ├── updater.js         # GitHub 版本更新检测、平台安装包选择与通知
│   └── utils.js           # 文件下载与清洗工具
├── scripts/
│   └── build.mjs          # 生产构建脚本（复制文件到 dist/）
├── eslint.config.mjs      # ESLint 代码规范配置
├── src-tauri/             # Tauri 桌面端脚手架（Rust）
└── docs/
    └── ...                # 文档目录
```

**说明**：公开仓库不含 `js/cloud.js`；构建脚本会在缺失时使用 `js/__cloud_stub.js`，保证本地功能正常运行。

---

## 2. 私有可选模块

### `js/cloud.js`

可选私有模块（已列入 `.gitignore`），接入后端 API，为前端提供账号、云同步和在线发音代理兜底。

#### 职责

- 用户登录 / 邮箱验证码注册 / 重置密码
- 学习状态上传 / 下载（多设备同步）
- 系统公告接收
- 在线发音直连失败时的服务端代理兜底

#### 接入方式

1. 联系作者获取 `cloud.js`
2. 将文件放入 `js/` 目录
3. 无需修改 HTML，页面会自动加载

#### 无 cloud.js 时的行为

前端完全正常运行，所有本地功能不受影响：

- A4 学习与复习全流程
- 词书导入 / 在线词书
- 查词、发音、导出
- 设置（主题、复习、发音、AI 词书生成等）
- 本地备份导入 / 导出（JSON）

以下功能依赖 cloud.js，无此模块时按钮会显示错误提示但不崩溃：

- 设置中的"账号"区块（登录 / 注册 / 重置密码 / 登出）
- 设置中的"云备份"区块（仅登录后显示上传 / 下载）
- 系统公告弹窗（首页 / 记录页）

---

## 3. 页面与脚本加载顺序

### 首页（index.html）

```
index.html
  → data/words.js
  → js/core/common.js
  → js/core/sanitize.js
  → js/utils.js
  → js/storage.js
  → js/cloud.js              ← 可选私有模块
  → js/speech.js
  → js/updater.js
  → js/settings.js
  → js/lookup.js
  → js/app.js
```

### 记录页（records.html）

```
records.html
  → data/words.js
  → js/utils.js
  → js/storage.js
  → js/cloud.js              ← 可选私有模块
  → js/core/common.js
  → js/core/sanitize.js
  → js/speech.js
  → js/updater.js
  → js/settings.js
  → js/lookup.js
  → js/records.js
```

`cloud.js` 已在 HTML 中固定引用；缺失时浏览器会 404，但不影响其他脚本加载。

---

## 4. 模块职责

### `js/core/common.js`
跨页共享的纯逻辑模块，无 DOM 操作。主要业务规则源。
- 状态/轮次类型归一化（mastered / learning / unknown）
- `term + meaning + language` 级别的 key 计算
- 全局最新状态聚合与首次出现轮次聚合
- A4 分页、页数、页内计数、整轮去重
- 查词匹配评分与去重排序
- 时间格式化、日期 key、统计计算
- 通用 normalize 与默认设置
- 词库/单词归一化（`getWordsFromGlobal`、`getWordbooksFromGlobal`、`normalizeWordObject`）

### `js/core/sanitize.js`
XSS 防护模块，提供 HTML 和属性转义。记录页 CSV 导出时对释义/例句等内容调用 `escapeHtml` 清洗，防止恶意内容在导出文件中执行。
```javascript
window.A4Sanitize = {
  escapeHtml(value),   // HTML 转义（& < > " '）
  escapeAttr(value),   // 属性转义（" '）
}
```

### `js/storage.js`
`localStorage` 读写封装，暴露 `window.A4Storage`。写入时自动清除 `apiKey` 等敏感字段，防止旧版本数据或导入数据中的 API Key 被持久化到 localStorage。
```javascript
window.A4Storage = {
  STORAGE_KEY,         // "a4-memory:v1"
  loadState(),         // 返回解析后的 JSON 或 null；读取时清除 apiKey
  saveState(state),   // 序列化后写入 localStorage；写入时强制清除 apiKey
  readStateRaw(),      // alias for loadState
  writeStateRaw(state) // alias for saveState
}
```

### `js/utils.js`
```javascript
window.A4Utils = {
  sanitizeFilename(value),
  downloadTextFile({ filename, mime, content }),
  downloadJsonFile({ filename, data }),
  downloadBlob({ filename, blob }),
  installMobileTapGuard(el),   // 移动端 300ms 延迟兼容
}
```

### `js/speech.js`
语音合成封装。Web/桌面端使用 SpeechSynthesis；Android Tauri 端通过全局 Tauri invoke 调用原生 `a4_android_speak`。在线模式支持 Microsoft Edge TTS / Google Translate TTS，由 `onlineTtsEnabled` / `onlineTtsProvider` 控制；浏览器优先直连首选在线源，失败后依次尝试另一在线源、私有桥接层代理和系统语音。朗读文本不写入学习状态、备份或云同步数据。Tauri CSP 需放行 `wss:` 与 `media-src blob: https:`。
```javascript
window.A4Speech = {
  installSpeech({ onVoicesChanged }),
  getVoicesSorted(),
  getNativeSpeechLang({ pronunciationLang, wordbookLanguage, accent }),
  isAndroidTauriSpeech(),
  speak({ text, pronunciationEnabled, pronunciationLang, wordbookLanguage, accent, voiceMode, voiceURI, onlineTtsEnabled, onlineTtsProvider }),
  speakOnline(text, langTag, provider),    // 直接调用在线 TTS
  getLastSpeakResult(),                    // 最近一次实际使用的发音方式与在线源
  // ...
}
```

### `js/settings.js`
设置弹窗控制器，暴露 `window.A4Settings`：
```javascript
window.A4Settings = {
  createSettingsModalController({ getState, setState, persist, applyTheme, onAfterChange, getWordbookLanguage }),
  // AI 词书生成、备份导入导出、normalize 函数等
}
```

### `js/lookup.js`
查词弹窗控制器，暴露 `window.A4Lookup`：
```javascript
window.A4Lookup = {
  createLookupModalController({ getState, setState, persist, getWordbookLanguage }),
}
```
功能：本地词书检索、在线补充（MyMemory + dictionaryapi.dev）、西语动词变位、AI 补充、查词缓存、"加入当前轮"。

### `js/app.js`
首页控制器（UI 层，不含核心业务逻辑）。负责：
- A4 排版与单词放置
- 当前轮恢复
- 首页词书选择；Android 环境使用应用内底部面板，iOS/macOS/桌面浏览器保留原生 `<select>`
- 复习弹窗（swipe/drag 标记）
- 词书导入与在线词书导入
- 轮次推进与状态写回

### `js/records.js`
记录页控制器（UI 层）。负责：
- 轮次视图与状态视图切换
- 统计计算
- CSV/PDF 导出；PDF 会生成隐藏的 A4 打印输出层，桌面端走 Tauri WebView 打印权限，Android 端走原生打印桥接
- 轮次删除（确认弹窗使用 DOM 自定义 `showConfirmDialog`，不依赖原生 `window.confirm`，避免 Tauri WKWebView 对话框委托未实现导致返回 `undefined`）
- 跳转首页触发复习轮生成

### `js/updater.js`
GitHub Release 版本更新检测，暴露 `window.A4Updater`：
```javascript
window.A4Updater = {
  checkUpdate(),  // 返回 Promise<string>： "update"/"latest"/"error"/"skipped"/"cached"/"prerelease"
  openExternalUrl(url),
  selectReleaseDownloadUrl(release),
  APP_VERSION,
  isTauri(),
}
```
行为：
- `checkUpdate()` 返回 `Promise<string>`，解析值为 `"update"`（弹窗已展示）/ `"latest"`（已是最新）/ `"error"`（网络错误或 API 不可用）/ `"skipped"`（用户跳过此版本）/ `"cached"`（缓存未过期跳过）/ `"prerelease"`（忽略预发布版）。设置页按钮 `await` 此 Promise 直接判断结果，不再用固定 3 秒 `setTimeout` 猜测异步状态。
- 自动检查最新 GitHub Release，设置页"检查更新"会清除本地跳过/缓存后强制检查一次
- 从 `release.assets[].browser_download_url` 选择当前平台安装包：Android 优先识别 `a4-memory-v*-android.apk`，但主按钮打开 Release 页面并在弹窗中提示 APK 文件名，直链作为备用，避免部分 Android 下载器把 GitHub 重定向流保存为 `.bin`；macOS `.dmg`，Windows `.msi` / `.exe`，Linux `.AppImage` / `.deb`；未知平台打开 Release 页面，避免误下载第一个 asset
- Tauri 端通过 Rust 命令 `a4_open_external` 打开系统默认浏览器/下载处理器；Web 端使用 `window.open` / `location.href` 兜底

### Tauri 原生命令桥接

`src-tauri/src/lib.rs` 暴露最小平台能力：
- `a4_open_external(url)`：桌面端 / Android 打开系统默认浏览器或下载处理器。
- `a4_android_print()`：Android 端调用 WebView 原生打印接口。
- `a4_android_speak(text, lang)`：Android 端调用系统 TextToSpeech 引擎朗读；不内置离线语音包，不负责安装或切换第三方 TTS 引擎。

### 基础冒烟检查

- 词书导入：TXT、CSV、JSON 本地导入均应正常创建自定义词书并可选中。
- 学习流程：新增单词后自动复习弹窗应打开；记录页手动复习应可返回首页并打开复习弹窗。
- 安全渲染：导入词条中的 HTML 片段只能作为文本显示，不得生成真实 DOM 标签或触发脚本。
- 设置与记录：设置弹窗、备份导入导出入口、记录页 CSV/PDF 导出入口应可正常访问。

---

## 5. 设置界面结构

设置通过弹窗实现（无独立 settings.html）。由 `js/settings.js` 的 `createSettingsModalController` 构建并管理。

### 设置弹窗分区

设置界面分为以下七大功能区：

1. **学习** — 整合外观（主题模式）、学习目标（每日轮次/单词）、学习设置（每轮上限）、以及轻量复习配置（复习间隔、翻面、持续背书）。
2. **发音** — 朗读开关、发音方式（在线 TTS / 系统语音）和在线发音源。选择在线 TTS 时自动隐藏多余的本地语音选择器。
3. **AI 制卡** — 服务商选择、API 配置、模型选择、词书生成。
4. **联网补充** — 联网补充开关、查词来源、西语变位开关、缓存时长。
5. **账号** — 登录、注册、重置密码、登录状态卡片与云同步（上传/下载数据）。
6. **数据管理** — 完整本地备份导出/导入（JSON）。
7. **版本信息** — 检查更新、版本号展示。

---

## 6. localStorage 数据结构

### 主状态键 `a4-memory:v1`

```javascript
{
  version: 2,

  // UI 状态
  showMeaning: boolean,
  immersiveMode: boolean,
  themeMode: "auto" | "light" | "dark",
  darkMode: boolean,

  // 轮次
  rounds: [{
    id: string,
    startedAt: ISO8601,
    finishedAt: ISO8601 | "",
    items: [{
      word: { term, pos, meaning, example, tags, lang },
      pos: { x, y },         // 0-1 归一化位置
      fontSize: string,
      createdAt: ISO8601,
      status: "mastered" | "learning" | "unknown",
      lastReviewedAt: ISO8601 | "",
      nextReviewAt: ISO8601 | "",
      pageIndex: number       // 0-indexed
    }],
    roundCap: number,         // 20-30
    type: "normal" | "review_mastered" | "review_learning" | "review_unknown" | "review_due",
    language: string
  }],
  currentRoundId: string,
  pendingReviewRoundId: string,
  pendingGenerateStatusKind: string,

  // 词书
  selectedWordbookId: string,
  customWordbooks: [{ id, name, description, language, words: [] }],

  // 学习设置
  roundCap: number,
  dailyGoalRounds: number,
  dailyGoalWords: number,

  // 复习设置
  reviewSystemEnabled: boolean,
  reviewIntervals: { unknownDays, learningDays, masteredDays },
  reviewAutoCloseModal: true,  // 兼容旧数据，运行时固定开启
  continuousStudyMode: boolean,
  reviewCardFlipEnabled: boolean,

  // 发音设置
  pronunciationEnabled: boolean,
  pronunciationAccent: "auto" | "us" | "gb",
  pronunciationLang: "auto" | "en" | "es" | "ja" | "ko" | "pt" | "fr" | "de" | "it" | "eo",
  voiceMode: "auto" | "manual",
  voiceURI: string,

  // AI 配置（apiKey 仅内存保留，不写入 localStorage / 备份文件 / 云端状态）
  aiConfig: { provider, baseUrl, apiKey, model },

  // 查词设置
  lookupOnlineEnabled: boolean,
  lookupOnlineSource: "builtin" | "custom",
  lookupLangMode: "auto" | "en" | "es",
  lookupSpanishConjugationEnabled: boolean,
  lookupCacheEnabled: boolean,
  lookupCacheDays: number,

  // 杂项
  unknownTerms: string[],
  currentCount: number
}
```

### 其他 localStorage 键

| 键名 | 内容 |
|------|------|
| `a4-memory:v1` | 主状态 JSON |
| `a4-memory:intro-seen:v1` | 布尔值，用法介绍弹窗是否已看过 |
| `a4-memory:lookup-cache:v1` | 查词在线补充缓存（TTL 控制） |
| `a4-memory:update-check:v1` | 版本检查缓存（`{ ts, releaseId }`） |
| `a4-memory:update-skip:v1` | 用户跳过的版本号 |
| `a4-memory:register-code-cooldown:v1` | 注册验证码发送冷却截止时间戳 |
| `a4-memory:reset-code-cooldown:v1` | 重置密码验证码发送冷却截止时间戳 |
| `a4-memory:cloud-sync-meta:v1` | 云同步元数据（最近同步时间等） |

---

## 7. 已知行为与限制

- 旧数据兼容：`item.pageIndex` 缺失时，导入/云恢复按该轮 `roundCap` 自动补分页；`round.type` 缺失时按 `normal` 处理
- `currentPageIndex` 是运行态，不写入 `localStorage`；刷新后默认回到当前轮第 1 页
- 备份导入和云恢复（`settings.js` 的 `normalizeImportedState`）会保留轮次类型、语言和页码；`aiConfig.apiKey` 始终清空
- 记录页监听 `storage` 事件，支持多标签页同步刷新显示
- 轮次删除确认弹窗使用 `records.js` 自定义的 `showConfirmDialog`，不依赖原生 `window.confirm`，避免 Tauri WKWebView 对话框委托未实现导致返回 `undefined`；设置页的云端恢复确认也使用自定义弹窗
