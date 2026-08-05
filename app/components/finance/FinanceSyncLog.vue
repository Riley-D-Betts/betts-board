<!-- Sync diagnostics, rendered as one paste-able block.

     Built for the question "why doesn't this balance match my bank?", which is
     the one failure the container log cannot answer: syncConnection never
     throws, so every bank failure is caught and written to a row rather than
     printed, and a balance can disagree with the bank while every layer is
     working correctly. So this shows the arithmetic and the sync state side by
     side rather than a stream of events.

     Read-only and credential-free by construction — see the note in
     server/services/finance/diagnostics.ts for what is deliberately left out. -->
<script setup lang="ts">
interface AccountDiagnostic {
  name: string
  type: string
  currency: string
  balanceSource: 'bank' | 'ledger'
  balanceMinor: number
  availableBalanceMinor: number | null
  pendingCount: number
  pendingMinor: number
  balanceWithPendingMinor: number
  balanceAt: number | null
  transactionCount: number
  syncedCount: number
  newestPostedDate: string | null
  oldestPostedDate: string | null
  isHidden: boolean
  archived: boolean
}

interface ConnectionDiagnostic {
  nickname: string | null
  provider: string
  status: string
  credentialsReadable: boolean
  bridgeHost: string | null
  syncIntervalMinutes: number
  consecutiveFailures: number
  lastAttemptAt: number | null
  lastSyncAt: number | null
  nextAttemptAt: number | null
  lastError: string | null
  lastErrorList: string[] | null
  nextRequest: { startDate: number, pendingRequested: boolean }
  accounts: AccountDiagnostic[]
}

interface Diagnostics {
  generatedAt: number
  timezone: string
  unlinkedAccounts: AccountDiagnostic[]
  connections: ConnectionDiagnostic[]
}

const { unlocked } = useFinanceSession()
const { t } = useI18n()
const toast = useToast()

const open = ref(false)
const copying = ref(false)

// Lazy: nobody opens this on a normal day, and it runs a per-account query.
const { data, refresh, status } = await useFetch<Diagnostics | null>('/api/finance/diagnostics', {
  immediate: false,
  default: () => null,
})

watch(open, async (isOpen) => {
  if (isOpen && unlocked.value) await refresh()
})

/** ISO, not a localised date: this is going into a bug report, not onto a fridge. */
function stamp(ms: number | null): string {
  return ms == null ? '—' : new Date(ms).toISOString()
}

/**
 * Minor units to a plain decimal string. Deliberately NOT the localised
 * `money()` helper — under de-DE that renders "1.234,56 $", and a number whose
 * separators depend on the reader's locale is exactly the wrong thing to paste
 * into a diagnosis.
 */
function amount(minor: number | null, currency: string): string {
  if (minor == null) return '—'
  const negative = minor < 0
  const digits = Math.abs(minor).toString().padStart(3, '0')
  const whole = digits.slice(0, -2)
  return `${negative ? '-' : ''}${whole}.${digits.slice(-2)} ${currency}`
}

function accountLines(a: AccountDiagnostic, indent: string): string[] {
  const flags = [
    a.isHidden ? 'hidden' : null,
    a.archived ? 'archived' : null,
  ].filter(Boolean).join(', ')

  return [
    `${indent}${a.name} (${a.type}${flags ? `, ${flags}` : ''})`,
    `${indent}  balance (posted)   ${amount(a.balanceMinor, a.currency)}   source=${a.balanceSource}`,
    `${indent}  pending            ${a.pendingCount} row(s), ${amount(a.pendingMinor, a.currency)}`,
    `${indent}  balance + pending  ${amount(a.balanceWithPendingMinor, a.currency)}`,
    `${indent}  bank available     ${amount(a.availableBalanceMinor, a.currency)}`,
    `${indent}  balance as of      ${stamp(a.balanceAt)}`,
    `${indent}  transactions       ${a.transactionCount} total, ${a.syncedCount} from sync`,
    `${indent}  posted range       ${a.oldestPostedDate ?? '—'} … ${a.newestPostedDate ?? '—'}`,
  ]
}

