<script setup lang="ts">
/**
 * Divides one transaction across several categories.
 *
 * Amounts are entered as plain positive numbers and the transaction's own sign
 * is applied on save. Nobody types "-40" for forty pounds of groceries, and the
 * server refuses a line pointing the opposite way to the whole anyway.
 *
 * The remainder is the whole interaction: it is always visible, and Save stays
 * disabled until it is exactly zero. A split that is a penny out would make the
 * budget quietly disagree with the account balance.
 */
interface SplitLine {
  categoryId: string | null
  amountMinor: number
  note: string | null
}

const props = defineProps<{
  transaction: {
    id: string
    description: string
    amountMinor: number
    currency: string
    splits: SplitLine[]
  }
  categories: { id: string, name: string }[]
}>()

const emit = defineEmits<{ saved: [] }>()

const open = defineModel<boolean>('open', { default: false })

const { money, toInput, fromInput } = useMoney()
const { t } = useI18n()
const toast = useToast()

/** Sentinel, not '': Reka's SelectItem throws on an empty-string value. */
const NO_CATEGORY = 'none'

interface Row {
  /** Stable across removals so Vue doesn't reuse an input's DOM node. */
  key: number
  categoryId: string
  /** Always the raw text; see the input binding for why it isn't a number. */
  amount: string
  note: string
}

/**
 * Coerces defensively rather than calling `.trim()` on the field. A numeric
 * `UInput` writes the COERCED value back — a number, not the string it was
 * seeded with — so a bare `.trim()` throws the moment somebody types, and it
 * takes the whole dialog down with it.
 */
const amountText = (row: Row) => String(row.amount ?? '').trim()

let nextKey = 0
const rows = ref<Row[]>([])
const focused = ref(0)
const saving = ref(false)

/** Sign lives on the transaction, so every line inherits it. */
const sign = computed(() => (props.transaction.amountMinor < 0 ? -1 : 1))
const totalMinor = computed(() => Math.abs(props.transaction.amountMinor))

function blankRow(): Row {
  return { key: nextKey++, categoryId: NO_CATEGORY, amount: '', note: '' }
}

watch(open, (isOpen) => {
  if (!isOpen) return
  const existing = props.transaction.splits ?? []
  rows.value = existing.length
    ? existing.map(s => ({
        key: nextKey++,
        categoryId: s.categoryId ?? NO_CATEGORY,
        amount: toInput(Math.abs(s.amountMinor), props.transaction.currency),
        note: s.note ?? '',
      }))
    : [blankRow()]
  // An unsplit transaction opens with a second, empty line ready — the reason
  // anyone opens this dialog is to add one.
  if (rows.value.length === 1) rows.value.push(blankRow())
  focused.value = rows.value.length - 1
}, { immediate: true })

const categoryItems = computed(() => [
  { label: t('finance.transactions.uncategorized'), value: NO_CATEGORY },
  ...props.categories.map(c => ({ label: c.name, value: c.id })),
])

/** null for a row that isn't a valid non-negative number yet. */
function rowMinor(row: Row): number | null {
  if (!amountText(row)) return null
  const minor = fromInput(row.amount, props.transaction.currency)
  return minor == null || minor < 0 ? null : minor
}

/**
 * A row with no amount typed yet is simply not a line. It is dropped on save
 * rather than blocking it — the dialog opens with a spare row ready, and
 * refusing to save because that spare is empty would contradict the "adds up
 * exactly" the user is looking at.
 */
const activeRows = computed(() => rows.value.filter(row => amountText(row) !== ''))

const assignedMinor = computed(() =>
  activeRows.value.reduce((acc, row) => acc + (rowMinor(row) ?? 0), 0))

const remainderMinor = computed(() => totalMinor.value - assignedMinor.value)

/** Typed but unparseable, or negative — the sign belongs to the transaction. */
const hasBadRow = computed(() => activeRows.value.some(row => rowMinor(row) == null))

const canSave = computed(() =>
  !hasBadRow.value && activeRows.value.length > 0 && remainderMinor.value === 0)

function addRow() {
  rows.value.push(blankRow())
  focused.value = rows.value.length - 1
}

function removeRow(index: number) {
  rows.value.splice(index, 1)
  if (!rows.value.length) rows.value.push(blankRow())
  focused.value = Math.min(focused.value, rows.value.length - 1)
}

