# PROJECT_CONTEXT — A4 Word Memory

## 1) 项目概览

本项目是一个纯静态背单词网页：以“一张 A4 纸为一轮”的方式随机排版单词，并用“每新增 1 词必须复习本轮全部词”的流程强化记忆。提供学习记录、导出/打印、词书导入、发音与设置管理，适配 iOS/iPadOS/macOS Safari 与 PWA 添加到桌面使用。

## 2) 技术架构

- 运行形态：纯静态（HTML/CSS/Vanilla JS），无构建工具、无服务端
- 数据：全部保存在浏览器 `localStorage`
- 发音：浏览器 SpeechSynthesis（按语言/口音/手动选择匹配语音）
- 打印：浏览器 `window.print()`；记录页会打开“仅 A4 内容”的打印窗口
- AI：兼容 OpenAI 风格 `chat/completions` 接口（用户自填 Base URL / Key / Model）

## 3) 当前项目结构

```text
A4-Memory
├── index.html
├── records.html
├── manifest.webmanifest
├── LICENSE
├── README.md
├── assets/
│   ├── icon.svg
│   └── mask-icon.svg
├── css/
│   └── style.css
├── data/
│   └── words.js
├── js/
│   ├── app.js
│   ├── records.js
│   ├── settings.js
│   ├── speech.js
│   ├── storage.js
│   └── utils.js
└── docs/
    ├── README.en.md
    └── PROJECT_CONTEXT.md
```

## 4) 核心模块职责

- `js/core/common.js`：跨页面共享的轻量公共逻辑（状态/轮次类型常量、时间格式、分页工具等）
- `js/app.js`：首页学习流程（取词、排版、复习弹窗、轮次推进、导入词书入口与管理、状态恢复/保存）
- `js/records.js`：学习记录页（轮次视图 + 状态视图、每轮统计、统一 CSV 导出、导出 PDF（1 轮 = 1 个 PDF，按 pageIndex 分页）、删除轮次、从记录页发起“复习本轮”）
- `js/settings.js`：设置弹窗系统（主题/目标/每轮上限/备份/AI 词书生成/发音 UI），在首页与记录页复用
- `js/speech.js`：发音系统（语言推断、voice 匹配评分、自动/手动模式、回退与提示、Speak 封装）
- `js/storage.js`：`localStorage` 数据管理（统一读写入口与 key）
- `js/utils.js`：通用工具（下载 JSON/文本/Blob、文件名清洗等）
- `data/words.js`：词书数据入口（暴露 `window.WORDBOOKS` / `window.WORDS`）
- `css/style.css`：全站 UI（A4 纸样式、弹窗、响应式、深色/沉浸、打印样式）

## 5) 页面关系

- `index.html`（首页）
  - 负责学习主流程与复习弹窗
  - “学习记录”跳转到 `records.html`
- `records.html`（学习记录页）
  - 视图切换：轮次视图（按轮查看）/ 状态视图（按已掌握/学习中/不会/待复习聚合）
  - 轮次视图：每轮展示单词总数、各状态数量、待复习数量、开始/完成时间
  - 状态视图：每个单词展示状态、来源轮次、上次/下次复习时间
  - 顶部入口：导出 CSV、导出 PDF
  - 单词状态显示以“全局最新状态”为准（跨轮次聚合，而不是只看该轮历史）
  - “复习本轮”通过写入 `pendingReviewRoundId` 后跳回首页，由首页自动打开复习弹窗
  - “设置”在本页直接打开设置弹窗（不跳转）

## 6) 设置系统

- UI 入口：两页共享“设置”弹窗（由 `js/settings.js` 注入/管理）
- 设置项覆盖：
  - 外观：主题模式（auto/light/dark）
  - 学习：每日目标、每轮上限
  - 复习：轻量复习系统开关、复习间隔（不会/学习中/已掌握）
  - 发音：开关、语言/口音、语音模式（自动/手动）与当前语音展示
  - 数据：导入/导出完整备份（学习记录 + 设置）
  - AI：配置与生成词书
- 状态写回：设置变更会调用 `persist()` 写入 `localStorage`，并通过回调通知页面做必要 UI 刷新

## 7) 发音系统

位置：`js/speech.js`

- 语言来源（优先级）：手动设置语言 > 当前词书 language > 默认 `en`
- 口音偏好（仅英语）：auto/us/gb，转为候选 tag（例如 `en-US`/`en-GB`）
- 语音模式：
  - Auto：按候选语言 tag + 评分规则挑选最合适 voice
  - Manual：按 `voiceURI` 选择；若当前设备不可用则自动回退到 Auto，并给出提示
- 降级策略：
  - 无语音/不支持 SpeechSynthesis：提示并安全失败
  - 找不到目标语言 voice：回退系统默认 voice，并提示“已降级”

## 8) 数据存储

位置：`js/storage.js`

