;(function () {
  const STORAGE_KEY = "a4-memory:v1"

  function stripSensitive(state) {
    if (!state || typeof state !== "object") return state
    if (state.aiConfig && typeof state.aiConfig === "object") {
      state.aiConfig.apiKey = ""
    }
    return state
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return null
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== "object") return null
      // Clean up API key that may have been persisted by older versions
      return stripSensitive(parsed)
    } catch {
      return null
    }
  }

  const SAVE_FAILURE_NOTICE_INTERVAL_MS = 60 * 1000
  let lastSaveFailureNoticeAt = 0

  // 写入失败（通常是本机存储空间已满）时提示用户，同一分钟内只提示一次。
  function notifySaveFailure() {
    const now = Date.now()
    if (now - lastSaveFailureNoticeAt < SAVE_FAILURE_NOTICE_INTERVAL_MS) return
    lastSaveFailureNoticeAt = now
    window.A4Utils?.showToast?.({
      message: "保存失败：本机存储空间不足，最新进度尚未保存。请在「设置 · 账号」导出备份，并删除不用的词书或旧记录。",
      kind: "error",
      duration: 8000,
    })
  }

  function saveState(state) {
    try {
      // Single serialization pass: blank the top-level aiConfig.apiKey without mutating the caller's state
      const serialized = JSON.stringify(state, function (key, value) {
        if (key === "aiConfig" && this === state && value && typeof value === "object") {
          return { ...value, apiKey: "" }
        }
        return value
      })
      localStorage.setItem(STORAGE_KEY, serialized)
      return true
    } catch {
      notifySaveFailure()
      return false
    }
  }

  function readStateRaw() {
    return loadState()
  }

  function writeStateRaw(state) {
    return saveState(state)
  }

  window.A4Storage = {
    STORAGE_KEY,
    loadState,
    saveState,
    readStateRaw,
    writeStateRaw,
  }
})()
