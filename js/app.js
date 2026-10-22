const INTRO_SEEN_KEY = "a4-memory:intro-seen:v1"
const {
  STATUS_MASTERED,
  STATUS_LEARNING,
  STATUS_UNKNOWN,
  ROUND_TYPE_NORMAL,
  ROUND_TYPE_MASTERED,
  ROUND_TYPE_LEARNING,
  ROUND_TYPE_UNKNOWN,
  ROUND_TYPE_DUE,
  normalizeStatus,
  normalizeRoundType,
  normalizeRoundCap,
  normalizeLangTag,
  parseIsoTime,
  formatDateTime,
  buildLatestTermMap,
  getRoundPageCount,
  getRoundItemsByPage,
  ensureCurrentRoundState,
  clamp,
  normalizeMeaningKey,
  setModalVisible,
  getWordbooksFromGlobal,
  normalizeWordObject,
  syncSystemThemePreference,
} = window.A4Common || {}
const {
  normalizePreferences,
  buildPersistedState,
  normalizeReviewIntervals,
  normalizePendingKind,
} = window.A4State || {}

const settings = window.A4Settings || {}
const utils = window.A4Utils || {}
const {
  normalizeThemePalette = (v) => (v === "paper" || v === "ocean" ? v : "classic"),
} = settings
const {
  sanitizeFilename = (v) => String(v || ""),
  downloadJsonFile = () => {},
  showConfirmDialog = () => Promise.resolve(false),
  showNoticeDialog = () => Promise.resolve(false),
  showToast = () => null,
} = utils

const appInternal = window.A4AppInternal || {}
const {
  normalizeWordbookObject,
  stripFileExtension,
  parseWordsFromText,
  inferWordbookLanguage,
  normalizeWordbookName,
  inferWordbookNameFromUrl,
  inferWordbookNameFromDescription,
  makeUniqueWordbookName,
  extractWordbookFromRemoteJson,
  formatFileSize,
  listGithubJsonFiles,
} = appInternal.wordbookIo || {}
const {
  shuffle,
  buildWordElement,
  expandSpanishGenderShortForm,
} = appInternal.studyHelpers || {}

function makeId() {
  return `${Date.now()}-${window.A4Common.makeUuid()}`
}

function openImportModal(trigger = document.activeElement || null) {
  renderCustomWordbooksManage()
  setModalVisible(dom.importModal, true, { trigger, motion: "origin" })
}

function closeImportModal() {
  setModalVisible(dom.importModal, false)
}

function openRemoteImportModal(trigger = document.activeElement || null) {
  setModalVisible(dom.remoteImportModal, true, { trigger, motion: "origin" })
}

function closeRemoteImportModal() {
  setModalVisible(dom.remoteImportModal, false)
}

function openIntroModal(trigger = null) {
  // Show download block only on web, not in Tauri app
  const block = document.getElementById("introDownloadBlock")
  if (block) {
    const isTauri = !!(window.__TAURI_INTERNALS__ || window.__TAURI__)
    block.classList.toggle("hidden", isTauri)
  }
  setModalVisible(dom.introModal, true, {
    trigger,
    motion: trigger ? "origin" : "neutral",
  })
}

function closeIntroModal() {
  try {
    localStorage.setItem(INTRO_SEEN_KEY, "1")
  } catch { /* ignore */ }
  setModalVisible(dom.introModal, false)
}

function shouldUseAndroidWordbookPicker() {
  return /Android/i.test(navigator.userAgent || "") && !!dom.wordbookPickerBtn && !!dom.wordbookPickerModal
}

function openWordbookPicker(trigger = dom.wordbookPickerBtn) {
  renderWordbookPicker()
  if (dom.wordbookPickerBtn) dom.wordbookPickerBtn.setAttribute("aria-expanded", "true")
  setModalVisible(dom.wordbookPickerModal, true, { trigger, motion: "origin" })
}

function closeWordbookPicker() {
  if (dom.wordbookPickerBtn) dom.wordbookPickerBtn.setAttribute("aria-expanded", "false")
  setModalVisible(dom.wordbookPickerModal, false)
}

let lookupController = null
let pendingAddWordAfterRoundFull = null
let announcementModal = null
let announcementUnreadIds = []
let announcementCheckTimer = 0

function buildAnnouncementModalDom() {
  const modal = document.createElement("div")
  modal.className = "modal hidden"
  modal.id = "announcementModal"
  modal.setAttribute("aria-hidden", "true")
  modal.innerHTML = `
    <div class="modal-backdrop" data-announcement-close="1"></div>
    <div class="modal-panel announcement-modal-panel" role="dialog" aria-modal="true" aria-labelledby="announcementTitle">
      <div class="modal-header">
        <h2 id="announcementTitle">系统公告</h2>
        <div class="modal-actions">
          <button class="ghost" id="announcementCloseBtn" type="button" aria-label="关闭公告">关闭</button>
        </div>
      </div>
      <div class="modal-body">
        <div class="announcement-list" id="announcementList"></div>
      </div>
    </div>
  `
  modal.addEventListener("click", (e) => {
    const target = e.target instanceof Element ? e.target : null
    if (target && target.dataset.announcementClose === "1") dismissAnnouncementModal()
  })
  modal.querySelector("#announcementCloseBtn")?.addEventListener("click", () => dismissAnnouncementModal())
  document.body.appendChild(modal)
  return modal
}

function ensureAnnouncementModal() {
  if (announcementModal) return announcementModal
  announcementModal = buildAnnouncementModalDom()
  return announcementModal
}

const escapeHtmlAttr = window.A4Sanitize.escapeHtml

function renderAnnouncementList(announcements) {
  const modal = ensureAnnouncementModal()
  const list = modal.querySelector("#announcementList")
  if (!list) return
  const items = Array.isArray(announcements) ? announcements : []
  list.innerHTML = items
    .map((item, index) => {
      const title = String(item?.title || "").trim() || `公告 #${item?.id || index + 1}`
      const content = escapeHtmlAttr(item?.content || "").replace(/\n/g, "<br />")
      const createdAt = item?.createdAt || item?.created_at || ""
      const meta = createdAt && formatDateTime ? formatDateTime(createdAt) : String(createdAt || "")
      return `
        <article class="announcement-item ${item?.isUnread ? "is-unread" : ""}">
          <div class="announcement-item-head">
            <div>
              <div class="announcement-item-title">${escapeHtmlAttr(title)}</div>
              <div class="announcement-item-meta">${escapeHtmlAttr(meta)}</div>
            </div>
            ${item?.isUnread ? '<span class="announcement-item-badge">新公告</span>' : ""}
          </div>
          <div class="announcement-item-content">${content}</div>
        </article>
      `
    })
    .join("")
}

async function dismissAnnouncementModal() {
  const unreadIds = announcementUnreadIds.slice()
  announcementUnreadIds = []
  if (unreadIds.length && window.A4Cloud?.markAnnouncementsRead) {
    try {
      await window.A4Cloud.markAnnouncementsRead(unreadIds)
    } catch { /* ignore */ }
  }
  setModalVisible(ensureAnnouncementModal(), false)
}

async function checkAnnouncements() {
  if (window.A4Router?.isActive && !window.A4Router.isActive("study")) return
  if (!window.A4Cloud?.isLoggedIn?.()) return
  if (!window.A4Cloud?.fetchAnnouncements) return
  try {
    const result = await window.A4Cloud.fetchAnnouncements(10)
    if (window.A4Router?.isActive && !window.A4Router.isActive("study")) return
    if (!result?.success) return
    const unreadIds = Array.isArray(result.unreadIds) ? result.unreadIds.filter((id) => Number.isFinite(Number(id))) : []
    if (!unreadIds.length) return
    announcementUnreadIds = unreadIds
    renderAnnouncementList(Array.isArray(result.announcements) ? result.announcements : [])
    setModalVisible(ensureAnnouncementModal(), true, { motion: "neutral" })
  } catch { /* ignore */ }
}

function scheduleAnnouncementCheck(delayMs = 0) {
  if (announcementCheckTimer) window.clearTimeout(announcementCheckTimer)
  announcementCheckTimer = window.setTimeout(() => {
    announcementCheckTimer = 0
    checkAnnouncements()
  }, Math.max(0, Math.round(Number(delayMs) || 0)))
}

function openSettingsModal() {
  if (window.A4Router?.navigate?.("settings", { queue: true }) === true) return
  const href = "./settings.html?from=study"
  if (window.A4Motion?.navigate?.(href) === true) return
  window.location.assign(href)
}

function openLookupModal({ preset, trigger = document.activeElement || null } = {}) {
  if (lookupController) {
    lookupController.open({ preset, trigger })
    return
  }
  showNoticeDialog({ title: "查词不可用", message: "查词模块未加载。", trigger })
}

// appState 以 showMeaning 表示释义开关，持久化时再写回 meaningVisible，避免内存中出现两份不同步的值。
function omitMeaningVisible(preferences) {
  const rest = { ...preferences }
  delete rest.meaningVisible
  return rest
}

function saveState(state) {
  window.A4Storage?.saveState?.(state)
}

function loadState() {
  return window.A4Storage?.loadState?.() || null
}

const dom = {
  roundBadge: document.getElementById("roundBadge"),
  roundProgress: document.getElementById("roundProgress"),
  roundStatusCounts: document.getElementById("roundStatusCounts"),
  nextBtn: document.getElementById("nextBtn"),
  reviewBtn: document.getElementById("reviewBtn"),
  newRoundBtn: document.getElementById("newRoundBtn"),
  wordbookSelect: document.getElementById("wordbookSelect"),
  wordbookPickerBtn: document.getElementById("wordbookPickerBtn"),
  wordbookPickerText: document.getElementById("wordbookPickerText"),
  wordbookPickerModal: document.getElementById("wordbookPickerModal"),
  wordbookPickerBackdrop: document.getElementById("wordbookPickerBackdrop"),
  wordbookPickerCloseBtn: document.getElementById("wordbookPickerCloseBtn"),
  wordbookPickerList: document.getElementById("wordbookPickerList"),
  mobileRoundBadge: document.getElementById("mobileRoundBadge"),
  paperMeta: document.getElementById("paperMeta"),
  mobileMoreBtn: document.getElementById("mobileMoreBtn"),
  mobileMoreTools: document.getElementById("mobileMoreTools"),
  mobileMoreMenu: document.getElementById("mobileMoreMenu"),
  paperReviewBtn: document.getElementById("paperReviewBtn"),
  paperMeaningBtn: document.getElementById("paperMeaningBtn"),
  paperMeaningLabel: document.getElementById("paperMeaningLabel"),
  paperImmersiveExitBtn: document.getElementById("paperImmersiveExitBtn"),
  dockNextBtn: document.getElementById("dockNextBtn"),
  desktopToolsBtn: document.getElementById("desktopToolsBtn"),
  desktopToolsPopover: document.getElementById("desktopToolsPopover"),
  importWordbookBtn: document.getElementById("importWordbookBtn"),
  importFile: document.getElementById("importFile"),
  importModal: document.getElementById("importModal"),
  importBackdrop: document.getElementById("importBackdrop"),
  closeImportBtn: document.getElementById("closeImportBtn"),
  importLocalBtn: document.getElementById("importLocalBtn"),
  importCet4Btn: document.getElementById("importCet4Btn"),
  importCet6Btn: document.getElementById("importCet6Btn"),
  remoteImportModal: document.getElementById("remoteImportModal"),
  remoteImportBackdrop: document.getElementById("remoteImportBackdrop"),
  closeRemoteImportBtn: document.getElementById("closeRemoteImportBtn"),
  remoteImportMeta: document.getElementById("remoteImportMeta"),
  remoteImportFilterInput: document.getElementById("remoteImportFilterInput"),
  remoteImportSelect: document.getElementById("remoteImportSelect"),
  confirmRemoteImportBtn: document.getElementById("confirmRemoteImportBtn"),
  remoteImportHint: document.getElementById("remoteImportHint"),
  customWordbooksList: document.getElementById("customWordbooksList"),
  customWordbooksEmpty: document.getElementById("customWordbooksEmpty"),
  introBtn: document.getElementById("introBtn"),
  lookupBtn: document.getElementById("lookupBtn"),
  introModal: document.getElementById("introModal"),
  introBackdrop: document.getElementById("introBackdrop"),
  closeIntroBtn: document.getElementById("closeIntroBtn"),
  toggleMeaningBtn: document.getElementById("toggleMeaningBtn"),
  toggleImmersiveBtn: document.getElementById("toggleImmersiveBtn"),
  paper: document.getElementById("paper"),
  paperInner: document.getElementById("paperInner"),
  paperHint: document.getElementById("paperHint"),
  pageNav: document.getElementById("pageNav"),
  pagePrevBtn: document.getElementById("pagePrevBtn"),
  pageNextBtn: document.getElementById("pageNextBtn"),
  pageIndicator: document.getElementById("pageIndicator"),
  reviewModal: document.getElementById("reviewModal"),
  reviewTitleEl: document.getElementById("reviewTitle"),
  reviewBackdrop: document.getElementById("reviewBackdrop"),
  reviewMeta: document.getElementById("reviewMeta"),
  reviewCard: document.getElementById("reviewCard"),
  reviewCardProgress: document.getElementById("reviewCardProgress"),
  reviewCardTerm: document.getElementById("reviewCardTerm"),
  reviewCardMeaning: document.getElementById("reviewCardMeaning"),
  reviewCardHint: document.getElementById("reviewCardHint"),
  reviewKnownBtn: document.getElementById("reviewKnownBtn"),
  reviewLearningBtn: document.getElementById("reviewLearningBtn"),
  reviewUnknownBtn: document.getElementById("reviewUnknownBtn"),
  closeReviewBtn: document.getElementById("closeReviewBtn"),
  shuffleBtn: document.getElementById("shuffleBtn"),
  roundFullModal: document.getElementById("roundFullModal"),
  roundFullBackdrop: document.getElementById("roundFullBackdrop"),
  closeRoundFullBtn: document.getElementById("closeRoundFullBtn"),
  roundFullMeta: document.getElementById("roundFullMeta"),
  continueRoundBtn: document.getElementById("continueRoundBtn"),
  reviewFromFullBtn: document.getElementById("reviewFromFullBtn"),
}

