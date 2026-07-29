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
const { isOwner } = useFinanceSession()
const { t } = useI18n()
const toast = useToast()

const addOpen = ref(false)
const saving = ref(false)
const form = reactive({ name: '', type: 'checking', balance: '' })

// ── Remove ────────────────────────────────────────────────────────────────
// Two different things wear the same bin icon, because "get this off my board"
// is one intent:
//   • a manual account is DELETED outright (owner-only, matching the DELETE
//     route's requireFinanceOwner);
//   • a bank account is HIDDEN — the server refuses to delete it because the
//     next sync would just bring it back. Hiding survives syncs (ingestAccount
//     never touches archivedAt) and is reversible from "Hidden accounts".
//     Removing every account from a bank is disconnecting the bank, in settings.
const removeOpen = ref(false)
const removing = ref<AccountRow | null>(null)
const removeBusy = ref(false)

const removingIsBank = computed(() => !!removing.value?.connectionId)

function askRemove(account: AccountRow) {
  removing.value = account
  removeOpen.value = true
}

/** Manual accounts only — the DELETE route is owner-only. */
function canDelete(account: AccountRow) {
  return isOwner.value && !account.connectionId
}

async function confirmRemove() {
  if (!removing.value) return
  removeBusy.value = true
  const bank = removingIsBank.value
  try {
    if (bank) {
      await $fetch(`/api/finance/accounts/${removing.value.id}`, {
        method: 'PATCH',
        body: { archived: true },
      })
    }
    else {
      await $fetch(`/api/finance/accounts/${removing.value.id}`, { method: 'DELETE' })
    }
    removeOpen.value = false
    toast.add({ title: bank ? t('finance.accounts.hidden') : t('finance.accounts.removed'), color: 'success' })
    emit('changed')
    await loadHidden(true)
  }
  catch (e) {
    toast.add({
      title: (e as { statusMessage?: string }).statusMessage || t('finance.accounts.removeFailed'),
      color: 'error',
    })
  }
  finally {
    removeBusy.value = false
  }
}

// ── Hidden accounts ───────────────────────────────────────────────────────
// Fetched lazily: hiding an account must be undoable, but most people never
// open this, so it costs nothing until they do.
const hiddenOpen = ref(false)
const hiddenAccounts = ref<AccountRow[]>([])
const hiddenLoading = ref(false)

async function loadHidden(onlyIfLoaded = false) {
  if (onlyIfLoaded && !hiddenOpen.value && !hiddenAccounts.value.length) return
  hiddenLoading.value = true
  try {
    const res = await $fetch<{ accounts: (AccountRow & { archivedAt: number | null })[] }>(
      '/api/finance/accounts', { query: { includeArchived: 'true' } },
    )
    hiddenAccounts.value = res.accounts.filter(a => a.archivedAt)
  }
  finally {
    hiddenLoading.value = false
  }
}

watch(hiddenOpen, open => open && loadHidden())

async function restore(account: AccountRow) {
  try {
    await $fetch(`/api/finance/accounts/${account.id}`, { method: 'PATCH', body: { archived: false } })
    toast.add({ title: t('finance.accounts.restored'), color: 'success' })
    emit('changed')
    await loadHidden()
  }
  catch (e) {
    toast.add({
      title: (e as { statusMessage?: string }).statusMessage || t('common.errors.generic'),
      color: 'error',
    })
  }
}

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
      <!-- The remove button lives OUTSIDE the link: a <button> nested in an <a>
           is invalid, and it would also swallow the row's navigation. -->
      <div v-for="account in accounts" :key="account.id" class="flex items-center gap-1">
        <NuxtLink
          :to="`/finance/transactions?accountId=${account.id}`"
          class="flex min-h-14 min-w-0 flex-1 items-center gap-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/50"
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
        <!-- Manual: owner-only hard delete. Bank: anyone with money access can
             hide it (the PATCH route is requireFinanceAccess). -->
        <UButton
          v-if="canDelete(account) || account.connectionId"
          icon="i-lucide-trash-2"
          size="sm"
          color="neutral"
          variant="ghost"
          class="shrink-0"
          :aria-label="account.connectionId ? $t('finance.accounts.hide') : $t('finance.accounts.remove')"
          @click="askRemove(account)"
        />
      </div>
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

    <!-- Hidden accounts, so hiding one is never a one-way door. -->
    <div v-if="hiddenOpen || hiddenAccounts.length" class="mt-2 border-t border-slate-200 pt-2 dark:border-slate-800">
      <div v-if="hiddenLoading" class="py-2 text-sm text-slate-500 dark:text-slate-400">
        {{ $t('common.state.loading') }}
      </div>
      <div v-else-if="hiddenAccounts.length" class="divide-y divide-slate-200 dark:divide-slate-800">
        <div v-for="account in hiddenAccounts" :key="account.id" class="flex min-h-12 items-center gap-3 py-2">
          <UIcon name="i-lucide-eye-off" class="size-4 shrink-0 text-slate-400" />
          <p class="min-w-0 flex-1 truncate text-sm text-slate-500 dark:text-slate-400">
            {{ account.name }}
            <span v-if="account.orgName"> · {{ account.orgName }}</span>
          </p>
          <UButton size="sm" color="neutral" variant="soft" class="shrink-0" @click="restore(account)">
            {{ $t('finance.accounts.restore') }}
          </UButton>
        </div>
      </div>
      <p v-else class="py-2 text-sm text-slate-500 dark:text-slate-400">
        {{ $t('finance.accounts.noHidden') }}
      </p>
    </div>

    <template #footer>
      <UButton
        size="sm"
        color="neutral"
        variant="link"
        class="px-0"
        :icon="hiddenOpen ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
        @click="hiddenOpen = !hiddenOpen"
      >
        {{ $t('finance.accounts.hiddenAccounts') }}
      </UButton>
    </template>

    <!-- Manual accounts are deleted; bank accounts are hidden. -->
    <UModal
      v-model:open="removeOpen"
      :title="removingIsBank ? $t('finance.accounts.hide') : $t('finance.accounts.remove')"
    >
      <template #body>
        <div class="space-y-4">
          <p class="text-sm">
            {{ removingIsBank
              ? $t('finance.accounts.hideConfirm', { name: removing?.name ?? '' })
              : $t('finance.accounts.removeConfirm', { name: removing?.name ?? '' }) }}
          </p>
          <p v-if="removingIsBank" class="text-sm text-slate-500 dark:text-slate-400">
            {{ $t('finance.accounts.disconnectHint') }}
            <NuxtLink to="/finance/settings" class="text-primary underline">
              {{ $t('finance.nav.settings') }}
            </NuxtLink>
          </p>
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="ghost" @click="removeOpen = false">
              {{ $t('common.actions.cancel') }}
            </UButton>
            <UButton
              :color="removingIsBank ? 'primary' : 'error'"
              :loading="removeBusy"
              @click="confirmRemove"
            >
              {{ removingIsBank ? $t('finance.accounts.hide') : $t('finance.accounts.remove') }}
            </UButton>
          </div>
        </div>
      </template>
    </UModal>
  </UCard>
</template>
