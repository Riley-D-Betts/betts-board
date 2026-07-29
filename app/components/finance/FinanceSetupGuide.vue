<!-- What Money is and how to switch it on. Shown at /finance before anything has
     been set up — the section used to be hidden from the nav entirely until
     somebody was already enrolled, which made it impossible to discover. -->
<script setup lang="ts">
defineProps<{
  /** Admins get the steps and the CTA; everyone else gets the note. */
  canSetUp: boolean
  ownerName?: string | null
}>()
defineEmits<{ start: [] }>()

const STEPS = ['pin', 'accounts', 'people', 'plan'] as const
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center gap-3">
        <div class="grid size-11 shrink-0 place-items-center rounded-full bg-primary/10">
          <UIcon name="i-lucide-wallet" class="size-5 text-primary" />
        </div>
        <div>
          <h1 class="text-lg font-semibold">{{ $t('finance.setup.title') }}</h1>
          <p class="text-sm text-slate-500 dark:text-slate-400">{{ $t('finance.setup.subtitle') }}</p>
        </div>
      </div>
    </template>

    <div class="space-y-4">
      <p class="text-sm text-slate-600 dark:text-slate-300">{{ $t('finance.setup.intro') }}</p>

      <!-- Not an admin: say who can do it rather than showing steps that dead-end. -->
      <p
        v-if="!canSetUp"
        class="flex items-start gap-2 rounded-lg bg-slate-100 p-3 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300"
      >
        <UIcon name="i-lucide-info" class="mt-0.5 size-4 shrink-0" />
        {{ $t('finance.setup.adminOnly') }}
      </p>

      <template v-else>
        <ol class="space-y-3">
          <li v-for="(step, i) in STEPS" :key="step" class="flex gap-3">
            <span
              class="grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-semibold text-primary tabular-nums"
            >
              {{ i + 1 }}
            </span>
            <div class="min-w-0">
              <p class="text-sm font-medium">{{ $t(`finance.setup.steps.${step}.title`) }}</p>
              <p class="text-sm text-slate-500 dark:text-slate-400">{{ $t(`finance.setup.steps.${step}.body`) }}</p>
            </div>
          </li>
        </ol>

        <UButton size="xl" block icon="i-lucide-arrow-right" @click="$emit('start')">
          {{ $t('finance.setup.cta') }}
        </UButton>
      </template>
    </div>

    <template #footer>
      <p class="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
        {{ $t('finance.setup.privacy') }}
      </p>
    </template>
  </UCard>
</template>
