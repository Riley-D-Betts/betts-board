<script setup lang="ts">
interface Item {
  id: string
  name: string
  displayQuantity: string | null
  quantity: number | null
  unit: string | null
  category: string | null
  checked: boolean
  checkedAt: string | null
}
interface ListDetail {
  id: string
  name: string
  isDefault: boolean
  items: Item[]
}

const route = useRoute()
const listId = route.params.id as string
const toast = useToast()
const { t } = useI18n()

const { data: list, refresh } = await useFetch<ListDetail>(`/api/shopping-lists/${listId}`)

const CATEGORY_ORDER = [
  'Produce', 'Bakery', 'Meat & Seafood', 'Dairy', 'Frozen',
  'Pantry', 'Beverages', 'Household', 'Other',
]

const groups = computed(() => {
  const byCat = new Map<string, Item[]>()
  for (const item of list.value?.items ?? []) {
    if (item.checked) continue
    const cat = item.category || 'Other'
    const bucket = byCat.get(cat) ?? []
    bucket.push(item)
    byCat.set(cat, bucket)
  }
  const orderOf = (cat: string) => {
    const i = CATEGORY_ORDER.indexOf(cat)
    return i === -1 ? CATEGORY_ORDER.length - 1.5 : i // unknown custom aisles before Other
  }
  return [...byCat.entries()]
    .sort(([a], [b]) => orderOf(a) - orderOf(b))
    .map(([category, items]) => ({
      category,
      items: items.sort((a, b) => a.name.localeCompare(b.name)),
    }))
})

const checkedItems = computed(() =>
  (list.value?.items ?? [])
    .filter(i => i.checked)
    .sort((a, b) => (b.checkedAt ?? '').localeCompare(a.checkedAt ?? '')))
const showChecked = ref(false)

// -- quick add ("2 lbs chicken" parses server-side) -----------------------
const quickAdd = ref('')
const adding = ref(false)
async function addItem() {
  const name = quickAdd.value.trim()
  if (!name) return
  adding.value = true
  try {
    await $fetch(`/api/shopping-lists/${listId}/items`, { method: 'POST', body: { name } })
    quickAdd.value = ''
    await refresh()
  }
  catch {
    toast.add({ title: t('shopping.errors.couldNotAddItem'), color: 'error' })
  }
  finally {
    adding.value = false
  }
}

async function toggle(item: Item) {
  try {
    await $fetch(`/api/shopping-lists/${listId}/items/${item.id}`, {
      method: 'PATCH',
      body: { checked: !item.checked },
    })
    await refresh()
  }
  catch {
    toast.add({ title: t('shopping.errors.couldNotUpdateItem'), color: 'error' })
  }
}

// -- edit modal -----------------------------------------------------------
const editOpen = ref(false)
const editForm = reactive({ id: '', name: '', displayQuantity: '', category: 'Other' })
function openEdit(item: Item) {
  editForm.id = item.id
  editForm.name = item.name
  editForm.displayQuantity = item.displayQuantity ?? ''
  editForm.category = item.category ?? 'Other'
  editOpen.value = true
}
const savingEdit = ref(false)
async function saveEdit() {
  savingEdit.value = true
  try {
    await $fetch(`/api/shopping-lists/${listId}/items/${editForm.id}`, {
      method: 'PATCH',
      body: {
        name: editForm.name.trim(),
        displayQuantity: editForm.displayQuantity.trim() || null,
        category: editForm.category,
      },
    })
    editOpen.value = false
    await refresh()
  }
  catch {
    toast.add({ title: t('shopping.errors.couldNotSaveItem'), color: 'error' })
  }
  finally {
    savingEdit.value = false
  }
}
async function deleteEditItem() {
  try {
    await $fetch(`/api/shopping-lists/${listId}/items/${editForm.id}`, { method: 'DELETE' })
    editOpen.value = false
    await refresh()
  }
  catch {
    toast.add({ title: t('shopping.errors.couldNotDeleteItem'), color: 'error' })
  }
}

// -- clear checked --------------------------------------------------------
const clearOpen = ref(false)
const clearing = ref(false)
async function clearChecked(toPantry: boolean) {
  clearing.value = true
  try {
    const res = await $fetch<{ cleared: number, toPantry: number }>(
      `/api/shopping-lists/${listId}/clear-checked`,
      { method: 'POST', body: { toPantry } },
    )
    clearOpen.value = false
    toast.add({
      title: toPantry
        ? t('shopping.clearChecked.putAwayDone', res.toPantry)
        : t('shopping.clearedCount', res.cleared),
      color: 'success',
    })
    await refresh()
  }
  catch {
    toast.add({ title: t('shopping.errors.couldNotClearChecked'), color: 'error' })
  }
  finally {
    clearing.value = false
  }
}

// -- clear entire list ----------------------------------------------------
const clearAllOpen = ref(false)
const clearingAll = ref(false)
async function clearAll() {
  clearingAll.value = true
  try {
    const res = await $fetch<{ removed: number }>(`/api/shopping-lists/${listId}/clear`, { method: 'POST' })
    clearAllOpen.value = false
    toast.add({ title: t('shopping.clearedCount', res.removed), color: 'success' })
    await refresh()
  }
  catch {
    toast.add({ title: t('shopping.errors.couldNotClearList'), color: 'error' })
  }
  finally {
    clearingAll.value = false
  }
}

