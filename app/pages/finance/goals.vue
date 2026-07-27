<script setup lang="ts">
const { unlocked } = useFinanceSession()
const { money, moneyShort, fromInput } = useMoney()
const currency = useHouseholdCurrency()
const { formatDayMonth } = useDateFormat()
const { t } = useI18n()
const toast = useToast()

const NO_ACCOUNT = 'none'

interface Goal {
  id: string
  name: string
  targetMinor: number
  currency: string
  targetDate: string | null
  accountId: string | null
  accountName: string | null
  savedMinor: number
  remainingMinor: number
  progress: number
  perMonthNeededMinor: number | null
  daysRemaining: number | null
  icon: string | null
}

const { data: goals, refresh } = await useFetch<Goal[]>('/api/finance/goals', {
  immediate: unlocked.value,
  default: () => [],
})
const { data: accountData, refresh: refreshAccounts } = await useFetch<{ accounts: { id: string, name: string, type: string }[] }>(
  '/api/finance/accounts',
  { immediate: unlocked.value, default: () => ({ accounts: [] }) },
)
watch(unlocked, u => u && Promise.all([refresh(), refreshAccounts()]))

const addOpen = ref(false)
const saving = ref(false)
const form = reactive({ name: '', target: '', targetDate: '', accountId: NO_ACCOUNT })

const accountItems = computed(() => [
  { label: t('finance.goals.manual'), value: NO_ACCOUNT },
  ...(accountData.value?.accounts ?? [])
    .filter(a => a.type === 'savings' || a.type === 'cash')
    .map(a => ({ label: a.name, value: a.id })),
])

watch(addOpen, (open) => {
  if (!open) return
  form.name = ''
  form.target = ''
  form.targetDate = ''
  form.accountId = NO_ACCOUNT
})

async function create() {
  const targetMinor = fromInput(form.target, currency.value)
  if (!targetMinor || targetMinor < 1) return
  saving.value = true
  try {
    await $fetch('/api/finance/goals', {
      method: 'POST',
      body: {
        name: form.name.trim(),
        targetMinor,
        targetDate: form.targetDate || null,
        accountId: form.accountId === NO_ACCOUNT ? null : form.accountId,
      },
    })
    addOpen.value = false
    toast.add({ title: t('finance.toast.saved'), color: 'success' })
    await refresh()
  }
  finally {
    saving.value = false
  }
}

// ── Contribute ───────────────────────────────────────────────────────────
const contributeGoal = ref<Goal | null>(null)
const contribution = ref('')

async function contribute() {
  const amountMinor = fromInput(contribution.value, currency.value)
  if (!contributeGoal.value || amountMinor == null) return
  await $fetch(`/api/finance/goals/${contributeGoal.value.id}/contribute`, {
    method: 'POST',
    body: { amountMinor, contributedOn: todayString() },
  })
  contributeGoal.value = null
  contribution.value = ''
  toast.add({ title: t('finance.toast.saved'), color: 'success' })
  await refresh()
}
</script>

<template>
  <FinanceShell :title="$t('finance.goals.title')">
    <div class="space-y-4">
      <div class="flex justify-end">
        <UButton icon="i-lucide-plus" @click="addOpen = true">{{ $t('finance.goals.add') }}</UButton>
      </div>

      <div v-if="goals.length" class="grid gap-4 sm:grid-cols-2">
        <UCard v-for="goal in goals" :key="goal.id">
          <div class="space-y-3">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <h2 class="truncate font-semibold">{{ goal.name }}</h2>
                <p class="text-xs text-slate-500 dark:text-slate-400">
                  <span v-if="goal.accountName">{{ goal.accountName }}</span>
                  <span v-if="goal.targetDate">
                    <span v-if="goal.accountName"> · </span>{{ formatDayMonth(goal.targetDate) }}
                  </span>
                </p>
              </div>
              <UBadge v-if="goal.progress >= 1" color="success" variant="subtle">
                {{ $t('finance.goals.reached') }}
              </UBadge>
            </div>

            <div>
              <div class="mb-1 flex items-baseline justify-between gap-2 text-sm">
                <span class="tabular-nums font-medium">
                  {{ $t('finance.goals.saved', {
                    saved: moneyShort(goal.savedMinor, goal.currency),
                    target: moneyShort(goal.targetMinor, goal.currency),
                  }) }}
                </span>
              </div>
              <UProgress
                :model-value="Math.round(goal.progress * 100)"
                :color="goal.progress >= 1 ? 'success' : 'primary'"
              />
            </div>

            <div class="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span v-if="goal.remainingMinor" class="text-slate-500 dark:text-slate-400">
                {{ $t('finance.goals.remaining', { amount: money(goal.remainingMinor, goal.currency) }) }}
                <template v-if="goal.perMonthNeededMinor">
                  · {{ $t('finance.goals.perMonth', { amount: money(goal.perMonthNeededMinor, goal.currency) }) }}
                </template>
              </span>

              <UButton
                v-if="!goal.accountId"
                size="sm"
                variant="soft"
                class="min-h-11"
                @click="contributeGoal = goal"
              >
                {{ $t('finance.goals.contribute') }}
              </UButton>
            </div>

            <p v-if="goal.accountId" class="text-xs text-slate-500 dark:text-slate-400">
              {{ $t('finance.goals.linkedNoManual') }}
            </p>
          </div>
        </UCard>
      </div>

      <UCard v-else>
        <p class="py-4 text-center text-sm text-slate-500 dark:text-slate-400">
          {{ $t('finance.goals.empty') }}
        </p>
      </UCard>
    </div>

    <UModal v-model:open="addOpen" :title="$t('finance.goals.add')">
      <template #body>
        <form class="space-y-4" @submit.prevent="create">
          <UFormField :label="$t('finance.goals.name')">
            <UInput v-model="form.name" class="w-full" autofocus />
          </UFormField>
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField :label="$t('finance.goals.target')">
              <UInput v-model="form.target" type="number" step="0.01" min="0" inputmode="decimal" class="w-full" />
            </UFormField>
            <UFormField :label="$t('finance.goals.targetDate')">
              <UInput v-model="form.targetDate" type="date" class="w-full" />
            </UFormField>
          </div>
          <UFormField
            :label="$t('finance.goals.linkAccount')"
            :help="$t('finance.goals.linkAccountHelp')"
          >
            <USelect v-model="form.accountId" :items="accountItems" class="w-full" />
          </UFormField>
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="ghost" @click="addOpen = false">
              {{ $t('common.actions.cancel') }}
            </UButton>
            <UButton type="submit" :loading="saving" :disabled="!form.name.trim() || !form.target">
              {{ $t('common.actions.save') }}
            </UButton>
          </div>
        </form>
      </template>
    </UModal>

    <UModal
      :open="!!contributeGoal"
      :title="$t('finance.goals.contribute')"
      @update:open="(v: boolean) => { if (!v) contributeGoal = null }"
    >
      <template #body>
        <form class="space-y-4" @submit.prevent="contribute">
          <UFormField :label="$t('finance.goals.contributed')">
            <UInput
              v-model="contribution"
              type="number"
              step="0.01"
              inputmode="decimal"
              class="w-full"
              autofocus
            />
          </UFormField>
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="ghost" @click="contributeGoal = null">
              {{ $t('common.actions.cancel') }}
            </UButton>
            <UButton type="submit" :disabled="!contribution">{{ $t('common.actions.save') }}</UButton>
          </div>
        </form>
      </template>
    </UModal>
  </FinanceShell>
</template>
