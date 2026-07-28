<script setup lang="ts">
const toast = useToast()
const { t } = useI18n()
const { formatDateTime } = useDateFormat()
const { data: feeds, refresh: reload } = await useFetch('/api/feeds')
const { data: household, refresh: refreshHousehold } = await useFetch('/api/household')

const intervals = computed(() => [
  { label: t('calendar.feeds.intervals.min15'), value: 15 },
  { label: t('calendar.feeds.intervals.hourly'), value: 60 },
  { label: t('calendar.feeds.intervals.hours6'), value: 360 },
  { label: t('calendar.feeds.intervals.daily'), value: 1440 },
])

const adding = ref(false)
const saving = ref(false)
const busyId = ref<string | null>(null)
const newFeed = reactive({ name: '', url: '', color: '#64748b', fetchIntervalMinutes: 60 })

const origin = useRequestURL().origin
// icsToken only reaches admins; for everyone else the subscribe box stays hidden.
const icsUrl = computed(() =>
  household.value?.icsToken ? `${origin}/feeds/${household.value.icsToken}.ics` : '')
const webcalUrl = computed(() => icsUrl.value.replace(/^https?:\/\//, 'webcal://'))

const rotating = ref(false)

/** Revokes the old link — nothing else can, since the token IS the auth. */
async function rotateIcsToken() {
  if (!confirm(t('calendar.feeds.subscribe.rotateConfirm'))) return
  rotating.value = true
  try {
    await $fetch('/api/household/ics-token', { method: 'POST' })
    await refreshHousehold()
    toast.add({ title: t('calendar.feeds.toast.rotated'), color: 'success' })
  }
  catch {
    toast.add({ title: t('calendar.feeds.toast.couldNotRotate'), color: 'error' })
  }
  finally {
    rotating.value = false
  }
}

function statusIcon(feed: { lastStatus: string | null }) {
  if (feed.lastStatus === 'ok') return { name: 'i-lucide-circle-check', class: 'text-green-500' }
  if (feed.lastStatus === 'error') return { name: 'i-lucide-circle-alert', class: 'text-red-500' }
  return { name: 'i-lucide-clock', class: 'text-slate-400' }
}

function statusText(feed: { lastStatus: string | null, lastError: string | null, lastFetchedAt?: string | Date | null }) {
  if (feed.lastStatus === 'error') return feed.lastError || t('calendar.feeds.status.failed')
  if (feed.lastStatus === 'ok' && feed.lastFetchedAt) {
    return t('calendar.feeds.status.refreshedAt', { when: formatDateTime(new Date(feed.lastFetchedAt).getTime()) })
  }
  return t('calendar.feeds.status.never')
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
    toast.add({ title: t('calendar.feeds.toast.couldNotAdd'), description: t('calendar.feeds.toast.couldNotAddHelp'), color: 'error' })
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
    toast.add({ title: t('calendar.feeds.toast.couldNotUpdate'), color: 'error' })
  }
}

async function refreshNow(id: string) {
  busyId.value = id
  try {
    const updated = await $fetch(`/api/feeds/${id}/refresh`, { method: 'POST' })
    await reload()
    if (updated?.lastStatus === 'error') {
      toast.add({ title: t('calendar.feeds.toast.refreshFailed'), description: updated.lastError ?? undefined, color: 'error' })
    }
    else {
      toast.add({ title: t('calendar.feeds.toast.refreshed'), color: 'success' })
    }
  }
  catch {
    toast.add({ title: t('calendar.feeds.toast.refreshFailed'), color: 'error' })
  }
  finally {
    busyId.value = null
  }
}

async function removeFeed(id: string, name: string) {
  if (!confirm(t('calendar.feeds.confirmRemove', { name }))) return
  try {
    await $fetch(`/api/feeds/${id}`, { method: 'DELETE' })
    await reload()
  }
  catch {
    toast.add({ title: t('calendar.feeds.toast.couldNotRemove'), color: 'error' })
  }
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.add({ title: t('calendar.feeds.toast.copied'), color: 'success' })
  }
  catch {
    toast.add({ title: t('calendar.feeds.toast.couldNotCopy'), color: 'error' })
  }
}
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center gap-2 font-semibold">
        <UIcon name="i-lucide-calendar-sync" class="text-primary size-5" />
        {{ $t('calendar.feeds.title') }}
      </div>
    </template>

    <div class="space-y-3">
      <p v-if="!feeds?.length && !adding" class="text-sm text-slate-500 dark:text-slate-400">
        {{ $t('calendar.feeds.empty') }}
      </p>

      <div v-for="feed in feeds ?? []" :key="feed.id" class="flex items-center gap-3 min-h-11">
        <span class="size-3 rounded-full shrink-0" :style="{ backgroundColor: feed.color }" />
        <div class="flex-1 min-w-0">
          <div class="font-medium truncate">{{ feed.name }}</div>
          <!-- Host only: the server never sends the full subscription URL,
               because for a private calendar that URL is the credential. -->
          <div class="text-xs text-slate-500 dark:text-slate-400 truncate">{{ feed.urlHost }}</div>
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
          :aria-label="$t('calendar.feeds.refreshNow')"
          @click="refreshNow(feed.id)"
        />
        <UButton
          icon="i-lucide-trash-2"
          variant="ghost"
          color="neutral"
          size="sm"
          :aria-label="$t('calendar.feeds.remove')"
          @click="removeFeed(feed.id, feed.name)"
        />
      </div>

      <div v-if="adding" class="space-y-2 pt-2">
        <div class="flex items-center gap-2">
          <input v-model="newFeed.color" type="color" class="size-9 rounded cursor-pointer border-0 bg-transparent shrink-0">
          <UInput v-model="newFeed.name" :placeholder="$t('calendar.feeds.namePlaceholder')" class="flex-1" autofocus />
        </div>
        <UInput v-model="newFeed.url" :placeholder="$t('calendar.feeds.urlPlaceholder')" class="w-full" @keyup.enter="addFeed" />
        <div class="flex items-center gap-2">
          <USelect v-model="newFeed.fetchIntervalMinutes" :items="intervals" class="w-40" />
          <UButton icon="i-lucide-check" :loading="saving" @click="addFeed">{{ $t('calendar.feeds.add') }}</UButton>
          <UButton variant="ghost" color="neutral" @click="adding = false">{{ $t('common.actions.cancel') }}</UButton>
        </div>
      </div>
      <UButton v-else variant="soft" icon="i-lucide-plus" @click="adding = true">{{ $t('calendar.feeds.add') }}</UButton>

      <div v-if="icsUrl" class="pt-4 mt-4 border-t border-slate-200 dark:border-slate-700 space-y-2">
        <div class="flex items-center gap-2 font-medium text-sm">
          <UIcon name="i-lucide-smartphone" class="size-4 text-primary" />
          {{ $t('calendar.feeds.subscribe.title') }}
        </div>
        <p class="text-xs text-slate-500 dark:text-slate-400">
          {{ $t('calendar.feeds.subscribe.help') }}
        </p>
        <div class="flex items-center gap-2">
          <code class="flex-1 min-w-0 truncate text-xs bg-slate-100 dark:bg-slate-800 rounded px-2 py-2.5">{{ icsUrl }}</code>
          <UButton icon="i-lucide-copy" variant="soft" size="sm" :aria-label="$t('calendar.feeds.subscribe.copyUrl')" @click="copy(icsUrl)" />
        </div>
        <div class="flex items-center gap-2">
          <code class="flex-1 min-w-0 truncate text-xs bg-slate-100 dark:bg-slate-800 rounded px-2 py-2.5">{{ webcalUrl }}</code>
          <UButton icon="i-lucide-copy" variant="soft" size="sm" :aria-label="$t('calendar.feeds.subscribe.copyWebcal')" @click="copy(webcalUrl)" />
        </div>
        <UButton
          icon="i-lucide-key-round"
          variant="ghost"
          color="neutral"
          size="sm"
          :loading="rotating"
          @click="rotateIcsToken"
        >
          {{ $t('calendar.feeds.subscribe.rotate') }}
        </UButton>
      </div>
    </div>
  </UCard>
</template>
