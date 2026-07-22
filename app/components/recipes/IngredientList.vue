<script setup lang="ts">
defineProps<{
  ingredients: Array<{
    id: string
    raw: string
    quantity: number | null
    unit: string | null
    name: string | null
  }>
}>()

/** Tap-to-dim so cooks can track what's already in the bowl. Purely local state. */
const checked = ref(new Set<string>())

function toggle(id: string) {
  const next = new Set(checked.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  checked.value = next
}
</script>

<template>
  <ul class="space-y-1">
    <li v-for="ing in ingredients" :key="ing.id">
      <button
        type="button"
        class="w-full min-h-11 flex items-start gap-2.5 text-left py-2 px-1 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
        :class="checked.has(ing.id) ? 'opacity-45' : ''"
        @click="toggle(ing.id)"
      >
        <UIcon
          :name="checked.has(ing.id) ? 'i-lucide-check-circle-2' : 'i-lucide-circle'"
          class="size-4.5 mt-0.5 shrink-0"
          :class="checked.has(ing.id) ? 'text-primary' : 'text-slate-300 dark:text-slate-600'"
        />
        <span :class="checked.has(ing.id) ? 'line-through' : ''">{{ ing.raw }}</span>
      </button>
    </li>
  </ul>
</template>
