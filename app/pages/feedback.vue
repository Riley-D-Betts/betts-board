<script setup lang="ts">
import type { FeedbackResult, FeedbackStatus } from '#shared/schemas/feedback'

const APP_VERSION = '1.0.0'

const toast = useToast()
const { t } = useI18n()
const { data: status } = await useFetch<FeedbackStatus>('/api/feedback/status')

const kind = ref<'bug' | 'feature' | null>(null)
const form = reactive({ title: '', body: '', includeDiagnostics: true })
const sending = ref(false)
const sent = ref<FeedbackResult | null>(null)

const options = computed(() => [
  {
    value: 'bug' as const,
    icon: 'i-lucide-bug',
    title: t('feedback.kinds.bugTitle'),
    blurb: t('feedback.kinds.bugBlurb'),
  },
  {
    value: 'feature' as const,
    icon: 'i-lucide-lightbulb',
    title: t('feedback.kinds.featureTitle'),
    blurb: t('feedback.kinds.featureBlurb'),
  },
])

const titlePlaceholder = computed(() =>
  kind.value === 'bug' ? t('feedback.form.titlePlaceholderBug') : t('feedback.form.titlePlaceholderFeature'))
const bodyPlaceholder = computed(() =>
  kind.value === 'bug'
    ? t('feedback.form.bodyPlaceholderBug')
    : t('feedback.form.bodyPlaceholderFeature'))

const canSubmit = computed(() => form.title.trim().length >= 3 && form.body.trim().length >= 1)

function pick(value: 'bug' | 'feature') {
  kind.value = value
  sent.value = null
}

// The issue URL is whatever the configured GitHub host put in `html_url` — a
// value from off this machine going into an href. Same guard as every other
// stored/foreign URL: no scheme we did not verify reaches the browser.
const issueLink = computed(() => safeExternalUrl(sent.value?.issueUrl))

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
        title: t('feedback.errors.notConnectedTitle'),
        description: t('feedback.errors.notConnectedBody'),
        color: 'error',
      })
    }
    else if (e.statusCode === 502) {
      toast.add({
        title: t('feedback.errors.rejectedTitle'),
        description: t('feedback.errors.rejectedBody', { reason: e.data?.statusMessage ?? t('feedback.errors.couldNotReach') }),
        color: 'error',
      })
    }
    else {
      toast.add({ title: e.data?.statusMessage ?? t('feedback.errors.couldNotSend'), color: 'error' })
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
      <h1 class="text-2xl md:text-3xl font-bold">{{ $t('feedback.title') }}</h1>
      <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">
        {{ $t('feedback.intro') }}
      </p>
    </div>

    <!-- Not connected yet: gentle explainer instead of the form -->
    <UCard v-if="!status?.configured">
      <div class="flex flex-col items-center gap-3 py-8 text-center">
        <UIcon name="i-lucide-plug-zap" class="size-10 text-slate-400 dark:text-slate-500" />
        <p class="font-semibold">{{ $t('feedback.notConfigured.title') }}</p>
        <!-- i18n-t so the settings path keeps its emphasis inside one translatable sentence. -->
        <i18n-t
          keypath="feedback.notConfigured.body"
          tag="p"
          scope="global"
          class="text-sm text-slate-500 dark:text-slate-400 max-w-sm"
        >
          <template #path>
            <span class="font-medium">{{ $t('feedback.notConfigured.settingsPath') }}</span>
          </template>
        </i18n-t>
      </div>
    </UCard>

    <!-- Success -->
    <UCard v-else-if="sent">
      <div class="flex flex-col items-center gap-3 py-8 text-center">
        <UIcon name="i-lucide-party-popper" class="size-10 text-primary" />
        <p class="text-lg font-semibold">{{ $t('feedback.sent.title', { number: sent.issueNumber }) }}</p>
        <p class="text-sm text-slate-500 dark:text-slate-400">
          {{ $t('feedback.sent.body') }}
        </p>
        <div class="flex flex-wrap justify-center gap-2 pt-1">
          <UButton
            v-if="issueLink"
            :href="issueLink"
            target="_blank"
            rel="noopener noreferrer"
            icon="i-lucide-external-link"
            variant="soft"
          >
            {{ $t('feedback.sent.view') }}
          </UButton>
          <UButton icon="i-lucide-plus" variant="ghost" color="neutral" @click="sendAnother">
            {{ $t('feedback.sent.sendAnother') }}
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
          <UFormField :label="$t('feedback.form.title')" required>
            <UInput v-model="form.title" :placeholder="titlePlaceholder" class="w-full" />
          </UFormField>
          <UFormField :label="kind === 'bug' ? $t('feedback.form.bodyLabelBug') : $t('feedback.form.bodyLabelFeature')" required>
            <UTextarea v-model="form.body" :rows="6" :placeholder="bodyPlaceholder" class="w-full" />
          </UFormField>

          <div v-if="kind === 'bug'" class="flex items-center gap-3 min-h-11">
            <USwitch v-model="form.includeDiagnostics" />
            <div>
              <p class="text-sm font-medium">{{ $t('feedback.form.includeDiagnostics') }}</p>
              <p class="text-xs text-slate-500 dark:text-slate-400">
                {{ $t('feedback.form.includeDiagnosticsHelp') }}
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
            {{ kind === 'bug' ? $t('feedback.form.submitBug') : $t('feedback.form.submitFeature') }}
          </UButton>
        </div>
      </UCard>
    </template>
  </div>
</template>
