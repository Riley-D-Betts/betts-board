<!-- Pick a recipe (search, rating-sorted) or free-type a meal for one planner cell. -->
<script setup lang="ts">
interface PickerRecipe {
  id: string
  title: string
  imagePath?: string | null
  servings?: number | null
  avgRating?: number | null
}

const props = defineProps<{
  date: string
  mealSlot: 'breakfast' | 'lunch' | 'dinner' | 'snack'
}>()

const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{
  pick: [payload: { recipeId?: string, freeText?: string, servingsOverride?: number | null, cookProfileId?: string | null }]
}>()

const { state } = useBoardState()
const cookItems = computed(() => [
  { label: 'No cook', value: '' },
  ...(state.value?.profiles ?? []).map(p => ({ label: p.name, value: p.id })),
])

const q = ref('')
const freeText = ref('')
const servings = ref<number | ''>('')
const cookId = ref('')

watch(open, (isOpen) => {
  if (!isOpen) return
  q.value = ''
  freeText.value = ''
  servings.value = ''
  // Pre-fill the household's default cook (Settings → Household); overridable.
  cookId.value = state.value?.settings?.defaultCookProfileId ?? ''
})

const { data: recipes } = await useFetch<PickerRecipe[]>('/api/recipes', {
  query: computed(() => ({ ...(q.value ? { q: q.value } : {}), sort: 'rating' })),
  default: () => [],
})
const recipeList = computed(() => (Array.isArray(recipes.value) ? recipes.value : []))

const title = computed(() => {
  const day = parseDateString(props.date).toLocaleDateString(undefined, {
    weekday: 'long', month: 'short', day: 'numeric',
  })
  const slot = props.mealSlot[0]!.toUpperCase() + props.mealSlot.slice(1)
  return `${slot} · ${day}`
})

function servingsValue(): number | null {
  return typeof servings.value === 'number' && servings.value > 0 ? servings.value : null
}

function cookValue(): string | null {
  return cookId.value || null
}

function pickRecipe(recipe: PickerRecipe) {
  emit('pick', { recipeId: recipe.id, servingsOverride: servingsValue(), cookProfileId: cookValue() })
}

function addFreeText() {
  const text = freeText.value.trim()
  if (!text) return
  emit('pick', { freeText: text, cookProfileId: cookValue() })
}

function imgSrc(recipe: PickerRecipe) {
  if (!recipe.imagePath) return null
  return recipe.imagePath.startsWith('/') ? recipe.imagePath : `/uploads/${recipe.imagePath}`
}
</script>

<template>
  <UModal v-model:open="open" :title="title">
    <template #body>
      <div class="space-y-4">
        <div class="flex gap-2">
          <UInput v-model="q" icon="i-lucide-search" placeholder="Search recipes…" class="flex-1" />
          <UInput
            v-model.number="servings"
            type="number"
            min="1"
            placeholder="Servings"
            class="w-28"
            aria-label="Servings override"
          />
        </div>

        <UFormField label="Who's cooking?">
          <USelect
            v-model="cookId"
            :items="cookItems"
            icon="i-lucide-chef-hat"
            class="w-full"
            aria-label="Cook"
          />
        </UFormField>

        <div
          v-if="recipeList.length"
          class="max-h-72 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 divide-y divide-slate-200 dark:divide-slate-700"
        >
          <button
            v-for="recipe in recipeList"
            :key="recipe.id"
            class="flex w-full min-h-14 items-center gap-3 px-3 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
            @click="pickRecipe(recipe)"
          >
            <img
              v-if="imgSrc(recipe)"
              :src="imgSrc(recipe)!"
              alt=""
              class="size-10 shrink-0 rounded-lg object-cover"
            >
            <div
              v-else
              class="grid size-10 shrink-0 place-items-center rounded-lg bg-slate-100 dark:bg-slate-800"
            >
              <UIcon name="i-lucide-chef-hat" class="size-5 text-slate-400" />
            </div>
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium">{{ recipe.title }}</p>
              <p class="text-xs text-slate-500 dark:text-slate-400">
                <span v-if="recipe.avgRating != null" class="inline-flex items-center gap-0.5">
                  <UIcon name="i-lucide-star" class="size-3 text-amber-500" />
                  {{ recipe.avgRating.toFixed(1) }}
                </span>
                <span v-if="recipe.servings"> · {{ recipe.servings }} servings</span>
              </p>
            </div>
            <UIcon name="i-lucide-plus" class="size-4 shrink-0 text-slate-400" />
          </button>
        </div>
        <p v-else class="py-2 text-center text-sm text-slate-500 dark:text-slate-400">
          No recipes {{ q ? 'match your search' : 'yet' }}.
        </p>

        <USeparator label="or just type it" />

        <form class="flex gap-2" @submit.prevent="addFreeText">
          <UInput
            v-model="freeText"
            placeholder="“Leftovers”, “Pizza night out”…"
            class="flex-1"
          />
          <UButton type="submit" :disabled="!freeText.trim()">Add</UButton>
        </form>
      </div>
    </template>
  </UModal>
</template>
