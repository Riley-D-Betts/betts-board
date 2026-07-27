<script setup lang="ts">
const props = withDefaults(defineProps<{
  /** The acting profile's own rating (highlighted when set). */
  modelValue?: number | null
  /** Household average rating. */
  avg?: number | null
  /** Number of ratings behind the average. */
  count?: number
  readonly?: boolean
  size?: 'sm' | 'md'
}>(), { modelValue: null, avg: null, count: 0, readonly: false, size: 'md' })

const emit = defineEmits<{ rate: [value: number] }>()

/** What the stars depict: my rating when I have one, else the average. */
const shown = computed(() => props.modelValue ?? props.avg ?? 0)

const starClass = computed(() => props.size === 'sm' ? 'size-4' : 'size-6')

function filled(i: number) {
  return shown.value >= i - 0.5
}
</script>

<template>
  <div class="flex items-center gap-1.5">
    <!-- Read-only: compact icon row -->
    <div v-if="readonly" class="flex items-center" aria-hidden="true">
      <UIcon
        v-for="i in 5"
        :key="i"
        name="i-lucide-star"
        :class="[starClass, filled(i) ? 'text-amber-400 dark:text-amber-300' : 'text-slate-300 dark:text-slate-600']"
      />
    </div>

    <!-- Interactive: 44px tap targets -->
    <div v-else class="flex items-center" role="radiogroup" :aria-label="$t('recipes.rating.groupLabel')">
      <button
        v-for="i in 5"
        :key="i"
        type="button"
        class="size-11 flex items-center justify-center rounded-lg active:scale-90 transition-transform"
        role="radio"
        :aria-checked="modelValue === i"
        :aria-label="$t('recipes.rating.starCount', i)"
        @click="emit('rate', i)"
      >
        <UIcon
          name="i-lucide-star"
          class="size-7"
          :class="filled(i)
            ? (modelValue != null ? 'text-amber-400 dark:text-amber-300' : 'text-amber-300/70 dark:text-amber-300/50')
            : 'text-slate-300 dark:text-slate-600'"
        />
      </button>
    </div>

    <span v-if="count > 0" class="text-sm text-slate-500 dark:text-slate-400 tabular-nums">
      {{ avg?.toFixed(1) }} ({{ count }})
    </span>
  </div>
</template>
