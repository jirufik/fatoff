<script setup lang="ts">
import type { AccountDto } from '@fatoff/contracts'

const api = useApi()
const { t, locale } = useI18n()

const accounts = ref<AccountDto[]>([])
const error = ref('')
const loading = ref(true)

async function load(): Promise<void> {
  try {
    accounts.value = await api.get<AccountDto[]>('/accounts')
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    loading.value = false
  }
}

onMounted(load)

const KIND: Record<string, string> = { ok: 'ok', failed: 'bad', running: 'info' }

const statusChip = (account: AccountDto): { text: string; kind: string } => {
  const status = account.lastSyncStatus ?? 'never'
  return { text: t(`accounts.status.${status}`), kind: KIND[status] ?? 'mute' }
}

const when = (iso: string | null): string =>
  iso
    ? new Date(iso).toLocaleString(locale.value === 'ru' ? 'ru-RU' : 'en-GB', {
        dateStyle: 'short',
        timeStyle: 'short',
      })
    : '—'
</script>

<template>
  <div>
    <div class="row row--between">
      <div>
        <h1>{{ t('accounts.title') }}</h1>
        <p class="lede">{{ t('accounts.lede') }}</p>
      </div>
      <NuxtLink to="/accounts/new" class="btn btn--primary">{{ t('accounts.add') }}</NuxtLink>
    </div>

    <div v-if="error" class="alert alert--bad">{{ error }}</div>
    <p v-if="loading" class="muted"><span class="spinner" /> {{ t('common.loading') }}</p>

    <p v-else-if="accounts.length === 0" class="card muted">{{ t('accounts.empty') }}</p>

    <div v-else class="stack">
      <NuxtLink
        v-for="account in accounts"
        :key="account.id"
        :to="`/accounts/${account.id}`"
        class="card card--link"
      >
        <div class="row row--between">
          <div class="grow">
            <strong>{{ account.label || account.email }}</strong>
            <span v-if="account.label" class="tiny email"> · {{ account.email }}</span>
          </div>
          <span class="chip" :class="`chip--${statusChip(account).kind}`">
            {{ statusChip(account).text }}
          </span>
        </div>

        <div class="row row--wrap muted" style="margin-top: 0.5rem; gap: 1.2rem">
          <span>
            {{ t('accounts.storedDays') }}:
            <strong class="mono">{{ account.storedDays }}</strong>
          </span>
          <span v-if="account.storedFrom" class="mono">
            {{ account.storedFrom }} — {{ account.storedTo }}
          </span>
          <span>{{ t('accounts.lastSync') }}: {{ when(account.lastSyncAt) }}</span>
          <span v-if="!account.syncEnabled" class="chip chip--mute">{{ t('accounts.autoOff') }}</span>
        </div>
      </NuxtLink>
    </div>
  </div>
</template>