/** The whole snapshot as plain text — what the copy button puts on the clipboard. */
const report = computed(() => {
  const d = data.value
  if (!d) return ''

  const lines: string[] = [
    '=== betts-board finance sync diagnostics ===',
    `generated  ${stamp(d.generatedAt)}`,
    `timezone   ${d.timezone}`,
    '',
  ]

  for (const c of d.connections) {
    lines.push(
      `--- connection: ${c.nickname || c.provider} ---`,
      `  status              ${c.status}`,
      `  bridge host         ${c.bridgeHost ?? '(credentials unreadable)'}`,
      `  credentials         ${c.credentialsReadable ? 'readable' : 'UNREADABLE — key missing or changed'}`,
      `  sync interval       ${c.syncIntervalMinutes} min`,
      `  consecutive fails   ${c.consecutiveFailures}`,
      `  last attempt        ${stamp(c.lastAttemptAt)}`,
      `  last success        ${stamp(c.lastSyncAt)}`,
      `  next attempt        ${stamp(c.nextAttemptAt)}`,
      `  next request        start-date=${stamp(c.nextRequest.startDate)} pending=${c.nextRequest.pendingRequested ? '1' : 'NOT SENT'}`,
      `  last error          ${c.lastError ?? '—'}`,
    )
    for (const e of c.lastErrorList ?? []) lines.push(`  bank says           ${e}`)

    lines.push('')
    if (!c.accounts.length) lines.push('  (no accounts on this connection)', '')
    for (const a of c.accounts) lines.push(...accountLines(a, '  '), '')
  }

  if (d.unlinkedAccounts.length) {
    lines.push('--- accounts kept by hand / imported ---')
    for (const a of d.unlinkedAccounts) lines.push(...accountLines(a, '  '), '')
  }

  if (!d.connections.length && !d.unlinkedAccounts.length) lines.push('(no connections, no accounts)')

  return lines.join('\n')
})

async function copy() {
  copying.value = true
  try {
    await navigator.clipboard.writeText(report.value)
    toast.add({ title: t('finance.diagnostics.copied'), color: 'success' })
  }
  catch {
    // Clipboard writes need a secure context; over plain HTTP on the LAN this
    // throws. The text is on screen and selectable either way, so say that
    // rather than leaving a dead button.
    toast.add({ title: t('finance.diagnostics.couldNotCopy'), color: 'error' })
  }
  finally {
    copying.value = false
  }
}
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="font-semibold">{{ $t('finance.diagnostics.title') }}</h2>
        <UButton
          size="sm"
          color="neutral"
          variant="ghost"
          :icon="open ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
          @click="open = !open"
        >
          {{ open ? $t('finance.diagnostics.hide') : $t('finance.diagnostics.show') }}
        </UButton>
      </div>
    </template>

    <div v-if="open" class="space-y-3">
      <p class="text-sm text-slate-500 dark:text-slate-400">
        {{ $t('finance.diagnostics.help') }}
      </p>

      <div v-if="status === 'pending'" class="py-2 text-sm text-slate-500 dark:text-slate-400">
        {{ $t('common.state.loading') }}
      </div>

      <template v-else>
        <div class="flex flex-wrap gap-2">
          <UButton size="sm" icon="i-lucide-copy" :loading="copying" class="min-h-11" @click="copy">
            {{ $t('finance.diagnostics.copy') }}
          </UButton>
          <UButton
            size="sm"
            color="neutral"
            variant="soft"
            icon="i-lucide-refresh-cw"
            class="min-h-11"
            @click="refresh()"
          >
            {{ $t('finance.diagnostics.refresh') }}
          </UButton>
        </div>

        <!-- Selectable even when the clipboard API is unavailable (plain HTTP
             on the LAN has no secure context), so the button is never the only
             way to get the text out. -->
        <pre
          class="max-h-96 overflow-auto rounded-lg bg-slate-50 p-3 text-xs leading-relaxed
                 whitespace-pre text-slate-700 select-all dark:bg-slate-900 dark:text-slate-300"
        >{{ report }}</pre>
      </template>
    </div>

    <p v-else class="text-sm text-slate-500 dark:text-slate-400">
      {{ $t('finance.diagnostics.collapsedHint') }}
    </p>
  </UCard>
</template>
