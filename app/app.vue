<script setup lang="ts">
// SlideshowOverlay mounts globally (teleport layer) so idle-triggered
// slideshow works on any page without a route change.
</script>

<template>
  <UApp>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
    <SlideshowOverlay />
  </UApp>
</template>
