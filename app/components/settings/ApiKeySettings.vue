<script setup lang="ts">
import type { ApiKeyCreated, ApiKeyDto } from '#shared/schemas/apiKeys'

const toast = useToast()
const { state } = useBoardState()
const { data: keys, refresh: reload } = await useFetch<ApiKeyDto[]>('/api/api-keys')

const creating = ref(false)
const newKey = reactive({ name: '', profileId: '' })
// The token is returned exactly once, at creation — held here until dismissed.
const created = ref<ApiKeyCreated | null>(null)
const copied = ref(false)

const profileItems = computed(() => [
  { label: 'No acting profile (read-mostly)', value: '' },
  ...(state.value?.profiles ?? []).map(p => ({ label: `Acts as ${p.name}`, value: p.id })),
])

async function createKey() {
  if (!newKey.name.trim()) return
  try {
    created.value = await $fetch('/api/api-keys', {
      method: 'POST',
      body: { name: newKey.name.trim(), profileId: newKey.profileId || undefined },
    })
    copied.value = false
    newKey.name = ''
    newKey.profileId = ''
    creating.value = false
    await reload()
  }
  catch {
    toast.add({ title: 'Could not create the key', color: 'error' })
  }
}

async function copyToken() {
  if (!created.value) return
  try {
    await navigator.clipboard.writeText(created.value.token)
    copied.value = true
    toast.add({ title: 'Token copied', color: 'success' })
  }
  catch {
    toast.add({ title: 'Copy failed — select the token and copy it manually', color: 'error' })
  }
}

async function revokeKey(key: ApiKeyDto) {
  if (!confirm(`Revoke "${key.name}"? Anything using this key stops working immediately.`)) return
  try {
    await $fetch(`/api/api-keys/${key.id}`, { method: 'DELETE' })
    await reload()
  }
  catch {
    toast.add({ title: 'Could not revoke the key', color: 'error' })
  }
}

function timeAgo(epochMs: number) {
  const mins = Math.round((Date.now() - epochMs) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(epochMs).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center gap-2 font-semibold">
        <UIcon name="i-lucide-key-round" class="text-primary size-5" />
        API access
      </div>
    </template>
    <div class="space-y-4">
      <p class="text-sm text-slate-500 dark:text-slate-400">
        Let other apps — Home Assistant, scripts — read and update the board.
        Endpoint reference: <a href="/docs" target="_blank" class="text-primary hover:underline">interactive API docs</a>
        (served by this board at <code class="font-mono text-xs">/docs</code>).
      </p>

      <div
        v-if="created"
        class="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/50 p-3 space-y-2"
      >
        <div class="text-sm font-medium text-amber-800 dark:text-amber-200">
          Token for “{{ created.name }}” — save it now, it won't be shown again.
        </div>
        <div class="flex items-center gap-2">
          <code class="flex-1 min-w-0 font-mono text-xs break-all select-all rounded bg-white dark:bg-slate-900 px-2 py-2">{{ created.token }}</code>
          <UButton
            :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
            color="warning"
            variant="soft"
            aria-label="Copy token"
            @click="copyToken"
          />
        </div>
        <UButton size="xs" variant="ghost" color="neutral" @click="created = null">Done — hide token</UButton>
      </div>

      <p v-if="!keys?.length" class="text-sm text-slate-500 dark:text-slate-400">No keys yet.</p>
      <div v-for="k in keys ?? []" :key="k.id" class="flex items-center gap-3 min-h-11">
        <div class="flex-1 min-w-0">
          <div
            class="font-medium truncate"
            :class="k.revoked && 'line-through text-slate-400 dark:text-slate-500'"
          >
            {{ k.name }}
          </div>
          <div class="text-xs text-slate-500 dark:text-slate-400">
            created {{ timeAgo(k.createdAt) }}
            · {{ k.lastUsedAt ? `last used ${timeAgo(k.lastUsedAt)}` : 'never used' }}
          </div>
        </div>
        <UBadge v-if="k.revoked" label="revoked" color="neutral" variant="soft" />
        <UBadge v-else-if="k.profileName" :label="`acts as ${k.profileName}`" variant="soft" />
        <span v-else class="text-xs text-slate-400 dark:text-slate-500">read-mostly</span>
        <UButton
          v-if="!k.revoked"
          icon="i-lucide-trash-2"
          variant="ghost"
          color="neutral"
          size="sm"
          aria-label="Revoke key"
          @click="revokeKey(k)"
        />
      </div>

      <div v-if="creating" class="flex flex-wrap items-center gap-2 pt-2">
        <UInput
          v-model="newKey.name"
          placeholder="Name (e.g. Home Assistant)"
          class="flex-1 min-w-40"
          autofocus
          @keyup.enter="createKey"
        />
        <USelect v-model="newKey.profileId" :items="profileItems" class="w-60" />
        <UButton icon="i-lucide-check" @click="createKey">Create</UButton>
      </div>
      <UButton v-else variant="soft" icon="i-lucide-plus" @click="creating = true">Create key</UButton>
    </div>
  </UCard>
</template>
