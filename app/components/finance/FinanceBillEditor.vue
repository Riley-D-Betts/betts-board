<!-- Create a bill. Seedable: pass `initial` to pre-fill it from an existing
     transaction ("turn this into a bill"), or open it bare for a fresh bill.
     One editor so the two entry points (Bills page, transaction row) can never
     drift apart. Guarded upstream by requireFinanceAccess like every bill route. -->
<script setup lang="ts">
import { SEMIMONTHLY, LAST_DAY, semimonthlyRule, firstSemimonthlyOnOrAfter } from '#shared/utils/billCadence'

const NO_CATEGORY = 'none'

interface BillSeed {
  name?: string
  kind?: 'expense' | 'income'
  amountMinor?: number
  startDate?: string
  categoryId?: string | null
  accountId?: string | null
}

const props = defineProps<{
  /** Seed values, e.g. mapped from a transaction. Omitted for a blank bill. */
  initial?: BillSeed
  categories: { id: string, name: string }[]
  /** Modal title; defaults to the plain "Add a bill" heading. */
  title?: string
}>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ saved: [] }>()

const { fromInput, toInput } = useMoney()
const currency = useHouseholdCurrency()
const { t } = useI18n()
const toast = useToast()

const saving = ref(false)
const form = reactive({
  name: '',
  kind: 'expense' as 'expense' | 'income',
  amount: '',
  startDate: todayString(),
  frequency: 'FREQ=MONTHLY',
  categoryId: NO_CATEGORY,
  // Only used when frequency is the twice-a-month sentinel.
  dayA: 1,
  dayB: 15,
})
// A transaction carries the account it was paid from; keep it as the bill's
// "paid from" without a picker. Bare bills leave it null, matching today.
const seededAccountId = ref<string | null>(null)

const kindItems = computed(() => (['expense', 'income'] as const)
  .map(value => ({ value, label: t(`finance.bills.kinds.${value}`) })))

// Whole messages, not a translated prefix glued to an English word — the
// stored RRULE value is what matters, the label is free to be reworded.
const frequencyItems = computed(() => [
  { value: 'FREQ=MONTHLY', label: t('finance.bills.frequencies.monthly') },
  { value: 'FREQ=WEEKLY', label: t('finance.bills.frequencies.weekly') },
  { value: 'FREQ=WEEKLY;INTERVAL=2', label: t('finance.bills.frequencies.biweekly') },
  { value: SEMIMONTHLY, label: t('finance.bills.frequencies.semimonthly') },
  { value: 'FREQ=YEARLY', label: t('finance.bills.frequencies.yearly') },
  { value: 'once', label: t('finance.bills.frequencies.once') },
])

// 1–28 plus "Last day": foolproof for pay dates — no short-month skips, and
// -1 gives the true month-end. Deliberately omits 29–31 in favour of "Last day".
const dayItems = computed(() => [
  ...Array.from({ length: 28 }, (_, i) => ({ value: i + 1, label: String(i + 1) })),
  { value: LAST_DAY, label: t('finance.bills.lastDayOfMonth') },
])

const isTwiceMonthly = computed(() => form.frequency === SEMIMONTHLY)
// The two days must resolve to two different dates. Equal picks obviously fail;
// so does 28 + "Last day", which land on the same date in a non-leap February.
const daysValid = computed(() => {
  if (!isTwiceMonthly.value) return true
  if (form.dayA === form.dayB) return false
  const picked = new Set([form.dayA, form.dayB])
  return !(picked.has(28) && picked.has(LAST_DAY))
})

const categoryItems = computed(() => [
  { label: t('finance.transactions.uncategorized'), value: NO_CATEGORY },
  ...props.categories.map(c => ({ label: c.name, value: c.id })),
])

