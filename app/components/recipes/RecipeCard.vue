<script setup lang="ts">
defineProps<{
  recipe: {
    id: string
    title: string
    imagePath: string | null
    totalMinutes: number | null
    prepMinutes: number | null
    cookMinutes: number | null
    tags: string[] | null
    avgRating: number | null
    ratingCount: number
  }
}>()

const { t } = useI18n()

function timeLabel(r: { totalMinutes: number | null, prepMinutes: number | null, cookMinutes: number | null }) {
  const mins = r.totalMinutes ?? ((r.prepMinutes ?? 0) + (r.cookMinutes ?? 0) || null)
  if (!mins) return null
  if (mins < 60) return t('recipes.duration.minutes', { n: mins })
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? t('recipes.duration.hoursMinutes', { h, m }) : t('recipes.duration.hours', { n: h })
}
</script>

<template>
  <NuxtLink
    :to="`/recipes/${recipe.id}`"
    class="group block rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:shadow-md transition-shadow"
  >
    <div class="aspect-[4/3] overflow-hidden">
      <img
        v-if="recipe.imagePath"
        :src="`/uploads/${recipe.imagePath}`"
        :alt="recipe.title"
        loading="lazy"
        class="size-full object-cover group-hover:scale-105 transition-transform duration-300"
      >
      <div
        v-else
        class="size-full flex items-center justify-center bg-gradient-to-br from-amber-100 via-orange-100 to-rose-100 dark:from-amber-950 dark:via-orange-950 dark:to-rose-950"
      >
        <UIcon name="i-lucide-chef-hat" class="size-10 text-amber-400/80 dark:text-amber-600/80" />
      </div>
    </div>
    <div class="p-3 space-y-1.5">
      <p class="font-semibold leading-snug line-clamp-2">{{ recipe.title }}</p>
      <div class="flex items-center justify-between gap-2">
        <span v-if="timeLabel(recipe)" class="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
          <UIcon name="i-lucide-clock" class="size-3.5" />
          {{ timeLabel(recipe) }}
        </span>
        <span v-else />
        <RatingStars v-if="recipe.ratingCount > 0" :avg="recipe.avgRating" :count="recipe.ratingCount" readonly size="sm" />
      </div>
    </div>
  </NuxtLink>
</template>
