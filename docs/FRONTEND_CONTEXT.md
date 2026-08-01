# 前端架构文档

当前发布基线为 `2.2.0`。应用版本由 `package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/tauri.conf.json` 与 `js/updater.js` 共同声明，发版前必须保持一致。

## 1. 项目结构

```
A4-Memory/
├── index.html              # 持久 App Shell（学习 / 记录 / 设置视图）
├── records.html            # 学习记录深链兼容入口
├── settings.html           # 设置深链兼容入口
├── manifest.webmanifest   # PWA manifest
├── LICENSE
├── README.md
├── package.json            # Node 依赖（Vite + Tauri CLI）
├── vite.config.js          # Vite dev server 配置
├── assets/
│   ├── icon.svg
│   └── mask-icon.svg
├── css/
│   ├── style.css          # 基础样式与组件
│   ├── theme.css          # 主题与配色变量
│   ├── shell.css          # 响应式页面壳层与交互动画
│   ├── records.css        # 记录概览、轮次/状态卡与按需预览
│   └── settings.css       # 设置仪表盘、分类导航与响应式布局
├── data/
│   └── words.js            # 内置词书（CET4 / CET6 / 西班牙语示例）
├── js/
│   ├── core/
│   │   ├── common.js      # 跨页共享纯业务逻辑
│   │   └── sanitize.js    # XSS 防护（HTML/属性转义）
│   ├── ui/
│   │   ├── layers.js      # 共享弹层栈、滚动锁与焦点管理
│   │   ├── motion.js      # 完整文档导航的兼容动效
│   │   ├── route-entry.js # 记录 / 设置深链入口
│   │   └── router.js      # App Shell 路由、生命周期与焦点/滚动恢复
│   ├── __cloud_stub.js    # cloud.js 占位（仅公开仓库构建时使用）
│   ├── app.js             # 学习视图控制器
│   ├── lookup.js          # 查词弹窗控制器
│   ├── records.js         # 记录视图控制器
│   ├── settings-page.js   # 设置视图状态与生命周期接线
│   ├── settings.js        # 设置界面与行为控制器
│   ├── speech.js          # 语音合成封装
│   ├── storage.js         # localStorage 读写封装
│   ├── updater.js         # GitHub 版本更新检测、平台安装包选择与通知
│   └── utils.js           # 文件下载与清洗工具
├── scripts/
│   ├── build.mjs          # 生产构建脚本（复制文件到 dist/，Android 构建时准备原生 TTS）
│   └── prepare-android-tts.mjs # 幂等安装 Android TTS AAR、桥接、Gradle 与 ProGuard 配置
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

`index.html` 是唯一的运行时 App Shell。学习、记录、设置三个视图在首次加载时完成挂载，内部导航由 `js/ui/router.js` 通过 History API 切换，不重复加载脚本或重建底栏。设置是一级 App Shell 路由，其页面呈现不使用弹窗式标题或返回头。非活动视图同时设置 `hidden`、`inert` 与 `aria-hidden="true"`；切换时调用视图的 `leave` / `enter` 生命周期，并恢复各视图的滚动位置和主内容焦点。浏览器前进/后退走同一条路由链路。页面退出时只有活动视图接收 `exit` 生命周期，非活动控制器不会用旧的完整状态快照覆盖存储。

App Shell 按 `css/style.css → css/theme.css → css/shell.css → css/records.css → css/settings.css` 加载样式。基础组件、主题变量、响应式壳层与聚焦页面样式保持单向覆盖关系；`records.css` 只负责记录概览、轮次/状态卡和按需 A4 预览，`settings.css` 只负责设置仪表盘与分类布局。学习、记录、设置共用一个 `.app-dock-shell`：移动端距视口底部 18px（另加安全区），选中态由同一个滑动胶囊承载；离开学习视图时「下一个单词」平滑收起，导航区同步扩展。有方向的视图切换、分类切换、详情展开和 A4 翻页动效在 `prefers-reduced-motion: reduce` 下停用。

学习视图纸面使用 `.paper-toolbar` 承载复习与释义切换。宽度达到 701px 时，A4 纸面在视口水平居中；左侧词书/工具与右侧轮次进度相对纸面两侧固定排布。手机端低频工具收在 `.mobile-more-tools` 下拉菜单（与记录页 `.records-tools` 同构），桌面端使用 `.desktop-tools-popover`；两者与记录工具菜单共用 `a4-menu-enter` 弹出动效。查词弹窗由 `js/lookup.js` 构建为 `.lookup-modal`，采用圆形关闭钮与搜索行布局；词书选择底部面板为 `.wordbook-picker-panel`。

### App Shell（index.html）

```
index.html
  → data/words.js
  → js/core/common.js
  → js/ui/layers.js
  → js/ui/motion.js
  → js/ui/router.js
  → js/core/sanitize.js
  → js/utils.js
  → js/storage.js
  → js/cloud.js              ← 可选私有模块
  → js/speech.js
  → js/updater.js
  → js/settings.js
  → js/lookup.js
  → js/app.js
  → js/records.js
  → js/settings-page.js
