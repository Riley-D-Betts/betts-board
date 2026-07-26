<!-- Which build is this? Without it there is no way to tell whether a rebuild
     actually reached the server — the same value is returned by /api/health. -->
<script setup lang="ts">
const { build } = useRuntimeConfig().public
const { formatWeekdayDate, formatTime } = useDateFormat()

const builtAt = computed(() => {
  if (!build.builtAt) return null
  const ms = Date.parse(build.builtAt)
  return Number.isNaN(ms) ? null : ms
})

const builtLabel = computed(() =>
  builtAt.value === null
    ? build.builtAt || '—'
    : `${formatWeekdayDate(new Date(builtAt.value))}, ${formatTime(builtAt.value)}`)

const ageDays = computed(() =>
  builtAt.value === null ? null : Math.floor((Date.now() - builtAt.value) / 86_400_000))
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center gap-2 font-semibold">
        <UIcon name="i-lucide-info" class="text-primary size-5" />
        {{ $t('settings.about.title') }}
      </div>
    </template>

    <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
      <dt class="text-slate-500 dark:text-slate-400">{{ $t('settings.about.version') }}</dt>
      <dd class="font-medium">{{ build.version }}</dd>

      <dt class="text-slate-500 dark:text-slate-400">{{ $t('settings.about.commit') }}</dt>
      <dd class="font-mono text-xs">{{ build.commit }}</dd>

      <dt class="text-slate-500 dark:text-slate-400">{{ $t('settings.about.built') }}</dt>
      <dd>
        {{ builtLabel }}
        <span v-if="ageDays !== null && ageDays > 0" class="text-slate-500 dark:text-slate-400">
          · {{ $t('settings.about.daysAgo', ageDays) }}
        </span>
      </dd>
    </dl>

    <p class="mt-4 text-sm text-slate-500 dark:text-slate-400">
      {{ $t('settings.about.help') }}
    </p>
  </UCard>
</template>
