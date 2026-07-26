<!-- Household look & feel: font + accent color per light/dark mode (admin
     saves, applies to everyone) and this device's light/dark preference. -->
<script setup lang="ts">
import { FONT_DEFS } from '#shared/schemas/fonts'
import { ACCENT_COLORS } from '#shared/schemas/household'

const toast = useToast()
const { state, refresh, isAdmin } = useBoardState()
const colorMode = useColorMode()

const current = state.value?.settings?.appearance
const form = reactive({
  font: current?.font ?? 'rounded',
  accentLight: current?.accentLight ?? 'green',
  accentDark: current?.accentDark ?? 'green',
})

// One registry drives the enum, the applied stack, and this picker — each
// button previews itself in its own family via an inline style.
const fontItems = FONT_DEFS

const customFont = computed(() => state.value?.settings?.appearance?.customFont ?? null)
const customFamily = ref('')
const fontBusy = ref(false)

async function downloadFont() {
  const family = customFamily.value.trim()
  if (!family) return
  fontBusy.value = true
  try {
    await $fetch('/api/household/font', { method: 'POST', body: { family } })
    customFamily.value = ''
    await refresh()
    form.font = 'custom'
    toast.add({ title: `${family} downloaded`, icon: 'i-lucide-check', color: 'success' })
  }
  catch (err) {
    const e = err as { data?: { statusMessage?: string } }
    toast.add({ title: e.data?.statusMessage ?? 'Could not download that font', color: 'error' })
  }
  finally {
    fontBusy.value = false
  }
}

async function removeFont() {
  fontBusy.value = true
  try {
    await $fetch('/api/household/font', { method: 'DELETE' })
    await refresh()
    form.font = state.value?.settings?.appearance?.font ?? 'rounded'
    toast.add({ title: 'Custom font removed', color: 'success' })
  }
  catch {
    toast.add({ title: 'Could not remove the font', color: 'error' })
  }
  finally {
    fontBusy.value = false
  }
}

// Wall display theme (household-wide, unlike the per-device light/dark above).
const tvTheme = ref(state.value?.settings?.tv?.theme ?? 'auto')
const tvItems = [
  { label: 'Sunrise/sunset', value: 'auto', icon: 'i-lucide-sunrise' },
  { label: 'Always light', value: 'light', icon: 'i-lucide-sun' },
  { label: 'Always dark', value: 'dark', icon: 'i-lucide-moon' },
] as const
const hasLocation = computed(() => state.value?.hasLocation === true)

// Rendered as fixed swatch classes so Tailwind emits them.
const SWATCH: Record<string, string> = {
  green: 'bg-green-500',
  blue: 'bg-blue-500',
  indigo: 'bg-indigo-500',
  violet: 'bg-violet-500',
  fuchsia: 'bg-fuchsia-500',
  rose: 'bg-rose-500',
  orange: 'bg-orange-500',
  amber: 'bg-amber-500',
  teal: 'bg-teal-500',
  cyan: 'bg-cyan-500',
}

const modeItems = [
  { label: 'Light', value: 'light', icon: 'i-lucide-sun' },
  { label: 'Dark', value: 'dark', icon: 'i-lucide-moon' },
  { label: 'Auto', value: 'system', icon: 'i-lucide-monitor' },
]

