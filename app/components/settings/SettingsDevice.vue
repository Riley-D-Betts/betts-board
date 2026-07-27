<script setup lang="ts">
// Per-device flag: only "wall display" devices start the idle slideshow.
const { isDisplayDevice } = useDeviceMode()
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center gap-2 font-semibold">
        <UIcon name="i-lucide-monitor" class="text-primary size-5" />
        {{ $t('settings.device.title') }}
      </div>
    </template>
    <div class="flex items-center justify-between gap-4">
      <div>
        <p class="font-medium">{{ $t('settings.device.wallDisplay') }}</p>
        <p class="text-sm text-slate-500">
          {{ $t('settings.device.wallDisplayHelp') }}
        </p>
      </div>
      <USwitch v-model="isDisplayDevice" />
    </div>
  </UCard>
</template>
