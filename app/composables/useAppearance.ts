/** Applies the household's appearance settings globally: font via an html
 * attribute (mapped to font stacks in main.css) and the Nuxt UI primary
 * accent — per color mode — via reactive app config. Called once in app.vue. */
export function useAppearance() {
  const { state } = useBoardState()
  const colorMode = useColorMode()
  const appConfig = useAppConfig()

  const appearance = computed(() => state.value?.settings?.appearance)

  useHead({
    htmlAttrs: {
      'data-font': computed(() => appearance.value?.font ?? 'rounded'),
    },
  })

  watchEffect(() => {
    const a = appearance.value
    const accent = colorMode.value === 'dark'
      ? a?.accentDark ?? 'green'
      : a?.accentLight ?? 'green'
    appConfig.ui.colors.primary = accent
  })
}
