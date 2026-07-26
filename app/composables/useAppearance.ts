import { fontStack } from '#shared/schemas/fonts'

/** Applies the household's appearance settings globally: the font stack via a
 * CSS variable (Tailwind's --font-sans points at it, so utilities and <body>
 * always agree), the downloaded-font stylesheet if one is configured, and the
 * Nuxt UI accent — per colour mode — via reactive app config.
 * Called once in app.vue. */
export function useAppearance() {
  const { state } = useBoardState()
  const colorMode = useColorMode()
  const appConfig = useAppConfig()

  const appearance = computed(() => state.value?.settings?.appearance)

  const customFont = computed(() => appearance.value?.customFont ?? null)

  useHead({
    htmlAttrs: {
      style: computed(() =>
        `--betts-font: ${fontStack(appearance.value?.font, customFont.value?.family)}`),
    },
    link: computed(() => customFont.value
      // Served from /fonts/** which is deliberately not session-gated, so the
      // household's font also renders on the lock screen. ?v= is a content
      // hash, so re-downloading a family busts the immutable cache.
      ? [{
          rel: 'stylesheet',
          href: `/fonts/${customFont.value.slug}/font.css?v=${customFont.value.version}`,
        }]
      : []),
  })

  watchEffect(() => {
    const a = appearance.value
    const accent = colorMode.value === 'dark'
      ? a?.accentDark ?? 'green'
      : a?.accentLight ?? 'green'
    appConfig.ui.colors.primary = accent
  })
}
