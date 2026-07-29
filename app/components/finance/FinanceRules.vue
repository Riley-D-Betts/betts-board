<!-- Vendor rules: "anything paid to McDonald's is Dining out". The engine already
     runs these on every import and sync (server/services/finance/rules.ts); this
     is the screen for managing them. Available to anyone with finance access —
     the routes are requireFinanceAccess, like categories. -->
<script setup lang="ts">
const { unlocked } = useFinanceSession()
const { t } = useI18n()
const toast = useToast()

const ANY_ACCOUNT = 'any'
const NO_CATEGORY = 'none'

interface RuleRow {
  id: string
  matchField: 'description' | 'payee' | 'memo'
  matchType: 'contains' | 'startsWith' | 'equals'
  matchValue: string
  accountId: string | null
  setCategoryId: string | null
  setPayee: string | null
  enabled: boolean
}

const { data: rules, refresh } = await useFetch<RuleRow[]>('/api/finance/rules', {
  immediate: unlocked.value,
  default: () => [],
})
const { data: categories, refresh: refreshCategories } = await useFetch<{ id: string, name: string }[]>(
  '/api/finance/categories',
  { immediate: unlocked.value, default: () => [] },
)
const { data: accountData, refresh: refreshAccounts } = await useFetch<{ accounts: { id: string, name: string }[] }>(
  '/api/finance/accounts',
  { immediate: unlocked.value, default: () => ({ accounts: [] }) },
)
watch(unlocked, u => u && Promise.all([refresh(), refreshCategories(), refreshAccounts()]))

const fieldItems = computed(() => (['description', 'payee', 'memo'] as const)
  .map(value => ({ value, label: t(`finance.rules.fields.${value}`) })))
const typeItems = computed(() => (['contains', 'startsWith', 'equals'] as const)
  .map(value => ({ value, label: t(`finance.rules.types.${value}`) })))
const categoryItems = computed(() => [
  { label: t('finance.transactions.uncategorized'), value: NO_CATEGORY },
  ...(categories.value ?? []).map(c => ({ label: c.name, value: c.id })),
])
const accountItems = computed(() => [
  { label: t('finance.rules.anyAccount'), value: ANY_ACCOUNT },
  ...(accountData.value?.accounts ?? []).map(a => ({ label: a.name, value: a.id })),
])

const categoryName = (id: string | null) =>
  (categories.value ?? []).find(c => c.id === id)?.name ?? t('finance.transactions.uncategorized')

/** An archived or bank-removed account still named by a rule. */
const accountLabel = (id: string) =>
  (accountData.value?.accounts ?? []).find(a => a.id === id)?.name ?? t('finance.rules.unknownAccount')

/**
 * The whole rule as ONE translated sentence. A rename-only rule has no
 * category, so it must not render a dangling arrow.
 */
function ruleSummary(rule: RuleRow) {
  const field = t(`finance.rules.fields.${rule.matchField}`)
  const match = t(`finance.rules.types.${rule.matchType}`)
  return rule.setCategoryId
    ? t('finance.rules.summary', { field, match, value: rule.matchValue, category: categoryName(rule.setCategoryId) })
    : t('finance.rules.summaryRenameOnly', { field, match, value: rule.matchValue })
}

// ── Add ──────────────────────────────────────────────────────────────────
const addOpen = ref(false)
const saving = ref(false)
const form = reactive({
  matchField: 'payee' as RuleRow['matchField'],
  matchType: 'contains' as RuleRow['matchType'],
  matchValue: '',
  setCategoryId: NO_CATEGORY,
  accountId: ANY_ACCOUNT,
  setPayee: '',
})

watch(addOpen, (open) => {
  if (!open) return
  // "Paid to … contains …" is the vendor case people come here for.
  form.matchField = 'payee'
  form.matchType = 'contains'
  form.matchValue = ''
  form.setCategoryId = NO_CATEGORY
  form.accountId = ANY_ACCOUNT
  form.setPayee = ''
})

const canSave = computed(() =>
  form.matchValue.trim().length > 0
  && (form.setCategoryId !== NO_CATEGORY || form.setPayee.trim().length > 0))

