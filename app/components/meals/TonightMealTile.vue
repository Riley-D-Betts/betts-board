<!-- Dashboard tile: tonight's planned meal (dinner, else the latest filled slot today). -->
<script setup lang="ts">
type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack'
interface TileEntry {
  id: string
  slot: MealSlot
  recipeId: string | null
  freeText: string | null
  recipe: { id: string, title: string, imagePath: string | null, avgRating: number | null } | null
}

const today = todayString()
const { data: entries } = await useFetch<TileEntry[]>('/api/meal-plan', {
  query: { start: today, end: addDaysToDateString(today, 1) },
  default: () => [],
})

const SLOT_PREFERENCE: MealSlot[] = ['dinner', 'snack', 'lunch', 'breakfast']
const tonight = computed(() => {
  for (const slot of SLOT_PREFERENCE) {
    const entry = entries.value.find(e => e.slot === slot)
    if (entry) return entry
  }
  return null
})

const slotLabel = computed(() => {
  const slot = tonight.value?.slot
  if (!slot || slot === 'dinner') return null
  return slot[0]!.toUpperCase() + slot.slice(1)
})

function imgSrc(recipe: NonNullable<TileEntry['recipe']>) {
  if (!recipe.imagePath) return null
  return recipe.imagePath.startsWith('/') ? recipe.imagePath : `/uploads/${recipe.imagePath}`
}
</script>

<template>
  <UCard>
    <template #header>
      <NuxtLink to="/meals" class="flex items-center gap-2 font-semibold hover:text-primary">
        <UIcon name="i-lucide-utensils" class="text-primary size-5" />
        <span class="flex-1">Tonight</span>
        <UBadge v-if="slotLabel" variant="soft" size="sm">{{ slotLabel }}</UBadge>
        <UIcon name="i-lucide-chevron-right" class="size-4 text-slate-400" />
      </NuxtLink>
    </template>

    <NuxtLink
      v-if="tonight?.recipe"
      :to="`/recipes/${tonight.recipe.id}`"
      class="flex min-h-11 items-center gap-3"
    >
      <img
        v-if="imgSrc(tonight.recipe)"
        :src="imgSrc(tonight.recipe)!"
        alt=""
        class="size-14 shrink-0 rounded-lg object-cover"
      >
      <div
        v-else
        class="grid size-14 shrink-0 place-items-center rounded-lg bg-slate-100 dark:bg-slate-800"
      >
        <UIcon name="i-lucide-chef-hat" class="size-6 text-slate-400" />
      </div>
      <div class="min-w-0 flex-1">
        <p class="truncate font-medium">{{ tonight.recipe.title }}</p>
        <p v-if="tonight.recipe.avgRating != null" class="mt-0.5 flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
          <UIcon name="i-lucide-star" class="size-3 text-amber-500" />
          {{ tonight.recipe.avgRating.toFixed(1) }}
        </p>
      </div>
    </NuxtLink>

    <p v-else-if="tonight" class="text-sm italic text-slate-600 dark:text-slate-300">
      {{ tonight.freeText }}
    </p>

    <div v-else class="text-sm text-slate-500 dark:text-slate-400">
      <p>Nothing planned for tonight.</p>
      <UButton to="/meals" variant="soft" size="sm" class="mt-2" icon="i-lucide-calendar-plus">
        Plan tonight
      </UButton>
    </div>
  </UCard>
</template>
