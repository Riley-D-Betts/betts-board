<!-- Numeric PIN entry for wall tablets.
     This is an input METHOD, not a constraint: a PIN is still an arbitrary
     6–64 character string (zPin), so the field stays a real <input> and the
     keyboard is one tap away for a household whose PIN contains letters.
     Keeping a real input means physical digits, Backspace, Enter-to-submit,
     masking and screen-reader labelling all keep working for free — a
     hand-rolled dot row would have to re-implement every one of them. -->
<script setup lang="ts">
import { PIN_MAX_LENGTH } from '#shared/schemas/finance'
import { appendDigit, backspace } from '#shared/utils/pinPad'

const props = withDefaults(defineProps<{
  /** Field label — the accessible name of the masked input. */
  label: string
  autocomplete?: 'current-password' | 'new-password'
  autofocus?: boolean
  /** Lockout: greys the keys as well as the field. */
  disabled?: boolean
}>(), { autocomplete: 'current-password' })

const model = defineModel<string>({ default: '' })

/**
 * Per device, shared by every pad on the page. A household whose PIN has
 * letters flips this once and it stays flipped.
 */
const inputMode = useLocalStorage<'pad' | 'text'>('betts-pin-input', 'pad')

/**
 * Literal ASCII on purpose: the string that reaches argon2 must be exactly the
 * characters shown. The same reason machineFormat() exists — a locale-aware
 * digit here would emit non-Latin numerals under ar-SA and change the secret.
 */
const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const
</script>

<template>
  <div class="space-y-3">
    <UFormField :label="props.label">
      <UInput
        v-model="model"
        type="password"
        :autocomplete="props.autocomplete"
        :inputmode="inputMode === 'pad' ? 'none' : undefined"
        :maxlength="PIN_MAX_LENGTH"
        :disabled="props.disabled"
        :autofocus="props.autofocus"
        size="xl"
        class="w-full"
        :ui="{ base: 'text-center text-2xl tracking-[0.35em]' }"
      />
    </UFormField>

    <!-- Count only — the same information the masked field already shows. -->
    <p class="sr-only" aria-live="polite">{{ $t('finance.lock.entered', model.length) }}</p>

    <div
      v-if="inputMode === 'pad'"
      role="group"
      :aria-label="$t('finance.lock.padLabel')"
      class="grid grid-cols-3 gap-2"
    >
      <!-- type="button" is load-bearing: UButton has no default type, and an
           untyped button inside a <form> submits it — every digit would. -->
      <UButton
        v-for="d in DIGITS"
        :key="d"
        type="button"
        color="neutral"
        variant="soft"
        size="xl"
        class="min-h-14 w-full justify-center text-2xl font-semibold tabular-nums"
        :disabled="props.disabled"
        @mousedown.prevent
        @click="model = appendDigit(model, d)"
      >
        {{ d }}
      </UButton>

      <UButton
        type="button"
        color="neutral"
        variant="ghost"
        size="xl"
        class="min-h-14 w-full justify-center"
        :disabled="props.disabled || !model"
        :aria-label="$t('finance.lock.clear')"
        @mousedown.prevent
        @click="model = ''"
      >
        {{ $t('finance.lock.clear') }}
      </UButton>

      <UButton
        type="button"
        color="neutral"
        variant="soft"
        size="xl"
        class="min-h-14 w-full justify-center text-2xl font-semibold tabular-nums"
        :disabled="props.disabled"
        @mousedown.prevent
        @click="model = appendDigit(model, '0')"
      >
        0
      </UButton>

      <UButton
        type="button"
        color="neutral"
        variant="ghost"
        icon="i-lucide-delete"
        size="xl"
        class="min-h-14 w-full justify-center"
        :disabled="props.disabled || !model"
        :aria-label="$t('finance.lock.backspace')"
        @mousedown.prevent
        @click="model = backspace(model)"
      />
    </div>

    <UButton
      type="button"
      color="neutral"
      variant="link"
      block
      size="sm"
      @click="inputMode = inputMode === 'pad' ? 'text' : 'pad'"
    >
      {{ inputMode === 'pad' ? $t('finance.lock.useKeyboard') : $t('finance.lock.usePad') }}
    </UButton>
  </div>
</template>
