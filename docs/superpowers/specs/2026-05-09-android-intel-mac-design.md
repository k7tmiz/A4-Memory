# Android APK — 构建接入方案

## 目标

在不影响现有 Web 和桌面 Tauri 的前提下，新增 Android `.apk` 自动构建。

## 范围

### 改动的

| 文件 | 改什么 |
|------|--------|
| `src-tauri/gen/android/` | Tauri Android 项目（Gradle + Kotlin），约 15 个文件 |
| `.github/workflows/release.yml` | 矩阵加 Android |
| `.gitignore` | 加 Android 构建产物排除 |

### 不改的

| 项目 | 说明 |
|------|------|
| 前端 HTML/CSS/JS | 零改动，已有移动端适配 |
| Web 部署 (Hexo) | 不变 |
| 桌面 Tauri macOS / Windows / Linux | 构建流程不变 |
| cloud.js | 同一个 GitHub Secret 注入，Android 也带上 |
| `scripts/build.mjs` | 不变 |

## 本地新增文件

| 目录/文件 | 说明 |
|-----------|------|
| `src-tauri/gen/android/` | Android 项目源码 |
| `src-tauri/icons/android/` | Android 专属图标（已有，tauri icon 生成过） |

## .gitignore 追加

```
# Android
src-tauri/gen/android/app/build/
src-tauri/gen/android/.gradle/
src-tauri/gen/android/local.properties
```

## 构建流程

Android 作为独立的 CI job，依赖桌面构建完成：

1. Setup Android SDK + Java 17
2. `npm run build`（含 cloud.js 注入）
3. `npx tauri android build --apk`
4. 上传 APK 到已有 Release

## 发音

SpeechSynthesis 在 Android 上依赖系统 TTS 引擎。Release 说明里提一句：发音功能需要安装 Google 文字转语音引擎。

## 产物

`A4 Word Memory_*.apk`
