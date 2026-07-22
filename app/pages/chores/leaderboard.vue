<script setup lang="ts">
const period = ref<'week' | 'month' | 'all'>('week')

const periods = [
  { label: 'This week', value: 'week' as const },
  { label: 'This month', value: 'month' as const },
  { label: 'All time', value: 'all' as const },
]

const { data: rows } = await useFetch('/api/chores/leaderboard', {
  query: { period },
})

// Podium slots rendered 2nd–1st–3rd so the winner stands in the middle.
const podium = computed(() => {
  const top = rows.value ?? []
  return [
    { rank: 2, medal: '🥈', height: 'h-16' },
    { rank: 1, medal: '🥇', height: 'h-24' },
    { rank: 3, medal: '🥉', height: 'h-12' },
  ].flatMap(({ rank, medal, height }) => {
    const row = top[rank - 1]
    return row ? [{ row, rank, medal, height }] : []
  })
})
</script>

<template>
  <div class="space-y-6 max-w-2xl">
    <div class="flex items-center gap-2">
      <UButton to="/chores" icon="i-lucide-arrow-left" variant="ghost" color="neutral" aria-label="Back to chores" />
      <h1 class="text-2xl md:text-3xl font-bold flex-1">Leaderboard</h1>
      <UButton to="/rewards" icon="i-lucide-gift" variant="soft" color="warning">
        Rewards store
      </UButton>
      <UIcon name="i-lucide-trophy" class="size-7 text-amber-500" />
    </div>

    <!-- Period tabs -->
    <div class="grid grid-cols-3 rounded-xl bg-slate-100 dark:bg-slate-800 p-1 gap-1">
      <button
        v-for="p in periods"
        :key="p.value"
        type="button"
        class="rounded-lg py-2.5 text-sm font-medium transition-colors"
        :class="period === p.value
          ? 'bg-white dark:bg-slate-900 text-primary shadow-sm'
          : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'"
        @click="period = p.value"
      >
        {{ p.label }}
      </button>
    </div>

    <div v-if="!rows?.length" class="text-center py-12 text-slate-500 dark:text-slate-400">
      <p>No family members yet.</p>
    </div>

    <template v-else>
      <!-- Podium -->
      <div class="flex items-end justify-center gap-4 pt-4">
        <div v-for="slot in podium" :key="slot.row.profileId" class="flex flex-col items-center gap-2 w-24">
          <span class="text-3xl">{{ slot.medal }}</span>
          <ProfileAvatar :profile="slot.row" :size="slot.rank === 1 ? 'lg' : 'md'" />
          <p class="text-sm font-semibold truncate max-w-full">{{ slot.row.name }}</p>
          <div
            class="w-full rounded-t-xl bg-gradient-to-t from-amber-200 to-amber-100 dark:from-amber-900/60 dark:to-amber-800/40 flex items-start justify-center pt-2"
            :class="slot.height"
          >
            <span class="font-bold text-amber-700 dark:text-amber-300 tabular-nums">{{ slot.row.points }}</span>
          </div>
        </div>
      </div>

      <!-- Full list -->
      <UCard>
        <ul class="divide-y divide-slate-200 dark:divide-slate-800">
          <li
            v-for="(row, i) in rows"
            :key="row.profileId"
            class="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
          >
            <span class="w-6 text-center text-sm font-bold text-slate-400 tabular-nums">{{ i + 1 }}</span>
            <ProfileAvatar :profile="row" size="sm" />
            <div class="min-w-0 flex-1">
              <p class="font-medium truncate">{{ row.name }}</p>
              <p class="text-xs text-slate-500 dark:text-slate-400">
                {{ row.completedCount }} {{ row.completedCount === 1 ? 'chore' : 'chores' }} done
              </p>
            </div>
            <span
              v-if="row.currentStreak > 0"
              class="flex items-center gap-0.5 text-sm font-semibold text-orange-500"
              :title="`${row.currentStreak}-day streak`"
            >
              <UIcon name="i-lucide-flame" class="size-4" />
              {{ row.currentStreak }}
            </span>
            <UBadge variant="soft" color="warning" class="tabular-nums">
              <UIcon name="i-lucide-star" class="size-3.5" />
              {{ row.points }}
            </UBadge>
          </li>
        </ul>
      </UCard>
    </template>
  </div>
</template>
