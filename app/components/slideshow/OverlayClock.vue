<!-- Ticking clock for the slideshow overlay + TV tiles. Inherits text color. -->
<script setup lang="ts">
const props = withDefaults(defineProps<{
  /** Bigger digits for the centered clock-only mode. */
  large?: boolean
}>(), { large: false })

// Client-only clock: starts null so SSR and hydration agree.
const now = ref<Date | null>(null)
onMounted(() => {
  now.value = new Date()
})
useIntervalFn(() => {
  now.value = new Date()
}, 1000)

const time = computed(() =>
  now.value?.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) ?? '')
const dateLabel = computed(() =>
  now.value?.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) ?? '')
</script>

<template>
  <div v-if="now">
    <p class="font-bold tabular-nums leading-none" :class="props.large ? 'text-8xl' : 'text-5xl'">
      {{ time }}
    </p>
    <p class="mt-2 opacity-90" :class="props.large ? 'text-2xl' : 'text-lg'">
      {{ dateLabel }}
    </p>
  </div>
</template>
