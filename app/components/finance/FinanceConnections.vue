<script setup lang="ts">
interface Connection {
  id: string
  nickname: string | null
  status: string
  credentialsReadable: boolean
  syncIntervalMinutes: number
  lastSyncAt: number | null
  nextAttemptAt: number | null
  lastError: string | null
  lastErrorList: string[] | null
  accountCount: number
}

const props = defineProps<{ isOwner: boolean }>()

const { t } = useI18n()
const toast = useToast()
const { formatRelative } = useDateFormat()

const { data: connections, refresh } = await useFetch<Connection[]>('/api/finance/connections', {
  default: () => [],
})

const connectOpen = ref(false)
const reconnectId = ref<string | null>(null)
const setupToken = ref('')
const nickname = ref('')
const busy = ref(false)
const error = ref('')
const syncingId = ref<string | null>(null)

const STATUS_COLOR: Record<string, 'success' | 'warning' | 'error' | 'neutral'> = {
  ok: 'success',
  partial: 'warning',
  needs_reauth: 'warning',
  error: 'error',
  disabled: 'neutral',
}

async function connect() {
  busy.value = true
  error.value = ''
  try {
    if (reconnectId.value) {
      await $fetch(`/api/finance/connections/${reconnectId.value}/reconnect`, {
        method: 'POST',
        body: { setupToken: setupToken.value.trim() },
      })
    }
    else {
      await $fetch('/api/finance/connections', {
        method: 'POST',
        body: { setupToken: setupToken.value.trim(), nickname: nickname.value.trim() || undefined },
      })
    }
    connectOpen.value = false
    reconnectId.value = null
    setupToken.value = ''
    nickname.value = ''
    toast.add({ title: t('finance.toast.connected'), color: 'success' })
    await refresh()
    bumpDataTick()
  }
  catch (e) {
    // The server has already mapped and sanitised this; never show a raw one.
    error.value = (e as { statusMessage?: string }).statusMessage || 'Could not connect.'
  }
  finally {
    busy.value = false
  }
}

async function syncNow(connection: Connection) {
  syncingId.value = connection.id
  try {
    await $fetch(`/api/finance/connections/${connection.id}`, { method: 'POST' })
    toast.add({ title: t('finance.toast.synced'), color: 'success' })
    await refresh()
    bumpDataTick()
  }
  finally {
    syncingId.value = null
  }
}

async function disconnect(connection: Connection) {
  if (!confirm(t('finance.connections.disconnectConfirm'))) return
  await $fetch(`/api/finance/connections/${connection.id}`, { method: 'DELETE' })
  toast.add({ title: t('finance.toast.deleted'), color: 'neutral' })
  await refresh()
  bumpDataTick()
}

function openReconnect(connection: Connection) {
  reconnectId.value = connection.id
  setupToken.value = ''
  error.value = ''
  connectOpen.value = true
}

