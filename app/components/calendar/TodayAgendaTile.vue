<!-- Dashboard tile: today's events. Implemented by the calendar slice. -->
<script setup lang="ts">
import { DateTime } from 'luxon'
import type { CalendarOccurrence } from '#shared/schemas/events'

const { formatTime } = useDateFormat()

const { state } = useBoardState()
const timezone = computed(() => state.value?.timezone ?? 'UTC')

const { data: occurrences, refresh } = await useFetch<CalendarOccurrence[]>('/api/calendar', {
  query: computed(() => {
    const dayStart = DateTime.now().setZone(timezone.value).startOf('day')
    return { start: dayStart.toMillis(), end: dayStart.plus({ days: 1 }).toMillis() }
  }),
  default: () => [],
})

useLiveRefresh(refresh)

function timeLabel(occ: CalendarOccurrence) {
  if (occ.isAllDay) return 'All day'
  return formatTime(occ.start, timezone.value)
}
</script>

<template>
  <UCard>
    <template #header>
      <NuxtLink to="/calendar" class="flex items-center gap-2 font-semibold hover:text-primary">
        <UIcon name="i-lucide-calendar-days" class="text-primary size-5" />
        Today
        <UIcon name="i-lucide-chevron-right" class="ml-auto size-4 text-slate-400" />
      </NuxtLink>
    </template>

    <div v-if="occurrences.length" class="-my-1 divide-y divide-slate-100 dark:divide-slate-800">
      <NuxtLink
        v-for="occ in occurrences.slice(0, 6)"
        :key="occ.occurrenceId"
        to="/calendar"
        class="flex min-h-11 items-center gap-3 py-1.5"
      >
        <span class="w-1.5 self-stretch shrink-0 rounded-full" :style="{ backgroundColor: occ.color }" />
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium">{{ occ.title }}</p>
          <p class="text-xs text-slate-500 dark:text-slate-400">
            {{ timeLabel(occ) }}<span v-if="occ.location"> · {{ occ.location }}</span>
          </p>
        </div>
        <div v-if="occ.attendees.length" class="flex shrink-0 -space-x-1">
          <span
            v-for="a in occ.attendees.slice(0, 4)"
            :key="a.profileId"
            class="size-3 rounded-full ring-2 ring-white dark:ring-slate-900"
            :style="{ backgroundColor: a.color }"
            :title="a.name"
          />
        </div>
      </NuxtLink>
      <p v-if="occurrences.length > 6" class="py-1.5 text-xs text-slate-500">
        +{{ occurrences.length - 6 }} more today
      </p>
    </div>
    <p v-else class="text-sm text-slate-500">Nothing on the calendar today.</p>
  </UCard>
</template>
