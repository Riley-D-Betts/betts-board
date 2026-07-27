<script setup lang="ts">
import { DateTime } from 'luxon'
import { machineFormat } from '#shared/utils/machineFormat'
import type { BoardProfile } from '~/composables/useBoardState'
import type { EditPayload } from './calendarTypes'

const props = defineProps<{
  timezone: string
  weekStartsOn: 0 | 1
  profiles: BoardProfile[]
  /** null → create mode. */
  editing: EditPayload | null
  /** Default date for new events (YYYY-MM-DD). */
  defaultDate: string
}>()

const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ saved: [] }>()

const toast = useToast()
const { t } = useI18n()

const COLORS = ['#3b82f6', '#ec4899', '#22c55e', '#f97316', '#a855f7', '#14b8a6', '#eab308', '#ef4444']
const REMINDER_ITEMS = computed(() => [
  { label: t('calendar.editor.reminders.none'), value: 0 },
  { label: t('calendar.editor.reminders.min5'), value: 5 },
  { label: t('calendar.editor.reminders.min15'), value: 15 },
  { label: t('calendar.editor.reminders.min30'), value: 30 },
  { label: t('calendar.editor.reminders.hour1'), value: 60 },
  { label: t('calendar.editor.reminders.day1'), value: 1440 },
])

const form = reactive({
  title: '',
  isAllDay: false,
  startLocal: '', // yyyy-MM-ddTHH:mm in household wall time
  endLocal: '',
  startDate: '', // all-day, YYYY-MM-DD
  endDateIncl: '', // shown inclusive; sent exclusive (+1 day)
  location: '',
  description: '',
  attendeeProfileIds: [] as string[],
  color: null as string | null,
  reminder: 0,
  rrule: null as string | null,
})

const busy = ref(false)
const confirmingDelete = ref(false)

const isEdit = computed(() => !!props.editing)
const scope = computed(() => props.editing?.scope ?? 'all')
/** Scope 'this' exceptions only carry time/title/location/description. */
const limitedFields = computed(() => scope.value === 'this')

function msToLocal(ms: number) {
  // Machine format: this is an <input type="datetime-local"> value.
  return machineFormat(DateTime.fromMillis(ms, { zone: props.timezone }), "yyyy-MM-dd'T'HH:mm")
}
function localToMs(local: string) {
  return DateTime.fromISO(local, { zone: props.timezone }).toMillis()
}
function toMs(v: string | number | null): number | null {
  if (v == null) return null
  return typeof v === 'number' ? v : new Date(v).getTime()
}

function initCreate() {
  const date = props.defaultDate
  form.title = ''
  form.isAllDay = false
  form.startLocal = `${date}T09:00`
  form.endLocal = `${date}T10:00`
  form.startDate = date
  form.endDateIncl = date
  form.location = ''
  form.description = ''
  form.attendeeProfileIds = []
  form.color = null
  form.reminder = 0
  form.rrule = null
}

function initEdit(edit: EditPayload) {
  const { master, occurrence, occurrenceStart } = edit
  form.title = occurrence.title
  form.location = occurrence.location ?? ''
  form.description = occurrence.description ?? ''
  form.isAllDay = master.isAllDay
  form.attendeeProfileIds = [...master.attendeeProfileIds]
  form.color = master.color
  form.reminder = master.reminderMinutes?.[0] ?? 0
  form.rrule = edit.scope === 'future' ? master.rrule : (edit.scope === 'all' ? master.rrule : null)

  if (master.isAllDay) {
    if (edit.scope === 'all') {
      form.startDate = master.startDate!
      form.endDateIncl = addDaysToDateString(master.endDate!, -1)
    }
    else {
      // this/future anchor on the tapped occurrence's date
      form.startDate = occurrence.startDate!
      form.endDateIncl = addDaysToDateString(occurrence.endDate!, -1)
    }
    return
  }

  const masterStart = toMs(master.startAt)!
  const masterEnd = toMs(master.endAt)!
  const duration = masterEnd - masterStart
  if (edit.scope === 'all') {
    form.startLocal = msToLocal(masterStart)
    form.endLocal = msToLocal(masterEnd)
  }
  else if (edit.scope === 'this') {
    // Current (possibly already-modified) times of this occurrence.
    form.startLocal = msToLocal(occurrence.start)
    form.endLocal = msToLocal(occurrence.end)
  }
  else {
    // future: the split starts at the tapped occurrence's original instant.
    form.startLocal = msToLocal(occurrenceStart)
    form.endLocal = msToLocal(occurrenceStart + duration)
  }
}

