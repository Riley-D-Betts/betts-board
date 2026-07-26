<script setup lang="ts">
const toast = useToast()

const q = ref('')
const tag = ref<string | null>(null)
const sort = ref<'recent' | 'rating' | 'title'>('recent')

const sortItems = [
  { label: 'Newest', value: 'recent' },
  { label: 'Top rated', value: 'rating' },
  { label: 'A to Z', value: 'title' },
]

// Debounced: the query is bound straight to the input, so without this every
// keystroke fires a request.
const debouncedQ = refDebounced(q, 250)

const { data: recipeList, pending } = await useFetch('/api/recipes', {
  query: computed(() => ({
    ...(debouncedQ.value.trim() && { q: debouncedQ.value.trim() }),
    ...(tag.value && { tag: tag.value }),
    sort: sort.value,
  })),
})

/** Chips: every tag in the current results, plus the active one so it stays dismissable. */
const tagChips = computed(() => {
  const tags = new Set<string>()
  if (tag.value) tags.add(tag.value)
  for (const r of recipeList.value ?? []) {
    for (const t of r.tags ?? []) tags.add(t)
  }
  return [...tags].sort((a, b) => a.localeCompare(b))
})

const creating = ref(false)

async function createManually() {
  if (creating.value) return
  creating.value = true
  try {
    const recipe = await $fetch('/api/recipes', { method: 'POST', body: { title: 'New recipe' } })
    await navigateTo(`/recipes/${recipe.id}/edit`)
  }
  catch {
    toast.add({ title: 'Could not create recipe', color: 'error' })
    creating.value = false
  }
}

const addItems = [[
  { label: 'Import from link', icon: 'i-lucide-link', onSelect: () => navigateTo('/recipes/import') },
  { label: 'Create manually', icon: 'i-lucide-pencil-line', onSelect: () => createManually() },
]]
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center gap-2">
      <h1 class="text-2xl md:text-3xl font-bold flex-1">Recipes</h1>
      <UDropdownMenu :items="addItems">
        <UButton icon="i-lucide-plus" :loading="creating">Add</UButton>
      </UDropdownMenu>
    </div>

    <div class="flex flex-col sm:flex-row gap-2">
      <UInput
        v-model="q"
        icon="i-lucide-search"
        placeholder="Search recipes…"
        class="flex-1"
        size="lg"
      />
      <USelect v-model="sort" :items="sortItems" size="lg" class="sm:w-40" aria-label="Sort recipes" />
    </div>

    <div v-if="tagChips.length" class="flex flex-wrap gap-1.5">
      <UButton
        v-for="t in tagChips"
        :key="t"
        size="xs"
        :variant="tag === t ? 'solid' : 'soft'"
        :color="tag === t ? 'primary' : 'neutral'"
        class="rounded-full"
        @click="tag = tag === t ? null : t"
      >
        {{ t }}
        <UIcon v-if="tag === t" name="i-lucide-x" class="size-3" />
      </UButton>
    </div>

    <div v-if="!recipeList?.length && !pending" class="text-center py-16 text-slate-500 dark:text-slate-400">
      <UIcon name="i-lucide-chef-hat" class="size-12 mb-3" />
      <p v-if="q || tag">Nothing matches — try a different search.</p>
      <template v-else>
        <p>No recipes yet.</p>
        <div class="mt-4 flex justify-center gap-2">
          <UButton to="/recipes/import" icon="i-lucide-link" variant="soft">Import from link</UButton>
          <UButton icon="i-lucide-pencil-line" variant="soft" color="neutral" :loading="creating" @click="createManually">
            Create manually
          </UButton>
        </div>
      </template>
    </div>

    <div v-else class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
      <RecipeCard v-for="recipe in recipeList" :key="recipe.id" :recipe="recipe" />
    </div>
  </div>
</template>