const busy = ref(false)
async function save() {
  busy.value = true
  try {
    await $fetch('/api/household', {
      method: 'PATCH',
      body: { settings: { appearance: { ...form }, tv: { theme: tvTheme.value } } },
    })
    await refresh() // useAppearance() re-applies from the fresh state
    toast.add({ title: 'Appearance saved', color: 'success' })
  }
  catch {
    toast.add({ title: 'Could not save appearance', color: 'error' })
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
        <UIcon name="i-lucide-palette" class="text-primary size-5" />
        Appearance
      </div>
    </template>

    <div class="space-y-5">
      <!-- Per-device light/dark preference -->
      <UFormField label="This device" help="Light or dark is a per-device choice; Auto follows the device setting.">
        <div class="flex gap-2">
          <UButton
            v-for="m in modeItems"
            :key="m.value"
            :icon="m.icon"
            :label="m.label"
            :variant="colorMode.preference === m.value ? 'solid' : 'soft'"
            :color="colorMode.preference === m.value ? 'primary' : 'neutral'"
            class="min-h-11"
            @click="colorMode.preference = m.value"
          />
        </div>
      </UFormField>

      <!-- Household-wide font -->
      <UFormField label="Font" help="Applies to the whole board, for everyone.">
        <div class="flex flex-wrap gap-2">
          <button
            v-for="f in fontItems"
            :key="f.value"
            class="min-h-11 rounded-lg border px-4 py-2 text-sm transition-colors"
            :style="{ fontFamily: f.stack }"
            :class="form.font === f.value
              ? 'border-primary bg-primary/10 text-primary font-semibold'
              : 'border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'"
            :disabled="!isAdmin"
            @click="form.font = f.value"
          >
            {{ f.label }}
          </button>
          <button
            v-if="customFont"
            class="min-h-11 rounded-lg border px-4 py-2 text-sm transition-colors"
            :style="{ fontFamily: `'${customFont.family}'` }"
            :class="form.font === 'custom'
              ? 'border-primary bg-primary/10 text-primary font-semibold'
              : 'border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'"
            :disabled="!isAdmin"
            @click="form.font = 'custom'"
          >
            {{ customFont.family }}
          </button>
        </div>
      </UFormField>

      <!-- Any other Google Font, downloaded once and served from this server -->
      <UFormField
        v-if="isAdmin"
        label="Add a Google Font"
        help="Downloaded once and stored on your server — the board never calls out to Google when someone opens a page, and it keeps working offline."
      >
        <div class="flex flex-wrap items-center gap-2">
          <UInput
            v-model="customFamily"
            placeholder="e.g. Roboto Slab"
            class="flex-1 min-w-48"
            :disabled="fontBusy"
            @keydown.enter.prevent="downloadFont"
          />
          <UButton
            icon="i-lucide-download"
            :loading="fontBusy"
            :disabled="!customFamily.trim()"
            @click="downloadFont"
          >
            Download
          </UButton>
          <UButton
            v-if="customFont"
            icon="i-lucide-trash-2"
            variant="ghost"
            color="error"
            :loading="fontBusy"
            @click="removeFont"
          >
            Remove {{ customFont.family }}
          </UButton>
        </div>
      </UFormField>

      <!-- Wall display theme -->
      <UFormField
        label="TV mode theme"
        :help="tvTheme === 'auto' && !hasLocation
          ? 'No location set, so this falls back to a 7am–7pm window. Set a weather location for real sunrise and sunset.'
          : 'How the /tv wall display looks. This is household-wide, not per device.'"
      >
        <div class="flex flex-wrap gap-2">
          <UButton
            v-for="t in tvItems"
            :key="t.value"
            :icon="t.icon"
            :label="t.label"
            :variant="tvTheme === t.value ? 'solid' : 'soft'"
            :color="tvTheme === t.value ? 'primary' : 'neutral'"
            class="min-h-11"
            :disabled="!isAdmin"
            @click="tvTheme = t.value"
          />
        </div>
      </UFormField>

      <!-- Accent per mode -->
      <UFormField label="Accent color — light mode">
        <div class="flex flex-wrap gap-2">
          <button
            v-for="c in ACCENT_COLORS"
            :key="`l-${c}`"
            class="size-11 rounded-full transition-transform"
            :class="[SWATCH[c], form.accentLight === c ? 'ring-4 ring-offset-2 ring-slate-400 dark:ring-slate-500 dark:ring-offset-slate-900 scale-110' : 'hover:scale-105']"
            :aria-label="`Light accent ${c}`"
            :disabled="!isAdmin"
            @click="form.accentLight = c"
          />
        </div>
      </UFormField>
      <UFormField label="Accent color — dark mode">
        <div class="flex flex-wrap gap-2">
          <button
            v-for="c in ACCENT_COLORS"
            :key="`d-${c}`"
            class="size-11 rounded-full transition-transform"
            :class="[SWATCH[c], form.accentDark === c ? 'ring-4 ring-offset-2 ring-slate-400 dark:ring-slate-500 dark:ring-offset-slate-900 scale-110' : 'hover:scale-105']"
            :aria-label="`Dark accent ${c}`"
            :disabled="!isAdmin"
            @click="form.accentDark = c"
          />
        </div>
      </UFormField>

      <UButton v-if="isAdmin" :loading="busy" @click="save">Save</UButton>
      <p v-else class="text-sm text-slate-500 dark:text-slate-400">
        Ask an admin to change the household font and colors.
      </p>
    </div>
  </UCard>
</template>
