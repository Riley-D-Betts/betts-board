<script setup lang="ts">
const props = withDefaults(defineProps<{
  profile: { name: string, color: string, avatarPath?: string | null }
  size?: 'sm' | 'md' | 'lg' | 'xl'
}>(), { size: 'md' })

const sizeClass = computed(() => ({
  sm: 'size-7 text-xs',
  md: 'size-10 text-sm',
  lg: 'size-16 text-xl',
  xl: 'size-24 text-3xl',
}[props.size]))

const initials = computed(() =>
  props.profile.name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase(),
)
</script>

<template>
  <img
    v-if="profile.avatarPath"
    :src="`/uploads/${profile.avatarPath}`"
    :alt="profile.name"
    class="rounded-full object-cover shrink-0"
    :class="sizeClass"
  >
  <div
    v-else
    class="rounded-full flex items-center justify-center font-bold text-white shrink-0"
    :class="sizeClass"
    :style="{ backgroundColor: profile.color }"
  >
    {{ initials }}
  </div>
</template>
