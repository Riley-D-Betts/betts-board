<!-- Who can see money, and who currently has it unlocked. The sessions list is
     the security screen that actually helps a family: it turns an invisible
     problem into a visible one. -->
<script setup lang="ts">
const props = defineProps<{ isOwner: boolean }>()

const { t } = useI18n()
const toast = useToast()
const { formatRelative, formatTime } = useDateFormat()
const { state } = useBoardState()

interface Member {
  profileId: string
  name: string
  color: string
  role: 'owner' | 'member'
  lastUnlockAt: number | null
  failedSinceLastUnlock: number
  lockedUntil: number | null
}

interface FinanceSessionRow {
  id: string
  name: string
  deviceLabel: string | null
  startedAt: number
  expiresAt: number
  isCurrent: boolean
}

const { data: members, refresh: refreshMembers } = await useFetch<Member[]>('/api/finance/members', {
  default: () => [],
})
const { data: sessions, refresh: refreshSessions } = await useFetch<FinanceSessionRow[]>('/api/finance/sessions', {
  default: () => [],
})

const addOpen = ref(false)
const busy = ref(false)
const error = ref('')
const form = reactive({ profileId: '', pin: '', role: 'member' as 'owner' | 'member' })

/** Profiles that don't already have money access. */
const candidates = computed(() => {
  const have = new Set(members.value.map(m => m.profileId))
  return (state.value?.profiles ?? []).filter(p => !have.has(p.id))
})

const roleItems = computed(() => (['member', 'owner'] as const)
  .map(value => ({ value, label: t(`finance.members.roles.${value}`) })))

watch(addOpen, (open) => {
  if (!open) return
  form.profileId = candidates.value[0]?.id ?? ''
  form.pin = ''
  form.role = 'member'
  error.value = ''
})

async function addMember() {
  busy.value = true
  error.value = ''
  try {
    await $fetch('/api/finance/members', {
      method: 'POST',
      body: { profileId: form.profileId, pin: form.pin, role: form.role },
    })
    addOpen.value = false
    toast.add({ title: t('finance.toast.saved'), color: 'success' })
    await refreshMembers()
  }
  catch (e) {
    error.value = (e as { statusMessage?: string }).statusMessage || t('finance.members.couldNotAdd')
  }
  finally {
    busy.value = false
  }
}

async function removeMember(member: Member) {
  if (!confirm(t('finance.members.removeConfirm', { name: member.name }))) return
  try {
    await $fetch(`/api/finance/members/${member.profileId}`, { method: 'DELETE' })
    await Promise.all([refreshMembers(), refreshSessions()])
  }
  catch (e) {
    toast.add({
      title: (e as { statusMessage?: string }).statusMessage || t('finance.members.lastOwner'),
      color: 'error',
    })
  }
}

/**
 * The lock screen stores a stable English token, so the same device reads
 * correctly whatever language the list is being viewed in. Rows written by an
 * older build hold the capitalised English word ('Phone'), and a hand-set label
 * like "Kitchen tablet" is free text — show either verbatim rather than a key
 * path.
 */
function deviceName(label: string): string {
  switch (label) {
    case 'phone': return t('finance.sessions.devices.phone')
    case 'tablet': return t('finance.sessions.devices.tablet')
    case 'computer': return t('finance.sessions.devices.computer')
    default: return label
  }
}

async function revokeSession(row: FinanceSessionRow) {
  await $fetch(`/api/finance/sessions/${row.id}`, { method: 'DELETE' })
  await refreshSessions()
}
</script>

