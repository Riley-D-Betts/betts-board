<script setup lang="ts">
const toast = useToast()
const { t } = useI18n()
const { isAdmin } = useBoardState()
const { isSupported, permission, isSubscribed, busy, refresh, subscribe, unsubscribe } = usePush()

onMounted(refresh)

const isIos = computed(() =>
  import.meta.client && /iPhone|iPad|iPod/.test(navigator.userAgent))

async function toggle(on: boolean) {
  try {
    if (on) {
      const ok = await subscribe()
      if (ok) toast.add({ title: t('settings.push.enabled'), color: 'success' })
      else if (permission.value === 'denied') toast.add({ title: t('settings.push.blocked'), color: 'error' })
    }
    else {
      await unsubscribe()
      toast.add({ title: t('settings.push.disabled'), color: 'success' })
    }
  }
  catch {
    toast.add({ title: t('settings.push.updateFailed'), color: 'error' })
  }
}

const testing = ref(false)
async function sendTest() {
  testing.value = true
  try {
    const res = await $fetch<{ sent: number, total: number }>('/api/push/test', { method: 'POST' })
    if (res.total === 0) toast.add({ title: t('settings.push.noDevices'), color: 'warning' })
    else toast.add({ title: t('settings.push.testSent', { sent: res.sent, total: res.total }, res.total), color: 'success' })
  }
  catch {
    toast.add({ title: t('settings.push.testFailed'), color: 'error' })
  }
  finally {
    testing.value = false
  }
}
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center gap-2 font-semibold">
        <UIcon name="i-lucide-bell" class="text-primary size-5" />
        {{ $t('settings.push.title') }}
      </div>
    </template>

    <div class="space-y-4">
      <div v-if="!isSupported" class="rounded-lg bg-slate-100 dark:bg-slate-800 p-3 text-sm text-slate-600 dark:text-slate-300 space-y-2">
        <p>
          {{ $t('settings.push.unsupported') }}
        </p>
        <p v-if="isIos" class="flex items-start gap-2">
          <UIcon name="i-lucide-share" class="size-4 mt-0.5 shrink-0" />
          <span>
            {{ $t('settings.push.iosInstall') }}
          </span>
        </p>
      </div>

      <template v-else>
        <div class="flex items-center justify-between gap-4 min-h-11">
          <div>
            <p class="font-medium">{{ $t('settings.push.notifyOnDevice') }}</p>
            <p class="text-sm text-slate-500">
              {{ $t('settings.push.notifyOnDeviceHelp') }}
            </p>
          </div>
          <USwitch
            :model-value="isSubscribed"
            :disabled="busy || permission === 'denied'"
            @update:model-value="toggle"
          />
        </div>

        <p v-if="permission === 'denied'" class="rounded-lg bg-amber-50 dark:bg-amber-950 p-3 text-sm text-amber-700 dark:text-amber-300">
          {{ $t('settings.push.blockedHelp') }}
        </p>

        <p v-if="isIos && !isSubscribed" class="text-sm text-slate-500">
          {{ $t('settings.push.iosHomeScreen') }}
        </p>

        <UButton
          v-if="isAdmin"
          variant="soft"
          icon="i-lucide-send"
          :loading="testing"
          :disabled="!isSubscribed"
          @click="sendTest"
        >
          {{ $t('settings.push.sendTest') }}
        </UButton>
      </template>
    </div>
  </UCard>
</template>
