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
  /** Settled by a deposit the server matched, not by a person. */
  autoMatched: boolean
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

// ── Sort ──────────────────────────────────────────────────────────────────
// "What's due next" and "where does the money go" are different questions
// about the same rows. Date order answers the first; grouping by category
// answers the second without a separate report page. Overdue stays in date
// order regardless — it is an urgency list, and urgency is a date.
const sortMode = ref<'date' | 'category'>('date')
const sortItems = computed(() => [
  { value: 'date', label: t('finance.bills.sortDueDate') },
  { value: 'category', label: t('finance.bills.sortCategory') },
])

const upcomingGroups = computed(() => {
  if (sortMode.value === 'date') return [{ key: '', label: null as string | null, items: upcoming.value }]
  const groups = new Map<string, Occurrence[]>()
  for (const o of upcoming.value) {
    const key = o.categoryName ?? ''
    const list = groups.get(key) ?? []
    list.push(o)
    groups.set(key, list)
  }
  // Named categories alphabetically, uncategorized last — a bucket defined by
  // what it lacks belongs after every bucket somebody actually named. Rows
  // inside each group keep the server's date order. `key` stays the raw map
  // key: the v-for keys on it, and keying on the display label would collide
  // if a real category were literally named "Uncategorized".
  return [...groups.entries()]
    .sort(([a], [b]) => Number(a === '') - Number(b === '') || a.localeCompare(b))
    .map(([key, items]) => ({ key, label: key || t('finance.bills.uncategorized'), items }))
})

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
      <div class="flex flex-wrap items-center justify-end gap-2">
        <USelect
          v-model="sortMode"
          :items="sortItems"
          size="sm"
          class="w-44"
          :aria-label="$t('finance.bills.sortBy')"
          icon="i-lucide-arrow-up-down"
        />
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
              <p class="truncate text-sm font-medium">
                {{ o.name }}
                <!-- The badge the upcoming list already had. Unmatched past
                     income lands here too, and without it a late paycheck is
                     indistinguishable from an unpaid bill — same red row,
                     opposite direction of money. -->
                <UBadge v-if="o.kind === 'income'" size="sm" color="success" variant="subtle" class="ml-1">
                  {{ $t('finance.bills.kinds.income') }}
                </UBadge>
              </p>
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
        <div v-if="upcoming.length" class="space-y-3">
          <div v-for="group in upcomingGroups" :key="group.key">
            <!-- Group headers only exist in category order; in date order the
                 whole list is one unlabelled group. -->
            <p
              v-if="group.label"
              class="pt-1 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400"
            >
              {{ group.label }}
            </p>
            <div class="divide-y divide-slate-200 dark:divide-slate-800">
              <div
                v-for="o in group.items"
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
                    <!-- The category tail is dropped in category order: it
                         would repeat the header the row sits under. -->
                    <span v-if="o.categoryName && sortMode === 'date'"> · {{ o.categoryName }}</span>
                  </p>
                </div>
                <span class="shrink-0 text-sm font-semibold tabular-nums">{{ money(o.amountMinor, o.currency) }}</span>
                <UButton size="sm" variant="soft" class="min-h-11" @click="mark(o, 'paid')">
                  {{ $t('finance.bills.markPaid') }}
                </UButton>
              </div>
            </div>
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
              <p class="text-xs text-slate-500 dark:text-slate-400">
                {{ formatDayMonth(o.dueDate) }}
                <!-- Says where the status came from: nobody ticked their own
                     wages off, the deposit did it. -->
                <span v-if="o.autoMatched"> · {{ $t('finance.bills.received') }}</span>
              </p>
            </div>
            <span class="shrink-0 text-sm tabular-nums text-slate-500 dark:text-slate-400">
              {{ money(o.amountMinor, o.currency) }}
            </span>
            <!-- No "mark due" for a matched deposit: the status is derived from
                 the transaction on every read, so deleting an override that was
                 never written would look like a button that does nothing. -->
            <UButton
              v-if="!o.autoMatched"
              size="sm"
              color="neutral"
              variant="ghost"
              class="min-h-11"
              @click="unmark(o)"
            >
              {{ $t('finance.bills.markDue') }}
            </UButton>
          </div>
        </div>
      </UCard>

      <!-- One row per bill (not per occurrence): the place to delete a bill. -->
      <FinanceBillList @changed="refresh" />

      <p class="text-xs text-slate-500 dark:text-slate-400">{{ $t('finance.bills.notOnCalendar') }}</p>
    </div>

    <FinanceBillEditor
      v-model:open="addOpen"
      :categories="categories ?? []"
      @saved="onBillSaved"
    />
  </FinanceShell>
</template>
