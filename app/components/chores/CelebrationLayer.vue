<!-- Chore-completion celebration. Mounted once in app.vue so a check-off
     celebrates identically from the dashboard tile and the chores page. -->
<script setup lang="ts">
const { current, dismiss } = useCelebration()

// Respect the OS setting: confetti is skipped entirely, the callout still shows.
const reducedMotion = usePreferredReducedMotion()

let hideTimer: ReturnType<typeof setTimeout> | undefined

async function burst() {
  if (reducedMotion.value === 'reduce') return
  // Lazy so the library never loads during SSR, and never at all for a
  // household that has no chores with points.
  const { default: confetti } = await import('canvas-confetti')
  const shared = { disableForReducedMotion: true, zIndex: 60, spread: 70, startVelocity: 45 }
  void confetti({ ...shared, particleCount: 70, origin: { x: 0.2, y: 0.9 }, angle: 60 })
  void confetti({ ...shared, particleCount: 70, origin: { x: 0.8, y: 0.9 }, angle: 120 })
}

watch(current, (event) => {
  clearTimeout(hideTimer)
  if (!event) return
  void burst()
  hideTimer = setTimeout(dismiss, 3200)
})

onBeforeUnmount(() => clearTimeout(hideTimer))

const streakLabel = computed(() => {
  const streak = current.value?.streak ?? 0
  return streak >= 2 ? `${streak} days in a row` : null
})
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-200 ease-out"
      leave-active-class="transition duration-200 ease-in"
      enter-from-class="opacity-0 translate-y-4 scale-95"
      leave-to-class="opacity-0 scale-95"
    >
      <div
        v-if="current"
        class="fixed inset-x-0 bottom-24 z-[60] flex justify-center px-4 md:bottom-10"
        role="status"
        aria-live="polite"
        @click="dismiss()"
      >
        <div class="pointer-events-auto flex items-center gap-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-5 py-3 shadow-xl">
          <span v-if="current.emoji" class="text-3xl">{{ current.emoji }}</span>
          <UIcon v-else name="i-lucide-party-popper" class="size-8 text-primary" />
          <div class="min-w-0">
            <p class="font-semibold truncate">
              <span v-if="current.points > 0">+{{ current.points }}
                {{ current.points === 1 ? 'star' : 'stars' }}</span>
              <span v-else>Nice work</span>
              <span class="text-slate-500 dark:text-slate-400"> · {{ current.profileName }}</span>
            </p>
            <p class="text-sm text-slate-500 dark:text-slate-400 truncate">
              <template v-if="streakLabel">🔥 {{ streakLabel }} · </template>{{ current.title }}
            </p>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
