<!-- Inline SVG rather than a charting library: one line, no dependency, and
     package.json is off limits per CLAUDE.md anyway. -->
<script setup lang="ts">
const props = defineProps<{
  forecast: {
    days: { date: string, balanceMinor: number }[]
    lowest: { date: string, balanceMinor: number }
    shortfall: { date: string, balanceMinor: number } | null
    openingBalanceMinor: number
  }
  currency: string
}>()

const { moneyShort } = useMoney()
const { formatDayMonth } = useDateFormat()

const W = 600
const H = 160
const PAD = 4

const geometry = computed(() => {
  const points = props.forecast.days
  if (points.length < 2) return null

  const values = points.map(p => p.balanceMinor)
  // Scale to the data, not to zero. Anchoring at zero sounds safer, but with
  // a balance bouncing between $17k and $23k it squashes the whole line into
  // the top quarter and the shape — the only thing a chart is for — vanishes.
  // Zero is still pulled in whenever the projection actually goes negative,
  // and the zero line is drawn whenever it falls inside the visible range.
  const rawMax = Math.max(...values)
  const rawMin = Math.min(...values)
  const padding = (rawMax - rawMin || Math.abs(rawMax) || 1) * 0.1
  const max = rawMax + padding
  const min = rawMin - padding
  const span = max - min || 1

  const x = (i: number) => PAD + (i / (points.length - 1)) * (W - PAD * 2)
  const y = (v: number) => PAD + (1 - (v - min) / span) * (H - PAD * 2)

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.balanceMinor).toFixed(1)}`).join(' ')
  const area = `${line} L${x(points.length - 1).toFixed(1)},${y(min).toFixed(1)} L${x(0).toFixed(1)},${y(min).toFixed(1)} Z`

  const lowestIndex = points.findIndex(p => p.date === props.forecast.lowest.date)
  return {
    line,
    area,
    zeroY: min < 0 && max > 0 ? y(0) : null,
    lowest: lowestIndex >= 0
      ? { cx: x(lowestIndex), cy: y(points[lowestIndex]!.balanceMinor) }
      : null,
    first: points[0]!,
    last: points.at(-1)!,
  }
})
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <h2 class="font-semibold">{{ $t('finance.forecast.title') }}</h2>
        <p class="text-xs text-slate-500 dark:text-slate-400">
          {{ $t('finance.forecast.days', forecast.days.length) }}
        </p>
      </div>
    </template>

    <div v-if="geometry" class="space-y-2">
      <svg
        :viewBox="`0 0 ${W} ${H}`"
        class="h-40 w-full"
        preserveAspectRatio="none"
        role="img"
        :aria-label="$t('finance.forecast.explain')"
      >
        <defs>
          <linearGradient id="forecast-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="currentColor" stop-opacity="0.22" />
            <stop offset="100%" stop-color="currentColor" stop-opacity="0" />
          </linearGradient>
        </defs>

        <path :d="geometry.area" fill="url(#forecast-fill)" class="text-primary" />
        <path
          :d="geometry.line"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          vector-effect="non-scaling-stroke"
          class="text-primary"
        />

        <!-- Zero line: the thing people are actually looking for. -->
        <line
          v-if="geometry.zeroY != null"
          :x1="0"
          :x2="W"
          :y1="geometry.zeroY"
          :y2="geometry.zeroY"
          stroke="currentColor"
          stroke-width="1"
          stroke-dasharray="4 4"
          vector-effect="non-scaling-stroke"
          class="text-rose-500"
        />

        <circle
          v-if="geometry.lowest"
          :cx="geometry.lowest.cx"
          :cy="geometry.lowest.cy"
          r="3.5"
          fill="currentColor"
          :class="forecast.lowest.balanceMinor < 0 ? 'text-rose-500' : 'text-primary'"
          vector-effect="non-scaling-stroke"
        />
      </svg>

      <div class="flex justify-between text-xs tabular-nums text-slate-500 dark:text-slate-400">
        <span>{{ formatDayMonth(geometry.first.date) }} · {{ moneyShort(geometry.first.balanceMinor, currency) }}</span>
        <span>{{ formatDayMonth(geometry.last.date) }} · {{ moneyShort(geometry.last.balanceMinor, currency) }}</span>
      </div>

      <p class="text-xs text-slate-500 dark:text-slate-400">
        {{ $t('finance.forecast.explain') }} {{ $t('finance.forecast.basedOn') }}
      </p>
    </div>
  </UCard>
</template>
