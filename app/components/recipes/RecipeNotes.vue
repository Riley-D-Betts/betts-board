<script setup lang="ts">
const props = defineProps<{
  recipeId: string
  notes: Array<{
    id: string
    body: string
    createdAt: string | Date
    author: { id: string, name: string, color: string, avatarPath: string | null } | null
  }>
}>()

const emit = defineEmits<{ changed: [] }>()

const { activeProfile, isAdmin } = useBoardState()
const toast = useToast()
const { t } = useI18n()

const draft = ref('')
const saving = ref(false)

function canDelete(note: { author: { id: string } | null }) {
  return isAdmin.value || (note.author && note.author.id === activeProfile.value?.id)
}

function timeAgo(value: string | Date) {
  const then = new Date(value).getTime()
  const mins = Math.round((Date.now() - then) / 60_000)
  if (mins < 1) return t('recipes.notes.justNow')
  if (mins < 60) return t('recipes.notes.minutesAgo', { n: mins })
  const hours = Math.round(mins / 60)
  if (hours < 24) return t('recipes.notes.hoursAgo', { n: hours })
  const days = Math.round(hours / 24)
  if (days < 30) return t('recipes.notes.daysAgo', { n: days })
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

async function addNote() {
  const body = draft.value.trim()
  if (!body) return
  saving.value = true
  try {
    await $fetch(`/api/recipes/${props.recipeId}/notes`, { method: 'POST', body: { body } })
    draft.value = ''
    emit('changed')
  }
  catch {
    toast.add({ title: t('recipes.notes.couldNotAdd'), color: 'error' })
  }
  finally {
    saving.value = false
  }
}

async function removeNote(noteId: string) {
  if (!confirm(t('recipes.notes.confirmDelete'))) return
  try {
    await $fetch(`/api/recipes/${props.recipeId}/notes/${noteId}`, { method: 'DELETE' })
    emit('changed')
  }
  catch {
    toast.add({ title: t('recipes.notes.couldNotDelete'), color: 'error' })
  }
}
</script>

<template>
  <section class="space-y-4">
    <h2 class="text-lg font-semibold flex items-center gap-2">
      <UIcon name="i-lucide-message-square" class="size-5" />
      {{ $t('recipes.notes.title') }}
    </h2>

    <p v-if="!notes.length" class="text-sm text-slate-500 dark:text-slate-400">
      {{ $t('recipes.notes.empty') }}
    </p>

    <div v-else class="space-y-3">
      <div
        v-for="note in notes"
        :key="note.id"
        class="flex items-start gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3"
      >
        <ProfileAvatar
          :profile="note.author ?? { name: '?', color: '#94a3b8' }"
          size="sm"
        />
        <div class="min-w-0 flex-1">
          <p class="text-xs text-slate-500 dark:text-slate-400">
            <span class="font-medium text-slate-700 dark:text-slate-200">{{ note.author?.name ?? $t('recipes.notes.unknownAuthor') }}</span>
            · {{ timeAgo(note.createdAt) }}
          </p>
          <p class="mt-0.5 whitespace-pre-wrap break-words">{{ note.body }}</p>
        </div>
        <UButton
          v-if="canDelete(note)"
          icon="i-lucide-trash-2"
          variant="ghost"
          color="neutral"
          size="sm"
          :aria-label="$t('recipes.notes.deleteAria')"
          @click="removeNote(note.id)"
        />
      </div>
    </div>

    <div class="flex items-end gap-2">
      <UTextarea
        v-model="draft"
        :placeholder="$t('recipes.notes.placeholder')"
        :rows="2"
        autoresize
        class="flex-1"
        @keydown.meta.enter="addNote"
      />
      <UButton
        icon="i-lucide-send"
        :loading="saving"
        :disabled="!draft.trim()"
        :aria-label="$t('recipes.notes.addAria')"
        @click="addNote"
      />
    </div>
  </section>
</template>
