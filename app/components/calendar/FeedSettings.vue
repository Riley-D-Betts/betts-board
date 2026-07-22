<script setup lang="ts">
const toast = useToast()
const { data: feeds, refresh: reload } = await useFetch('/api/feeds')
const { data: household } = await useFetch('/api/household')

const intervals = [
  { label: 'Every 15 min', value: 15 },
  { label: 'Hourly', value: 60 },
  { label: 'Every 6 hours', value: 360 },
  { label: 'Daily', value: 1440 },
]

const adding = ref(false)
const saving = ref(false)
const busyId = ref<string | null>(null)
const newFeed = reactive({ name: '', url: '', color: '#64748b', fetchIntervalMinutes: 60 })

const origin = useRequestURL().origin
const icsUrl = computed(() =>
  household.value?.icsToken ? `${origin}/feeds/${household.value.icsToken}.ics` : '')
const webcalUrl = computed(() => icsUrl.value.replace(/^https?:\/\//, 'webcal://'))

function statusIcon(feed: { lastStatus: string | null }) {
  if (feed.lastStatus === 'ok') return { name: 'i-lucide-circle-check', class: 'text-green-500' }
  if (feed.lastStatus === 'error') return { name: 'i-lucide-circle-alert', class: 'text-red-500' }
  return { name: 'i-lucide-clock', class: 'text-slate-400' }
}

function statusText(feed: { lastStatus: string | null, lastError: string | null, lastFetchedAt?: string | Date | null }) {
  if (feed.lastStatus === 'error') return feed.lastError || 'Last refresh failed'
  if (feed.lastStatus === 'ok' && feed.lastFetchedAt) {
    return `Last refreshed ${new Date(feed.lastFetchedAt).toLocaleString()}`
  }
  return 'Not fetched yet'
}

async function addFeed() {
  if (!newFeed.name.trim() || !newFeed.url.trim()) return
  saving.value = true
  try {
    await $fetch('/api/feeds', {
      method: 'POST',
      body: { ...newFeed, name: newFeed.name.trim(), url: newFeed.url.trim() },
    })
    Object.assign(newFeed, { name: '', url: '', color: '#64748b', fetchIntervalMinutes: 60 })
    adding.value = false
    await reload()
  }
  catch {
    toast.add({ title: 'Could not add feed', description: 'Check the URL and try again.', color: 'error' })
  }
  finally {
    saving.value = false
  }
}

async function toggleFeed(id: string, enabled: boolean) {
  try {
    await $fetch(`/api/feeds/${id}`, { method: 'PATCH', body: { enabled } })
    await reload()
  }
  catch {
    toast.add({ title: 'Could not update feed', color: 'error' })
  }
}

async function refreshNow(id: string) {
  busyId.value = id
  try {
    const updated = await $fetch(`/api/feeds/${id}/refresh`, { method: 'POST' })
    await reload()
    if (updated?.lastStatus === 'error') {
      toast.add({ title: 'Refresh failed', description: updated.lastError ?? undefined, color: 'error' })
    }
    else {
      toast.add({ title: 'Feed refreshed', color: 'success' })
    }
  }
  catch {
    toast.add({ title: 'Refresh failed', color: 'error' })
  }
  finally {
    busyId.value = null
  }
}

async function removeFeed(id: string, name: string) {
  if (!confirm(`Remove the "${name}" feed? Its imported events disappear from the calendar.`)) return
  try {
    await $fetch(`/api/feeds/${id}`, { method: 'DELETE' })
    await reload()
  }
  catch {
    toast.add({ title: 'Could not remove feed', color: 'error' })
  }
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.add({ title: 'Copied to clipboard', color: 'success' })
  }
  catch {
    toast.add({ title: 'Could not copy', color: 'error' })
  }
}
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center gap-2 font-semibold">
        <UIcon name="i-lucide-calendar-sync" class="text-primary size-5" />
        Calendar feeds
      </div>
    </template>

    <div class="space-y-3">
      <p v-if="!feeds?.length && !adding" class="text-sm text-slate-500 dark:text-slate-400">
        Subscribe to school, sports or work calendars — their events show up read-only on the board.
      </p>

      <div v-for="feed in feeds ?? []" :key="feed.id" class="flex items-center gap-3 min-h-11">
        <span class="size-3 rounded-full shrink-0" :style="{ backgroundColor: feed.color }" />
        <div class="flex-1 min-w-0">
          <div class="font-medium truncate">{{ feed.name }}</div>
          <div class="text-xs text-slate-500 dark:text-slate-400 truncate">{{ feed.url }}</div>
        </div>
        <UTooltip :text="statusText(feed)">
          <UIcon :name="statusIcon(feed).name" class="size-5 shrink-0" :class="statusIcon(feed).class" />
        </UTooltip>
        <USwitch :model-value="feed.enabled" @update:model-value="toggleFeed(feed.id, $event)" />
        <UButton
          icon="i-lucide-refresh-cw"
          variant="ghost"
          color="neutral"
          size="sm"
          :loading="busyId === feed.id"
          aria-label="Refresh now"
          @click="refreshNow(feed.id)"
        />
        <UButton
          icon="i-lucide-trash-2"
          variant="ghost"
          color="neutral"
          size="sm"
          aria-label="Remove feed"
          @click="removeFeed(feed.id, feed.name)"
        />
      </div>

      <div v-if="adding" class="space-y-2 pt-2">
        <div class="flex items-center gap-2">
          <input v-model="newFeed.color" type="color" class="size-9 rounded cursor-pointer border-0 bg-transparent shrink-0">
          <UInput v-model="newFeed.name" placeholder="Name (e.g. School)" class="flex-1" autofocus />
        </div>
        <UInput v-model="newFeed.url" placeholder="https://… or webcal://… .ics URL" class="w-full" @keyup.enter="addFeed" />
        <div class="flex items-center gap-2">
          <USelect v-model="newFeed.fetchIntervalMinutes" :items="intervals" class="w-40" />
          <UButton icon="i-lucide-check" :loading="saving" @click="addFeed">Add feed</UButton>
          <UButton variant="ghost" color="neutral" @click="adding = false">Cancel</UButton>
        </div>
      </div>
      <UButton v-else variant="soft" icon="i-lucide-plus" @click="adding = true">Add feed</UButton>

      <div v-if="icsUrl" class="pt-4 mt-4 border-t border-slate-200 dark:border-slate-700 space-y-2">
        <div class="flex items-center gap-2 font-medium text-sm">
          <UIcon name="i-lucide-smartphone" class="size-4 text-primary" />
          Subscribe on your phone
        </div>
        <p class="text-xs text-slate-500 dark:text-slate-400">
          Add this URL as a calendar subscription in Google Calendar or Apple Calendar
          to see the board's events everywhere. Keep it private — the link is the key.
        </p>
        <div class="flex items-center gap-2">
          <code class="flex-1 min-w-0 truncate text-xs bg-slate-100 dark:bg-slate-800 rounded px-2 py-2.5">{{ icsUrl }}</code>
          <UButton icon="i-lucide-copy" variant="soft" size="sm" aria-label="Copy URL" @click="copy(icsUrl)" />
        </div>
        <div class="flex items-center gap-2">
          <code class="flex-1 min-w-0 truncate text-xs bg-slate-100 dark:bg-slate-800 rounded px-2 py-2.5">{{ webcalUrl }}</code>
          <UButton icon="i-lucide-copy" variant="soft" size="sm" aria-label="Copy webcal URL" @click="copy(webcalUrl)" />
        </div>
      </div>
    </div>
  </UCard>
</template>
