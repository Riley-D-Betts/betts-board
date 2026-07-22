<script setup lang="ts">
const props = withDefaults(defineProps<{
  modelValue: string | null
  /** Event start date (YYYY-MM-DD) — default weekday for custom weekly rules. */
  startDate?: string
  weekStartsOn?: 0 | 1
}>(), { startDate: undefined, weekStartsOn: 0 })

const emit = defineEmits<{ 'update:modelValue': [value: string | null] }>()

type Preset = 'none' | 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'custom'

const PRESET_RULES: Record<Exclude<Preset, 'none' | 'custom'>, string> = {
  daily: 'FREQ=DAILY',
  weekly: 'FREQ=WEEKLY',
  monthly: 'FREQ=MONTHLY',
  quarterly: 'FREQ=MONTHLY;INTERVAL=3',
  yearly: 'FREQ=YEARLY',
}

const presetItems = [
  { label: 'Does not repeat', value: 'none' },
  { label: 'Daily', value: 'daily' },
  { label: 'Weekly', value: 'weekly' },
  { label: 'Monthly', value: 'monthly' },
  { label: 'Quarterly', value: 'quarterly' },
  { label: 'Yearly', value: 'yearly' },
  { label: 'Custom…', value: 'custom' },
]

const WEEKDAYS = [
  { code: 'SU', label: 'S' },
  { code: 'MO', label: 'M' },
  { code: 'TU', label: 'T' },
  { code: 'WE', label: 'W' },
  { code: 'TH', label: 'T' },
  { code: 'FR', label: 'F' },
  { code: 'SA', label: 'S' },
]
const weekdayItems = computed(() =>
  props.weekStartsOn === 1 ? [...WEEKDAYS.slice(1), WEEKDAYS[0]!] : WEEKDAYS)

const preset = ref<Preset>('none')
const custom = reactive({
  freq: 'WEEKLY' as 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY',
  interval: 1,
  byday: [] as string[],
  end: 'never' as 'never' | 'until' | 'count',
  untilDate: '',
  count: 10,
})

const freqItems = [
  { label: 'day(s)', value: 'DAILY' },
  { label: 'week(s)', value: 'WEEKLY' },
  { label: 'month(s)', value: 'MONTHLY' },
  { label: 'year(s)', value: 'YEARLY' },
]
const endItems = [
  { label: 'Never ends', value: 'never' },
  { label: 'Ends on date', value: 'until' },
  { label: 'Ends after…', value: 'count' },
]

function toggleWeekday(code: string) {
  const i = custom.byday.indexOf(code)
  if (i === -1) custom.byday.push(code)
  else custom.byday.splice(i, 1)
}

function buildRule(): string | null {
  if (preset.value === 'none') return null
  if (preset.value !== 'custom') return PRESET_RULES[preset.value]
  const parts = [`FREQ=${custom.freq}`]
  const interval = Math.max(1, Math.floor(custom.interval || 1))
  if (interval > 1) parts.push(`INTERVAL=${interval}`)
  if (custom.freq === 'WEEKLY' && custom.byday.length) parts.push(`BYDAY=${custom.byday.join(',')}`)
  if (custom.end === 'until' && custom.untilDate) {
    parts.push(`UNTIL=${custom.untilDate.replaceAll('-', '')}T235959Z`)
  }
  else if (custom.end === 'count') {
    parts.push(`COUNT=${Math.max(1, Math.floor(custom.count || 1))}`)
  }
  return parts.join(';')
}

/** Initialize the controls from an incoming RRULE body. */
function initFrom(rrule: string | null) {
  if (!rrule) {
    preset.value = 'none'
    return
  }
  const match = (Object.entries(PRESET_RULES) as [Preset, string][])
    .find(([, rule]) => rule === rrule)
  if (match) {
    preset.value = match[0]
    return
  }
  preset.value = 'custom'
  const parts = Object.fromEntries(rrule.split(';').map((kv) => {
    const [k, v] = kv.split('=')
    return [k?.toUpperCase(), v ?? '']
  })) as Record<string, string>
  const freq = parts.FREQ?.toUpperCase()
  custom.freq = (freq === 'DAILY' || freq === 'WEEKLY' || freq === 'MONTHLY' || freq === 'YEARLY') ? freq : 'WEEKLY'
  custom.interval = Math.max(1, Number(parts.INTERVAL || '1') || 1)
  custom.byday = parts.BYDAY ? parts.BYDAY.split(',').map(d => d.replace(/^[-\d]+/, '')) : []
  if (parts.UNTIL) {
    custom.end = 'until'
    custom.untilDate = `${parts.UNTIL.slice(0, 4)}-${parts.UNTIL.slice(4, 6)}-${parts.UNTIL.slice(6, 8)}`
  }
  else if (parts.COUNT) {
    custom.end = 'count'
    custom.count = Number(parts.COUNT) || 10
  }
  else {
    custom.end = 'never'
  }
}

let lastEmitted: string | null | undefined
watch(() => props.modelValue, (v) => {
  if (v !== lastEmitted) initFrom(v ?? null)
}, { immediate: true })

watch([preset, custom], () => {
  if (preset.value === 'custom' && custom.freq === 'WEEKLY' && !custom.byday.length && props.startDate) {
    // Default the weekly toggle to the event's start weekday.
    const dow = parseDateString(props.startDate).getDay()
    custom.byday = [WEEKDAYS[dow]!.code]
  }
  const built = buildRule()
  if (built !== props.modelValue) {
    lastEmitted = built
    emit('update:modelValue', built)
  }
}, { deep: true })
</script>

<template>
  <div class="space-y-3">
    <USelect v-model="preset" :items="presetItems" class="w-full" />

    <div v-if="preset === 'custom'" class="space-y-3 rounded-lg border border-slate-200 dark:border-slate-700 p-3">
      <div class="flex items-center gap-2">
        <span class="text-sm text-slate-600 dark:text-slate-300">Every</span>
        <UInput v-model.number="custom.interval" type="number" min="1" max="99" class="w-20" />
        <USelect v-model="custom.freq" :items="freqItems" class="w-32" />
      </div>

      <div v-if="custom.freq === 'WEEKLY'" class="flex flex-wrap gap-1.5">
        <button
          v-for="d in weekdayItems"
          :key="d.code"
          type="button"
          class="size-11 rounded-full text-sm font-medium transition-colors"
          :class="custom.byday.includes(d.code)
            ? 'bg-primary text-white'
            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'"
          @click="toggleWeekday(d.code)"
        >
          {{ d.label }}
        </button>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <USelect v-model="custom.end" :items="endItems" class="w-40" />
        <UInput v-if="custom.end === 'until'" v-model="custom.untilDate" type="date" class="w-44" />
        <template v-else-if="custom.end === 'count'">
          <UInput v-model.number="custom.count" type="number" min="1" max="999" class="w-20" />
          <span class="text-sm text-slate-600 dark:text-slate-300">times</span>
        </template>
      </div>
    </div>

    <p v-if="modelValue" class="text-xs text-slate-500 dark:text-slate-400">
      <UIcon name="i-lucide-repeat" class="inline size-3 align-middle" />
      {{ recurrenceText(modelValue) }}
    </p>
  </div>
</template>
