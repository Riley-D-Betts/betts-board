<script setup lang="ts">
// 10-foot UI: scale all rem-based sizing up via the root font-size and keep
// high contrast. D-pad browsers navigate by focus, so focus rings stay visible.
useHead({ htmlAttrs: { class: 'tv-mode' } })
</script>

<template>
  <div class="min-h-dvh bg-slate-950 text-slate-50 [&_*:focus-visible]:outline [&_*:focus-visible]:outline-4 [&_*:focus-visible]:outline-amber-400">
    <slot />
  </div>
</template>
