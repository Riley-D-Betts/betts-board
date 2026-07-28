<script setup lang="ts">
import type { RecipeDetail } from '~~/server/services/recipes/recipes'

const route = useRoute()
const toast = useToast()
const { t } = useI18n()
const recipeId = route.params.id as string

// Dynamic URL defeats Nuxt's route-based response inference — type it by hand.
const { data: recipe, refresh } = await useFetch<RecipeDetail>(`/api/recipes/${recipeId}`)

if (!recipe.value) {
  throw createError({ statusCode: 404, statusMessage: t('recipes.notFound'), fatal: true })
}

function duration(mins: number) {
  if (mins < 60) return t('recipes.duration.minutes', { n: mins })
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? t('recipes.duration.hoursMinutes', { h, m }) : t('recipes.duration.hours', { n: h })
}

function timeChip(key: 'total' | 'prep' | 'cook', mins: number | null | undefined) {
  if (!mins) return null
  return t(`recipes.detail.time.${key}`, { duration: duration(mins) })
}

const metaChips = computed(() => {
  const r = recipe.value
  if (!r) return []
  const chips: Array<{ icon: string, text: string }> = []
  const total = timeChip('total', r.totalMinutes)
  const prep = timeChip('prep', r.prepMinutes)
  const cook = timeChip('cook', r.cookMinutes)
  if (total) chips.push({ icon: 'i-lucide-clock', text: total })
  if (prep) chips.push({ icon: 'i-lucide-timer', text: prep })
  if (cook) chips.push({ icon: 'i-lucide-flame', text: cook })
  if (r.servings) chips.push({ icon: 'i-lucide-users', text: t('recipes.detail.serves', { n: r.servings }) })
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
    toast.add({ title: t('recipes.detail.couldNotRate'), color: 'error' })
  }
}

const deleting = ref(false)

async function deleteRecipe() {
  if (!confirm(t('recipes.detail.confirmDelete', { title: recipe.value?.title }))) return
  deleting.value = true
  try {
    await $fetch(`/api/recipes/${recipeId}`, { method: 'DELETE' })
    toast.add({ title: t('recipes.detail.deleted'), icon: 'i-lucide-trash-2' })
    await navigateTo('/recipes')
  }
  catch {
    toast.add({ title: t('recipes.detail.couldNotDelete'), color: 'error' })
    deleting.value = false
  }
}
</script>

<template>
  <div v-if="recipe" class="space-y-6 max-w-4xl">
    <div class="flex items-center gap-2">
      <UButton to="/recipes" icon="i-lucide-arrow-left" variant="ghost" color="neutral" :aria-label="$t('recipes.backToList')" />
      <div class="flex-1" />
      <UButton :to="`/recipes/${recipeId}/edit`" icon="i-lucide-pencil" variant="soft" color="neutral">{{ $t('common.actions.edit') }}</UButton>
      <UButton
        icon="i-lucide-trash-2"
        variant="soft"
        color="error"
        :loading="deleting"
        :aria-label="$t('recipes.detail.deleteAria')"
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
          {{ $t('recipes.detail.tapToRate') }}
        </span>
      </div>

      <div v-if="recipe.tags?.length" class="flex flex-wrap gap-1.5">
        <UBadge v-for="tagName in recipe.tags" :key="tagName" variant="subtle" size="sm">{{ tagName }}</UBadge>
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
        {{ sourceHost ?? $t('recipes.detail.source') }}
      </a>
    </div>

    <div class="grid gap-8 md:grid-cols-[minmax(16rem,1fr)_2fr]">
      <section>
        <h2 class="text-lg font-semibold mb-2 flex items-center gap-2">
          <UIcon name="i-lucide-shopping-basket" class="size-5" />
          {{ $t('recipes.detail.ingredients') }}
        </h2>
        <p v-if="!recipe.ingredients.length" class="text-sm text-slate-500 dark:text-slate-400">
          {{ $t('recipes.detail.noIngredients') }}
        </p>
        <IngredientList v-else :ingredients="recipe.ingredients" />
      </section>

      <section>
        <h2 class="text-lg font-semibold mb-2 flex items-center gap-2">
          <UIcon name="i-lucide-list-ordered" class="size-5" />
          {{ $t('recipes.detail.steps') }}
        </h2>
        <p v-if="!recipe.steps.length" class="text-sm text-slate-500 dark:text-slate-400">
          {{ $t('recipes.detail.noSteps') }}
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
