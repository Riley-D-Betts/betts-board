import type { FinanceSessionState } from '#shared/schemas/finance'

/**
 * Finance lock state, shared across the finance screens.
 *
 * This is a convenience layer, not a security control — the server rejects
 * every finance request without a live session regardless of what the client
 * believes. Its job is to render the lock screen and to stop showing balances
 * the moment the session expires.
 */
export function useFinanceSession() {
  const state = useState<FinanceSessionState | null>('finance-session', () => null)
  const pending = useState('finance-session-pending', () => false)
  // Plain $fetch does NOT forward the session cookie during SSR, so this
  // route would 401 on the server and take the whole page down with it.
  // Same reason useBoardState reaches for it.
  const requestFetch = useRequestFetch()

  async function refresh() {
    state.value = await requestFetch<FinanceSessionState>('/api/finance/session')
    return state.value
  }

  /**
   * Never throws. This is called from the default layout for the nav, and a
   * locked board (or a request arriving mid-lock) must not turn every page in
   * the app into an error — Money simply doesn't appear.
   */
  async function ensureLoaded() {
    if (state.value) return
    try {
      await refresh()
    }
    catch {
      state.value = null
    }
  }

  const unlocked = computed(() => state.value?.unlocked === true)
  const isOwner = computed(() => state.value?.role === 'owner')

  async function unlock(pin: string, deviceLabel?: string) {
    pending.value = true
    try {
      await $fetch('/api/finance/unlock', { method: 'POST', body: { pin, deviceLabel } })
      await refresh()
    }
    finally {
      pending.value = false
    }
  }

  async function lock() {
    await $fetch('/api/finance/lock', { method: 'POST' })
    await refresh()
  }

  async function setPin(pin: string, currentPin?: string) {
    await $fetch('/api/finance/pin', { method: 'POST', body: { pin, currentPin } })
    // Setting a PIN revokes every session, including this one.
    await refresh()
  }

  /**
   * Locks the UI when the server-side session expires, and on a wall display
   * as soon as the screen is hidden. Deliberately NOT on route-away: people
   * bounce to the calendar and back constantly, and re-entering a PIN every
   * time would just teach them to pick a short one.
   */
  function useAutoLock() {
    if (import.meta.server) return
    const { isDisplayDevice } = useDeviceMode()

    let timer: ReturnType<typeof setTimeout> | undefined
    function schedule() {
      clearTimeout(timer)
      const expiresAt = state.value?.expiresAt
      if (!expiresAt) return
      // Re-check just past expiry; the server is the authority on whether the
      // sliding window moved it.
      timer = setTimeout(() => void refresh().then(schedule), Math.max(1000, expiresAt - Date.now() + 500))
    }

    watch(() => state.value?.expiresAt, schedule, { immediate: true })
    onScopeDispose(() => clearTimeout(timer))

    useEventListener(document, 'visibilitychange', () => {
      if (document.visibilityState === 'visible') return void refresh()
      // A tablet on the kitchen wall must not sit unlocked behind a slideshow.
      if (isDisplayDevice.value && unlocked.value) void lock()
    })
  }

  return { state, pending, unlocked, isOwner, refresh, ensureLoaded, unlock, lock, setPin, useAutoLock }
}
