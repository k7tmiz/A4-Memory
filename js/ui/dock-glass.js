;(function () {
  const DRAG_THRESHOLD_PX = 6
  const FLING_VELOCITY = 0.35
  const MAX_SHIFT_PX = 4

  function prefersReducedMotion(windowRef) {
    return !!windowRef.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value))
  }

  function attachDockGlass({ documentRef = document, windowRef = window } = {}) {
    const dock = documentRef.querySelector?.(".app-dock-shell")
    const nav = dock?.querySelector?.(".app-dock-nav")
    const indicator = nav?.querySelector?.(".app-dock-indicator")
    if (!dock || !nav || !indicator) return null

    let pointerId = null
    let startX = 0
    let lastX = 0
    let lastTime = 0
    let velocity = 0
    let dragPx = 0
    let suppressedClick = false
    let stretchTimer = null

    function items() {
      return Array.from(nav.querySelectorAll(".app-dock-item"))
    }

    function currentIndex() {
      return Math.max(0, items().findIndex((item) => item.classList.contains("active")))
    }

    function tabWidth() {
      return Math.max(1, indicator.getBoundingClientRect?.().width || 1)
    }

    function setVar(name, value) {
      nav.style.setProperty(name, value)
    }

    function resetDragState() {
      nav.classList.remove("is-lifting", "is-dragging")
      setVar("--a4-dock-drag", "0px")
      setVar("--a4-dock-shift", "0px")
      setVar("--a4-dock-sx", "1")
      setVar("--a4-dock-sy", "1")
    }

    function handlePointerDown(event) {
      if (pointerId !== null) return
      if (event.pointerType === "mouse" && event.button !== 0) return
      windowRef.clearTimeout?.(stretchTimer)
      pointerId = event.pointerId
      startX = event.clientX
      lastX = event.clientX
      lastTime = event.timeStamp
      velocity = 0
      dragPx = 0
      nav.classList.add("is-lifting")
    }

    function handlePointerMove(event) {
      if (event.pointerId !== pointerId) return
      const now = event.timeStamp
      const dt = Math.max(1, now - lastTime)
      const delta = event.clientX - lastX
      velocity = velocity * 0.55 + (delta / dt) * 0.45
      lastX = event.clientX
      lastTime = now
      const maxDrag = tabWidth() * (items().length - 1)
      dragPx = clamp(event.clientX - startX, -maxDrag, maxDrag)
      if (Math.abs(dragPx) > DRAG_THRESHOLD_PX) {
        if (!nav.classList.contains("is-dragging")) {
          try {
            nav.setPointerCapture?.(event.pointerId)
          } catch (_err) {
            void 0
          }
        }
        nav.classList.add("is-dragging")
        setVar("--a4-dock-drag", `${dragPx}px`)
        setVar("--a4-dock-shift", `${clamp(dragPx * 0.08, -MAX_SHIFT_PX, MAX_SHIFT_PX)}px`)
      }
    }

    function handlePointerUp(event) {
      if (event.pointerId !== pointerId) return
      const wasDragging = nav.classList.contains("is-dragging")
      const from = currentIndex()
      const maxIndex = items().length - 1
      let target = clamp(from + Math.round(dragPx / tabWidth()), 0, maxIndex)
      if (Math.abs(velocity) > FLING_VELOCITY && Math.sign(velocity) === Math.sign(dragPx)) {
        target = clamp(from + Math.sign(velocity), 0, maxIndex)
      }
      if (wasDragging && Math.abs(dragPx) > DRAG_THRESHOLD_PX) {
        suppressedClick = true
      } else {
        suppressedClick = false
      }

      if (!prefersReducedMotion(windowRef) && wasDragging) {
        const speed = Math.abs(velocity)
        if (speed > 0.4) {
          const stretch = clamp(1 + speed * 0.06 * (dragPx >= 0 ? 1 : -1), 0.94, 1.12)
          const squash = clamp(1 - speed * 0.015, 0.94, 1)
          setVar("--a4-dock-sx", String(stretch))
          setVar("--a4-dock-sy", String(squash))
          stretchTimer = windowRef.setTimeout?.(() => {
            setVar("--a4-dock-sx", "1")
            setVar("--a4-dock-sy", "1")
          }, 130)
        }
      }

      if (nav.hasPointerCapture?.(event.pointerId)) {
        try {
          nav.releasePointerCapture?.(event.pointerId)
        } catch (_err) {
          void 0
        }
      }

      resetDragState()
      pointerId = null
      lastX = 0
      lastTime = 0

      if (wasDragging && target !== from) {
        const view = items()[target]?.dataset?.a4Route
        if (view) windowRef.A4Router?.navigate?.(view, { queue: true })
      }
    }

    function handlePointerCancel(event) {
      if (event.pointerId !== pointerId) return
      pointerId = null
      suppressedClick = false
      resetDragState()
    }

    function handleClickCapture(event) {
      if (suppressedClick) {
        suppressedClick = false
        event.preventDefault()
        event.stopImmediatePropagation()
        return
      }
      const item = event.target?.closest?.(".app-dock-item")
      const route = item?.dataset?.a4Route
      if (route && windowRef.A4Router) {
        event.preventDefault()
        windowRef.A4Router.navigate(route, { queue: true })
      }
    }

    nav.addEventListener("pointerdown", handlePointerDown)
    nav.addEventListener("pointermove", handlePointerMove)
    nav.addEventListener("pointerup", handlePointerUp)
    nav.addEventListener("pointercancel", handlePointerCancel)
    nav.addEventListener("click", handleClickCapture, true)

    return Object.freeze({
      detach() {
        nav.removeEventListener("pointerdown", handlePointerDown)
        nav.removeEventListener("pointermove", handlePointerMove)
        nav.removeEventListener("pointerup", handlePointerUp)
        nav.removeEventListener("pointercancel", handlePointerCancel)
        nav.removeEventListener("click", handleClickCapture, true)
        resetDragState()
        for (const name of ["--a4-dock-drag", "--a4-dock-shift", "--a4-dock-sx", "--a4-dock-sy"]) {
          nav.style.removeProperty(name)
        }
      },
    })
  }

  let controller = null

  function init() {
    if (!controller) controller = attachDockGlass()
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true })
  } else {
    init()
  }

  window.A4DockGlass = Object.freeze({
    attach: attachDockGlass,
    getController: () => controller,
  })
})()