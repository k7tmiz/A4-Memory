const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const { describe, it } = require("node:test")
const assert = require("node:assert/strict")

const ROOT = path.join(__dirname, "..")
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8")

// 顺序必须与 index.html 中的 <script> 顺序一致
const APP_MODULE_FILES = ["js/app/wordbook-io.js", "js/app/study-helpers.js"]

function loadAppInternal() {
  const sandbox = {
    console,
    URL,
    window: {
      location: { href: "https://example.com/words/" },
      scrollY: 0,
      scrollTo() {},
      WORDS: [],
      WORDBOOKS: [],
    },
    document: {
      body: { classList: { add() {}, remove() {} }, style: {} },
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
  const { wordbookIo, studyHelpers, sandbox } = loadAppInternal()

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
})
