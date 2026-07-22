<script setup lang="ts">
import type { CalendarOccurrence } from '#shared/schemas/events'

defineProps<{
  anchor: string // YYYY-MM-DD
  occurrences: CalendarOccurrence[]
  timezone: string
  weekStartsOn: 0 | 1
}>()

const emit = defineEmits<{
  select: [occurrence: CalendarOccurrence]
  selectDay: [date: string]
}>()
</script>

<template>
  <!-- Single-column variant of the week time grid. -->
  <CalendarWeek
    :anchor="anchor"
    :occurrences="occurrences"
    :timezone="timezone"
    :week-starts-on="weekStartsOn"
    :days="1"
    @select="emit('select', $event)"
    @select-day="emit('selectDay', $event)"
  />
</template>
