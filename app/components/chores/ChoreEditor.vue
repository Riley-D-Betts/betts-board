<script setup lang="ts">
export interface ChoreDef {
  id: string
  title: string
  description: string | null
  emoji: string | null
  points: number
  rrule: string | null
  startDate: string
  dueTime: string | null
  stacking: boolean
  assigneeProfileIds: string[]
}

const props = defineProps<{
  /** null = create a new chore. */
  chore?: ChoreDef | null
  profiles: { id: string, name: string, color: string, avatarPath?: string | null }[]
}>()

const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ saved: [] }>()

const toast = useToast()
const { state } = useBoardState()
const weekStartsOn = computed(() => state.value?.settings?.weekStartsOn ?? 0)

const EMOJIS = [
  '🧹', '🧺', '🗑️', '🍽️', '🧽', '🛏️',
  '🐕', '🐈', '🐔', '🌱', '💧', '🚿',
  '🪥', '🧸', '📚', '🎒', '🥣', '🍳',
  '🧦', '🚗', '♻️', '📬', '🛒', '🧼',
]

const form = reactive({
  title: '',
  emoji: null as string | null,
  description: '',
  points: 1,
  assigneeProfileIds: [] as string[],
  startDate: todayString(),
  dueTime: '',
  rrule: null as string | null,
  stacking: false,
})

watch(open, (isOpen) => {
  if (!isOpen) return
  form.title = props.chore?.title ?? ''
  form.emoji = props.chore?.emoji ?? null
  form.description = props.chore?.description ?? ''
  form.points = props.chore?.points ?? 1
  form.assigneeProfileIds = [...(props.chore?.assigneeProfileIds ?? [])]
  form.startDate = props.chore?.startDate ?? todayString()
  form.dueTime = props.chore?.dueTime ?? ''
  form.rrule = props.chore?.rrule ?? null
  form.stacking = props.chore?.stacking ?? false
})

function toggleAssignee(id: string) {
  const i = form.assigneeProfileIds.indexOf(id)
  if (i === -1) form.assigneeProfileIds.push(id)
  else form.assigneeProfileIds.splice(i, 1)
}

const valid = computed(() =>
  form.title.trim().length > 0
  && form.assigneeProfileIds.length > 0
  && /^\d{4}-\d{2}-\d{2}$/.test(form.startDate))

const busy = ref(false)

async function save() {
  if (!valid.value) return
  busy.value = true
  const body = {
    title: form.title.trim(),
    emoji: form.emoji,
    description: form.description.trim() || null,
    points: form.points,
    rrule: form.rrule,
    startDate: form.startDate,
    dueTime: form.dueTime || null,
    stacking: form.stacking,
    assigneeProfileIds: form.assigneeProfileIds,
  }
  try {
    if (props.chore) {
      await $fetch(`/api/chores/${props.chore.id}`, { method: 'PATCH', body })
    }
    else {
      await $fetch('/api/chores', { method: 'POST', body })
    }
    open.value = false
    emit('saved')
  }
  catch {
    toast.add({ title: 'Could not save chore', color: 'error' })
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" :title="chore ? 'Edit chore' : 'New chore'">
    <template #body>
      <div class="space-y-4">
        <UFormField label="Title">
          <UInput v-model="form.title" placeholder="Feed the chickens" class="w-full" size="lg" autofocus />
        </UFormField>

        <EmojiField v-model="form.emoji" :presets="EMOJIS" />

        <UFormField label="Description" hint="optional">
          <UTextarea v-model="form.description" :rows="2" class="w-full" />
        </UFormField>

        <UFormField label="Points">
          <div class="flex items-center gap-3">
            <UButton
              icon="i-lucide-minus"
              variant="soft"
              color="neutral"
              size="lg"
              :disabled="form.points <= 0"
              @click="form.points = Math.max(0, form.points - 1)"
            />
            <span class="w-10 text-center text-xl font-bold tabular-nums">{{ form.points }}</span>
            <UButton
              icon="i-lucide-plus"
              variant="soft"
              color="neutral"
              size="lg"
              :disabled="form.points >= 1000"
              @click="form.points = Math.min(1000, form.points + 1)"
            />
          </div>
        </UFormField>

        <UFormField label="Who does it" :error="form.assigneeProfileIds.length === 0 ? 'Pick at least one person' : undefined">
          <div class="flex flex-wrap gap-2">
            <button
              v-for="p in profiles"
              :key="p.id"
              type="button"
              class="flex items-center gap-2 rounded-full border-2 pl-1 pr-3 py-1 transition-colors"
              :class="form.assigneeProfileIds.includes(p.id)
                ? 'border-primary bg-primary/10'
                : 'border-slate-200 dark:border-slate-700 hover:border-slate-400'"
              @click="toggleAssignee(p.id)"
            >
              <ProfileAvatar :profile="p" size="sm" />
              <span class="text-sm font-medium">{{ p.name }}</span>
            </button>
          </div>
        </UFormField>

        <div class="grid grid-cols-2 gap-3">
          <UFormField label="Starts">
            <UInput v-model="form.startDate" type="date" class="w-full" />
          </UFormField>
          <UFormField label="Due by" hint="optional">
            <UInput v-model="form.dueTime" type="time" class="w-full" />
          </UFormField>
        </div>

        <UFormField label="Repeats">
          <RecurrenceEditor
            v-model="form.rrule"
            :start-date="form.startDate"
            :week-starts-on="weekStartsOn"
          />
        </UFormField>

        <UFormField
          label="Stacking"
          :help="form.stacking
            ? 'Missed days pile up — two skipped days means two chores'
            : 'Missed days merge into one'"
        >
          <USwitch v-model="form.stacking" />
        </UFormField>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton variant="ghost" color="neutral" @click="open = false">Cancel</UButton>
        <UButton :disabled="!valid" :loading="busy" @click="save">
          {{ chore ? 'Save changes' : 'Add chore' }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
