<!-- Money overview. Note what is NOT here: no tile of this appears on the
     dashboard, and nothing under /tv/* can reach it — /tv renders with no
     acting profile, so the server gate refuses it outright. -->
<script setup lang="ts">
const { unlocked } = useFinanceSession()
const { money, moneyShort, percent } = useMoney()
const { formatDayMonth } = useDateFormat()

interface Overview {
  currency: string
  netWorth: { currency: string, currencyExponent: number, assetsMinor: number, liabilitiesMinor: number, netMinor: number }[]
  accounts: { id: string, name: string, type: string, currency: string, balanceMinor: number, balanceAt: number | null, connectionId: string | null, orgName: string | null }[]
  upcomingBills: { billId: string, name: string, dueDate: string, amountMinor: number, currency: string, kind: string }[]
  overdueBills: { billId: string, name: string, dueDate: string, amountMinor: number, currency: string, kind: string }[]
  budget: { period: string, totalBudgetedMinor: number, totalSpentMinor: number, uncategorizedMinor: number, overspent: number }
  goals: { id: string, name: string, savedMinor: number, targetMinor: number, currency: string, progress: number, icon: string | null }[]
  forecast: {
    days: { date: string, balanceMinor: number }[]
    lowest: { date: string, balanceMinor: number }
    shortfall: { date: string, balanceMinor: number } | null
    openingBalanceMinor: number
  }
}

const { data, refresh } = await useFetch<Overview>('/api/finance/overview', {
  // Locked means 403; render the lock screen instead of an error page.
  immediate: unlocked.value,
})
watch(unlocked, u => u && refresh())
useLiveRefresh(() => unlocked.value && refresh())

const budgetProgress = computed(() => {
  const b = data.value?.budget
  if (!b?.totalBudgetedMinor) return null
  return b.totalSpentMinor / b.totalBudgetedMinor
})
</script>

<template>
  <FinanceShell>
    <div v-if="data" class="space-y-4">
      <!-- Net worth, one card per currency: never summed across them, because
           this app has no FX rate and a wrong total is worse than two. -->
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <UCard v-for="nw in data.netWorth" :key="nw.currency">
          <p class="text-sm text-slate-500 dark:text-slate-400">{{ $t('finance.overview.netWorth') }}</p>
          <p class="mt-1 text-3xl font-bold tabular-nums">{{ moneyShort(nw.netMinor, nw.currency) }}</p>
          <div class="mt-3 flex gap-4 text-sm">
            <span class="text-emerald-600 dark:text-emerald-400">
              {{ $t('finance.overview.assets') }} {{ moneyShort(nw.assetsMinor, nw.currency) }}
            </span>
            <span v-if="nw.liabilitiesMinor" class="text-rose-600 dark:text-rose-400">
              {{ $t('finance.overview.liabilities') }} {{ moneyShort(Math.abs(nw.liabilitiesMinor), nw.currency) }}
            </span>
          </div>
        </UCard>

        <UCard v-if="data.forecast">
          <p class="text-sm text-slate-500 dark:text-slate-400">{{ $t('finance.overview.lowestPoint') }}</p>
          <p
            class="mt-1 text-3xl font-bold tabular-nums"
            :class="data.forecast.lowest.balanceMinor < 0 ? 'text-rose-600 dark:text-rose-400' : ''"
          >
            {{ moneyShort(data.forecast.lowest.balanceMinor, data.currency) }}
          </p>
          <p class="mt-3 text-sm text-slate-500 dark:text-slate-400">
            {{ $t('finance.overview.lowestPointOn', { date: formatDayMonth(data.forecast.lowest.date) }) }}
          </p>
        </UCard>

        <UCard>
          <p class="text-sm text-slate-500 dark:text-slate-400">{{ $t('finance.overview.thisMonth') }}</p>
          <p class="mt-1 text-3xl font-bold tabular-nums">
            {{ moneyShort(data.budget.totalSpentMinor, data.currency) }}
          </p>
          <div class="mt-3 space-y-2 text-sm">
            <p v-if="data.budget.totalBudgetedMinor" class="text-slate-500 dark:text-slate-400">
              {{ $t('finance.overview.spentOf', {
                spent: moneyShort(data.budget.totalSpentMinor, data.currency),
                budget: moneyShort(data.budget.totalBudgetedMinor, data.currency),
              }) }}
              <span v-if="budgetProgress != null"> · {{ percent(budgetProgress) }}</span>
            </p>
            <p v-if="data.budget.overspent" class="text-amber-600 dark:text-amber-400">
              {{ $t('finance.overview.overspentIn', data.budget.overspent) }}
            </p>
            <p v-if="data.budget.uncategorizedMinor" class="text-slate-500 dark:text-slate-400">
              {{ $t('finance.overview.uncategorized', { amount: money(data.budget.uncategorizedMinor, data.currency) }) }}
            </p>
          </div>
        </UCard>
      </div>

      <p
        v-if="data.forecast?.shortfall"
        class="flex items-start gap-2 rounded-lg bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/40 dark:text-rose-200"
      >
        <UIcon name="i-lucide-triangle-alert" class="mt-0.5 size-4 shrink-0" />
        {{ $t('finance.overview.shortfall', { date: formatDayMonth(data.forecast.shortfall.date) }) }}
      </p>

      <div class="grid gap-4 lg:grid-cols-2">
        <FinanceAccountList :accounts="data.accounts" @changed="refresh" />

        <UCard>
          <template #header>
            <h2 class="font-semibold">{{ $t('finance.overview.upcoming') }}</h2>
          </template>

          <div v-if="data.overdueBills.length" class="mb-3 space-y-1">
            <p class="text-xs font-medium uppercase tracking-wide text-rose-600 dark:text-rose-400">
              {{ $t('finance.overview.overdue') }}
            </p>
            <FinanceBillRow
              v-for="bill in data.overdueBills"
              :key="`${bill.billId}-${bill.dueDate}`"
              :bill="bill"
              overdue
              @changed="refresh"
            />
          </div>

          <div v-if="data.upcomingBills.length" class="space-y-1">
            <FinanceBillRow
              v-for="bill in data.upcomingBills"
              :key="`${bill.billId}-${bill.dueDate}`"
              :bill="bill"
              @changed="refresh"
            />
          </div>
          <p
            v-else-if="!data.overdueBills.length"
            class="py-2 text-sm text-slate-500 dark:text-slate-400"
          >
            {{ $t('finance.overview.nothingDue') }}
          </p>
        </UCard>
      </div>

      <FinanceForecastChart v-if="data.forecast" :forecast="data.forecast" :currency="data.currency" />

      <UCard v-if="data.goals.length">
        <template #header>
          <div class="flex items-center justify-between">
            <h2 class="font-semibold">{{ $t('finance.goals.title') }}</h2>
            <UButton to="/finance/goals" variant="ghost" size="sm" trailing-icon="i-lucide-arrow-right">
              {{ $t('finance.nav.goals') }}
            </UButton>
          </div>
        </template>
        <div class="grid gap-3 sm:grid-cols-2">
          <div v-for="goal in data.goals" :key="goal.id" class="space-y-1">
            <div class="flex items-baseline justify-between gap-2">
              <span class="truncate text-sm font-medium">{{ goal.name }}</span>
              <span class="shrink-0 text-xs tabular-nums text-slate-500 dark:text-slate-400">
                {{ $t('finance.goals.saved', {
                  saved: moneyShort(goal.savedMinor, goal.currency),
                  target: moneyShort(goal.targetMinor, goal.currency),
                }) }}
              </span>
            </div>
            <UProgress :model-value="Math.round(goal.progress * 100)" size="sm" />
          </div>
        </div>
      </UCard>
    </div>
  </FinanceShell>
</template>
