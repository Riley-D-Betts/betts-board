<script setup lang="ts">
import { DateTime } from 'luxon'
import type { CalendarOccurrence } from '#shared/schemas/events'
import type { CalendarView } from '~/composables/useCalendarRange'
import type { EditPayload, EventMaster } from '~/components/calendar/calendarTypes'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { state } = useBoardState()

const timezone = computed(() => state.value?.timezone ?? 'UTC')
const weekStartsOn = computed<0 | 1>(() => state.value?.settings?.weekStartsOn ?? 0)
const profiles = computed(() => state.value?.profiles ?? [])

const VIEWS: CalendarView[] = ['month', 'week', 'day', 'agenda']
const viewItems = [
  { value: 'month', label: 'Month', icon: 'i-lucide-calendar' },
  { value: 'week', label: 'Week', icon: 'i-lucide-calendar-range' },
  { value: 'day', label: 'Day', icon: 'i-lucide-calendar-1' },
  { value: 'agenda', label: 'Agenda', icon: 'i-lucide-list' },
] as const

const view = computed<CalendarView>({
  get: () => VIEWS.includes(route.query.view as CalendarView) ? route.query.view as CalendarView : 'month',
  set: v => router.replace({ query: { ...route.query, view: v } }),
})

const anchor = computed<string>({
  get: () => {
    const d = route.query.date
    if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d
    return DateTime.now().setZone(timezone.value).toISODate()!
  },
  set: d => router.replace({ query: { ...route.query, date: d } }),
})

// Phones default to the agenda view.
onMounted(() => {
  if (!route.query.view && window.innerWidth < 640) view.value = 'agenda'
})

const { range, title, prev, next, today } = useCalendarRange({ view, anchor, timezone, weekStartsOn })

// Member filter
const selectedProfileIds = ref<string[]>([])
function toggleProfileFilter(id: string) {
  const i = selectedProfileIds.value.indexOf(id)
  if (i === -1) selectedProfileIds.value.push(id)
  else selectedProfileIds.value.splice(i, 1)
}

const { data: occurrences, refresh } = await useFetch<CalendarOccurrence[]>('/api/calendar', {
  query: computed(() => ({
    start: range.value.startMs,
    end: range.value.endMs,
    ...(selectedProfileIds.value.length ? { profileIds: selectedProfileIds.value.join(',') } : {}),
  })),
  default: () => [],
})

// ---- occurrence tap flow ----

const editorOpen = ref(false)
const editing = ref<EditPayload | null>(null)
const scopeOpen = ref(false)
const pendingOcc = ref<CalendarOccurrence | null>(null)
const detailOpen = ref(false)
const detailOcc = ref<CalendarOccurrence | null>(null)
const detailFeedName = ref<string | null>(null)

function parseOccurrenceId(occurrenceId: string) {
  // "eventId:originalStartMs" — the id itself contains dashes/colons never,
  // but split on the LAST colon to be safe.
  const i = occurrenceId.lastIndexOf(':')
  return { eventId: occurrenceId.slice(0, i), originalMs: Number(occurrenceId.slice(i + 1)) }
}

async function onSelect(occ: CalendarOccurrence) {
  if (occ.readonly) {
    detailOcc.value = occ
    detailFeedName.value = null
    detailOpen.value = true
    if (occ.kind !== 'meal') { // cooking blocks have no event master to fetch
      try {
        const master = await $fetch<EventMaster>(`/api/events/${occ.eventId}`)
        detailFeedName.value = master.feedName
      }
      catch { /* hint stays generic */ }
    }
    return
  }
  if (occ.hasRecurrence) {
    pendingOcc.value = occ
    scopeOpen.value = true
    return
  }
  await openEditor(occ, 'all')
}

async function openEditor(occ: CalendarOccurrence, scope: 'all' | 'this' | 'future') {
  try {
    const master = await $fetch<EventMaster>(`/api/events/${occ.eventId}`)
    editing.value = {
      scope,
      occurrence: occ,
      occurrenceStart: parseOccurrenceId(occ.occurrenceId).originalMs,
      master,
    }
    editorOpen.value = true
  }
  catch {
    toast.add({ title: 'Could not load event', color: 'error' })
  }
}

function onScopePicked(scope: 'this' | 'future' | 'all') {
  if (pendingOcc.value) openEditor(pendingOcc.value, scope)
}

function openCreate() {
  editing.value = null
  editorOpen.value = true
}

function gotoDay(date: string) {
  router.replace({ query: { ...route.query, view: 'day', date } })
}

const detailTitle = computed(() => {
  const occ = detailOcc.value
  if (!occ) return ''
  if (occ.kind === 'meal') return `Cooking — ${occ.title.replace(/^Cook: /, '')}`
  return occ.title
})

const detailTimeLabel = computed(() => {
  const occ = detailOcc.value
  if (!occ) return ''
  if (occ.isAllDay) {
    const start = DateTime.fromISO(occ.startDate!, { zone: timezone.value })
    const endIncl = DateTime.fromISO(occ.endDate!, { zone: timezone.value }).minus({ days: 1 })
    return start.toISODate() === endIncl.toISODate()
      ? `${start.toFormat('ccc, LLL d')} · All day`
      : `${start.toFormat('ccc, LLL d')} – ${endIncl.toFormat('ccc, LLL d')} · All day`
  }
  const start = DateTime.fromMillis(occ.start, { zone: timezone.value })
  const end = DateTime.fromMillis(occ.end, { zone: timezone.value })
  return `${start.toFormat('ccc, LLL d · h:mm a')} – ${end.toFormat('h:mm a')}`
})
</script>

