<script setup lang="ts">
const open = defineModel<boolean>('open', { required: true })

withDefaults(defineProps<{
  title?: string
}>(), { title: 'Edit recurring event' })

const emit = defineEmits<{ select: [scope: 'this' | 'future' | 'all'] }>()

const options = [
  { scope: 'this' as const, label: 'This event', icon: 'i-lucide-calendar' },
  { scope: 'future' as const, label: 'This and future events', icon: 'i-lucide-calendar-arrow-down' },
  { scope: 'all' as const, label: 'All events', icon: 'i-lucide-calendar-days' },
]

function pick(scope: 'this' | 'future' | 'all') {
  open.value = false
  emit('select', scope)
}
</script>

<template>
  <UModal v-model:open="open" :title="title">
    <template #body>
      <div class="space-y-2">
        <button
          v-for="opt in options"
          :key="opt.scope"
          type="button"
          class="flex w-full min-h-11 items-center gap-3 rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-3 text-left text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
          @click="pick(opt.scope)"
        >
          <UIcon :name="opt.icon" class="size-5 text-slate-500" />
          {{ opt.label }}
        </button>
      </div>
    </template>
  </UModal>
</template>
