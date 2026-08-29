<script setup lang="ts">
import type { AccountDto, AccountOverviewDto, SyncRunDto } from '@fatoff/contracts'

/**
 * Обзор аккаунта.
 *
 * Только то, что показывает состояние: сводка, графики и короткое объяснение,
 * что лежит в каждом разделе. Управление — синхронизация, загрузка Apple Health,
 * доступ к аккаунту — переехало в свой раздел: обзор не должен быть местом, где
 * заодно нажимают кнопки.
 */
const api = useApi()
const route = useRoute()
const { t } = useI18n()
const id = route.params.id as string

const account = ref<AccountDto | null>(null)

/**
 * Имя аккаунта задаётся прямо здесь.
 *
 * Пока его нет, в заголовке стоит почта — а почта у входа через Apple ID
 * выглядит как `72xxxxxxxx@privaterelay.appleid.com` и именем не является
 * вовсе. Поле лежало в настройках синхронизации под словом «метка», и найти
 * его, чтобы просто дать аккаунту короткое имя, было неоткуда.
 */
const naming = ref(false)
const draftName = ref('')
const saving = ref(false)

function startNaming(): void {
  draftName.value = account.value?.label ?? ''
  naming.value = true
}

async function saveName(): Promise<void> {
  if (!account.value) return
  saving.value = true
  try {
    const label = draftName.value.trim() || null
    await api.patch(`/accounts/${id}`, { label, syncEnabled: account.value.syncEnabled })
    account.value = { ...account.value, label }
    naming.value = false
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    saving.value = false
  }
}
const overview = ref<AccountOverviewDto | null>(null)
const runs = ref<SyncRunDto[]>([])
const error = ref('')

const SECTIONS = [
  { to: '/journal', key: 'nav.journal', note: 'section.journal', icon: 'calendar' },
  { to: '/planner', key: 'nav.planner', note: 'section.planner', icon: 'sliders' },
  { to: '/plans', key: 'nav.plans', note: 'section.plans', icon: 'archive' },
  { to: '/guide', key: 'nav.guide', note: 'section.guide', icon: 'info' },
  { to: '/data', key: 'nav.data', note: 'section.data', icon: 'search' },
  { to: '/sync', key: 'nav.sync', note: 'section.sync', icon: 'swap' },
  { to: '/export', key: 'nav.export', note: 'section.export', icon: 'save' },
]

const lastRun = computed(() => runs.value[0] ?? null)

const energySeries = computed(() =>
  (overview.value?.series ?? []).map((point) => ({ date: point.date, value: point.energyKcal })),
)
const weightSeries = computed(() =>
  (overview.value?.series ?? []).map((point) => ({ date: point.date, value: point.weightKg })),
)

onMounted(async () => {
  try {
    ;[account.value, overview.value, runs.value] = await Promise.all([
      api.get<AccountDto>(`/accounts/${id}`),
      api.get<AccountOverviewDto>(`/accounts/${id}/overview`),
      api.get<SyncRunDto[]>(`/accounts/${id}/sync?limit=1`),
    ])
  } catch (caught) {
    error.value = errorMessage(caught)
  }
})

const num = (value: number | null | undefined, digits = 0): string =>
  value === null || value === undefined
    ? '—'
    : value.toLocaleString('ru-RU', { maximumFractionDigits: digits })

const when = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '—'
</script>

