<!-- Statement import: parse → review duplicates → commit. Nothing is ever
     dropped automatically; the family decides on every flagged row. -->
<script setup lang="ts">
const props = defineProps<{ accounts: { id: string, name: string }[] }>()
const emit = defineEmits<{ imported: [] }>()

const { money } = useMoney()
const { formatDayMonth } = useDateFormat()
const { t } = useI18n()
const toast = useToast()

interface Candidate {
  index: number
  postedDate: string
  amountMinor: number
  description: string
  duplicateOf: { description: string, postedDate: string } | null
}

const open = ref(false)
const step = ref<'pick' | 'review'>('pick')
const busy = ref(false)
const error = ref('')

const accountId = ref('')
const filename = ref('')
const content = ref('')
const dateFormat = ref<'auto' | 'MDY' | 'DMY' | 'YMD'>('auto')
const preview = ref<{ rows: Candidate[], warnings: string[], duplicateCount: number } | null>(null)
const skipRows = ref(new Set<number>())

const dateItems = computed(() =>
  (['auto', 'MDY', 'DMY', 'YMD'] as const).map(value => ({
    value,
    label: t(`finance.import.dateFormats.${value}`),
  })))

watch(open, (isOpen) => {
  if (isOpen) {
    step.value = 'pick'
    accountId.value = props.accounts[0]?.id ?? ''
    filename.value = ''
    content.value = ''
    preview.value = null
    error.value = ''
    skipRows.value = new Set()
  }
})

async function onFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  filename.value = file.name
  content.value = await file.text()
  error.value = ''
}

async function runPreview() {
  if (!content.value || !accountId.value) return
  busy.value = true
  error.value = ''
  try {
    preview.value = await $fetch('/api/finance/import/preview', {
      method: 'POST',
      body: { accountId: accountId.value, filename: filename.value, content: content.value, dateFormat: dateFormat.value },
    })
    // Pre-tick the likely duplicates; the user can untick any of them.
    skipRows.value = new Set(preview.value!.rows.filter(r => r.duplicateOf).map(r => r.index))
    step.value = 'review'
  }
  catch (e) {
    error.value = (e as { statusMessage?: string }).statusMessage || 'Could not read that file.'
  }
  finally {
    busy.value = false
  }
}

function toggleSkip(index: number) {
  const next = new Set(skipRows.value)
  if (next.has(index)) next.delete(index)
  else next.add(index)
  skipRows.value = next
}

const willImport = computed(() => (preview.value?.rows.length ?? 0) - skipRows.value.size)

async function commit() {
  busy.value = true
  try {
    const result = await $fetch<{ imported: number }>('/api/finance/import', {
      method: 'POST',
      body: {
        accountId: accountId.value,
        filename: filename.value,
        content: content.value,
        dateFormat: dateFormat.value,
        skipRows: [...skipRows.value],
      },
    })
    toast.add({ title: t('finance.import.imported', result.imported), color: 'success' })
    open.value = false
    emit('imported')
    bumpDataTick()
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <div>
    <UButton icon="i-lucide-upload" variant="ghost" size="sm" @click="open = true">
      {{ $t('finance.import.cta') }}
    </UButton>

    <UModal v-model:open="open" :title="$t('finance.import.title')" :ui="{ content: 'max-w-2xl' }">
      <template #body>
        <div v-if="step === 'pick'" class="space-y-4">
          <UFormField :label="$t('finance.import.intoAccount')">
            <USelect
              v-model="accountId"
              :items="accounts.map(a => ({ label: a.name, value: a.id }))"
              class="w-full"
            />
          </UFormField>

          <UFormField :label="$t('finance.import.chooseFile')">
            <input
              type="file"
              accept=".ofx,.qfx,.csv,text/csv,application/x-ofx"
              class="block w-full text-sm file:mr-3 file:min-h-11 file:rounded-lg file:border-0 file:bg-slate-100 file:px-4 file:text-sm file:font-medium dark:file:bg-slate-800"
              @change="onFile"
            >
          </UFormField>

          <UFormField :label="$t('finance.import.dateFormat')">
            <USelect v-model="dateFormat" :items="dateItems" class="w-full" />
          </UFormField>

          <p v-if="error" class="text-sm text-red-600 dark:text-red-400">{{ error }}</p>

          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="ghost" @click="open = false">
              {{ $t('common.actions.cancel') }}
            </UButton>
            <UButton :loading="busy" :disabled="!content || !accountId" @click="runPreview">
              {{ $t('finance.import.preview') }}
            </UButton>
          </div>
        </div>

        <div v-else-if="preview" class="space-y-4">
          <div class="space-y-1 text-sm">
            <p>{{ $t('finance.import.rowsFound', preview.rows.length) }}</p>
            <p v-if="preview.duplicateCount" class="text-amber-600 dark:text-amber-400">
              {{ $t('finance.import.duplicatesFound', preview.duplicateCount) }}
              {{ $t('finance.import.noAutoDrop') }}
            </p>
            <p v-for="warning in preview.warnings.slice(0, 5)" :key="warning" class="text-xs text-slate-500 dark:text-slate-400">
              {{ warning }}
            </p>
          </div>

          <div class="max-h-80 divide-y divide-slate-200 overflow-y-auto rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
            <label
              v-for="row in preview.rows"
              :key="row.index"
              class="flex min-h-14 cursor-pointer items-center gap-3 px-3 py-2"
              :class="skipRows.has(row.index) ? 'opacity-50' : ''"
            >
              <UCheckbox
                :model-value="!skipRows.has(row.index)"
                @update:model-value="toggleSkip(row.index)"
              />
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm">{{ row.description }}</p>
                <p class="text-xs text-slate-500 dark:text-slate-400">
                  {{ formatDayMonth(row.postedDate) }}
                  <span v-if="row.duplicateOf" class="text-amber-600 dark:text-amber-400">
                    · {{ $t('finance.import.duplicateOf', {
                      description: row.duplicateOf.description,
                      date: formatDayMonth(row.duplicateOf.postedDate),
                    }) }}
                  </span>
                </p>
              </div>
              <span class="shrink-0 text-sm font-medium tabular-nums">{{ money(row.amountMinor) }}</span>
            </label>
          </div>

          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="ghost" @click="step = 'pick'">
              {{ $t('common.actions.back') }}
            </UButton>
            <UButton :loading="busy" :disabled="willImport < 1" @click="commit">
              {{ $t('finance.import.importCta', willImport) }}
            </UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
