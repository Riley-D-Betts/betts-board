<!-- "Anything from McDonald's is Dining out." Creates an auto-categorise rule
     straight from a transaction, which is where the thought actually occurs —
     the full rule editor lives in Money settings. -->
<script setup lang="ts">
const props = defineProps<{
  transaction: { description: string, payee: string | null, categoryId: string | null }
  categories: { id: string, name: string }[]
}>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ saved: [] }>()

const { t } = useI18n()
const toast = useToast()

const NO_CATEGORY = 'none'

/**
 * Match the payee when the bank gave us one, otherwise the description. A payee
 * is the stable part ("MCDONALD'S"); a description often carries a store number
 * or date that would never match twice.
 */
const matchField = computed<'payee' | 'description'>(() => props.transaction.payee ? 'payee' : 'description')
const vendor = computed(() => (props.transaction.payee || props.transaction.description || '').trim())

const saving = ref(false)
const matchValue = ref('')
const categoryId = ref(NO_CATEGORY)

const categoryItems = computed(() => [
  { label: t('finance.transactions.uncategorized'), value: NO_CATEGORY },
  ...props.categories.map(c => ({ label: c.name, value: c.id })),
])

watch(open, (isOpen) => {
  if (!isOpen) return
  matchValue.value = vendor.value
  // Pre-select the category it already has — usually the one just picked, which
  // is exactly the rule someone wants to make permanent.
  categoryId.value = props.transaction.categoryId ?? NO_CATEGORY
}, { immediate: true })

const canSave = computed(() => matchValue.value.trim().length > 0 && categoryId.value !== NO_CATEGORY)

async function save() {
  if (!canSave.value) return
  saving.value = true
  try {
    await $fetch('/api/finance/rules', {
      method: 'POST',
      body: {
        matchField: matchField.value,
        matchType: 'contains',
        matchValue: matchValue.value.trim(),
        setCategoryId: categoryId.value,
      },
    })
    open.value = false
    toast.add({ title: t('finance.rules.vendorSaved', { vendor: matchValue.value.trim() }), color: 'success' })
    emit('saved')
  }
  catch (e) {
    toast.add({
      title: (e as { statusMessage?: string }).statusMessage || t('finance.rules.saveFailed'),
      color: 'error',
    })
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" :title="$t('finance.rules.vendorTitle')">
    <template #body>
      <form class="space-y-4" @submit.prevent="save">
        <UFormField
          :label="$t(`finance.rules.fields.${matchField}`)"
          :help="$t('finance.rules.vendorHelp', { vendor: matchValue.trim() || vendor })"
        >
          <UInput v-model="matchValue" class="w-full" autofocus />
        </UFormField>
        <UFormField :label="$t('finance.rules.thenSet')">
          <USelect v-model="categoryId" :items="categoryItems" class="w-full" />
        </UFormField>
        <p class="text-xs text-slate-500 dark:text-slate-400">
          {{ $t('finance.rules.neverOverwrites') }}
        </p>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="open = false">
            {{ $t('common.actions.cancel') }}
          </UButton>
          <UButton type="submit" :loading="saving" :disabled="!canSave">
            {{ $t('common.actions.save') }}
          </UButton>
        </div>
      </form>
    </template>
  </UModal>
</template>
