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

/*
 * Удаление демо — отсюда же, где оно создавалось.
 *
 * Заходить внутрь аккаунта ради этого незачем: демо заводят, чтобы посмотреть,
 * и убирают, когда посмотрели. Набранное слово, которым защищено удаление
 * настоящего аккаунта, здесь лишнее — данные выдуманы и собираются заново одним
 * нажатием (D-068). Но и молча по щелчку не удаляем: подтверждение есть.
 */
const dropping = ref(false)
const removing = ref(false)

async function removeDemo(): Promise<void> {
  if (!demo.value) return
  removing.value = true
  error.value = ''
  try {
    await api.del(`/accounts/${demo.value.id}`)
    await load()
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    removing.value = false
    dropping.value = false
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
      <!--
        Плитка кликается целиком, но ссылкой её больше не оборачиваем: внутри
        живёт кнопка удаления, а кнопка внутри ссылки — невалидная разметка,
        которую браузеры чинят каждый по-своему. Вместо этого ссылка на имени
        растягивается псевдоэлементом на всю плитку, а корзина лежит поверх неё.
      -->
      <div v-for="account in accounts" :key="account.id" class="card card--link account">
        <div class="row row--between">
          <div class="grow">
            <NuxtLink class="account__name" :to="`/accounts/${account.id}`">
              {{ account.label || account.email }}
            </NuxtLink>
            <span v-if="account.label" class="tiny email"> · {{ account.email }}</span>
          </div>
          <span v-if="account.isDemo" class="chip chip--info">{{ t('demo.chip') }}</span>
          <span v-else class="chip" :class="`chip--${statusChip(account).kind}`">
            {{ statusChip(account).text }}
          </span>
          <button
            v-if="account.isDemo"
            class="account__drop"
            type="button"
            :title="t('demo.delete')"
            :aria-label="t('demo.delete')"
            :disabled="removing"
            @click="dropping = true"
          >
            <span v-if="removing" class="spinner" />
            <AppIcon v-else name="trash" :size="14" />
          </button>
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
      </div>
    </div>

    <!-- Подтверждение есть, набранного слова нет: терять тут нечего -->
    <div v-if="dropping" class="modal-scrim" @click="dropping = false" />
    <div v-if="dropping" class="modal" role="dialog" aria-modal="true">
      <h3 style="margin-top: 0">{{ t('demo.delete.title') }}</h3>
      <p class="tiny muted">{{ t('demo.delete.note') }}</p>
      <div class="row" style="gap: 0.4rem">
        <button class="btn btn--danger" :disabled="removing" @click="removeDemo">
          <span v-if="removing" class="spinner" />
          <AppIcon v-else name="trash" :size="14" />
          {{ t('demo.delete') }}
        </button>
        <button class="btn" @click="dropping = false">{{ t('common.cancel') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.actions {
  gap: 0.4rem;
  flex: none;
}

.account {
  position: relative;
}

/*
 * Ссылка на имени накрывает плитку целиком.
 *
 * Так плитка остаётся кликабельной, а разметка — валидной: кнопка удаления
 * лежит рядом со ссылкой, а не внутри неё (D-068).
 */
.account__name {
  font-weight: 600;
  color: var(--ink);
  text-decoration: none;
}
.account__name::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
}

/*
 * Корзина на карточке демо: значок, а не кнопка первого ряда.
 *
 * Тихая по умолчанию и краснеет под курсором — удаление здесь не то действие,
 * ради которого на плитку смотрят, но и прятать его в глубину незачем.
 */
.account__drop {
  position: relative;
  z-index: 1;
  display: inline-grid;
  place-items: center;
  width: 30px;
  height: 30px;
  flex: none;
  border: none;
  border-radius: var(--radius-xs);
  background: none;
  color: var(--ink-3);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.account__drop:hover {
  background: color-mix(in oklab, var(--bad) 12%, transparent);
  color: var(--bad);
}
.account__drop:disabled {
  cursor: default;
  opacity: 0.6;
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