- `localStorage` keys
  - `a4-memory:v1`：主状态（首页与记录页共用）
  - `a4-memory:intro-seen:v1`：用法介绍是否已读（首页用）
- 主状态（version=2）关注字段（摘要）
  - 轮次：`rounds`, `currentRoundId`
  - 复习跳转：`pendingReviewRoundId`
  - 学习偏好：`themeMode`, `immersiveMode`, `roundCap`, `dailyGoalRounds`, `dailyGoalWords`, `meaningVisible/showMeaning`
  - 轻量复习：`reviewSystemEnabled`, `reviewIntervals`（unknownDays/learningDays/masteredDays）
  - 发音：`pronunciationEnabled`, `pronunciationAccent`, `pronunciationLang`, `voiceMode`, `voiceURI`
  - 词书：`selectedWordbookId`, `customWordbooks`
  - AI 配置：`aiConfig`（仅本地保存）

- 单词学习状态字段（存于 `rounds[].items[]`）
  - `status`: `mastered | learning | unknown`（默认 unknown，旧数据缺省视为 unknown）
  - `lastReviewedAt`: ISO string（本轮复习标记后写入）
  - `nextReviewAt`: ISO string（启用轻量复习时按状态计算，用于“待复习”判断）
  - `pageIndex`: number（默认 0；用于“同一轮内多张 A4”分页）
- 轮次字段（存于 `rounds[]`）
  - `type`: `normal | review_mastered | review_learning | review_unknown | review_due`（旧数据缺省视为 normal）

- 跨页同步
  - 同一浏览器多标签页时，记录页会监听 `storage` 事件以实时刷新显示（例如首页复习标记后，记录页单词状态会立即更新）

## 11) Records 页：状态视图与导出规则（补充）

- 状态视图聚合逻辑（`records.js`）
  - 遍历 `rounds[].items[]`，按 term（忽略大小写）构建“最新记录”映射（最新 status / lastReviewedAt / nextReviewAt）
  - 额外构建“首次出现轮次”映射，用于展示来源轮次（第 N 轮）
  - “待复习”集合：当 `reviewSystemEnabled=true` 且 `nextReviewAt <= now` 时归入待复习分组
- 状态视图“生成一轮”
  - 点击后写入 `pendingGenerateStatusKind` 并跳转首页，由首页生成对应复习轮
- CSV 导出统一格式（`records.js`）
  - 列：轮次编号、轮次类型、单词、词性、释义、当前状态、开始时间、完成时间、上次复习时间、下次复习时间
  - 时间：统一纯文本 `YYYY-MM-DD HH:mm`
  - 当前状态/复习时间：以“全局最新状态映射”为准
- 打印 / 导出 PDF（`records.js`）
  - 全局：多轮导出时，每张 A4 占 1 页（跨轮次与分页）
  - 单轮：1 轮导出为 1 个 PDF 文件，PDF 内每张 A4 占 1 页
  - 实现：复用 A4 渲染能力，按 A4 页生成 PNG 并在打印窗口分页展示

## 12) 首页：多页 A4 翻页（补充）

- 普通学习轮：一轮 = 一张 A4（`pageIndex=0`）
- 状态生成轮：一轮可包含多张 A4（`pageIndex=0..N-1`）
- 首页渲染规则（`app.js`）
  - 只渲染 `pageIndex === currentPageIndex` 的 items
  - 当 `pageCount > 1` 时显示 Previous/Next 与页码（例如 `1 / 3`）

## 12) AI 设置：Provider 预设（补充）

- 设置项（`settings.js` / `app.js`）
  - `aiConfig.provider`: `openai | gemini | deepseek | siliconcloud | custom`
  - 选择 provider 后会填充/提示默认 Base URL 与常用 Model（仅在字段为空或仍为上一 provider 默认值时覆盖）
  - `aiConfig` 继续完整保存在 `localStorage`（仅本地）

## 9) AI 词书生成

位置：`js/settings.js`

- 接口：兼容 OpenAI 风格 `POST /v1/chat/completions`（支持用户填写已包含 `/v1` 或完整路径）
- 约束：提示模型输出“只输出合法 JSON”
- 处理流程：
  - 生成 → JSON 提取/解析 → 字段校验（term/pos/meaning 必填）→ 忽略大小写去重 → 预览弹窗 → 确认保存
- 保存位置：写入 `customWordbooks`，成为可选词书

## 10) 开发原则

- 保持纯静态：不引入框架与构建工具，确保 GitHub Pages 可直接部署
- 向后兼容优先：`localStorage` schema 变更需做兼容/归一化，避免数据丢失
- 单一来源：设置弹窗与核心规则尽量集中，避免跨页重复实现
- 低风险演进：优先小步重构与清晰拆分，避免“为模块化而模块化”
- 移动端优先：避免顶部区域固定宽度导致 iPhone Safari 溢出，使用可换行布局
