<script setup lang="ts">
export interface RewardDef {
  id: string
  title: string
  emoji: string | null
  description: string | null
  cost: number
  sortOrder: number
}

const props = defineProps<{
  reward: RewardDef
  /** The acting profile's spendable stars. */
  balance: number
  /** Manage mode swaps the Redeem button for edit/archive controls. */
  manage?: boolean
}>()

const emit = defineEmits<{ redeem: [], edit: [], archive: [] }>()

const shortBy = computed(() => Math.max(0, props.reward.cost - props.balance))
</script>

<template>
  <div class="flex flex-col items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 text-center">
    <span class="text-5xl leading-none pt-1">{{ reward.emoji ?? '🎁' }}</span>
    <p class="font-semibold leading-tight">{{ reward.title }}</p>
    <p v-if="reward.description" class="text-xs text-slate-500 dark:text-slate-400 line-clamp-2">
      {{ reward.description }}
    </p>
    <UBadge variant="soft" color="warning" class="tabular-nums">
      <UIcon name="i-lucide-star" class="size-3.5" />
      {{ reward.cost }}
    </UBadge>

    <div class="mt-auto w-full pt-2">
      <div v-if="manage" class="flex gap-2">
        <UButton block variant="soft" color="neutral" icon="i-lucide-pencil" class="flex-1" @click="emit('edit')">
          {{ $t('common.actions.edit') }}
        </UButton>
        <UButton
          icon="i-lucide-trash-2"
          variant="ghost"
          color="neutral"
          :aria-label="$t('rewards.card.remove', { title: reward.title })"
          @click="emit('archive')"
        />
      </div>
      <template v-else>
        <UButton block size="lg" :disabled="shortBy > 0" icon="i-lucide-gift" @click="emit('redeem')">
          {{ $t('rewards.redeem') }}
        </UButton>
        <p v-if="shortBy > 0" class="mt-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
          {{ $t('rewards.card.needMore', { n: shortBy }) }}
        </p>
      </template>
    </div>
  </div>
</template>
