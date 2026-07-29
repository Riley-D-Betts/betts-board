<script setup lang="ts">
const { unlocked } = useFinanceSession()
const { money } = useMoney()
const { formatDayMonth } = useDateFormat()
const { t } = useI18n()
const toast = useToast()

interface Occurrence {
  billId: string
  name: string
  kind: 'expense' | 'income'
  dueDate: string
  amountMinor: number
  currency: string
  categoryName: string | null
  status: 'due' | 'paid' | 'skipped'
}

const windowStart = computed(() => addDaysToDateString(todayString(), -30))
const windowEnd = computed(() => addDaysToDateString(todayString(), 90))

const { data, refresh } = await useFetch<Occurrence[]>('/api/finance/bills/upcoming', {
  immediate: unlocked.value,
  default: () => [],
  query: computed(() => ({ start: windowStart.value, end: windowEnd.value })),
})
const { data: categories, refresh: refreshCategories } = await useFetch<{ id: string, name: string }[]>('/api/finance/categories', {
  immediate: unlocked.value,
  default: () => [],
})
watch(unlocked, u => u && Promise.all([refresh(), refreshCategories()]))
useLiveRefresh(() => unlocked.value && refresh())

const today = todayString()
const overdue = computed(() => data.value.filter(o => o.status === 'due' && o.dueDate < today))
const upcoming = computed(() => data.value.filter(o => o.status === 'due' && o.dueDate >= today))
const handled = computed(() => data.value.filter(o => o.status !== 'due').slice(0, 20))

async function mark(occurrence: Occurrence, status: 'paid' | 'skipped') {
  await $fetch(`/api/finance/bills/${occurrence.billId}/mark`, {
    method: 'POST',
    body: { dueDate: occurrence.dueDate, status },
  })
  toast.add({ title: t('finance.toast.saved'), color: 'success' })
  await refresh()
  bumpDataTick()
}

async function unmark(occurrence: Occurrence) {
  await $fetch(`/api/finance/bills/${occurrence.billId}/mark`, {
    method: 'DELETE',
    query: { dueDate: occurrence.dueDate },
  })
  await refresh()
}

// ── Add ──────────────────────────────────────────────────────────────────
// The form itself lives in FinanceBillEditor so the Bills page and the
// "turn a transaction into a bill" action share one implementation.
const addOpen = ref(false)

async function onBillSaved() {
  await refresh()
  bumpDataTick()
}

function daysOverdue(dueDate: string) {
  return Math.abs(dateStringDiffDays(dueDate, today))
}
</script>

<template>
  <FinanceShell :title="$t('finance.bills.title')">
    <div class="space-y-4">
      <div class="flex justify-end">
        <UButton icon="i-lucide-plus" @click="addOpen = true">{{ $t('finance.bills.add') }}</UButton>
      </div>

      <UCard v-if="overdue.length">
        <template #header>
          <h2 class="font-semibold text-rose-600 dark:text-rose-400">{{ $t('finance.overview.overdue') }}</h2>
        </template>
        <div class="divide-y divide-slate-200 dark:divide-slate-800">
          <div
            v-for="o in overdue"
            :key="`${o.billId}-${o.dueDate}`"
            class="flex flex-wrap items-center gap-3 py-2"
          >
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium">{{ o.name }}</p>
              <p class="text-xs text-rose-600 dark:text-rose-400">
                {{ $t('finance.bills.overdueBy', daysOverdue(o.dueDate)) }}
              </p>
            </div>
            <span class="shrink-0 text-sm font-semibold tabular-nums">{{ money(o.amountMinor, o.currency) }}</span>
            <UButton size="sm" class="min-h-11" @click="mark(o, 'paid')">{{ $t('finance.bills.markPaid') }}</UButton>
            <UButton
              size="sm"
              color="neutral"
              variant="ghost"
              class="min-h-11"
              @click="mark(o, 'skipped')"
            >
              {{ $t('finance.bills.markSkipped') }}
            </UButton>
          </div>
        </div>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-semibold">{{ $t('finance.overview.upcoming') }}</h2>
        </template>
        <div v-if="upcoming.length" class="divide-y divide-slate-200 dark:divide-slate-800">
          <div
            v-for="o in upcoming"
            :key="`${o.billId}-${o.dueDate}`"
            class="flex flex-wrap items-center gap-3 py-2"
          >
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium">
                {{ o.name }}
                <UBadge v-if="o.kind === 'income'" size="sm" color="success" variant="subtle" class="ml-1">
                  {{ $t('finance.bills.kinds.income') }}
                </UBadge>
              </p>
              <p class="text-xs text-slate-500 dark:text-slate-400">
                {{ $t('finance.bills.dueOn', { date: formatDayMonth(o.dueDate) }) }}
                <span v-if="o.categoryName"> · {{ o.categoryName }}</span>
              </p>
            </div>
            <span class="shrink-0 text-sm font-semibold tabular-nums">{{ money(o.amountMinor, o.currency) }}</span>
            <UButton size="sm" variant="soft" class="min-h-11" @click="mark(o, 'paid')">
              {{ $t('finance.bills.markPaid') }}
            </UButton>
          </div>
        </div>
        <p v-else class="py-4 text-center text-sm text-slate-500 dark:text-slate-400">
          {{ $t('finance.bills.empty') }}
        </p>
      </UCard>

      <UCard v-if="handled.length">
        <template #header>
          <h2 class="font-semibold">{{ $t('finance.bills.paid') }}</h2>
        </template>
        <div class="divide-y divide-slate-200 dark:divide-slate-800">
          <div
            v-for="o in handled"
            :key="`${o.billId}-${o.dueDate}`"
            class="flex flex-wrap items-center gap-3 py-2"
          >
            <UIcon
              :name="o.status === 'paid' ? 'i-lucide-check-circle-2' : 'i-lucide-circle-slash'"
              class="size-4 shrink-0 text-slate-400"
            />
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm">{{ o.name }}</p>
              <p class="text-xs text-slate-500 dark:text-slate-400">{{ formatDayMonth(o.dueDate) }}</p>
            </div>
            <span class="shrink-0 text-sm tabular-nums text-slate-500 dark:text-slate-400">
              {{ money(o.amountMinor, o.currency) }}
            </span>
            <UButton size="sm" color="neutral" variant="ghost" class="min-h-11" @click="unmark(o)">
              {{ $t('finance.bills.markDue') }}
            </UButton>
          </div>
        </div>
      </UCard>

      <p class="text-xs text-slate-500 dark:text-slate-400">{{ $t('finance.bills.notOnCalendar') }}</p>
    </div>

    <FinanceBillEditor
      v-model:open="addOpen"
      :categories="categories ?? []"
      @saved="onBillSaved"
    />
  </FinanceShell>
</template>
