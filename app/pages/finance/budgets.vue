<script setup lang="ts">
const { unlocked } = useFinanceSession()
const { money, moneyShort, toInput, fromInput } = useMoney()

interface BudgetLine {
  categoryId: string
  categoryName: string
  categoryIcon: string | null
  categoryColor: string | null
  budgetId: string | null
  amountMinor: number
  spentMinor: number
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

function shiftMonth(delta: number) {
  const [y, m] = period.value.split('-').map(Number)
  const date = new Date(y!, m! - 1 + delta, 1)
  period.value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

/** Colour by how far over, not a gradient — "am I over?" is the question. */
function barColor(line: BudgetLine) {
  if (!line.amountMinor) return 'neutral'
  if (line.spentMinor > line.amountMinor) return 'error'
  if (line.spentMinor > line.amountMinor * 0.9) return 'warning'
  return 'primary'
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
          <span class="min-w-28 text-center font-medium tabular-nums">{{ data.period }}</span>
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
                :aria-label="`${line.categoryName} ${$t('finance.budgets.setAmount')}`"
                @blur="save(line)"
                @keyup.enter="save(line)"
              />
            </div>

            <div v-if="line.amountMinor" class="flex items-center gap-3">
              <UProgress
                :model-value="Math.min(100, Math.round((line.progress ?? 0) * 100))"
                :color="barColor(line)"
                size="sm"
                class="flex-1"
              />
              <span
                class="w-32 shrink-0 text-right text-xs tabular-nums"
                :class="line.remainingMinor < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500 dark:text-slate-400'"
              >
                <template v-if="line.remainingMinor < 0">
                  {{ $t('finance.budgets.over', { amount: money(-line.remainingMinor, data.currency) }) }}
                </template>
                <template v-else>
                  {{ money(line.remainingMinor, data.currency) }} {{ $t('finance.budgets.remaining').toLowerCase() }}
                </template>
              </span>
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
