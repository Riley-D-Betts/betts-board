interface TvThemeResponse {
  theme: 'light' | 'dark'
  nextChangeAt: number
  source: 'forced' | 'solar' | 'clock'
}

/**
 * Light or dark for the wall display, decided server-side from sunrise/sunset
 * (or the household's forced preference). Sleeps until the next scheduled flip
 * rather than polling, with an hourly safety net in case a suspended tab
 * missed its timer.
 */
export function useTvTheme() {
  const theme = useState<'light' | 'dark'>('tv-theme', () => 'dark')
  let timer: ReturnType<typeof setTimeout> | undefined

  async function load() {
    try {
      const result = await $fetch<TvThemeResponse>('/api/tv/theme')
      theme.value = result.theme
      schedule(result.nextChangeAt)
    }
    catch {
      // Leave the current theme alone — a wall display flickering to light
      // because one request failed would be worse than being briefly stale.
    }
  }

  function schedule(nextChangeAt: number) {
    clearTimeout(timer)
    const delay = nextChangeAt - Date.now()
    // Clamp: never sooner than a second, never longer than an hour, so a
    // sleeping tab or a clock change can't strand the display on one theme.
    timer = setTimeout(load, Math.min(Math.max(delay + 1000, 1000), 3_600_000))
  }

  onMounted(load)
  onBeforeUnmount(() => clearTimeout(timer))

  return { theme }
}
