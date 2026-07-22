<!-- "Generate shopping list" dialog: date range → aggregate service → summary. -->
<script setup lang="ts">
import type { GenerateResult } from '#shared/schemas/shopping'

const props = defineProps<{ start: string, end: string }>()
const open = defineModel<boolean>('open', { required: true })

const toast = useToast()

interface ListRow { id: string, name: string, isDefault: boolean }
const { data: lists, refresh: refreshLists } = await useFetch<ListRow[]>('/api/shopping-lists', {
  default: () => [],
})

const form = reactive({
  start: props.start,
  end: props.end,
  listId: '', // '' = default list
  checkPantry: true,
})

const result = ref<(GenerateResult & { listId: string }) | null>(null)
const busy = ref(false)

watch(open, async (isOpen) => {
  if (!isOpen) return
  form.start = props.start
  form.end = props.end
  form.listId = ''
  form.checkPantry = true
  result.value = null
  await refreshLists()
})

const listOptions = computed(() => [
  { label: 'Default list', value: '' },
  ...lists.value.map(l => ({ label: l.isDefault ? `${l.name} (default)` : l.name, value: l.id })),
])

async function generate() {
  busy.value = true
  try {
    result.value = await $fetch<GenerateResult & { listId: string }>('/api/shopping-lists/generate', {
      method: 'POST',
      body: {
        start: form.start,
        end: form.end,
        ...(form.listId ? { listId: form.listId } : {}),
        ignorePantry: !form.checkPantry,
      },
    })
  }
  catch {
    toast.add({ title: 'Could not generate the shopping list', color: 'error' })
  }
  finally {
    busy.value = false
  }
}

async function removeInPantry(entry: { name: string, itemId: string }) {
  if (!result.value) return
  try {
    await $fetch(`/api/shopping-lists/${result.value.listId}/items/${entry.itemId}`, { method: 'DELETE' })
    result.value.inPantry = result.value.inPantry.filter(p => p.itemId !== entry.itemId)
    toast.add({ title: `Removed ${entry.name}`, color: 'success' })
  }
  catch {
    toast.add({ title: 'Could not remove item', color: 'error' })
  }
}
</script>

<template>
  <UModal v-model:open="open" title="Generate shopping list">
    <template #body>
      <div v-if="!result" class="space-y-4">
        <div class="grid grid-cols-2 gap-3">
          <UFormField label="From">
            <UInput v-model="form.start" type="date" class="w-full" />
          </UFormField>
          <UFormField label="Until (exclusive)">
            <UInput v-model="form.end" type="date" class="w-full" />
          </UFormField>
        </div>
        <UFormField label="Add to list">
          <USelect v-model="form.listId" :items="listOptions" class="w-full" />
        </UFormField>
        <div class="flex items-center justify-between gap-3">
          <div>
            <p class="text-sm font-medium">Check the pantry</p>
            <p class="text-xs text-slate-500 dark:text-slate-400">
              Flag ingredients you already have at home.
            </p>
          </div>
          <USwitch v-model="form.checkPantry" />
        </div>
        <UButton :loading="busy" icon="i-lucide-shopping-cart" block @click="generate">
          Generate
        </UButton>
      </div>

      <div v-else class="space-y-4">
        <p class="text-sm">
          <span class="font-semibold">{{ result.created }}</span> added,
          <span class="font-semibold">{{ result.merged }}</span> merged into existing items.
        </p>

        <div v-if="result.inPantry.length" class="space-y-2">
          <p class="text-sm font-medium">Already in your pantry — tap to remove:</p>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="entry in result.inPantry"
              :key="entry.itemId"
              class="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-amber-100 dark:bg-amber-900/40 px-3 py-1.5 text-sm text-amber-800 dark:text-amber-200 hover:bg-amber-200 dark:hover:bg-amber-900/70"
              @click="removeInPantry(entry)"
            >
              {{ entry.name }}
              <UIcon name="i-lucide-x" class="size-3.5" />
            </button>
          </div>
        </div>

        <div v-if="result.skippedFreeText.length" class="rounded-lg bg-slate-100 dark:bg-slate-800 p-3 text-sm text-slate-600 dark:text-slate-300">
          <p class="font-medium">Couldn't shop for these free-text meals:</p>
          <ul class="mt-1 list-inside list-disc">
            <li v-for="(text, i) in result.skippedFreeText" :key="i">{{ text }}</li>
          </ul>
        </div>

        <div class="flex gap-2">
          <UButton :to="`/shopping/${result.listId}`" icon="i-lucide-shopping-cart" class="flex-1" block>
            Open list
          </UButton>
          <UButton variant="soft" color="neutral" @click="open = false">Done</UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
