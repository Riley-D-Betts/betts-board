<script setup lang="ts">
const { isOwner, setPin } = useFinanceSession()
const { state, isAdmin, refresh: refreshBoard } = useBoardState()
const { t } = useI18n()
const toast = useToast()

// ── Change my own PIN ────────────────────────────────────────────────────
const pinOpen = ref(false)
const currentPin = ref('')
const newPin = ref('')
const confirmPin = ref('')
const pinError = ref('')
const savingPin = ref(false)

watch(pinOpen, (open) => {
  if (open) return
  currentPin.value = ''
  newPin.value = ''
  confirmPin.value = ''
  pinError.value = ''
})

async function changePin() {
  pinError.value = ''
  if (newPin.value.length < 6) return (pinError.value = t('finance.lock.tooShort'))
  if (newPin.value !== confirmPin.value) return (pinError.value = t('finance.lock.mismatch'))
  savingPin.value = true
  try {
    await setPin(newPin.value, currentPin.value)
    pinOpen.value = false
    // The change revoked every session, this one included — back to the lock
    // screen with the new PIN, which is the honest outcome.
    toast.add({ title: t('finance.toast.pinSet'), color: 'success' })
  }
  catch (e) {
    pinError.value = (e as { statusMessage?: string }).statusMessage || t('finance.lock.wrong')
  }
  finally {
    savingPin.value = false
  }
}

// ── Currency and forecast length ─────────────────────────────────────────
const currency = ref(state.value?.settings?.finance?.currency ?? 'USD')
const forecastDays = ref(state.value?.settings?.finance?.forecastDays ?? 90)

const CURRENCIES = ['USD', 'CAD', 'GBP', 'EUR', 'AUD', 'NZD', 'JPY', 'CHF', 'SEK', 'NOK', 'DKK', 'MXN', 'INR', 'ZAR']
const currencyItems = CURRENCIES.map(value => ({ value, label: value }))
const forecastItems = computed(() => [30, 60, 90, 180, 365]
  .map(value => ({ value, label: t('finance.settings.forecastOption', value) })))


async function saveSettings() {
  try {
    await $fetch('/api/household', {
      method: 'PATCH',
      body: { settings: { finance: { currency: currency.value, forecastDays: forecastDays.value } } },
    })
    await refreshBoard()
    toast.add({ title: t('finance.toast.saved'), color: 'success' })
    bumpDataTick()
  }
  catch (e) {
    // These live on the household row, which is admin-only. A finance owner
    // who isn't a household admin gets a 403 — say so instead of silently
    // leaving the select showing a value that was never saved.
    toast.add({
      title: (e as { statusMessage?: string }).statusMessage || t('finance.settings.adminOnly'),
      color: 'error',
    })
    await refreshBoard()
    currency.value = state.value?.settings?.finance?.currency ?? 'USD'
    forecastDays.value = state.value?.settings?.finance?.forecastDays ?? 90
  }
}
</script>

<template>
  <FinanceShell :title="$t('finance.settings.title')">
    <div class="space-y-4">
      <FinanceConnections :is-owner="isOwner" />

      <FinanceMembers :is-owner="isOwner" />

      <FinanceCategories />

      <UCard>
        <template #header>
          <h2 class="font-semibold">{{ $t('finance.settings.title') }}</h2>
        </template>

        <div class="space-y-4">
          <!-- These live on the household row, which is admin-only. Disabling
               them is kinder than letting a select change and snap back. -->
          <UFormField
            :label="$t('finance.settings.currency')"
            :help="isAdmin ? $t('finance.settings.currencyHelp') : $t('finance.settings.adminOnly')"
          >
            <USelect
              v-model="currency"
              :items="currencyItems"
              :disabled="!isAdmin"
              class="w-full sm:w-48"
              @change="saveSettings"
            />
          </UFormField>

          <UFormField :label="$t('finance.settings.forecastDays')">
            <USelect
              v-model="forecastDays"
              :items="forecastItems"
              :disabled="!isAdmin"
              class="w-full sm:w-48"
              @change="saveSettings"
            />
          </UFormField>

          <UButton color="neutral" variant="soft" icon="i-lucide-key-round" @click="pinOpen = true">
            {{ $t('finance.lock.changeTitle') }}
          </UButton>
        </div>

        <template #footer>
          <p class="text-xs text-slate-500 dark:text-slate-400">
            {{ $t('finance.settings.notOnDashboard') }}
          </p>
        </template>
      </UCard>
    </div>

    <UModal v-model:open="pinOpen" :title="$t('finance.lock.changeTitle')">
      <template #body>
        <form class="space-y-4" @submit.prevent="changePin">
          <UFormField :label="$t('finance.lock.currentPin')">
            <UInput v-model="currentPin" type="password" autocomplete="current-password" class="w-full" autofocus />
          </UFormField>
          <UFormField :label="$t('finance.lock.newPin')">
            <UInput v-model="newPin" type="password" autocomplete="new-password" class="w-full" />
          </UFormField>
          <UFormField :label="$t('finance.lock.confirmPin')">
            <UInput v-model="confirmPin" type="password" autocomplete="new-password" class="w-full" />
          </UFormField>
          <p v-if="pinError" class="text-sm text-red-600 dark:text-red-400">{{ pinError }}</p>
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="ghost" @click="pinOpen = false">
              {{ $t('common.actions.cancel') }}
            </UButton>
            <UButton type="submit" :loading="savingPin" :disabled="!currentPin || !newPin">
              {{ $t('common.actions.save') }}
            </UButton>
          </div>
        </form>
      </template>
    </UModal>
  </FinanceShell>
</template>