const totalItems = computed(() => (list.value?.items ?? []).length)
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center gap-2">
      <UButton to="/shopping" icon="i-lucide-arrow-left" variant="ghost" color="neutral" :aria-label="$t('shopping.allLists')" />
      <h1 class="min-w-0 flex-1 truncate text-2xl font-bold">{{ list?.name ?? $t('shopping.untitledList') }}</h1>
      <UBadge v-if="list?.isDefault" variant="soft" size="sm">{{ $t('shopping.defaultBadge') }}</UBadge>
      <UButton
        v-if="totalItems"
        variant="soft"
        color="neutral"
        size="sm"
        icon="i-lucide-eraser"
        @click="clearAllOpen = true"
      >
        {{ $t('shopping.clear') }}
      </UButton>
    </div>

    <!-- Clear entire list confirm -->
    <UModal v-model:open="clearAllOpen" :title="$t('shopping.clearList.title')">
      <template #body>
        <div class="space-y-4">
          <p class="text-sm text-slate-600 dark:text-slate-300">
            {{ $t('shopping.clearList.confirm', { n: totalItems, name: list?.name ?? '' }, totalItems) }}
          </p>
          <div class="flex gap-2">
            <UButton color="error" :loading="clearingAll" @click="clearAll">{{ $t('shopping.clearList.cta') }}</UButton>
            <UButton variant="soft" color="neutral" @click="clearAllOpen = false">{{ $t('common.actions.cancel') }}</UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- Quick add, pinned -->
    <form
      class="sticky top-0 z-10 -mx-1 flex gap-2 bg-slate-50/95 dark:bg-slate-950/95 px-1 py-2 backdrop-blur"
      @submit.prevent="addItem"
    >
      <UInput
        v-model="quickAdd"
        icon="i-lucide-plus"
        :placeholder="$t('shopping.items.quickAddPlaceholder')"
        class="flex-1"
        size="lg"
      />
      <UButton type="submit" size="lg" :loading="adding" :disabled="!quickAdd.trim()">{{ $t('common.actions.add') }}</UButton>
    </form>

    <div v-if="!groups.length && !checkedItems.length" class="py-12 text-center text-slate-500 dark:text-slate-400">
      <UIcon name="i-lucide-shopping-basket" class="mb-2 size-10" />
      <p>{{ $t('shopping.items.empty') }}</p>
    </div>

    <!-- Unchecked, grouped by aisle -->
    <section v-for="group in groups" :key="group.category" class="space-y-1">
      <h2 class="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {{ group.category }}
      </h2>
      <div class="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800">
        <div v-for="item in group.items" :key="item.id" class="flex items-center gap-1 pr-1">
          <ShoppingItemRow :item="item" class="flex-1" @toggle="toggle(item)" />
          <UButton
            icon="i-lucide-pencil"
            variant="ghost"
            color="neutral"
            :aria-label="$t('shopping.items.editAria', { name: item.name })"
            @click="openEdit(item)"
          />
        </div>
      </div>
    </section>

    <!-- Checked, collapsed at the bottom -->
    <section v-if="checkedItems.length" class="space-y-1">
      <div class="flex items-center gap-2">
        <button
          class="flex min-h-11 flex-1 items-center gap-2 px-1 text-sm font-semibold text-slate-500 dark:text-slate-400"
          @click="showChecked = !showChecked"
        >
          <UIcon :name="showChecked ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-4" />
          {{ $t('shopping.checked', { n: checkedItems.length }) }}
        </button>
        <UButton variant="soft" color="neutral" size="sm" icon="i-lucide-trash-2" @click="clearOpen = true">
          {{ $t('shopping.clear') }}
        </UButton>
      </div>
      <div
        v-if="showChecked"
        class="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800"
      >
        <ShoppingItemRow
          v-for="item in checkedItems"
          :key="item.id"
          :item="item"
          @toggle="toggle(item)"
        />
      </div>
    </section>

    <!-- Edit item -->
    <UModal v-model:open="editOpen" :title="$t('shopping.editor.title')">
      <template #body>
        <div class="space-y-4">
          <UFormField :label="$t('shopping.editor.name')">
            <UInput v-model="editForm.name" class="w-full" />
          </UFormField>
          <UFormField :label="$t('shopping.editor.quantity')" :help="$t('shopping.editor.quantityHelp')">
            <UInput v-model="editForm.displayQuantity" class="w-full" />
          </UFormField>
          <UFormField :label="$t('shopping.editor.aisle')">
            <USelect v-model="editForm.category" :items="CATEGORY_ORDER" class="w-full" />
          </UFormField>
          <div class="flex gap-2">
            <UButton :loading="savingEdit" :disabled="!editForm.name.trim()" @click="saveEdit">{{ $t('common.actions.save') }}</UButton>
            <UButton variant="soft" color="neutral" @click="editOpen = false">{{ $t('common.actions.cancel') }}</UButton>
            <UButton variant="ghost" color="error" icon="i-lucide-trash-2" class="ml-auto" @click="deleteEditItem">
              {{ $t('common.actions.delete') }}
            </UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- Clear checked confirm -->
    <UModal v-model:open="clearOpen" :title="$t('shopping.clearChecked.title')">
      <template #body>
        <div class="space-y-4">
          <p class="text-sm text-slate-600 dark:text-slate-300">
            {{ $t('shopping.clearChecked.confirm', checkedItems.length) }}
          </p>
          <div class="flex flex-col gap-2">
            <UButton icon="i-lucide-package" :loading="clearing" block @click="clearChecked(true)">
              {{ $t('shopping.clearChecked.putAway') }}
            </UButton>
            <UButton variant="soft" color="neutral" :loading="clearing" block @click="clearChecked(false)">
              {{ $t('shopping.clearChecked.justClear') }}
            </UButton>
            <UButton variant="ghost" color="neutral" block @click="clearOpen = false">{{ $t('common.actions.cancel') }}</UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