const appState = {
  // 偏好字段的默认值统一来自 js/core/state-schema.js；showMeaning 即持久化的 meaningVisible
  ...omitMeaningVisible(normalizePreferences(null)),
  builtInWordbooks: getWordbooksFromGlobal(),
  customWordbooks: [],
  selectedWordbookId: "",
  selectedWordbookIdByLang: {},
  sourceWords: [],
  pool: [],
  poolIndex: 0,
  placed: [],
  // 复习弹窗顺序控制：
  // - 手动“复习本轮”：每次打开默认打乱（不置顶）
  // - “下一个单词”后的自动复习：置顶本次新加入的 roundItem，其余旧词按当前复习顺序规则排列
  // - reviewOrderPreferenceShuffled：用户在弹窗内选择“打乱/恢复”的偏好，仅用于后续自动复习（不写入 localStorage）
  reviewShuffled: false,
  reviewPinnedRoundItem: null,
  reviewOrderPreferenceShuffled: null,
  rounds: [],
  currentRoundId: "",
  pendingReviewRoundId: "",
  pendingGenerateStatusKind: "",
  currentPageIndex: 0,
  systemPrefersDark: false,
  unknownTerms: [],
  reviewQueue: [],
  reviewIndex: 0,
  reviewContinuousAction: "",
  reviewScope: "round",
  reviewScopePageIndex: 0,
}

const {
  getPaperInnerSize,
  fitWordElementsInPaper,
  fitWordElementInPaper,
  spreadOverlappingWords,
  placeWordElement,
} = appInternal.paperLayout.createPaperLayout({
  paperInner: dom.paperInner,
  getPlaced: () => appState.placed,
})

function getLangBase(value) {
  const raw = String(value || "").trim()
  if (!raw) return ""
  return normalizeLangTag ? normalizeLangTag(raw).base : raw.toLowerCase().split("-")[0]
}

function getWordbookLangBase(book) {
  const b = book && typeof book === "object" ? book : {}
  return getLangBase(b.language) || "en"
}

function getActiveLangBase() {
  const override = String(appState.pronunciationLang || "").trim().toLowerCase()
  if (override && override !== "auto") return override
  const book = getSelectedWordbook()
  return getWordbookLangBase(book)
}

function getLangLabel(base) {
  const b = String(base || "").toLowerCase()
  if (b === "en") return "英语"
  if (b === "es") return "西语"
  if (b === "ja") return "日语"
  if (b === "ko") return "韩语"
  if (b === "fr") return "法语"
  if (b === "de") return "德语"
  if (b === "it") return "意大利语"
  if (b === "pt") return "葡语"
  if (b === "ru") return "俄语"
  return b || "其他"
}

function getUnknownTermKey({ term, langBase }) {
  const t = String(term || "").trim()
  if (!t) return ""
  const base = String(langBase || "").trim().toLowerCase() || "en"
  return `${base}||${t.toLowerCase()}`
}

function getRoundTypeFromKind(kind) {
  if (kind === "due") return ROUND_TYPE_DUE
  const s = normalizeStatus(kind)
  if (s === STATUS_MASTERED) return ROUND_TYPE_MASTERED
  if (s === STATUS_LEARNING) return ROUND_TYPE_LEARNING
  if (s === STATUS_UNKNOWN) return ROUND_TYPE_UNKNOWN
  return ROUND_TYPE_NORMAL
}



function updatePageNav() {
  const round = getCurrentRound()
  const pageCount = getRoundPageCount(round)
  const idx = clamp(Math.floor(Number(appState.currentPageIndex) || 0), 0, Math.max(0, pageCount - 1))
  appState.currentPageIndex = idx
  if (dom.pageNav) dom.pageNav.classList.toggle("hidden", pageCount <= 1)
  if (dom.pageIndicator) dom.pageIndicator.textContent = `${idx + 1} / ${pageCount}`
  if (dom.pagePrevBtn) dom.pagePrevBtn.disabled = idx <= 0
  if (dom.pageNextBtn) dom.pageNextBtn.disabled = idx >= pageCount - 1
}

function updateImmersiveToggle() {
  if (dom.toggleImmersiveBtn) {
    dom.toggleImmersiveBtn.textContent = `沉浸模式：${appState.immersiveMode ? "开" : "关"}`
    dom.toggleImmersiveBtn.setAttribute("aria-pressed", appState.immersiveMode ? "true" : "false")
  }
  dom.paperImmersiveExitBtn?.classList.toggle("hidden", !appState.immersiveMode)
  document.body.classList.toggle("immersive", appState.immersiveMode)
}

function getResolvedDarkMode() {
  const mode = appState.themeMode
  if (mode === "dark") return true
  if (mode === "light") return false
  return !!appState.systemPrefersDark
}

function applyTheme() {
  const dark = getResolvedDarkMode()
  if (dark) document.body.classList.add("theme-dark")
  else document.body.classList.remove("theme-dark")
  const palette = normalizeThemePalette(appState.themePalette)
  document.body.classList.toggle("theme-palette-paper", palette === "paper")
  document.body.classList.toggle("theme-palette-ocean", palette === "ocean")
}

const themeMedia = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null
function syncStudySystemTheme(matches, { apply = true } = {}) {
  if (typeof syncSystemThemePreference === "function") {
    return syncSystemThemePreference({
      state: appState,
      matches,
      active:
        apply &&
        (!window.A4Router?.isActive || window.A4Router.isActive("study")),
      applyTheme,
    })
  }
  appState.systemPrefersDark = !!matches
  if (apply && appState.themeMode === "auto") applyTheme()
  return appState.systemPrefersDark
}

if (themeMedia && typeof themeMedia.matches === "boolean") syncStudySystemTheme(themeMedia.matches)
if (themeMedia && typeof themeMedia.addEventListener === "function") {
  themeMedia.addEventListener("change", (e) => syncStudySystemTheme(e.matches))
} else if (themeMedia && typeof themeMedia.addListener === "function") {
  themeMedia.addListener((e) => syncStudySystemTheme(e.matches))
}

function getAllWordbooks() {
  return [...appState.builtInWordbooks, ...appState.customWordbooks]
}

function isCustomWordbookId(wordbookId) {
  return appState.customWordbooks.some((b) => b.id === wordbookId)
}

function renderCustomWordbooksManage() {
  const listEl = dom.customWordbooksList
  const emptyEl = dom.customWordbooksEmpty
  if (!listEl || !emptyEl) return

  listEl.innerHTML = ""
  const books = appState.customWordbooks
  if (!books.length) {
    emptyEl.classList.remove("hidden")
    return
  }
  emptyEl.classList.add("hidden")

  for (const b of books) {
    const row = document.createElement("div")
    row.className = "import-manage-row"

    // Header: name + secondary actions
    const header = document.createElement("div")
    header.className = "item-header"

    const meta = document.createElement("div")
    meta.className = "import-manage-meta"
    meta.textContent = `${b.name}（${Array.isArray(b.words) ? b.words.length : 0}）`

    const secondary = document.createElement("div")
    secondary.className = "import-manage-secondary"

    const exp = document.createElement("button")
    exp.className = "ghost icon-btn"
    exp.type = "button"
    exp.innerHTML = "<svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" style=\"margin-right:4px;\"><path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\"></path><polyline points=\"7 10 12 15 17 10\"></polyline><line x1=\"12\" y1=\"15\" x2=\"12\" y2=\"3\"></line></svg>导出"
    exp.addEventListener("click", () => {
      const name = sanitizeFilename(b.name || "wordbook")
      downloadJsonFile({
        filename: `a4-memory-wordbook-${name}-${Date.now()}.json`,
        data: {
          name: b.name || "词书",
          description: String(b.description || "").trim(),
          language: String(b.language || "").trim(),
          words: Array.isArray(b.words) ? b.words : [],
        },
      })
    })

    const del = document.createElement("button")
    del.className = "ghost icon-btn danger"
    del.type = "button"
    del.innerHTML = "<svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" style=\"margin-right:4px;\"><polyline points=\"3 6 5 6 21 6\"></polyline><path d=\"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2\"></path></svg>删除"
    del.addEventListener("click", () => {
      showConfirmDialog(`确定删除词书「${b.name}」？`).then((ok) => {
        if (ok !== true) return
        deleteCustomWordbook(b.id)
      })
    })

    secondary.appendChild(exp)
    secondary.appendChild(del)
    header.appendChild(meta)
    header.appendChild(secondary)

    // Primary action: full width learn button
    const primaryAction = document.createElement("div")
    primaryAction.className = "item-primary-action"

    const learn = document.createElement("button")
    learn.className = "primary"
    learn.type = "button"
    learn.textContent = `开始整本学习（${Array.isArray(b.words) ? b.words.length : 0}词）`
    learn.dataset.action = "learn"
    learn.addEventListener("click", () => {
      generateWordbookRound(b.id)
    })

    primaryAction.appendChild(learn)
    row.appendChild(header)
    row.appendChild(primaryAction)
    listEl.appendChild(row)
  }
}

function deleteCustomWordbook(wordbookId) {
  if (!isCustomWordbookId(wordbookId)) return
  appState.customWordbooks = appState.customWordbooks.filter((b) => b.id !== wordbookId)

  if (appState.selectedWordbookId === wordbookId) {
    const fallback = appState.builtInWordbooks[0]?.id || "empty"
    appState.selectedWordbookId = fallback
  }

  renderWordbookSelect()
  updateSourceWords()
  appState.pool = []
  appState.poolIndex = 0
  persist()
  renderCustomWordbooksManage()
}

function getSelectedWordbook() {
  const all = getAllWordbooks()
  const selected =
    all.find((b) => b.id === appState.selectedWordbookId) ||
    all[0] ||
    ({ id: "empty", name: "空词库", words: [] })
  return selected
}

