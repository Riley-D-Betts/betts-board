<script setup lang="ts">
import type { FeedbackResult, FeedbackStatus } from '#shared/schemas/feedback'

const APP_VERSION = '1.0.0'

const toast = useToast()
const { data: status } = await useFetch<FeedbackStatus>('/api/feedback/status')

const kind = ref<'bug' | 'feature' | null>(null)
const form = reactive({ title: '', body: '', includeDiagnostics: true })
const sending = ref(false)
const sent = ref<FeedbackResult | null>(null)

const options = [
  {
    value: 'bug' as const,
    icon: 'i-lucide-bug',
    title: 'Something\'s broken',
    blurb: 'A page errors, a button does nothing, the numbers look wrong…',
  },
  {
    value: 'feature' as const,
    icon: 'i-lucide-lightbulb',
    title: 'I have an idea',
    blurb: 'Something the board should do, or do better.',
  },
]

const titlePlaceholder = computed(() =>
  kind.value === 'bug' ? 'e.g. Chore board shows yesterday\'s chores' : 'e.g. Birthday countdowns on the dashboard')
const bodyPlaceholder = computed(() =>
  kind.value === 'bug'
    ? 'What were you doing, what happened, and what did you expect instead?'
    : 'What should the board do? Who in the family would use it?')

const canSubmit = computed(() => form.title.trim().length >= 3 && form.body.trim().length >= 1)

function pick(value: 'bug' | 'feature') {
  kind.value = value
  sent.value = null
}

function sendAnother() {
  sent.value = null
  kind.value = null
  form.title = ''
  form.body = ''
  form.includeDiagnostics = true
}

async function submit() {
  if (!kind.value || !canSubmit.value || sending.value) return
  sending.value = true
  try {
    sent.value = await $fetch<FeedbackResult>('/api/feedback', {
      method: 'POST',
      body: {
        kind: kind.value,
        title: form.title.trim(),
        body: form.body.trim(),
        includeDiagnostics: form.includeDiagnostics,
        ...(kind.value === 'bug' && form.includeDiagnostics && {
          diagnostics: {
            userAgent: navigator.userAgent.slice(0, 500),
            viewport: `${window.innerWidth}×${window.innerHeight}`,
            version: APP_VERSION,
          },
        }),
      },
    })
  }
  catch (err) {
    const e = err as { statusCode?: number, data?: { statusMessage?: string } }
    if (e.statusCode === 409) {
      toast.add({
        title: 'Not connected to GitHub yet',
        description: 'Ask a parent to connect it under Settings → Feedback.',
        color: 'error',
      })
    }
    else if (e.statusCode === 502) {
      toast.add({
        title: 'GitHub didn\'t take it',
        description: `${e.data?.statusMessage ?? 'Could not reach GitHub'} — your words aren't lost, try again in a bit.`,
        color: 'error',
      })
    }
    else {
      toast.add({ title: e.data?.statusMessage ?? 'Could not send feedback', color: 'error' })
    }
  }
  finally {
    sending.value = false
  }
}
</script>

<template>
  <div class="space-y-6 max-w-2xl">
    <div>
      <h1 class="text-2xl md:text-3xl font-bold">Feedback</h1>
      <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">
        Spotted a bug? Wish the board did something new? Tell us — it goes straight to the family's fix-it list.
      </p>
    </div>

    <!-- Not connected yet: gentle explainer instead of the form -->
    <UCard v-if="!status?.configured">
      <div class="flex flex-col items-center gap-3 py-8 text-center">
        <UIcon name="i-lucide-plug-zap" class="size-10 text-slate-400 dark:text-slate-500" />
        <p class="font-semibold">Feedback isn't set up yet</p>
        <p class="text-sm text-slate-500 dark:text-slate-400 max-w-sm">
          Ask a parent to connect GitHub under <span class="font-medium">Settings → Feedback</span>.
          Once that's done, anything you send here lands on the family's to-fix list.
        </p>
      </div>
    </UCard>

    <!-- Success -->
    <UCard v-else-if="sent">
      <div class="flex flex-col items-center gap-3 py-8 text-center">
        <UIcon name="i-lucide-party-popper" class="size-10 text-primary" />
        <p class="text-lg font-semibold">Sent! Issue #{{ sent.issueNumber }}</p>
        <p class="text-sm text-slate-500 dark:text-slate-400">
          Thanks — it's on the list now.
        </p>
        <div class="flex flex-wrap justify-center gap-2 pt-1">
          <UButton
            :href="sent.issueUrl"
            target="_blank"
            icon="i-lucide-external-link"
            variant="soft"
          >
            View on GitHub
          </UButton>
          <UButton icon="i-lucide-plus" variant="ghost" color="neutral" @click="sendAnother">
            Send another
          </UButton>
        </div>
      </div>
    </UCard>

    <template v-else>
      <!-- Kind picker: two big cards -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          v-for="option in options"
          :key="option.value"
          type="button"
          class="rounded-2xl border p-5 text-left min-h-24 transition-colors"
          :class="kind === option.value
            ? 'border-primary ring-2 ring-primary bg-primary/5'
            : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'"
          @click="pick(option.value)"
        >
          <UIcon
            :name="option.icon"
            class="size-7 mb-2"
            :class="kind === option.value ? 'text-primary' : 'text-slate-400 dark:text-slate-500'"
          />
          <p class="font-semibold">{{ option.title }}</p>
          <p class="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{{ option.blurb }}</p>
        </button>
      </div>

      <!-- The form -->
      <UCard v-if="kind">
        <div class="space-y-4">
          <UFormField label="Title" required>
            <UInput v-model="form.title" :placeholder="titlePlaceholder" class="w-full" />
          </UFormField>
          <UFormField :label="kind === 'bug' ? 'What happened?' : 'Tell us about it'" required>
            <UTextarea v-model="form.body" :rows="6" :placeholder="bodyPlaceholder" class="w-full" />
          </UFormField>

          <div v-if="kind === 'bug'" class="flex items-center gap-3 min-h-11">
            <USwitch v-model="form.includeDiagnostics" />
            <div>
              <p class="text-sm font-medium">Include device info</p>
              <p class="text-xs text-slate-500 dark:text-slate-400">
                Adds your browser and window size to the report — helps track it down.
              </p>
            </div>
          </div>

          <UButton
            icon="i-lucide-send"
            size="lg"
            block
            :loading="sending"
            :disabled="!canSubmit"
            @click="submit"
          >
            Send {{ kind === 'bug' ? 'bug report' : 'idea' }}
          </UButton>
        </div>
      </UCard>
    </template>
  </div>
</template>
