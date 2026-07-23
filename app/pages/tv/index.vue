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
  <!-- Exactly viewport-sized (h-screen, not min-h): the grid must shrink to
       fit the display rather than push the footer off-screen — TVs can't
       scroll. Sections clip their own overflow. -->
  <div class="flex h-screen flex-col gap-5 overflow-hidden p-6">
    <div class="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-5">
      <!-- Clock -->
      <section class="flex flex-col justify-center rounded-2xl border border-slate-800 bg-slate-900 p-6">
        <OverlayClock large />
      </section>

      <!-- Weather (3-day) -->
      <section class="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 p-6">
        <h2 class="text-sm font-semibold uppercase tracking-widest text-slate-400">Weather</h2>
        <div v-if="weather" class="mt-3 space-y-4">
          <div class="flex items-center gap-4">
            <UIcon :name="weather.current.icon" class="size-14 shrink-0" />
            <div>
              <p class="text-4xl font-bold leading-none tabular-nums">
                {{ Math.round(weather.current.temperature) }}°
              </p>
              <p class="mt-1 text-sm text-slate-400">{{ weather.current.label }}</p>
            </div>
          </div>
          <div class="grid grid-cols-3 gap-3">
            <div
              v-for="day in weather.daily.slice(0, 3)"
              :key="day.date"
              class="rounded-xl bg-slate-800/60 p-3 text-center"
            >
              <p class="text-xs font-medium text-slate-400">
                {{ day.date === today ? 'Today' : weekdayLabel(day.date) }}
              </p>
              <UIcon :name="day.icon" class="my-1 size-7" :title="day.label" />
              <p class="text-sm tabular-nums">
                {{ Math.round(day.tempMax) }}° <span class="text-slate-400">{{ Math.round(day.tempMin) }}°</span>
              </p>
            </div>
          </div>
        </div>
        <p v-else class="mt-3 text-sm text-slate-400">
          Set a weather location in Settings to see the forecast.
        </p>
      </section>

      <!-- Today's agenda -->
      <section class="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 p-6">
        <h2 class="text-sm font-semibold uppercase tracking-widest text-slate-400">Today</h2>
        <ul v-if="agenda.length" class="mt-3 space-y-2">
          <li v-for="occ in agenda.slice(0, 5)" :key="occ.occurrenceId" class="flex items-center gap-3">
            <span class="h-6 w-1.5 shrink-0 rounded-full" :style="{ backgroundColor: occ.color }" />
            <span class="min-w-0 flex-1 truncate font-medium">{{ occ.title }}</span>
            <span class="shrink-0 text-sm text-slate-400">{{ timeLabel(occ) }}</span>
          </li>
          <li v-if="agenda.length > 5" class="text-sm text-slate-400">
            +{{ agenda.length - 5 }} more
          </li>
        </ul>
        <p v-else class="mt-3 text-sm text-slate-400">Nothing on the calendar today.</p>
      </section>

      <!-- Today's chores -->
      <section class="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 p-6">
        <h2 class="text-sm font-semibold uppercase tracking-widest text-slate-400">Chores</h2>
        <ul v-if="choreBoard.length" class="mt-3 space-y-2">
          <li
            v-for="i in choreBoard.slice(0, 6)"
            :key="`${i.choreId}:${i.profileId}:${i.dueDate}`"
            class="flex items-center gap-3"
          >
            <UIcon
              :name="i.completed ? 'i-lucide-circle-check' : 'i-lucide-circle'"
              class="size-5 shrink-0"
              :class="i.completed ? 'text-green-400' : 'text-slate-500'"
            />
            <span class="min-w-0 flex-1 truncate font-medium" :class="{ 'line-through text-slate-500': i.completed }">
              <span v-if="i.emoji" class="mr-1">{{ i.emoji }}</span>{{ i.title }}
            </span>
            <span class="shrink-0 text-sm" :style="{ color: i.profileColor }">{{ i.profileName }}</span>
          </li>
          <li v-if="choreBoard.length > 6" class="text-sm text-slate-400">
            +{{ choreBoard.length - 6 }} more
          </li>
        </ul>
        <p v-else class="mt-3 text-sm text-slate-400">No chores due today.</p>
      </section>
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