function applyWordbookSelection(wordbookId) {
  const id = String(wordbookId || "").trim()
  if (id) appState.selectedWordbookId = id
  if (dom.wordbookSelect) dom.wordbookSelect.value = appState.selectedWordbookId
  updateSourceWords()
  updateWordbookPickerButton()
  renderWordbookPicker()
  const round = getCurrentRound()
  const roundType = normalizeRoundType(round?.type || ROUND_TYPE_NORMAL)
  const nextLang = getActiveLangBase()
  const roundLang = getLangBase(round?.language || "")
  if (roundType === ROUND_TYPE_NORMAL && Array.isArray(round?.items) && round.items.length > 0 && roundLang && roundLang !== nextLang) {
    startNextRound()
  } else {
    appState.pool = []
    appState.poolIndex = 0
  }
  persist()
}

function updateSourceWords() {
  const all = getAllWordbooks()
  const restrictBase = appState.pronunciationLang && appState.pronunciationLang !== "auto" ? String(appState.pronunciationLang) : ""
  const preferredBase = getLangBase(restrictBase)

  let book = getSelectedWordbook()
  let base = getWordbookLangBase(book)
  if (preferredBase && base !== preferredBase) {
    const remembered = String(appState.selectedWordbookIdByLang?.[preferredBase] || "").trim()
    const byRemembered = remembered ? all.find((b) => b.id === remembered) : null
    const byFirst = all.find((b) => getWordbookLangBase(b) === preferredBase) || null
    book = byRemembered || byFirst || book
    base = getWordbookLangBase(book)
  }

  appState.selectedWordbookId = book.id
  appState.sourceWords = Array.isArray(book.words) ? book.words.map((w) => ({ ...w, lang: base })) : []
  appState.selectedWordbookIdByLang = {
    ...(appState.selectedWordbookIdByLang && typeof appState.selectedWordbookIdByLang === "object"
      ? appState.selectedWordbookIdByLang
      : {}),
    [base]: book.id,
  }
  dom.wordbookSelect.value = book.id
  updateWordbookPickerButton()
}

function renderWordbookSelect() {
  const all0 = getAllWordbooks()
  const restrictBase =
    appState.pronunciationLang && appState.pronunciationLang !== "auto" ? getLangBase(appState.pronunciationLang) : ""
  const all = restrictBase ? all0.filter((b) => getWordbookLangBase(b) === restrictBase) : all0
  const list = all.length ? all : all0
  dom.wordbookSelect.innerHTML = ""
  const groups = new Map()
  for (const b of list) {
    const base = getWordbookLangBase(b)
    if (!groups.has(base)) groups.set(base, [])
    groups.get(base).push(b)
  }
  const bases = Array.from(groups.keys()).sort((a, b) => a.localeCompare(b))
  for (const base of bases) {
    const label = getLangLabel(base)
    const og = document.createElement("optgroup")
    og.label = label
    const list = groups.get(base) || []
    for (const b of list) {
      const opt = document.createElement("option")
      opt.value = b.id
      opt.textContent = `${b.name}（${Array.isArray(b.words) ? b.words.length : 0}）`
      og.appendChild(opt)
    }
    dom.wordbookSelect.appendChild(og)
  }
  updateSourceWords()
  renderWordbookPicker()
}

function updateWordbookPickerButton() {
  if (!dom.wordbookPickerText) return
  const book = getSelectedWordbook()
  const count = Array.isArray(book.words) ? book.words.length : 0
  dom.wordbookPickerText.textContent = `${book.name || "选择词书"}（${count}）`
}

function renderWordbookPicker() {
  if (!dom.wordbookPickerList || !shouldUseAndroidWordbookPicker()) return
  const all0 = getAllWordbooks()
  const restrictBase =
    appState.pronunciationLang && appState.pronunciationLang !== "auto" ? getLangBase(appState.pronunciationLang) : ""
  const all = restrictBase ? all0.filter((b) => getWordbookLangBase(b) === restrictBase) : all0
  const list = all.length ? all : all0
  dom.wordbookPickerList.innerHTML = ""
  const groups = new Map()
  for (const b of list) {
    const base = getWordbookLangBase(b)
    if (!groups.has(base)) groups.set(base, [])
    groups.get(base).push(b)
  }
  const bases = Array.from(groups.keys()).sort((a, b) => a.localeCompare(b))
  for (const base of bases) {
    const group = document.createElement("div")
    group.className = "wordbook-picker-group"
    const title = document.createElement("div")
    title.className = "wordbook-picker-group-title"
    title.textContent = getLangLabel(base)
    group.appendChild(title)
    for (const b of groups.get(base) || []) {
      const option = document.createElement("button")
      const active = b.id === appState.selectedWordbookId
      option.className = `wordbook-picker-option${active ? " active" : ""}`
      option.type = "button"
      option.dataset.wordbookId = b.id
      option.setAttribute("aria-pressed", active ? "true" : "false")

      const name = document.createElement("span")
      name.className = "wordbook-picker-name"
      name.textContent = b.name || "未命名词书"
      const count = document.createElement("span")
      count.className = "wordbook-picker-count"
      count.textContent = `${Array.isArray(b.words) ? b.words.length : 0} 词`
      option.appendChild(name)
      option.appendChild(count)
      option.addEventListener("click", () => {
        applyWordbookSelection(b.id)
        closeWordbookPicker()
      })
      group.appendChild(option)
    }
    dom.wordbookPickerList.appendChild(group)
  }
}

async function importWordbookFile(file) {
  const text = await file.text()
  let name = stripFileExtension(file.name)
  let description = ""
  let language
  let words

  if (String(file.name || "").toLowerCase().endsWith(".json")) {
    let parsed
    try {
      parsed = JSON.parse(String(text || ""))
    } catch {
      throw new Error("JSON 解析失败，请检查文件格式")
    }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const n = String(parsed.name || "").trim()
      if (n) name = n
      description = String(parsed.description || "").trim()
      language = inferWordbookLanguage({
        rawLanguage: parsed.language,
        name,
        filename: file.name,
        words: Array.isArray(parsed.words) ? parsed.words : [],
      })
      const wordsRaw = Array.isArray(parsed.words) ? parsed.words : []
      words = wordsRaw.map(normalizeWordObject).filter(Boolean)
    } else {
      words = parseWordsFromText({ text, filename: file.name })
      language = inferWordbookLanguage({ rawLanguage: "", name, filename: file.name, words })
    }
  } else {
    words = parseWordsFromText({ text, filename: file.name })
    language = inferWordbookLanguage({ rawLanguage: "", name, filename: file.name, words })
  }

  const id = `import-${makeId()}`
  const book = normalizeWordbookObject({ id, name: name || "导入词书", description, language, words })
  if (!book || !book.words.length) throw new Error("文件中没有可用单词")

  appState.customWordbooks = [...appState.customWordbooks, book]
  appState.selectedWordbookId = book.id
  renderWordbookSelect()
  startNextRound()
  persist()
  return book
}

async function importWordbookFromUrl({ url, name, language, description } = {}) {
  let res
  try {
    res = await fetch(url, { cache: "no-store" })
  } catch (e) {
    throw new Error(`网络请求失败：${e?.message || "无法下载词书文件"}`, { cause: e })
  }
  if (res.status === 403 || res.status === 429) {
    throw new Error("GitHub API 请求过于频繁，请稍后再试")
  }
  if (!res.ok) throw new Error(`下载失败（HTTP ${res.status}）`)
  const ct = String(res.headers?.get?.("content-type") || "").toLowerCase()
  const text = await res.text()

  let words
  let parsedMeta = { name: "", description: "", language: "" }
  const filename = url || name || "remote"
  const looksJson = ct.includes("application/json") || String(filename).toLowerCase().endsWith(".json") || String(url || "").toLowerCase().endsWith(".json")

  if (looksJson) {
    let parsed
    try {
      parsed = JSON.parse(String(text || ""))
    } catch {
      throw new Error("词书 JSON 解析失败，请检查文件格式")
    }
    const extracted = extractWordbookFromRemoteJson(parsed)
    if (!extracted) throw new Error("词书 JSON 结构不符合要求")
    parsedMeta = extracted
    words = extracted.words
  } else {
    words = parseWordsFromText({ text, filename })
  }

  const id = `remote-${makeId()}`
  const explicitName = normalizeWordbookName(name)
  const extractedName = normalizeWordbookName(parsedMeta?.name)
  const derivedName = inferWordbookNameFromDescription(description) || inferWordbookNameFromUrl(url)
  const finalNameBase = extractedName || derivedName || explicitName || "在线词书"
  const existingNames = new Set(getAllWordbooks().map((b) => String(b?.name || "").trim().toLowerCase()).filter(Boolean))
  const finalName = makeUniqueWordbookName(finalNameBase, existingNames) || "在线词书"
  const finalDesc = String(description || parsedMeta?.description || "").trim()
  const inferredLang = inferWordbookLanguage({
    rawLanguage: language || parsedMeta?.language,
    name: finalName,
    filename: filename || url,
    words,
  })
  const book = normalizeWordbookObject({ id, name: finalName, description: finalDesc, language: inferredLang, words })
  if (!book || !book.words.length) throw new Error("词书中没有可用单词")

  appState.customWordbooks = [...appState.customWordbooks, book]
  appState.selectedWordbookId = book.id
  renderWordbookSelect()
  startNextRound()
  persist()
  return book
}

let remoteImportCtx = null
let remoteImportAll = []
let remoteImportView = []

function setRemoteImportHint(text) {
  if (!dom.remoteImportHint) return
  dom.remoteImportHint.textContent = String(text || "")
}

function setRemoteImportMeta(text) {
  if (!dom.remoteImportMeta) return
  dom.remoteImportMeta.textContent = String(text || "")
}

function setRemoteImportBusy(busy) {
  if (dom.confirmRemoteImportBtn) dom.confirmRemoteImportBtn.disabled = !!busy
  if (dom.remoteImportSelect) dom.remoteImportSelect.disabled = !!busy
  if (dom.remoteImportFilterInput) dom.remoteImportFilterInput.disabled = !!busy
  window.A4Utils?.refreshAndroidSelectPickers?.(dom.remoteImportModal)
}

function buildRemoteOptionLabel(item) {
  const path = String(item?.path || "")
  const sizeText = formatFileSize(item?.size)
  const tag = item?.score >= 60 ? "推荐" : item?.score >= 30 ? "可用" : ""
  const suffix = [tag, sizeText].filter(Boolean).join(" · ")
  return `${path}${suffix ? `（${suffix}）` : ""}`
}

function renderRemoteImportOptions({ keyword } = {}) {
  const q = String(keyword || "").trim().toLowerCase()
  remoteImportView = remoteImportAll.filter((it) => {
    if (!q) return true
    const path = String(it?.path || "").toLowerCase()
    return path.includes(q)
  })

  const sel = dom.remoteImportSelect
  if (!sel) return
  sel.innerHTML = ""
  for (const it of remoteImportView) {
    const opt = document.createElement("option")
    opt.value = `${it.branch}:${it.path}`
    opt.textContent = buildRemoteOptionLabel(it)
    sel.appendChild(opt)
  }

  if (remoteImportView.length) sel.value = `${remoteImportView[0].branch}:${remoteImportView[0].path}`
  setRemoteImportHint(remoteImportView.length ? "已加载：请选择一个 JSON 文件后导入。" : "没有找到匹配的 JSON。")
  window.A4Utils?.refreshAndroidSelectPickers?.(dom.remoteImportModal)
}

function getSelectedRemoteImportItem() {
  const sel = dom.remoteImportSelect
  const value = String(sel?.value || "")
  if (!value) return null
  const idx = value.indexOf(":")
  if (idx < 0) return null
  const branch = value.slice(0, idx)
  const path = value.slice(idx + 1)
  return remoteImportAll.find((it) => it.branch === branch && it.path === path) || null
}

