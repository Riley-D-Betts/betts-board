<script setup lang="ts">
// Each section is a feature-owned component so slices never edit this file.
const { isAdmin } = useBoardState()
</script>

<template>
  <div class="space-y-6 max-w-3xl">
    <h1 class="text-2xl md:text-3xl font-bold">Settings</h1>
    <SettingsHousehold v-if="isAdmin" />
    <SettingsProfiles v-if="isAdmin" />
    <SettingsAppearance />
    <SlideshowSettings />
    <FeedSettings v-if="isAdmin" />
    <PushSettings />
    <ApiKeySettings v-if="isAdmin" />
    <SettingsDevice />
  </div>
</template>
