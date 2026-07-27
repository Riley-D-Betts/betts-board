<script setup lang="ts">
const { unlocked } = useFinanceSession()
const { moneySigned, fromInput } = useMoney()
const currency = useHouseholdCurrency()
const { formatDayMonth } = useDateFormat()
const { t } = useI18n()
const toast = useToast()
const route = useRoute()

const NO_FILTER = 'all'

interface TxnItem {
  id: string
  accountId: string
  accountName: string
  postedDate: string
  amountMinor: number
  currency: string
  description: string
  payee: string | null
  pending: boolean
  categoryId: string | null
  categoryName: string | null
  categoryIcon: string | null
  source: string
}

const q = ref('')
const accountId = ref((route.query.accountId as string) || NO_FILTER)
const categoryId = ref(NO_FILTER)
const uncategorizedOnly = ref(false)
const limit = ref(100)

const debouncedQ = refDebounced(q, 250)

const { data: accountData, refresh: refreshAccounts } = await useFetch<{ accounts: { id: string, name: string, currency: string }[] }>(
  '/api/finance/accounts',
  { immediate: unlocked.value, default: () => ({ accounts: [] }) },
)
const { data: categories, refresh: refreshCategories } = await useFetch<{ id: string, name: string, icon: string | null }[]>(
  '/api/finance/categories',
  { immediate: unlocked.value, default: () => [] },
)

const { data, refresh } = await useFetch<{ total: number, items: TxnItem[] }>('/api/finance/transactions', {
  immediate: unlocked.value,
  default: () => ({ total: 0, items: [] }),
  query: computed(() => ({
    ...(debouncedQ.value ? { q: debouncedQ.value } : {}),
    ...(accountId.value !== NO_FILTER ? { accountId: accountId.value } : {}),
    ...(categoryId.value !== NO_FILTER ? { categoryId: categoryId.value } : {}),
    ...(uncategorizedOnly.value ? { uncategorized: 'true' } : {}),
    limit: limit.value,
  })),
})
// Every list has to reload on unlock, not just the ledger: they were skipped
// while locked, and an empty account list makes "Add transaction" fail
// silently — create() returns early with no account to post to.
watch(unlocked, u => u && Promise.all([refresh(), refreshAccounts(), refreshCategories()]))
useLiveRefresh(() => unlocked.value && refresh())

/** Sentinels, not '': Reka's SelectItem throws on an empty-string value. */
const accountItems = computed(() => [
  { label: t('finance.transactions.allAccounts'), value: NO_FILTER },
  ...(accountData.value?.accounts ?? []).map(a => ({ label: a.name, value: a.id })),
])
const categoryItems = computed(() => [
  { label: t('finance.transactions.allCategories'), value: NO_FILTER },
  ...(categories.value ?? []).map(c => ({ label: c.name, value: c.id })),
])

// Grouped by day: a flat list of 100 rows is unreadable on a phone.
const grouped = computed(() => {
  const groups = new Map<string, TxnItem[]>()
  for (const item of data.value?.items ?? []) {
    const bucket = groups.get(item.postedDate) ?? []
    bucket.push(item)
    groups.set(item.postedDate, bucket)
  }
  return [...groups.entries()]
})

async function setCategory(txn: TxnItem, value: string) {
  await $fetch(`/api/finance/transactions/${txn.id}`, {
    method: 'PATCH',
    body: { categoryId: value === NO_FILTER ? null : value },
  })
  await refresh()
}

// ── Add ──────────────────────────────────────────────────────────────────
const addOpen = ref(false)
const saving = ref(false)
const form = reactive({
  accountId: '',
  postedDate: todayString(),
  amount: '',
  description: '',
  categoryId: NO_FILTER,
})

watch(addOpen, (open) => {
  if (!open) return
  form.accountId = accountData.value?.accounts[0]?.id ?? ''
  form.postedDate = todayString()
  form.amount = ''
  form.description = ''
  form.categoryId = NO_FILTER
})

