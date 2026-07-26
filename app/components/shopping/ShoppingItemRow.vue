<!-- One shopping-list line. Used by the list page (checked and unchecked) and
     the dashboard tile, which each used to re-implement it. -->
<script setup lang="ts">
export interface ShoppingRowItem {
  id: string
  name: string
  displayQuantity: string | null
  checked: boolean
}

withDefaults(defineProps<{
  item: ShoppingRowItem
  /** Tighter type for the dashboard tile. */
  compact?: boolean
}>(), { compact: false })

const emit = defineEmits<{ toggle: [] }>()
</script>

<template>
  <button
    class="flex w-full items-center gap-3 px-3 py-2 text-left"
    :class="compact ? 'min-h-11' : 'min-h-12'"
    :aria-label="item.checked ? `Uncheck ${item.name}` : `Check off ${item.name}`"
    @click="emit('toggle')"
  >
    <UIcon
      :name="item.checked ? 'i-lucide-circle-check-big' : 'i-lucide-circle'"
      class="size-6 shrink-0"
      :class="item.checked ? 'text-primary' : 'text-slate-300 dark:text-slate-600'"
    />

    <!-- Quantity leads, in a fixed-width column: down a long list the amounts
         line up and can be scanned at a glance, instead of trailing the name
         at ragged positions. The spacer keeps names aligned when an item has
         no quantity. -->
    <span
      class="shrink-0 text-right tabular-nums"
      :class="[
        compact ? 'min-w-12 text-sm' : 'min-w-16 text-base',
        item.checked ? 'text-slate-400' : 'font-semibold text-primary',
      ]"
    >{{ item.displayQuantity ?? '' }}</span>

    <span
      class="min-w-0 flex-1 truncate"
      :class="[
        compact ? 'text-sm' : '',
        item.checked ? 'text-slate-400 line-through' : 'font-medium',
      ]"
    >{{ item.name }}</span>
  </button>
</template>
