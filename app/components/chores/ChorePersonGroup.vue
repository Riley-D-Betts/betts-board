<!-- Chores grouped by assignee, for the "By person" view of the chore board. -->
<script setup lang="ts">
import type { ChoreInstance } from '#shared/schemas/chores'

const props = defineProps<{
  name: string
  color: string
  instances: ChoreInstance[]
  canToggle: (instance: ChoreInstance) => boolean
}>()

const emit = defineEmits<{ toggle: [instance: ChoreInstance] }>()

const doneCount = computed(() => props.instances.filter(i => i.completed).length)
const allDone = computed(() => props.instances.length > 0 && doneCount.value === props.instances.length)
const points = computed(() => props.instances
  .filter(i => i.completed)
  .reduce((sum, i) => sum + i.points, 0))

// Overdue first, then by date — the same ordering the by-day view implies.
const ordered = computed(() => [...props.instances].sort((a, b) =>
  Number(b.overdue ?? false) - Number(a.overdue ?? false)
  || a.dueDate.localeCompare(b.dueDate)))

// This view spans a whole week under one heading, so each row has to say which
// day it is — otherwise a daily chore looks like seven identical rows.
const { t } = useI18n()
const { formatWeekdayLong } = useDateFormat()
const today = todayString()
function dateLabel(date: string) {
  if (date === today) return t('common.actions.today')
  if (date === addDaysToDateString(today, 1)) return t('common.actions.tomorrow')
  return formatWeekdayLong(parseDateString(date))
}
</script>

<template>
  <section class="space-y-2">
    <div class="flex items-center gap-2">
      <ProfileAvatar :profile="{ name, color }" size="sm" />
      <h2 class="font-semibold flex-1 truncate">{{ name }}</h2>
      <UBadge v-if="points > 0" variant="soft" color="warning" class="shrink-0">
        <UIcon name="i-lucide-star" class="size-3.5" />
        {{ points }}
      </UBadge>
      <UBadge :variant="allDone ? 'solid' : 'soft'" :color="allDone ? 'success' : 'neutral'" class="shrink-0 tabular-nums">
        {{ $t('chores.doneCount', { done: doneCount, total: instances.length }) }}
      </UBadge>
    </div>

    <ChoreCard
      v-for="i in ordered"
      :key="`${i.choreId}:${i.dueDate}`"
      :instance="i"
      compact
      :date-label="dateLabel(i.dueDate)"
      :disabled="!canToggle(i)"
      @toggle="emit('toggle', i)"
    />
  </section>
</template>
