<script setup lang="ts">
import type { BarcodeLookupResult } from '#shared/schemas/pantry'
import { AISLES, aisleLabelKey } from '#shared/schemas/shopping'

interface PantryRow {
  id: string
  name: string
  nameKey: string
  quantity: number | null
  unit: string | null
  category: string | null
  barcode: string | null
}

const toast = useToast()
const { t } = useI18n()

const q = ref('')
const { data: items, refresh } = await useFetch<PantryRow[]>('/api/pantry', {
  query: computed(() => (q.value ? { q: q.value } : {})),
  default: () => [],
})

/** One aisle vocabulary for the pantry and the shopping list, so the stored
 * value stays the English string the server's matcher assigns. */
function aisleLabel(value: string) {
  const key = aisleLabelKey(value)
  return key ? t(key) : value
}
// `value: string`, not the literal union — an item can carry a custom aisle.
const aisleItems = computed<{ label: string, value: string }[]>(() =>
  AISLES.map(value => ({ label: aisleLabel(value), value })))

const groups = computed(() => {
  const byCat = new Map<string, PantryRow[]>()
  for (const item of items.value) {
    const cat = item.category || 'Other'
    const bucket = byCat.get(cat) ?? []
    bucket.push(item)
    byCat.set(cat, bucket)
  }
  const orderOf = (cat: string) => {
    const i = AISLES.indexOf(cat as typeof AISLES[number])
    return i === -1 ? AISLES.length - 1.5 : i
  }
  return [...byCat.entries()]
    .sort(([a], [b]) => orderOf(a) - orderOf(b))
    .map(([category, rows]) => ({
      category,
      label: aisleLabel(category),
      items: rows.sort((a, b) => a.name.localeCompare(b.name)),
    }))
})

function qtyLabel(item: PantryRow) {
  if (item.quantity == null) return null
  return item.unit ? `${item.quantity} ${item.unit}` : String(item.quantity)
}

// -- add form (also the barcode-scan landing spot) ------------------------
const addForm = reactive({ name: '', quantity: '' as number | '', unit: '', category: '' })
const scanned = ref<{ barcode: string, found: boolean } | null>(null)
const scanNote = ref<string | null>(null)
const addBusy = ref(false)

function resetAddForm() {
  addForm.name = ''
  addForm.quantity = ''
  addForm.unit = ''
  addForm.category = ''
  scanned.value = null
  scanNote.value = null
}

async function addItem() {
  const name = addForm.name.trim()
  if (!name) return
  addBusy.value = true
  try {
    // Remember a manual name for an unrecognized barcode so re-scans resolve.
    if (scanned.value && !scanned.value.found) {
      await $fetch('/api/barcode', {
        method: 'POST',
        body: { barcode: scanned.value.barcode, productName: name },
      }).catch(() => {})
    }
    await $fetch('/api/pantry', {
      method: 'POST',
      body: {
        name,
        quantity: typeof addForm.quantity === 'number' ? addForm.quantity : null,
        unit: addForm.unit.trim() || null,
        category: addForm.category || null,
        barcode: scanned.value?.barcode ?? null,
      },
    })
    resetAddForm()
    await refresh()
  }
  catch {
    toast.add({ title: t('pantry.errors.couldNotAdd'), color: 'error' })
  }
  finally {
    addBusy.value = false
  }
}

// -- barcode scanning -----------------------------------------------------
const scanOpen = ref(false)
async function onDetected(code: string) {
  scanOpen.value = false
  try {
    const res = await $fetch<BarcodeLookupResult>(`/api/barcode/${code}`)
    scanned.value = { barcode: code, found: res.found }
    if (res.found && res.productName) {
      addForm.name = res.productName
      scanNote.value = res.brand
        ? t('pantry.scan.foundWithBrand', { name: res.productName, brand: res.brand })
        : t('pantry.scan.found', { name: res.productName })
    }
    else {
      addForm.name = ''
      scanNote.value = t('pantry.scan.notRecognized')
    }
  }
  catch {
    toast.add({ title: t('pantry.errors.lookupFailed'), color: 'error' })
  }
}

// -- edit / delete --------------------------------------------------------
const editOpen = ref(false)
const editForm = reactive({ id: '', name: '', quantity: '' as number | '', unit: '', category: 'Other' })
function openEdit(item: PantryRow) {
  editForm.id = item.id
  editForm.name = item.name
  editForm.quantity = item.quantity ?? ''
  editForm.unit = item.unit ?? ''
  editForm.category = item.category ?? 'Other'
  editOpen.value = true
}
const savingEdit = ref(false)
async function saveEdit() {
  savingEdit.value = true
  try {
    await $fetch(`/api/pantry/${editForm.id}`, {
      method: 'PATCH',
      body: {
        name: editForm.name.trim(),
        quantity: typeof editForm.quantity === 'number' ? editForm.quantity : null,
        unit: editForm.unit.trim() || null,
        category: editForm.category,
      },
    })
    editOpen.value = false
    await refresh()
  }
  catch {
    toast.add({ title: t('pantry.errors.couldNotSave'), color: 'error' })
  }
  finally {
    savingEdit.value = false
  }
}