<template>
  <div v-if="account">
    <PageHead :title="account.label || account.email" :faint="!account.label" :back="'/'">
      <template #title-extra>
        <button class="btn btn--small name-btn" type="button" @click="startNaming">
          <AppIcon name="edit" :size="13" />
          {{ account.label ? t('overview.name.change') : t('overview.name.set') }}
        </button>
      </template>

      <span class="mono tiny email" :title="account.email">{{ account.email }}</span>
      · {{ t('overview.registered') }} {{ account.registrationDate || '—' }}
      · {{ account.storedDays }} {{ t('overview.storedDays') }}
      · {{ t('overview.lastSync') }}
      <template v-if="lastRun">
        {{ when(lastRun.startedAt) }}
        <span class="chip" :class="lastRun.status === 'done' ? 'chip--ok' : 'chip--warn'">
          {{ t(`sync.status.${lastRun.status}`) }}
        </span>
      </template>
      <template v-else>{{ t('overview.never') }}</template>
    </PageHead>

    <div v-if="error" class="alert alert--bad">{{ error }}</div>

    <div v-if="naming" class="card">
      <label class="field" style="margin: 0 0 0.4rem">
        <span>{{ t('overview.name') }}</span>
        <input
          v-model="draftName"
          type="text"
          maxlength="64"
          :placeholder="t('overview.name.hint')"
          @keydown.enter.prevent="saveName"
        />
      </label>
      <p class="tiny muted">{{ t('overview.name.note') }}</p>
      <div class="row" style="gap: 0.4rem">
        <button class="btn btn--primary" type="button" :disabled="saving" @click="saveName">
          <AppIcon name="check" :size="14" /> {{ t('common.save') }}
        </button>
        <button class="btn" type="button" @click="naming = false">{{ t('common.cancel') }}</button>
      </div>
    </div>

    <!-- ── сводка ─────────────────────────────────────────────────────────── -->
    <section class="card">
      <h2><AppIcon name="gauge" :size="16" /> {{ t('overview.summary') }}</h2>

      <div v-if="overview && overview.daysWithData > 0" class="stats">
        <div>
          <div class="stat__value">{{ num(overview.avgEnergyKcal) }}</div>
          <div class="stat__label">{{ t('overview.stat.kcal') }}</div>
        </div>
        <div>
          <div class="stat__value">{{ num(overview.avgEnergyGoalKcal) }}</div>
          <div class="stat__label">{{ t('overview.stat.goal') }}</div>
        </div>
        <div>
          <div class="stat__value">{{ num(overview.daysWithData) }}</div>
          <div class="stat__label">{{ t('overview.stat.daysWithFood') }}</div>
        </div>
        <div>
          <div class="stat__value">{{ num(overview.weightLastKg, 1) }}</div>
          <div class="stat__label">{{ t('overview.stat.weight') }}</div>
        </div>
        <div>
          <div class="stat__value">{{ num(overview.productsCached) }}</div>
          <div class="stat__label">{{ t('overview.stat.products') }}</div>
        </div>
      </div>

      <p v-else class="muted">
        {{ t('overview.noData') }}
        <NuxtLink :to="`/accounts/${id}/sync`">{{ t('nav.sync') }}</NuxtLink>
      </p>
    </section>

    <template v-if="overview && overview.daysWithData > 0">
      <section class="card">
        <h2><AppIcon name="flame" :size="16" /> {{ t('overview.chart.energy') }}</h2>
        <MetricChart :points="energySeries" :reference="overview.avgEnergyGoalKcal" kind="bars" />
      </section>

      <section class="card">
        <h2><AppIcon name="target" :size="16" /> {{ t('overview.chart.weight') }}</h2>
        <MetricChart :points="weightSeries" kind="line" :digits="1" />
      </section>
    </template>

    <!-- ── разделы ────────────────────────────────────────────────────────── -->
    <section class="card">
      <h2><AppIcon name="info" :size="16" /> {{ t('overview.sections') }}</h2>
      <p class="tiny muted">{{ t('overview.sections.lede') }}</p>

      <div class="sections">
        <NuxtLink v-for="section in SECTIONS" :key="section.to" :to="`/accounts/${id}${section.to}`" class="section">
          <span class="section__head">
            <AppIcon :name="section.icon" :size="15" />
            <strong>{{ t(section.key) }}</strong>
          </span>
          <span class="tiny muted">{{ t(section.note) }}</span>
        </NuxtLink>
      </div>
    </section>
  </div>

  <p v-else class="muted"><span class="spinner" /> {{ t('common.loading') }}</p>
</template>

<style scoped>
h2 {
  display: flex;
  align-items: center;
  gap: 0.45rem;
}

.sections {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(17rem, 100%), 1fr));
  gap: 0.6rem;
  margin-top: 0.8rem;
}
.section {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  padding: 0.75rem 0.85rem;
  border: 1px solid var(--line-soft);
  border-radius: var(--radius-sm);
  background: var(--sunk);
  color: inherit;
  text-decoration: none;
  transition: border-color 0.15s, background 0.15s;
}
.section:hover {
  border-color: color-mix(in oklab, var(--accent) 45%, var(--line));
  background: var(--accent-bg);
}
.section__head {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  color: var(--ink);
}

/* почта — служебная строка: мелко, в одну строку и с многоточием */
.email {
  display: inline-block;
  max-width: min(100%, 22rem);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
}
.name-btn {
  flex: none;
}
</style>
