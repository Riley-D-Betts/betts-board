<script setup lang="ts">
import type { ChoreInstance } from '#shared/schemas/chores'

const { state, activeProfile } = useBoardState()

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

const { toggle } = useChoreToggle(refresh)
useLiveRefresh(refresh)

/**
 * Same instances, grouped by who they're assigned to. A cookie (not
 * localStorage) because this page is server-rendered — a client-only store
 * would render the default on the server and swap after hydration.
 */
const groupMode = useCookie<'day' | 'person'>('betts-chores-group', { default: () => 'day' })

const personGroups = computed(() => {
  const groups = new Map<string, { profileId: string, name: string, color: string, instances: ChoreInstance[] }>()
  for (const i of board.value ?? []) {
    const group = groups.get(i.profileId)
      ?? { profileId: i.profileId, name: i.profileName, color: i.profileColor, instances: [] }
    group.instances.push(i)
    groups.set(i.profileId, group)
  }
  // Roster order, so people appear in the same order as everywhere else.
  const order = (state.value?.profiles ?? []).map(p => p.id)
  return [...groups.values()].sort((a, b) => {
    const ai = order.indexOf(a.profileId)
    const bi = order.indexOf(b.profileId)
    return (ai === -1 ? Number.MAX_SAFE_INTEGER : ai) - (bi === -1 ? Number.MAX_SAFE_INTEGER : bi)
  })
})
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

    <!-- Week navigation + grouping -->
    <div class="flex flex-wrap items-center gap-1">
      <UButton icon="i-lucide-chevron-left" variant="ghost" color="neutral" aria-label="Previous week" @click="weekOffset--" />
      <span class="min-w-36 text-center font-medium">{{ weekLabel }}</span>
      <UButton icon="i-lucide-chevron-right" variant="ghost" color="neutral" aria-label="Next week" @click="weekOffset++" />
      <UButton v-if="weekOffset !== 0" variant="ghost" size="sm" @click="weekOffset = 0">Today</UButton>

      <div class="ml-auto flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5">
        <button
          v-for="mode in (['day', 'person'] as const)"
          :key="mode"
          class="rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
          :class="groupMode === mode
            ? 'bg-primary/10 text-primary'
            : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'"
          @click="groupMode = mode"
        >
          <UIcon :name="mode === 'day' ? 'i-lucide-calendar-days' : 'i-lucide-users'" class="size-4 align-text-bottom" />
          {{ mode === 'day' ? 'By day' : 'By person' }}
        </button>
      </div>
    </div>

    <div v-if="!board?.length" class="text-center py-12 text-slate-500 dark:text-slate-400">
      <UIcon name="i-lucide-list-checks" class="size-10 mb-2" />
      <p>No chores this week.</p>
      <UButton v-if="canManage" to="/chores/manage" variant="soft" class="mt-3" icon="i-lucide-plus">
        Set up chores
      </UButton>
    </div>

    <!-- By person: the whole visible week, grouped by assignee -->
    <template v-else-if="groupMode === 'person'">
      <ChorePersonGroup
        v-for="group in personGroups"
        :key="group.profileId"
        :name="group.name"
        :color="group.color"
        :instances="group.instances"
        :can-toggle="canToggle"
        @toggle="toggle"
      />
    </template>

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