<template>
  <div class="space-y-4">
    <UCard>
      <template #header>
        <div class="flex items-center justify-between gap-2">
          <h2 class="font-semibold">{{ $t('finance.members.title') }}</h2>
          <UButton
            v-if="props.isOwner && candidates.length"
            icon="i-lucide-user-plus"
            size="sm"
            @click="addOpen = true"
          >
            {{ $t('finance.members.add') }}
          </UButton>
        </div>
      </template>

      <div class="divide-y divide-slate-200 dark:divide-slate-800">
        <div v-for="member in members" :key="member.profileId" class="flex flex-wrap items-center gap-3 py-2">
          <span
            class="size-8 shrink-0 rounded-full"
            :style="{ backgroundColor: member.color }"
            aria-hidden="true"
          />
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium">{{ member.name }}</p>
            <!-- ClientOnly: "9 seconds ago" rendered on the server disagrees
                 with the client the moment the second ticks over, which Vue
                 reports as a hydration mismatch. -->
            <p class="truncate text-xs text-slate-500 dark:text-slate-400">
              <template v-if="member.lastUnlockAt">
                <ClientOnly>
                  {{ $t('finance.members.lastUnlock', { time: formatRelative(member.lastUnlockAt) }) }}
                </ClientOnly>
              </template>
              <template v-else>{{ $t('finance.members.neverUnlocked') }}</template>
            </p>
          </div>

          <UBadge :color="member.role === 'owner' ? 'primary' : 'neutral'" variant="subtle" size="sm">
            {{ $t(`finance.members.roles.${member.role}`) }}
          </UBadge>

          <UBadge v-if="member.failedSinceLastUnlock" color="warning" variant="subtle" size="sm">
            {{ member.failedSinceLastUnlock }}
          </UBadge>

          <UButton
            v-if="props.isOwner"
            icon="i-lucide-user-minus"
            size="sm"
            color="error"
            variant="ghost"
            class="size-11 shrink-0 justify-center"
            :aria-label="$t('finance.members.remove')"
            @click="removeMember(member)"
          />
        </div>
      </div>

      <template #footer>
        <p class="text-xs text-slate-500 dark:text-slate-400">{{ $t('finance.members.roleHelp') }}</p>
      </template>
    </UCard>

    <UCard>
      <template #header>
        <h2 class="font-semibold">{{ $t('finance.sessions.title') }}</h2>
      </template>

      <div v-if="sessions.length" class="divide-y divide-slate-200 dark:divide-slate-800">
        <div v-for="row in sessions" :key="row.id" class="flex flex-wrap items-center gap-3 py-2">
          <UIcon name="i-lucide-monitor-smartphone" class="size-4 shrink-0 text-slate-400" />
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium">
              {{ row.name }}
              <span v-if="row.deviceLabel" class="text-slate-500 dark:text-slate-400"> · {{ deviceName(row.deviceLabel) }}</span>
              <UBadge v-if="row.isCurrent" size="sm" variant="subtle" class="ml-1">
                {{ $t('finance.sessions.thisDevice') }}
              </UBadge>
            </p>
            <p class="text-xs text-slate-500 dark:text-slate-400">
              {{ $t('finance.sessions.expiresAt', { time: formatTime(row.expiresAt) }) }}
            </p>
          </div>
          <UButton
            v-if="!row.isCurrent"
            size="sm"
            color="neutral"
            variant="ghost"
            class="min-h-11"
            @click="revokeSession(row)"
          >
            {{ $t('finance.sessions.revoke') }}
          </UButton>
        </div>
      </div>
      <p v-else class="py-2 text-sm text-slate-500 dark:text-slate-400">
        {{ $t('finance.sessions.empty') }}
      </p>
    </UCard>

    <UModal v-model:open="addOpen" :title="$t('finance.members.add')">
      <template #body>
        <form class="space-y-4" @submit.prevent="addMember">
          <UFormField :label="$t('common.nav.chooseProfile')">
            <USelect
              v-model="form.profileId"
              :items="candidates.map(p => ({ label: p.name, value: p.id }))"
              class="w-full"
            />
          </UFormField>
          <UFormField :label="$t('finance.members.role')">
            <USelect v-model="form.role" :items="roleItems" class="w-full" />
          </UFormField>
          <UFormField
            :label="$t('finance.members.choosePin')"
            :help="$t('finance.members.choosePinHelp')"
          >
            <UInput v-model="form.pin" type="password" autocomplete="new-password" class="w-full" />
          </UFormField>
          <p v-if="error" class="text-sm text-red-600 dark:text-red-400">{{ error }}</p>
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="ghost" @click="addOpen = false">
              {{ $t('common.actions.cancel') }}
            </UButton>
            <UButton type="submit" :loading="busy" :disabled="!form.profileId || form.pin.length < 6">
              {{ $t('common.actions.save') }}
            </UButton>
          </div>
        </form>
      </template>
    </UModal>
  </div>
</template>