function openConnect() {
  reconnectId.value = null
  setupToken.value = ''
  nickname.value = ''
  error.value = ''
  connectOpen.value = true
}
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center justify-between gap-2">
        <h2 class="font-semibold">{{ $t('finance.connections.title') }}</h2>
        <UButton v-if="props.isOwner" icon="i-lucide-plus" size="sm" @click="openConnect">
          {{ $t('finance.connections.connect') }}
        </UButton>
      </div>
    </template>

    <div v-if="connections.length" class="divide-y divide-slate-200 dark:divide-slate-800">
      <div v-for="connection in connections" :key="connection.id" class="space-y-2 py-3">
        <div class="flex flex-wrap items-center gap-2">
          <span class="min-w-0 flex-1 truncate text-sm font-medium">
            {{ connection.nickname || 'SimpleFIN' }}
          </span>
          <UBadge :color="STATUS_COLOR[connection.status] ?? 'neutral'" variant="subtle" size="sm">
            {{ $t(`finance.connections.status.${connection.status}`) }}
          </UBadge>
        </div>

        <p class="text-xs text-slate-500 dark:text-slate-400">
          {{ $t('finance.connections.accountsCount', connection.accountCount) }}
          ·
          <!-- ClientOnly: a relative time rendered on the server disagrees
               with the client as soon as the second ticks over. -->
          <template v-if="connection.lastSyncAt">
            <ClientOnly>
              {{ $t('finance.connections.lastSynced', { time: formatRelative(connection.lastSyncAt) }) }}
            </ClientOnly>
          </template>
          <template v-else>{{ $t('finance.connections.neverSynced') }}</template>
        </p>

        <!-- Derived at read time from the CURRENT key, not stored. -->
        <p
          v-if="!connection.credentialsReadable"
          class="rounded-lg bg-rose-50 p-2 text-xs text-rose-800 dark:bg-rose-950/40 dark:text-rose-200"
        >
          {{ $t('finance.connections.credentialsUnreadable') }}
        </p>
        <p v-else-if="connection.lastError" class="text-xs text-rose-600 dark:text-rose-400">
          {{ connection.lastError }}
        </p>

        <!-- Attributed to the bank, so nobody thinks the board is broken. -->
        <p
          v-for="message in connection.lastErrorList ?? []"
          :key="message"
          class="text-xs text-amber-600 dark:text-amber-400"
        >
          {{ $t('finance.connections.bankSays', { message }) }}
        </p>

        <div class="flex flex-wrap gap-2">
          <UButton
            size="sm"
            variant="soft"
            class="min-h-11"
            :loading="syncingId === connection.id"
            @click="syncNow(connection)"
          >
            {{ syncingId === connection.id ? $t('finance.connections.syncing') : $t('finance.connections.syncNow') }}
          </UButton>
          <UButton
            v-if="props.isOwner"
            size="sm"
            color="neutral"
            variant="ghost"
            class="min-h-11"
            @click="openReconnect(connection)"
          >
            {{ $t('finance.connections.reconnect') }}
          </UButton>
          <UButton
            v-if="props.isOwner"
            size="sm"
            color="error"
            variant="ghost"
            class="min-h-11"
            @click="disconnect(connection)"
          >
            {{ $t('finance.connections.disconnect') }}
          </UButton>
        </div>
      </div>
    </div>
    <p v-else class="py-2 text-sm text-slate-500 dark:text-slate-400">
      {{ $t('finance.connections.empty') }}
    </p>

    <template #footer>
      <!-- Say exactly what the encryption does and doesn't do. Implying more
           would be worse than not having it. -->
      <p class="text-xs text-slate-500 dark:text-slate-400">
        {{ $t('finance.connections.encryptionNote') }}
      </p>
    </template>

    <UModal
      v-model:open="connectOpen"
      :title="reconnectId ? $t('finance.connections.reconnect') : $t('finance.connections.connect')"
    >
      <template #body>
        <form class="space-y-4" @submit.prevent="connect">
          <UFormField
            :label="$t('finance.connections.setupToken')"
            :help="$t('finance.connections.setupTokenHelp')"
          >
            <UTextarea v-model="setupToken" :rows="4" class="w-full" autofocus />
          </UFormField>

          <UFormField v-if="!reconnectId" :label="$t('finance.connections.nickname')">
            <UInput v-model="nickname" class="w-full" />
          </UFormField>

          <p class="text-xs text-slate-500 dark:text-slate-400">
            {{ $t('finance.connections.firstSyncNote') }}
          </p>
          <p v-if="error" class="text-sm text-red-600 dark:text-red-400">{{ error }}</p>

          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="ghost" @click="connectOpen = false">
              {{ $t('common.actions.cancel') }}
            </UButton>
            <UButton type="submit" :loading="busy" :disabled="!setupToken.trim()">
              {{ $t('finance.connections.connect') }}
            </UButton>
          </div>
        </form>
      </template>
    </UModal>
  </UCard>
</template>
