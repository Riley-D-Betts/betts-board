<script setup lang="ts">
const { activeProfile } = useBoardState()
const { t } = useI18n()

const greeting = computed(() => {
  const h = new Date().getHours()
  const name = activeProfile.value?.name ?? null
  if (h < 12) {
    return name === null ? t('common.dashboard.greeting.morning') : t('common.dashboard.greeting.morningNamed', { name })
  }
  if (h < 17) {
    return name === null ? t('common.dashboard.greeting.afternoon') : t('common.dashboard.greeting.afternoonNamed', { name })
  }
  return name === null ? t('common.dashboard.greeting.evening') : t('common.dashboard.greeting.eveningNamed', { name })
})
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl md:text-3xl font-bold">{{ greeting }}</h1>
      <WeatherBadge />
    </div>

    <!--
      There is deliberately NO money tile here, and adding one is a one-line
      change that would undo the point of the whole finance slice. This page is
      where the kitchen wall tablet sits, live-polling every 10 seconds, for
      everyone who walks past. Money lives behind its own PIN at /finance.
    -->
    <div class="grid gap-4 md:grid-cols-2">
      <TodayAgendaTile />
      <ChoresTodayTile />
      <TonightMealTile />
      <ShoppingQuickTile />
    </div>
  </div>
</template>
