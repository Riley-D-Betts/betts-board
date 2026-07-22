<script setup lang="ts">
import type { ChoreDef } from '~/components/chores/ChoreEditor.vue'

const { activeProfile } = useBoardState()
const toast = useToast()

const canManage = computed(() =>
  activeProfile.value?.role === 'admin' || activeProfile.value?.role === 'adult')

const { data: choreList, refresh } = await useFetch('/api/chores')
const { data: profileList } = await useFetch('/api/profiles')

const editorOpen = ref(false)
const editing = ref<ChoreDef | null>(null)

function openCreate() {
  editing.value = null
  editorOpen.value = true
}

function openEdit(chore: ChoreDef) {
  editing.value = chore
  editorOpen.value = true
}

async function archive(chore: ChoreDef) {
  if (!confirm(`Remove "${chore.title}"? Earned points are kept.`)) return
  try {
    await $fetch(`/api/chores/${chore.id}`, { method: 'DELETE' })
    await refresh()
  }
  catch {
    toast.add({ title: 'Could not remove chore', color: 'error' })
  }
}

function assigneeProfiles(chore: ChoreDef) {
  return (profileList.value ?? []).filter(p => chore.assigneeProfileIds.includes(p.id))
}
</script>

<template>
  <div class="space-y-6 max-w-2xl">
    <div class="flex items-center gap-2">
      <UButton to="/chores" icon="i-lucide-arrow-left" variant="ghost" color="neutral" aria-label="Back to chores" />
      <h1 class="text-2xl md:text-3xl font-bold flex-1">Manage chores</h1>
      <UButton v-if="canManage" icon="i-lucide-plus" @click="openCreate">New chore</UButton>
    </div>

    <div v-if="!canManage" class="text-center py-12 text-slate-500 dark:text-slate-400">
      <UIcon name="i-lucide-lock" class="size-8 mb-2" />
      <p>Ask a grown-up to change the chore list.</p>
    </div>

    <template v-else>
      <div v-if="!choreList?.length" class="text-center py-12 text-slate-500 dark:text-slate-400">
        <UIcon name="i-lucide-list-checks" class="size-10 mb-2" />
        <p>No chores yet — add the first one.</p>
      </div>

      <div v-else class="space-y-2">
        <div
          v-for="chore in choreList"
          :key="chore.id"
          class="flex items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2"
        >
          <span class="text-2xl w-9 text-center shrink-0">{{ chore.emoji ?? '🧹' }}</span>
          <button type="button" class="min-w-0 flex-1 text-left py-2" @click="openEdit(chore)">
            <p class="font-medium truncate">{{ chore.title }}</p>
            <p class="text-xs text-slate-500 dark:text-slate-400 truncate">
              {{ recurrenceText(chore.rrule) }}<template v-if="chore.dueTime"> · by {{ chore.dueTime }}</template>
            </p>
          </button>
          <div class="flex -space-x-2 shrink-0">
            <ProfileAvatar
              v-for="p in assigneeProfiles(chore)"
              :key="p.id"
              :profile="p"
              size="sm"
              class="ring-2 ring-white dark:ring-slate-900 rounded-full"
            />
          </div>
          <UBadge variant="soft" color="warning" class="shrink-0 tabular-nums">
            <UIcon name="i-lucide-star" class="size-3.5" />
            {{ chore.points }}
          </UBadge>
          <UButton
            icon="i-lucide-trash-2"
            variant="ghost"
            color="neutral"
            size="sm"
            :aria-label="`Remove ${chore.title}`"
            @click="archive(chore)"
          />
        </div>
      </div>

      <ChoreEditor
        v-model:open="editorOpen"
        :chore="editing"
        :profiles="profileList ?? []"
        @saved="refresh()"
      />
    </template>
  </div>
</template>
