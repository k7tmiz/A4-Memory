# Android APK + macOS Intel — 构建接入方案

## 目标

在不影响现有 Web 和桌面 Tauri 的前提下，新增：
- Android `.apk` 自动构建
- macOS Intel (x86_64) `.dmg` 自动构建

## 范围

### 改动的

| 文件 | 改什么 |
|------|--------|
| `src-tauri/tauri.conf.json` | 加 Android 配置段，加 `identifier` 确认 |
| `src-tauri/gen/android/` | Tauri 自动生成，Gradle + Kotlin 项目，约 20 个文件 |
| `.github/workflows/release.yml` | 矩阵加 Android + macOS Intel |
| `.gitignore` | 加 Android 构建产物排除 |

### 不改的

| 项目 | 说明 |
|------|------|
| 前端 HTML/CSS/JS | 零改动，已有移动端适配 |
| Web 部署 (Hexo) | 不变 |
| 桌面 Tauri macOS ARM / Windows / Linux | 构建流程不变 |
| cloud.js | 同一个 GitHub Secret 注入，Android 也带上 |
| `scripts/build.mjs` | 不变 |

## 本地新增文件

| 目录/文件 | 说明 |
|-----------|------|
| `src-tauri/gen/android/` | Tauri 生成的 Android 项目 |
| `src-tauri/icons/android/` | Android 专属图标（已有，tauri icon 生成过） |

## .gitignore 追加

```
# Android
src-tauri/gen/android/app/build/
src-tauri/gen/android/.gradle/
src-tauri/gen/android/local.properties
```

## release.yml 改动

### 矩阵新增

```yaml
# macOS Intel（独立 Runner）
- os: macos-13
  target: x86_64-apple-darwin

# Android
- os: ubuntu-latest
  target: aarch64-linux-android
```

### Android 额外步骤

在 `npm run build` 之前加：
- `android-sdk-action` 安装 Android SDK + NDK
- `rustup target add aarch64-linux-android`

### macOS 无需额外步骤

macOS ARM 和 Intel 共用同一套 steps，只是 runner 不同。

## 产物

| 新增产物 | 文件名 |
|----------|--------|
| macOS Intel | `A4 Word Memory_*.dmg`（Intel x86_64） |
| Android | `A4 Word Memory_*.apk` |

## 发音

SpeechSynthesis 在 Android 上依赖系统 TTS 引擎。Release 说明里加一句：发音功能需要安装 Google 文字转语音引擎。不额外引入 TTS 插件，跟 Web/桌面保持一致。

## release body 追加

| 行 | 内容 |
|----|------|
| macOS (Intel) | `A4 Word Memory_*_x64.dmg` |
| Android | `A4 Word Memory_*.apk` |