async function openRemoteImportPicker({ owner, repo, language, name, trigger } = {}) {
  remoteImportCtx = { owner, repo, language, name }
  setRemoteImportBusy(true)
  setRemoteImportHint("")
  if (dom.remoteImportFilterInput) dom.remoteImportFilterInput.value = ""
  if (dom.remoteImportSelect) dom.remoteImportSelect.innerHTML = ""
  openRemoteImportModal(trigger)
  setRemoteImportMeta(`加载中… · ${owner}/${repo}`)

  let result
  try {
    result = await listGithubJsonFiles({ owner, repo })
  } catch (e) {
    showToast(`在线词书加载失败：${e?.message || "无法获取文件列表"}`)
    result = { owner, repo, branch: "", list: [] }
  }

  remoteImportAll = Array.isArray(result?.list) ? result.list : []
  const branch = String(result?.branch || "")
  setRemoteImportMeta(`${owner}/${repo}${branch ? `（${branch}）` : ""} · 共 ${remoteImportAll.length} 个 JSON`)
  if (!remoteImportAll.length) {
    setRemoteImportHint("未找到可用的 JSON 文件，请检查仓库地址或稍后再试。")
  } else {
    renderRemoteImportOptions({ keyword: "" })
  }
  setRemoteImportBusy(false)
}

function fitPlacedWordsInPaper() {
  const connected = appState.placed.filter((placed) => placed?.el?.isConnected)
  const boxes = fitWordElementsInPaper(connected.map((placed) => placed.el))
  connected.forEach((placed, i) => {
    placed.box = boxes[i]
  })
}

function getCurrentRound() {
  return appState.rounds.find((r) => r.id === appState.currentRoundId) || null
}

function getCurrentRoundIndex() {
  const idx = appState.rounds.findIndex((r) => r.id === appState.currentRoundId)
  return idx >= 0 ? idx : 0
}

function ensureCurrentRound() {
  if (getCurrentRound()) return
  const langBase = getActiveLangBase()
  const next = ensureCurrentRoundState(
    { rounds: appState.rounds, currentRoundId: appState.currentRoundId },
    () => ({
      id: makeId(),
      startedAt: new Date().toISOString(),
      finishedAt: "",
      items: [],
      roundCap: normalizeRoundCap(appState.roundCap),
      type: ROUND_TYPE_NORMAL,
      language: langBase,
    })
  )
  appState.rounds = next.rounds
  appState.currentRoundId = next.currentRoundId
}

function finalizeCurrentRound() {
  const round = getCurrentRound()
  if (!round) return
  if (!round.finishedAt) round.finishedAt = new Date().toISOString()
}

function getRoundLastPageIndex(round) {
  return window.A4Common?.getRoundLastPageIndex?.(round) ?? 0
}

function getRoundItemCountByPage(round, pageIndex) {
  return window.A4Common?.getRoundItemCountOnPage?.(round, pageIndex) ?? 0
}


function getCurrentRoundCap() {
  const round = getCurrentRound()
  const cap = Number(round?.roundCap)
  if (Number.isFinite(cap)) return normalizeRoundCap(cap)
  return normalizeRoundCap(appState.roundCap)
}

let _persistTimer = null
function persistNow() {
  if (_persistTimer) {
    clearTimeout(_persistTimer)
    _persistTimer = null
  }
  _persistImpl()
}
function persist() {
  if (_persistTimer) return
  _persistTimer = setTimeout(() => {
    _persistTimer = null
    _persistImpl()
  }, 80)
}
function _persistImpl() {
  saveState(buildPersistedState(
    { ...appState, meaningVisible: appState.showMeaning },
    { darkMode: getResolvedDarkMode(), currentCount: appState.placed.length }
  ))
}

function renderCurrentRound({ transition = "" } = {}) {
  ensureCurrentRound()
  const round = getCurrentRound()
  if (!round) return
  dom.paperInner.classList.remove("a4-paper-page-forward", "a4-paper-page-back")
  clearPaper()
  appState.placed = []
  const paper = getPaperInnerSize()

  const pageCount = getRoundPageCount(round)
  appState.currentPageIndex = clamp(Math.floor(Number(appState.currentPageIndex) || 0), 0, Math.max(0, pageCount - 1))
  updatePageNav()
  const items = getRoundItemsByPage(round, appState.currentPageIndex)
  const fragment = document.createDocumentFragment()
  for (const item of items) {
    if (!item || !item.word || !item.word.term || !item.pos) continue
    const el = buildWordElement(item.word)
    if (item.fontSize) el.style.fontSize = item.fontSize
    const x = clamp(item.pos.x, 0, 1) * paper.w
    const y = clamp(item.pos.y, 0, 1) * paper.h
    el.style.left = `${x}px`
    el.style.top = `${y}px`
    fragment.appendChild(el)
    appState.placed.push({
      word: item.word,
      roundItem: item,
      box: null,
      el,
      fontSize: item.fontSize || "",
      pos: item.pos,
    })
  }
  dom.paperInner.appendChild(fragment)
  fitPlacedWordsInPaper()
  spreadOverlappingWords()

  const direction = transition === "back" ? "back" : transition === "forward" ? "forward" : ""
  if (direction) {
    void dom.paperInner.offsetWidth
    const className = `a4-paper-page-${direction}`
    dom.paperInner.classList.add(className)
    const onAnimationEnd = (event) => {
      if (event.target !== dom.paperInner) return
      dom.paperInner.classList.remove(className)
      dom.paperInner.removeEventListener("animationend", onAnimationEnd)
    }
    dom.paperInner.addEventListener("animationend", onAnimationEnd)
  }
}

// 开启下一轮：保留历史记录，仅结束当前轮并追加一个新轮次。
function startNextRound() {
  ensureCurrentRound()
  const current = getCurrentRound()
  if (current && current.items.length > 0) finalizeCurrentRound()

  const langBase = getActiveLangBase()
  const round = {
    id: makeId(),
    startedAt: new Date().toISOString(),
    finishedAt: "",
    items: [],
    roundCap: normalizeRoundCap(appState.roundCap),
    type: ROUND_TYPE_NORMAL,
    language: langBase,
  }
  appState.rounds.push(round)
  appState.currentRoundId = round.id
  appState.currentPageIndex = 0

  appState.placed = []
  appState.reviewShuffled = false
  appState.pool = []
  appState.poolIndex = 0
  clearPaper()
  updateBadge()
  updateHint()
  renderStats()
  persist()
}

function updateBadge() {
  ensureCurrentRound()
  const roundNo = getCurrentRoundIndex() + 1
  const round = getCurrentRound()
  const pageCount = getRoundPageCount(round)
  const pageIndex = clamp(Math.floor(Number(appState.currentPageIndex) || 0), 0, Math.max(0, pageCount - 1))
  const cap = getCurrentRoundCap()
  dom.roundBadge.textContent = `第${roundNo}轮 · 第${pageIndex + 1}/${pageCount}张 · ${appState.placed.length}/${cap}`
  if (dom.mobileRoundBadge) dom.mobileRoundBadge.textContent = `${appState.placed.length} / ${cap}`
  if (dom.paperMeta) {
    const total = Array.isArray(round?.items) ? round.items.length : 0
    dom.paperMeta.textContent = `第 ${roundNo} 轮 · ${total} 个词`
  }
  if (dom.roundProgress) dom.roundProgress.style.width = `${(appState.placed.length / cap) * 100}%`
  renderStats()
}

function updateHint() {
  dom.paperHint.style.display = appState.placed.length === 0 ? "block" : "none"
}


function getNextReviewAtIso(status, nowMs) {
  const intervals = normalizeReviewIntervals(appState.reviewIntervals)
  const s = normalizeStatus(status)
  const days =
    s === STATUS_MASTERED ? intervals.masteredDays : s === STATUS_LEARNING ? intervals.learningDays : intervals.unknownDays
  return new Date(nowMs + days * 24 * 60 * 60 * 1000).toISOString()
}

function getRoundStatusCounts(round) {
  const items = Array.isArray(round?.items) ? round.items : []
  let mastered = 0
  let learning = 0
  let unknown = 0
  for (const it of items) {
    const s = normalizeStatus(it?.status)
    if (s === STATUS_MASTERED) mastered += 1
    else if (s === STATUS_LEARNING) learning += 1
    else unknown += 1
  }
  return { mastered, learning, unknown, total: items.length }
}

function getDueTerms(nowMs) {
  if (!appState.reviewSystemEnabled) return []
  const map = buildLatestTermMap(appState.rounds)
  const due = []
  for (const entry of map.values()) {
    const t = parseIsoTime(entry.nextReviewAt)
    if (t !== null && t <= nowMs) due.push(entry)
  }
  due.sort((a, b) => (parseIsoTime(a.nextReviewAt) || 0) - (parseIsoTime(b.nextReviewAt) || 0))
  return due
}

function renderStats() {
  const nowMs = Date.now()
  const round = getCurrentRound()
  const counts = getRoundStatusCounts(round)
  const dueCount = getDueTerms(nowMs).length

  if (dom.roundStatusCounts) {
    const parts = [
      `已掌握 ${counts.mastered}`,
      `学习中 ${counts.learning}`,
      `不会 ${counts.unknown}`,
      `待复习 ${dueCount}`,
    ]
    dom.roundStatusCounts.replaceChildren(
      ...parts.flatMap((text, index) => {
        const part = document.createElement("span")
        part.className = "status-meta-part"
        part.textContent = text
        return index ? [" · ", part] : [part]
      }),
    )
  }
}

function updateMeaningToggle() {
  dom.toggleMeaningBtn.textContent = `显示释义：${appState.showMeaning ? "开" : "关"}`
  if (dom.paperMeaningLabel) dom.paperMeaningLabel.textContent = `释义${appState.showMeaning ? "开" : "关"}`
  if (dom.paperMeaningBtn) dom.paperMeaningBtn.setAttribute("aria-pressed", appState.showMeaning ? "true" : "false")
  if (appState.showMeaning) {
    dom.paper.classList.add("show-meaning")
  } else {
    dom.paper.classList.remove("show-meaning")
  }
  fitPlacedWordsInPaper()
}

function getWordbookLanguageForSpeech() {
  const book = getSelectedWordbook()
  const lang = String(book?.language || "").trim()
  if (lang) return lang
  if (book?.id === "sp4") return "es"
  if (book?.id === "cet4" || book?.id === "cet6") return "en"
  return "en"
}

function speakTerm(term) {
  if (!appState.pronunciationEnabled) return
  const text = String(term || "").trim()
  if (!text) return

  const speech = window.A4Speech
  if (!speech) return

  const wordbookLanguage = getWordbookLanguageForSpeech()
  const resolved = speech.resolveVoice({
    pronunciationEnabled: !!appState.pronunciationEnabled,
    pronunciationLang: appState.pronunciationLang,
    wordbookLanguage,
    accent: appState.pronunciationAccent,
    voiceMode: appState.voiceMode,
    voiceURI: appState.voiceURI,
  })
  if (resolved.ok && resolved.reason === "manual_missing") {
    appState.voiceMode = "auto"
    appState.voiceURI = ""
    persist()
  }

  const targetBase = String(
    resolved?.targetBase ||
      speech.getCurrentLanguageBase?.({
        pronunciationLang: appState.pronunciationLang,
        wordbookLanguage,
      }) ||
      ""
  ).toLowerCase()
  const speakText = targetBase === "es" ? expandSpanishGenderShortForm(text) : text
  const offlineMap =
    appState.offlineVoiceByLang && typeof appState.offlineVoiceByLang === "object"
      ? appState.offlineVoiceByLang
      : {}
  const offlineVoiceId = String(offlineMap[targetBase] || "")

  speech.speak({
    text: speakText,
    pronunciationEnabled: !!appState.pronunciationEnabled,
    pronunciationLang: appState.pronunciationLang,
    wordbookLanguage,
    accent: appState.pronunciationAccent,
    voiceMode: appState.voiceMode,
    voiceURI: appState.voiceURI,
    onlineTtsEnabled: appState.onlineTtsEnabled !== false,
    onlineTtsProvider: appState.onlineTtsProvider,
    ttsMode: appState.ttsMode || "online",
    offlineVoiceId,
  })

}

// ===== 复习弹窗（手动复习 / 自动复习共用渲染）=====
let reviewCardFlipMap = new WeakMap()

function resetReviewCardFlipState() {
  reviewCardFlipMap = new WeakMap()
  for (const e of Array.isArray(appState.reviewQueue) ? appState.reviewQueue : []) {
    if (e?.roundItem) reviewCardFlipMap.set(e.roundItem, false)
  }
  dom.reviewCard?.classList?.remove?.("is-flipped")
}