// `immediate` matters: opened from a transaction the component is mounted by a
// v-if with `open` already true, so a plain watch would miss that first open and
// never seed. The guard skips the closed case (the always-mounted Bills page).
watch(open, (isOpen) => {
  if (!isOpen) return
  const seed = props.initial
  // A bill name is capped at 80; a transaction description runs to 200, so it
  // must be trimmed here or the POST 400s.
  form.name = (seed?.name ?? '').trim().slice(0, 80)
  form.kind = seed?.kind ?? 'expense'
  form.amount = seed?.amountMinor != null ? toInput(Math.abs(seed.amountMinor), currency.value) : ''
  form.startDate = seed?.startDate ?? todayString()
  form.frequency = 'FREQ=MONTHLY'
  form.categoryId = seed?.categoryId ?? NO_CATEGORY
  form.dayA = 1
  form.dayB = 15
  seededAccountId.value = seed?.accountId ?? null
}, { immediate: true })

/** The frequency sentinel resolved to a stored value: an RRULE body, or null for a one-off. */
function resolveRrule(): string | null {
  if (form.frequency === 'once') return null
  if (form.frequency === SEMIMONTHLY) return semimonthlyRule(form.dayA, form.dayB)
  return form.frequency
}

/**
 * Twice-a-month bills anchor on the next pay day (the expander always treats the
 * startDate as an occurrence, so it must BE a pay day); everything else uses the
 * date the user picked.
 */
function resolveStartDate(): string {
  return form.frequency === SEMIMONTHLY
    ? firstSemimonthlyOnOrAfter(todayString(), form.dayA, form.dayB)
    : form.startDate
}

async function create() {
  const amountMinor = fromInput(form.amount, currency.value)
  if (amountMinor == null) return
  saving.value = true
  try {
    await $fetch('/api/finance/bills', {
      method: 'POST',
      body: {
        name: form.name.trim().slice(0, 80),
        kind: form.kind,
        amountMinor: Math.abs(amountMinor),
        startDate: resolveStartDate(),
        // "once" → no rule (the expander handles null); "twice a month" → a
        // BYMONTHDAY rule built from the two chosen days; otherwise the picker
        // value already IS the RRULE body.
        rrule: resolveRrule(),
        categoryId: form.categoryId === NO_CATEGORY ? null : form.categoryId,
        ...(seededAccountId.value ? { accountId: seededAccountId.value } : {}),
      },
    })
    open.value = false
    toast.add({ title: t('finance.toast.saved'), color: 'success' })
    emit('saved')
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" :title="title ?? $t('finance.bills.add')">
    <template #body>
      <form class="space-y-4" @submit.prevent="create">
        <UFormField :label="$t('finance.bills.name')">
          <UInput v-model="form.name" maxlength="80" class="w-full" autofocus />
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
          <UFormField v-if="!isTwiceMonthly" :label="$t('finance.bills.startDate')">
            <UInput v-model="form.startDate" type="date" class="w-full" />
          </UFormField>
          <UFormField
            :label="$t('finance.bills.repeats')"
            :class="isTwiceMonthly ? 'sm:col-span-2' : ''"
          >
            <USelect v-model="form.frequency" :items="frequencyItems" class="w-full" />
          </UFormField>
        </div>
        <UFormField v-if="isTwiceMonthly" :label="$t('finance.bills.semimonthlyDays')">
          <div class="flex items-center gap-2">
            <USelect v-model="form.dayA" :items="dayItems" class="flex-1" />
            <span class="shrink-0 text-sm text-slate-500 dark:text-slate-400">&amp;</span>
            <USelect v-model="form.dayB" :items="dayItems" class="flex-1" />
          </div>
          <p v-if="!daysValid" class="mt-1 text-sm text-red-600 dark:text-red-400">
            {{ $t('finance.bills.distinctDays') }}
          </p>
        </UFormField>
        <UFormField :label="$t('finance.transactions.category')">
          <USelect v-model="form.categoryId" :items="categoryItems" class="w-full" />
        </UFormField>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="open = false">
            {{ $t('common.actions.cancel') }}
          </UButton>
          <UButton type="submit" :loading="saving" :disabled="!form.name.trim() || !form.amount || !daysValid">
            {{ $t('common.actions.save') }}
          </UButton>
        </div>
      </form>
    </template>
  </UModal>
</template>
