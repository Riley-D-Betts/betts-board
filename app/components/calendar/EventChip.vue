<script setup lang="ts">
import { DateTime } from 'luxon'
import type { CalendarOccurrence } from '#shared/schemas/events'

const props = withDefaults(defineProps<{
  occurrence: CalendarOccurrence
  timezone: string
  /** compact = one-line month-cell chip; row = taller agenda/list row */
  variant?: 'compact' | 'row'
  showTime?: boolean
}>(), { variant: 'compact', showTime: true })

defineEmits<{ select: [occurrence: CalendarOccurrence] }>()

const { t } = useI18n()

const timeLabel = computed(() => {
  if (props.occurrence.isAllDay) return t('calendar.allDay')
  const start = DateTime.fromMillis(props.occurrence.start, { zone: props.timezone })
  if (props.variant === 'compact') return start.toFormat('h:mm')
  const end = DateTime.fromMillis(props.occurrence.end, { zone: props.timezone })
  return `${start.toFormat('h:mm a')} – ${end.toFormat('h:mm a')}`
})
</script>

<template>
  <button
    v-if="variant === 'compact'"
    type="button"
    class="flex w-full min-w-0 items-center gap-1 rounded px-1 py-0.5 text-left text-[11px] leading-4 hover:bg-slate-100 dark:hover:bg-slate-800"
    @click.stop="$emit('select', occurrence)"
  >
    <span class="size-2 shrink-0 rounded-full" :style="{ backgroundColor: occurrence.color }" />
    <span v-if="showTime && !occurrence.isAllDay" class="shrink-0 tabular-nums text-slate-500 dark:text-slate-400">{{ timeLabel }}</span>
    <UIcon v-if="occurrence.kind === 'meal'" name="i-lucide-chef-hat" class="size-3 shrink-0 text-slate-500 dark:text-slate-400" />
    <span class="truncate font-medium">{{ occurrence.title }}</span>
  </button>

  <button
    v-else
    type="button"
    class="flex w-full min-h-11 items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
    @click.stop="$emit('select', occurrence)"
  >
    <span class="w-1.5 self-stretch shrink-0 rounded-full" :style="{ backgroundColor: occurrence.color }" />
    <div class="min-w-0 flex-1">
      <p class="truncate text-sm font-medium">
        <UIcon v-if="occurrence.kind === 'meal'" name="i-lucide-chef-hat" class="inline size-3.5 text-slate-500 dark:text-slate-400 align-middle" />
        {{ occurrence.title }}
        <UIcon v-if="occurrence.hasRecurrence" name="i-lucide-repeat" class="inline size-3 text-slate-400 align-middle" />
        <UIcon v-if="occurrence.readonly && occurrence.kind !== 'meal'" name="i-lucide-rss" class="inline size-3 text-slate-400 align-middle" />
      </p>
      <p class="text-xs text-slate-500 dark:text-slate-400">
        {{ timeLabel }}<span v-if="occurrence.location" class="truncate"> · {{ occurrence.location }}</span>
      </p>
    </div>
    <div v-if="occurrence.attendees.length" class="flex shrink-0 -space-x-1">
      <span
        v-for="a in occurrence.attendees.slice(0, 4)"
        :key="a.profileId"
        class="size-3 rounded-full ring-2 ring-white dark:ring-slate-900"
        :style="{ backgroundColor: a.color }"
        :title="a.name"
      />
    </div>
  </button>
</template>