function refreshReviewList({ scope, pageIndex } = {}) {
  const round = getCurrentRound()
  const rawItems = Array.isArray(round?.items) ? round.items : []
  const t = normalizeRoundType(round?.type || ROUND_TYPE_NORMAL)
  const mode = String(scope || "round")
  const idx = clamp(Math.floor(Number(pageIndex ?? appState.currentPageIndex) || 0), 0, 999)
  const filtered =
    mode === "page" && t === ROUND_TYPE_NORMAL ? rawItems.filter((it) => Math.floor(Number(it?.pageIndex) || 0) === idx) : rawItems
  const base = rawItems
    .filter((it) => filtered.includes(it))
    .filter((it) => it && it.word && it.word.term)
    .map((it) => ({ word: it.word, roundItem: it }))
  const pinned = appState.reviewPinnedRoundItem
  const pinnedIndex = pinned ? base.findIndex((e) => e.roundItem === pinned) : -1
  const pinnedEntry = pinnedIndex >= 0 ? base[pinnedIndex] : null
  const rest = pinnedEntry ? [...base.slice(0, pinnedIndex), ...base.slice(pinnedIndex + 1)] : base
  const orderedRest = appState.reviewShuffled ? shuffle(rest) : rest
  appState.reviewQueue = pinnedEntry ? [pinnedEntry, ...orderedRest] : orderedRest
  appState.reviewIndex = 0
  resetReviewCardFlipState()
  renderReviewCard()
}

function setTermUnknownFlag(term, unknown, langBase) {
  const t = String(term || "").trim()
  if (!t) return
  const base = String(langBase || "").trim().toLowerCase() || getActiveLangBase()
  const key = getUnknownTermKey({ term: t, langBase: base })
  if (!key) return
  const set = new Set(appState.unknownTerms)
  if (unknown) set.add(key)
  else set.delete(key)
  appState.unknownTerms = Array.from(set)
}

function renderReviewCard() {
  const total = appState.reviewQueue.length
  const idx = clamp(appState.reviewIndex, 0, Math.max(0, total - 1))
  appState.reviewIndex = idx

  dom.reviewCard.classList.toggle("review-card-flip-enabled", !!appState.reviewCardFlipEnabled)
  dom.reviewCard.classList.toggle("review-card-swipe-enabled", total > 0)

  const cap = getCurrentRoundCap()
  const scope = String(appState.reviewScope || "round")
  const scopeText = scope === "page" ? "当前页复习" : "整轮复习"
  dom.reviewMeta.textContent = `本轮当前页 ${appState.placed.length}/${cap} · ${scopeText}`

  if (!total) {
    dom.reviewCardProgress.textContent = ""
    dom.reviewCardTerm.textContent = ""
    dom.reviewCardMeaning.textContent = ""
    dom.reviewCardHint.textContent = ""
    dom.reviewCard.classList.remove("is-flipped")
    dom.reviewCard.style.removeProperty("--card-back-scale")
    dom.reviewCard.style.removeProperty("--swipe-x")
    dom.reviewCard.style.removeProperty("--swipe-rot")
    dom.reviewCard.style.removeProperty("--swipe-opacity")
    dom.reviewCard.style.removeProperty("--swipe-right-alpha")
    dom.reviewCard.style.removeProperty("--swipe-left-alpha")
    dom.reviewKnownBtn.disabled = true
    dom.reviewLearningBtn.disabled = true
    dom.reviewUnknownBtn.disabled = true
    return
  }

  const entry = appState.reviewQueue[idx]
  const w = entry?.word
  const flipped = !!appState.reviewCardFlipEnabled && !!reviewCardFlipMap.get(entry?.roundItem)
  dom.reviewCardProgress.textContent = `${idx + 1} / ${total}`
  dom.reviewCardTerm.textContent = w?.term || ""
  dom.reviewCardMeaning.textContent = w?.meaning ? `${w.pos ? `${w.pos} ` : ""}${w.meaning}` : ""
  if (appState.reviewCardFlipEnabled) {
    const text = String(dom.reviewCardMeaning.textContent || "").trim()
    const compact = text.replaceAll(/\s+/g, " ")
    const len = compact.length
    let scale = 1
    if (len > 90) scale = 0.74
    else if (len > 70) scale = 0.8
    else if (len > 54) scale = 0.86
    else if (len > 40) scale = 0.92
    dom.reviewCard.style.setProperty("--card-back-scale", String(scale))
  } else {
    dom.reviewCard.style.removeProperty("--card-back-scale")
  }
  dom.reviewCard.classList.toggle("is-flipped", flipped)
  dom.reviewCardHint.textContent = appState.reviewCardFlipEnabled
    ? "点单词发音；点空白翻面；背面点任意处翻回；左右滑动/拖拽可快速标记（右滑已掌握/左滑不会）"
    : "点击单词可发音；左右滑动/拖拽可快速标记（右滑已掌握/左滑不会）"
  dom.reviewKnownBtn.disabled = false
  dom.reviewLearningBtn.disabled = false
  dom.reviewUnknownBtn.disabled = false
}

// 手动入口：默认打乱顺序，不强制新词置顶。
function openReviewModal(trigger = document.activeElement || null) {
  appState.reviewPinnedRoundItem = null
  appState.reviewContinuousAction = "repeat_round"
  appState.reviewShuffled = true
  if (dom.shuffleBtn) dom.shuffleBtn.textContent = "恢复顺序"
  appState.reviewScope = "round"
  appState.reviewScopePageIndex = clamp(Math.floor(Number(appState.currentPageIndex) || 0), 0, 999)
  refreshReviewList({ scope: "round" })
  if (dom.reviewTitleEl) dom.reviewTitleEl.textContent = "复习轮"
  setModalVisible(dom.reviewModal, true, { trigger, motion: "origin" })
}

// 自动入口：用于“下一个单词”后的强制复习，新词置顶；旧词仍按当前复习顺序规则排列。
function openAutoReviewModal(pinnedRoundItem, trigger = document.activeElement || null) {
  appState.reviewPinnedRoundItem = pinnedRoundItem || null
  appState.reviewContinuousAction = "next_word"
  appState.reviewShuffled =
    typeof appState.reviewOrderPreferenceShuffled === "boolean" ? appState.reviewOrderPreferenceShuffled : true
  if (dom.shuffleBtn) dom.shuffleBtn.textContent = appState.reviewShuffled ? "恢复顺序" : "打乱顺序"
  const round = getCurrentRound()
  const type = normalizeRoundType(round?.type || ROUND_TYPE_NORMAL)
  const pageIndex = clamp(Math.floor(Number(appState.currentPageIndex) || 0), 0, 999)
  if (type === ROUND_TYPE_NORMAL) {
    appState.reviewScope = "page"
    appState.reviewScopePageIndex = pageIndex
    refreshReviewList({ scope: "page", pageIndex })
  } else {
    appState.reviewScope = "round"
    appState.reviewScopePageIndex = pageIndex
    refreshReviewList({ scope: "round" })
  }
  if (dom.reviewTitleEl) dom.reviewTitleEl.textContent = "学习轮"
  setModalVisible(dom.reviewModal, true, { trigger, motion: "origin" })
}

function closeReviewModal() {
  reviewSwipeController.resetToCenter({ hard: true })
  setModalVisible(dom.reviewModal, false)
  appState.reviewPinnedRoundItem = null
  appState.reviewContinuousAction = ""
  dom.reviewCard.classList.remove("is-flipped")
  dom.reviewCard.classList.remove("is-dragging")
  dom.reviewCard.style.removeProperty("--card-back-scale")
  dom.reviewCard.style.removeProperty("--swipe-x")
  dom.reviewCard.style.removeProperty("--swipe-rot")
  dom.reviewCard.style.removeProperty("--swipe-opacity")
  dom.reviewCard.style.removeProperty("--swipe-right-alpha")
  dom.reviewCard.style.removeProperty("--swipe-left-alpha")
  dom.reviewCard.style.removeProperty("transition")
  document.body.classList.remove("no-select")
}

function openRoundFullModal(trigger = document.activeElement || null) {
  ensureCurrentRound()
  const roundNo = getCurrentRoundIndex() + 1
  const cap = getCurrentRoundCap()
  const round = getCurrentRound()
  const type = normalizeRoundType(round?.type || ROUND_TYPE_NORMAL)
  const lastPageIndex = getRoundLastPageIndex(round)
  const pageCount = getRoundPageCount(round)
  const startedAt = formatDateTime(round?.startedAt)
  const cur = clamp(Math.floor(Number(appState.currentPageIndex) || 0), 0, Math.max(0, lastPageIndex))
  const pageNo = cur + 1
  dom.roundFullMeta.textContent =
    type === ROUND_TYPE_NORMAL
      ? `第${roundNo}轮 · 第${pageNo}/${pageCount}张 A4 已写满 ${cap} 个单词（开始于 ${startedAt}）。可在本轮新增下一张 A4 继续学习，或复习本轮。`
      : `第${roundNo}轮已写满（开始于 ${startedAt}）。`
  setModalVisible(dom.roundFullModal, true, { trigger, motion: "origin" })
}

function closeRoundFullModal() {
  setModalVisible(dom.roundFullModal, false)
}

// 当用户在“当前 A4 已满”时仍点击了“下一个单词”，用于在本轮新增一张 A4 后自动补一次“下一个单词”动作。
let pendingNextWordAfterRoundFull = false

function cancelRoundFullModal() {
  pendingNextWordAfterRoundFull = false
  closeRoundFullModal()
}

function showRoundGeneratedToast(label, total, pages) {
  if (total <= 0) return
  showToast(pages <= 1 ? `${label}：共 ${total} 个，已生成 1 页 A4。` : `${label}：共 ${total} 个，已生成 ${pages} 页 A4（同一轮内）。`)
}

// 按每页上限分页排版，toDraft 返回 null 时跳过该词（页内切分保持按原列表位置）。
function layoutRoundPages(round, entries, cap, toDraft) {
  const pages = Math.max(1, Math.ceil(entries.length / cap))
  for (let pageIndex = 0; pageIndex < pages; pageIndex++) {
    clearPaper()
    appState.placed = []
    for (const entry of entries.slice(pageIndex * cap, (pageIndex + 1) * cap)) {
      const draft = toDraft(entry)
      if (!draft) continue
      const placed = placeWordElement(draft.word)
      const fontSize = placed.el.style.fontSize || ""
      const roundItem = {
        word: draft.word,
        pos: placed.pos,
        fontSize,
        createdAt: new Date().toISOString(),
        status: draft.status,
        lastReviewedAt: draft.lastReviewedAt || "",
        nextReviewAt: draft.nextReviewAt || "",
        pageIndex,
      }
      round.items.push(roundItem)
      appState.placed.push({ word: draft.word, roundItem, el: placed.el, box: placed.box, fontSize, pos: placed.pos })
    }
  }
  clearPaper()
}

function generateStatusRound(kind) {
  const cap = normalizeRoundCap(appState.roundCap)
  const nowMs = Date.now()
  const map = buildLatestTermMap(appState.rounds)

  let list
  let title
  if (kind === "due") {
    title = "生成待复习一轮"
    if (!appState.reviewSystemEnabled) {
      showNoticeDialog({ title: "无法生成", message: "当前未启用轻量复习系统，无法生成待复习一轮。" })
      return
    }
    list = getDueTerms(nowMs)
  } else {
    const status = normalizeStatus(kind)
    title =
      status === STATUS_MASTERED
        ? "生成已掌握一轮"
        : status === STATUS_LEARNING
          ? "生成学习中一轮"
          : status === STATUS_UNKNOWN
            ? "生成不会一轮"
            : "生成一轮"
    list = Array.from(map.values()).filter((e) => normalizeStatus(e.status) === status)
    list = shuffle(list)
  }

  const total = list.length
  if (!total) {
    showNoticeDialog({ title: "无法生成", message: "没有可用单词可以生成。" })
    return
  }

  showRoundGeneratedToast(title, total, Math.max(1, Math.ceil(total / cap)))

  startNextRound()
  const round = getCurrentRound()
  if (!round) return
  round.type = getRoundTypeFromKind(kind)
  round.items = []
  appState.currentPageIndex = 0

  layoutRoundPages(round, list, cap, (entry) => {
    const word = entry?.word
    if (!word || !word.term) return null
    return {
      word,
      status: normalizeStatus(entry?.status),
      lastReviewedAt: String(entry?.lastReviewedAt || ""),
      nextReviewAt: String(entry?.nextReviewAt || ""),
    }
  })
  renderCurrentRound()

  updateBadge()
  updateHint()
  renderStats()
  persist()
  refreshReviewList()
  openReviewModal()
}

