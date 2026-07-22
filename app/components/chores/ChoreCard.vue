<script setup lang="ts">
import type { ChoreInstance } from '#shared/schemas/chores'

withDefaults(defineProps<{
  instance: ChoreInstance
  /** Acting profile may not toggle this instance (kids: only their own). */
  disabled?: boolean
  /** Tile mode: hide the assignee avatar (it's always "me"). */
  compact?: boolean
}>(), { disabled: false, compact: false })

const emit = defineEmits<{ toggle: [] }>()

function formatTime(t: string) {
  const [h, m] = t.split(':').map(Number)
  const d = new Date()
  d.setHours(h!, m!, 0, 0)
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}
</script>

<template>
  <div
    class="flex items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2 transition-opacity"
    :class="instance.completed ? 'opacity-60' : ''"
  >
    <button
      type="button"
      class="size-11 shrink-0 rounded-full border-2 flex items-center justify-center transition-colors"
      :class="[
        instance.completed
          ? 'bg-primary border-primary text-white'
          : 'border-slate-300 dark:border-slate-600 hover:border-primary',
        disabled ? 'cursor-not-allowed opacity-40' : 'active:scale-95',
      ]"
      :disabled="disabled"
      :aria-label="instance.completed ? `Mark ${instance.title} not done` : `Mark ${instance.title} done`"
      @click="emit('toggle')"
    >
      <UIcon v-if="instance.completed" name="i-lucide-check" class="size-6 chore-check-pop" />
    </button>

    <span v-if="instance.emoji" class="text-2xl w-9 text-center shrink-0">{{ instance.emoji }}</span>

    <div class="min-w-0 flex-1">
      <p class="font-medium truncate" :class="instance.completed ? 'line-through' : ''">
        {{ instance.title }}
      </p>
      <p class="text-xs text-slate-500 dark:text-slate-400 truncate">
        <template v-if="instance.dueTime">by {{ formatTime(instance.dueTime) }}</template>
        <template v-if="instance.dueTime && !compact"> · </template>
        <template v-if="!compact">{{ instance.profileName }}</template>
      </p>
    </div>

    <UBadge v-if="instance.points > 0" variant="soft" color="warning" class="shrink-0">
      <UIcon name="i-lucide-star" class="size-3.5" />
      {{ instance.points }}
    </UBadge>

    <ProfileAvatar
      v-if="!compact"
      :profile="{ name: instance.profileName, color: instance.profileColor }"
      size="sm"
    />
  </div>
</template>

<style scoped>
@keyframes chore-pop {
  0% { transform: scale(0); }
  60% { transform: scale(1.4); }
  80% { transform: scale(0.9); }
  100% { transform: scale(1); }
}
.chore-check-pop {
  animation: chore-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}
</style>