async function deleteItem(item: PantryRow) {
  try {
    await $fetch(`/api/pantry/${item.id}`, { method: 'DELETE' })
    await refresh()
  }
  catch {
    toast.add({ title: t('pantry.errors.couldNotDelete'), color: 'error' })
  }
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="text-2xl md:text-3xl font-bold flex-1">{{ $t('pantry.title') }}</h1>
      <UButton icon="i-lucide-scan-barcode" variant="soft" @click="scanOpen = true">
        {{ $t('pantry.scanBarcode') }}
      </UButton>
    </div>

    <!-- Add item -->
    <UCard>
      <form class="space-y-3" @submit.prevent="addItem">
        <p
          v-if="scanNote"
          class="rounded-lg bg-slate-100 dark:bg-slate-800 p-2 text-sm text-slate-600 dark:text-slate-300"
        >
          <UIcon name="i-lucide-scan-barcode" class="mr-1 inline size-4 align-text-bottom" />
          {{ scanNote }}
        </p>
        <div class="flex flex-wrap gap-2">
          <UInput v-model="addForm.name" :placeholder="$t('pantry.addForm.namePlaceholder')" class="min-w-40 flex-1" />
          <UInput v-model.number="addForm.quantity" type="number" min="0" step="any" :placeholder="$t('pantry.addForm.quantityPlaceholder')" class="w-20" />
          <UInput v-model="addForm.unit" :placeholder="$t('pantry.addForm.unitPlaceholder')" class="w-24" />
          <USelect v-model="addForm.category" :items="aisleItems" :placeholder="$t('pantry.addForm.aislePlaceholder')" class="w-32" />
          <UButton type="submit" icon="i-lucide-plus" :loading="addBusy" :disabled="!addForm.name.trim()">
            {{ $t('common.actions.add') }}
          </UButton>
        </div>
      </form>
    </UCard>

    <UInput v-model="q" icon="i-lucide-search" :placeholder="$t('pantry.searchPlaceholder')" class="w-full" />

    <div v-if="!items.length" class="py-12 text-center text-slate-500 dark:text-slate-400">
      <UIcon name="i-lucide-package-open" class="mb-2 size-10" />
      <p>{{ q ? $t('pantry.empty.noMatches') : $t('pantry.empty.none') }}</p>
    </div>

    <section v-for="group in groups" :key="group.category" class="space-y-1">
      <h2 class="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {{ group.label }}
      </h2>
      <div class="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800">
        <div v-for="item in group.items" :key="item.id" class="flex min-h-12 items-center gap-2 px-3 py-2">
          <span class="min-w-0 flex-1 truncate font-medium">{{ item.name }}</span>
          <UBadge v-if="qtyLabel(item)" variant="soft" color="neutral" size="sm">
            {{ qtyLabel(item) }}
          </UBadge>
          <UIcon
            v-if="item.barcode"
            name="i-lucide-scan-barcode"
            class="size-4 text-slate-400"
            :title="item.barcode"
          />
          <UButton
            icon="i-lucide-pencil"
            variant="ghost"
            color="neutral"
            :aria-label="$t('pantry.editAria', { name: item.name })"
            @click="openEdit(item)"
          />
          <UButton
            icon="i-lucide-trash-2"
            variant="ghost"
            color="error"
            :aria-label="$t('pantry.deleteAria', { name: item.name })"
            @click="deleteItem(item)"
          />
        </div>
      </div>
    </section>

    <BarcodeScanner v-model:open="scanOpen" @detected="onDetected" />

    <!-- Edit item -->
    <UModal v-model:open="editOpen" :title="$t('pantry.editor.title')">
      <template #body>
        <div class="space-y-4">
          <UFormField :label="$t('pantry.editor.name')">
            <UInput v-model="editForm.name" class="w-full" />
          </UFormField>
          <div class="flex gap-2">
            <UFormField :label="$t('pantry.editor.quantity')" class="flex-1">
              <UInput v-model.number="editForm.quantity" type="number" min="0" step="any" class="w-full" />
            </UFormField>
            <UFormField :label="$t('pantry.editor.unit')" class="flex-1">
              <UInput v-model="editForm.unit" class="w-full" />
            </UFormField>
          </div>
          <UFormField :label="$t('pantry.editor.aisle')">
            <USelect v-model="editForm.category" :items="aisleItems" class="w-full" />
          </UFormField>
          <div class="flex gap-2">
            <UButton :loading="savingEdit" :disabled="!editForm.name.trim()" @click="saveEdit">{{ $t('common.actions.save') }}</UButton>
            <UButton variant="soft" color="neutral" @click="editOpen = false">{{ $t('common.actions.cancel') }}</UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
