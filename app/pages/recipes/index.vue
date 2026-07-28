<script setup lang="ts">
const toast = useToast()
const { t } = useI18n()

const q = ref('')
const tag = ref<string | null>(null)
const sort = ref<'recent' | 'rating' | 'title'>('recent')

const sortItems = computed(() => [
  { label: t('recipes.newest'), value: 'recent' },
  { label: t('recipes.topRated'), value: 'rating' },
  { label: t('recipes.aToZ'), value: 'title' },
])

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
    for (const tagName of r.tags ?? []) tags.add(tagName)
  }
  return [...tags].sort((a, b) => a.localeCompare(b))
})

const creating = ref(false)

async function createManually() {
  if (creating.value) return
  creating.value = true
  try {
    const recipe = await $fetch('/api/recipes', { method: 'POST', body: { title: t('recipes.defaultTitle') } })
    await navigateTo(`/recipes/${recipe.id}/edit`)
  }
  catch {
    toast.add({ title: t('recipes.couldNotCreate'), color: 'error' })
    creating.value = false
  }
}

const addItems = computed(() => [[
  { label: t('recipes.importFromLink'), icon: 'i-lucide-link', onSelect: () => navigateTo('/recipes/import') },
  { label: t('recipes.createManually'), icon: 'i-lucide-pencil-line', onSelect: () => createManually() },
]])
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center gap-2">
      <h1 class="text-2xl md:text-3xl font-bold flex-1">{{ $t('recipes.title') }}</h1>
      <UDropdownMenu :items="addItems">
        <UButton icon="i-lucide-plus" :loading="creating">{{ $t('common.actions.add') }}</UButton>
      </UDropdownMenu>
    </div>

    <div class="flex flex-col sm:flex-row gap-2">
      <UInput
        v-model="q"
        icon="i-lucide-search"
        :placeholder="$t('recipes.search')"
        class="flex-1"
        size="lg"
      />
      <USelect v-model="sort" :items="sortItems" size="lg" class="sm:w-40" :aria-label="$t('recipes.sortAria')" />
    </div>

    <div v-if="tagChips.length" class="flex flex-wrap gap-1.5">
      <UButton
        v-for="tagName in tagChips"
        :key="tagName"
        size="xs"
        :variant="tag === tagName ? 'solid' : 'soft'"
        :color="tag === tagName ? 'primary' : 'neutral'"
        class="rounded-full"
        @click="tag = tag === tagName ? null : tagName"
      >
        {{ tagName }}
        <UIcon v-if="tag === tagName" name="i-lucide-x" class="size-3" />
      </UButton>
    </div>

    <div v-if="!recipeList?.length && !pending" class="text-center py-16 text-slate-500 dark:text-slate-400">
      <UIcon name="i-lucide-chef-hat" class="size-12 mb-3" />
      <p v-if="q || tag">{{ $t('recipes.noMatches') }}</p>
      <template v-else>
        <p>{{ $t('recipes.none') }}</p>
        <div class="mt-4 flex justify-center gap-2">
          <UButton to="/recipes/import" icon="i-lucide-link" variant="soft">{{ $t('recipes.importFromLink') }}</UButton>
          <UButton icon="i-lucide-pencil-line" variant="soft" color="neutral" :loading="creating" @click="createManually">
            {{ $t('recipes.createManually') }}
          </UButton>
        </div>
      </template>
    </div>

    <div v-else class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
      <RecipeCard v-for="recipe in recipeList" :key="recipe.id" :recipe="recipe" />
    </div>
  </div>
</template>
