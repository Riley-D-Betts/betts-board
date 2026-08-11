<script setup lang="ts">
const { unlocked, isOwner } = useFinanceSession()
const { money, moneyShort, fromInput } = useMoney()
const currency = useHouseholdCurrency()
const { t } = useI18n()
const toast = useToast()

interface Debt {
  id: string
  name: string
  orgName: string | null
  type: string
  currency: string
  source: 'bank' | 'ledger'
  owedMinor: number
  originalMinor: number | null
  paidDownMinor: number | null
  progress: number | null
  paidThisMonthMinor: number
}

const { data: debts, refresh } = await useFetch<Debt[]>('/api/finance/debts', {
  immediate: unlocked.value,
  default: () => [],
})
watch(unlocked, u => u && refresh())
useLiveRefresh(() => unlocked.value && refresh())

// One figure per currency, never summed across them — same rule as net worth.
const totals = computed(() => {
  const byCurrency = new Map<string, number>()
  for (const d of debts.value) {
    byCurrency.set(d.currency, (byCurrency.get(d.currency) ?? 0) + d.owedMinor)
  }
  return [...byCurrency.entries()].map(([code, owedMinor]) => ({ currency: code, owedMinor }))
})

// ── Add ───────────────────────────────────────────────────────────────────
const addOpen = ref(false)
const saving = ref(false)
const form = reactive({ name: '', owed: '', type: 'loan' as 'loan' | 'credit' })

const typeItems = computed(() => (['loan', 'credit'] as const)
  .map(value => ({ value, label: t(`finance.accounts.types.${value}`) })))

watch(addOpen, (open) => {
  if (!open) return
  form.name = ''
  form.owed = ''
  form.type = 'loan'
})

async function create() {
  const owedMinor = fromInput(form.owed, currency.value)
  if (!owedMinor || owedMinor < 1) return
  saving.value = true
  try {
    await $fetch('/api/finance/debts', {
      method: 'POST',
      body: { name: form.name.trim(), owedMinor, type: form.type },
    })
    addOpen.value = false
    toast.add({ title: t('finance.toast.saved'), color: 'success' })
    await refresh()
    bumpDataTick()
  }
  finally {
    saving.value = false
  }
}

// ── Record a payment ──────────────────────────────────────────────────────
const paying = ref<Debt | null>(null)
const payAmount = ref('')
const payDate = ref(todayString())
const payNote = ref('')
const payBusy = ref(false)

watch(paying, (debt) => {
  if (!debt) return
  payAmount.value = ''
  payDate.value = todayString()
  payNote.value = ''
})

async function recordPayment() {
  if (!paying.value) return
  const amountMinor = fromInput(payAmount.value, paying.value.currency)
  if (!amountMinor || amountMinor < 1) return
  payBusy.value = true
  try {
    await $fetch(`/api/finance/debts/${paying.value.id}/payments`, {
      method: 'POST',
      body: { amountMinor, paidOn: payDate.value, note: payNote.value.trim() || null },
    })
    paying.value = null
    toast.add({ title: t('finance.toast.saved'), color: 'success' })
    await refresh()
    bumpDataTick()
  }
  catch (e) {
    toast.add({
      title: (e as { statusMessage?: string }).statusMessage || t('common.errors.generic'),
      color: 'error',
    })
  }
  finally {
    payBusy.value = false
  }
}

// ── Remove ────────────────────────────────────────────────────────────────
// Manual debts don't appear in the overview's account card (this tab is their
// home), so removal has to live here too. Owner-only hard delete, same as any
// manual account; a bank-synced card is removed by disconnecting the bank.
const removing = ref<Debt | null>(null)
const removeBusy = ref(false)

function canRemove(debt: Debt) {
  return isOwner.value && debt.source === 'ledger'
}

async function confirmRemove() {
  if (!removing.value) return
  removeBusy.value = true
  try {
    await $fetch(`/api/finance/accounts/${removing.value.id}`, { method: 'DELETE' })
    removing.value = null
    toast.add({ title: t('finance.debts.removed'), color: 'success' })
    await refresh()
    bumpDataTick()
  }
  catch (e) {
    toast.add({
      title: (e as { statusMessage?: string }).statusMessage || t('common.errors.generic'),
      color: 'error',
    })
  }
  finally {
    removeBusy.value = false
  }
}
</script>

