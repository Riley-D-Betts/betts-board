<script setup lang="ts">
import type { ApiKeyCreated, ApiKeyDto } from '#shared/schemas/apiKeys'

const toast = useToast()
const { t } = useI18n()
const { state } = useBoardState()
const { data: keys, refresh: reload } = await useFetch<ApiKeyDto[]>('/api/api-keys')

const creating = ref(false)
const NO_PROFILE = 'none'
const newKey = reactive({ name: '', profileId: NO_PROFILE })
// The token is returned exactly once, at creation — held here until dismissed.
const created = ref<ApiKeyCreated | null>(null)
const copied = ref(false)

const profileItems = computed(() => [
  // Sentinel, not '': Reka's SelectItem throws on an empty-string value.
  { label: t('settings.apiKeys.noProfile'), value: NO_PROFILE },
  ...(state.value?.profiles ?? []).map(p => ({ label: t('settings.apiKeys.actsAsOption', { name: p.name }), value: p.id })),
])

async function createKey() {
  if (!newKey.name.trim()) return
  try {
    created.value = await $fetch('/api/api-keys', {
      method: 'POST',
      body: {
        name: newKey.name.trim(),
        profileId: newKey.profileId === NO_PROFILE ? undefined : newKey.profileId,
      },
    })
    copied.value = false
    newKey.name = ''
    newKey.profileId = NO_PROFILE
    creating.value = false
    await reload()
  }
  catch {
    toast.add({ title: t('settings.apiKeys.createFailed'), color: 'error' })
  }
}

async function copyToken() {
  if (!created.value) return
  try {
    await navigator.clipboard.writeText(created.value.token)
    copied.value = true
    toast.add({ title: t('settings.apiKeys.tokenCopied'), color: 'success' })
  }
  catch {
    toast.add({ title: t('settings.apiKeys.copyFailed'), color: 'error' })
  }
}

async function revokeKey(key: ApiKeyDto) {
  if (!confirm(t('settings.apiKeys.revokeConfirm', { name: key.name }))) return
  try {
    await $fetch(`/api/api-keys/${key.id}`, { method: 'DELETE' })
    await reload()
  }
  catch {
    toast.add({ title: t('settings.apiKeys.revokeFailed'), color: 'error' })
  }
}

function timeAgo(epochMs: number) {
  const mins = Math.round((Date.now() - epochMs) / 60_000)
  if (mins < 1) return t('settings.apiKeys.justNow')
  if (mins < 60) return t('settings.apiKeys.minutesAgo', { n: mins })
  const hours = Math.round(mins / 60)
  if (hours < 24) return t('settings.apiKeys.hoursAgo', { n: hours })
  const days = Math.round(hours / 24)
  if (days < 30) return t('settings.apiKeys.daysAgo', { n: days })
  return new Date(epochMs).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center gap-2 font-semibold">
        <UIcon name="i-lucide-key-round" class="text-primary size-5" />
        {{ $t('settings.apiKeys.title') }}
      </div>
    </template>
    <div class="space-y-4">
      <p class="text-sm text-slate-500 dark:text-slate-400">
        {{ $t('settings.apiKeys.intro') }}
        <!-- i18n-t so the link and the path stay inside one translatable sentence. -->
        <i18n-t keypath="settings.apiKeys.docsHint" tag="span" scope="global">
          <template #link>
            <a href="/docs" target="_blank" class="text-primary hover:underline">{{ $t('settings.apiKeys.docsLinkText') }}</a>
          </template>
          <template #path>
            <code class="font-mono text-xs">/docs</code>
          </template>
        </i18n-t>
      </p>

      <div
        v-if="created"
        class="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/50 p-3 space-y-2"
      >
        <div class="text-sm font-medium text-amber-800 dark:text-amber-200">
          {{ $t('settings.apiKeys.tokenNotice', { name: created.name }) }}
        </div>
        <div class="flex items-center gap-2">
          <code class="flex-1 min-w-0 font-mono text-xs break-all select-all rounded bg-white dark:bg-slate-900 px-2 py-2">{{ created.token }}</code>
          <UButton
            :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
            color="warning"
            variant="soft"
            :aria-label="$t('settings.apiKeys.copyToken')"
            @click="copyToken"
          />
        </div>
        <UButton size="xs" variant="ghost" color="neutral" @click="created = null">{{ $t('settings.apiKeys.hideToken') }}</UButton>
      </div>

      <p v-if="!keys?.length" class="text-sm text-slate-500 dark:text-slate-400">{{ $t('settings.apiKeys.empty') }}</p>
      <div v-for="k in keys ?? []" :key="k.id" class="flex items-center gap-3 min-h-11">
        <div class="flex-1 min-w-0">
          <div
            class="font-medium truncate"
            :class="k.revoked && 'line-through text-slate-400 dark:text-slate-500'"
          >
            {{ k.name }}
          </div>
          <div class="text-xs text-slate-500 dark:text-slate-400">
            {{ $t('settings.apiKeys.createdAgo', { time: timeAgo(k.createdAt) }) }}
            · {{ k.lastUsedAt ? $t('settings.apiKeys.lastUsedAgo', { time: timeAgo(k.lastUsedAt) }) : $t('settings.apiKeys.neverUsed') }}
          </div>
        </div>
        <UBadge v-if="k.revoked" :label="$t('settings.apiKeys.revoked')" color="neutral" variant="soft" />
        <UBadge v-else-if="k.profileName" :label="$t('settings.apiKeys.actsAsBadge', { name: k.profileName })" variant="soft" />
        <span v-else class="text-xs text-slate-400 dark:text-slate-500">{{ $t('settings.apiKeys.readMostly') }}</span>
        <UButton
          v-if="!k.revoked"
          icon="i-lucide-trash-2"
          variant="ghost"
          color="neutral"
          size="sm"
          :aria-label="$t('settings.apiKeys.revokeKey')"
          @click="revokeKey(k)"
        />
      </div>

      <div v-if="creating" class="flex flex-wrap items-center gap-2 pt-2">
        <UInput
          v-model="newKey.name"
          :placeholder="$t('settings.apiKeys.namePlaceholder')"
          class="flex-1 min-w-40"
          autofocus
          @keyup.enter="createKey"
        />
        <USelect v-model="newKey.profileId" :items="profileItems" class="w-60" />
        <UButton icon="i-lucide-check" @click="createKey">{{ $t('settings.apiKeys.create') }}</UButton>
      </div>
      <UButton v-else variant="soft" icon="i-lucide-plus" @click="creating = true">{{ $t('settings.apiKeys.createKey') }}</UButton>
    </div>
  </UCard>
</template>
