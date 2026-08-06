<!-- Inline SVG rather than a charting library: one line, no dependency, and
     package.json is off limits per CLAUDE.md anyway. -->
<script setup lang="ts">
const props = defineProps<{
  forecast: {
    days: { date: string, balanceMinor: number }[]
    lowest: { date: string, balanceMinor: number }
    shortfall: { date: string, balanceMinor: number } | null
    openingBalanceMinor: number
    ledger?: {
      date: string
      name: string | null
      kind: 'income' | 'bill' | 'goal' | 'spending'
      amountMinor: number
      balanceMinor: number
    }[]
    /** False when the household switched the everyday-spend drain off. */
    includesEverydaySpend?: boolean
    accounts?: {
      counted: { id: string, name: string, balanceMinor: number }[]
      unclassified: { id: string, name: string, balanceMinor: number }[]
    }
  }
  currency: string
}>()

const { money, moneyShort, moneySigned } = useMoney()
const { formatDayMonth } = useDateFormat()
const { t } = useI18n()

const W = 600
const H = 160
const PAD = 4

// Only accounts holding money are worth naming — an empty `other` account is
// noise, and warning about it would train people to ignore the whole notice.
const unclassified = computed(() =>
  (props.forecast.accounts?.unclassified ?? []).filter(a => a.balanceMinor !== 0))
const unclassifiedTotal = computed(() =>
  unclassified.value.reduce((acc, a) => acc + a.balanceMinor, 0))

// ── The math, one movement at a time ──────────────────────────────────────
// The ledger answers "why is my lowest balance THAT?" by retracing the walk
// the chart drew. Bills and income keep their own rows; consecutive days of
// nothing but the everyday-spend average collapse into one row (the average
// is synthetic — thirty identical rows of it would bury the bills the reader
// came to check), which is safe to do because a spending-only stretch never
// climbs, so the collapsed row's closing balance is the stretch's floor.
const showMath = ref(false)

interface LedgerRow {
  key: string
  label: string
  dateLabel: string
  /** The last date the row covers — what the lowest marker is matched on. */
  endDate: string
  amountMinor: number
  balanceMinor: number
  kind: 'income' | 'bill' | 'goal' | 'spending'
}

const ledgerRows = computed<LedgerRow[]>(() => {
  const rows: LedgerRow[] = []
  let run: { start: string, end: string, amountMinor: number, balanceMinor: number } | null = null

  const flush = () => {
    if (!run) return
    rows.push({
      key: `spending:${run.start}`,
      label: t('finance.forecast.everydaySpending'),
      dateLabel: run.start === run.end
        ? formatDayMonth(run.start)
        : `${formatDayMonth(run.start)} – ${formatDayMonth(run.end)}`,
      endDate: run.end,
      amountMinor: run.amountMinor,
      balanceMinor: run.balanceMinor,
      kind: 'spending',
    })
    run = null
  }

  for (const item of props.forecast.ledger ?? []) {
    if (item.kind === 'spending') {
      if (run) {
        run.end = item.date
        run.amountMinor += item.amountMinor
        run.balanceMinor = item.balanceMinor
      }
      else {
        run = { start: item.date, end: item.date, amountMinor: item.amountMinor, balanceMinor: item.balanceMinor }
      }
      continue
    }
    flush()
    rows.push({
      // rows.length disambiguates two same-named bills on the same day.
      key: `${item.kind}:${item.date}:${item.name ?? ''}:${rows.length}`,
      label: item.name ?? t('finance.forecast.goalTransfer'),
      dateLabel: formatDayMonth(item.date),
      endDate: item.date,
      amountMinor: item.amountMinor,
      balanceMinor: item.balanceMinor,
      kind: item.kind,
    })
  }
  flush()
  return rows
})

function isLowestRow(row: LedgerRow) {
  return row.endDate === props.forecast.lowest.date
    && row.balanceMinor === props.forecast.lowest.balanceMinor
}

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

      <!-- The caption must describe the projection actually running: with the
           everyday-spend drain switched off, "minus what you usually spend"
           would be a claim about math that isn't happening. -->
      <p class="text-xs text-slate-500 dark:text-slate-400">
        <template v-if="forecast.includesEverydaySpend !== false">
          {{ $t('finance.forecast.explain') }} {{ $t('finance.forecast.basedOn') }}
        </template>
        <template v-else>
          {{ $t('finance.forecast.explainBillsOnly') }}
        </template>
      </p>

      <!-- Whose money this line is made of, named, whenever an account was left
           out for want of a type. The projection counts spendable cash, and a
           synced account's type is a guess from its name — so real money can go
           missing from the forecast while sitting in the account list one card
           away, and every number here reads as a catastrophe. Saying which
           accounts were skipped turns an unexplainable figure into a fixable
           one; the account list is where it gets fixed. -->
      <p
        v-if="unclassified.length"
        class="rounded-lg bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
      >
        <UIcon name="i-lucide-triangle-alert" class="mr-1 inline size-3.5 align-[-2px]" />
        {{ $t('finance.forecast.notCounted', {
          accounts: unclassified.map(a => a.name).join(', '),
          amount: moneyShort(unclassifiedTotal, currency),
        }) }}
      </p>

      <!-- The walk behind the line, one movement at a time. -->
      <div v-if="ledgerRows.length">
        <UButton
          size="sm"
          color="neutral"
          variant="link"
          class="px-0"
          :icon="showMath ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
          @click="showMath = !showMath"
        >
          {{ $t('finance.forecast.breakdown') }}
        </UButton>

        <div
          v-if="showMath"
          class="mt-1 max-h-80 overflow-y-auto rounded-lg bg-slate-50 px-3 dark:bg-slate-900/50"
        >
          <div class="divide-y divide-slate-200 dark:divide-slate-800">
            <div class="flex items-baseline gap-2 py-1.5 text-xs">
              <span class="w-24 shrink-0 text-slate-500 dark:text-slate-400">{{ $t('common.actions.today') }}</span>
              <span class="min-w-0 flex-1 truncate font-medium">{{ $t('finance.forecast.openingBalance') }}</span>
              <span class="shrink-0 tabular-nums font-semibold">{{ money(forecast.openingBalanceMinor, currency) }}</span>
            </div>

            <div
              v-for="row in ledgerRows"
              :key="row.key"
              class="flex items-baseline gap-2 py-1.5 text-xs"
            >
              <span class="w-24 shrink-0 text-slate-500 dark:text-slate-400">{{ row.dateLabel }}</span>
              <span class="min-w-0 flex-1 truncate" :class="row.kind === 'spending' || row.kind === 'goal' ? 'text-slate-500 dark:text-slate-400' : 'font-medium'">
                {{ row.label }}
                <UBadge v-if="isLowestRow(row)" size="sm" variant="subtle" color="primary" class="ml-1">
                  {{ $t('finance.forecast.lowestTag') }}
                </UBadge>
              </span>
              <span
                class="shrink-0 tabular-nums"
                :class="row.amountMinor > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'"
              >
                {{ moneySigned(row.amountMinor, currency) }}
              </span>
              <!-- Balance after the movement: the column the whole view is for. -->
              <span
                class="w-20 shrink-0 text-right tabular-nums font-semibold"
                :class="row.balanceMinor < 0 ? 'text-rose-600 dark:text-rose-400' : ''"
              >
                {{ money(row.balanceMinor, currency) }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </UCard>
</template>
