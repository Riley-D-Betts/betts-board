<script setup lang="ts">
const { activeProfile } = useBoardState()

const greeting = computed(() => {
  const h = new Date().getHours()
  const part = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'
  return `Good ${part}${activeProfile.value ? `, ${activeProfile.value.name}` : ''}`
})
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl md:text-3xl font-bold">{{ greeting }}</h1>
      <WeatherBadge />
    </div>

    <div class="grid gap-4 md:grid-cols-2">
      <TodayAgendaTile />
      <ChoresTodayTile />
      <TonightMealTile />
      <ShoppingQuickTile />
    </div>
  </div>
</template>