/** One tap to drop what's left into the row the user was last in. */
function assignRemainder() {
  const index = Math.min(focused.value, rows.value.length - 1)
  const row = rows.value[index]
  if (!row) return
  const target = (rowMinor(row) ?? 0) + remainderMinor.value
  if (target < 0) return
  row.amount = toInput(target, props.transaction.currency)
}

async function save() {
  if (!canSave.value) return
  saving.value = true
  try {
    await $fetch(`/api/finance/transactions/${props.transaction.id}`, {
      method: 'PATCH',
      body: {
        splits: activeRows.value.map(row => ({
          categoryId: row.categoryId === NO_CATEGORY ? null : row.categoryId,
          amountMinor: sign.value * (rowMinor(row) ?? 0),
          note: String(row.note ?? '').trim() || null,
        })),
      },
    })
    open.value = false
    toast.add({ title: t('finance.splits.saved'), color: 'success' })
    emit('saved')
  }
  catch (error) {
    toast.add({
      title: (error as { data?: { statusMessage?: string } }).data?.statusMessage
        ?? t('common.errors.generic'),
      color: 'error',
    })
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" :title="$t('finance.splits.title')">
    <template #body>
      <form class="space-y-4" @submit.prevent="save">
        <div>
          <p class="text-sm font-medium">
            {{ transaction.description }}
          </p>
          <p class="text-xs text-slate-500 dark:text-slate-400">
            {{ money(transaction.amountMinor, transaction.currency) }} · {{ $t('finance.splits.help') }}
          </p>
        </div>

        <div class="space-y-3">
          <div
            v-for="(row, index) in rows"
            :key="row.key"
            class="rounded-lg border border-slate-200 p-3 dark:border-slate-800"
          >
            <div class="flex gap-2">
              <USelect
                v-model="row.categoryId"
                :items="categoryItems"
                class="min-w-0 flex-1"
                :aria-label="$t('finance.transactions.category')"
                @focus="focused = index"
              />
              <!-- Not v-model: the number input hands back a number, and the
                   rest of this component works in text. Normalised here, at
                   the one boundary where it enters. -->
              <UInput
                :model-value="row.amount"
                type="number"
                step="0.01"
                min="0"
                inputmode="decimal"
                class="w-28 shrink-0"
                :aria-label="$t('finance.transactions.amount')"
                @focus="focused = index"
                @update:model-value="(v: unknown) => { row.amount = v == null ? '' : String(v) }"
              />
              <UButton
                icon="i-lucide-x"
                color="neutral"
                variant="ghost"
                class="shrink-0"
                :aria-label="$t('finance.splits.removeLine')"
                :disabled="rows.length <= 1"
                @click="removeRow(index)"
              />
            </div>
            <UInput
              v-model="row.note"
              class="mt-2 w-full"
              size="sm"
              :placeholder="$t('finance.splits.notePlaceholder')"
              :aria-label="$t('finance.splits.note')"
              @focus="focused = index"
            />
          </div>
        </div>

        <UButton icon="i-lucide-plus" variant="ghost" size="sm" @click="addRow">
          {{ $t('finance.splits.addLine') }}
        </UButton>

        <!-- The whole point of the dialog: what's left, and one tap to place it. -->
        <div
          class="flex min-h-11 items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm"
          :class="remainderMinor === 0
            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
            : 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300'"
        >
          <span class="font-medium tabular-nums">
            <template v-if="remainderMinor === 0">{{ $t('finance.splits.balanced') }}</template>
            <template v-else-if="remainderMinor > 0">
              {{ $t('finance.splits.remaining', { amount: money(remainderMinor, transaction.currency) }) }}
            </template>
            <template v-else>
              {{ $t('finance.splits.over', { amount: money(-remainderMinor, transaction.currency) }) }}
            </template>
          </span>
          <UButton
            v-if="remainderMinor !== 0"
            size="xs"
            variant="soft"
            :disabled="hasBadRow"
            @click="assignRemainder"
          >
            {{ $t('finance.splits.assign') }}
          </UButton>
        </div>

        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="open = false">
            {{ $t('common.actions.cancel') }}
          </UButton>
          <UButton
            type="submit"
            data-test="split-save"
            :loading="saving"
            :disabled="!canSave"
          >
            {{ $t('common.actions.save') }}
          </UButton>
        </div>
      </form>
    </template>
  </UModal>
</template>
