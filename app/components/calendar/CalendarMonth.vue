<script setup lang="ts">
import { DateTime } from 'luxon'
import type { CalendarOccurrence } from '#shared/schemas/events'

const props = defineProps<{
  anchor: string // YYYY-MM-DD
  occurrences: CalendarOccurrence[]
  timezone: string
  weekStartsOn: 0 | 1
}>()

const emit = defineEmits<{
  select: [occurrence: CalendarOccurrence]
  selectDay: [date: string]
}>()

const MAX_LANES = 3
const BAR_H = 20 // px per lane row
const BAR_TOP = 26 // px reserved for the day number

const { weekdayNames } = useDateFormat()
const dayNames = computed(() => {
  const names = weekdayNames('short') // Sunday-first
  return props.weekStartsOn === 1 ? [...names.slice(1), names[0]!] : names
})

interface Bar {
  occ: CalendarOccurrence
  lane: number
  startCol: number
  span: number
  contLeft: boolean
  contRight: boolean
}

interface Cell {
  date: string
  dayNum: number
  inMonth: boolean
  isToday: boolean
  chips: CalendarOccurrence[]
  overflow: number
}

const weeks = computed(() => {
  const zone = props.timezone
  const monthStart = DateTime.fromISO(props.anchor, { zone }).startOf('month')
  const gridStart = startOfWeekDt(monthStart, props.weekStartsOn)
  const todayStr = DateTime.now().setZone(zone).toISODate()

  // Split occurrences into spanning bars (all-day / multi-day) vs timed chips.
  const spanning: { occ: CalendarOccurrence, start: string, endExcl: string }[] = []
  const timedByDate = new Map<string, CalendarOccurrence[]>()
  for (const occ of props.occurrences) {
    const start = occ.isAllDay
      ? occ.startDate!
      : DateTime.fromMillis(occ.start, { zone }).toISODate()!
    const endExcl = occ.isAllDay
      ? occ.endDate!
      : DateTime.fromMillis(Math.max(occ.end - 1, occ.start), { zone }).plus({ days: 1 }).toISODate()!
    if (occ.isAllDay || dateStringDiffDays(endExcl, start) > 1) {
      spanning.push({ occ, start, endExcl })
    }
    else {
      const list = timedByDate.get(start) ?? []
      list.push(occ)
      timedByDate.set(start, list)
    }
  }

  const rows: { cells: Cell[], bars: Bar[], laneCount: number }[] = []
  for (let w = 0; w < 6; w++) {
    const weekStart = gridStart.plus({ days: w * 7 })
    const dates = Array.from({ length: 7 }, (_, i) => weekStart.plus({ days: i }).toISODate()!)
    const weekEndExcl = addDaysToDateString(dates[6]!, 1)

    const segs = spanning
      .filter(s => s.start < weekEndExcl && s.endExcl > dates[0]!)
      .map((s) => {
        const startCol = Math.max(0, dateStringDiffDays(s.start, dates[0]!))
        const endCol = Math.min(7, dateStringDiffDays(s.endExcl, dates[0]!))
        return {
          occ: s.occ,
          startCol,
          span: endCol - startCol,
          contLeft: s.start < dates[0]!,
          contRight: s.endExcl > weekEndExcl,
        }
      })
      .sort((a, b) => a.startCol - b.startCol || b.span - a.span)

    const laneEnds: number[] = []
    const bars: Bar[] = []
    const overflowPerDay = Array.from({ length: 7 }, () => 0)
    for (const seg of segs) {
      let lane = laneEnds.findIndex(end => end <= seg.startCol)
      if (lane === -1) {
        if (laneEnds.length >= MAX_LANES) {
          for (let c = seg.startCol; c < seg.startCol + seg.span; c++) overflowPerDay[c]!++
          continue
        }
        lane = laneEnds.length
        laneEnds.push(0)
      }
      laneEnds[lane] = seg.startCol + seg.span
      bars.push({ ...seg, lane })
    }

    const laneCount = laneEnds.length
    const maxChips = Math.max(1, 3 - laneCount)
    const cells = dates.map((date, i) => {
      const all = timedByDate.get(date) ?? []
      const chips = all.slice(0, maxChips)
      return {
        date,
        dayNum: Number(date.slice(8)),
        inMonth: date.slice(0, 7) === props.anchor.slice(0, 7),
        isToday: date === todayStr,
        chips,
        overflow: overflowPerDay[i]! + (all.length - chips.length),
      }
    })
    rows.push({ cells, bars, laneCount })
  }
  return rows
})
</script>

<template>
  <div class="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
    <div class="grid grid-cols-7 border-b border-slate-200 dark:border-slate-800 text-center text-xs font-medium text-slate-500 dark:text-slate-400">
      <div v-for="d in dayNames" :key="d" class="py-1.5">{{ d }}</div>
    </div>

    <div v-for="(week, wi) in weeks" :key="wi" class="relative grid grid-cols-7">
      <!-- spanning all-day / multi-day lane bars -->
      <button
        v-for="bar in week.bars"
        :key="`${bar.occ.occurrenceId}:${bar.startCol}`"
        type="button"
        class="absolute z-10 truncate px-1.5 text-left text-[11px] leading-[18px] font-medium text-white"
        :class="[bar.contLeft ? '' : 'rounded-l', bar.contRight ? '' : 'rounded-r']"
        :style="{
          top: `${BAR_TOP + bar.lane * BAR_H}px`,
          left: `calc(${(bar.startCol / 7) * 100}% + 2px)`,
          width: `calc(${(bar.span / 7) * 100}% - 4px)`,
          height: '18px',
          backgroundColor: bar.occ.color,
        }"
        @click.stop="emit('select', bar.occ)"
      >
        {{ bar.occ.title }}
      </button>

      <!-- day cells -->
      <div
        v-for="cell in week.cells"
        :key="cell.date"
        class="min-h-24 md:min-h-28 cursor-pointer border-b border-r border-slate-100 dark:border-slate-800 p-0.5 last:border-r-0"
        :class="cell.inMonth ? '' : 'bg-slate-50/60 dark:bg-slate-950/40'"
        @click="emit('selectDay', cell.date)"
      >
        <button
          type="button"
          class="mb-0.5 inline-flex size-6 items-center justify-center rounded-full text-xs font-medium"
          :class="cell.isToday
            ? 'bg-primary text-white'
            : cell.inMonth ? 'text-slate-700 dark:text-slate-200' : 'text-slate-400 dark:text-slate-600'"
          @click.stop="emit('selectDay', cell.date)"
        >
          {{ cell.dayNum }}
        </button>
        <div :style="{ paddingTop: `${week.laneCount * BAR_H}px` }" class="space-y-px">
          <EventChip
            v-for="occ in cell.chips"
            :key="occ.occurrenceId"
            :occurrence="occ"
            :timezone="timezone"
            variant="compact"
            @select="emit('select', $event)"
          />
          <button
            v-if="cell.overflow > 0"
            type="button"
            class="block w-full rounded px-1 py-0.5 text-left text-[11px] text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            @click.stop="emit('selectDay', cell.date)"
          >
            {{ $t('calendar.month.more', { n: cell.overflow }) }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
