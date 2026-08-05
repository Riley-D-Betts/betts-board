<script setup lang="ts">
const { unlocked } = useFinanceSession()
const { money, moneyShort, toInput, fromInput } = useMoney()
const { formatMonthYear, formatDayMonth } = useDateFormat()

interface BudgetLine {
  categoryId: string
  categoryName: string
  categoryIcon: string | null
  categoryColor: string | null
  budgetId: string | null
  amountMinor: number
  spentMinor: number
  committedMinor: number
  remainingMinor: number
  progress: number | null
  transactionCount: number
}

function currentPeriod(): string {
  return todayString().slice(0, 7)
}

const period = ref(currentPeriod())

const { data, refresh } = await useFetch<{
  period: string
  currency: string
  lines: BudgetLine[]
  totalBudgetedMinor: number
  totalSpentMinor: number
  totalCommittedMinor: number
  uncategorizedMinor: number
}>('/api/finance/budgets', {
  immediate: unlocked.value,
  query: computed(() => ({ periodStart: period.value })),
})
watch(unlocked, u => u && refresh())

/** Edits are held locally so typing doesn't refetch on every keystroke. */
const drafts = reactive<Record<string, string>>({})
const savingId = ref<string | null>(null)

watch(data, (value) => {
  // Rebuild rather than delete key-by-key; the draft map is small and this
  // keeps it in step with whichever month is loaded.
  const next: Record<string, string> = {}
  for (const line of value?.lines ?? []) {
    next[line.categoryId] = line.amountMinor ? toInput(line.amountMinor, value!.currency) : ''
  }
  Object.assign(drafts, next)
  for (const key of Object.keys(drafts)) {
    if (!(key in next)) drafts[key] = ''
  }
}, { immediate: true })

async function save(line: BudgetLine) {
  const amountMinor = fromInput(drafts[line.categoryId] ?? '', data.value?.currency) ?? 0
  if (amountMinor === line.amountMinor) return
  savingId.value = line.categoryId
  try {
    await $fetch('/api/finance/budgets', {
      method: 'POST',
      body: { categoryId: line.categoryId, periodStart: period.value, amountMinor, rollover: false },
    })
    await refresh()
  }
  finally {
    savingId.value = null
  }
}

/** `period` is a "YYYY-MM" machine key; anchor it to the 1st for display only. */
const monthLabel = computed(() => formatMonthYear(`${data.value?.period ?? period.value}-01`))

// ── Bills behind the reservation ──────────────────────────────────────────
// The violet segment says HOW MUCH of a category is spoken for; this says BY
// WHAT. Same expansion the reserved figure was computed from (the /upcoming
// route takes any window), fetched over the same month, grouped client-side —
// a second shape of the same server data, not a second source of truth.
interface MonthOccurrence {
  billId: string
  name: string
  kind: 'expense' | 'income'
  dueDate: string
  amountMinor: number
  currency: string
  categoryId: string | null
  status: 'due' | 'paid' | 'skipped'
}

/** Half-open month window, matching the server's monthWindow(). */
const monthQuery = computed(() => {
  const [y, m] = period.value.split('-').map(Number)
  const next = new Date(y!, m!, 1) // month is 1-based here, so this IS the next month
  return {
    start: `${period.value}-01`,
    end: `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-01`,
  }
})

const { data: monthBills, refresh: refreshBills } = await useFetch<MonthOccurrence[]>(
  '/api/finance/bills/upcoming', {
    immediate: unlocked.value,
    default: () => [],
    query: monthQuery,
  },
)
watch(unlocked, u => u && refreshBills())

// Bill statuses change from OTHER places — marked paid on a phone, or settled
// server-side when a sync lands the matching deposit — so this view has to
// poll like every other finance view that shows bill state. Both fetches ride
// along: the reserved figures come from the same rows the chips do, and
// refreshing one without the other would show a chip contradicting its bar.
useLiveRefresh(() => unlocked.value && Promise.all([refresh(), refreshBills()]))

// Expense occurrences only: an income bill never reserves an expense budget
// (mirrors the `kind === 'expense'` filter the reserved figure is built with).
const billsByCategory = computed(() => {
  const map = new Map<string, MonthOccurrence[]>()
  for (const o of monthBills.value) {
    if (o.kind !== 'expense' || !o.categoryId) continue
    const list = map.get(o.categoryId) ?? []
    list.push(o)
    map.set(o.categoryId, list)
  }
  return map
})

// Per-category, not one global flag, so comparing two categories side by side
// doesn't force them open and shut in lockstep.
const expanded = ref(new Set<string>())
function toggleBills(categoryId: string) {
  const next = new Set(expanded.value)
  if (!next.delete(categoryId)) next.add(categoryId)
  expanded.value = next
}

