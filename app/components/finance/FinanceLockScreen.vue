<!-- The gate in front of every money screen. Purely presentational: the server
     rejects finance requests without a live session no matter what renders.

     PIN entry is an on-screen keypad rather than a text field — this lives on a
     kitchen tablet, where a keyboard covers half the screen. FinancePinPad
     keeps a "use a password instead" escape hatch for PINs that contain
     letters, which zPin still allows. -->
<script setup lang="ts">
import { canSubmit } from '#shared/utils/pinPad'

const { state, pending, unlock, setPin, refresh } = useFinanceSession()
const { activeProfile, isAdmin } = useBoardState()
const { t } = useI18n()
const toast = useToast()

const pin = ref('')
const newPin = ref('')
const confirmPin = ref('')
const error = ref('')
/** Flipped by the guide's CTA — explain the section before asking for a secret. */
const startedSetup = ref(false)

const mode = computed<'unlock' | 'setup' | 'guide' | 'noAccess'>(() => {
  // Still FIRST: a member whose hash BETTS_RESET_FINANCE_PIN cleared needs the
  // PIN form, not a tour — they already know what Money is, and the documented
  // recovery path must stay one screen away. Deliberately NOT admin-gated: the
  // member recovering may not be an admin.
  // A failed /api/finance/session (offline, 401 mid-lock) leaves state null.
  // Treating that as "not configured" would tell a household with Money fully
  // set up that it isn't — show the lock screen and let the server answer.
  if (!state.value) return 'unlock'
  if (state.value.needsPin) return 'setup'
  if (state.value.enrolled) return 'unlock'
  // Nothing set up yet. Trust on first use still applies, but explain what this
  // is before asking anyone to invent a PIN.
  if (!state.value.configured) return startedSetup.value ? 'setup' : 'guide'
  return 'noAccess'
})

// A ticking clock, not a one-shot read: the countdown has to fall to zero on
// its own, or the pad stays disabled long after the lockout expired and the
// only way back in is a page reload.
const now = ref(Date.now())
onMounted(() => {
  const timer = setInterval(() => { now.value = Date.now() }, 1000)
  onScopeDispose(() => clearInterval(timer))
})

const lockedOutMinutes = computed(() => {
  const until = state.value?.lockedUntil
  if (!until || until <= now.value) return 0
  return Math.ceil((until - now.value) / 60_000)
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
  if (!canSubmit(newPin.value)) return (error.value = t('finance.lock.tooShort'))
  if (newPin.value !== confirmPin.value) {
    // Clear the confirmation rather than leaving two mismatched buffers.
    error.value = t('finance.lock.mismatch')
    confirmPin.value = ''
    return
  }
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
    <!-- Nothing set up yet: explain what this is before asking for a PIN. -->
    <FinanceSetupGuide
      v-if="mode === 'guide'"
      :can-set-up="isAdmin"
      @start="startedSetup = true"
    />

    <UCard v-if="mode !== 'guide'">
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

      <!-- First run / recovery: choose a PIN, then confirm it. -->
      <form v-if="mode === 'setup'" class="space-y-4" @submit.prevent="submitSetup">
        <p class="text-sm text-slate-600 dark:text-slate-300">{{ $t('finance.lock.setUpBody') }}</p>

        <FinancePinPad
          v-model="newPin"
          :label="$t('finance.lock.newPin')"
          autocomplete="new-password"
          autofocus
        />
        <FinancePinPad
          v-model="confirmPin"
          :label="$t('finance.lock.confirmPin')"
          autocomplete="new-password"
        />

        <p v-if="error" class="text-sm text-red-600 dark:text-red-400">{{ error }}</p>
        <UButton type="submit" size="xl" block :loading="pending" :disabled="!canSubmit(newPin) || !confirmPin">
          {{ $t('finance.lock.setUpCta') }}
        </UButton>
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
        <FinancePinPad
          v-model="pin"
          :label="$t('finance.lock.prompt')"
          :disabled="lockedOutMinutes > 0"
          autofocus
        />

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
          :disabled="!canSubmit(pin) || lockedOutMinutes > 0"
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
    <p v-if="mode !== 'guide'" class="px-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
      {{ $t('finance.lock.honest') }}
    </p>
  </div>
</template>
