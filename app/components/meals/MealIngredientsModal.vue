<!-- Pick a planned recipe's ingredients and add them to a shopping list. -->
<script setup lang="ts">
import type { AddRecipeItemsResult } from '#shared/schemas/shopping'

interface IngredientRow {
  id: string
  raw: string
  quantity: number | null
  unit: string | null
  name: string | null
  scaledQuantity: number | null
  display: string
}
interface EntryIngredients {
  entryId: string
  recipeId: string
  title: string
  servings: number | null
  servingsOverride: number | null
  scale: number
  ingredients: IngredientRow[]
}

const props = defineProps<{ entryId: string | null }>()
const open = defineModel<boolean>('open', { required: true })

const toast = useToast()

interface ListRow { id: string, name: string, isDefault: boolean }
const { data: lists, refresh: refreshLists } = await useFetch<ListRow[]>('/api/shopping-lists', {
  default: () => [],
})

const data = ref<EntryIngredients | null>(null)
const loading = ref(false)
const loadFailed = ref(false)
const checked = ref<Record<string, boolean>>({})
const listId = ref('default') // 'default' = the default list
const busy = ref(false)

watch(open, async (isOpen) => {
  if (!isOpen || !props.entryId) return
  listId.value = 'default'
  await Promise.all([load(), refreshLists()])
})

async function load() {
  loading.value = true
  loadFailed.value = false
  data.value = null
  try {
    data.value = await $fetch<EntryIngredients>(`/api/meal-plan/entries/${props.entryId}/ingredients`)
    checked.value = Object.fromEntries(data.value.ingredients.map(ing => [ing.id, true]))
  }
  catch {
    loadFailed.value = true
  }
  finally {
    loading.value = false
  }
}

const listOptions = computed(() => [
  { label: 'Default list', value: 'default' },
  ...lists.value.map(l => ({ label: l.isDefault ? `${l.name} (default)` : l.name, value: l.id })),
])

const selectedIds = computed(() =>
  data.value?.ingredients.filter(ing => checked.value[ing.id]).map(ing => ing.id) ?? [])

const servingsLabel = computed(() => {
  if (!data.value) return ''
  const { servings, servingsOverride } = data.value
  if (servingsOverride && servings) return `Scaled to ${servingsOverride} servings (recipe makes ${servings})`
  if (servingsOverride) return `${servingsOverride} servings`
  if (servings) return `${servings} servings`
  return ''
})

async function addItems() {
  if (!data.value || !selectedIds.value.length) return
  busy.value = true
  try {
    const result = await $fetch<AddRecipeItemsResult>(
      `/api/shopping-lists/${listId.value}/items/from-recipe`,
      {
        method: 'POST',
        body: {
          recipeId: data.value.recipeId,
          ingredientIds: selectedIds.value,
          scale: data.value.scale,
        },
      },
    )
    const listName = lists.value.find(l => l.id === result.listId)?.name ?? 'Groceries'
    toast.add({
      title: `Added ${result.created + result.merged} to ${listName} (${result.merged} merged)`,
      color: 'success',
    })
    open.value = false
  }
  catch {
    toast.add({ title: 'Could not add the ingredients', color: 'error' })
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" :title="data?.title ?? 'Add to shopping list'">
    <template #body>
      <div v-if="loading" class="flex items-center justify-center gap-2 py-10 text-slate-500 dark:text-slate-400">
        <UIcon name="i-lucide-loader-2" class="size-5 animate-spin" />
        <span class="text-sm">Loading ingredients…</span>
      </div>

      <div v-else-if="loadFailed" class="space-y-3 py-6 text-center">
        <p class="text-sm text-slate-500 dark:text-slate-400">Couldn't load the ingredients.</p>
        <UButton variant="soft" icon="i-lucide-refresh-cw" @click="load">Try again</UButton>
      </div>

      <div v-else-if="data" class="space-y-4">
        <p v-if="servingsLabel" class="text-sm text-slate-500 dark:text-slate-400">
          {{ servingsLabel }}
        </p>

        <div
          v-if="data.ingredients.length"
          class="max-h-72 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 divide-y divide-slate-200 dark:divide-slate-700"
        >
          <label
            v-for="ing in data.ingredients"
            :key="ing.id"
            class="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <UCheckbox v-model="checked[ing.id]" :aria-label="ing.display" />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm">{{ ing.display }}</span>
              <span
                v-if="ing.display !== ing.raw"
                class="block truncate text-xs text-slate-500 dark:text-slate-400"
              >
                {{ ing.raw }}
              </span>
            </span>
          </label>
        </div>
        <p v-else class="py-2 text-center text-sm text-slate-500 dark:text-slate-400">
          This recipe has no ingredients yet.
        </p>

        <UFormField label="Add to list">
          <USelect v-model="listId" :items="listOptions" class="w-full" />
        </UFormField>

        <UButton
          :loading="busy"
          :disabled="!selectedIds.length"
          icon="i-lucide-shopping-basket"
          block
          @click="addItems"
        >
          Add {{ selectedIds.length }} item{{ selectedIds.length === 1 ? '' : 's' }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
