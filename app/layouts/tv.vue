<script setup lang="ts">
// 10-foot UI: the root font scales with the viewport (see main.css) so the
// same layout fills a 720p set and a native-4K panel alike. D-pad browsers
// navigate by focus, so focus rings stay visible in both themes.
const { theme } = useTvTheme()

useHead({ htmlAttrs: { class: 'tv-mode' } })
</script>

<template>
  <!-- min-h-screen (100vh), not dvh: old TV browsers lack dvh and have no
       dynamic chrome to compensate for anyway. Colours come from the --tv-*
       palette rather than dark: variants — see the note in main.css. -->
  <div
    class="tv-theme tv-bg min-h-screen [&_*:focus-visible]:outline [&_*:focus-visible]:outline-4"
    :class="[theme === 'light' ? 'tv-light light' : 'dark']"
    style="--tw-outline-color: var(--tv-focus); outline-color: var(--tv-focus)"
  >
    <slot />
  </div>
</template>

<style scoped>
/* Focus ring colour has to reach the descendants the arbitrary variant styles. */
.tv-theme :deep(*:focus-visible) {
  outline-color: var(--tv-focus);
}
</style>
