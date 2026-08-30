<script setup lang="ts">
import type { AccountDto } from '@fatoff/contracts'

const api = useApi()
const router = useRouter()
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

/*
 * Демо-аккаунт: показать сервис тому, кому нечего в него загрузить.
 *
 * Пока демо нет, кнопка его создаёт; как только оно есть — на её месте ссылка
 * «Открыть». Второе демо ни на что не годится, а плодить его человек начнёт с
 * первого же повторного нажатия (D-068).
 */
const demo = computed(() => accounts.value.find((account) => account.isDemo) ?? null)
const building = ref(false)

async function createDemo(): Promise<void> {
  building.value = true
  error.value = ''
  try {
    const account = await api.post<AccountDto>('/demo', { locale: locale.value })
    await router.push(`/accounts/${account.id}`)
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    building.value = false
  }
}
</script>

<template>
  <div>
    <!-- на узком экране кнопки уезжают под заголовок, а не за край экрана -->
    <div class="row row--between row--wrap">
      <div>
        <h1>{{ t('accounts.title') }}</h1>
        <p class="lede">{{ t('accounts.lede') }}</p>
      </div>
      <div class="row actions">
        <NuxtLink v-if="demo" class="btn" :to="`/accounts/${demo.id}`">
          <AppIcon name="gauge" :size="14" /> {{ t('demo.open') }}
        </NuxtLink>
        <button v-else class="btn" :disabled="building" @click="createDemo">
          <span v-if="building" class="spinner" />
          <AppIcon v-else name="gauge" :size="14" />
          {{ t('demo.create') }}
        </button>
        <NuxtLink to="/accounts/new" class="btn btn--primary">{{ t('accounts.add') }}</NuxtLink>
      </div>
    </div>

    <div v-if="error" class="alert alert--bad">{{ error }}</div>
    <p v-if="loading" class="muted"><span class="spinner" /> {{ t('common.loading') }}</p>

    <template v-else-if="accounts.length === 0">
      <p class="card muted">{{ t('accounts.empty') }}</p>

      <!-- пустая страница — единственное место, где про демо надо объяснить -->
      <section class="card">
        <h2 style="margin-top: 0">{{ t('demo.title') }}</h2>
        <p class="muted">{{ t('demo.lede') }}</p>
        <button class="btn btn--primary" :disabled="building" @click="createDemo">
          <span v-if="building" class="spinner" />
          <AppIcon v-else name="gauge" :size="14" />
          {{ t('demo.create') }}
        </button>
      </section>
    </template>

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
          <span v-if="account.isDemo" class="chip chip--info">{{ t('demo.chip') }}</span>
          <span v-else class="chip" :class="`chip--${statusChip(account).kind}`">
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
          <template v-if="account.isDemo">
            <span>{{ t('demo.card') }}</span>
          </template>
          <template v-else>
            <span>{{ t('accounts.lastSync') }}: {{ when(account.lastSyncAt) }}</span>
            <span v-if="!account.syncEnabled" class="chip chip--mute">
              {{ t('accounts.autoOff') }}
            </span>
          </template>
        </div>
      </NuxtLink>
    </div>
  </div>
</template>

<style scoped>
.actions {
  gap: 0.4rem;
  flex: none;
}

@media (max-width: 30rem) {
  /* заголовок и кнопки в одну строку не помещаются: 404 пикселя при 360 */
  .actions {
    width: 100%;
  }
  .actions > * {
    flex: 1;
    justify-content: center;
  }
}
</style>
