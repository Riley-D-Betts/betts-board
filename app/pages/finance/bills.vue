<script setup lang="ts">
const { unlocked } = useFinanceSession()
const { money, fromInput } = useMoney()
const { formatDayMonth } = useDateFormat()
const { t } = useI18n()
const toast = useToast()

const NO_CATEGORY = 'none'

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
const { data: categories } = await useFetch<{ id: string, name: string }[]>('/api/finance/categories', {
  immediate: unlocked.value,
  default: () => [],
})
watch(unlocked, u => u && refresh())
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
const addOpen = ref(false)
const saving = ref(false)
const form = reactive({
  name: '',
  kind: 'expense' as 'expense' | 'income',
  amount: '',
  startDate: todayString(),
  frequency: 'FREQ=MONTHLY',
  categoryId: NO_CATEGORY,
})

const kindItems = computed(() => (['expense', 'income'] as const)
  .map(value => ({ value, label: t(`finance.bills.kinds.${value}`) })))

const frequencyItems = computed(() => [
  { value: 'FREQ=MONTHLY', label: t('finance.bills.repeats') + ': monthly' },
  { value: 'FREQ=WEEKLY', label: t('finance.bills.repeats') + ': weekly' },
  { value: 'FREQ=WEEKLY;INTERVAL=2', label: t('finance.bills.repeats') + ': every 2 weeks' },
  { value: 'FREQ=YEARLY', label: t('finance.bills.repeats') + ': yearly' },
  { value: 'once', label: t('finance.bills.repeats') + ': once' },
])

const categoryItems = computed(() => [
  { label: t('finance.transactions.uncategorized'), value: NO_CATEGORY },
  ...(categories.value ?? []).map(c => ({ label: c.name, value: c.id })),
])

watch(addOpen, (open) => {
  if (!open) return
  form.name = ''
  form.amount = ''
  form.startDate = todayString()
  form.frequency = 'FREQ=MONTHLY'
  form.categoryId = NO_CATEGORY
})

async function create() {
  const amountMinor = fromInput(form.amount)
  if (amountMinor == null) return
  saving.value = true
  try {
    await $fetch('/api/finance/bills', {
      method: 'POST',
      body: {
        name: form.name.trim(),
        kind: form.kind,
        amountMinor: Math.abs(amountMinor),
        startDate: form.startDate,
        // "once" means no rule at all rather than a COUNT=1 rule — simpler to
        // read back, and the expander already handles a null rrule.
        rrule: form.frequency === 'once' ? null : form.frequency,
        categoryId: form.categoryId === NO_CATEGORY ? null : form.categoryId,
      },
    })
    addOpen.value = false
    toast.add({ title: t('finance.toast.saved'), color: 'success' })
    await refresh()
  }
  finally {
    saving.value = false
  }
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

    <UModal v-model:open="addOpen" :title="$t('finance.bills.add')">
      <template #body>
        <form class="space-y-4" @submit.prevent="create">
          <UFormField :label="$t('finance.bills.name')">
            <UInput v-model="form.name" class="w-full" autofocus />
          </UFormField>
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField :label="$t('finance.bills.kind')">
              <USelect v-model="form.kind" :items="kindItems" class="w-full" />
            </UFormField>
            <UFormField :label="$t('finance.bills.amount')">
              <UInput v-model="form.amount" type="number" step="0.01" min="0" inputmode="decimal" class="w-full" />
            </UFormField>
          </div>
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField :label="$t('finance.bills.startDate')">
              <UInput v-model="form.startDate" type="date" class="w-full" />
            </UFormField>
            <UFormField :label="$t('finance.bills.repeats')">
              <USelect v-model="form.frequency" :items="frequencyItems" class="w-full" />
            </UFormField>
          </div>
          <UFormField :label="$t('finance.transactions.category')">
            <USelect v-model="form.categoryId" :items="categoryItems" class="w-full" />
          </UFormField>
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="ghost" @click="addOpen = false">
              {{ $t('common.actions.cancel') }}
            </UButton>
            <UButton type="submit" :loading="saving" :disabled="!form.name.trim() || !form.amount">
              {{ $t('common.actions.save') }}
            </UButton>
          </div>
        </form>
      </template>
    </UModal>
  </FinanceShell>
</template>
