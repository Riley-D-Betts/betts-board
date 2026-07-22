<!-- Current conditions + today's hi/lo for the slideshow overlay. -->
<script setup lang="ts">
import type { WeatherReport } from '~~/server/services/weather/forecast'

const weather = ref<WeatherReport | null>(null)

async function load() {
  try {
    weather.value = await $fetch<WeatherReport>('/api/weather')
  }
  catch {
    weather.value = null // unconfigured or unreachable → render nothing
  }
}

onMounted(load)
useIntervalFn(load, 15 * 60_000)
watch(useWeatherTick(), load) // settings changed (unit/location) → refetch now
</script>

<template>
  <div v-if="weather" class="flex items-center gap-3 text-right">
    <div>
      <p class="text-4xl font-bold leading-none tabular-nums">
        {{ Math.round(weather.current.temperature) }}°
      </p>
      <p v-if="weather.daily[0]" class="mt-1 text-sm opacity-90">
        {{ weather.current.label }} · H {{ Math.round(weather.daily[0].tempMax) }}° L {{ Math.round(weather.daily[0].tempMin) }}°
      </p>
    </div>
    <UIcon :name="weather.current.icon" class="size-12 shrink-0" />
  </div>
</template>
