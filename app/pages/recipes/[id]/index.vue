<script setup lang="ts">
import type { RecipeDetail } from '~~/server/services/recipes/recipes'

const route = useRoute()
const toast = useToast()
const recipeId = route.params.id as string

// Dynamic URL defeats Nuxt's route-based response inference — type it by hand.
const { data: recipe, refresh } = await useFetch<RecipeDetail>(`/api/recipes/${recipeId}`)

if (!recipe.value) {
  throw createError({ statusCode: 404, statusMessage: 'Recipe not found', fatal: true })
}

function timeChip(label: string, mins: number | null | undefined) {
  if (!mins) return null
  if (mins < 60) return `${label} ${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${label} ${h} hr ${m} min` : `${label} ${h} hr`
}

const metaChips = computed(() => {
  const r = recipe.value
  if (!r) return []
  const chips: Array<{ icon: string, text: string }> = []
  const total = timeChip('Total', r.totalMinutes)
  const prep = timeChip('Prep', r.prepMinutes)
  const cook = timeChip('Cook', r.cookMinutes)
  if (total) chips.push({ icon: 'i-lucide-clock', text: total })
  if (prep) chips.push({ icon: 'i-lucide-timer', text: prep })
  if (cook) chips.push({ icon: 'i-lucide-flame', text: cook })
  if (r.servings) chips.push({ icon: 'i-lucide-users', text: `Serves ${r.servings}` })
  return chips
})

const sourceHost = computed(() => {
  const src = recipe.value?.sourceUrl
  if (!src) return null
  try {
    return new URL(src).hostname.replace(/^www\./, '')
  }
  catch {
    return null
  }
})

async function rate(value: number) {
  try {
    await $fetch(`/api/recipes/${recipeId}/rating`, { method: 'PUT', body: { rating: value } })
    await refresh()
  }
  catch {
    toast.add({ title: 'Could not save rating', color: 'error' })
  }
}

const deleting = ref(false)

async function deleteRecipe() {
  if (!confirm(`Delete "${recipe.value?.title}"? This can't be undone.`)) return
  deleting.value = true
  try {
    await $fetch(`/api/recipes/${recipeId}`, { method: 'DELETE' })
    toast.add({ title: 'Recipe deleted', icon: 'i-lucide-trash-2' })
    await navigateTo('/recipes')
  }
  catch {
    toast.add({ title: 'Could not delete recipe', color: 'error' })
    deleting.value = false
  }
}
</script>

<template>
  <div v-if="recipe" class="space-y-6 max-w-4xl">
    <div class="flex items-center gap-2">
      <UButton to="/recipes" icon="i-lucide-arrow-left" variant="ghost" color="neutral" aria-label="Back to recipes" />
      <div class="flex-1" />
      <UButton :to="`/recipes/${recipeId}/edit`" icon="i-lucide-pencil" variant="soft" color="neutral">Edit</UButton>
      <UButton
        icon="i-lucide-trash-2"
        variant="soft"
        color="error"
        :loading="deleting"
        aria-label="Delete recipe"
        @click="deleteRecipe"
      />
    </div>

    <img
      v-if="recipe.imagePath"
      :src="`/uploads/${recipe.imagePath}`"
      :alt="recipe.title"
      class="w-full max-h-80 object-cover rounded-2xl"
    >

    <div class="space-y-3">
      <h1 class="text-2xl md:text-3xl font-bold">{{ recipe.title }}</h1>

      <div v-if="metaChips.length" class="flex flex-wrap gap-1.5">
        <UBadge v-for="chip in metaChips" :key="chip.text" variant="soft" color="neutral">
          <UIcon :name="chip.icon" class="size-3.5" />
          {{ chip.text }}
        </UBadge>
      </div>

      <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
        <RatingStars
          :model-value="recipe.myRating"
          :avg="recipe.avgRating"
          :count="recipe.ratingCount"
          @rate="rate"
        />
        <span v-if="!recipe.ratingCount" class="text-sm text-slate-400 dark:text-slate-500">
          Tap a star to rate it
        </span>
      </div>

      <div v-if="recipe.tags?.length" class="flex flex-wrap gap-1.5">
        <UBadge v-for="t in recipe.tags" :key="t" variant="subtle" size="sm">{{ t }}</UBadge>
      </div>

      <p v-if="recipe.description" class="text-slate-600 dark:text-slate-300">
        {{ recipe.description }}
      </p>

      <a
        v-if="recipe.sourceUrl"
        :href="recipe.sourceUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="inline-flex items-center gap-1 text-sm text-primary hover:underline"
      >
        <UIcon name="i-lucide-external-link" class="size-3.5" />
        {{ sourceHost ?? 'Source' }}
      </a>
    </div>

    <div class="grid gap-8 md:grid-cols-[minmax(16rem,1fr)_2fr]">
      <section>
        <h2 class="text-lg font-semibold mb-2 flex items-center gap-2">
          <UIcon name="i-lucide-shopping-basket" class="size-5" />
          Ingredients
        </h2>
        <p v-if="!recipe.ingredients.length" class="text-sm text-slate-500 dark:text-slate-400">
          No ingredients listed.
        </p>
        <IngredientList v-else :ingredients="recipe.ingredients" />
      </section>

      <section>
        <h2 class="text-lg font-semibold mb-2 flex items-center gap-2">
          <UIcon name="i-lucide-list-ordered" class="size-5" />
          Steps
        </h2>
        <p v-if="!recipe.steps.length" class="text-sm text-slate-500 dark:text-slate-400">
          No steps listed.
        </p>
        <ol v-else class="space-y-4">
          <li v-for="(step, i) in recipe.steps" :key="i" class="flex gap-3">
            <span
              class="size-7 shrink-0 rounded-full bg-primary/10 text-primary text-sm font-semibold flex items-center justify-center"
            >{{ i + 1 }}</span>
            <p class="pt-0.5">{{ step }}</p>
          </li>
        </ol>
      </section>
    </div>

    <USeparator />

    <RecipeNotes :recipe-id="recipeId" :notes="recipe.notes" @changed="refresh()" />
  </div>
</template>
