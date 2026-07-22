<!-- Dashboard tile: my chores due today. -->
<script setup lang="ts">
import type { ChoreInstance } from '#shared/schemas/chores'

const { activeProfile } = useBoardState()
const toast = useToast()

const today = todayString()
const { data: board, refresh } = await useFetch('/api/chores/board', {
  query: { start: today, end: addDaysToDateString(today, 1) },
})

const mine = computed(() =>
  (board.value ?? []).filter(i => i.profileId === activeProfile.value?.id))
const doneCount = computed(() => mine.value.filter(i => i.completed).length)

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
          title: `+${i.points} point${i.points === 1 ? '' : 's'}!`,
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
  <UCard>
    <template #header>
      <NuxtLink to="/chores" class="flex items-center gap-2 font-semibold">
        <UIcon name="i-lucide-list-checks" class="text-primary size-5" />
        <span class="flex-1">Chores</span>
        <span v-if="mine.length" class="text-xs font-normal text-slate-500 dark:text-slate-400">
          {{ doneCount }}/{{ mine.length }} done
        </span>
        <UIcon name="i-lucide-chevron-right" class="size-4 text-slate-400" />
      </NuxtLink>
    </template>

    <p v-if="!activeProfile" class="text-sm text-slate-500 dark:text-slate-400">
      Choose a profile to see your chores.
    </p>
    <p v-else-if="!mine.length" class="text-sm text-slate-500 dark:text-slate-400">
      Nothing due today — enjoy! 🎉
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
