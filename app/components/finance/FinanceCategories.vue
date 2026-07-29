<!-- Add / rename / recolour / delete spending categories. Everything here is
     available to anyone with finance access — the routes are requireFinanceAccess,
     not owner-only, the same as picking a category on a transaction. -->
<script setup lang="ts">
const { unlocked } = useFinanceSession()
const { t } = useI18n()
const toast = useToast()

interface CategoryRow {
  id: string
  name: string
  kind: 'expense' | 'income' | 'transfer'
  color: string | null
  icon: string | null
  isSystem: boolean
}

const { data: categories, refresh } = await useFetch<CategoryRow[]>('/api/finance/categories', {
  immediate: unlocked.value,
  default: () => [],
})
watch(unlocked, u => u && refresh())

// A curated palette — categories store a hex colour (zHexColor), so this is a
// set of good defaults rather than a free colour wheel a family would fiddle
// with. `null` is the leftmost "no colour" choice.
const PALETTE = [
  '#16a34a', '#0ea5e9', '#6366f1', '#8b5cf6', '#a855f7', '#ec4899',
  '#ef4444', '#f97316', '#f59e0b', '#14b8a6', '#22c55e', '#64748b',
]

const kindItems = computed(() => (['expense', 'income', 'transfer'] as const)
  .map(value => ({ value, label: t(`finance.categories.kinds.${value}`) })))

// ── Add / edit ─────────────────────────────────────────────────────────────
const editOpen = ref(false)
const editing = ref<CategoryRow | null>(null)
const saving = ref(false)
const form = reactive<{ name: string, kind: CategoryRow['kind'], color: string | null }>({
  name: '', kind: 'expense', color: null,
})

function openAdd() {
  editing.value = null
  form.name = ''
  form.kind = 'expense'
  form.color = null
  editOpen.value = true
}

function openEdit(cat: CategoryRow) {
  editing.value = cat
  form.name = cat.name
  form.kind = cat.kind
  form.color = cat.color
  editOpen.value = true
}

async function save() {
  const name = form.name.trim()
  if (!name) return
  saving.value = true
  try {
    const body = { name, kind: form.kind, color: form.color }
    if (editing.value) {
      await $fetch(`/api/finance/categories/${editing.value.id}`, { method: 'PATCH', body })
    }
    else {
      await $fetch('/api/finance/categories', { method: 'POST', body })
    }
    editOpen.value = false
    await refresh()
    bumpDataTick() // other open views (transactions, budgets) pick it up
    toast.add({ title: t('finance.toast.saved'), color: 'success' })
  }
  catch (e) {
    toast.add({
      title: (e as { statusMessage?: string }).statusMessage || t('finance.categories.saveFailed'),
      color: 'error',
    })
  }
  finally {
    saving.value = false
  }
}

// ── Delete (archives if a transaction still uses it) ─────────────────────────
const removeOpen = ref(false)
const removing = ref<CategoryRow | null>(null)
const removeBusy = ref(false)

function askRemove(cat: CategoryRow) {
  removing.value = cat
  removeOpen.value = true
}

async function confirmRemove() {
  if (!removing.value) return
  removeBusy.value = true
  try {
    // The route returns { archived: boolean } — archived when a split still
    // references it (history keeps its category), deleted outright otherwise.
    const res = await $fetch<{ archived: boolean }>(`/api/finance/categories/${removing.value.id}`, {
      method: 'DELETE',
    })
    removeOpen.value = false
    await refresh()
    bumpDataTick()
    toast.add({
      title: res.archived ? t('finance.categories.archivedInstead') : t('finance.categories.deleted'),
      color: 'success',
    })
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
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center justify-between gap-2">
        <h2 class="font-semibold">{{ $t('finance.categories.title') }}</h2>
        <UButton icon="i-lucide-plus" size="sm" variant="ghost" @click="openAdd">
          {{ $t('finance.categories.add') }}
        </UButton>
      </div>
    </template>

    <div v-if="categories.length" class="divide-y divide-slate-200 dark:divide-slate-800">
      <div
        v-for="cat in categories"
        :key="cat.id"
        class="flex min-h-12 items-center gap-3 py-1.5"
      >
        <span
          class="size-3 shrink-0 rounded-full"
          :style="cat.color ? { backgroundColor: cat.color } : {}"
          :class="cat.color ? '' : 'bg-slate-300 dark:bg-slate-600'"
        />
        <span class="min-w-0 flex-1 truncate text-sm">{{ cat.name }}</span>
        <UBadge color="neutral" variant="subtle" size="sm">
          {{ $t(`finance.categories.kinds.${cat.kind}`) }}
        </UBadge>
        <UButton
          icon="i-lucide-pencil"
          size="sm"
          color="neutral"
          variant="ghost"
          :aria-label="$t('finance.categories.edit')"
          @click="openEdit(cat)"
        />
        <UButton
          icon="i-lucide-trash-2"
          size="sm"
          color="neutral"
          variant="ghost"
          :aria-label="$t('common.actions.delete')"
          @click="askRemove(cat)"
        />
      </div>
    </div>
    <p v-else class="py-2 text-sm text-slate-500 dark:text-slate-400">
      {{ $t('finance.categories.empty') }}
    </p>

    <!-- Add / edit -->
    <UModal
      v-model:open="editOpen"
      :title="editing ? $t('finance.categories.edit') : $t('finance.categories.add')"
    >
      <template #body>
        <form class="space-y-4" @submit.prevent="save">
          <UFormField :label="$t('finance.categories.name')">
            <UInput v-model="form.name" class="w-full" autofocus />
          </UFormField>
          <UFormField :label="$t('finance.categories.kind')">
            <USelect v-model="form.kind" :items="kindItems" class="w-full" />
          </UFormField>
          <UFormField :label="$t('finance.categories.color')">
            <div class="flex flex-wrap items-center gap-2">
              <button
                type="button"
                class="grid size-8 place-items-center rounded-full border border-slate-300 dark:border-slate-600"
                :class="form.color === null ? 'ring-2 ring-offset-2 ring-slate-400 dark:ring-offset-slate-900' : ''"
                :aria-label="$t('finance.categories.colorNone')"
                @click="form.color = null"
              >
                <UIcon name="i-lucide-ban" class="size-4 text-slate-400" />
              </button>
              <button
                v-for="c in PALETTE"
                :key="c"
                type="button"
                class="size-8 rounded-full transition-transform"
                :style="{ backgroundColor: c }"
                :class="form.color === c ? 'ring-2 ring-offset-2 ring-slate-400 dark:ring-offset-slate-900 scale-110' : 'hover:scale-105'"
                :aria-label="c"
                @click="form.color = c"
              />
            </div>
          </UFormField>
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="ghost" @click="editOpen = false">
              {{ $t('common.actions.cancel') }}
            </UButton>
            <UButton type="submit" :loading="saving" :disabled="!form.name.trim()">
              {{ $t('common.actions.save') }}
            </UButton>
          </div>
        </form>
      </template>
    </UModal>

    <!-- Delete confirm -->
    <UModal v-model:open="removeOpen" :title="$t('finance.categories.title')">
      <template #body>
        <div class="space-y-4">
          <p class="text-sm">
            {{ $t('finance.categories.removeConfirm', { name: removing?.name ?? '' }) }}
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