// 一键生成整轮学习：从词书创建完整 normal round
function generateWordbookRound(wordbookId) {
  const book = appState.customWordbooks.find((b) => b.id === wordbookId)
  if (!book) {
    showNoticeDialog({ title: "无法生成", message: "词书不存在。" })
    return
  }

  const rawWords = Array.isArray(book.words) ? book.words : []
  const words = rawWords.map(normalizeWordObject).filter(Boolean)
  const total = words.length

  if (!total) {
    showNoticeDialog({ title: "无法生成", message: `词书「${book.name}」中没有可用单词。` })
    return
  }

  const cap = normalizeRoundCap(appState.roundCap)
  showRoundGeneratedToast(`词书「${book.name}」`, total, Math.max(1, Math.ceil(total / cap)))

  ensureCurrentRound()
  const current = getCurrentRound()
  if (current && current.items.length > 0) finalizeCurrentRound()

  const langBase = getWordbookLangBase(book)
  const round = {
    id: makeId(),
    startedAt: new Date().toISOString(),
    finishedAt: "",
    items: [],
    roundCap: cap,
    type: ROUND_TYPE_NORMAL,
    language: langBase,
  }
  appState.rounds.push(round)
  appState.currentRoundId = round.id
  appState.currentPageIndex = 0
  appState.placed = []
  appState.reviewShuffled = false
  appState.pool = []
  appState.poolIndex = 0

  const addedKeys = new Set()
  layoutRoundPages(round, words, cap, (w) => {
    const word = { ...w, lang: getLangBase(w?.lang || "") || langBase }
    const key = getWordMeaningKey(word)
    if (!key || addedKeys.has(key)) return null
    addedKeys.add(key)
    return { word, status: STATUS_UNKNOWN }
  })

  closeImportModal()
  renderCurrentRound()
  updatePageNav()
  updateBadge()
  updateHint()
  renderStats()
  persist()
}

function getWordMeaningKey(word) {
  const w = word && typeof word === "object" ? word : {}
  const f = window.A4Common?.getWordKey
  if (typeof f === "function") return f(w)
  const term = String(w?.term || "").trim().toLowerCase()
  const meaning = normalizeMeaningKey(w?.meaning)
  if (!term) return ""
  if (!meaning) return term
  return `${term}||${meaning}`
}

function getRoundItemKey(roundItem, round) {
  const it = roundItem && typeof roundItem === "object" ? roundItem : {}
  const r = round && typeof round === "object" ? round : {}
  const word = it?.word && typeof it.word === "object" ? it.word : {}
  const langBase = getLangBase(it?.lang || word?.lang || r?.language || "")
  if (langBase) return getWordMeaningKey({ ...word, lang: langBase })
  return getWordMeaningKey(word)
}

function buildCurrentRoundWordKeySet() {
  const round = getCurrentRound()
  const items = Array.isArray(round?.items) ? round.items : []
  const set = new Set()
  for (const it of items) {
    const key = getRoundItemKey(it, round)
    if (key) set.add(key)
  }
  return set
}

