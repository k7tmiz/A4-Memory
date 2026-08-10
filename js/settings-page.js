;(function () {
  const storage = window.A4Storage
  const settings = window.A4Settings
  const common = window.A4Common

  function loadSettingsState() {
    const source = storage?.loadState?.()
    return source && typeof source === "object"
      ? source
      : { version: 2, rounds: [], customWordbooks: [], aiConfig: {} }
  }

  let state = loadSettingsState()

  function getResolvedDarkMode() {
    const mode = settings?.normalizeThemeMode?.(state.themeMode) || "auto"
    if (mode === "dark") return true
    if (mode === "light") return false
    return !!window.matchMedia?.("(prefers-color-scheme: dark)")?.matches
  }

  function applyTheme() {
    document.body.classList.toggle("theme-dark", getResolvedDarkMode())
    const palette = settings?.normalizeThemePalette?.(state.themePalette) || "classic"
    document.body.classList.toggle("theme-palette-paper", palette === "paper")
    document.body.classList.toggle("theme-palette-ocean", palette === "ocean")
  }

  function persist() {
    storage?.saveState?.(state)
  }

  function getWordbookLanguage() {
    const selected = String(state.selectedWordbookId || "")
    const builtIn = common?.getWordbooksFromGlobal?.() || []
    const custom = Array.isArray(state.customWordbooks) ? state.customWordbooks : []
    const book = [...builtIn, ...custom].find((item) => String(item?.id || "") === selected)
    return String(book?.language || "").trim() || "en"
  }

  applyTheme()

  const media = window.matchMedia?.("(prefers-color-scheme: dark)")
  const onSystemThemeChange = () => {
    if (window.A4Router?.isActive && !window.A4Router.isActive("settings")) return
    if ((settings?.normalizeThemeMode?.(state.themeMode) || "auto") === "auto") applyTheme()
  }
  media?.addEventListener?.("change", onSystemThemeChange)
  if (!media?.addEventListener) media?.addListener?.(onSystemThemeChange)

  const controller = settings?.createSettingsModalController?.({
    getState: () => state,
    setState: (patch) => Object.assign(state, patch),
    persist,
    applyTheme,
    onAfterChange: () => {},
    getWordbookLanguage,
    presentation: "page",
  })

  function enterSettingsView() {
    state = loadSettingsState()
    applyTheme()
    if (controller) {
      controller.open()
      return
    }
    const mount = document.getElementById("settingsPageMount")
    if (mount) mount.textContent = "设置模块加载失败，请刷新后重试。"
  }

  function leaveSettingsView() {
    controller?.close?.()
    persist()
  }

  const settingsRouteRegistered = window.A4Router?.register?.("settings", {
    enter: enterSettingsView,
    leave: leaveSettingsView,
    exit: persist,
  })
  if (!settingsRouteRegistered) enterSettingsView()
})()
