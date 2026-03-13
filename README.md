# A4 Word Memory（A4 纸记忆法背单词）

[中文（默认）](./README.md) | [English](./README.en.md)

Demo：https://k7tmiz.com/words

一个纯前端的“按 A4 纸记忆法背单词”网页工具：每轮最多 30 个词，随机排版到 A4 纸上；每新增一个词就强制完整复习本轮所有词；支持学习记录、按轮复习、导出 CSV、打印/导出 A4 PDF、词书导入（本地/在线）、学习记录 JSON 导入/导出；适配 iOS/iPadOS/macOS Safari 以及添加到桌面使用。

---

## 功能

- A4 随机排版：单词随机落点并尽量避免重叠，必要时自动尝试更小字号
- 每轮上限 30 个：满额后提示继续下一轮（保留记录）或清空重开
- 强制复习流程：每新增 1 个单词都会弹出“本轮复习”列表（可打乱）
- 释义开关：可显示/隐藏单词释义
- 词书系统：内置示例词书 + 本地导入（CSV/TXT/JSON）+ 在线导入（KyleBing 四级/六级）
- 学习记录页：按轮查看、复习/删除单轮、导出 CSV、打印/导出 PDF、学习记录 JSON 导入/导出
- 数据本地化：所有学习数据仅保存在浏览器 localStorage

---

## 使用

### 1) 本地运行（静态服务器）

这是纯静态项目，不需要构建。

```bash
cd a4-memory
python3 -m http.server 8080
```

然后打开：

- http://localhost:8080/

（也可以用任何静态文件服务器打开 `index.html` 与 `records.html`。）

### 2) 背单词流程

- 点击“下一个单词”写入新词并自动弹出本轮复习
- 点击“复习本轮”随时复习当前 A4 的全部单词
- 点击“新建一轮”结束当前轮并开始下一张 A4

### 3) 打印 / 导出 A4 PDF

- 首页：使用浏览器的打印功能（或系统“存为 PDF”）打印当前 A4 页面
- 记录页：点击“打印 / 导出 PDF”会打开一个仅包含 A4 单词页的打印窗口

---

## 词书导入 Wordbook Import

### 本地导入（CSV / TXT / JSON）

目标：每行至少包含一个单词（term），词性（pos）与释义（meaning）可选。

**TXT（推荐）**

每行格式：`term[TAB]meaning`

```text
boat	n. 小船；轮船 v. 划船
group	n. 组；团体
```

**CSV**

两列或三列均可（可带表头）。

```csv
term,pos,meaning
abandon,v.,放弃
ability,n.,能力
```

**JSON**

支持数组或对象（含 `name` + `words`）。

```json
{
  "name": "我的词书",
  "words": [
    { "term": "abandon", "pos": "v.", "meaning": "放弃" }
  ]
}
```

### 在线导入（KyleBing 四级 / 六级）

项目会通过 `fetch` 从 KyleBing 的 `english-vocabulary` 仓库拉取词表文本并保存为本地自定义词书。

- 数据来源与许可请以其仓库为准：<https://github.com/KyleBing/english-vocabulary>

---

## 学习记录

记录页（`records.html`）支持：

- 导出 CSV（适合 Excel）
- 导出/导入学习记录 JSON（用于备份/迁移）
- 按轮复习：从记录页选择某一轮后跳回首页并自动打开复习弹窗

---

## 隐私

- 本项目不包含账号系统、服务器或埋点
- 学习数据仅保存在浏览器 localStorage
- 在线导入词书会向 GitHub Raw 发起网络请求（仅用于下载词表文本）

---

## 项目结构

```text
.
├── index.html           # 首页（背单词主界面）
├── script.js            # 首页核心逻辑
├── style.css            # 样式（含打印样式）
├── words.js             # 内置词书示例（window.WORDBOOKS）
├── records.html         # 学习记录页
├── records.js           # 学习记录逻辑（导出/打印/导入）
├── manifest.webmanifest # PWA 配置
├── icon.svg             # 图标
└── mask-icon.svg        # Safari mask icon
```

---

## License

MIT License. See [LICENSE](./LICENSE).

> Note: Word lists imported from third-party sources may be under different licenses. Please follow the original source’s terms.
