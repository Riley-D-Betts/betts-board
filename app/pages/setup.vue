<script setup lang="ts">
definePageMeta({ layout: 'bare' })

const { refresh } = useBoardState()
const toast = useToast()
const { t } = useI18n()

const step = ref(1)
const busy = ref(false)

const form = reactive({
  householdName: '',
  password: '',
  passwordConfirm: '',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  locationName: '',
  latitude: undefined as number | undefined,
  longitude: undefined as number | undefined,
  profiles: [
    { name: '', color: '#3b82f6', role: 'admin' as const },
  ] as { name: string, color: string, role: 'admin' | 'adult' | 'kid' }[],
})

const PROFILE_COLORS = ['#3b82f6', '#ec4899', '#22c55e', '#f97316', '#a855f7', '#14b8a6', '#eab308', '#ef4444']

// Location search via Open-Meteo's free geocoder (no API key).
const locationQuery = ref('')
const locationResults = ref<{ name: string, admin1?: string, country: string, latitude: number, longitude: number, timezone: string }[]>([])
let searchTimer: ReturnType<typeof setTimeout> | undefined

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
  form.latitude = r.latitude
  form.longitude = r.longitude
  form.timezone = r.timezone || form.timezone
  locationResults.value = []
  locationQuery.value = ''
}

function addProfile() {
  form.profiles.push({
    name: '',
    color: PROFILE_COLORS[form.profiles.length % PROFILE_COLORS.length]!,
    role: 'adult',
  })
}

const step1Valid = computed(() =>
  form.householdName.trim().length > 0
  && form.password.length >= 6
  && form.password === form.passwordConfirm)

const step3Valid = computed(() =>
  form.profiles.length > 0
  && form.profiles.every(p => p.name.trim().length > 0)
  && form.profiles.some(p => p.role === 'admin'))

async function finish() {
  busy.value = true
  try {
    await $fetch('/api/setup', {
      method: 'POST',
      body: {
        householdName: form.householdName.trim(),
        password: form.password,
        timezone: form.timezone,
        latitude: form.latitude,
        longitude: form.longitude,
        locationName: form.locationName || undefined,
        profiles: form.profiles.map(p => ({ ...p, name: p.name.trim() })),
      },
    })
    await refresh()
    await navigateTo('/')
  }
  catch (err: unknown) {
    const msg = (err as { data?: { message?: string } })?.data?.message ?? t('auth.setup.failed')
    toast.add({ title: msg, color: 'error' })
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <UCard>
    <template #header>
      <div class="text-center">
        <UIcon name="i-lucide-layout-dashboard" class="text-primary size-10 mb-2" />
        <h1 class="text-2xl font-bold">{{ $t('auth.setup.title') }}</h1>
        <p class="text-sm text-slate-500 mt-1">{{ $t('auth.setup.stepIndicator', { step }) }}</p>
      </div>
    </template>

    <!-- Step 1: household + password -->
    <div v-if="step === 1" class="space-y-4">
      <UFormField :label="$t('auth.setup.household.nameLabel')">
        <UInput v-model="form.householdName" :placeholder="$t('auth.setup.household.namePlaceholder')" class="w-full" size="lg" />
      </UFormField>
      <UFormField :label="$t('auth.setup.household.passwordLabel')" :help="$t('auth.setup.household.passwordHelp')">
        <UInput v-model="form.password" type="password" class="w-full" size="lg" />
      </UFormField>
      <UFormField :label="$t('auth.setup.household.passwordConfirmLabel')" :error="form.passwordConfirm && form.password !== form.passwordConfirm ? $t('auth.setup.household.passwordMismatch') : undefined">
        <UInput v-model="form.passwordConfirm" type="password" class="w-full" size="lg" />
      </UFormField>
      <UButton block size="lg" :disabled="!step1Valid" @click="step = 2">{{ $t('auth.setup.continue') }}</UButton>
    </div>

    <!-- Step 2: location (for weather) + timezone -->
    <div v-else-if="step === 2" class="space-y-4">
      <UFormField :label="$t('auth.setup.location.label')" :help="$t('auth.setup.location.help')">
        <UInput v-model="locationQuery" :placeholder="$t('auth.setup.location.placeholder')" class="w-full" size="lg" icon="i-lucide-map-pin" />
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
      <p v-if="form.locationName" class="text-sm">
        <UIcon name="i-lucide-check" class="text-green-500 size-4" /> {{ form.locationName }}
      </p>
      <UFormField :label="$t('auth.setup.location.timezoneLabel')">
        <UInput v-model="form.timezone" class="w-full" size="lg" />
      </UFormField>
      <div class="flex gap-2">
        <UButton variant="ghost" size="lg" @click="step = 1">{{ $t('common.actions.back') }}</UButton>
        <UButton block size="lg" @click="step = 3">{{ $t('auth.setup.continue') }}</UButton>
      </div>
    </div>

    <!-- Step 3: profiles -->
    <div v-else class="space-y-4">
      <p class="text-sm text-slate-500">{{ $t('auth.setup.profiles.intro') }}</p>
      <div v-for="(p, i) in form.profiles" :key="i" class="flex items-center gap-2">
        <input v-model="p.color" type="color" class="size-9 rounded cursor-pointer border-0 bg-transparent shrink-0">
        <UInput v-model="p.name" :placeholder="i === 0 ? $t('auth.setup.profiles.firstNamePlaceholder') : $t('auth.setup.profiles.namePlaceholder')" class="flex-1" />
        <USelect
          v-model="p.role"
          :items="[{ label: $t('auth.roles.admin'), value: 'admin' }, { label: $t('auth.roles.adult'), value: 'adult' }, { label: $t('auth.roles.kid'), value: 'kid' }]"
          class="w-28"
        />
        <UButton
          v-if="form.profiles.length > 1"
          icon="i-lucide-x"
          variant="ghost"
          color="neutral"
          @click="form.profiles.splice(i, 1)"
        />
      </div>
      <UButton variant="soft" icon="i-lucide-plus" @click="addProfile">{{ $t('auth.setup.profiles.addMember') }}</UButton>
      <p v-if="!form.profiles.some(p => p.role === 'admin')" class="text-sm text-red-500">
        {{ $t('auth.setup.profiles.adminRequired') }}
      </p>
      <div class="flex gap-2">
        <UButton variant="ghost" size="lg" @click="step = 2">{{ $t('common.actions.back') }}</UButton>
        <UButton block size="lg" :disabled="!step3Valid" :loading="busy" @click="finish">{{ $t('auth.setup.profiles.finish') }}</UButton>
      </div>
    </div>
  </UCard>
</template>
