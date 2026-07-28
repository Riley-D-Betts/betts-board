<!-- The gate in front of every money screen. Purely presentational: the server
     rejects finance requests without a live session no matter what renders. -->
<script setup lang="ts">
const { state, pending, unlock, setPin, refresh } = useFinanceSession()
const { activeProfile } = useBoardState()
const { t } = useI18n()
const toast = useToast()

const pin = ref('')
const newPin = ref('')
const confirmPin = ref('')
const error = ref('')

const mode = computed<'unlock' | 'setup' | 'noAccess'>(() => {
  // A member whose PIN was cleared by BETTS_RESET_FINANCE_PIN. This has to be
  // checked BEFORE `enrolled`, or the screen offers an unlock form that can
  // never succeed — unlockFinance refuses a profile with no stored hash — and
  // the documented recovery path becomes unreachable from the app.
  if (state.value?.needsPin) return 'setup'
  if (state.value?.enrolled) return 'unlock'
  // Trust on first use: with nobody enrolled, the household password is the
  // only anchor there is, and demanding it again would add ceremony without
  // security — everyone in the house knows it.
  if (!state.value?.configured) return 'setup'
  return 'noAccess'
})

const lockedOutMinutes = computed(() => {
  const until = state.value?.lockedUntil
  if (!until || until <= Date.now()) return 0
  return Math.ceil((until - Date.now()) / 60_000)
})

async function submitUnlock() {
  error.value = ''
  try {
    await unlock(pin.value, deviceLabel())
    pin.value = ''
  }
  catch (e) {
    error.value = (e as { statusMessage?: string }).statusMessage || t('finance.lock.wrong')
    pin.value = ''
    await refresh()
  }
}

async function submitSetup() {
  error.value = ''
  if (newPin.value.length < 6) return (error.value = t('finance.lock.tooShort'))
  if (newPin.value !== confirmPin.value) return (error.value = t('finance.lock.mismatch'))
  try {
    await setPin(newPin.value)
    toast.add({ title: t('finance.toast.pinSet'), color: 'success' })
    // Setting a PIN revokes every session, this one included — so unlock with
    // the PIN just chosen rather than pretending to already be in.
    pin.value = newPin.value
    newPin.value = ''
    confirmPin.value = ''
    await submitUnlock()
  }
  catch (e) {
    error.value = (e as { statusMessage?: string }).statusMessage || t('finance.lock.wrong')
  }
}

/**
 * Shown in the "unlocked right now" list, so a stray device is noticeable.
 *
 * This value is PERSISTED on the session row, so it stays a stable English
 * token and is translated where it is rendered (FinanceMembers). Storing the
 * translated word would write the unlocking device's language into the
 * database and leave two sessions in the same list disagreeing with each other.
 */
function deviceLabel(): 'phone' | 'tablet' | 'computer' | undefined {
  if (import.meta.server) return undefined
  const ua = navigator.userAgent
  if (/iPhone|Android.*Mobile/.test(ua)) return 'phone'
  if (/iPad|Tablet/.test(ua)) return 'tablet'
  return 'computer'
}
</script>

<template>
  <div class="mx-auto flex max-w-md flex-col gap-4 py-10">
    <UCard>
      <template #header>
        <div class="flex items-center gap-3">
          <div class="grid size-11 shrink-0 place-items-center rounded-full bg-primary/10">
            <UIcon name="i-lucide-lock" class="size-5 text-primary" />
          </div>
          <div>
            <h1 class="text-lg font-semibold">
              {{ mode === 'setup' ? $t('finance.lock.setUpTitle') : $t('finance.lock.title') }}
            </h1>
            <p v-if="activeProfile" class="text-sm text-slate-500 dark:text-slate-400">
              {{ activeProfile.name }}
            </p>
          </div>
        </div>
      </template>

      <!-- First run -->
      <form v-if="mode === 'setup'" class="space-y-4" @submit.prevent="submitSetup">
        <p class="text-sm text-slate-600 dark:text-slate-300">{{ $t('finance.lock.setUpBody') }}</p>
        <UFormField :label="$t('finance.lock.newPin')">
          <UInput
            v-model="newPin"
            type="password"
            autocomplete="new-password"
            :placeholder="$t('finance.lock.pin')"
            size="xl"
            class="w-full"
          />
        </UFormField>
        <UFormField :label="$t('finance.lock.confirmPin')">
          <UInput v-model="confirmPin" type="password" autocomplete="new-password" size="xl" class="w-full" />
        </UFormField>
        <p v-if="error" class="text-sm text-red-600 dark:text-red-400">{{ error }}</p>
        <UButton type="submit" size="xl" block :loading="pending">{{ $t('finance.lock.setUpCta') }}</UButton>
      </form>

      <!-- Someone else owns it and hasn't given this profile access -->
      <div v-else-if="mode === 'noAccess'" class="space-y-3">
        <p class="text-sm text-slate-600 dark:text-slate-300">{{ $t('finance.lock.noAccess') }}</p>
        <p v-if="state?.ownerName" class="text-sm text-slate-500 dark:text-slate-400">
          {{ $t('finance.lock.askOwner', { name: state.ownerName }) }}
        </p>
      </div>

      <!-- Normal unlock -->
      <form v-else class="space-y-4" @submit.prevent="submitUnlock">
        <UFormField :label="$t('finance.lock.prompt')">
          <UInput
            v-model="pin"
            type="password"
            autocomplete="current-password"
            :placeholder="$t('finance.lock.pin')"
            size="xl"
            autofocus
            class="w-full"
          />
        </UFormField>

        <p v-if="lockedOutMinutes" class="text-sm text-red-600 dark:text-red-400">
          {{ $t('finance.lock.lockedOut', { minutes: lockedOutMinutes }) }}
        </p>
        <p v-else-if="error" class="text-sm text-red-600 dark:text-red-400">{{ error }}</p>

        <!-- Detection beats prevention for a family: make a stranger's
             attempts visible rather than only counting them. -->
        <p
          v-if="state?.failedSinceLastUnlock"
          class="flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 p-3 text-sm text-amber-800 dark:text-amber-200"
        >
          <UIcon name="i-lucide-triangle-alert" class="mt-0.5 size-4 shrink-0" />
          {{ $t('finance.lock.failedAttempts', state.failedSinceLastUnlock) }}
        </p>

        <UButton
          type="submit"
          size="xl"
          block
          :loading="pending"
          :disabled="!pin || lockedOutMinutes > 0"
        >
          {{ $t('finance.lock.unlock') }}
        </UButton>
      </form>
    </UCard>

    <p v-if="state?.resetArmed" class="rounded-lg bg-amber-50 dark:bg-amber-950/40 p-3 text-sm text-amber-800 dark:text-amber-200">
      {{ $t('finance.lock.resetArmed') }}
    </p>

    <!-- Say what this actually protects. Overstating it would be worse than
         not having it at all. -->
    <p class="px-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
      {{ $t('finance.lock.honest') }}
    </p>
  </div>
</template>
