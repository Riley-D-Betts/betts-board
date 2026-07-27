<script setup lang="ts">
interface BillOccurrence {
  billId: string
  name: string
  dueDate: string
  amountMinor: number
  currency: string
  kind: string
  status?: string
}

const props = defineProps<{ bill: BillOccurrence, overdue?: boolean }>()
const emit = defineEmits<{ changed: [] }>()

const { money } = useMoney()
const { formatDayMonth } = useDateFormat()
const { t } = useI18n()
const toast = useToast()
const busy = ref(false)

async function mark(status: 'paid' | 'skipped') {
  busy.value = true
  try {
    await $fetch(`/api/finance/bills/${props.bill.billId}/mark`, {
      method: 'POST',
      body: { dueDate: props.bill.dueDate, status },
    })
    toast.add({ title: t('finance.toast.saved'), color: 'success' })
    emit('changed')
    bumpDataTick()
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="flex min-h-14 items-center gap-3 py-2">
    <div
      class="grid size-9 shrink-0 place-items-center rounded-lg"
      :class="bill.kind === 'income'
        ? 'bg-emerald-100 dark:bg-emerald-950/50'
        : overdue ? 'bg-rose-100 dark:bg-rose-950/50' : 'bg-slate-100 dark:bg-slate-800'"
    >
      <UIcon
        :name="bill.kind === 'income' ? 'i-lucide-arrow-down-left' : 'i-lucide-arrow-up-right'"
        class="size-4"
        :class="bill.kind === 'income'
          ? 'text-emerald-600 dark:text-emerald-400'
          : overdue ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500'"
      />
    </div>

    <div class="min-w-0 flex-1">
      <p class="truncate text-sm font-medium">{{ bill.name }}</p>
      <p class="text-xs" :class="overdue ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500 dark:text-slate-400'">
        {{ $t('finance.bills.dueOn', { date: formatDayMonth(bill.dueDate) }) }}
      </p>
    </div>

    <span class="shrink-0 text-sm font-semibold tabular-nums">
      {{ money(bill.amountMinor, bill.currency) }}
    </span>

    <!-- ≥44px target: this gets tapped on a phone. -->
    <UButton
      icon="i-lucide-check"
      size="sm"
      color="neutral"
      variant="ghost"
      class="size-11 shrink-0 justify-center"
      :loading="busy"
      :aria-label="$t('finance.bills.markPaid')"
      @click="mark('paid')"
    />
  </div>
</template>