// Suppress the keep-duration watchers while init sets both fields at once.
let initializing = false
watch(open, (v) => {
  if (!v) return
  confirmingDelete.value = false
  initializing = true
  if (props.editing) initEdit(props.editing)
  else initCreate()
  nextTick(() => { initializing = false })
})

// Keep the duration when the start moves.
watch(() => form.startLocal, (next, prev) => {
  if (initializing || !prev || !next || !form.endLocal) return
  const delta = localToMs(next) - localToMs(prev)
  if (delta) form.endLocal = msToLocal(localToMs(form.endLocal) + delta)
})
watch(() => form.startDate, (next, prev) => {
  if (initializing || !prev || !next || !form.endDateIncl) return
  const delta = dateStringDiffDays(next, prev)
  if (delta) form.endDateIncl = addDaysToDateString(form.endDateIncl, delta)
})

const valid = computed(() => {
  if (!form.title.trim()) return false
  if (form.isAllDay) return !!form.startDate && !!form.endDateIncl && form.endDateIncl >= form.startDate
  return !!form.startLocal && !!form.endLocal && localToMs(form.endLocal) > localToMs(form.startLocal)
})

function buildChanges() {
  const base = {
    title: form.title.trim(),
    description: form.description.trim() || null,
    location: form.location.trim() || null,
  }
  if (limitedFields.value) {
    // Exceptions support only time + text overrides.
    if (form.isAllDay) return base
    return { ...base, startAt: localToMs(form.startLocal), endAt: localToMs(form.endLocal) }
  }
  return {
    ...base,
    isAllDay: form.isAllDay,
    startAt: form.isAllDay ? null : localToMs(form.startLocal),
    endAt: form.isAllDay ? null : localToMs(form.endLocal),
    startDate: form.isAllDay ? form.startDate : null,
    endDate: form.isAllDay ? addDaysToDateString(form.endDateIncl, 1) : null,
    timezone: props.timezone,
    rrule: form.rrule,
    reminderMinutes: form.reminder > 0 ? [form.reminder] : null,
    color: form.color,
    attendeeProfileIds: form.attendeeProfileIds,
  }
}

async function save() {
  if (!valid.value) return
  busy.value = true
  try {
    if (props.editing) {
      await $fetch(`/api/events/${props.editing.occurrence.eventId}`, {
        method: 'PATCH',
        body: {
          scope: scope.value,
          ...(scope.value !== 'all' ? { occurrenceStart: props.editing.occurrenceStart } : {}),
          changes: buildChanges(),
        },
      })
    }
    else {
      await $fetch('/api/events', { method: 'POST', body: buildChanges() })
    }
    open.value = false
    emit('saved')
    toast.add({ title: props.editing ? t('calendar.editor.toast.updated') : t('calendar.editor.toast.added'), color: 'success' })
  }
  catch (err: unknown) {
    const msg = (err as { data?: { message?: string } })?.data?.message ?? t('calendar.editor.toast.couldNotSave')
    toast.add({ title: msg, color: 'error' })
  }
  finally {
    busy.value = false
  }
}

async function remove() {
  if (!props.editing) return
  if (!confirmingDelete.value) {
    confirmingDelete.value = true
    return
  }
  busy.value = true
  try {
    await $fetch(`/api/events/${props.editing.occurrence.eventId}`, {
      method: 'DELETE',
      body: {
        scope: scope.value,
        ...(scope.value !== 'all' ? { occurrenceStart: props.editing.occurrenceStart } : {}),
      },
    })
    open.value = false
    emit('saved')
    toast.add({ title: t('calendar.editor.toast.deleted'), color: 'success' })
  }
  catch {
    toast.add({ title: t('calendar.editor.toast.couldNotDelete'), color: 'error' })
  }
  finally {
    busy.value = false
  }
}

function toggleAttendee(id: string) {
  const i = form.attendeeProfileIds.indexOf(id)
  if (i === -1) form.attendeeProfileIds.push(id)
  else form.attendeeProfileIds.splice(i, 1)
}

const modalTitle = computed(() => {
  if (!isEdit.value) return t('calendar.editor.titleNew')
  return {
    all: t('calendar.editor.titleAll'),
    this: t('calendar.editor.titleThis'),
    future: t('calendar.editor.titleFuture'),
  }[scope.value]
})
</script>

