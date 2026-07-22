<!-- Settings section for the idle photo slideshow. Saving is admin-only
     (PATCH /api/household); previewing works for everyone. -->
<script setup lang="ts">
const toast = useToast()
const { state, refresh, isAdmin } = useBoardState()

const current = state.value?.settings?.slideshow
const form = reactive({
  idleMinutes: current?.idleMinutes ?? 10,
  intervalSec: current?.intervalSec ?? 12,
  transition: current?.transition ?? 'kenburns' as 'fade' | 'kenburns',
  showClock: current?.showClock ?? true,
  showWeather: current?.showWeather ?? true,
  showAgenda: current?.showAgenda ?? true,
})

const transitionItems = [
  { label: 'Crossfade', value: 'fade' },
  { label: 'Ken Burns (slow pan & zoom)', value: 'kenburns' },
]

const busy = ref(false)
async function save() {
  busy.value = true
  try {
    await $fetch('/api/household', {
      method: 'PATCH',
      body: { settings: { slideshow: { ...form } } },
    })
    await refresh()
    toast.add({ title: 'Slideshow settings saved', color: 'success' })
  }
  catch {
    toast.add({ title: 'Could not save slideshow settings', color: 'error' })
  }
  finally {
    busy.value = false
  }
}

// The globally-mounted SlideshowOverlay watches this flag.
const previewFlag = useState('slideshow-preview', () => false)
function preview() {
  previewFlag.value = true
}
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center gap-2 font-semibold">
        <UIcon name="i-lucide-images" class="text-primary size-5" />
        Slideshow
      </div>
    </template>

    <div class="space-y-4">
      <p class="text-sm text-slate-500 dark:text-slate-400">
        Wall displays turn into a photo slideshow after sitting idle. Tap or
        press any key to get back to the board.
      </p>

      <div class="grid gap-4 sm:grid-cols-2">
        <UFormField label="Start after idle (minutes)">
          <UInputNumber v-model="form.idleMinutes" :min="1" :max="240" :disabled="!isAdmin" class="w-full" />
        </UFormField>
        <UFormField label="Seconds per photo">
          <UInputNumber v-model="form.intervalSec" :min="3" :max="120" :disabled="!isAdmin" class="w-full" />
        </UFormField>
      </div>

      <UFormField label="Transition">
        <USelect v-model="form.transition" :items="transitionItems" :disabled="!isAdmin" class="w-full sm:w-64" />
      </UFormField>

      <div class="space-y-3">
        <div class="flex min-h-11 items-center justify-between gap-4">
          <p class="font-medium">Show clock</p>
          <USwitch v-model="form.showClock" :disabled="!isAdmin" />
        </div>
        <div class="flex min-h-11 items-center justify-between gap-4">
          <p class="font-medium">Show weather</p>
          <USwitch v-model="form.showWeather" :disabled="!isAdmin" />
        </div>
        <div class="flex min-h-11 items-center justify-between gap-4">
          <p class="font-medium">Show today's agenda</p>
          <USwitch v-model="form.showAgenda" :disabled="!isAdmin" />
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <UButton v-if="isAdmin" :loading="busy" @click="save">Save</UButton>
        <UButton variant="soft" color="neutral" icon="i-lucide-play" @click="preview">
          Preview slideshow
        </UButton>
      </div>
    </div>
  </UCard>
</template>
