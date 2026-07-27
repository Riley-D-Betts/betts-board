<script setup lang="ts">
import { DateTime } from 'luxon'
import type { CalendarOccurrence } from '#shared/schemas/events'

const props = withDefaults(defineProps<{
  anchor: string // YYYY-MM-DD
  occurrences: CalendarOccurrence[]
  timezone: string
  weekStartsOn: 0 | 1
  /** 7 = week view, 1 = day view (used by CalendarDay). */
  days?: number
}>(), { days: 7 })

const emit = defineEmits<{
  select: [occurrence: CalendarOccurrence]
  selectDay: [date: string]
}>()

const HOUR_START = 6
const HOUR_END = 22
const HOUR_PX = 48
const GRID_MIN = (HOUR_END - HOUR_START) * 60
const gridHeight = (HOUR_END - HOUR_START) * HOUR_PX

const hours = Array.from({ length: HOUR_END - HOUR_START }, (_, i) => HOUR_START + i)

function hourLabel(h: number) {
  return DateTime.fromObject({ hour: h }).toFormat('h a')
}

const startDt = computed(() => {
  const dt = DateTime.fromISO(props.anchor, { zone: props.timezone }).startOf('day')
  return props.days === 7 ? startOfWeekDt(dt, props.weekStartsOn) : dt
})

interface Block {
  occ: CalendarOccurrence
  top: number
  height: number
  left: number // %
  width: number // %
  startLabel: string
}

interface DayCol {
  date: string
  label: string
  isToday: boolean
  allDay: CalendarOccurrence[]
  blocks: Block[]
}

/** Interval-graph greedy column packing within overlap clusters. */
function pack(items: { occ: CalendarOccurrence, startMin: number, endMin: number }[]): Block[] {
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin)
  const blocks: Block[] = []
  let cluster: { item: typeof sorted[number], col: number }[] = []
  let colEnds: number[] = []
  let clusterEnd = -1

  const flush = () => {
    const colCount = colEnds.length || 1
    for (const { item, col } of cluster) {
      blocks.push({
        occ: item.occ,
        top: (item.startMin / 60) * HOUR_PX,
        height: Math.max(18, ((item.endMin - item.startMin) / 60) * HOUR_PX),
        left: (col / colCount) * 100,
        width: (1 / colCount) * 100,
        startLabel: DateTime.fromMillis(item.occ.start, { zone: props.timezone }).toFormat('h:mm a'),
      })
    }
    cluster = []
    colEnds = []
    clusterEnd = -1
  }

  for (const item of sorted) {
    if (cluster.length && item.startMin >= clusterEnd) flush()
    let col = colEnds.findIndex(end => end <= item.startMin)
    if (col === -1) {
      col = colEnds.length
      colEnds.push(0)
    }
    colEnds[col] = item.endMin
    cluster.push({ item, col })
    clusterEnd = Math.max(clusterEnd, item.endMin)
  }
  flush()
  return blocks
}

const columns = computed<DayCol[]>(() => {
  const zone = props.timezone
  const todayStr = DateTime.now().setZone(zone).toISODate()

  return Array.from({ length: props.days }, (_, i) => {
    const dt = startDt.value.plus({ days: i })
    const date = dt.toISODate()!
    const dayStartMs = dt.toMillis()
    const dayEndMs = dt.plus({ days: 1 }).toMillis()

    const allDay: CalendarOccurrence[] = []
    const timed: { occ: CalendarOccurrence, startMin: number, endMin: number }[] = []

    for (const occ of props.occurrences) {
      if (occ.isAllDay) {
        if (occ.startDate! <= date && date < occ.endDate!) allDay.push(occ)
        continue
      }
      if (occ.end <= dayStartMs || occ.start >= dayEndMs) continue
      const spansDays = DateTime.fromMillis(occ.start, { zone }).toISODate()
        !== DateTime.fromMillis(Math.max(occ.end - 1, occ.start), { zone }).toISODate()
      if (spansDays && (occ.end - occ.start) >= 24 * 3_600_000) {
        allDay.push(occ) // long multi-day timed events read better in the all-day row
        continue
      }
      const startMin = Math.max(0, (occ.start - dayStartMs) / 60_000 - HOUR_START * 60)
      const endMin = Math.min(GRID_MIN, (occ.end - dayStartMs) / 60_000 - HOUR_START * 60)
      if (endMin <= 0 || startMin >= GRID_MIN) continue // fully outside 06:00–22:00
      timed.push({ occ, startMin, endMin: Math.max(endMin, startMin + 15) })
    }

    return {
      date,
      label: props.days === 1 ? dt.toFormat('cccc') : dt.toFormat('ccc'),
      isToday: date === todayStr,
      allDay,
      blocks: pack(timed),
    }
  })
})