<template>
  <UModal v-model:open="open" :title="modalTitle">
    <template #body>
      <div class="space-y-4">
        <p v-if="limitedFields" class="rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-xs text-slate-600 dark:text-slate-300">
          {{ $t('calendar.editor.limitedHint') }}
        </p>

        <UFormField :label="$t('calendar.editor.eventTitle')">
          <UInput v-model="form.title" :placeholder="$t('calendar.editor.eventTitlePlaceholder')" class="w-full" size="lg" />
        </UFormField>

        <div v-if="!limitedFields" class="flex min-h-11 items-center justify-between">
          <span class="text-sm font-medium">{{ $t('calendar.allDay') }}</span>
          <USwitch v-model="form.isAllDay" />
        </div>

        <template v-if="form.isAllDay">
          <div v-if="!limitedFields" class="grid grid-cols-2 gap-3">
            <UFormField :label="$t('calendar.editor.starts')">
              <UInput v-model="form.startDate" type="date" class="w-full" />
            </UFormField>
            <UFormField :label="$t('calendar.editor.ends')">
              <UInput v-model="form.endDateIncl" type="date" :min="form.startDate" class="w-full" />
            </UFormField>
          </div>
        </template>
        <template v-else>
          <UFormField :label="$t('calendar.editor.starts')">
            <UInput v-model="form.startLocal" type="datetime-local" class="w-full" />
          </UFormField>
          <UFormField :label="$t('calendar.editor.ends')" :error="form.startLocal && form.endLocal && localToMs(form.endLocal) <= localToMs(form.startLocal) ? $t('calendar.editor.endBeforeStart') : undefined">
            <UInput v-model="form.endLocal" type="datetime-local" class="w-full" />
          </UFormField>
        </template>

        <UFormField :label="$t('calendar.editor.location')">
          <UInput v-model="form.location" :placeholder="$t('calendar.editor.optionalPlaceholder')" icon="i-lucide-map-pin" class="w-full" />
        </UFormField>

        <UFormField :label="$t('calendar.editor.notes')">
          <UTextarea v-model="form.description" :rows="2" :placeholder="$t('calendar.editor.optionalPlaceholder')" class="w-full" />
        </UFormField>

        <template v-if="!limitedFields">
          <UFormField :label="$t('calendar.editor.attendees')">
            <div class="flex flex-wrap gap-2">
              <button
                v-for="p in profiles"
                :key="p.id"
                type="button"
                class="flex min-h-11 items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors"
                :class="form.attendeeProfileIds.includes(p.id)
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'"
                @click="toggleAttendee(p.id)"
              >
                <ProfileAvatar :profile="p" size="sm" />
                {{ p.name }}
              </button>
            </div>
          </UFormField>

          <UFormField :label="$t('calendar.editor.repeats')">
            <RecurrenceEditor
              v-model="form.rrule"
              :start-date="form.isAllDay ? form.startDate : form.startLocal.slice(0, 10)"
              :week-starts-on="weekStartsOn"
            />
          </UFormField>

          <UFormField v-if="!form.isAllDay" :label="$t('calendar.editor.reminder')">
            <USelect v-model="form.reminder" :items="REMINDER_ITEMS" class="w-full" />
          </UFormField>

          <UFormField :label="$t('calendar.editor.color')" :help="$t('calendar.editor.colorHelp')">
            <div class="flex flex-wrap items-center gap-2">
              <button
                type="button"
                class="flex h-8 items-center rounded-full border px-3 text-xs font-medium"
                :class="form.color === null
                  ? 'border-primary text-primary bg-primary/10'
                  : 'border-slate-200 dark:border-slate-700 text-slate-500'"
                @click="form.color = null"
              >
                {{ $t('calendar.editor.colorAuto') }}
              </button>
              <button
                v-for="c in COLORS"
                :key="c"
                type="button"
                class="size-8 rounded-full transition-transform"
                :class="form.color === c ? 'ring-2 ring-offset-2 ring-slate-400 dark:ring-offset-slate-900 scale-110' : ''"
                :style="{ backgroundColor: c }"
                :aria-label="$t('calendar.editor.colorSwatch', { color: c })"
                @click="form.color = c"
              />
            </div>
          </UFormField>
        </template>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full items-center gap-2">
        <UButton
          v-if="isEdit"
          :color="confirmingDelete ? 'error' : 'neutral'"
          variant="ghost"
          icon="i-lucide-trash-2"
          :loading="busy && confirmingDelete"
          @click="remove"
        >
          {{ confirmingDelete ? $t('calendar.editor.confirmDelete') : $t('common.actions.delete') }}
        </UButton>
        <div class="flex-1" />
        <UButton variant="ghost" color="neutral" @click="open = false">{{ $t('common.actions.cancel') }}</UButton>
        <UButton :disabled="!valid" :loading="busy && !confirmingDelete" @click="save">
          {{ isEdit ? $t('common.actions.save') : $t('calendar.actions.addEvent') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
