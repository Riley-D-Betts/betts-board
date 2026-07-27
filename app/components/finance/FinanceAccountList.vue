<script setup lang="ts">
interface AccountRow {
  id: string
  name: string
  type: string
  currency: string
  balanceMinor: number
  balanceAt: number | null
  connectionId: string | null
  orgName: string | null
}

defineProps<{ accounts: AccountRow[] }>()
const emit = defineEmits<{ changed: [] }>()

const { money, fromInput } = useMoney()
const currency = useHouseholdCurrency()
const { formatTime } = useDateFormat()
const { t } = useI18n()
const toast = useToast()

const addOpen = ref(false)
const saving = ref(false)
const form = reactive({ name: '', type: 'checking', balance: '' })

const ICONS: Record<string, string> = {
  checking: 'i-lucide-landmark',
  savings: 'i-lucide-piggy-bank',
  credit: 'i-lucide-credit-card',
  cash: 'i-lucide-banknote',
  investment: 'i-lucide-trending-up',
  loan: 'i-lucide-handshake',
  other: 'i-lucide-wallet',
}

const typeItems = computed(() =>
  Object.keys(ICONS).map(value => ({ value, label: t(`finance.accounts.types.${value}`) })))

async function create() {
  saving.value = true
  try {
    await $fetch('/api/finance/accounts', {
      method: 'POST',
      body: {
        name: form.name.trim(),
        type: form.type,
        currency: currency.value,
        openingBalanceMinor: fromInput(form.balance, currency.value) ?? 0,
      },
    })
    addOpen.value = false
    form.name = ''
    form.balance = ''
    toast.add({ title: t('finance.toast.saved'), color: 'success' })
    emit('changed')
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center justify-between gap-2">
        <h2 class="font-semibold">{{ $t('finance.accounts.title') }}</h2>
        <UButton icon="i-lucide-plus" size="sm" variant="ghost" @click="addOpen = true">
          {{ $t('finance.accounts.add') }}
        </UButton>
      </div>
    </template>

    <div v-if="accounts.length" class="divide-y divide-slate-200 dark:divide-slate-800">
      <NuxtLink
        v-for="account in accounts"
        :key="account.id"
        :to="`/finance/transactions?accountId=${account.id}`"
        class="flex min-h-14 items-center gap-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/50"
      >
        <div class="grid size-9 shrink-0 place-items-center rounded-lg bg-slate-100 dark:bg-slate-800">
          <UIcon :name="ICONS[account.type] ?? ICONS.other!" class="size-4 text-slate-500" />
        </div>
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium">{{ account.name }}</p>
          <p class="truncate text-xs text-slate-500 dark:text-slate-400">
            <span v-if="account.orgName">{{ account.orgName }} · </span>
            <span v-if="account.connectionId && account.balanceAt">
              {{ $t('finance.overview.asOf', { time: formatTime(account.balanceAt) }) }}
            </span>
            <span v-else-if="!account.connectionId">{{ $t('finance.accounts.manual') }}</span>
          </p>
        </div>
        <span
          class="shrink-0 text-sm font-semibold tabular-nums"
          :class="account.balanceMinor < 0 ? 'text-rose-600 dark:text-rose-400' : ''"
        >
          {{ money(account.balanceMinor, account.currency) }}
        </span>
      </NuxtLink>
    </div>
    <p v-else class="py-2 text-sm text-slate-500 dark:text-slate-400">
      {{ $t('finance.accounts.empty') }}
    </p>

    <UModal v-model:open="addOpen" :title="$t('finance.accounts.addManual')">
      <template #body>
        <form class="space-y-4" @submit.prevent="create">
          <UFormField :label="$t('finance.accounts.name')">
            <UInput v-model="form.name" class="w-full" autofocus />
          </UFormField>
          <UFormField :label="$t('finance.accounts.type')">
            <USelect v-model="form.type" :items="typeItems" class="w-full" />
          </UFormField>
          <UFormField
            :label="$t('finance.accounts.openingBalance')"
            :help="$t('finance.accounts.openingBalanceHelp')"
          >
            <!-- Numeric input, never a localized string: under de-DE that
                 would be "1.234,56" and would not round-trip. -->
            <UInput v-model="form.balance" type="number" step="0.01" inputmode="decimal" class="w-full" />
          </UFormField>
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="ghost" @click="addOpen = false">
              {{ $t('common.actions.cancel') }}
            </UButton>
            <UButton type="submit" :loading="saving" :disabled="!form.name.trim()">
              {{ $t('common.actions.save') }}
            </UButton>
          </div>
        </form>
      </template>
    </UModal>
  </UCard>
</template>
