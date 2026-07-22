function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/** Web-push subscription state for this device. Call refresh() on mount. */
export function usePush() {
  const isSupported = ref(false)
  const permission = ref<NotificationPermission | null>(null)
  const isSubscribed = ref(false)
  const busy = ref(false)

  function detectSupport() {
    isSupported.value = import.meta.client
      && 'serviceWorker' in navigator
      && 'PushManager' in window
      && 'Notification' in window
  }

  async function refresh() {
    detectSupport()
    if (!isSupported.value) return
    permission.value = Notification.permission
    // getRegistration (not .ready) so this never hangs when no SW is registered (dev).
    const registration = await navigator.serviceWorker.getRegistration()
    const sub = await registration?.pushManager.getSubscription()
    isSubscribed.value = !!sub
  }

  async function subscribe(): Promise<boolean> {
    if (!isSupported.value) return false
    busy.value = true
    try {
      permission.value = await Notification.requestPermission()
      if (permission.value !== 'granted') return false

      const { publicKey } = await $fetch<{ publicKey: string }>('/api/push/public-key')
      const registration = await navigator.serviceWorker.ready
      const sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      })
      const keys = sub.toJSON().keys
      if (!keys?.p256dh || !keys.auth) throw new Error('subscription is missing keys')

      await $fetch('/api/push/subscribe', {
        method: 'POST',
        body: {
          endpoint: sub.endpoint,
          keys: { p256dh: keys.p256dh, auth: keys.auth },
          userAgent: navigator.userAgent,
        },
      })
      isSubscribed.value = true
      return true
    }
    finally {
      busy.value = false
    }
  }

  async function unsubscribe(): Promise<void> {
    if (!isSupported.value) return
    busy.value = true
    try {
      const registration = await navigator.serviceWorker.getRegistration()
      const sub = await registration?.pushManager.getSubscription()
      if (sub) {
        await $fetch('/api/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } })
        await sub.unsubscribe()
      }
      isSubscribed.value = false
    }
    finally {
      busy.value = false
    }
  }

  return { isSupported, permission, isSubscribed, busy, refresh, subscribe, unsubscribe }
}
