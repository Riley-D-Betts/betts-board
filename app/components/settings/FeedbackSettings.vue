<script setup lang="ts">
import type { FeedbackStatus } from '#shared/schemas/feedback'

const toast = useToast()
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
    toast.add({ title: 'Repo must look like owner/repo', color: 'error' })
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
    toast.add({ title: 'Feedback settings saved', color: 'success' })
  }
  catch (err) {
    const e = err as { data?: { statusMessage?: string } }
    toast.add({ title: e.data?.statusMessage ?? 'Could not save feedback settings', color: 'error' })
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
    testResult.value = { ok: true, message: `Connected to ${res.repoFullName}` }
  }
  catch (err) {
    const e = err as { statusCode?: number, data?: { statusMessage?: string } }
    testResult.value = {
      ok: false,
      message: e.statusCode === 409
        ? 'Save a repo and token first'
        : e.data?.statusMessage ?? 'Could not reach GitHub',
    }
  }
  finally {
    testing.value = false
  }
}

async function disconnect() {
  if (!confirm('Disconnect GitHub? The saved token is deleted and family members can no longer send feedback.')) return
  disconnecting.value = true
  try {
    await $fetch('/api/feedback/settings', { method: 'PUT', body: { repo: null } })
    repo.value = ''
    token.value = ''
    testResult.value = null
    await refresh()
    toast.add({ title: 'GitHub disconnected', color: 'success' })
  }
  catch {
    toast.add({ title: 'Could not disconnect', color: 'error' })
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
        Feedback → GitHub
      </div>
    </template>
    <div class="space-y-4">
      <p class="text-sm text-slate-500 dark:text-slate-400">
        Bug reports and ideas from the <NuxtLink to="/feedback" class="text-primary hover:underline">Feedback page</NuxtLink>
        become GitHub issues on your repo — no GitHub accounts needed for the family. Create a
        <a
          href="https://github.com/settings/personal-access-tokens"
          target="_blank"
          class="text-primary hover:underline"
        >fine-grained personal access token</a>
        with Issues read &amp; write on just that one repo.
      </p>

      <!-- Current status -->
      <div class="flex items-center gap-2 text-sm">
        <span
          class="size-2 rounded-full shrink-0"
          :class="status?.configured ? 'bg-green-500' : 'bg-slate-300 dark:bg-slate-600'"
        />
        <span v-if="status?.configured" class="text-slate-600 dark:text-slate-300">
          Connected to <code class="font-mono text-xs">{{ status.repo }}</code>
        </span>
        <span v-else class="text-slate-500 dark:text-slate-400">Not connected</span>
      </div>

      <UFormField label="Repository" help="owner/repo — where the issues get filed.">
        <UInput v-model="repo" placeholder="Riley-D-Betts/betts-board" class="w-full" />
      </UFormField>
      <UFormField
        label="Access token"
        :help="status?.configured
          ? 'Stored on your server, never shown again. Leave blank to keep the current token.'
          : 'Stored on your server, never shown again.'"
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
        <UButton icon="i-lucide-save" :loading="saving" @click="save">Save</UButton>
        <UButton
          icon="i-lucide-radio-tower"
          variant="soft"
          color="neutral"
          :loading="testing"
          :disabled="!status?.configured"
          @click="testConnection"
        >
          Test connection
        </UButton>
        <UButton
          v-if="status?.configured"
          icon="i-lucide-unplug"
          variant="ghost"
          color="error"
          :loading="disconnecting"
          @click="disconnect"
        >
          Disconnect
        </UButton>
      </div>
    </div>
  </UCard>
</template>
