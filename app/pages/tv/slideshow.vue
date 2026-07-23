<script setup lang="ts">
// Immediately starts the global SlideshowOverlay. Any key (Escape/Back on a
// remote) or tap dismisses the overlay, which routes back to the TV home.
definePageMeta({ layout: 'tv' })

const { active, start, stop } = useIdleSlideshow()

onMounted(() => start())

watch(active, (on) => {
  if (!on) void navigateTo('/tv')
})

onBeforeUnmount(() => stop())
</script>

<template>
  <div class="min-h-screen bg-black" />
</template>
