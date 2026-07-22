<script setup lang="ts">
import type { RewardDef } from '~/components/rewards/RewardCard.vue'

const { activeProfile } = useBoardState()
const toast = useToast()

const canManage = computed(() =>
  activeProfile.value?.role === 'admin' || activeProfile.value?.role === 'adult')

const { data, refresh } = await useFetch('/api/rewards')

const myBalance = computed(() =>
  data.value?.balances.find(b => b.profileId === activeProfile.value?.id)?.balance ?? 0)

// Manage mode (admin/adult): cards swap Redeem for edit/archive controls.
const managing = ref(false)
const editorOpen = ref(false)
const editing = ref<RewardDef | null>(null)

function openCreate() {
  editing.value = null
  editorOpen.value = true
}

function openEdit(reward: RewardDef) {
  editing.value = reward
  editorOpen.value = true
}

async function archive(reward: RewardDef) {
  if (!confirm(`Remove "${reward.title}"? Past redemptions are kept.`)) return
  try {
    await $fetch(`/api/rewards/${reward.id}`, { method: 'DELETE' })
    await refresh()
  }
  catch {
    toast.add({ title: 'Could not remove reward', color: 'error' })
  }
}

// Redeem confirmation
const confirmOpen = ref(false)
const confirming = ref<RewardDef | null>(null)
const redeeming = ref(false)

function askRedeem(reward: RewardDef) {
  confirming.value = reward
  confirmOpen.value = true
}

async function confirmRedeem() {
  const reward = confirming.value
  if (!reward) return
  redeeming.value = true
  try {
    await $fetch(`/api/rewards/${reward.id}/redeem`, { method: 'POST', body: {} })
    confirmOpen.value = false
    toast.add({
      title: `🎉 ${reward.emoji ?? '🎁'} ${reward.title} is yours!`,
      description: `${reward.cost} star${reward.cost === 1 ? '' : 's'} well spent, ${activeProfile.value?.name}.`,
      icon: 'i-lucide-party-popper',
      color: 'success',
    })
    await refresh()
  }
  catch (err) {
    const msg = (err as { statusCode?: number }).statusCode === 400 ? 'Not enough stars' : 'Could not redeem reward'
    toast.add({ title: msg, color: 'error' })
  }
  finally {
    redeeming.value = false
  }
}

// Recent redemptions (collapsed by default)
const showRecent = ref(false)

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
  <div class="space-y-6 max-w-2xl">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="text-2xl md:text-3xl font-bold flex-1">Rewards</h1>
      <UButton to="/chores/leaderboard" icon="i-lucide-trophy" variant="soft" color="warning">
        Leaderboard
      </UButton>
      <UButton
        v-if="canManage"
        :icon="managing ? 'i-lucide-check' : 'i-lucide-pencil'"
        variant="soft"
        color="neutral"
        @click="managing = !managing"
      >
        {{ managing ? 'Done' : 'Manage' }}
      </UButton>
    </div>

    <!-- Acting profile's spendable stars -->
    <div
      v-if="activeProfile"
      class="flex items-center gap-4 rounded-2xl bg-gradient-to-r from-amber-100 to-amber-50 dark:from-amber-900/40 dark:to-amber-950/30 px-5 py-4"
    >
      <ProfileAvatar :profile="activeProfile" size="lg" />
      <div class="flex-1">
        <p class="text-sm font-medium text-amber-800 dark:text-amber-200">{{ activeProfile.name }}'s stars</p>
        <p class="flex items-center gap-2 text-4xl font-bold text-amber-700 dark:text-amber-300 tabular-nums">
          <UIcon name="i-lucide-star" class="size-8" />
          {{ myBalance }}
        </p>
      </div>
    </div>

    <!-- Manage mode: add button -->
    <div v-if="managing" class="flex justify-end">
      <UButton icon="i-lucide-plus" @click="openCreate">New reward</UButton>
    </div>

    <!-- Empty states -->
    <div v-if="!data?.rewards.length" class="text-center py-12 text-slate-500 dark:text-slate-400">
      <UIcon name="i-lucide-gift" class="size-10 mb-2" />
      <template v-if="canManage">
        <p>No rewards yet — add something worth saving up for.</p>
        <UButton variant="soft" class="mt-3" icon="i-lucide-plus" @click="openCreate">
          Add the first reward
        </UButton>
      </template>
      <p v-else>No rewards yet. Ask a parent to add some rewards!</p>
    </div>

    <!-- Reward grid -->
    <div v-else class="grid grid-cols-2 sm:grid-cols-3 gap-3">
      <RewardCard
        v-for="reward in data.rewards"
        :key="reward.id"
        :reward="reward"
        :balance="myBalance"
        :manage="managing"
        @redeem="askRedeem(reward)"
        @edit="openEdit(reward)"
        @archive="archive(reward)"
      />
    </div>

    <!-- Recent redemptions -->
    <section v-if="data?.recent.length">
      <button
        type="button"
        class="flex w-full items-center gap-2 py-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
        @click="showRecent = !showRecent"
      >
        <UIcon :name="showRecent ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-4" />
        Recent redemptions
        <UBadge variant="soft" color="neutral" size="sm">{{ data.recent.length }}</UBadge>
      </button>
      <UCard v-if="showRecent">
        <ul class="divide-y divide-slate-200 dark:divide-slate-800">
          <li
            v-for="r in data.recent"
            :key="r.id"
            class="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
          >
            <span class="text-2xl w-9 text-center shrink-0">{{ r.emoji ?? '🎁' }}</span>
            <div class="min-w-0 flex-1">
              <p class="font-medium truncate">{{ r.title }}</p>
              <p class="text-xs text-slate-500 dark:text-slate-400">
                {{ r.profileName }} · {{ timeAgo(r.redeemedAt) }}
              </p>
            </div>
            <UBadge variant="soft" color="warning" class="shrink-0 tabular-nums">
              <UIcon name="i-lucide-star" class="size-3.5" />
              −{{ r.costPoints }}
            </UBadge>
          </li>
        </ul>
      </UCard>
    </section>

    <!-- Redeem confirmation -->
    <UModal v-model:open="confirmOpen" title="Redeem reward">
      <template #body>
        <div v-if="confirming" class="flex flex-col items-center gap-3 py-2 text-center">
          <span class="text-6xl">{{ confirming.emoji ?? '🎁' }}</span>
          <p class="text-lg font-semibold">
            Spend {{ confirming.cost }} star{{ confirming.cost === 1 ? '' : 's' }} on {{ confirming.title }}?
          </p>
          <p class="text-sm text-slate-500 dark:text-slate-400">
            You'll have {{ myBalance - confirming.cost }} ⭐ left.
          </p>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton variant="ghost" color="neutral" @click="confirmOpen = false">Cancel</UButton>
          <UButton icon="i-lucide-gift" :loading="redeeming" @click="confirmRedeem">Redeem</UButton>
        </div>
      </template>
    </UModal>

    <RewardEditor
      v-model:open="editorOpen"
      :reward="editing"
      @saved="refresh()"
    />
  </div>
</template>