<template>
  <FinanceShell :title="$t('finance.debts.title')">
    <div class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <p v-if="totals.length" class="text-sm text-slate-500 dark:text-slate-400">
          {{ $t('finance.debts.total') }}
          <strong
            v-for="(total, i) in totals"
            :key="total.currency"
            class="tabular-nums text-rose-600 dark:text-rose-400"
          ><template v-if="i > 0"> · </template>{{ moneyShort(total.owedMinor, total.currency) }}</strong>
        </p>
        <span v-else />
        <UButton icon="i-lucide-plus" @click="addOpen = true">{{ $t('finance.debts.add') }}</UButton>
      </div>

      <div v-if="debts.length" class="grid gap-4 sm:grid-cols-2">
        <UCard v-for="debt in debts" :key="debt.id">
          <div class="space-y-3">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <h2 class="truncate font-semibold">{{ debt.name }}</h2>
                <p class="text-xs text-slate-500 dark:text-slate-400">
                  <span v-if="debt.orgName">{{ debt.orgName }} · </span>
                  {{ debt.source === 'bank'
                    ? $t('finance.debts.fromBank')
                    : $t(`finance.accounts.types.${debt.type}`) }}
                </p>
              </div>
              <UBadge v-if="debt.owedMinor === 0" color="success" variant="subtle">
                {{ $t('finance.debts.paidOff') }}
              </UBadge>
              <UButton
                v-else-if="canRemove(debt)"
                icon="i-lucide-trash-2"
                size="sm"
                color="neutral"
                variant="ghost"
                class="shrink-0"
                :aria-label="$t('finance.debts.remove')"
                @click="removing = debt"
              />
            </div>

            <p class="text-2xl font-bold tabular-nums" :class="debt.owedMinor ? 'text-rose-600 dark:text-rose-400' : ''">
              {{ money(debt.owedMinor, debt.currency) }}
            </p>

            <!-- The bar runs toward zero. Only a manual debt has a fixed
                 principal to measure against; a card's limit is not one. -->
            <div v-if="debt.originalMinor">
              <div class="mb-1 text-sm tabular-nums text-slate-500 dark:text-slate-400">
                {{ $t('finance.debts.paidDown', {
                  paid: moneyShort(debt.paidDownMinor ?? 0, debt.currency),
                  original: moneyShort(debt.originalMinor, debt.currency),
                }) }}
              </div>
              <UProgress
                :model-value="Math.round((debt.progress ?? 0) * 100)"
                :color="(debt.progress ?? 0) >= 1 ? 'success' : 'primary'"
              />
            </div>

            <div class="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span v-if="debt.paidThisMonthMinor" class="text-emerald-600 dark:text-emerald-400 tabular-nums">
                {{ $t('finance.debts.paidThisMonth', { amount: money(debt.paidThisMonthMinor, debt.currency) }) }}
              </span>
              <span v-else class="text-slate-500 dark:text-slate-400">
                {{ $t('finance.debts.nothingThisMonth') }}
              </span>

              <UButton
                v-if="debt.source === 'ledger' && debt.owedMinor > 0"
                size="sm"
                variant="soft"
                class="min-h-11"
                @click="paying = debt"
              >
                {{ $t('finance.debts.recordPayment') }}
              </UButton>
            </div>

            <p v-if="debt.source === 'bank'" class="text-xs text-slate-500 dark:text-slate-400">
              {{ $t('finance.debts.bankNoManual') }}
            </p>
          </div>
        </UCard>
      </div>

      <UCard v-else>
        <p class="py-4 text-center text-sm text-slate-500 dark:text-slate-400">
          {{ $t('finance.debts.empty') }}
        </p>
      </UCard>
    </div>

    <UModal v-model:open="addOpen" :title="$t('finance.debts.add')">
      <template #body>
        <form class="space-y-4" @submit.prevent="create">
          <UFormField :label="$t('finance.debts.name')">
            <UInput v-model="form.name" maxlength="80" class="w-full" autofocus />
          </UFormField>
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField :label="$t('finance.debts.amountOwed')">
              <UInput v-model="form.owed" type="number" step="0.01" min="0" inputmode="decimal" class="w-full" />
            </UFormField>
            <UFormField :label="$t('finance.debts.kind')">
              <USelect v-model="form.type" :items="typeItems" class="w-full" />
            </UFormField>
          </div>
          <p class="text-xs text-slate-500 dark:text-slate-400">
            {{ $t('finance.debts.addHelp') }}
          </p>
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="ghost" @click="addOpen = false">
              {{ $t('common.actions.cancel') }}
            </UButton>
            <UButton type="submit" :loading="saving" :disabled="!form.name.trim() || !form.owed">
              {{ $t('common.actions.save') }}
            </UButton>
          </div>
        </form>
      </template>
    </UModal>

    <UModal
      :open="!!paying"
      :title="$t('finance.debts.paymentTitle', { name: paying?.name ?? '' })"
      @update:open="open => { if (!open) paying = null }"
    >
      <template #body>
        <form class="space-y-4" @submit.prevent="recordPayment">
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField :label="$t('finance.debts.paymentAmount')">
              <UInput v-model="payAmount" type="number" step="0.01" min="0" inputmode="decimal" class="w-full" autofocus />
            </UFormField>
            <UFormField :label="$t('finance.debts.paymentDate')">
              <UInput v-model="payDate" type="date" class="w-full" />
            </UFormField>
          </div>
          <UFormField :label="$t('finance.debts.paymentNote')">
            <UInput v-model="payNote" maxlength="200" class="w-full" />
          </UFormField>
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="ghost" @click="paying = null">
              {{ $t('common.actions.cancel') }}
            </UButton>
            <UButton type="submit" :loading="payBusy" :disabled="!payAmount">
              {{ $t('common.actions.save') }}
            </UButton>
          </div>
        </form>
      </template>
    </UModal>

    <UModal
      :open="!!removing"
      :title="$t('finance.debts.remove')"
      @update:open="open => { if (!open) removing = null }"
    >
      <template #body>
        <div class="space-y-4">
          <p class="text-sm">
            {{ $t('finance.debts.removeConfirm', { name: removing?.name ?? '' }) }}
          </p>
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="ghost" @click="removing = null">
              {{ $t('common.actions.cancel') }}
            </UButton>
            <UButton color="error" :loading="removeBusy" @click="confirmRemove">
              {{ $t('common.actions.delete') }}
            </UButton>
          </div>
        </div>
      </template>
    </UModal>
  </FinanceShell>
</template>
