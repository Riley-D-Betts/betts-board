<!-- Lists each recurring bill once (the template, not its occurrences) so it can
     be deleted. Occurrences are shown and marked paid on the Bills page; this is
     the one place the underlying bill itself is removed. requireFinanceAccess on
     the route, so it's offered to any unlocked finance member — same as the mark
     actions, not owner-only. -->
<script setup lang="ts">
const emit = defineEmits<{ changed: [] }>()

const { unlocked } = useFinanceSession()
const { money } = useMoney()
const { t } = useI18n()
const toast = useToast()

interface BillRow {
  id: string
  name: string
  kind: 'expense' | 'income'
  amountMinor: number
  currency: string
  rrule: string | null
}

const { data: bills, refresh } = await useFetch<BillRow[]>('/api/finance/bills', {
  immediate: unlocked.value,
  default: () => [],
})
watch(unlocked, u => u && refresh())
// Adding a bill (editor) or paying one bumps the shared tick; keep this list in
// step so a newly created bill shows up here without a manual reload.
useLiveRefresh(() => unlocked.value && refresh())

// Compact cadence labels for a list row (the editor's "Repeats: monthly"
// strings are worded for its dropdown). A null rule is a one-off; a rule the
// editor can't produce (only reachable via the API) shows a neutral "Custom"
// rather than a raw machine RRULE.
const CADENCE: Record<string, string> = {
  'FREQ=MONTHLY': 'monthly',
  'FREQ=WEEKLY': 'weekly',
  'FREQ=WEEKLY;INTERVAL=2': 'biweekly',
  'FREQ=YEARLY': 'yearly',
}
function frequencyLabel(rrule: string | null): string {
  if (!rrule) return t('finance.bills.cadence.once')
  return t(`finance.bills.cadence.${CADENCE[rrule] ?? 'custom'}`)
}

// ── Delete ───────────────────────────────────────────────────────────────
const removeOpen = ref(false)
const removing = ref<BillRow | null>(null)
const removeBusy = ref(false)

function askRemove(bill: BillRow) {
  removing.value = bill
  removeOpen.value = true
}

async function confirmRemove() {
  if (!removing.value) return
  removeBusy.value = true
  try {
    await $fetch(`/api/finance/bills/${removing.value.id}`, { method: 'DELETE' })
    removeOpen.value = false
    await refresh()
    emit('changed') // the page reloads its occurrence lists
    bumpDataTick()
    toast.add({ title: t('finance.bills.removed'), color: 'success' })
  }
  catch (e) {
    toast.add({
      title: (e as { statusMessage?: string }).statusMessage || t('finance.bills.removeFailed'),
      color: 'error',
    })
  }
  finally {
    removeBusy.value = false
  }
}
</script>

<template>
  <UCard v-if="bills.length">
    <template #header>
      <h2 class="font-semibold">{{ $t('finance.bills.manageTitle') }}</h2>
    </template>

    <div class="divide-y divide-slate-200 dark:divide-slate-800">
      <div
        v-for="bill in bills"
        :key="bill.id"
        class="flex min-h-12 items-center gap-3 py-1.5"
      >
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium">
            {{ bill.name }}
            <UBadge v-if="bill.kind === 'income'" size="sm" color="success" variant="subtle" class="ml-1">
              {{ $t('finance.bills.kinds.income') }}
            </UBadge>
          </p>
          <p class="truncate text-xs text-slate-500 dark:text-slate-400">
            {{ frequencyLabel(bill.rrule) }} · {{ money(bill.amountMinor, bill.currency) }}
          </p>
        </div>
        <UButton
          icon="i-lucide-trash-2"
          size="sm"
          color="neutral"
          variant="ghost"
          class="shrink-0"
          :aria-label="$t('common.actions.delete')"
          @click="askRemove(bill)"
        />
      </div>
    </div>

    <UModal v-model:open="removeOpen" :title="$t('finance.bills.deleteTitle')">
      <template #body>
        <div class="space-y-4">
          <p class="text-sm">
            {{ $t('finance.bills.removeConfirm', { name: removing?.name ?? '' }) }}
          </p>
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="ghost" @click="removeOpen = false">
              {{ $t('common.actions.cancel') }}
            </UButton>
            <UButton color="error" :loading="removeBusy" @click="confirmRemove">
              {{ $t('common.actions.delete') }}
            </UButton>
          </div>
        </div>
      </template>
    </UModal>
  </UCard>
</template>
