const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const { describe, it } = require("node:test")
const assert = require("node:assert/strict")

const ROOT = path.join(__dirname, "..")
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8")

const { APP_MODULE_FILES } = require("./helpers/app-source")

function loadAppInternal() {
  const sandbox = {
    console,
    URL,
    setTimeout,
    clearTimeout,
    performance,
    requestAnimationFrame: (callback) => setTimeout(() => callback(Date.now()), 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    window: {
      location: { href: "https://example.com/words/" },
      setTimeout,
      clearTimeout,
      listeners: new Map(),
      addEventListener(type, listener) {
        this.listeners.set(type, listener)
      },
      removeEventListener(type, listener) {
        if (this.listeners.get(type) === listener) this.listeners.delete(type)
      },
      scrollY: 0,
      scrollTo() {},
      WORDS: [],
      WORDBOOKS: [],
    },
    document: {
      body: { classList: { add() {}, remove() {}, toggle() {} }, style: {} },
    },
  }
  sandbox.window.window = sandbox.window
  vm.createContext(sandbox)
  for (const file of ["js/core/common.js", ...APP_MODULE_FILES]) vm.runInContext(read(file), sandbox)
  return { ...sandbox.window.A4AppInternal, sandbox }
}

// 沙箱对象与测试上下文的原型不同，比较前转为普通数据
const plain = (value) => JSON.parse(JSON.stringify(value))

describe("app modules", () => {
  const { wordbookIo, studyHelpers, reviewSwipe, sandbox } = loadAppInternal()

  it("loads app modules before app.js in index.html", () => {
    const indexMarkup = read("index.html")
    const positions = [...APP_MODULE_FILES, "js/app.js"].map((file) => indexMarkup.indexOf(`src="./${file}?v=`))
    assert.ok(positions.every((pos) => pos > 0))
    assert.deepEqual([...positions].sort((a, b) => a - b), positions)
    assert.ok(indexMarkup.indexOf('src="./js/core/common.js?v=') < positions[0])
  })

  it("keeps extracted helpers out of app.js", () => {
    const appCode = read("js/app.js")
    for (const name of [...Object.keys(wordbookIo), ...Object.keys(studyHelpers)]) {
      assert.doesNotMatch(appCode, new RegExp(`function ${name}\\(`), name)
    }
    for (const name of ["applyReviewSwipeVisual", "commitReviewSwipe", "finishReviewSwipe", "onReviewPointerMove"]) {
      assert.doesNotMatch(appCode, new RegExp(`function ${name}\\(`), name)
    }
  })

  it("parses CSV, TSV and header rows into word objects", () => {
    const csv = wordbookIo.parseWordsFromText({ text: 'apple,n. 苹果\r\n"say, hi","v.",打招呼', filename: "a.csv" })
    assert.deepEqual(
      plain(csv.map((w) => [w.term, w.pos, w.meaning])),
      [["apple", "n.", "苹果"], ["say, hi", "v.", "打招呼"]],
    )
    const tsv = wordbookIo.parseWordsFromText({ text: "单词\t释义\nhola\t你好", filename: "b.txt" })
    assert.deepEqual(plain(tsv.map((w) => [w.term, w.meaning])), [["hola", "你好"]])
  })

  it("infers wordbook language from hints and scripts", () => {
    assert.equal(wordbookIo.inferWordbookLanguage({ rawLanguage: "pt_BR" }), "pt-BR")
    assert.equal(wordbookIo.inferWordbookLanguage({ name: "西班牙语核心词" }), "es")
    assert.equal(wordbookIo.inferWordbookLanguage({ words: [{ term: "ありがとう" }] }), "ja")
    assert.equal(wordbookIo.inferWordbookLanguage({ words: [{ term: "hello" }] }), "")
  })

  it("extracts remote wordbooks and derives unique names", () => {
    const book = wordbookIo.extractWordbookFromRemoteJson({
      title: "  Core  Words ",
      items: [{ word: "run", translations: [{ translation: "跑", type: "v" }] }, "walk"],
    })
    assert.equal(book.name, "Core Words")
    assert.deepEqual(plain(book.words.map((w) => [w.term, w.pos, w.meaning])), [["run", "v.", "跑"], ["walk", "", ""]])
    assert.equal(wordbookIo.inferWordbookNameFromUrl("https://x.dev/repo/raw/cet-4_words.json"), "cet 4 words")
    const existing = vm.runInContext('new Set(["core words"])', sandbox)
    assert.equal(wordbookIo.makeUniqueWordbookName("Core Words", existing), "Core Words（2）")
  })

  it("expands Spanish gender short forms", () => {
    assert.equal(studyHelpers.expandSpanishGenderShortForm("niño, -a"), "niño, niña")
    assert.equal(studyHelpers.expandSpanishGenderShortForm("profesor, -a"), "profesor, profesora")
    assert.equal(studyHelpers.expandSpanishGenderShortForm("casa"), "casa")
  })

  it("applies rubber-band resistance beyond the swipe limit", () => {
    assert.equal(studyHelpers.rubberBandClamp(40, 100, 0.5), 40)
    assert.equal(studyHelpers.rubberBandClamp(-140, 100, 0.5), -120)
    assert.equal(studyHelpers.getReviewSwipeConfig("mouse").commitMinPx, 40)
  })

  it("commits a horizontal swipe and blocks clicks while dragging", async () => {
    const cardListeners = new Map()
    const card = {
      style: { setProperty() {}, transition: "" },
      classList: { add() {}, remove() {} },
      offsetHeight: 0,
      addEventListener: (type, listener) => cardListeners.set(type, listener),
      removeEventListener: (type) => cardListeners.delete(type),
      getBoundingClientRect: () => ({ width: 300 }),
      setPointerCapture() {},
    }
    const commits = []
    const controller = reviewSwipe.createReviewSwipeController({
      card,
      isReviewOpen: () => true,
      onCommit: (direction) => commits.push(direction),
    })
    const win = sandbox.window
    const pointer = (x) => ({ pointerId: 1, pointerType: "touch", button: 0, clientX: x, clientY: 100, preventDefault() {} })
    cardListeners.get("pointerdown")(pointer(100))
    win.listeners.get("pointermove")(pointer(140))
    win.listeners.get("pointermove")(pointer(260))
    assert.equal(controller.isInteractionBlocked(), true)
    win.listeners.get("pointerup")(pointer(260))
    await new Promise((resolve) => setTimeout(resolve, 320))
    assert.deepEqual(commits, [1])

    controller.destroy()
    assert.equal(cardListeners.has("pointerdown"), false)
  })
})

describe("paper layout", () => {
  // 测量态下单词按显示释义时的完整尺寸返回，便于验证排版为释义预留空间
  function createWordStub({ w, h, left = 0, top = 0, log = [] }) {
    const classes = new Set()
    return {
      style: { left: `${left}px`, top: `${top}px` },
      classList: {
        add(name) {
          classes.add(name)
          log.push(`add:${name}`)
        },
        remove(name) {
          classes.delete(name)
          log.push(`remove:${name}`)
        },
      },
      get offsetWidth() {
        log.push("read")
        return classes.has("is-measuring") ? w : w / 2
      },
      get offsetHeight() {
        return classes.has("is-measuring") ? h : h / 2
      },
    }
  }

  function createLayout(placed = []) {
    const { paperLayout } = loadAppInternal()
    const paperInner = {
      clientWidth: 400,
      clientHeight: 300,
      getBoundingClientRect: () => ({ width: 400, height: 300 }),
    }
    return paperLayout.createPaperLayout({ paperInner, getPlaced: () => placed })
  }

  it("pulls words back inside the paper using their full measured size", () => {
    const layout = createLayout()
    const el = createWordStub({ w: 120, h: 40, left: 350, top: 290 })
    const box = layout.fitWordElementInPaper(el)
    assert.deepEqual(plain(box), { x: 280, y: 260, w: 120, h: 40 })
    assert.equal(el.style.left, "280px")
    assert.equal(el.style.top, "260px")
  })

  it("leaves words that already fit untouched", () => {
    const layout = createLayout()
    const el = createWordStub({ w: 50, h: 20, left: 10, top: 12 })
    layout.fitWordElementInPaper(el)
    assert.equal(el.style.left, "10px")
    assert.equal(el.style.top, "12px")
  })

  it("measures a batch in one write phase followed by one read phase", () => {
    const layout = createLayout()
    const log = []
    const elements = [1, 2, 3].map(() => createWordStub({ w: 40, h: 20, log }))
    layout.fitWordElementsInPaper(elements)
    assert.deepEqual(log, [
      "add:is-measuring", "add:is-measuring", "add:is-measuring",
      "read", "read", "read",
      "remove:is-measuring", "remove:is-measuring", "remove:is-measuring",
    ])
  })

  it("moves overlapping restored words apart", () => {
    const first = createWordStub({ w: 60, h: 20, left: 100, top: 100 })
    const second = createWordStub({ w: 60, h: 20, left: 100, top: 100 })
    const placed = [
      { el: first, box: { x: 100, y: 100, w: 60, h: 20 } },
      { el: second, box: { x: 100, y: 100, w: 60, h: 20 } },
    ]
    const layout = createLayout(placed)
    layout.spreadOverlappingWords()
    const [a, b] = placed.map((p) => p.box)
    const overlaps = a.x < b.x + b.w + 2 && b.x < a.x + a.w + 2 && a.y < b.y + b.h + 2 && b.y < a.y + a.h + 2
    assert.equal(overlaps, false)
    assert.equal(first.style.left, "100px", "the first word keeps its position")
    assert.equal(second.style.left, `${b.x}px`)
  })
})

describe("wordbook manager", () => {
  it("renames legacy generic remote wordbooks and keeps names unique against built-ins", () => {
    const { wordbookManager, wordbookIo } = loadAppInternal()
    const manager = wordbookManager.createWordbookManager({
      appState: { builtInWordbooks: [{ id: "cet4", name: "CET4" }] },
      dom: {},
    })
    const desc = "k7tmiz/english-vocabulary@main:cet6/words.json"
    const books = manager.normalizeStoredCustomWordbooks([
      { id: "a", name: "英语词库（k7tmiz）", description: desc, language: "en", words: [{ term: "apple", meaning: "苹果" }] },
      { id: "b", name: "CET4", description: "", language: "en", words: [{ term: "pear", meaning: "梨" }] },
      null,
    ])
    assert.equal(books.length, 2)
    assert.equal(books[0].name, wordbookIo.inferWordbookNameFromDescription(desc))
    assert.notEqual(books[1].name, "CET4")
  })

  it("returns an empty list for missing stored wordbooks", () => {
    const { wordbookManager } = loadAppInternal()
    const manager = wordbookManager.createWordbookManager({ appState: { builtInWordbooks: [] }, dom: {} })
    assert.deepEqual(plain(manager.normalizeStoredCustomWordbooks(undefined)), [])
  })
})
