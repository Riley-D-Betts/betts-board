<script setup lang="ts">
const open = defineModel<boolean>('open', { required: true })

const props = withDefaults(defineProps<{
  title?: string
}>(), { title: undefined })

const emit = defineEmits<{ select: [scope: 'this' | 'future' | 'all'] }>()

const { t } = useI18n()

const modalTitle = computed(() => props.title ?? t('calendar.scope.title'))

const options = computed(() => [
  { scope: 'this' as const, label: t('calendar.scope.this'), icon: 'i-lucide-calendar' },
  { scope: 'future' as const, label: t('calendar.scope.future'), icon: 'i-lucide-calendar-arrow-down' },
  { scope: 'all' as const, label: t('calendar.scope.all'), icon: 'i-lucide-calendar-days' },
])

function pick(scope: 'this' | 'future' | 'all') {
  open.value = false
  emit('select', scope)
}
</script>

<template>
  <UModal v-model:open="open" :title="modalTitle">
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
