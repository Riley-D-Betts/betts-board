<script setup lang="ts">
import { DateTime } from 'luxon'
import type { CalendarOccurrence } from '#shared/schemas/events'

const props = defineProps<{
  occurrences: CalendarOccurrence[]
  timezone: string
  startDate: string // first day of the window (YYYY-MM-DD)
}>()

const emit = defineEmits<{
  select: [occurrence: CalendarOccurrence]
}>()

const { t } = useI18n()
const { formatDayMonth, formatWeekdayLong } = useDateFormat()

const groups = computed(() => {
  const zone = props.timezone
  const todayStr = DateTime.now().setZone(zone).toISODate()
  const byDate = new Map<string, CalendarOccurrence[]>()

  for (const occ of props.occurrences) {
    const start = occ.isAllDay
      ? occ.startDate!
      : DateTime.fromMillis(occ.start, { zone }).toISODate()!
    // Events already underway at the window start still show on its first day.
    const date = start < props.startDate ? props.startDate : start
    const list = byDate.get(date) ?? []
    list.push(occ)
    byDate.set(date, list)
  }

  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, items]) => ({
      date,
      isToday: date === todayStr,
      label: date === todayStr ? t('common.actions.today') : formatWeekdayLong(date),
      sub: formatDayMonth(date),
      items,
    }))
})
</script>

<template>
  <div v-if="groups.length" class="space-y-1">
    <section v-for="group in groups" :key="group.date">
      <div class="sticky top-0 z-10 flex items-baseline gap-2 bg-slate-50/95 dark:bg-slate-950/95 backdrop-blur px-1 py-1.5">
        <span class="text-sm font-semibold" :class="group.isToday ? 'text-primary' : ''">{{ group.label }}</span>
        <span class="text-xs text-slate-500 dark:text-slate-400">{{ group.sub }}</span>
      </div>
      <div class="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-1">
        <EventChip
          v-for="occ in group.items"
          :key="occ.occurrenceId"
          :occurrence="occ"
          :timezone="timezone"
          variant="row"
          @select="emit('select', $event)"
        />
      </div>
    </section>
  </div>

  <div v-else class="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 py-12 text-center">
    <UIcon name="i-lucide-calendar-off" class="mx-auto size-8 text-slate-400" />
    <p class="mt-2 text-sm text-slate-500 dark:text-slate-400">{{ $t('calendar.agenda.empty') }}</p>
  </div>
</template>