function billsFor(line: BudgetLine): MonthOccurrence[] {
  return billsByCategory.value.get(line.categoryId) ?? []
}

function shiftMonth(delta: number) {
  const [y, m] = period.value.split('-').map(Number)
  const date = new Date(y!, m! - 1 + delta, 1)
  period.value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

/** Colour by how far over, not a gradient — "am I over?" is the question. This
 *  is the SPENT segment's colour, driven by real spend; reservations show as a
 *  separate violet segment and turn the "left"/"over" figure, not this bar. */
function barColor(line: BudgetLine) {
  if (!line.amountMinor) return 'neutral'
  if (line.spentMinor > line.amountMinor) return 'error'
  if (line.spentMinor > line.amountMinor * 0.9) return 'warning'
  return 'primary'
}

function spentBarClass(line: BudgetLine) {
  switch (barColor(line)) {
    case 'error': return 'bg-rose-500'
    case 'warning': return 'bg-amber-500'
    case 'neutral': return 'bg-slate-400'
    default: return 'bg-primary'
  }
}

/** Segment widths as a % of the budget; spent first, then reserved, capped at 100% together. */
function segWidth(line: BudgetLine) {
  const base = line.amountMinor || 1
  const spent = Math.max(0, Math.min(100, (line.spentMinor / base) * 100))
  const committed = Math.max(0, Math.min(100 - spent, (line.committedMinor / base) * 100))
  return { spent: `${spent}%`, committed: `${committed}%` }
}
</script>

<template>
  <FinanceShell :title="$t('finance.budgets.title')">
    <div v-if="data" class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-1">
          <UButton
            icon="i-lucide-chevron-left"
            variant="ghost"
            color="neutral"
            class="size-11 justify-center"
            :aria-label="$t('common.actions.back')"
            @click="shiftMonth(-1)"
          />
          <span class="min-w-28 text-center font-medium tabular-nums">{{ monthLabel }}</span>
          <UButton
            icon="i-lucide-chevron-right"
            variant="ghost"
            color="neutral"
            class="size-11 justify-center"
            :aria-label="$t('finance.budgets.month')"
            @click="shiftMonth(1)"
          />
        </div>

        <div class="flex gap-4 text-sm">
          <span class="text-slate-500 dark:text-slate-400">
            {{ $t('finance.budgets.totalBudgeted') }}
            <strong class="tabular-nums text-slate-900 dark:text-slate-100">
              {{ moneyShort(data.totalBudgetedMinor, data.currency) }}
            </strong>
          </span>
          <span class="text-slate-500 dark:text-slate-400">
            {{ $t('finance.budgets.totalSpent') }}
            <strong class="tabular-nums text-slate-900 dark:text-slate-100">
              {{ moneyShort(data.totalSpentMinor, data.currency) }}
            </strong>
          </span>
          <span v-if="data.totalCommittedMinor" class="text-slate-500 dark:text-slate-400">
            {{ $t('finance.budgets.totalReserved') }}
            <strong class="tabular-nums text-violet-600 dark:text-violet-400">
              {{ moneyShort(data.totalCommittedMinor, data.currency) }}
            </strong>
          </span>
        </div>
      </div>

      <p v-if="data.uncategorizedMinor" class="rounded-lg bg-slate-100 p-3 text-sm dark:bg-slate-800">
        {{ $t('finance.overview.uncategorized', { amount: money(data.uncategorizedMinor, data.currency) }) }}
        <NuxtLink to="/finance/transactions" class="ml-1 text-primary underline">
          {{ $t('finance.transactions.uncategorizedOnly') }}
        </NuxtLink>
      </p>

      <UCard v-if="data.lines.length">
        <div class="divide-y divide-slate-200 dark:divide-slate-800">
          <div v-for="line in data.lines" :key="line.categoryId" class="space-y-2 py-3">
            <div class="flex flex-wrap items-center gap-3">
              <UIcon
                :name="line.categoryIcon ?? 'i-lucide-circle'"
                class="size-4 shrink-0"
                :style="line.categoryColor ? { color: line.categoryColor } : undefined"
              />
              <span class="min-w-0 flex-1 truncate text-sm font-medium">{{ line.categoryName }}</span>

              <!-- Exact, not rounded: it sits inches from the exact "left" /
                   "over by" figure, and "$154 spent, $150 budget, over by
                   $3.50" reads like a bug. -->
              <span class="shrink-0 text-sm tabular-nums text-slate-500 dark:text-slate-400">
                {{ money(line.spentMinor, data.currency) }}
              </span>

              <UInput
                v-model="drafts[line.categoryId]"
                type="number"
                step="0.01"
                inputmode="decimal"
                size="sm"
                class="w-28 shrink-0"
                :placeholder="$t('finance.budgets.noBudget')"
                :loading="savingId === line.categoryId"
                :aria-label="$t('finance.budgets.setAmountFor', { category: line.categoryName })"
                @blur="save(line)"
                @keyup.enter="save(line)"
              />
            </div>

            <div v-if="line.amountMinor" class="flex items-center gap-3">
              <!-- Two segments: real spend, then money reserved by unpaid bills
                   (violet). UProgress can only draw one fill, hence the hand-rolled
                   track. -->
              <div class="relative h-2 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                <div class="flex h-full">
                  <div class="h-full transition-[width]" :class="spentBarClass(line)" :style="{ width: segWidth(line).spent }" />
                  <div class="h-full bg-violet-500 transition-[width] dark:bg-violet-400" :style="{ width: segWidth(line).committed }" />
                </div>
              </div>
              <span
                class="w-32 shrink-0 text-right text-xs tabular-nums"
                :class="line.remainingMinor < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500 dark:text-slate-400'"
              >
                <template v-if="line.remainingMinor < 0">
                  {{ $t('finance.budgets.over', { amount: money(-line.remainingMinor, data.currency) }) }}
                </template>
                <template v-else>
                  {{ $t('finance.budgets.remainingAmount', { amount: money(line.remainingMinor, data.currency) }) }}
                </template>
              </span>
            </div>

            <!-- The reserved line doubles as the toggle whenever there are
                 bills to show. Shown even with nothing reserved — "everything
                 here is already paid" is exactly what someone opening this
                 wants to confirm. -->
            <UButton
              v-if="billsFor(line).length"
              size="sm"
              color="neutral"
              variant="link"
              class="px-0 text-xs"
              :class="line.committedMinor ? 'text-violet-600 dark:text-violet-400' : ''"
              :icon="expanded.has(line.categoryId) ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
              :aria-label="$t('finance.budgets.showBills', { category: line.categoryName })"
              @click="toggleBills(line.categoryId)"
            >
              <span class="tabular-nums">
                {{ line.committedMinor
                  ? $t('finance.budgets.reservedAmount', { amount: money(line.committedMinor, data.currency) })
                  : $t('finance.budgets.billCount', billsFor(line).length) }}
              </span>
            </UButton>
            <p v-else-if="line.committedMinor" class="text-xs text-violet-600 tabular-nums dark:text-violet-400">
              {{ $t('finance.budgets.reservedAmount', { amount: money(line.committedMinor, data.currency) }) }}
            </p>

            <div
              v-if="expanded.has(line.categoryId)"
              class="ml-7 divide-y divide-slate-200 rounded-lg bg-slate-50 px-3 dark:divide-slate-800 dark:bg-slate-900/50"
            >
              <div
                v-for="o in billsFor(line)"
                :key="`${o.billId}-${o.dueDate}`"
                class="flex items-center gap-3 py-2"
              >
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm">{{ o.name }}</p>
                  <p class="text-xs text-slate-500 dark:text-slate-400">
                    {{ $t('finance.bills.dueOn', { date: formatDayMonth(o.dueDate) }) }}
                  </p>
                </div>
                <span class="shrink-0 text-sm tabular-nums">{{ money(o.amountMinor, o.currency) }}</span>
                <!-- Three fates, told apart at a glance: paid, dismissed
                     (skipped), and still due — the violet money the bar above
                     is reserving. Only expense occurrences reach this list, so
                     the "received" tag auto-matched income wears elsewhere
                     never applies here. -->
                <UBadge
                  size="sm"
                  variant="subtle"
                  :color="o.status === 'due' ? 'primary' : o.status === 'paid' ? 'success' : 'neutral'"
                  :class="o.status === 'due' ? 'bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300' : ''"
                >
                  {{ o.status === 'due'
                    ? $t('finance.budgets.totalReserved')
                    : o.status === 'skipped' ? $t('finance.bills.skipped') : $t('finance.bills.paid') }}
                </UBadge>
              </div>
            </div>
          </div>
        </div>
      </UCard>

      <UCard v-else>
        <p class="py-4 text-center text-sm text-slate-500 dark:text-slate-400">
          {{ $t('finance.budgets.empty') }}
        </p>
      </UCard>

      <p class="text-xs text-slate-500 dark:text-slate-400">{{ $t('finance.budgets.carriedForward') }}</p>
    </div>
  </FinanceShell>
</template>
