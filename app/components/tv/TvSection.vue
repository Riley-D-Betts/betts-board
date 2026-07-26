<!-- One panel on the TV dashboard. Absorbs the repeated shell + heading so the
     palette lives in one place instead of four copies per colour. -->
<script setup lang="ts">
defineProps<{ heading: string }>()
</script>

<template>
  <section class="tv-panel overflow-hidden rounded-2xl border p-6">
    <h2 class="tv-muted text-sm font-semibold uppercase tracking-widest">{{ heading }}</h2>
    <slot />
  </section>
</template>
