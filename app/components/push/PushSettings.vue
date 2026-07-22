<script setup lang="ts">
const toast = useToast()
const { isAdmin } = useBoardState()
const { isSupported, permission, isSubscribed, busy, refresh, subscribe, unsubscribe } = usePush()

onMounted(refresh)

const isIos = computed(() =>
  import.meta.client && /iPhone|iPad|iPod/.test(navigator.userAgent))

async function toggle(on: boolean) {
  try {
    if (on) {
      const ok = await subscribe()
      if (ok) toast.add({ title: 'Notifications enabled on this device', color: 'success' })
      else if (permission.value === 'denied') toast.add({ title: 'Notifications are blocked in your browser settings', color: 'error' })
    }
    else {
      await unsubscribe()
      toast.add({ title: 'Notifications disabled on this device', color: 'success' })
    }
  }
  catch {
    toast.add({ title: 'Could not update notifications', color: 'error' })
  }
}

const testing = ref(false)
async function sendTest() {
  testing.value = true
  try {
    const res = await $fetch<{ sent: number, total: number }>('/api/push/test', { method: 'POST' })
    if (res.total === 0) toast.add({ title: 'No subscribed devices for your profile yet', color: 'warning' })
    else toast.add({ title: `Test sent to ${res.sent} of ${res.total} device${res.total === 1 ? '' : 's'}`, color: 'success' })
  }
  catch {
    toast.add({ title: 'Could not send test notification', color: 'error' })
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
        Notifications
      </div>
    </template>

    <div class="space-y-4">
      <div v-if="!isSupported" class="rounded-lg bg-slate-100 dark:bg-slate-800 p-3 text-sm text-slate-600 dark:text-slate-300 space-y-2">
        <p>
          Push notifications aren't available here. They need a secure (HTTPS)
          connection and a browser that supports web push.
        </p>
        <p v-if="isIos" class="flex items-start gap-2">
          <UIcon name="i-lucide-share" class="size-4 mt-0.5 shrink-0" />
          <span>
            On iPhone and iPad, first add Betts Board to your Home Screen
            (Share → Add to Home Screen), then enable notifications from the
            installed app.
          </span>
        </p>
      </div>

      <template v-else>
        <div class="flex items-center justify-between gap-4 min-h-11">
          <div>
            <p class="font-medium">Notify on this device</p>
            <p class="text-sm text-slate-500">
              Event reminders and chore due-times for your profile arrive as
              push notifications.
            </p>
          </div>
          <USwitch
            :model-value="isSubscribed"
            :disabled="busy || permission === 'denied'"
            @update:model-value="toggle"
          />
        </div>

        <p v-if="permission === 'denied'" class="rounded-lg bg-amber-50 dark:bg-amber-950 p-3 text-sm text-amber-700 dark:text-amber-300">
          Notifications are blocked for this site. Allow them in your browser's
          site settings (the lock icon in the address bar), then try again.
        </p>

        <p v-if="isIos && !isSubscribed" class="text-sm text-slate-500">
          On iPhone and iPad this only works from the Home Screen app
          (Share → Add to Home Screen).
        </p>

        <UButton
          v-if="isAdmin"
          variant="soft"
          icon="i-lucide-send"
          :loading="testing"
          :disabled="!isSubscribed"
          @click="sendTest"
        >
          Send test notification
        </UButton>
      </template>
    </div>
  </UCard>
</template>
