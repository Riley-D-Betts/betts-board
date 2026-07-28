<!-- Today's events + the next few upcoming, for the slideshow overlay. -->
<script setup lang="ts">
import { DateTime } from 'luxon'
import type { CalendarOccurrence } from '#shared/schemas/events'

const { formatTime, formatWeekdayShort } = useDateFormat()
const { occurrenceTitle } = useOccurrenceTitle()
const { t } = useI18n()

const { state } = useBoardState()
const timezone = computed(() => state.value?.timezone ?? 'UTC')

const occurrences = ref<CalendarOccurrence[]>([])

async function load() {
  const dayStart = DateTime.now().setZone(timezone.value).startOf('day')
  try {
    occurrences.value = await $fetch<CalendarOccurrence[]>('/api/calendar', {
      query: { start: dayStart.toMillis(), end: dayStart.plus({ days: 7 }).toMillis() },
    })
  }
  catch {
    occurrences.value = []
  }
}

onMounted(load)
useIntervalFn(load, 5 * 60_000)

const todayEnd = computed(() =>
  DateTime.now().setZone(timezone.value).endOf('day').toMillis())

const today = computed(() =>
  occurrences.value.filter(o => o.start <= todayEnd.value).slice(0, 4))
const upcoming = computed(() =>
  occurrences.value.filter(o => o.start > todayEnd.value).slice(0, 3))

function timeLabel(occ: CalendarOccurrence) {
  if (occ.isAllDay) return t('photos.overlay.allDay')
  return formatTime(occ.start, timezone.value)
}

function dayLabel(occ: CalendarOccurrence) {
  // Resolve the occurrence to a calendar key in the household's zone first, so
  // the weekday is the household's day; toFormat here is a machine value, and
  // only useDateFormat applies a locale.
  const dateKey = DateTime.fromMillis(occ.start, { zone: timezone.value }).toFormat('yyyy-MM-dd')
  return formatWeekdayShort(dateKey)
}
</script>

<template>
  <div v-if="today.length || upcoming.length" class="max-w-xs space-y-3 text-right">
    <div v-if="today.length">
      <p class="text-xs font-semibold uppercase tracking-widest opacity-75">{{ $t('common.actions.today') }}</p>
      <ul class="mt-1 space-y-1">
        <li v-for="occ in today" :key="occ.occurrenceId" class="text-sm leading-snug">
          <span class="font-medium">{{ occurrenceTitle(occ) }}</span>
          <span class="opacity-80"> · {{ timeLabel(occ) }}</span>
        </li>
      </ul>
    </div>
    <div v-if="upcoming.length">
      <p class="text-xs font-semibold uppercase tracking-widest opacity-75">{{ $t('photos.overlay.comingUp') }}</p>
      <ul class="mt-1 space-y-1">
        <li v-for="occ in upcoming" :key="occ.occurrenceId" class="text-sm leading-snug">
          <span class="font-medium">{{ occurrenceTitle(occ) }}</span>
          <span class="opacity-80"> · {{ dayLabel(occ) }} {{ timeLabel(occ) }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>
