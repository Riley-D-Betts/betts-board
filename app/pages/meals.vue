<script setup lang="ts">
const { state } = useBoardState()
const toast = useToast()
const { t } = useI18n()

interface PlanRecipe {
  id: string
  title: string
  imagePath: string | null
  servings: number | null
  avgRating: number | null
}
type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack'
interface PlanEntry {
  id: string
  date: string
  slot: MealSlot
  recipeId: string | null
  freeText: string | null
  servingsOverride: number | null
  cookProfileId: string | null
  recipe: PlanRecipe | null
  cook: { id: string, name: string, color: string } | null
}

const SLOTS = computed<{ key: MealSlot, label: string }[]>(() => [
  { key: 'breakfast', label: t('meals.slots.breakfast') },
  { key: 'lunch', label: t('meals.slots.lunch') },
  { key: 'dinner', label: t('meals.slots.dinner') },
  { key: 'snack', label: t('meals.slots.snack') },
])

const today = todayString()
const weekStartsOn = computed(() => state.value?.settings?.weekStartsOn ?? 0)
const weekOffset = ref(0)

const weekStart = computed(() => {
  const dow = parseDateString(today).getDay()
  const thisWeek = addDaysToDateString(today, -((dow - weekStartsOn.value + 7) % 7))
  return addDaysToDateString(thisWeek, weekOffset.value * 7)
})
const weekEnd = computed(() => addDaysToDateString(weekStart.value, 7))
const days = computed(() => Array.from({ length: 7 }, (_, i) => addDaysToDateString(weekStart.value, i)))

const weekLabel = computed(() => {
  if (weekOffset.value === 0) return t('meals.thisWeek')
  if (weekOffset.value === 1) return t('meals.nextWeek')
  if (weekOffset.value === -1) return t('meals.lastWeek')
  const start = parseDateString(weekStart.value)
  const end = parseDateString(addDaysToDateString(weekStart.value, 6))
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return `${fmt(start)} – ${fmt(end)}`
})

const { data: entries, refresh } = await useFetch<PlanEntry[]>('/api/meal-plan', {
  query: { start: weekStart, end: weekEnd },
  default: () => [],
})

function cellEntries(date: string, slot: MealSlot) {
  return entries.value.filter(e => e.date === date && e.slot === slot)
}

function dayLabel(date: string) {
  return parseDateString(date).toLocaleDateString(undefined, { weekday: 'short' })
}
function dayNumber(date: string) {
  return parseDateString(date).getDate()
}

function imgSrc(recipe: PlanRecipe) {
  if (!recipe.imagePath) return null
  return recipe.imagePath.startsWith('/') ? recipe.imagePath : `/uploads/${recipe.imagePath}`
}

const picker = reactive({ open: false, date: today, slot: 'dinner' as MealSlot })
function openPicker(date: string, slot: MealSlot) {
  picker.date = date
  picker.slot = slot
  picker.open = true
}

async function addEntry(payload: { recipeId?: string, freeText?: string, servingsOverride?: number | null, cookProfileId?: string | null }) {
  try {
    await $fetch('/api/meal-plan/entries', {
      method: 'POST',
      body: { date: picker.date, slot: picker.slot, ...payload },
    })
    picker.open = false
    await refresh()
  }
  catch {
    toast.add({ title: t('meals.couldNotPlan'), color: 'error' })
  }
}

async function removeEntry(entry: PlanEntry) {
  try {
    await $fetch(`/api/meal-plan/entries/${entry.id}`, { method: 'DELETE' })
    await refresh()
  }
  catch {
    toast.add({ title: t('meals.couldNotRemove'), color: 'error' })
  }
}

