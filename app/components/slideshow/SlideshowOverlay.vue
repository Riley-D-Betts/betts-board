<!-- Global idle-triggered photo slideshow: fullscreen crossfade/Ken Burns layer
     with optional clock, weather, and agenda chrome. Mounted once in app.vue. -->
<script setup lang="ts">
import type { SlideshowManifest } from '#shared/schemas/photos'

const { active, stop } = useIdleSlideshow()
const { state } = useBoardState()
const { isDisplayDevice } = useDeviceMode()

// Settings "Preview slideshow" sets this flag; the overlay starts immediately.
const previewFlag = useState('slideshow-preview', () => false)
watch(previewFlag, (v) => {
  if (v) {
    previewFlag.value = false
    active.value = true
  }
})

const manifest = ref<SlideshowManifest | null>(null)
const settings = computed(() =>
  manifest.value?.settings
  ?? state.value?.settings?.slideshow
  ?? {
    idleMinutes: 10,
    intervalSec: 12,
    transition: 'kenburns' as const,
    showWeather: true,
    showAgenda: true,
    showClock: true,
  })
const kenburns = computed(() => settings.value.transition === 'kenburns')
const hasPhotos = computed(() => (manifest.value?.photos.length ?? 0) > 0)

// ---- rotation: two stacked <img>s, back slot loads next, then opacity flips ----

interface Slide { src: string, seq: number }
const slides = ref<[Slide | null, Slide | null]>([null, null])
const front = ref<0 | 1>(0)

let order: SlideshowManifest['photos'] = []
let pos = 0
let seq = 0
let timer: ReturnType<typeof setTimeout> | undefined

function preload(url: string) {
  const img = new Image()
  img.src = url
}

function showNext() {
  if (!order.length) return
  const photo = order[pos % order.length]!
  pos++
  seq++
  const back = (1 - front.value) as 0 | 1
  slides.value[back] = { src: photo.url, seq }
  // Let the new <img> mount (opacity-0) and get a style flush before the
  // visibility flip, so the 1 s crossfade actually transitions.
  nextTick(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (active.value) front.value = back
    }))
  })
  const next = order[pos % order.length]
  if (next) preload(next.url)
}

function scheduleAdvance() {
  clearTimeout(timer)
  timer = setTimeout(() => {
    if (!active.value) return
    showNext()
    scheduleAdvance()
  }, Math.max(3, settings.value.intervalSec) * 1000)
}

function slideClasses(i: 0 | 1) {
  const slide = slides.value[i]
  return [
    front.value === i ? 'opacity-100' : 'opacity-0',
    kenburns.value && slide ? (slide.seq % 2 ? 'ken-a' : 'ken-b') : '',
  ]
}

// ---- activation ----

watch(active, (on) => {
  if (on) void activate()
  else deactivate()
})

async function activate() {
  slides.value = [null, null]
  front.value = 0
  pos = 0
  try {
    manifest.value = await $fetch<SlideshowManifest>('/api/slideshow') // fresh shuffle each run
  }
  catch {
    manifest.value = null // locked/unreachable → clock-only mode
  }
  if (!active.value) return // dismissed while fetching
  order = manifest.value?.photos ?? []
  if (order.length) {
    showNext()
    scheduleAdvance()
  }
  void acquireWakeLock()
}

function deactivate() {
  clearTimeout(timer)
  timer = undefined
  slides.value = [null, null]
  // Wall displays keep the screen awake even on the regular board.
  if (!isDisplayDevice.value) releaseWakeLock()
}

function dismiss() {
  stop()
  if (isDisplayDevice.value) void acquireWakeLock()
}

useEventListener('keydown', () => {
  if (active.value) dismiss()
})

// ---- wake lock (best-effort) ----

let wakeLock: WakeLockSentinel | null = null

async function acquireWakeLock() {
  if (!('wakeLock' in navigator)) return
  try {
    wakeLock = await navigator.wakeLock.request('screen')
  }
  catch { /* low battery / not allowed — the slideshow still runs */ }
}

function releaseWakeLock() {
  wakeLock?.release().catch(() => {})
  wakeLock = null
}

useEventListener(document, 'visibilitychange', () => {
  if (active.value && document.visibilityState === 'visible') void acquireWakeLock()
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="active"
      class="fixed inset-0 z-50 cursor-none select-none overflow-hidden bg-black text-white"
      @pointerdown="dismiss"
    >
      <img
        v-if="slides[0]"
        :key="slides[0].seq"
        :src="slides[0].src"
        alt=""
        class="absolute inset-0 size-full object-cover transition-opacity duration-1000 will-change-transform"
        :class="slideClasses(0)"
      >
      <img
        v-if="slides[1]"
        :key="slides[1].seq"
        :src="slides[1].src"
        alt=""
        class="absolute inset-0 size-full object-cover transition-opacity duration-1000 will-change-transform"
        :class="slideClasses(1)"
      >

      <!-- Readability scrims over the photos -->
      <template v-if="hasPhotos">
        <div class="pointer-events-none absolute inset-x-0 top-0 h-44 bg-gradient-to-b from-black/60 to-transparent" />
        <div class="pointer-events-none absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-black/60 to-transparent" />
      </template>

      <!-- No photos yet: big centered clock -->
      <div v-if="!hasPhotos" class="absolute inset-0 flex items-center justify-center">
        <OverlayClock large class="chrome-shadow text-center" />
      </div>

      <OverlayClock v-if="settings.showClock && hasPhotos" class="chrome-shadow absolute bottom-8 left-8" />
      <OverlayWeather v-if="settings.showWeather" class="chrome-shadow absolute bottom-8 right-8" />
      <OverlayAgenda v-if="settings.showAgenda" class="chrome-shadow absolute right-8 top-8" />
    </div>
  </Teleport>
</template>

<style scoped>
.chrome-shadow {
  text-shadow: 0 1px 4px rgb(0 0 0 / 0.8);
}

/* Slow Ken Burns drift — pure transform, alternating origins per slide. */
.ken-a {
  transform-origin: 25% 30%;
  animation: ken-burns-a 9s ease-in-out forwards;
}

.ken-b {
  transform-origin: 75% 70%;
  animation: ken-burns-b 9s ease-in-out forwards;
}

@keyframes ken-burns-a {
  from { transform: scale(1.05); }
  to { transform: scale(1.15) translate3d(-1.5%, -1%, 0); }
}

@keyframes ken-burns-b {
  from { transform: scale(1.15); }
  to { transform: scale(1.05) translate3d(1.5%, 1%, 0); }
}
</style>
