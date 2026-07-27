<script setup lang="ts">
import { DEFAULT_MEAL_TIMES } from '#shared/schemas/meals'

const toast = useToast()
const { t } = useI18n()
const { state, refresh } = useBoardState()

const { data: household } = await useFetch('/api/household')

// Reka's SelectItem rejects value: '' (an empty value is what clears a
// Select), which threw and broke the whole Settings page. Use a sentinel and
// map it back to null on save.
const NO_COOK = 'none'

const cookItems = computed(() => [
  { label: t('settings.household.noDefaultCook'), value: NO_COOK },
  ...(state.value?.profiles ?? []).map(p => ({ label: p.name, value: p.id })),
])

const form = reactive({
  name: household.value?.name ?? '',
  timezone: household.value?.timezone ?? 'UTC',
  locationName: household.value?.locationName ?? '',
  weekStartsOn: (household.value?.settings?.weekStartsOn ?? 0) as 0 | 1,
  temperatureUnit: (household.value?.settings?.temperatureUnit ?? 'fahrenheit') as 'fahrenheit' | 'celsius',
  mealTimes: { ...DEFAULT_MEAL_TIMES, ...(household.value?.settings?.mealTimes ?? {}) },
  defaultCookProfileId: household.value?.settings?.defaultCookProfileId ?? NO_COOK,
})

const mealTimeFields = computed(() => [
  { key: 'breakfast', label: t('settings.household.meals.breakfast') },
  { key: 'lunch', label: t('settings.household.meals.lunch') },
  { key: 'dinner', label: t('settings.household.meals.dinner') },
  { key: 'snack', label: t('settings.household.meals.snack') },
] as const)

// Open-Meteo geocoder for changing the weather location.
const locationQuery = ref('')
const locationResults = ref<{ name: string, admin1?: string, country: string, latitude: number, longitude: number, timezone: string }[]>([])
let searchTimer: ReturnType<typeof setTimeout> | undefined
const pendingLocation = ref<{ latitude: number, longitude: number } | null>(null)

watch(locationQuery, (q) => {
  clearTimeout(searchTimer)
  if (!q || q.length < 2) {
    locationResults.value = []
    return
  }
  searchTimer = setTimeout(async () => {
    try {
      const res = await $fetch<{ results?: typeof locationResults.value }>(
        'https://geocoding-api.open-meteo.com/v1/search',
        { params: { name: q, count: 5 } },
      )
      locationResults.value = res.results ?? []
    }
    catch {
      locationResults.value = []
    }
  }, 300)
})

function pickLocation(r: (typeof locationResults.value)[number]) {
  form.locationName = [r.name, r.admin1, r.country].filter(Boolean).join(', ')
  form.timezone = r.timezone || form.timezone
  pendingLocation.value = { latitude: r.latitude, longitude: r.longitude }
  locationResults.value = []
  locationQuery.value = ''
}

const busy = ref(false)
async function save() {
  busy.value = true
  try {
    await $fetch('/api/household', {
      method: 'PATCH',
      body: {
        name: form.name,
        timezone: form.timezone,
        locationName: form.locationName || null,
        ...(pendingLocation.value ?? {}),
        settings: {
          weekStartsOn: form.weekStartsOn,
          temperatureUnit: form.temperatureUnit,
          mealTimes: { ...form.mealTimes },
          defaultCookProfileId: form.defaultCookProfileId === NO_COOK ? null : form.defaultCookProfileId,
        },
      },
    })
    await refresh()
    useWeatherTick().value++ // weather widgets refetch with the new unit/location
    toast.add({ title: t('settings.household.saved'), color: 'success' })
  }
  catch {
    toast.add({ title: t('settings.household.saveFailed'), color: 'error' })
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center gap-2 font-semibold">
        <UIcon name="i-lucide-house" class="text-primary size-5" />
        {{ $t('settings.household.title') }}
      </div>
    </template>
    <div class="space-y-4">
      <UFormField :label="$t('settings.household.name')">
        <UInput v-model="form.name" class="w-full" />
      </UFormField>
      <UFormField :label="$t('settings.household.weatherLocation')">
        <UInput v-model="locationQuery" :placeholder="form.locationName || $t('settings.household.locationPlaceholder')" icon="i-lucide-map-pin" class="w-full" />
      </UFormField>
      <div v-if="locationResults.length" class="rounded-lg border border-slate-200 dark:border-slate-700 divide-y divide-slate-200 dark:divide-slate-700">
        <button
          v-for="r in locationResults"
          :key="`${r.latitude},${r.longitude}`"
          class="block w-full px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
          @click="pickLocation(r)"
        >
          {{ [r.name, r.admin1, r.country].filter(Boolean).join(', ') }}
        </button>
      </div>
      <UFormField :label="$t('settings.household.timezone')">
        <UInput v-model="form.timezone" class="w-full" />
      </UFormField>
      <UFormField :label="$t('settings.household.weekStartsOn')">
        <USelect
          v-model="form.weekStartsOn"
          :items="[{ label: $t('settings.household.sunday'), value: 0 }, { label: $t('settings.household.monday'), value: 1 }]"
          class="w-40"
        />
      </UFormField>
      <UFormField :label="$t('settings.household.temperature')" :help="$t('settings.household.temperatureHelp')">
        <USelect
          v-model="form.temperatureUnit"
          :items="[
            { label: $t('settings.household.fahrenheit'), value: 'fahrenheit' },
            { label: $t('settings.household.celsius'), value: 'celsius' },
          ]"
          class="w-48"
        />
      </UFormField>
      <UFormField :label="$t('settings.household.mealTimes')" :help="$t('settings.household.mealTimesHelp')">
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label v-for="field in mealTimeFields" :key="field.key" class="block">
            <span class="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">{{ field.label }}</span>
            <input
              v-model="form.mealTimes[field.key]"
              type="time"
              :aria-label="$t('settings.household.mealTimeLabel', { meal: field.label })"
              class="w-full min-h-11 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-primary"
            >
          </label>
        </div>
      </UFormField>
      <UFormField :label="$t('settings.household.defaultCook')" :help="$t('settings.household.defaultCookHelp')">
        <USelect v-model="form.defaultCookProfileId" :items="cookItems" class="w-64" />
      </UFormField>
      <UButton :loading="busy" @click="save">{{ $t('common.actions.save') }}</UButton>
    </div>
  </UCard>
</template>
