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
