/**
 * Shared slideshow activation state + idle detection.
 *
 * The globally-mounted SlideshowOverlay renders whenever `active` is true.
 * Idle detection promotes `active` on wall-display devices (useDeviceMode)
 * and on /tv routes after `idleMinutes` (household slideshow settings) of no
 * input. Dismissal is deliberate only — the overlay handles tap/keypress —
 * so a grazed mouse or remote doesn't end the show; it loops until touched.
 * /setup and /unlock never idle into the slideshow. `start()` is the manual
 * entry for the TV slideshow page and the settings preview.
 *
 * The listeners are installed once, in a detached effect scope, so they
 * survive whichever component happened to call this composable first.
 */

let installed = false

export function useIdleSlideshow() {
  const active = useState('slideshow-active', () => false)

  if (import.meta.client && !installed) {
    installed = true

    // Nuxt context is available synchronously here (composable call inside a
    // component setup); the detached scope keeps every effect alive after the
    // first caller unmounts.
    const scope = effectScope(true)
    scope.run(() => {
      const { state } = useBoardState()
      const { isDisplayDevice } = useDeviceMode()
      const route = useRoute()
      const idleMs = computed(() =>
        (state.value?.settings?.slideshow.idleMinutes ?? 10) * 60_000)

      const eligible = computed(() => {
        if (route.path === '/setup' || route.path === '/unlock') return false
        if (route.path.startsWith('/tv')) return true
        return isDisplayDevice.value
      })

      // lastActive updates on any input; the fixed timeout only drives the
      // unused `idle` flag — the real (reactive) threshold is idleMs.
      const { lastActive } = useIdle(60_000)

      useIntervalFn(() => {
        if (active.value || !eligible.value) return
        if (Date.now() - lastActive.value >= idleMs.value) active.value = true
      }, 10_000)

      // Dismissal is handled by the overlay itself (pointerdown/keydown) —
      // mere mouse movement must NOT end the show, or a desktop preview dies
      // the moment the mouse twitches and a wall display stops when bumped.

      // Losing eligibility (e.g. the board locks → /unlock) dismisses too.
      watch(eligible, (ok) => { if (!ok) active.value = false })
    })
  }

  function start() {
    active.value = true
  }

  function stop() {
    active.value = false
  }

  return { active, start, stop }
}