function ensurePool() {
  if (appState.pool.length > 0 && appState.poolIndex < appState.pool.length) return
  const unknownSet = new Set(appState.unknownTerms)
  const unknown = appState.sourceWords.filter((w) => {
    const term = String(w?.term || "").trim()
    if (!term) return false
    const k = getUnknownTermKey({ term, langBase: getLangBase(w?.lang || "") || getActiveLangBase() })
    return unknownSet.has(k) || unknownSet.has(term)
  })
  const rest = appState.sourceWords.filter((w) => {
    const term = String(w?.term || "").trim()
    if (!term) return false
    const k = getUnknownTermKey({ term, langBase: getLangBase(w?.lang || "") || getActiveLangBase() })
    return !(unknownSet.has(k) || unknownSet.has(term))
  })
  const merged = [...shuffle(unknown), ...shuffle(rest)]
  const seen = new Set()
  appState.pool = merged.filter((w) => {
    const key = getWordMeaningKey(w)
    if (!key) return false
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  appState.poolIndex = 0
}

function pickNextWord() {
  ensurePool()
  const currentKeys = buildCurrentRoundWordKeySet()
  while (appState.poolIndex < appState.pool.length) {
    const word = appState.pool[appState.poolIndex]
    appState.poolIndex = clamp(appState.poolIndex + 1, 0, appState.pool.length)
    const key = getWordMeaningKey(word)
    if (!key) continue
    if (currentKeys.has(key)) continue
    return word || null
  }
  return null
}

function clearPaper() {
  dom.paperInner.innerHTML = ""
  appState.placed = []
}

function newRound() {
  startNextRound()
}

function restore({ showStartupPrompts = false } = {}) {
  const saved = loadState()
  if (!saved) {
    appState.customWordbooks = []
    appState.selectedWordbookId = getAllWordbooks()[0]?.id || "empty"
    renderWordbookSelect()
    ensureCurrentRound()
    updateImmersiveToggle()
    applyTheme()
    persist()
    if (showStartupPrompts) {
      try {
        const seen = localStorage.getItem(INTRO_SEEN_KEY)
        if (!seen) requestAnimationFrame(() => openIntroModal())
      } catch { /* ignore */ }
      scheduleAnnouncementCheck(300)
    }
    return
  }
  Object.assign(appState, omitMeaningVisible(normalizePreferences(saved)))
  updateMeaningToggle()
  updateImmersiveToggle()

  const unknownRaw = Array.isArray(saved.unknownTerms)
    ? saved.unknownTerms.map((s) => String(s || "").trim()).filter(Boolean)
    : []
  const fallbackLang = getActiveLangBase()
  appState.unknownTerms = unknownRaw
    .map((s) => {
      if (!s) return ""
      if (s.includes("||")) return s
      return getUnknownTermKey({ term: s, langBase: fallbackLang })
    })
    .filter(Boolean)

  applyTheme()

  appState.customWordbooks = Array.isArray(saved.customWordbooks)
    ? saved.customWordbooks.map(normalizeWordbookObject).filter(Boolean)
    : []
  if (appState.customWordbooks.length) {
    const used = new Set(appState.builtInWordbooks.map((b) => String(b?.name || "").trim().toLowerCase()).filter(Boolean))
    const nextBooks = []
    for (const b of appState.customWordbooks) {
      let nextName = String(b?.name || "").trim()
      const desc = String(b?.description || "").trim()
      const slash = desc.indexOf("/")
      const owner = slash > 0 ? desc.slice(0, slash).trim() : ""
      const m = /（([^）]+)）$/.exec(nextName)
      const suffix = m ? String(m[1] || "").trim() : ""
      const prefix = m ? nextName.slice(0, m.index).trim() : nextName
      const derived = inferWordbookNameFromDescription(desc)
      const generic = owner && suffix && owner === suffix && /词库/.test(prefix) && derived
      if (generic) nextName = derived
      nextName = makeUniqueWordbookName(nextName, used) || nextName
      nextBooks.push({ ...b, name: nextName })
    }
    appState.customWordbooks = nextBooks
  }
  appState.selectedWordbookId = typeof saved.selectedWordbookId === "string" ? saved.selectedWordbookId : ""
  appState.pendingReviewRoundId =
    typeof saved.pendingReviewRoundId === "string" ? saved.pendingReviewRoundId : ""
  appState.pendingGenerateStatusKind = normalizePendingKind(saved.pendingGenerateStatusKind)
  const pendingOpenSettings = !!saved.pendingOpenSettings
  if (pendingOpenSettings) {
    try {
      saveState({ ...saved, pendingOpenSettings: false })
    } catch { /* ignore */ }
  }
  renderWordbookSelect()

  if (saved.version === 2 && Array.isArray(saved.rounds) && typeof saved.currentRoundId === "string") {
    appState.rounds = saved.rounds
    appState.currentRoundId = saved.currentRoundId
    appState.currentPageIndex = 0
    const normalizedUnknown = new Set()
    for (const r of appState.rounds) {
      if (!r.type) r.type = ROUND_TYPE_NORMAL
      r.type = normalizeRoundType(r.type)
      const items = Array.isArray(r?.items) ? r.items : []
      for (const it of items) {
        const term = String(it?.word?.term || "").trim()
        if (!term) continue
        const base = getLangBase(it?.lang || it?.word?.lang || r?.language || "")
        if (base) {
          it.lang = base
          if (it.word && typeof it.word === "object") it.word.lang = base
          if (!r.language) r.language = base
        }
        if (!it.status) it.status = STATUS_UNKNOWN
        it.status = normalizeStatus(it.status)
        if (typeof it.lastReviewedAt !== "string") it.lastReviewedAt = ""
        if (typeof it.nextReviewAt !== "string") it.nextReviewAt = ""
        const pi = Number(it.pageIndex)
        it.pageIndex = Number.isFinite(pi) ? Math.max(0, Math.floor(pi)) : 0
      }
    }
    for (const entry of buildLatestTermMap(appState.rounds).values()) {
      if (normalizeStatus(entry.status) === STATUS_UNKNOWN) {
        const base = getLangBase(entry?.word?.lang || "") || fallbackLang
        const k = getUnknownTermKey({ term: entry.term, langBase: base })
        if (k) normalizedUnknown.add(k)
      }
    }
    if (appState.unknownTerms.length === 0) appState.unknownTerms = Array.from(normalizedUnknown)
    ensureCurrentRound()
    renderCurrentRound()
    updateBadge()
    updateHint()
    if (appState.pendingReviewRoundId && appState.pendingReviewRoundId === appState.currentRoundId) {
      appState.pendingReviewRoundId = ""
      persist()
      openReviewModal()
    }
    if (appState.pendingGenerateStatusKind) {
      const kind = appState.pendingGenerateStatusKind
      appState.pendingGenerateStatusKind = ""
      persist()
      requestAnimationFrame(() => generateStatusRound(kind))
    }
    if (pendingOpenSettings) openSettingsModal()
    if (showStartupPrompts) {
      try {
        const seen = localStorage.getItem(INTRO_SEEN_KEY)
        if (!seen) requestAnimationFrame(() => openIntroModal())
      } catch { /* ignore */ }
      scheduleAnnouncementCheck(300)
    }
    return
  }

  const paper = getPaperInnerSize()
  const legacyPlaced = Array.isArray(saved.placed) ? saved.placed : []
  const round = {
    id: makeId(),
    startedAt: new Date().toISOString(),
    finishedAt: "",
    items: [],
    roundCap: normalizeRoundCap(appState.roundCap),
    type: ROUND_TYPE_NORMAL,
  }

  for (const p of legacyPlaced) {
    if (!p || !p.word || !p.word.term || !p.box) continue
    round.items.push({
      word: p.word,
      pos: { x: clamp(p.box.x / paper.w, 0, 1), y: clamp(p.box.y / paper.h, 0, 1) },
      fontSize: p.fontSize || "",
      createdAt: new Date().toISOString(),
      status: STATUS_UNKNOWN,
      lastReviewedAt: "",
      nextReviewAt: "",
      pageIndex: 0,
    })
  }
  if (round.items.length >= normalizeRoundCap(round.roundCap)) round.finishedAt = new Date().toISOString()

  appState.rounds = [round]
  appState.currentRoundId = round.id
  appState.currentPageIndex = 0
  ensureCurrentRound()
  renderCurrentRound()
  updateBadge()
  updateHint()
  persist()
  if (showStartupPrompts) scheduleAnnouncementCheck(300)
}

function buildAllRoundsWordKeySet({ excludeRoundId } = {}) {
  const exclude = String(excludeRoundId || "")
  const set = new Set()
  for (const r of Array.isArray(appState.rounds) ? appState.rounds : []) {
    if (exclude && String(r?.id || "") === exclude) continue
    const items = Array.isArray(r?.items) ? r.items : []
    for (const it of items) {
      const key = getRoundItemKey(it, r)
      if (key) set.add(key)
    }
  }
  return set
}

function pickNextWordPreferUnseenFirst({ globalSeenSet } = {}) {
  ensurePool()
  const seen = globalSeenSet instanceof Set ? globalSeenSet : new Set()
  const currentKeys = buildCurrentRoundWordKeySet()

  const start = clamp(appState.poolIndex, 0, appState.pool.length)
  let foundIndex = -1
  for (let i = start; i < appState.pool.length; i++) {
    const word = appState.pool[i]
    const key = getWordMeaningKey(word)
    if (!key) continue
    if (currentKeys.has(key)) continue
    if (seen.has(key)) continue
    foundIndex = i
    break
  }

  if (foundIndex > start) {
    const tmp = appState.pool[start]
    appState.pool[start] = appState.pool[foundIndex]
    appState.pool[foundIndex] = tmp
  }
  return pickNextWord()
}

function addNextWordToCurrentRound({ preferUnseenFirst } = {}) {
  ensureCurrentRound()
  const round = getCurrentRound()
  if (!round) return null
  const type = normalizeRoundType(round.type || ROUND_TYPE_NORMAL)
  if (type !== ROUND_TYPE_NORMAL) return null

  const cap = getCurrentRoundCap()
  const lastPageIndex = getRoundLastPageIndex(round)
  const cur = clamp(Math.floor(Number(appState.currentPageIndex) || 0), 0, Math.max(0, lastPageIndex))
  const curCount = getRoundItemCountByPage(round, cur)
  const targetPageIndex = curCount >= cap ? lastPageIndex + 1 : cur

  if (targetPageIndex > lastPageIndex) {
    appState.currentPageIndex = targetPageIndex
    clearPaper()
    appState.placed = []
  } else if (appState.currentPageIndex !== targetPageIndex) {
    appState.currentPageIndex = targetPageIndex
    renderCurrentRound()
  }

  const word = preferUnseenFirst
    ? pickNextWordPreferUnseenFirst({ globalSeenSet: buildAllRoundsWordKeySet({ excludeRoundId: appState.currentRoundId }) })
    : pickNextWord()
  if (!word) {
    showToast("当前词书没有更多可用词条（已自动去重本轮同词同义）。")
    return null
  }

  const placed = placeWordElement(word)
  const fontSize = placed.el.style.fontSize || ""
  const langBase = getLangBase(word?.lang || "") || getActiveLangBase()
  if (!round.language) round.language = langBase
  const roundItem = {
    word: { ...word, lang: langBase },
    pos: placed.pos,
    fontSize,
    createdAt: new Date().toISOString(),
    status: STATUS_UNKNOWN,
    lastReviewedAt: "",
    nextReviewAt: "",
    pageIndex: targetPageIndex,
    lang: langBase,
  }
  placed.el.classList.add("word-enter")
  placed.el.addEventListener("animationend", () => placed.el.classList.remove("word-enter"), { once: true })
  appState.placed.push({ word, roundItem, el: placed.el, box: placed.box, fontSize, pos: placed.pos })

  round.items.push(roundItem)
  updatePageNav()

  updateBadge()
  updateHint()
  persist()
  return roundItem
}

// 学习推进入口：写入新词后立刻进入“自动复习”（新词置顶）。
function handleNextWord() {
  ensureCurrentRound()
  const current = getCurrentRound()
  const type = normalizeRoundType(current?.type || ROUND_TYPE_NORMAL)
  if (type !== ROUND_TYPE_NORMAL) startNextRound()

  const round = getCurrentRound()
  const cap = getCurrentRoundCap()
  const lastPageIndex = getRoundLastPageIndex(round)
  const cur = clamp(Math.floor(Number(appState.currentPageIndex) || 0), 0, Math.max(0, lastPageIndex))
  const curCount = getRoundItemCountByPage(round, cur)

  if (curCount >= cap) {
    pendingNextWordAfterRoundFull = true
    openRoundFullModal()
    return
  }
  const roundItem = addNextWordToCurrentRound()
  if (!roundItem) return
  openAutoReviewModal(roundItem)
}

function addSpecificWordToCurrentRound(wordRaw) {
  ensureCurrentRound()
  if (!wordRaw) return null
  const w = normalizeWordObject(wordRaw)
  if (!w || !w.term) return null
  const round = getCurrentRound()
  if (!round) return null
  const type = normalizeRoundType(round.type || ROUND_TYPE_NORMAL)
  if (type !== ROUND_TYPE_NORMAL) return null

  const cap = getCurrentRoundCap()
  const lastPageIndex = getRoundLastPageIndex(round)
  const cur = clamp(Math.floor(Number(appState.currentPageIndex) || 0), 0, Math.max(0, lastPageIndex))
  const curCount = getRoundItemCountByPage(round, cur)
  const targetPageIndex = curCount >= cap ? lastPageIndex + 1 : cur

  if (targetPageIndex > lastPageIndex) {
    appState.currentPageIndex = targetPageIndex
    clearPaper()
    appState.placed = []
  } else if (appState.currentPageIndex !== targetPageIndex) {
    appState.currentPageIndex = targetPageIndex
    renderCurrentRound()
  }

  const currentKeys = buildCurrentRoundWordKeySet()
  const langBase = getLangBase(w?.lang || "") || getActiveLangBase()
  const key = getWordMeaningKey({ ...w, lang: langBase })
  if (!key || currentKeys.has(key)) return null
  const placed = placeWordElement({ ...w, lang: langBase })
  const fontSize = placed.el.style.fontSize || ""
  if (!round.language) round.language = langBase
  const roundItem = {
    word: { ...w, lang: langBase },
    pos: placed.pos,
    fontSize,
    createdAt: new Date().toISOString(),
    status: STATUS_UNKNOWN,
    lastReviewedAt: "",
    nextReviewAt: "",
    pageIndex: targetPageIndex,
    lang: langBase,
  }
  appState.placed.push({ word: w, roundItem, el: placed.el, box: placed.box, fontSize, pos: placed.pos })
  round.items.push(roundItem)
  updatePageNav()
  updateBadge()
  updateHint()
  persist()
  return roundItem
}

function addWordToCurrentRoundFromLookup(wordRaw) {
  ensureCurrentRound()
  const current = getCurrentRound()
  const type = normalizeRoundType(current?.type || ROUND_TYPE_NORMAL)
  if (type !== ROUND_TYPE_NORMAL) startNextRound()

  const round = getCurrentRound()
  const cap = getCurrentRoundCap()
  const lastPageIndex = getRoundLastPageIndex(round)
  const cur = clamp(Math.floor(Number(appState.currentPageIndex) || 0), 0, Math.max(0, lastPageIndex))
  const curCount = getRoundItemCountByPage(round, cur)
  if (curCount >= cap) {
    pendingAddWordAfterRoundFull = normalizeWordObject(wordRaw)
    openRoundFullModal()
    return
  }
  const roundItem = addSpecificWordToCurrentRound(wordRaw)
  if (!roundItem) {
    showToast("未加入：本轮已存在该词条或词条不合法。")
    return
  }
  openAutoReviewModal(roundItem)
}

function openReviewCurrentRound(trigger = document.activeElement || null) {
  openReviewModal(trigger)
}

// ===== 事件绑定（首页）=====
dom.nextBtn.addEventListener("click", () => {
  handleNextWord()
})

dom.reviewBtn.addEventListener("click", (event) => {
  openReviewCurrentRound(event.currentTarget)
})

dom.newRoundBtn.addEventListener("click", () => {
  newRound()
})

if (window.A4Lookup && typeof window.A4Lookup.createLookupModalController === "function") {
  lookupController = window.A4Lookup.createLookupModalController({
    getState: () => appState,
    setState: (patch) => Object.assign(appState, patch),
    persist,
    getWordbookLanguage: () => getWordbookLanguageForSpeech(),
    addWordToCurrentRound: addWordToCurrentRoundFromLookup,
  })
}

dom.dockNextBtn?.addEventListener("click", () => dom.nextBtn.click())
dom.paperReviewBtn?.addEventListener("click", (event) => {
  openReviewCurrentRound(event.currentTarget)
})
dom.paperMeaningBtn?.addEventListener("click", () => dom.toggleMeaningBtn.click())

function setDesktopToolsVisible(visible) {
  if (!dom.desktopToolsPopover) return
  dom.desktopToolsPopover.classList.toggle("hidden", !visible)
  dom.desktopToolsBtn?.setAttribute("aria-expanded", visible ? "true" : "false")
}

dom.desktopToolsBtn?.addEventListener("click", (event) => {
  event.stopPropagation()
  setDesktopToolsVisible(dom.desktopToolsPopover?.classList.contains("hidden") === true)
})

dom.desktopToolsPopover?.addEventListener("click", (event) => event.stopPropagation())
dom.desktopToolsPopover?.querySelectorAll("[data-action-target]").forEach((button) => {
  button.addEventListener("click", () => {
    const target = document.getElementById(button.dataset.actionTarget || "")
    setDesktopToolsVisible(false)
    target?.click?.()
  })
})

function setMobileMoreVisible(visible) {
  if (!dom.mobileMoreTools) return
  dom.mobileMoreTools.open = !!visible
}

dom.mobileMoreTools?.addEventListener("toggle", () => {
  dom.mobileMoreBtn?.setAttribute("aria-expanded", dom.mobileMoreTools.open ? "true" : "false")
})
dom.mobileMoreMenu?.addEventListener("click", (event) => event.stopPropagation())
dom.mobileMoreMenu?.querySelectorAll("[data-action-target]").forEach((button) => {
  button.addEventListener("click", () => {
    const target = document.getElementById(button.dataset.actionTarget || "")
    setMobileMoreVisible(false)
    target?.click?.()
  })
})

document.addEventListener("click", (event) => {
  setDesktopToolsVisible(false)
  if (dom.mobileMoreTools?.open && !dom.mobileMoreTools.contains(event.target)) {
    setMobileMoreVisible(false)
  }
})
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return
  setDesktopToolsVisible(false)
  setMobileMoreVisible(false)
})

dom.lookupBtn?.addEventListener("click", (event) => {
  openLookupModal({ trigger: event.currentTarget })
})

if (shouldUseAndroidWordbookPicker()) {
  document.body.classList.add("android-wordbook-picker")
  dom.wordbookPickerBtn?.classList.remove("hidden")
  dom.wordbookSelect?.setAttribute("aria-hidden", "true")
  dom.wordbookSelect?.setAttribute("tabindex", "-1")
  updateWordbookPickerButton()
}

window.A4Utils?.installAndroidSelectPicker?.(document, "#remoteImportSelect")

dom.wordbookSelect.addEventListener("change", () => {
  applyWordbookSelection(dom.wordbookSelect.value)
})

dom.wordbookPickerBtn?.addEventListener("click", (event) => {
  if (shouldUseAndroidWordbookPicker()) openWordbookPicker(event.currentTarget)
})

dom.wordbookPickerBackdrop?.addEventListener("click", () => closeWordbookPicker())
dom.wordbookPickerCloseBtn?.addEventListener("click", () => closeWordbookPicker())

dom.importWordbookBtn.addEventListener("click", (event) => {
  openImportModal(event.currentTarget)
})

dom.importBackdrop.addEventListener("click", () => closeImportModal())
dom.closeImportBtn.addEventListener("click", () => closeImportModal())

dom.importLocalBtn.addEventListener("click", () => {
  closeImportModal()
  dom.importFile.click()
})

