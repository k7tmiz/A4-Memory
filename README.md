# A4 Memory（A4 纸记忆法背单词）

[English](./docs/README.en.md)

> **开源说明**：本仓库为前端开源项目，核心代码（`js/`、`css/`、`index.html` 等）完全开源。
> 后端服务（用户注册登录、云同步、管理后台）为私有闭源。
> `js/cloud.js` 云同步模块为私有模块，**不在公开仓库中**。
>
> **关于云同步**：公开仓库不含 `cloud.js`，源码构建无云同步功能。
> [GitHub Releases](https://github.com/k7tmiz/A4-Memory/releases) 中的桌面版和 Android 版通过 CI 注入了 cloud.js，**包含完整云同步功能**。

Demo：https://k7tmiz.com/words

一个纯前端背单词工具：把单词随机排在 A4 纸上作为学习载体，核心目标是打破列表式的背书模式。每新增 1 个单词都会自动打开复习弹窗；普通学习轮在多页时默认只复习当前页，只有主动点击"复习本轮"时才复习整轮全部页。项目支持学习记录、状态聚合、词书导入、查词、发音、导出与 AI 生成词书。

## 功能概览

- A4 随机排版：单词随机落点，尽量避免重叠
- 多页 A4：普通学习轮默认从 1 页开始，写满后可在同一轮追加第 2/3/... 页
- 复习弹窗：自动复习（新增单词后立即打开，新词固定在第一张）/ 手动复习（复习整轮所有页），支持滑动标记、点击翻面
- 状态系统：已掌握 / 学习中 / 不会
- 轻量复习：按状态计算复习时间，记录页可聚合"待复习"
- 轮次类型：普通学习轮 / 已掌握复习 / 学习中复习 / 不会复习 / 待复习
- 学习记录：轮次视图、状态视图、导出 CSV/PDF、生成复习轮；桌面端和 Android 端会调用系统打印/保存为 PDF
- 词书：内置 CET4 / CET6 / 西班牙语示例，支持 TXT/CSV/JSON 导入和 GitHub 在线导入
- 查词：本地优先、联网补充（MyMemory + dictionaryapi.dev）、西语动词变位、AI 补充
- 发音：Web 端使用 SpeechSynthesis；Android Tauri 端优先调用系统 TextToSpeech，支持 en/es/ja/ko/pt/fr/de/it/eo（需系统已安装或启用 TTS 引擎）
- 外观：释义显示/隐藏、沉浸模式、auto/light/dark 主题
- 备份：完整 JSON 导入/导出
- AI 生成词书：OpenAI / Gemini / DeepSeek / SiliconCloud / Custom
- 版本更新检测：自动检测 GitHub Release 新版本，桌面端会打开对应平台安装包，Android 端打开 Release 页面并提示点击 APK 文件

## 技术栈

| 组成部分 | 技术 |
|-----------|------|
| 前端 | 纯静态 HTML/CSS/Vanilla JS，无框架 |
| 桌面端 / Android | Tauri v2（Rust + WebView），与 Web 版共享前端代码 |
| 状态存储 | 浏览器 localStorage |
| 云同步 | 后端 API + JWT（私有模块 `js/cloud.js`） |
| AI 接入 | OpenAI 风格 chat/completions API |

## 项目结构

```
A4-Memory/
├── index.html              # 首页
├── records.html            # 学习记录页
├── css/style.css          # 样式
├── data/words.js          # 内置词书
├── js/
│   ├── core/common.js     # 跨页共享业务逻辑
│   ├── app.js             # 首页控制器
│   ├── lookup.js          # 查词控制器
│   ├── records.js         # 记录页控制器
│   ├── settings.js        # 设置控制器
│   ├── speech.js          # 语音合成
│   ├── storage.js         # localStorage 封装
│   ├── updater.js         # 版本更新检测
│   └── utils.js           # 下载工具
├── src-tauri/             # Tauri 桌面端（Rust）
├── scripts/               # 构建脚本
├── .github/workflows/     # CI / 自动发布
├── eslint.config.mjs      # ESLint 代码规范
├── package.json           # Node 依赖（Vite + Tauri CLI + ESLint）
└── docs/                  # 文档
```

**说明**：`js/cloud.js` 不在公开仓库中，属于可选私有模块（云同步功能）。桌面端构建时若本地存在 `cloud.js` 则自动打入 Tauri 应用。

## 跨平台应用（Tauri）

除 Web 版本外，本项目支持打包为 macOS / Windows / Linux 桌面应用及 Android APK（基于 Tauri v2）。

预编译安装包从 [GitHub Releases](https://github.com/k7tmiz/A4-Memory/releases) 下载，含完整云同步功能。

应用内"检查更新"会读取最新 GitHub Release，并按当前平台优先打开对应安装包：Android 打开 Release 页面并提示点击 `a4-memory-v*-android.apk`（弹窗内保留 APK 直链作为备用），macOS 打开 `.dmg`，Windows 打开 `.msi` / `.exe`，Linux 打开 `.AppImage` / `.deb`。Android 仍需按系统提示确认下载和安装。

```bash
# 安装依赖
npm install

# 开发模式（热更新）
npm run tauri dev

# 本地打包（不含 cloud.js，需自行放入 js/ 目录）
npm run tauri build
```

## 使用方式

### 直接使用

打开 Demo：https://k7tmiz.com/words

### 本地运行

```bash
cd A4-Memory
python3 -m http.server 8080
# 或使用 Vite dev server（支持热更新）：
npm run dev
# 代码检查：
npm run lint
```

打开：http://localhost:8080/ 或 http://localhost:5173/

## 数据与存储

### localStorage keys

| 键名 | 内容 |
|------|------|
| `a4-memory:v1` | 主状态 JSON（version: 2） |
| `a4-memory:intro-seen:v1` | 用法介绍弹窗已读标记 |
| `a4-memory:lookup-cache:v1` | 查词在线补充缓存 |

### 主状态摘要

- 轮次相关：`rounds`, `currentRoundId`, `pendingReviewRoundId`, `pendingGenerateStatusKind`
- UI：`showMeaning`, `immersiveMode`, `themeMode`, `darkMode`
- 学习设置：`roundCap`, `dailyGoalRounds`, `dailyGoalWords`
- 复习设置：`reviewSystemEnabled`, `reviewIntervals`, `continuousStudyMode`, `reviewCardFlipEnabled`
- 发音设置：`pronunciationEnabled`, `pronunciationAccent`, `pronunciationLang`, `voiceMode`, `voiceURI`
- 词书：`selectedWordbookId`, `customWordbooks`
- AI 配置：`aiConfig = { provider, baseUrl, apiKey, model }`（`apiKey` 仅内存保留，不写入 localStorage、备份文件或云端状态）
- 查词：`lookupOnlineEnabled`, `lookupOnlineSource`, `lookupLangMode`, `lookupSpanishConjugationEnabled`, `lookupCacheEnabled`, `lookupCacheDays`

## 云同步（可选，需私有模块）

云同步功能依赖后端 API 和 `js/cloud.js` 私有模块。启用后支持：
- 用户登录与邮箱验证码注册（账号在服务端独立管理）
- 登录后显示云端备份入口，支持学习状态上传/下载（多设备同步）
- 从云端恢复会覆盖当前浏览器本地学习数据，前端会先要求确认；建议恢复前先导出完整备份
- 云同步只保存学习状态与非敏感设置，不上传 AI API Key
- 登录云账号后会自动接收系统公告；同一账号每条公告只会弹出一次，最新公告显示在最上方

如需使用，请联系作者获取 `cloud.js`，放入 `js/` 目录即可。无需修改 HTML，页面会自动加载。

## 文档

| 文档 | 说明 |
|------|------|
| [docs/FRONTEND_CONTEXT.md](./docs/FRONTEND_CONTEXT.md) | 前端架构、模块、设置界面详解 |
| [docs/API.md](./docs/API.md) | 用户侧 API 参考（公开接口） |

## 联系方式

- GitHub：https://github.com/k7tmiz/A4-Memory
- Email：kcyx01@gmail.com
