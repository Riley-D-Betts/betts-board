/**
 * Keeps a view current without a manual reload.
 *
 * The dashboard tiles used to fetch once on mount and never again, so the
 * kitchen wall tablet sitting on the dashboard was frozen from the moment it
 * loaded — a chore completed on someone's phone never showed up. Only the
 * slideshow polled.
 *
 * Three triggers, cheapest first:
 *  - a shared mutation tick, so an action in one component updates sibling
 *    components in the same tab immediately (no waiting for a poll)
 *  - window focus / tab becoming visible, so picking the tablet up is instant
 *  - a slow poll while the document is visible, for changes made elsewhere
 *
 * Polling pauses while hidden: a sleeping wall tablet shouldn't wake up every
 * 15 seconds to hit the database.
 */

/** Bump to make every live view refetch at once (e.g. after a mutation). */
export function useDataTick() {
  return useState('board-data-tick', () => 0)
}

/** Call after any mutation so open views update without waiting for a poll. */
export function bumpDataTick() {
  useDataTick().value++
}

export interface LiveRefreshOptions {
  /** Poll interval while visible. 10s keeps the worst case comfortably under
   *  the 15s ceiling; against local SQLite this is nearly free. */
  intervalMs?: number
  /** Set false to opt out of the shared mutation tick. */
  onTick?: boolean
}

export function useLiveRefresh(refresh: () => unknown, options: LiveRefreshOptions = {}) {
  const { intervalMs = 10_000, onTick = true } = options

  // Server-side there is nothing to keep fresh, and timers would leak.
  if (import.meta.server) return

  let running = false
  async function run() {
    // Guard against overlapping runs on a slow connection.
    if (running) return
    running = true
    try {
      await refresh()
    }
    finally {
      running = false
    }
  }

  const { pause, resume } = useIntervalFn(run, intervalMs, { immediate: false })

  function syncToVisibility() {
    if (document.visibilityState === 'visible') {
      void run()
      resume()
    }
    else {
      pause()
    }
  }

  onMounted(syncToVisibility)
  useEventListener(document, 'visibilitychange', syncToVisibility)
  useEventListener(window, 'focus', () => void run())

  if (onTick) {
    const tick = useDataTick()
    watch(tick, () => void run())
  }
}
