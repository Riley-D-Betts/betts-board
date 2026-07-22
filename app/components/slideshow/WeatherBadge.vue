<!-- Compact current-weather chip for the dashboard header.
     Hidden until the household has a location and a forecast loads. -->
<script setup lang="ts">
import type { WeatherReport } from '~~/server/services/weather/forecast'

const { state } = useBoardState()
const hasLocation = computed(() => state.value?.hasLocation ?? false)

const weather = ref<WeatherReport | null>(null)

async function load() {
  if (!hasLocation.value) return
  try {
    weather.value = await $fetch<WeatherReport>('/api/weather')
  }
  catch {
    weather.value = null
  }
}

onMounted(load)
useIntervalFn(load, 15 * 60_000)
watch(hasLocation, (v) => {
  if (v && !weather.value) void load()
})
</script>

<template>
  <div
    v-if="weather"
    class="flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-sm dark:bg-slate-800"
    :title="weather.current.label"
  >
    <UIcon :name="weather.current.icon" class="text-primary size-5 shrink-0" />
    <span class="font-semibold tabular-nums">{{ Math.round(weather.current.temperature) }}°</span>
    <span v-if="weather.daily[0]" class="hidden text-xs text-slate-500 sm:inline dark:text-slate-400 tabular-nums">
      {{ Math.round(weather.daily[0].tempMax) }}° / {{ Math.round(weather.daily[0].tempMin) }}°
    </span>
  </div>
</template>
