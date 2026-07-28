<!-- Camera barcode scanner (BarcodeDetector ponyfill) with manual fallback. -->
<script setup lang="ts">
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ detected: [code: string] }>()

const { t } = useI18n()

const videoEl = ref<HTMLVideoElement | null>(null)
const error = ref<string | null>(null)
const starting = ref(false)
const manualCode = ref('')

interface Detector { detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]> }
let detector: Detector | null = null
let stream: MediaStream | null = null
let timer: ReturnType<typeof setInterval> | undefined

function stopTracks() {
  if (timer) {
    clearInterval(timer)
    timer = undefined
  }
  stream?.getTracks().forEach(t => t.stop())
  stream = null
  if (videoEl.value) videoEl.value.srcObject = null
}

async function start() {
  error.value = null
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    error.value = t('pantry.scanner.errors.insecureContext')
    return
  }
  starting.value = true
  try {
    const { BarcodeDetector: BD } = await import('barcode-detector/ponyfill')
    detector = new BD({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] })
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
    if (!open.value || !videoEl.value) {
      // Closed while the permission prompt was up.
      stopTracks()
      return
    }
    videoEl.value.srcObject = stream
    await videoEl.value.play()
    timer = setInterval(scanFrame, 300)
  }
  catch {
    error.value = t('pantry.scanner.errors.cameraFailed')
    stopTracks()
  }
  finally {
    starting.value = false
  }
}

async function scanFrame() {
  const video = videoEl.value
  if (!video || !detector || video.readyState < 2) return
  try {
    const codes = await detector.detect(video)
    const code = codes[0]?.rawValue
    if (code && /^\d{6,14}$/.test(code)) {
      stopTracks()
      emit('detected', code)
    }
  }
  catch {
    // keep polling — an odd frame shouldn't kill the scanner
  }
}

function submitManual() {
  const code = manualCode.value.trim()
  if (!/^\d{6,14}$/.test(code)) {
    error.value = t('pantry.scanner.errors.invalidBarcode')
    return
  }
  stopTracks()
  emit('detected', code)
}

watch(open, (isOpen) => {
  if (isOpen) {
    manualCode.value = ''
    error.value = null
    nextTick(start)
  }
  else {
    stopTracks()
  }
})

onBeforeUnmount(stopTracks)
</script>

<template>
  <UModal v-model:open="open" :title="$t('pantry.scanner.title')">
    <template #body>
      <div class="space-y-4">
        <div v-if="!error" class="relative aspect-video overflow-hidden rounded-xl bg-black">
          <video ref="videoEl" autoplay muted playsinline class="h-full w-full object-cover" />
          <div class="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 rounded bg-red-500/70" />
          <p v-if="starting" class="absolute inset-0 grid place-items-center text-sm text-white/80">
            {{ $t('pantry.scanner.starting') }}
          </p>
        </div>
        <p
          v-else
          class="rounded-lg bg-amber-50 dark:bg-amber-950/40 p-3 text-sm text-amber-800 dark:text-amber-200"
        >
          {{ error }}
        </p>
        <p v-if="!error" class="text-sm text-slate-500 dark:text-slate-400">
          {{ $t('pantry.scanner.hint') }}
        </p>

        <form class="flex gap-2" @submit.prevent="submitManual">
          <UInput
            v-model="manualCode"
            inputmode="numeric"
            :placeholder="$t('pantry.scanner.manualPlaceholder')"
            class="flex-1"
          />
          <UButton type="submit" variant="soft" :disabled="!manualCode.trim()">{{ $t('pantry.scanner.lookUp') }}</UButton>
        </form>
      </div>
    </template>
  </UModal>
</template>
