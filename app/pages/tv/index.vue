<script setup lang="ts">
import { DateTime } from 'luxon'
import type { CalendarOccurrence } from '#shared/schemas/events'
import type { ChoreInstance } from '#shared/schemas/chores'
import type { WeatherReport } from '~~/server/services/weather/forecast'

definePageMeta({ layout: 'tv' })

const { state } = useBoardState()
const timezone = computed(() => state.value?.timezone ?? 'UTC')
const today = todayString()

// Weather: client-side, refreshed every 15 min. Absent → hint to configure.
const weather = ref<WeatherReport | null>(null)
async function loadWeather() {
  try {
    weather.value = await $fetch<WeatherReport>('/api/weather')
  }
  catch {
    weather.value = null
  }
}
onMounted(loadWeather)
useIntervalFn(loadWeather, 15 * 60_000)

// Today's agenda.
const { data: agenda } = await useFetch<CalendarOccurrence[]>('/api/calendar', {
  query: computed(() => {
    const dayStart = DateTime.now().setZone(timezone.value).startOf('day')
    return { start: dayStart.toMillis(), end: dayStart.plus({ days: 1 }).toMillis() }
  }),
  default: () => [],
})

// Today's chores — another slice owns the endpoint, so code defensively.
const { data: choreBoard } = await useAsyncData('tv-chores-today', async () => {
  try {
    return await $fetch<ChoreInstance[]>('/api/chores/board', {
      query: { start: today, end: addDaysToDateString(today, 1) },
    })
  }
  catch {
    return [] as ChoreInstance[]
  }
}, { default: () => [] })

function timeLabel(occ: CalendarOccurrence) {
  if (occ.isAllDay) return 'All day'
  return DateTime.fromMillis(occ.start, { zone: timezone.value }).toFormat('h:mm a')
}

function weekdayLabel(date: string) {
  return parseDateString(date).toLocaleDateString(undefined, { weekday: 'short' })
}
</script>

<template>
  <!-- Exactly viewport-sized on a real TV (which can't scroll); on a phone
       that wandered in from the More menu, allow normal scrolling instead. -->
  <div class="flex min-h-screen flex-col gap-5 p-6 md:h-screen md:min-h-0 md:overflow-hidden">
    <div class="grid min-h-0 flex-1 grid-cols-1 gap-5 md:grid-cols-2 md:grid-rows-2">
      <!-- Clock -->
      <section class="tv-panel flex flex-col justify-center rounded-2xl border p-6">
        <OverlayClock large />
      </section>

      <!-- Weather (3-day) -->
      <TvSection heading="Weather">
        <div v-if="weather" class="mt-3 space-y-4">
          <div class="flex items-center gap-4">
            <UIcon :name="weather.current.icon" class="size-14 shrink-0" />
            <div>
              <p class="text-4xl font-bold leading-none tabular-nums">
                {{ Math.round(weather.current.temperature) }}°
              </p>
              <p class="tv-muted mt-1 text-sm">{{ weather.current.label }}</p>
            </div>
          </div>
          <div class="grid grid-cols-3 gap-3">
            <div
              v-for="day in weather.daily.slice(0, 3)"
              :key="day.date"
              class="tv-chip rounded-xl p-3 text-center"
            >
              <p class="tv-muted text-xs font-medium">
                {{ day.date === today ? 'Today' : weekdayLabel(day.date) }}
              </p>
              <UIcon :name="day.icon" class="my-1 size-7" :title="day.label" />
              <p class="text-sm tabular-nums">
                {{ Math.round(day.tempMax) }}° <span class="tv-muted">{{ Math.round(day.tempMin) }}°</span>
              </p>
            </div>
          </div>
        </div>
        <p v-else class="tv-muted mt-3 text-sm">
          Set a weather location in Settings to see the forecast.
        </p>
      </TvSection>

      <!-- Today's agenda -->
      <TvSection heading="Today">
        <ul v-if="agenda.length" class="mt-3 space-y-2">
          <li v-for="occ in agenda.slice(0, 5)" :key="occ.occurrenceId" class="flex items-center gap-3">
            <span class="h-6 w-1.5 shrink-0 rounded-full" :style="{ backgroundColor: occ.color }" />
            <span class="min-w-0 flex-1 truncate font-medium">{{ occ.title }}</span>
            <span class="tv-muted shrink-0 text-sm">{{ timeLabel(occ) }}</span>
          </li>
          <li v-if="agenda.length > 5" class="tv-muted text-sm">
            +{{ agenda.length - 5 }} more
          </li>
        </ul>
        <p v-else class="tv-muted mt-3 text-sm">Nothing on the calendar today.</p>
      </TvSection>

      <!-- Today's chores -->
      <TvSection heading="Chores">
        <ul v-if="choreBoard.length" class="mt-3 space-y-2">
          <li
            v-for="i in choreBoard.slice(0, 6)"
            :key="`${i.choreId}:${i.profileId}:${i.dueDate}`"
            class="flex items-center gap-3"
          >
            <UIcon
              :name="i.completed ? 'i-lucide-circle-check' : 'i-lucide-circle'"
              class="size-5 shrink-0"
              :class="i.completed ? 'text-green-500' : 'tv-muted'"
            />
            <span class="min-w-0 flex-1 truncate font-medium" :class="{ 'line-through tv-muted': i.completed }">
              <span v-if="i.emoji" class="mr-1">{{ i.emoji }}</span>{{ i.title }}
            </span>
            <span class="shrink-0 text-sm" :style="{ color: i.profileColor }">{{ i.profileName }}</span>
          </li>
          <li v-if="choreBoard.length > 6" class="tv-muted text-sm">
            +{{ choreBoard.length - 6 }} more
          </li>
        </ul>
        <p v-else class="tv-muted mt-3 text-sm">No chores due today.</p>
      </TvSection>
    </div>

    <!-- D-pad focusable footer, in DOM order -->
    <div class="flex flex-wrap gap-4">
      <UButton to="/tv/slideshow" icon="i-lucide-images" size="xl">
        Slideshow
      </UButton>
      <UButton to="/" icon="i-lucide-door-open" size="xl" variant="soft" color="neutral">
        Exit TV mode
      </UButton>
    </div>
  </div>
</template>