async function create() {
  const amountMinor = fromInput(form.amount, currency.value)
  if (amountMinor == null || !form.accountId) return
  saving.value = true
  try {
    await $fetch('/api/finance/transactions', {
      method: 'POST',
      body: {
        accountId: form.accountId,
        postedDate: form.postedDate,
        amountMinor,
        description: form.description.trim(),
        categoryId: form.categoryId === NO_FILTER ? null : form.categoryId,
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
</script>

<template>
  <FinanceShell :title="$t('finance.transactions.title')">
    <div class="space-y-4">
      <div class="flex flex-wrap gap-2">
        <UInput
          v-model="q"
          icon="i-lucide-search"
          :placeholder="$t('finance.transactions.search')"
          class="min-w-48 flex-1"
        />
        <USelect v-model="accountId" :items="accountItems" class="min-w-40" />
        <USelect v-model="categoryId" :items="categoryItems" class="min-w-40" />
        <UButton icon="i-lucide-plus" @click="addOpen = true">
          {{ $t('finance.transactions.add') }}
        </UButton>
      </div>

      <div class="flex flex-wrap items-center gap-3">
        <USwitch v-model="uncategorizedOnly" :label="$t('finance.transactions.uncategorizedOnly')" />
        <FinanceImportDialog :accounts="accountData?.accounts ?? []" @imported="refresh" />
      </div>

      <div v-if="grouped.length" class="space-y-4">
        <UCard v-for="[date, items] in grouped" :key="date">
          <template #header>
            <h2 class="text-sm font-semibold text-slate-500 dark:text-slate-400">
              {{ formatDayMonth(date) }}
            </h2>
          </template>

          <div class="divide-y divide-slate-200 dark:divide-slate-800">
            <!-- On a phone the description gets its own row: sharing one line
                 with the category picker and the amount crushed it to "SEC…". -->
            <div v-for="txn in items" :key="txn.id" class="min-h-14 py-2 sm:flex sm:items-center sm:gap-3">
              <div class="flex items-center gap-3 sm:min-w-0 sm:flex-1">
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-medium">
                    {{ txn.description }}
                    <UBadge v-if="txn.pending" size="sm" color="warning" variant="subtle" class="ml-1">
                      {{ $t('finance.transactions.pending') }}
                    </UBadge>
                  </p>
                  <p class="truncate text-xs text-slate-500 dark:text-slate-400">{{ txn.accountName }}</p>
                </div>
                <span
                  class="shrink-0 text-sm font-semibold tabular-nums sm:hidden"
                  :class="txn.amountMinor > 0 ? 'text-emerald-600 dark:text-emerald-400' : ''"
                >
                  {{ moneySigned(txn.amountMinor, txn.currency) }}
                </span>
              </div>

              <USelect
                :model-value="txn.categoryId ?? NO_FILTER"
                :items="categoryItems"
                size="sm"
                class="mt-2 w-full sm:mt-0 sm:w-40 sm:shrink-0"
                :aria-label="$t('finance.transactions.category')"
                @update:model-value="(v: string) => setCategory(txn, v)"
              />

              <span
                class="hidden w-24 shrink-0 text-right text-sm font-semibold tabular-nums sm:inline"
                :class="txn.amountMinor > 0 ? 'text-emerald-600 dark:text-emerald-400' : ''"
              >
                {{ moneySigned(txn.amountMinor, txn.currency) }}
              </span>
            </div>
          </div>
        </UCard>

        <div v-if="data && data.items.length < data.total" class="flex flex-col items-center gap-2">
          <p class="text-xs text-slate-500 dark:text-slate-400">
            {{ $t('finance.transactions.showing', { shown: data.items.length, total: data.total }) }}
          </p>
          <UButton variant="ghost" @click="limit += 100">{{ $t('finance.transactions.loadMore') }}</UButton>
        </div>
      </div>

      <UCard v-else>
        <p class="py-4 text-center text-sm text-slate-500 dark:text-slate-400">
          {{ q || accountId !== NO_FILTER ? $t('finance.transactions.noMatch') : $t('finance.transactions.empty') }}
        </p>
      </UCard>
    </div>

    <UModal v-model:open="addOpen" :title="$t('finance.transactions.add')">
      <template #body>
        <form class="space-y-4" @submit.prevent="create">
          <UFormField :label="$t('finance.transactions.description')">
            <UInput v-model="form.description" class="w-full" autofocus />
          </UFormField>
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField :label="$t('finance.transactions.date')">
              <UInput v-model="form.postedDate" type="date" class="w-full" />
            </UFormField>
            <UFormField
              :label="$t('finance.transactions.amount')"
              :help="$t('finance.transactions.amountHelp')"
            >
              <UInput v-model="form.amount" type="number" step="0.01" inputmode="decimal" class="w-full" />
            </UFormField>
          </div>
          <UFormField :label="$t('finance.accounts.title')">
            <USelect
              v-model="form.accountId"
              :items="(accountData?.accounts ?? []).map(a => ({ label: a.name, value: a.id }))"
              class="w-full"
            />
          </UFormField>
          <UFormField :label="$t('finance.transactions.category')">
            <USelect v-model="form.categoryId" :items="categoryItems" class="w-full" />
          </UFormField>
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="ghost" @click="addOpen = false">
              {{ $t('common.actions.cancel') }}
            </UButton>
            <UButton type="submit" :loading="saving" :disabled="!form.description.trim() || !form.amount">
              {{ $t('common.actions.save') }}
            </UButton>
          </div>
        </form>
      </template>
    </UModal>
  </FinanceShell>
</template>
