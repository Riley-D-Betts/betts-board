<!-- Compact picker: who's cooking this planned meal? Emits the chosen profile
     id (or null for "No cook") — the parent owns the PATCH. -->
<script setup lang="ts">
const props = defineProps<{
  /** Currently assigned cook, if any. */
  cookProfileId?: string | null
  /** Meal label for the modal title, e.g. the recipe title or free text. */
  mealLabel?: string | null
}>()

const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ pick: [cookProfileId: string | null] }>()

const { state } = useBoardState()
const profiles = computed(() => state.value?.profiles ?? [])

const title = computed(() => props.mealLabel ? `Who's cooking ${props.mealLabel}?` : `Who's cooking?`)

function pick(id: string | null) {
  emit('pick', id)
  open.value = false
}
</script>

<template>
  <UModal v-model:open="open" :title="title">
    <template #body>
      <div class="divide-y divide-slate-200 dark:divide-slate-700 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
        <button
          v-for="p in profiles"
          :key="p.id"
          type="button"
          class="flex w-full min-h-12 items-center gap-3 px-3 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
          @click="pick(p.id)"
        >
          <ProfileAvatar :profile="p" size="sm" />
          <span class="min-w-0 flex-1 truncate text-sm font-medium">{{ p.name }}</span>
          <UIcon
            v-if="p.id === cookProfileId"
            name="i-lucide-check"
            class="size-4 shrink-0 text-primary"
          />
        </button>
        <button
          type="button"
          class="flex w-full min-h-12 items-center gap-3 px-3 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
          @click="pick(null)"
        >
          <span class="grid size-7 shrink-0 place-items-center rounded-full bg-slate-100 dark:bg-slate-800">
            <UIcon name="i-lucide-chef-hat" class="size-4 text-slate-400" />
          </span>
          <span class="min-w-0 flex-1 truncate text-sm text-slate-600 dark:text-slate-300">No cook</span>
          <UIcon
            v-if="!cookProfileId"
            name="i-lucide-check"
            class="size-4 shrink-0 text-primary"
          />
        </button>
      </div>
    </template>
  </UModal>
</template>
