<!-- Dashboard tile: my chores due today. -->
<script setup lang="ts">

const { activeProfile } = useBoardState()

const today = todayString()
const { data: board, refresh } = await useFetch('/api/chores/board', {
  query: { start: today, end: addDaysToDateString(today, 1) },
})

const mine = computed(() =>
  (board.value ?? []).filter(i => i.profileId === activeProfile.value?.id))
const doneCount = computed(() => mine.value.filter(i => i.completed).length)

const { toggle } = useChoreToggle(refresh)
useLiveRefresh(refresh)
</script>

<template>
  <UCard>
    <template #header>
      <NuxtLink to="/chores" class="flex items-center gap-2 font-semibold">
        <UIcon name="i-lucide-list-checks" class="text-primary size-5" />
        <span class="flex-1">{{ $t('chores.title') }}</span>
        <span v-if="mine.length" class="text-xs font-normal text-slate-500 dark:text-slate-400">
          {{ $t('chores.tile.doneSummary', { done: doneCount, total: mine.length }) }}
        </span>
        <UIcon name="i-lucide-chevron-right" class="size-4 text-slate-400" />
      </NuxtLink>
    </template>

    <p v-if="!activeProfile" class="text-sm text-slate-500 dark:text-slate-400">
      {{ $t('chores.tile.chooseProfile') }}
    </p>
    <p v-else-if="!mine.length" class="text-sm text-slate-500 dark:text-slate-400">
      {{ $t('chores.noneToday') }}
    </p>
    <div v-else class="space-y-2">
      <ChoreCard
        v-for="i in mine"
        :key="`${i.choreId}:${i.dueDate}`"
        :instance="i"
        compact
        @toggle="toggle(i)"
      />
    </div>
  </UCard>
</template>
