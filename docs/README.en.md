# A4 Memory

[中文](./README.md) | **English**

> **Open Source Notice**: This repository is the open-source frontend. Core code (`js/`, `css/`, `index.html`, etc.) is fully open source.
> Backend services (user auth, cloud sync, admin panel) are proprietary and closed source.
> `js/cloud.js` cloud sync module is a private module and is **NOT in the public repository**.
>
> **Cloud Sync**: Building from source does NOT include cloud sync (cloud.js is absent). [GitHub Releases](https://github.com/k7tmiz/A4-Memory/releases) include cloud.js via CI injection — **full cloud sync is available** in desktop and Android builds.

Demo: https://k7tmiz.com/words

A pure front-end vocabulary tool built around randomly placing words on A4 pages, breaking away from list-based memorization. Each new word auto-opens the review modal; in a multi-page normal round, auto review is scoped to the current page, while "Review this round" reviews all pages. Includes learning records, status aggregation, wordbook import, lookup, pronunciation, export, and AI wordbook generation.

## Features

- A4 random layout with collision avoidance
- Multi-page A4: normal rounds start at 1 page, can append more within the same round
- Review modal: auto (after adding a word) and manual (whole round), swipe/drag to mark, click to flip
- Status system: Mastered / Learning / Unknown
- Lightweight review: auto-schedules next review, "Due" aggregation in records
- Round types: Normal / Mastered review / Learning review / Unknown review / Due review
- Records: round view, status view, CSV/PDF export, generate review rounds
- Wordbooks: built-in CET4 / CET6 / Spanish samples, TXT/CSV/JSON import, GitHub online import
- Lookup: local-first, online supplement (MyMemory + dictionaryapi.dev), Spanish conjugation, AI supplement
- Pronunciation: SpeechSynthesis (en/es/ja/ko/pt/fr/de/it/eo)
- Appearance: meaning toggle, immersive mode, auto/light/dark theme
- Backup: full JSON import/export
- AI wordbook generator: OpenAI / Gemini / DeepSeek / SiliconCloud / Custom
- Version update check: auto-detects new GitHub Releases and shows download notification

## Tech Stack

| Component | Technology |
|-----------|------------|
| Frontend | Pure static HTML/CSS/Vanilla JS, no framework |
| Desktop | Tauri v2 (Rust + WebView), shares frontend code with Web |
| State storage | Browser localStorage |
| Cloud sync | Backend API + JWT (`js/cloud.js` private module) |
| AI integration | OpenAI-style chat/completions API |

## Project Structure

```
A4-Memory/
├── index.html              # Home page
├── records.html            # Learning records page
├── css/style.css          # Styles
├── data/words.js          # Built-in wordbooks
├── js/
│   ├── core/common.js     # Cross-page shared business logic
│   ├── app.js             # Home page controller
│   ├── lookup.js          # Lookup controller
│   ├── records.js         # Records page controller
│   ├── settings.js        # Settings controller
│   ├── speech.js          # Speech synthesis
│   ├── storage.js         # localStorage wrapper
│   └── utils.js           # Download utilities
├── src-tauri/             # Tauri desktop app (Rust)
├── scripts/               # Build scripts
├── .github/workflows/     # CI / auto-release
├── package.json           # Node dependencies (Vite + Tauri CLI)
└── docs/                  # Documentation
```

**Note**: `js/cloud.js` is NOT in the public repository — it's an optional private module for cloud sync. Desktop builds auto-include `cloud.js` if present locally.

## Cross-Platform App (Tauri)

Desktop (macOS / Windows / Linux) and Android APK are available, built with Tauri v2.

Download prebuilt installers from [GitHub Releases](https://github.com/k7tmiz/A4-Memory/releases) — includes full cloud sync.

```bash
# Install dependencies
npm install

# Development mode (hot reload)
npm run tauri dev

# Local build (no cloud.js — add it to js/ if needed)
npm run tauri build
```

## Usage

### Use online

Open the demo: https://k7tmiz.com/words

### Run locally

```bash
cd A4-Memory
python3 -m http.server 8080
# or with Vite dev server (hot reload):
npm run dev
```

Open: http://localhost:8080/ or http://localhost:5173/

## Data & Storage

### localStorage keys

| Key | Content |
|-----|---------|
| `a4-memory:v1` | Main state JSON (version: 2) |
| `a4-memory:intro-seen:v1` | "How to use" modal seen flag |
| `a4-memory:lookup-cache:v1` | Lookup online supplement cache |

### Main state summary

- Rounds: `rounds`, `currentRoundId`, `pendingReviewRoundId`, `pendingGenerateStatusKind`
- UI: `showMeaning`, `immersiveMode`, `themeMode`, `darkMode`
- Learning: `roundCap`, `dailyGoalRounds`, `dailyGoalWords`
- Review: `reviewSystemEnabled`, `reviewIntervals`, `continuousStudyMode`, `reviewCardFlipEnabled`
- Pronunciation: `pronunciationEnabled`, `pronunciationAccent`, `pronunciationLang`, `voiceMode`, `voiceURI`
- Wordbooks: `selectedWordbookId`, `customWordbooks`
- AI config: `aiConfig = { provider, baseUrl, apiKey, model }` (`apiKey` stays in memory, not persisted)
- Lookup: `lookupOnlineEnabled`, `lookupOnlineSource`, `lookupLangMode`, `lookupSpanishConjugationEnabled`, `lookupCacheEnabled`, `lookupCacheDays`

## Cloud Sync (Optional, requires private module)

Cloud sync depends on the backend API and the `js/cloud.js` private module. When enabled:
- User registration/login (account managed server-side)
- Learning state upload/download (multi-device sync)
- Cloud-logged-in users auto-receive system announcements; each announcement pops once per account, latest shown at top

To use, contact the author to obtain `cloud.js`, place it in the `js/` directory. No HTML changes needed — the page loads it automatically.

## Documentation

| Document | Description |
|----------|-------------|
| [FRONTEND_CONTEXT.md](./FRONTEND_CONTEXT.md) | Frontend architecture, modules, settings UI |
| [API.md](./API.md) | User-facing API reference (public endpoints) |

## Contact

- GitHub: https://github.com/k7tmiz/A4-Memory
- Email: kcyx01@gmail.com