const hasAllDay = computed(() => columns.value.some(c => c.allDay.length > 0))

// Current-time indicator, refreshed each minute.
const nowTick = ref(Date.now())
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(() => { nowTick.value = Date.now() }, 60_000)
})
onUnmounted(() => clearInterval(timer))

const nowLine = computed(() => {
  const now = DateTime.fromMillis(nowTick.value, { zone: props.timezone })
  const min = now.hour * 60 + now.minute - HOUR_START * 60
  if (min < 0 || min > GRID_MIN) return null
  return { date: now.toISODate(), top: (min / 60) * HOUR_PX }
})
</script>

<template>
  <div class="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
    <!-- day headers -->
    <div class="grid border-b border-slate-200 dark:border-slate-800" :style="{ gridTemplateColumns: `3rem repeat(${days}, minmax(0, 1fr))` }">
      <div />
      <button
        v-for="col in columns"
        :key="col.date"
        type="button"
        class="flex min-h-11 flex-col items-center justify-center py-1 text-xs font-medium"
        :class="col.isToday ? 'text-primary' : 'text-slate-500 dark:text-slate-400'"
        @click="emit('selectDay', col.date)"
      >
        <span>{{ col.label }}</span>
        <span
          class="mt-0.5 inline-flex size-6 items-center justify-center rounded-full text-sm"
          :class="col.isToday ? 'bg-primary text-white' : 'text-slate-800 dark:text-slate-200'"
        >
          {{ Number(col.date.slice(8)) }}
        </span>
      </button>
    </div>

    <!-- all-day row -->
    <div
      v-if="hasAllDay"
      class="grid border-b border-slate-200 dark:border-slate-800"
      :style="{ gridTemplateColumns: `3rem repeat(${days}, minmax(0, 1fr))` }"
    >
      <div class="py-1 pr-1 text-right text-[10px] text-slate-400">{{ $t('calendar.week.allDayRow') }}</div>
      <div v-for="col in columns" :key="col.date" class="min-w-0 space-y-px border-l border-slate-100 dark:border-slate-800 p-0.5">
        <button
          v-for="occ in col.allDay"
          :key="occ.occurrenceId"
          type="button"
          class="block w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] font-medium text-white"
          :style="{ backgroundColor: occ.color }"
          @click="emit('select', occ)"
        >
          {{ occ.title }}
        </button>
      </div>
    </div>

    <!-- time grid -->
    <div class="grid" :style="{ gridTemplateColumns: `3rem repeat(${days}, minmax(0, 1fr))` }">
      <!-- hour labels -->
      <div class="relative" :style="{ height: `${gridHeight}px` }">
        <div
          v-for="(h, i) in hours"
          :key="h"
          class="absolute right-1 -translate-y-1/2 text-[10px] text-slate-400"
          :style="{ top: `${i * HOUR_PX}px` }"
        >
          <template v-if="i > 0">{{ hourLabel(h) }}</template>
        </div>
      </div>

      <!-- day columns -->
      <div
        v-for="col in columns"
        :key="col.date"
        class="relative border-l border-slate-100 dark:border-slate-800"
        :style="{ height: `${gridHeight}px` }"
      >
        <div
          v-for="(h, i) in hours"
          :key="h"
          class="absolute inset-x-0 border-t border-slate-100 dark:border-slate-800"
          :style="{ top: `${i * HOUR_PX}px` }"
        />

        <button
          v-for="block in col.blocks"
          :key="block.occ.occurrenceId"
          type="button"
          class="absolute z-10 overflow-hidden rounded border-l-2 px-1 py-0.5 text-left text-[11px] leading-tight"
          :style="{
            top: `${block.top}px`,
            height: `${block.height}px`,
            left: `calc(${block.left}% + 1px)`,
            width: `calc(${block.width}% - 2px)`,
            backgroundColor: `${block.occ.color}26`,
            borderColor: block.occ.color,
          }"
          @click="emit('select', block.occ)"
        >
          <span class="block truncate font-semibold">{{ block.occ.title }}</span>
          <span class="block truncate text-slate-500 dark:text-slate-400">{{ block.startLabel }}</span>
        </button>

        <!-- current-time indicator -->
        <div
          v-if="nowLine && nowLine.date === col.date"
          class="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-red-500"
          :style="{ top: `${nowLine.top}px` }"
        >
          <span class="absolute -left-1 -top-[5px] size-2 rounded-full bg-red-500" />
        </div>
      </div>
    </div>
  </div>
</template>
