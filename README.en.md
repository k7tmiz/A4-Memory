# A4 Word Memory

[中文 (Default)](./README.md) | [English](./README.en.md)

Demo: https://k7tmiz.com/words

A pure front-end “A4 paper memory method” vocabulary tool: up to 30 words per round, randomly laid out on an A4 page. Every time you add a new word, you must fully review all words in the current round. Includes learning records, per-round review, CSV export, A4 print/PDF export, wordbook import (local/online), and JSON import/export for records. Optimized for Safari on iOS/iPadOS/macOS and works well when added to the home screen.

---

## Features

- A4 random layout: places words at random positions with spacing and tries smaller font sizes to fit
- 30 words per round: when full, you can start the next round (keep records) or restart
- Forced review: every added word opens a full-round review modal (optional shuffle)
- Meaning toggle: show/hide word meanings
- Wordbooks: built-in samples + local import (CSV/TXT/JSON) + online import (KyleBing CET4/CET6)
- Records page: per-round preview, review/delete a round, CSV export, A4 print/PDF export, JSON import/export
- Local-first: all data is stored in browser localStorage

---

## Usage

### 1) Run locally (static server)

This is a static site, no build required.

```bash
cd a4-memory
python3 -m http.server 8080
```

Open:

- http://localhost:8080/

### 2) Study flow

- Click “Next word” to place a new word and immediately open the round review
- Click “Review this round” to review all words on the current A4 at any time
- Click “New round” to finish the current round and start a new A4 page

### 3) Print / Export A4 PDF

- Home page: use the browser print dialog (or “Save as PDF”) to print the current A4 page
- Records page: “Print / Export PDF” opens a print-only A4 window (no UI)

---

## Wordbook Import

### Local import (CSV / TXT / JSON)

Goal: each row should include at least a word (term). Part of speech (pos) and meaning are optional.

**TXT (recommended)**

One line: `term[TAB]meaning`

```text
boat	n. boat; ship v. row
group	n. group
```

**CSV**

Two or three columns are accepted (header is optional).

```csv
term,pos,meaning
abandon,v.,give up
ability,n.,ability
```

**JSON**

Supports an array, or an object with `name` + `words`.

```json
{
  "name": "My Wordbook",
  "words": [
    { "term": "abandon", "pos": "v.", "meaning": "give up" }
  ]
}
```

### Online import (KyleBing CET4 / CET6)

The app fetches word lists from KyleBing’s `english-vocabulary` repository and saves them as a local custom wordbook.

- Source and license: https://github.com/KyleBing/english-vocabulary

---

## Privacy

- No accounts, no server, no analytics
- Learning data stays in browser localStorage
- Online import performs network requests to GitHub Raw only for downloading word list text

---

## License

MIT License. See [LICENSE](./LICENSE).

Note: Word lists imported from third-party sources may be under different licenses. Please follow the original source’s terms.

