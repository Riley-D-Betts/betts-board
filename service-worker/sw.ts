/// <reference lib="webworker" />
/* eslint-disable @typescript-eslint/no-explicit-any */
import { precacheAndRoute } from 'workbox-precaching'

declare let self: any

precacheAndRoute(self.__WB_MANIFEST)

self.addEventListener('push', (event: any) => {
  let data: { title?: string, body?: string, url?: string }
  try {
    data = event.data?.json() ?? {}
  }
  catch {
    data = { title: event.data?.text() }
  }
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'Betts Board', {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: data.url },
    }),
  )
})

self.addEventListener('notificationclick', (event: any) => {
  event.notification.close()
  const url = event.notification.data?.url || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients: any[]) => {
      const existing = clients.find(c => 'focus' in c)
      if (existing) {
        existing.navigate?.(url)
        return existing.focus()
      }
      return self.clients.openWindow(url)
    }),
  )
})