dom.remoteImportBackdrop?.addEventListener("click", () => closeRemoteImportModal())
dom.closeRemoteImportBtn?.addEventListener("click", () => closeRemoteImportModal())
dom.remoteImportFilterInput?.addEventListener("input", () => {
  renderRemoteImportOptions({ keyword: dom.remoteImportFilterInput.value })
})
dom.remoteImportSelect?.addEventListener("change", () => {
  const it = getSelectedRemoteImportItem()
  if (!it) return
  const sizeText = formatFileSize(it.size)
  setRemoteImportHint(`${it.branch}:${it.path}${sizeText ? ` · ${sizeText}` : ""}`)
})
dom.confirmRemoteImportBtn?.addEventListener("click", async () => {
  const it = getSelectedRemoteImportItem()
  if (!it) return
  const ctx = remoteImportCtx || {}
  const rawUrl = `https://raw.githubusercontent.com/${it.owner}/${it.repo}/${it.branch}/${it.path}`
  const desc = `${it.owner}/${it.repo}@${it.branch}:${it.path}`
  setRemoteImportBusy(true)
  setRemoteImportHint("导入中…")
  try {
    const book = await importWordbookFromUrl({
      url: rawUrl,
      name: ctx.name,
      language: ctx.language,
      description: desc,
    })
    if (!book) {
      setRemoteImportHint("导入失败：该 JSON 结构不符合要求，请选择其它文件。")
      return
    }
    closeRemoteImportModal()
  } catch (e) {
    showToast(`导入失败：${e?.message || "无法下载词书"}`)
    setRemoteImportHint("")
  } finally {
    setRemoteImportBusy(false)
  }
})

dom.importCet4Btn.addEventListener("click", async (event) => {
  try {
    closeImportModal()
    await openRemoteImportPicker({
      owner: "k7tmiz",
      repo: "english-vocabulary",
      name: "英语词库（k7tmiz）",
      language: "en",
      trigger: event.currentTarget,
    })
  } catch (e) {
    showToast(`在线词书加载失败：${e?.message || "无法获取文件列表"}`)
  }
})

dom.importCet6Btn.addEventListener("click", async (event) => {
  try {
    closeImportModal()
    await openRemoteImportPicker({
      owner: "k7tmiz",
      repo: "spanish-vocabulary",
      name: "西班牙语词库（k7tmiz）",
      language: "es",
      trigger: event.currentTarget,
    })
  } catch (e) {
    showToast(`在线词书加载失败：${e?.message || "无法获取文件列表"}`)
  }
})

dom.importFile.addEventListener("change", async () => {
  const file = dom.importFile.files && dom.importFile.files[0]
  dom.importFile.value = ""
  if (!file) return
  try {
    await importWordbookFile(file)
  } catch (e) {
    showToast(`导入失败：${e?.message || "无法解析文件"}`)
  }
})

dom.introBtn.addEventListener("click", (event) => {
  openIntroModal(event.currentTarget)
})

dom.introBackdrop.addEventListener("click", () => closeIntroModal())
dom.closeIntroBtn.addEventListener("click", () => closeIntroModal())

dom.toggleMeaningBtn.addEventListener("click", () => {
  appState.showMeaning = !appState.showMeaning
  updateMeaningToggle()
  persist()
})

dom.paperInner.addEventListener("click", (e) => {
  const target = e.target instanceof Element ? e.target : null
  if (!target) return

  const termEl = target.closest(".word-term")
  if (termEl) {
    speakTerm(termEl.textContent)
    e.stopPropagation()
    return
  }

  const itemEl = target.closest(".word-item")
  if (!itemEl) return
  if (appState.showMeaning) itemEl.classList.toggle("hide-meaning")
  else itemEl.classList.toggle("reveal")
  const placed = appState.placed.find((p) => p.el === itemEl)
  if (placed) placed.box = fitWordElementInPaper(itemEl)
})

function toggleImmersiveMode() {
  appState.immersiveMode = !appState.immersiveMode
  updateImmersiveToggle()
  renderCurrentRound()
  persist()
}

dom.toggleImmersiveBtn?.addEventListener("click", toggleImmersiveMode)
dom.paperImmersiveExitBtn?.addEventListener("click", toggleImmersiveMode)

dom.reviewBackdrop.addEventListener("click", () => closeReviewModal())
dom.closeReviewBtn.addEventListener("click", () => closeReviewModal())

dom.pagePrevBtn?.addEventListener("click", () => {
  const round = getCurrentRound()
  const pageCount = getRoundPageCount(round)
  if (pageCount <= 1) return
  appState.currentPageIndex = clamp(appState.currentPageIndex - 1, 0, pageCount - 1)
  renderCurrentRound({ transition: "back" })
  updateBadge()
  updateHint()
})

dom.pageNextBtn?.addEventListener("click", () => {
  const round = getCurrentRound()
  const pageCount = getRoundPageCount(round)
  if (pageCount <= 1) return
  appState.currentPageIndex = clamp(appState.currentPageIndex + 1, 0, pageCount - 1)
  renderCurrentRound({ transition: "forward" })
  updateBadge()
  updateHint()
})

function markCurrentReviewStatus(status) {
  const idx = appState.reviewIndex
  const entry = appState.reviewQueue[idx]
  const w = entry?.word
  const roundItem = entry?.roundItem
  const term = String(w?.term || "").trim()
  if (term && roundItem) {
    const nextStatus = normalizeStatus(status)
    roundItem.status = nextStatus
    const nowMs = Date.now()
    roundItem.lastReviewedAt = new Date(nowMs).toISOString()
    roundItem.nextReviewAt = appState.reviewSystemEnabled ? getNextReviewAtIso(nextStatus, nowMs) : ""
    const langBase = getLangBase(roundItem?.lang || w?.lang || "")
    setTermUnknownFlag(term, nextStatus === STATUS_UNKNOWN, langBase)
    persist()
    renderStats()
  }
}

function advanceReview(status) {
  const idx = appState.reviewIndex
  markCurrentReviewStatus(status)
  const next = idx + 1
  if (next >= appState.reviewQueue.length) {
    const action = String(appState.reviewContinuousAction || "")
    closeReviewModal()
    if (!!appState.continuousStudyMode && action === "next_word") {
      window.requestAnimationFrame(() => {
        handleNextWord()
      })
    } else if (!!appState.continuousStudyMode && action === "repeat_round") {
      window.requestAnimationFrame(() => {
        openReviewModal()
      })
    }
    return
  }
  appState.reviewIndex = next
  renderReviewCard()
}

dom.reviewKnownBtn.addEventListener("click", () => {
  advanceReview(STATUS_MASTERED)
})

dom.reviewLearningBtn.addEventListener("click", () => {
  advanceReview(STATUS_LEARNING)
})

dom.reviewUnknownBtn.addEventListener("click", () => {
  advanceReview(STATUS_UNKNOWN)
})

dom.reviewCardTerm.addEventListener("click", (e) => {
  if (reviewSwipeController.isInteractionBlocked()) return
  e.preventDefault()
  e.stopPropagation()
  speakTerm(dom.reviewCardTerm.textContent)
})

const reviewSwipeController = appInternal.reviewSwipe.createReviewSwipeController({
  card: dom.reviewCard,
  isReviewOpen: () => isModalOpen(dom.reviewModal),
  onCommit: (direction) => advanceReview(direction > 0 ? STATUS_MASTERED : STATUS_UNKNOWN),
})

dom.reviewCard.addEventListener("click", (e) => {
  if (!appState.reviewCardFlipEnabled) return
  if (reviewSwipeController.isInteractionBlocked()) return
  const target = e.target instanceof Element ? e.target : null
  if (target && target.closest(".review-card-term")) return
  const entry = appState.reviewQueue[appState.reviewIndex]
  const roundItem = entry?.roundItem
  if (!roundItem) return
  const flipped = !!reviewCardFlipMap.get(roundItem)
  if (!flipped) {
    reviewCardFlipMap.set(roundItem, true)
  } else {
    reviewCardFlipMap.set(roundItem, false)
  }
  renderReviewCard()
})

dom.shuffleBtn.addEventListener("click", () => {
  appState.reviewShuffled = !appState.reviewShuffled
  appState.reviewOrderPreferenceShuffled = appState.reviewShuffled
  dom.shuffleBtn.textContent = appState.reviewShuffled ? "恢复顺序" : "打乱顺序"
  refreshReviewList()
})

function isModalOpen(modalEl) {
  return !!modalEl && !modalEl.classList.contains("hidden")
}

function isAnyModalOpen() {
  if (window.A4UI?.hasOpenLayer) return window.A4UI.hasOpenLayer()
  return (
    isModalOpen(dom.reviewModal) ||
    isModalOpen(dom.roundFullModal) ||
    isModalOpen(dom.importModal) ||
    isModalOpen(dom.remoteImportModal) ||
    isModalOpen(dom.wordbookPickerModal) ||
    isModalOpen(dom.introModal) ||
    isModalOpen(document.getElementById("lookupModal")) ||
    isModalOpen(document.getElementById("a4-confirm-title")?.closest(".modal"))
  )
}

function isEditingTarget(target) {
  if (!(target instanceof Element)) return false
  const tag = target.tagName ? target.tagName.toLowerCase() : ""
  if (tag === "input" || tag === "textarea" || tag === "select") return true
  return target.isContentEditable
}

window.addEventListener("keydown", (e) => {
  if (e.defaultPrevented) return
  if (window.A4Router?.getCurrentView?.() && window.A4Router.getCurrentView() !== "study") return
  if (e.metaKey || e.ctrlKey || e.altKey) return
  if (isAnyModalOpen()) return
  if (isEditingTarget(e.target)) return

  const key = String(e.key || "")
  const k = key.length === 1 ? key.toLowerCase() : key

  if (key === " " || key === "Spacebar") {
    e.preventDefault()
    handleNextWord()
    return
  }

  if (k === "r") {
    openReviewCurrentRound()
    return
  }

  if (k === "n") {
    newRound()
    return
  }

  if (k === "m") {
    appState.showMeaning = !appState.showMeaning
    updateMeaningToggle()
    persist()
    return
  }

  if (k === "d") {
    appState.themeMode = appState.themeMode === "dark" ? "light" : "dark"
    applyTheme()
    persist()
  }
})

let resizeDebounceTimer = null
window.addEventListener("resize", () => {
  if (resizeDebounceTimer) clearTimeout(resizeDebounceTimer)
  resizeDebounceTimer = setTimeout(() => {
    renderCurrentRound()
  }, 150)
})

window.addEventListener("a4-cloud-auth-changed", (e) => {
  if (window.A4Router?.isActive && !window.A4Router.isActive("study")) return
  const loggedIn = !!(e && e.detail && e.detail.loggedIn)
  if (!loggedIn) {
    announcementUnreadIds = []
    if (announcementModal) setModalVisible(announcementModal, false)
    return
  }
  scheduleAnnouncementCheck(200)
})

updateMeaningToggle()
updateImmersiveToggle()
applyTheme()

function enterStudyView({ initial = false } = {}) {
  if (themeMedia && typeof themeMedia.matches === "boolean") {
    syncStudySystemTheme(themeMedia.matches, { apply: false })
  }
  restore({ showStartupPrompts: initial })
  updateBadge()
  updateHint()
  scheduleAnnouncementCheck(initial ? 300 : 0)
}

const studyRouteRegistered = window.A4Router?.register?.("study", {
  enter: ({ initial }) => enterStudyView({ initial }),
  leave: () => {
    persistNow()
    setDesktopToolsVisible(false)
    setMobileMoreVisible(false)
  },
  exit: persistNow,
})
if (!studyRouteRegistered) enterStudyView({ initial: true })

dom.roundFullBackdrop.addEventListener("click", () => cancelRoundFullModal())
dom.closeRoundFullBtn.addEventListener("click", () => cancelRoundFullModal())
dom.continueRoundBtn.addEventListener("click", () => {
  closeRoundFullModal()
  if (pendingNextWordAfterRoundFull) {
    pendingNextWordAfterRoundFull = false
    const roundItem = addNextWordToCurrentRound({ preferUnseenFirst: true })
    if (roundItem) openAutoReviewModal(roundItem)
  }
  if (pendingAddWordAfterRoundFull) {
    const w = pendingAddWordAfterRoundFull
    pendingAddWordAfterRoundFull = null
    const roundItem = addSpecificWordToCurrentRound(w)
    if (roundItem) openAutoReviewModal(roundItem)
    else showToast("未加入：本轮已存在该词条或词条不合法。")
  }
})
dom.reviewFromFullBtn.addEventListener("click", () => {
  closeRoundFullModal()
  pendingNextWordAfterRoundFull = false
  openReviewCurrentRound()
})
