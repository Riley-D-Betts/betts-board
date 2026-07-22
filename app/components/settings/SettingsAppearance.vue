<!-- Household look & feel: font + accent color per light/dark mode (admin
     saves, applies to everyone) and this device's light/dark preference. -->
<script setup lang="ts">
import { ACCENT_COLORS } from '#shared/schemas/household'

const toast = useToast()
const { state, refresh, isAdmin } = useBoardState()
const colorMode = useColorMode()

type Font = 'rounded' | 'system' | 'serif' | 'mono' | 'playful'
const current = state.value?.settings?.appearance
const form = reactive({
  font: (current?.font ?? 'rounded') as Font,
  accentLight: current?.accentLight ?? 'green',
  accentDark: current?.accentDark ?? 'green',
})

const fontItems: { label: string, value: Font, class: string }[] = [
  { label: 'Rounded', value: 'rounded', class: '[font-family:ui-rounded,\'SF_Pro_Rounded\',system-ui,sans-serif]' },
  { label: 'Classic', value: 'system', class: '[font-family:system-ui,sans-serif]' },
  { label: 'Serif', value: 'serif', class: '[font-family:Georgia,serif]' },
  { label: 'Typewriter', value: 'mono', class: '[font-family:ui-monospace,monospace]' },
  { label: 'Playful', value: 'playful', class: '[font-family:\'Comic_Sans_MS\',\'Comic_Neue\',cursive]' },
]

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
      body: { settings: { appearance: { ...form } } },
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
            :class="[
              f.class,
              form.font === f.value
                ? 'border-primary bg-primary/10 text-primary font-semibold'
                : 'border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800',
            ]"
            :disabled="!isAdmin"
            @click="form.font = f.value"
          >
            {{ f.label }}
          </button>
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