async function create() {
  if (!canSave.value) return
  saving.value = true
  try {
    await $fetch('/api/finance/rules', {
      method: 'POST',
      body: {
        matchField: form.matchField,
        matchType: form.matchType,
        matchValue: form.matchValue.trim(),
        setCategoryId: form.setCategoryId === NO_CATEGORY ? null : form.setCategoryId,
        accountId: form.accountId === ANY_ACCOUNT ? null : form.accountId,
        setPayee: form.setPayee.trim() || null,
      },
    })
    addOpen.value = false
    await refresh()
    toast.add({ title: t('finance.toast.saved'), color: 'success' })
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

// ── Enable / delete ──────────────────────────────────────────────────────
async function toggle(rule: RuleRow, enabled: boolean) {
  try {
    await $fetch(`/api/finance/rules/${rule.id}`, { method: 'PATCH', body: { enabled } })
    await refresh()
  }
  catch {
    toast.add({ title: t('finance.rules.saveFailed'), color: 'error' })
    await refresh() // snap the switch back to the server's truth
  }
}

const removeOpen = ref(false)
const removing = ref<RuleRow | null>(null)
const removeBusy = ref(false)

function askRemove(rule: RuleRow) {
  removing.value = rule
  removeOpen.value = true
}

async function confirmRemove() {
  if (!removing.value) return
  removeBusy.value = true
  try {
    await $fetch(`/api/finance/rules/${removing.value.id}`, { method: 'DELETE' })
    removeOpen.value = false
    await refresh()
    toast.add({ title: t('finance.rules.removed'), color: 'success' })
  }
  catch (e) {
    toast.add({
      title: (e as { statusMessage?: string }).statusMessage || t('common.errors.generic'),
      color: 'error',
    })
  }
  finally {
    removeBusy.value = false
  }
}

// ── Apply to what's already there ────────────────────────────────────────
const applying = ref(false)

async function applyNow() {
  applying.value = true
  try {
    // onlyUncategorized: the server refuses to touch a hand-set category either
    // way, but this also leaves rule-filed ones alone — the safe sweep.
    const res = await $fetch<{ updated: number }>('/api/finance/rules/apply', {
      method: 'POST',
      body: { onlyUncategorized: true },
    })
    toast.add({ title: t('finance.rules.ran', res.updated), color: 'success' })
    bumpDataTick() // the ledger and budgets have moved
  }
  catch {
    toast.add({ title: t('common.errors.generic'), color: 'error' })
  }
  finally {
    applying.value = false
  }
}
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center justify-between gap-2">
        <h2 class="font-semibold">{{ $t('finance.rules.title') }}</h2>
        <UButton icon="i-lucide-plus" size="sm" variant="ghost" @click="addOpen = true">
          {{ $t('finance.rules.add') }}
        </UButton>
      </div>
    </template>

    <div v-if="rules.length" class="divide-y divide-slate-200 dark:divide-slate-800">
      <div v-for="rule in rules" :key="rule.id" class="flex min-h-12 items-center gap-3 py-2">
        <div class="min-w-0 flex-1">
          <!-- One ICU message rather than glued-together fragments: the word
               order and the quote marks differ per language. -->
          <p class="truncate text-sm" :class="rule.enabled ? '' : 'text-slate-400 dark:text-slate-500'">
            {{ ruleSummary(rule) }}
          </p>
          <p v-if="rule.setPayee || rule.accountId" class="truncate text-xs text-slate-500 dark:text-slate-400">
            <span v-if="rule.setPayee">{{ $t('finance.rules.alsoRename') }} “{{ rule.setPayee }}”</span>
            <span v-if="rule.setPayee && rule.accountId"> · </span>
            <span v-if="rule.accountId">{{ accountLabel(rule.accountId) }}</span>
          </p>
        </div>
        <USwitch
          :model-value="rule.enabled"
          :aria-label="$t('finance.rules.enabledFor', { value: rule.matchValue })"
          class="shrink-0"
          @update:model-value="(v: boolean) => toggle(rule, v)"
        />
        <UButton
          icon="i-lucide-trash-2"
          size="sm"
          color="neutral"
          variant="ghost"
          class="shrink-0"
          :aria-label="$t('common.actions.delete')"
          @click="askRemove(rule)"
        />
      </div>
    </div>
    <p v-else class="py-2 text-sm text-slate-500 dark:text-slate-400">
      {{ $t('finance.rules.empty') }}
    </p>

    <template #footer>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="text-xs text-slate-500 dark:text-slate-400">{{ $t('finance.rules.neverOverwrites') }}</p>
        <UButton
          v-if="rules.length"
          size="sm"
          color="neutral"
          variant="soft"
          icon="i-lucide-wand-sparkles"
          :loading="applying"
          @click="applyNow"
        >
          {{ $t('finance.rules.runNow') }}
        </UButton>
      </div>
    </template>

    <UModal v-model:open="addOpen" :title="$t('finance.rules.add')">
      <template #body>
        <form class="space-y-4" @submit.prevent="create">
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField :label="$t('finance.rules.matchField')">
              <USelect v-model="form.matchField" :items="fieldItems" class="w-full" />
            </UFormField>
            <UFormField :label="$t('finance.rules.matchType')">
              <USelect v-model="form.matchType" :items="typeItems" class="w-full" />
            </UFormField>
          </div>
          <UFormField :label="$t('finance.rules.matchValue')">
            <UInput v-model="form.matchValue" class="w-full" placeholder="McDonald" autofocus />
          </UFormField>
          <UFormField :label="$t('finance.rules.thenSet')">
            <USelect v-model="form.setCategoryId" :items="categoryItems" class="w-full" />
          </UFormField>
          <UFormField :label="$t('finance.accounts.title')">
            <USelect v-model="form.accountId" :items="accountItems" class="w-full" />
          </UFormField>
          <UFormField :label="$t('finance.rules.alsoRename')" :help="$t('finance.rules.renameHelp')">
            <UInput v-model="form.setPayee" class="w-full" />
          </UFormField>
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="ghost" @click="addOpen = false">
              {{ $t('common.actions.cancel') }}
            </UButton>
            <UButton type="submit" :loading="saving" :disabled="!canSave">
              {{ $t('common.actions.save') }}
            </UButton>
          </div>
        </form>
      </template>
    </UModal>

    <UModal v-model:open="removeOpen" :title="$t('finance.rules.deleteTitle')">
      <template #body>
        <div class="space-y-4">
          <p class="text-sm">
            {{ $t('finance.rules.removeConfirm', { value: removing?.matchValue ?? '' }) }}
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