const generateOpen = ref(false)
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="text-2xl md:text-3xl font-bold flex-1">{{ $t('meals.title') }}</h1>
      <UButton icon="i-lucide-shopping-cart" variant="soft" @click="generateOpen = true">
        {{ $t('meals.generateList') }}
      </UButton>
    </div>

    <!-- Week navigation -->
    <div class="flex items-center gap-1">
      <UButton icon="i-lucide-chevron-left" variant="ghost" color="neutral" :aria-label="$t('meals.weekNav.previous')" @click="weekOffset--" />
      <span class="min-w-36 text-center font-medium">{{ weekLabel }}</span>
      <UButton icon="i-lucide-chevron-right" variant="ghost" color="neutral" :aria-label="$t('meals.weekNav.next')" @click="weekOffset++" />
      <UButton v-if="weekOffset !== 0" variant="ghost" size="sm" @click="weekOffset = 0">{{ $t('common.actions.today') }}</UButton>
    </div>

    <!-- 7 day columns on desktop, stacked cards on mobile -->
    <div class="grid grid-cols-1 md:grid-cols-7 gap-3">
      <section
        v-for="date in days"
        :key="date"
        class="rounded-xl border bg-white dark:bg-slate-900 p-2"
        :class="date === today
          ? 'border-primary/60 ring-1 ring-primary/30'
          : 'border-slate-200 dark:border-slate-800'"
      >
        <header class="flex items-baseline gap-1.5 px-1 pb-2 md:flex-col md:gap-0">
          <span
            class="text-xs font-semibold uppercase tracking-wide"
            :class="date === today ? 'text-primary' : 'text-slate-500 dark:text-slate-400'"
          >
            {{ dayLabel(date) }}
          </span>
          <span class="text-lg font-bold leading-tight">{{ dayNumber(date) }}</span>
        </header>

        <div class="space-y-2">
          <div v-for="slot in SLOTS" :key="slot.key">
            <p class="px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              {{ slot.label }}
            </p>
            <div class="mt-0.5 space-y-1">
              <div
                v-for="entry in cellEntries(date, slot.key)"
                :key="entry.id"
                class="group relative flex items-stretch rounded-lg bg-slate-50 dark:bg-slate-800 p-1.5 pr-7"
              >
                <NuxtLink
                  v-if="entry.recipe"
                  :to="`/recipes/${entry.recipe.id}`"
                  class="flex min-w-0 flex-1 items-center gap-2"
                >
                  <img
                    v-if="imgSrc(entry.recipe)"
                    :src="imgSrc(entry.recipe)!"
                    alt=""
                    class="size-8 shrink-0 rounded object-cover"
                  >
                  <div class="min-w-0">
                    <p class="truncate text-xs font-medium">{{ entry.recipe.title }}</p>
                    <p class="flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400">
                      <span v-if="entry.recipe.avgRating != null" class="inline-flex items-center gap-0.5">
                        <UIcon name="i-lucide-star" class="size-2.5 text-amber-500" />
                        {{ entry.recipe.avgRating.toFixed(1) }}
                      </span>
                      <span v-if="entry.servingsOverride">×{{ entry.servingsOverride }}</span>
                    </p>
                  </div>
                </NuxtLink>
                <p v-else class="min-w-0 flex-1 self-center text-xs italic text-slate-600 dark:text-slate-300">
                  {{ entry.freeText }}
                </p>
                <button
                  class="absolute right-0.5 top-0.5 rounded p-1 text-slate-400 hover:text-red-500"
                  :aria-label="$t('meals.removeEntry', { title: entry.recipe?.title ?? entry.freeText })"
                  @click="removeEntry(entry)"
                >
                  <UIcon name="i-lucide-x" class="size-3.5" />
                </button>
              </div>

              <button
                class="flex min-h-8 w-full items-center justify-center rounded-lg border border-dashed border-slate-300 dark:border-slate-700 text-slate-400 hover:border-primary hover:text-primary"
                :aria-label="$t('meals.planSlot', { slot: slot.label, date })"
                @click="openPicker(date, slot.key)"
              >
                <UIcon name="i-lucide-plus" class="size-4" />
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>

    <RecipePickerModal
      v-model:open="picker.open"
      :date="picker.date"
      :meal-slot="picker.slot"
      @pick="addEntry"
    />
    <GenerateDialog v-model:open="generateOpen" :start="weekStart" :end="weekEnd" />
  </div>
</template>
