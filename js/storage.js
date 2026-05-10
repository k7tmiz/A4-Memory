;(function () {
  const STORAGE_KEY = "a4-memory:v1"

  function stripSensitive(state) {
    if (!state || typeof state !== "object") return state
    var stripped = JSON.parse(JSON.stringify(state))
    if (stripped.aiConfig && typeof stripped.aiConfig === "object") {
      stripped.aiConfig.apiKey = ""
    }
    return stripped
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return null
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== "object") return null
      // Clean up API key that may have been persisted by older versions
      return stripSensitive(parsed)
    } catch (e) {
      return null
    }
  }

  function saveState(state) {
    try {
      // Never persist sensitive fields to localStorage
      var safe = JSON.parse(JSON.stringify(state))
      stripSensitive(safe)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(safe))
      return true
    } catch (e) {
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
