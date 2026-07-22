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
    toast.add({ title: 'Could not add the item', color: 'error' })
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
    toast.add({ title: 'Could not update the item', color: 'error' })
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
    toast.add({ title: 'Could not save the item', color: 'error' })
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
    toast.add({ title: 'Could not delete the item', color: 'error' })
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
        ? `Put ${res.toPantry} item${res.toPantry === 1 ? '' : 's'} away to the pantry`
        : `Cleared ${res.cleared} item${res.cleared === 1 ? '' : 's'}`,
      color: 'success',
    })
    await refresh()
  }
  catch {
    toast.add({ title: 'Could not clear checked items', color: 'error' })
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
    toast.add({ title: `Cleared ${res.removed} item${res.removed === 1 ? '' : 's'}`, color: 'success' })
    await refresh()
  }
  catch {
    toast.add({ title: 'Could not clear the list', color: 'error' })
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
      <UButton to="/shopping" icon="i-lucide-arrow-left" variant="ghost" color="neutral" aria-label="All lists" />
      <h1 class="min-w-0 flex-1 truncate text-2xl font-bold">{{ list?.name ?? 'List' }}</h1>
      <UBadge v-if="list?.isDefault" variant="soft" size="sm">default</UBadge>
      <UButton
        v-if="totalItems"
        variant="soft"
        color="neutral"
        size="sm"
        icon="i-lucide-eraser"
        @click="clearAllOpen = true"
      >
        Clear
      </UButton>
    </div>

    <!-- Clear entire list confirm -->
    <UModal v-model:open="clearAllOpen" title="Clear this list">
      <template #body>
        <div class="space-y-4">
          <p class="text-sm text-slate-600 dark:text-slate-300">
            Remove all {{ totalItems }} item{{ totalItems === 1 ? '' : 's' }} from
            “{{ list?.name }}” — checked and unchecked? The list itself stays.
          </p>
          <div class="flex gap-2">
            <UButton color="error" :loading="clearingAll" @click="clearAll">Clear everything</UButton>
            <UButton variant="soft" color="neutral" @click="clearAllOpen = false">Cancel</UButton>
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
        placeholder="Add — “2 lbs chicken”, “paper towels”…"
        class="flex-1"
        size="lg"
      />
      <UButton type="submit" size="lg" :loading="adding" :disabled="!quickAdd.trim()">Add</UButton>
    </form>

    <div v-if="!groups.length && !checkedItems.length" class="py-12 text-center text-slate-500 dark:text-slate-400">
      <UIcon name="i-lucide-shopping-basket" class="mb-2 size-10" />
      <p>Nothing to buy. Add items above or generate from your meal plan.</p>
    </div>

    <!-- Unchecked, grouped by aisle -->
    <section v-for="group in groups" :key="group.category" class="space-y-1">
      <h2 class="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {{ group.category }}
      </h2>
      <div class="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800">
        <div v-for="item in group.items" :key="item.id" class="flex items-center gap-1 pr-1">
          <button
            class="flex min-h-12 flex-1 items-center gap-3 px-3 py-2 text-left"
            :aria-label="`Check off ${item.name}`"
            @click="toggle(item)"
          >
            <UIcon name="i-lucide-circle" class="size-6 shrink-0 text-slate-300 dark:text-slate-600" />
            <span class="min-w-0 flex-1">
              <span class="font-medium">{{ item.name }}</span>
              <span v-if="item.displayQuantity" class="ml-2 text-sm text-slate-500 dark:text-slate-400">
                {{ item.displayQuantity }}
              </span>
            </span>
          </button>
          <UButton
            icon="i-lucide-pencil"
            variant="ghost"
            color="neutral"
            :aria-label="`Edit ${item.name}`"
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
          Checked ({{ checkedItems.length }})
        </button>
        <UButton variant="soft" color="neutral" size="sm" icon="i-lucide-trash-2" @click="clearOpen = true">
          Clear
        </UButton>
      </div>
      <div
        v-if="showChecked"
        class="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800"
      >
        <button
          v-for="item in checkedItems"
          :key="item.id"
          class="flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left"
          :aria-label="`Uncheck ${item.name}`"
          @click="toggle(item)"
        >
          <UIcon name="i-lucide-circle-check-big" class="size-6 shrink-0 text-primary" />
          <span class="min-w-0 flex-1 text-slate-400 line-through">
            {{ item.name }}
            <span v-if="item.displayQuantity" class="ml-2 text-sm">{{ item.displayQuantity }}</span>
          </span>
        </button>
      </div>
    </section>

    <!-- Edit item -->
    <UModal v-model:open="editOpen" title="Edit item">
      <template #body>
        <div class="space-y-4">
          <UFormField label="Name">
            <UInput v-model="editForm.name" class="w-full" />
          </UFormField>
          <UFormField label="Quantity" help="Free text — “2 lbs”, “1½ cups + 2 tbsp”">
            <UInput v-model="editForm.displayQuantity" class="w-full" />
          </UFormField>
          <UFormField label="Aisle">
            <USelect v-model="editForm.category" :items="CATEGORY_ORDER" class="w-full" />
          </UFormField>
          <div class="flex gap-2">
            <UButton :loading="savingEdit" :disabled="!editForm.name.trim()" @click="saveEdit">Save</UButton>
            <UButton variant="soft" color="neutral" @click="editOpen = false">Cancel</UButton>
            <UButton variant="ghost" color="error" icon="i-lucide-trash-2" class="ml-auto" @click="deleteEditItem">
              Delete
            </UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- Clear checked confirm -->
    <UModal v-model:open="clearOpen" title="Clear checked items">
      <template #body>
        <div class="space-y-4">
          <p class="text-sm text-slate-600 dark:text-slate-300">
            Put the {{ checkedItems.length }} checked item{{ checkedItems.length === 1 ? '' : 's' }}
            away to the pantry so meal planning knows you have them?
          </p>
          <div class="flex flex-col gap-2">
            <UButton icon="i-lucide-package" :loading="clearing" block @click="clearChecked(true)">
              Put away to pantry
            </UButton>
            <UButton variant="soft" color="neutral" :loading="clearing" block @click="clearChecked(false)">
              Just clear
            </UButton>
            <UButton variant="ghost" color="neutral" block @click="clearOpen = false">Cancel</UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
