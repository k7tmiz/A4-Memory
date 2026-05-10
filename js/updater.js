;(function () {
  var APP_VERSION = "1.0.3"
  var REPO = "k7tmiz/A4-Memory"
  var CACHE_KEY = "a4-memory:update-check:v1"
  var SKIP_KEY = "a4-memory:update-skip:v1"
  var CACHE_TTL = 24 * 60 * 60 * 1000 // 24h
  var CHECK_DELAY = 3000
  var modal = null

  function parseSemver(v) {
    var m = String(v || "").trim().match(/^v?(\d+)\.(\d+)\.(\d+)/)
    if (!m) return null
    return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) }
  }

  function isNewer(latest, current) {
    if (!latest || !current) return false
    if (latest.major !== current.major) return latest.major > current.major
    if (latest.minor !== current.minor) return latest.minor > current.minor
    return latest.patch > current.patch
  }

  function stripHtml(html) {
    var div = document.createElement("div")
    div.innerHTML = html
    return (div.textContent || div.innerText || "").trim()
  }

  function buildModal() {
    if (modal) return modal

    modal = document.createElement("div")
    modal.className = "modal hidden"
    modal.id = "updateModal"
    modal.setAttribute("aria-hidden", "true")

    var backdrop = document.createElement("div")
    backdrop.className = "modal-backdrop"
    backdrop.setAttribute("data-update-close", "1")

    var panel = document.createElement("div")
    panel.className = "modal-panel"
    panel.style.maxWidth = "480px"

    var header = document.createElement("div")
    header.className = "modal-header"

    var title = document.createElement("h2")
    title.id = "updateTitle"
    title.textContent = "新版本可用"

    var closeBtn = document.createElement("button")
    closeBtn.className = "ghost"
    closeBtn.setAttribute("data-update-close", "1")
    closeBtn.setAttribute("aria-label", "关闭")
    closeBtn.textContent = "✕"

    header.appendChild(title)
    header.appendChild(closeBtn)

    var body = document.createElement("div")
    body.className = "modal-body"
    body.id = "updateBody"
    body.style.lineHeight = "1.6"

    var actions = document.createElement("div")
    actions.className = "modal-actions"
    actions.style.justifyContent = "flex-end"
    actions.style.padding = "0 12px 12px"

    var skipBtn = document.createElement("button")
    skipBtn.className = "ghost"
    skipBtn.id = "updateSkipBtn"
    skipBtn.textContent = "稍后提醒"

    var downloadBtn = document.createElement("button")
    downloadBtn.className = "primary"
    downloadBtn.id = "updateDownloadBtn"
    downloadBtn.textContent = "查看下载"

    actions.appendChild(skipBtn)
    actions.appendChild(downloadBtn)

    panel.appendChild(header)
    panel.appendChild(body)
    panel.appendChild(actions)
    modal.appendChild(backdrop)
    modal.appendChild(panel)

    // Click backdrop or close button to dismiss
    modal.addEventListener("click", function (e) {
      if (e.target.hasAttribute("data-update-close")) {
        dismissModal()
      }
    })

    // Skip button
    skipBtn.addEventListener("click", function () {
      var latest = modal._latestVersion
      if (latest) {
        try { localStorage.setItem(SKIP_KEY, latest) } catch (_) {}
      }
      dismissModal()
    })

    // Download button: open in system browser
    downloadBtn.addEventListener("click", function () {
      var url = modal._releaseUrl || ("https://github.com/" + REPO + "/releases/latest")
      var a = document.createElement("a")
      a.href = url
      a.target = "_blank"
      a.rel = "noopener"
      a.click()
      dismissModal()
    })

    document.body.appendChild(modal)
    return modal
  }

  function dismissModal() {
    if (!modal) return
    if (window.A4Common && window.A4Common.setModalVisible) {
      window.A4Common.setModalVisible(modal, false)
    } else {
      modal.classList.add("hidden")
      modal.setAttribute("aria-hidden", "true")
    }
  }

  function showModal(version, bodyHtml, releaseUrl) {
    var m = buildModal()
    m._latestVersion = version
    m._releaseUrl = releaseUrl

    var titleEl = document.getElementById("updateTitle")
    if (titleEl) titleEl.textContent = "新版本可用 " + version

    var downloadUrl = releaseUrl || ("https://github.com/" + REPO + "/releases/latest")
    var bodyEl = document.getElementById("updateBody")
    if (bodyEl) {
      bodyEl.innerHTML = ""
      var text = stripHtml(bodyHtml || "")
      if (text.length > 300) text = text.slice(0, 300) + "..."
      if (text) {
        var lines = text.split("\n")
        var p = document.createElement("p")
        for (var i = 0; i < lines.length; i++) {
          if (i > 0) p.appendChild(document.createElement("br"))
          p.appendChild(document.createTextNode(lines[i]))
        }
        bodyEl.appendChild(p)
      }
      var footer = document.createElement("div")
      footer.style.cssText = "margin-top:10px;font-size:13px;color:var(--muted);word-break:break-all"
      footer.appendChild(document.createTextNode("下载地址："))
      footer.appendChild(document.createElement("br"))
      var a = document.createElement("a")
      a.href = downloadUrl
      a.target = "_blank"
      a.rel = "noreferrer"
      a.textContent = downloadUrl
      footer.appendChild(a)
      bodyEl.appendChild(footer)
    }

    if (window.A4Common && window.A4Common.setModalVisible) {
      window.A4Common.setModalVisible(m, true)
    } else {
      m.classList.remove("hidden")
      m.setAttribute("aria-hidden", "false")
    }
  }

  function checkUpdate() {
    var cached = null
    try { cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null") } catch (_) {}

    if (cached && cached.ts && (Date.now() - cached.ts) < CACHE_TTL) {
      return
    }

    var url = "https://api.github.com/repos/" + REPO + "/releases/latest"
    fetch(url, { headers: { Accept: "application/vnd.github+json" } })
      .then(function (res) {
        if (!res.ok) throw new Error("GitHub API returned " + res.status)
        return res.json()
      })
      .then(function (release) {
        var tag = (release.tag_name || "").trim()
        if (!tag) return

        var releaseId = Number(release.id) || 0
        var latest = parseSemver(tag)
        var current = parseSemver(APP_VERSION)
        var sameVersionRereleased = false

        if (!isNewer(latest, current)) {
          // Same or older version — but check if release was re-published
          if (cached && cached.releaseId && releaseId !== cached.releaseId && latest && current &&
              latest.major === current.major && latest.minor === current.minor && latest.patch === current.patch) {
            sameVersionRereleased = true
          } else {
            // Cache the check and bail
            try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), releaseId: releaseId })) } catch (_) {}
            return
          }
        }

        // Cache the check
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), releaseId: releaseId })) } catch (_) {}

        // Check if user skipped this version
        var skipped = ""
        try { skipped = localStorage.getItem(SKIP_KEY) || "" } catch (_) {}
        if (skipped === tag && !sameVersionRereleased) return

        // Don't show for prereleases
        if (release.prerelease) return

        showModal(tag, release.body || "", release.html_url || "")
      })
      .catch(function () {
        // Silently fail — no network or GitHub down
      })
  }

  // Always schedule auto-check. On web the version matches so no modal appears.
  setTimeout(checkUpdate, CHECK_DELAY)

  function isTauri() {
    return !!(window.__TAURI_INTERNALS__ || window.__TAURI__)
  }

  // ── Exports ──────────────────────────────────────────────────────────────────
  window.A4Updater = {
    checkUpdate: checkUpdate,
    APP_VERSION: APP_VERSION,
    isTauri: isTauri,
  }
})()