```

`records.html` 与 `settings.html` 是 CSP 兼容的深链入口，只加载样式和 `js/ui/route-entry.js`，分别使用 `location.replace()` 进入 `index.html?view=records|settings`。App Shell 启动后通过 `replaceState` 规范化为 `records.html` 或 `settings.html` 的整洁地址；站内带 `data-a4-route` 的入口不经过该重定向。

`cloud.js` 只在 App Shell 中固定引用；缺失时浏览器会 404，但不影响其他脚本加载。

---

## 4. 模块职责

### `js/core/common.js`
跨页共享的纯逻辑模块，以业务规则为主；`setModalVisible` 负责把既有调用转交给 `A4UI`，并在共享弹层模块缺失时提供兼容降级。
- UUID / 随机 ID 生成（`makeUuid`，含 `crypto.randomUUID` 降级）
- 数值约束（`clamp`）
- 状态/轮次类型归一化（mastered / learning / unknown）
- `term + meaning + language` 级别的 key 计算
- 全局最新状态聚合与首次出现轮次聚合
- A4 分页、页数、页内计数、整轮去重
- 当前轮次缺失时保留历史轮次并追加新轮次（`ensureCurrentRoundState`）
- 查词匹配评分与去重排序
- 时间格式化、日期 key、统计计算
- 通用 normalize 与默认设置
- 系统主题偏好缓存与活动视图应用判定（`syncSystemThemePreference`）
- 词库/单词归一化（`getWordsFromGlobal`、`getWordbooksFromGlobal`、`normalizeWordObject`）

### `js/ui/layers.js`
共享弹层控制器，暴露 `window.A4UI`。标准入口为 `setLayerVisible(layer, visible, { trigger, motion })`：`trigger` 保存实际触发元素与可用矩形；`motion: "origin"` 从来源控件展开并在关闭时按同一路径返回，`"sheet"` 自面板高度方向滑入（用于词书选择等底部面板，不从顶部触发点飞入），`"neutral"` 用于没有用户来源的自动弹层。它维护可嵌套的弹层栈，只允许最上层响应 `Escape` 和焦点循环；首个弹层打开时冻结并隔离页面，最后一个弹层关闭时恢复原滚动位置与触发控件焦点。动画可被快速反向、中断或立即清理，并在来源消失、Web Animations API 不可用或系统要求减少动态效果时安全降级。首页弹窗、查词、设置页内确认/预览、确认框、公告和 Android 下拉面板均通过该入口管理。学习页手机「更多工具」与记录页工具菜单使用页面内 `details` 下拉，不进入弹层栈。路由切换按从顶层到底层的顺序向弹层所有者发送 `a4-layer-dismiss`，由所有者执行取消、请求中止、Promise 收敛和 DOM 清理，再同步收尾所有已打开或正在退出的共享弹层；批量收尾不恢复旧焦点，由目标视图独占最终焦点。

### `js/ui/router.js`
持久 App Shell 路由器，暴露 `window.A4Router`。它负责学习、记录、设置三个视图的 History API 地址、单一底栏状态、过渡方向、焦点/滚动恢复和视图生命周期。`isActive(view)` 是常驻控制器处理主题媒体查询、鉴权事件和异步结果时的活动所有权判断；`exit` 只在文档退出时分派给当前视图。动画执行期间到达的 `popstate` 会排队到当前切换结束，避免快速返回导致地址与可见视图不一致。

```javascript
window.A4Router = {
  createRouter(options),
  navigate(view, options),
  register(view, { enter, leave, exit }),
  isActive(view),
  resolveView(value),
  hrefForView(view),
  getCurrentView(),
  start(),
}
```

### `js/ui/route-entry.js`
记录与设置深链兼容入口。它只读取 `body[data-a4-entry-view]`，将 `records.html` / `settings.html` 原地址替换为 App Shell 的 `?view=` 启动地址，不承载业务状态或页面控制器。

### `js/ui/motion.js`
完整文档导航的兼容动效。App Shell 内部路由由 `A4Router` 处理；仅在路由器不可用且控制器退回普通页面地址时使用该模块。

### `js/core/sanitize.js`
输出安全模块，提供 HTML、属性转义和 CSV 公式前缀中和。记录页 CSV 导出对所有单元格调用 `escapeCsvFormula`，避免导入词书中的公式前缀被电子表格软件执行。
```javascript
window.A4Sanitize = {
  escapeHtml(value),   // HTML 转义（& < > " '）
  escapeAttr(value),   // 属性转义（" '）
  escapeCsvFormula(value), // 中和 = + - @ 公式前缀（含前导空白）
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
  showConfirmDialog(messageOrOpts),   // 自定义二次确认弹窗，替代原生 confirm
  showNoticeDialog(messageOrOpts),    // 应用内提示弹窗
  showChoiceDialog(options),          // 应用内单选底部面板
  showToast(messageOrOpts),           // 全局轻提示
  getTauriInvoke(),                   // 统一获取 Tauri invoke 函数
  installMobileTapGuard(el),          // 移动端 300ms 延迟兼容
  installAndroidSelectPicker(root, selector),
  refreshAndroidSelectPickers(root),
}
```
文件导出在 Web/桌面端使用浏览器下载；Android Tauri 端通过 `a4_android_save_text_file` 将文本类导出写入下载目录，结果反馈由前端共享 toast 呈现。应用拥有的通知、选择列表和删除/清空确认分别使用 `showNoticeDialog` / `showToast`、`showChoiceDialog` / `installAndroidSelectPicker` 和 `showConfirmDialog`，不调用 WebView 原生 `alert` / `confirm` / `prompt`。Android 下的词书、在线导入、查词语言和设置选项均使用应用内底部面板，原 `<select>` 保留为状态源；AI 常用模型使用应用内选择面板，同时保留自由输入。系统打印、系统文件选择、外部浏览器、OAuth 和软键盘属于平台能力，继续使用系统界面。

### `js/speech.js`
语音合成封装。Web/桌面端使用 SpeechSynthesis；Android Tauri 端通过全局 Tauri invoke 调用原生 `a4_android_speak`。在线模式支持 Microsoft Edge TTS / Google Translate TTS，由 `ttsMode` / `onlineTtsProvider` 控制；浏览器优先直连首选在线源，未及时开始播放时尝试同源私有桥接层代理，再依次尝试另一在线源、已安装离线语音和系统语音。桌面端与 Android 均支持「离线 TTS」模式（Sherpa-ONNX，模型按需下载到 `app_data_dir()/voices/<id>/`），通过 `a4_offline_speak` 命令合成 WAV 后用 HTMLAudioElement 播放；离线模式失败时只回退系统语音，不调用在线源。同一 voice ID 的合成、替换和删除覆盖完整生命周期串行执行；桌面端在文件替换或删除前释放引擎缓存，模型安装使用同级 staging/backup 原子切换并恢复未完成事务。Android 的模型加载和推理在 Kotlin 单线程执行器中运行，Rust 命令通过短 JNI 调用轮询结果，不阻塞 WebView 线程；超时请求会取消并清理结果/WAV，模型替换或删除会等待旧原生引擎释放。朗读文本不写入学习状态、备份或云同步数据。Tauri CSP 需放行 `wss:` 与 `media-src blob: https:`。
```javascript
window.A4Speech = {
  installSpeech({ onVoicesChanged }),
  getVoicesSorted(),
  getNativeSpeechLang({ pronunciationLang, wordbookLanguage, accent }),
  isAndroidTauriSpeech(),
  speak({ text, pronunciationEnabled, pronunciationLang, wordbookLanguage, accent, voiceMode, voiceURI, onlineTtsEnabled, onlineTtsProvider, ttsMode, offlineVoiceId }),
  speakOnline(text, langTag, provider),    // 直接调用在线 TTS
  getLastSpeakResult(),                    // 最近一次实际使用的发音方式与在线源
  // ...
}
```

### `js/settings.js`
设置界面控制器，暴露 `window.A4Settings`；设置视图以 `presentation: "page"` 创建控制器，页面呈现不带弹窗式标题或返回头。分类轨道拥有一个测量位置的 `aria-hidden` 指示器，在手机上水平显示、在桌面上垂直显示；分类内容按索引方向进入，`prefers-reduced-motion: reduce` 下立即切换状态。`presentation: "modal"` 保留对话框标题和关闭语义；视图内需要确认或预览的操作仍使用标准弹层。AI 模型输入支持自由填写，当前服务商的常用模型通过应用内选择面板填入，不依赖 WebView 原生 `datalist` 候选界面：
```javascript
window.A4Settings = {
  createSettingsModalController({ getState, setState, persist, applyTheme, onAfterChange, getWordbookLanguage, presentation }),
  // AI 词书生成、备份导入导出、normalize 函数等
}
```

### `js/settings-page.js`
设置视图控制器。它从 `A4Storage` 读取完整状态、应用主题、连接 `createSettingsModalController({ presentation: "page" })`，并通过路由生命周期在每次进入时刷新状态、离开时持久化；它只负责设置状态、主题和路由生命周期接线，不记录返回来源或发起导航。设置状态继续写入同一个 `a4-memory:v1`，AI API Key 仍只保留在当前页面内存中。

### `js/lookup.js`
查词弹窗控制器，暴露 `window.A4Lookup`：
```javascript
window.A4Lookup = {
  createLookupModalController({ getState, setState, persist, getWordbookLanguage, addWordToCurrentRound }),
}
```
App Shell 中所有视图共享一个底层控制器和一套 DOM 事件；每个视图获得一个打开句柄，打开时切换到该视图的状态、持久化与词书语言上下文。学习视图的查词上下文提供“加入当前轮”能力，记录视图的查词上下文不提供该操作。查词面板在视口中心基础上略向上偏移，Android 的查词语言选择使用应用内底部面板。功能包括本地词书检索、在线补充（MyMemory + dictionaryapi.dev）、西语动词变位、AI 补充和查词缓存。

### `js/app.js`
学习视图控制器（UI 层，不含核心业务逻辑）。负责：
- A4 排版与单词放置
- 当前轮恢复
- 首页词书选择；Android 环境使用应用内底部面板，iOS/macOS/桌面浏览器保留原生 `<select>`
- 复习弹窗（swipe/drag 标记）
- 词书导入、词书 JSON 导出与在线词书导入
- 轮次推进与状态写回

宽度不超过 700px 时，学习视图使用紧凑词书状态，低频入口集中在词书行旁的 `.mobile-more-tools` 下拉菜单；宽度达到 701px 时，A4 在视口居中，词书/工具与进度卡分居两侧，低频入口在左侧 `.desktop-tools-popover`。两种布局共用纸面复习/释义操作和悬浮底栏；沉浸模式下纸面工具栏显示独立退出操作。「下一个单词」只在学习视图可用，页码控件仅在当前轮包含多张 A4 时显示。学习页根视口裁切横向溢出，页面手势仅允许纵向平移并禁用双击/双指缩放；A4 保持原始布局比例，复习卡仍独立处理横向标记手势。路由 `leave` 生命周期负责保存学习状态并收起视图工具，`enter` 生命周期重新读取存储并刷新纸面，活动路由的 `exit` 负责文档卸载前的最终保存。

### `js/records.js`
记录视图控制器（UI 层）。进入视图时重新读取存储并刷新统计与列表，离开后仍保持控制器和 DOM 挂载。负责：
- 轮次视图与状态视图切换
- 统计计算与今日复习焦点；显示今日单词、待复习、连续学习、累计进度和每日目标
- 轮次摘要先通过纯展示模型计算；单词详情在首次展开时创建，A4 排版只在独立预览开关展开时创建
- 单页 A4 预览不显示分页控件，多页预览保留上一页、下一页和页码状态
- CSV/PDF 导出；PDF 会生成隐藏的 A4 打印输出层，桌面端走 Tauri WebView 打印权限，Android 端走原生打印桥接；离开记录路由会移除预览、打印输出与其窗口/键盘/触摸监听
- 轮次删除与清空记录（确认弹窗使用 `A4Utils.showConfirmDialog`，不依赖原生 `window.confirm`，避免 Tauri WKWebView 对话框委托未实现导致返回 `undefined`）
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
- `checkUpdate()` 返回 `Promise<string>`，解析值为 `"update"`（弹窗已展示）/ `"latest"`（已是最新）/ `"error"`（网络错误或 API 不可用）/ `"skipped"`（用户跳过此版本）/ `"cached"`（缓存未过期跳过）/ `"prerelease"`（忽略预发布版）。设置页按钮通过 `await checkUpdate()` 获取检查结果。
- 自动检查最新 GitHub Release，设置页"检查更新"会清除本地跳过/缓存后强制检查一次
- 更新提示采用紧凑、跟随主题的信息卡片，显示当前版本 → 最新版本、最多 4 条通过 `textContent` 安全渲染的 Release 说明，以及与当前平台匹配的安装包文件名；界面不显示原始 URL
- 从 `release.assets[].browser_download_url` 选择当前平台安装包：Android 优先识别 `a4-memory-v*-android.apk`，macOS 识别 `.dmg`，Windows 识别 `.msi` / `.exe`，Linux 识别 `.AppImage` / `.deb`。Android 主操作打开 Release 页面，匹配 APK 的直链作为备用下载；桌面端主操作打开当前平台的匹配安装包；未知平台或无匹配安装包时打开 Release 页面
- Tauri 端通过 Rust 命令 `a4_open_external` 打开系统默认浏览器/下载处理器；Web 端使用 `window.open` / `location.href` 兜底

### Tauri 原生命令桥接

`src-tauri/src/lib.rs` 暴露最小平台能力；外部打开能力使用 `tauri-plugin-opener`：
- `a4_open_external(url)`：桌面端 / Android 打开系统默认浏览器或下载处理器。
- `a4_android_print()`：Android 端调用 WebView 原生打印接口。
- `a4_android_save_text_file(filename, mime, content)`：Android 端将文本类导出写入下载目录，用于词书、备份和 CSV 导出；原生桥接不创建 Toast，完成或失败状态由前端共享 toast 呈现。
- `a4_android_speak(text, lang)`：Android 端调用系统 TextToSpeech 引擎朗读。
- `a4_offline_voices_manifest_url()` / `a4_offline_voices_manifest_fetch()`：返回 GitHub Raw 模型清单源 URL 与经过字段校验的 JSON；网络、HTTP、解析或校验失败时返回编译进应用的 v1 清单。
- `a4_offline_voices_installed()`：列出 `app_data_dir()/voices/` 下已安装的语音包。
- `a4_offline_voices_download(voiceId, channel)`：按可信清单中的 ID 从 `k7tmiz/a4-tts-voices` GitHub Release 下载 tar.bz2 模型，校验 SHA256 和资源路径，通过 staging/backup 事务提交安装，进度通过 Tauri channel 流式推送；提交后的旧备份清理失败不回滚可用的新安装，后续同语音操作会重试清理。
- `a4_offline_voices_delete(voiceId)`：删除指定语音包并清理推理引擎缓存。
- `a4_offline_speak(text, voiceId)`：使用 Sherpa-ONNX VITS 引擎合成 16-bit mono PCM WAV 字节，前端转 Blob 后用 HTMLAudioElement 播放；桌面端通过 `sherpa-rs` 推理，Android 通过 `A4OfflineTtsBridge` + sherpa-onnx AAR 在后台推理。

Android 构建执行 `scripts/prepare-android-tts.mjs`：官方 sherpa-onnx v1.13.3 AAR 下载到用户缓存目录并校验固定 SHA256，不进入仓库；下载具有超时与大小上限，脚本幂等复制 Kotlin 桥接并配置 `arm64-v8a`、Gradle 依赖和 JNI ProGuard keep rules。Android 离线 TTS 构建使用 `--target aarch64`；`scripts/build.mjs` 在对应 Android 构建钩子中自动调用该脚本，Release workflow 在 Android init 后显式调用同一入口。

### 基础冒烟检查

- 词书导入：TXT、CSV、JSON 本地导入均应正常创建自定义词书并可选中。
- 学习流程：新增单词后自动复习弹窗应打开；记录页手动复习应可返回首页并打开复习弹窗。
- 学习页手势：直接左右拖动纸面或背景不得产生横向页面偏移，双击/双指操作不得缩放 A4；复习卡横向标记保持可用；沉浸模式可从纸面工具栏退出。
- 安全渲染：导入词条中的 HTML 片段只能作为文本显示，不得生成真实 DOM 标签或触发脚本。
- 路由与设置：学习、记录、设置应通过同一底栏无刷新切换；浏览器返回后地址、底栏选中态和可见视图应一致；设置视图内确认/预览弹层、AI 常用模型选择、备份导入导出入口、记录视图 CSV/PDF 导出入口应可正常访问。

---

## 5. 设置界面结构

设置作为 App Shell 中的独立路由视图实现。`js/settings-page.js` 负责设置状态、主题和路由生命周期接线，不记录返回来源或发起导航；`js/settings.js` 的 `createSettingsModalController` 负责复用设置表单与行为；`settings.html` 只保留外部深链兼容职责。

### 设置分区与响应式布局

设置界面包含五个顶级类别，进入页面时显示「账号」：

1. **账号** — 登录、注册、重置密码、登录状态卡片与云同步（上传/下载数据）。登录状态卡片在宽度不超过 430px 时常显单词数、连续天数和当前轮，其余统计通过「更多学习统计」展开且每次打开设置默认折叠；平板和桌面宽度默认直接展示全部统计。
2. **学习** — 外观（主题模式与经典/纸张绿/海蓝配色）、学习目标（每日轮次/单词）、学习设置（每轮上限）和复习配置（复习间隔、翻面、持续背书）。
3. **发音** — 朗读开关、发音方式（在线 TTS / 离线 TTS / 系统语音）和在线发音源；「离线语音包」分区与当前首选发音方式相互独立，桌面端和 Android 应用可随时下载、删除、试听及选择模型，选中离线 TTS 时分区自动展开。Web 端保留该分区并明确提示不支持模型管理。
4. **AI** — 自定义 API 配置、模型选择和词书生成；常用模型由应用内面板选择，模型名仍可自由输入。
5. **更多** — 包含联网补充（在线查词）、数据管理和版本信息；版本信息仅在 Tauri 桌面端与 Android 应用中显示。

移动端使用跟随主题的统一分段式顶部导航，内容按单列手风琴卡片排列。宽度达到 760px 时，类别导航位于左侧，内容使用响应式两列手风琴布局；账号面板横跨整个内容区。所有宽度均复用 App Shell 的学习、记录、设置悬浮底栏。

类别导航采用 `tab` / `tabpanel` 语义。左、右、上、下方向键循环切换类别，`Home` / `End` 分别切换到第一个和最后一个类别。

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
  themePalette: "classic" | "paper" | "ocean",
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
  onlineTtsEnabled: boolean,
  onlineTtsProvider: "edge" | "google",
  ttsMode: "online" | "offline" | "system",
  offlineVoiceByLang: { en: string, es: string, ... },

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
- AI 提供商或 Base URL origin 变化时清空内存中的 `aiConfig.apiKey`，避免凭据跨服务发送
- 记录页监听 `storage` 事件，支持多标签页同步刷新显示
- 所有删除/清空确认弹窗统一使用 `A4Utils.showConfirmDialog`，不依赖原生 `window.confirm`，避免 Tauri WKWebView 对话框委托未实现导致返回 `undefined`；设置页的云端恢复确认也使用自定义弹窗
- 学习与记录视图的标准弹窗、设置视图内的确认/预览弹层、Android 选择器和公告弹窗统一进入 `A4UI` 弹层栈；用户触发的弹层传递实际 `trigger` 并使用来源往返动效，没有用户来源的自动弹层使用中性动效。打开期间页面固定且背景不可滚动，嵌套弹层逐层关闭，焦点在关闭后回到触发位置。路由切换通过所有者撤销协议立即清理旧视图弹层并跳过旧焦点恢复；设置视图本身使用正常页面滚动，不进入弹层栈，也不阻断学习视图快捷键
- 学习控制器持续缓存最新系统主题偏好，但只在学习路由活动时更新页面，并在重新进入时再次读取媒体查询；其他常驻控制器只在所属路由活动时响应主题或鉴权事件。进入学习/记录视图时会使用最新持久状态刷新主题并检查未读公告