<template>
  <div class="space-y-4">
    <!-- header: title + view switcher -->
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h1 class="text-xl md:text-2xl font-bold">{{ title }}</h1>
      <div class="flex rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-0.5">
        <button
          v-for="item in viewItems"
          :key="item.value"
          type="button"
          class="flex min-h-11 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors"
          :class="view === item.value
            ? 'bg-primary/10 text-primary'
            : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'"
          @click="view = item.value"
        >
          <UIcon :name="item.icon" class="size-4" />
          <span class="hidden sm:inline">{{ item.label }}</span>
        </button>
      </div>
    </div>

    <!-- controls: prev/today/next + member filter -->
    <div class="flex flex-wrap items-center gap-2">
      <div class="flex items-center gap-1">
        <UButton icon="i-lucide-chevron-left" variant="ghost" color="neutral" aria-label="Previous" @click="prev" />
        <UButton variant="soft" color="neutral" @click="today">Today</UButton>
        <UButton icon="i-lucide-chevron-right" variant="ghost" color="neutral" aria-label="Next" @click="next" />
      </div>

      <div class="ml-auto flex flex-wrap items-center gap-1.5">
        <button
          v-for="p in profiles"
          :key="p.id"
          type="button"
          class="flex min-h-11 min-w-11 items-center justify-center rounded-full p-1 transition-all"
          :class="selectedProfileIds.length && !selectedProfileIds.includes(p.id) ? 'opacity-40' : ''"
          :title="p.name"
          @click="toggleProfileFilter(p.id)"
        >
          <span
            class="rounded-full"
            :class="selectedProfileIds.includes(p.id) ? 'ring-2 ring-offset-2 ring-offset-slate-50 dark:ring-offset-slate-950' : ''"
            :style="selectedProfileIds.includes(p.id) ? { '--tw-ring-color': p.color } : {}"
          >
            <ProfileAvatar :profile="p" size="sm" />
          </span>
        </button>
      </div>
    </div>

    <!-- views -->
    <CalendarMonth
      v-if="view === 'month'"
      :anchor="anchor"
      :occurrences="occurrences"
      :timezone="timezone"
      :week-starts-on="weekStartsOn"
      @select="onSelect"
      @select-day="gotoDay"
    />
    <CalendarWeek
      v-else-if="view === 'week'"
      :anchor="anchor"
      :occurrences="occurrences"
      :timezone="timezone"
      :week-starts-on="weekStartsOn"
      @select="onSelect"
      @select-day="gotoDay"
    />
    <CalendarDay
      v-else-if="view === 'day'"
      :anchor="anchor"
      :occurrences="occurrences"
      :timezone="timezone"
      :week-starts-on="weekStartsOn"
      @select="onSelect"
      @select-day="gotoDay"
    />
    <CalendarAgenda
      v-else
      :occurrences="occurrences"
      :timezone="timezone"
      :start-date="range.startDate"
      @select="onSelect"
    />

    <!-- floating add button -->
    <UButton
      icon="i-lucide-plus"
      size="xl"
      class="fixed bottom-24 right-4 md:bottom-8 md:right-8 z-40 size-14 justify-center rounded-full shadow-lg"
      aria-label="Add event"
      @click="openCreate"
    />

    <EventEditor
      v-model:open="editorOpen"
      :timezone="timezone"
      :week-starts-on="weekStartsOn"
      :profiles="profiles"
      :editing="editing"
      :default-date="anchor"
      @saved="refresh()"
    />

    <ScopeDialog v-model:open="scopeOpen" @select="onScopePicked" />

    <!-- read-only occurrence detail (feed imports + cooking blocks) -->
    <UModal v-model:open="detailOpen" :title="detailTitle">
      <template #body>
        <div v-if="detailOcc" class="space-y-3 text-sm">
          <p class="flex items-center gap-2">
            <UIcon name="i-lucide-clock" class="size-4 text-slate-400" />
            {{ detailTimeLabel }}
          </p>
          <p v-if="detailOcc.location" class="flex items-center gap-2">
            <UIcon name="i-lucide-map-pin" class="size-4 text-slate-400" />
            {{ detailOcc.location }}
          </p>
          <p v-if="detailOcc.description" class="whitespace-pre-line text-slate-600 dark:text-slate-300">
            {{ detailOcc.description }}
          </p>
          <template v-if="detailOcc.kind === 'meal'">
            <p class="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <UIcon name="i-lucide-chef-hat" class="size-3.5" />
              Cooking block from the meal planner — change the cook or meal there.
            </p>
            <UButton
              :to="detailOcc.recipeId ? `/recipes/${detailOcc.recipeId}` : '/meals'"
              :icon="detailOcc.recipeId ? 'i-lucide-book-open' : 'i-lucide-utensils'"
              variant="soft"
              @click="detailOpen = false"
            >
              {{ detailOcc.recipeId ? 'View recipe' : 'Open meal planner' }}
            </UButton>
          </template>
          <p v-else class="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <UIcon name="i-lucide-rss" class="size-3.5" />
            {{ detailFeedName ? `From ${detailFeedName} — imported events can't be edited here.` : `Imported from a calendar subscription — read-only.` }}
          </p>
        </div>
      </template>
    </UModal>
  </div>
</template>
