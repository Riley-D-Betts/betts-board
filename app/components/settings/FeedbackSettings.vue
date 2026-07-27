<script setup lang="ts">
import type { FeedbackStatus } from '#shared/schemas/feedback'

const toast = useToast()
const { t } = useI18n()
const { data: status, refresh } = await useFetch<FeedbackStatus>('/api/feedback/status')

const repo = ref(status.value?.repo ?? '')
const token = ref('')
const saving = ref(false)
const testing = ref(false)
const disconnecting = ref(false)
const testResult = ref<{ ok: boolean, message: string } | null>(null)

const repoValid = computed(() => /^[\w.-]+\/[\w.-]+$/.test(repo.value.trim()))

async function save() {
  if (!repoValid.value) {
    toast.add({ title: t('feedback.settings.errors.invalidRepo'), color: 'error' })
    return
  }
  saving.value = true
  try {
    await $fetch('/api/feedback/settings', {
      method: 'PUT',
      body: {
        repo: repo.value.trim(),
        // Omit the token to keep the one already stored on the server.
        ...(token.value.trim() && { token: token.value.trim() }),
      },
    })
    token.value = ''
    testResult.value = null
    await refresh()
    toast.add({ title: t('feedback.settings.saved'), color: 'success' })
  }
  catch (err) {
    const e = err as { data?: { statusMessage?: string } }
    toast.add({ title: e.data?.statusMessage ?? t('feedback.settings.errors.couldNotSave'), color: 'error' })
  }
  finally {
    saving.value = false
  }
}

async function testConnection() {
  testing.value = true
  testResult.value = null
  try {
    const res = await $fetch<{ ok: true, repoFullName: string }>('/api/feedback/test', { method: 'POST' })
    testResult.value = { ok: true, message: t('feedback.settings.connected', { repo: res.repoFullName }) }
  }
  catch (err) {
    const e = err as { statusCode?: number, data?: { statusMessage?: string } }
    testResult.value = {
      ok: false,
      message: e.statusCode === 409
        ? t('feedback.settings.errors.needsSetup')
        : e.data?.statusMessage ?? t('feedback.errors.couldNotReach'),
    }
  }
  finally {
    testing.value = false
  }
}

async function disconnect() {
  if (!confirm(t('feedback.settings.disconnectConfirm'))) return
  disconnecting.value = true
  try {
    await $fetch('/api/feedback/settings', { method: 'PUT', body: { repo: null } })
    repo.value = ''
    token.value = ''
    testResult.value = null
    await refresh()
    toast.add({ title: t('feedback.settings.disconnected'), color: 'success' })
  }
  catch {
    toast.add({ title: t('feedback.settings.errors.couldNotDisconnect'), color: 'error' })
  }
  finally {
    disconnecting.value = false
  }
}
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center gap-2 font-semibold">
        <UIcon name="i-lucide-megaphone" class="text-primary size-5" />
        {{ $t('feedback.settings.title') }}
      </div>
    </template>
    <div class="space-y-4">
      <!-- i18n-t so both links stay inside one translatable sentence. -->
      <i18n-t
        keypath="feedback.settings.intro"
        tag="p"
        scope="global"
        class="text-sm text-slate-500 dark:text-slate-400"
      >
        <template #link>
          <NuxtLink to="/feedback" class="text-primary hover:underline">{{ $t('feedback.settings.introLinkText') }}</NuxtLink>
        </template>
        <template #tokenLink>
          <a
            href="https://github.com/settings/personal-access-tokens"
            target="_blank"
            class="text-primary hover:underline"
          >{{ $t('feedback.settings.introTokenLinkText') }}</a>
        </template>
      </i18n-t>

      <!-- Current status -->
      <div class="flex items-center gap-2 text-sm">
        <span
          class="size-2 rounded-full shrink-0"
          :class="status?.configured ? 'bg-green-500' : 'bg-slate-300 dark:bg-slate-600'"
        />
        <!-- i18n-t so the repo name keeps its code styling inside one translatable sentence. -->
        <i18n-t
          v-if="status?.configured"
          keypath="feedback.settings.connected"
          tag="span"
          scope="global"
          class="text-slate-600 dark:text-slate-300"
        >
          <template #repo>
            <code class="font-mono text-xs">{{ status.repo }}</code>
          </template>
        </i18n-t>
        <span v-else class="text-slate-500 dark:text-slate-400">{{ $t('feedback.settings.notConnected') }}</span>
      </div>

      <UFormField :label="$t('feedback.settings.repoLabel')" :help="$t('feedback.settings.repoHelp')">
        <UInput v-model="repo" placeholder="Riley-D-Betts/betts-board" class="w-full" />
      </UFormField>
      <UFormField
        :label="$t('feedback.settings.tokenLabel')"
        :help="status?.configured
          ? $t('feedback.settings.tokenHelpStored')
          : $t('feedback.settings.tokenHelp')"
      >
        <UInput v-model="token" type="password" placeholder="ghp_… or github_pat_…" class="w-full" />
      </UFormField>

      <div
        v-if="testResult"
        class="flex items-center gap-2 text-sm"
        :class="testResult.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'"
      >
        <UIcon :name="testResult.ok ? 'i-lucide-check-circle-2' : 'i-lucide-alert-triangle'" class="size-4 shrink-0" />
        {{ testResult.message }}
      </div>

      <div class="flex flex-wrap gap-2">
        <UButton icon="i-lucide-save" :loading="saving" @click="save">{{ $t('common.actions.save') }}</UButton>
        <UButton
          icon="i-lucide-radio-tower"
          variant="soft"
          color="neutral"
          :loading="testing"
          :disabled="!status?.configured"
          @click="testConnection"
        >
          {{ $t('feedback.settings.test') }}
        </UButton>
        <UButton
          v-if="status?.configured"
          icon="i-lucide-unplug"
          variant="ghost"
          color="error"
          :loading="disconnecting"
          @click="disconnect"
        >
          {{ $t('feedback.settings.disconnect') }}
        </UButton>
      </div>
    </div>
  </UCard>
</template>
