<script setup lang="ts">
import type { ChoreInstance } from '#shared/schemas/chores'

const { state, activeProfile } = useBoardState()
const toast = useToast()

const canManage = computed(() =>
  activeProfile.value?.role === 'admin' || activeProfile.value?.role === 'adult')

const today = todayString()
const weekStartsOn = computed(() => state.value?.settings?.weekStartsOn ?? 0)
const weekOffset = ref(0)

const weekStart = computed(() => {
  const dow = parseDateString(today).getDay()
  const thisWeek = addDaysToDateString(today, -((dow - weekStartsOn.value + 7) % 7))
  return addDaysToDateString(thisWeek, weekOffset.value * 7)
})
const weekEnd = computed(() => addDaysToDateString(weekStart.value, 7))

const weekLabel = computed(() => {
  if (weekOffset.value === 0) return 'This week'
  if (weekOffset.value === 1) return 'Next week'
  if (weekOffset.value === -1) return 'Last week'
  const start = parseDateString(weekStart.value)
  const end = parseDateString(addDaysToDateString(weekStart.value, 6))
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return `${fmt(start)} – ${fmt(end)}`
})

const { data: board, refresh } = await useFetch('/api/chores/board', {
  query: { start: weekStart, end: weekEnd },
})

/** Today's scheduled instances plus rolled-over misses (overdue, past dueDate). */
const todayInstances = computed(() =>
  (board.value ?? []).filter(i => i.dueDate === today || i.overdue))

/** Rest of the visible week, grouped by date (today and rollovers excluded — they have their own section). */
const dayGroups = computed(() => {
  const groups = new Map<string, ChoreInstance[]>()
  for (const i of board.value ?? []) {
    if (i.dueDate === today || i.overdue) continue
    const list = groups.get(i.dueDate) ?? []
    list.push(i)
    groups.set(i.dueDate, list)
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, instances]) => ({ date, instances }))
})

function dayLabel(date: string) {
  return parseDateString(date).toLocaleDateString(undefined, {
    weekday: 'long', month: 'short', day: 'numeric',
  })
}

function canToggle(i: ChoreInstance) {
  const p = activeProfile.value
  if (!p) return false
  return p.role !== 'kid' || i.profileId === p.id
}

async function toggle(i: ChoreInstance) {
  try {
    if (i.completed) {
      await $fetch(`/api/chores/${i.choreId}/complete`, {
        method: 'DELETE',
        body: { dueDate: i.dueDate, profileId: i.profileId },
      })
    }
    else {
      await $fetch(`/api/chores/${i.choreId}/complete`, {
        method: 'POST',
        body: { dueDate: i.dueDate, profileId: i.profileId },
      })
      if (i.points > 0) {
        toast.add({
          title: `+${i.points} point${i.points === 1 ? '' : 's'} for ${i.profileName}!`,
          icon: 'i-lucide-sparkles',
          color: 'success',
        })
      }
    }
    await refresh()
  }
  catch {
    toast.add({ title: 'Could not update chore', color: 'error' })
  }
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="text-2xl md:text-3xl font-bold flex-1">Chores</h1>
      <UButton to="/chores/leaderboard" icon="i-lucide-trophy" variant="soft" color="warning">
        Leaderboard
      </UButton>
      <UButton v-if="canManage" to="/chores/manage" icon="i-lucide-pencil" variant="soft" color="neutral">
        Manage
      </UButton>
    </div>

    <!-- Week navigation -->
    <div class="flex items-center gap-1">
      <UButton icon="i-lucide-chevron-left" variant="ghost" color="neutral" aria-label="Previous week" @click="weekOffset--" />
      <span class="min-w-36 text-center font-medium">{{ weekLabel }}</span>
      <UButton icon="i-lucide-chevron-right" variant="ghost" color="neutral" aria-label="Next week" @click="weekOffset++" />
      <UButton v-if="weekOffset !== 0" variant="ghost" size="sm" @click="weekOffset = 0">Today</UButton>
    </div>

    <div v-if="!board?.length" class="text-center py-12 text-slate-500 dark:text-slate-400">
      <UIcon name="i-lucide-list-checks" class="size-10 mb-2" />
      <p>No chores this week.</p>
      <UButton v-if="canManage" to="/chores/manage" variant="soft" class="mt-3" icon="i-lucide-plus">
        Set up chores
      </UButton>
    </div>

    <template v-else>
      <!-- Today -->
      <section v-if="weekOffset === 0 && todayInstances.length" class="space-y-2">
        <h2 class="text-sm font-semibold uppercase tracking-wide text-primary">Today</h2>
        <ChoreCard
          v-for="i in todayInstances"
          :key="`${i.choreId}:${i.profileId}:${i.dueDate}`"
          :instance="i"
          :disabled="!canToggle(i)"
          @toggle="toggle(i)"
        />
      </section>

      <!-- Rest of the week -->
      <section v-for="group in dayGroups" :key="group.date" class="space-y-2">
        <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {{ dayLabel(group.date) }}
        </h2>
        <ChoreCard
          v-for="i in group.instances"
          :key="`${i.choreId}:${i.profileId}:${i.dueDate}`"
          :instance="i"
          :disabled="!canToggle(i)"
          @toggle="toggle(i)"
        />
      </section>
    </template>
  </div>
</template>
